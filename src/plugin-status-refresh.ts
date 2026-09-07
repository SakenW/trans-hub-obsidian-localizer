import {
  normalizePlatformLocale,
  type PlatformLocale,
  type PublicDiscoveryReceipt,
  type PublicDiscoveryStatus,
  type PublicLocalizationStatusBatch,
  type PublicLocalizationStatusProjection,
} from "@trans-hub/client-protocol";

import type { ActivationStore } from "./activation";
import type { PluginState, PublicPluginDiscoveryState } from "./plugin-state";
import type { TargetLocale } from "./product-config";
import type { PluginSyncSummary } from "./plugin-sync";
import { isPublicDiscoveryManuallyRetryable } from "./plugin-localization-status";
import { OBSIDIAN_PUBLIC_PROFILE, submitObsidianPluginDiscovery } from "./submission";

/*
 * Keep all discovery/localization coordinates on the shared canonical locale
 * contract before they cross the public-client boundary.
 */
type PublicStatusQuery = {
  readonly pluginId: string;
  readonly discoveryId: string;
  readonly targetLocale: PlatformLocale;
  readonly catalogIdentityDigest: string;
  readonly installationId: string;
  readonly receiptId: string;
};
export type PluginStatusReadResult =
  | { readonly kind: "fresh" }
  | {
      readonly kind: "stale";
      readonly failedPluginIds: readonly string[];
      readonly failedSources: readonly PluginStatusReadSource[];
    };

export type PluginStatusReadSource =
  | "public-discovery"
  | "public-localization";

export function normalizeDiscoveryLocales(locales: readonly TargetLocale[]): readonly TargetLocale[] {
  return [...new Set(locales)].sort();
}

export function sameTargetLocales(
  left: readonly TargetLocale[],
  right: readonly TargetLocale[],
): boolean {
  return left.length === right.length && left.every((locale, index) => locale === right[index]);
}

export function publicDiscoveryFromReceipt(input: {
  readonly receipt: PublicDiscoveryReceipt;
  readonly targetLocales: readonly TargetLocale[];
  readonly installationId: string;
  readonly retryGeneration: number;
  readonly catalogIdentityDigest: string;
}): PublicPluginDiscoveryState {
  return {
    statusRevision: 2,
    receiptId: input.receipt.receiptId,
    discoveryId: input.receipt.discoveryId,
    taskId: input.receipt.taskId,
    targetLocales: input.targetLocales,
    classification: input.receipt.classification,
    taskState: input.receipt.taskState,
    taskGeneration: null,
    attemptCount: 0,
    outcome: input.receipt.outcome,
    commandDigestHex: input.receipt.commandDigest.hex,
    credentialEpoch: input.receipt.credentialEpoch,
    receiptRecordedAt: input.receipt.recordedAt,
    updatedAt: input.receipt.recordedAt,
    retryAfterSeconds: 0,
    retryAllowed: false,
    retryGeneration: input.retryGeneration,
    installationId: input.installationId,
    submittedAt: input.receipt.recordedAt,
    sourceDiscoveryEpoch: OBSIDIAN_PUBLIC_PROFILE.sourceDiscoveryEpoch,
    catalogIdentityDigest: input.catalogIdentityDigest,
  };
}

/**
 * Refresh status without routine writes. The sole recovery exception is an
 * authenticated 404 for the exact persisted discovery receipt: that stale
 * local receipt is replaced by one fresh public-discovery intent. Every other
 * read failure remains stale and performs no write.
 */
export async function refreshConfiguredPluginStatuses(input: {
  readonly apiBaseUrl: string;
  readonly targetLocale: TargetLocale;
  readonly excludedPluginIds: readonly string[];
  readonly onlyPluginIds?: readonly string[];
  readonly activationStore: ActivationStore;
  readonly getState: () => PluginState;
  readonly replaceState: (state: PluginState) => void;
  readonly save: () => Promise<void>;
}): Promise<PluginSyncSummary> {
  const { client, bootstrap } = await input.activationStore.client({
    apiBaseUrl: input.apiBaseUrl,
  });
  return (await refreshPluginStatuses(input, client, bootstrap.installationId, true)).summary;
}

type StatusInput = Pick<Parameters<typeof refreshConfiguredPluginStatuses>[0],
  "targetLocale" | "excludedPluginIds" | "onlyPluginIds" | "getState" | "replaceState" | "save">;

export async function refreshPluginStatuses(
  input: StatusInput,
  client: Awaited<ReturnType<ActivationStore["client"]>>["client"],
  installationId: string,
  recoverMissing = false,
): Promise<{ readonly summary: PluginSyncSummary; readonly sourceVersionIds: ReadonlyMap<string, string> }> {
  const sourceVersionIds = new Map<string, string>();
  const excluded = new Set(input.excludedPluginIds);
  const only = input.onlyPluginIds === undefined ? null : new Set(input.onlyPluginIds);
  const discoveryQueries: PublicStatusQuery[] = [];
  const discoveryWaiting = new Set<string>();
  const discoveryFailed = new Set<string>();
  const discoveryBlocked = new Set<string>();
  const failedStatusPluginIds = new Set<string>();
  const failedStatusSources = new Set<PluginStatusReadSource>();
  let submittedCount = 0;
  for (const catalog of Object.values(input.getState().pluginCatalogs)) {
    if (excluded.has(catalog.pluginId) || (only !== null && !only.has(catalog.pluginId))) {
      continue;
    }
    const discovery = input.getState().publicPluginDiscoveries?.[catalog.pluginId];
    if (
      discovery !== undefined
      && discovery.installationId === installationId
      && discovery.statusRevision === 2
      && discovery.receiptId !== undefined
      && typeof catalog.digest === "string"
      && discovery.catalogIdentityDigest === catalog.digest
      && discovery.targetLocales.includes(input.targetLocale)
    ) {
      discoveryQueries.push({
        pluginId: catalog.pluginId,
        discoveryId: discovery.discoveryId,
        targetLocale: normalizePlatformLocale(input.targetLocale),
        catalogIdentityDigest: catalog.digest,
        installationId: discovery.installationId,
        receiptId: discovery.receiptId,
      });
    }
  }
  const [lifecycleResults, projectionResults] = await Promise.all([
    readLifecycles(client, discoveryQueries),
    readProjections(client, discoveryQueries),
  ]);
  for (const { query, item } of projectionResults) {
    if (item === null) {
      failedStatusPluginIds.add(query.pluginId);
      failedStatusSources.add("public-localization");
    }
  }
  const previousState = input.getState();
  for (const { query, item } of projectionResults) {
    const current = currentDiscoveryForStatusQuery(previousState, query);
    if (current === undefined || (item?.projection !== null && item?.projection !== undefined
      && current.localizationProjection?.targetLocale === item.projection.targetLocale
      && Date.parse(item.projection.updatedAt) < Date.parse(current.localizationProjection.updatedAt))) {
      failedStatusPluginIds.add(query.pluginId);
      failedStatusSources.add("public-localization");
    }
  }
  let nextState = previousState;
  let changed = false;
  if (discoveryQueries.length > 0) {
    for (const { query, status, error } of lifecycleResults) {
      if (status === null) {
        if (recoverMissing && !failedStatusPluginIds.has(query.pluginId) && isAuthenticatedDiscoveryNotFound(error)) {
          const discovery = currentDiscoveryForStatusQuery(input.getState(), query);
          const catalog = input.getState().pluginCatalogs[query.pluginId];
          if (discovery !== undefined && catalog !== undefined) {
            try {
              const retryGeneration = (discovery.retryGeneration ?? 0) + 1;
              let recovery = missingReceiptRecoveries.get(discovery);
              if (recovery === undefined) {
                recovery = submitObsidianPluginDiscovery({
                  client, installationId: discovery.installationId, catalog,
                  targetLocales: discovery.targetLocales,
                  observationGeneration: retryGeneration,
                });
                missingReceiptRecoveries.set(discovery, recovery);
              }
              let receipt: PublicDiscoveryReceipt;
              try {
                receipt = await recovery;
              } finally {
                missingReceiptRecoveries.delete(discovery);
              }
              nextState = {
                ...nextState,
                publicPluginDiscoveries: {
                  ...nextState.publicPluginDiscoveries,
                  [query.pluginId]: publicDiscoveryFromReceipt({
                    receipt,
                    targetLocales: discovery.targetLocales,
                    installationId: discovery.installationId,
                    retryGeneration,
                    catalogIdentityDigest: query.catalogIdentityDigest,
                  }),
                },
              };
              submittedCount += 1;
              changed = true;
              continue;
            } catch {
              // A failed recovery submission leaves the stale receipt intact;
              // the status remains typed stale and this refresh has no local write.
            }
          }
        }
        failedStatusPluginIds.add(query.pluginId);
        failedStatusSources.add("public-discovery");
        continue;
      }
      if (status.receiptId !== query.receiptId || status.discoveryId !== query.discoveryId) {
        failedStatusPluginIds.add(query.pluginId);
        failedStatusSources.add("public-discovery");
        continue;
      }
      if (failedStatusPluginIds.has(query.pluginId)) continue;
      const discovery = currentDiscoveryForStatusQuery(nextState, query);
      if (discovery === undefined) continue;
      const updated = mergePublicDiscoveryStatus(discovery, status);
      if (updated === discovery) continue;
      nextState = {
        ...nextState,
        publicPluginDiscoveries: {
          ...nextState.publicPluginDiscoveries,
          [query.pluginId]: updated,
        },
      };
      changed = true;
    }
    for (const { query: expectedQuery, item } of projectionResults) {
      if (item === null) continue;
      const discovery = currentDiscoveryForStatusQuery(nextState, expectedQuery);
      if (
        failedStatusPluginIds.has(expectedQuery.pluginId)
        || discovery === undefined
        || item.discoveryId !== expectedQuery.discoveryId
        || item.targetLocale !== expectedQuery.targetLocale
      ) continue;
      if (!item.found || item.projection === null) {
        if (discovery.localizationProjection?.targetLocale !== item.targetLocale) continue;
        const {
          localizationProjection: staleProjection,
          ...discoveryWithoutProjection
        } = discovery;
        void staleProjection;
        nextState = {
          ...nextState,
          publicPluginDiscoveries: {
            ...nextState.publicPluginDiscoveries,
            [expectedQuery.pluginId]: discoveryWithoutProjection,
          },
        };
        changed = true;
        continue;
      }
      if (
        item.projection.externalObjectId !== expectedQuery.pluginId
        || item.projection.discoveryId !== discovery.discoveryId
        || item.projection.targetLocale !== expectedQuery.targetLocale
        || (
          discovery.localizationProjection?.targetLocale === item.projection.targetLocale
          && Date.parse(item.projection.updatedAt)
            < Date.parse(discovery.localizationProjection.updatedAt)
        )
      ) continue;
      if (item.projection.sourceVersionId) {
        sourceVersionIds.set(expectedQuery.pluginId, item.projection.sourceVersionId);
      }
      if (samePublicLocalizationProjection(discovery.localizationProjection, item.projection)) {
        continue;
      }
      nextState = {
        ...nextState,
        publicPluginDiscoveries: {
          ...nextState.publicPluginDiscoveries,
          [expectedQuery.pluginId]: {
            ...discovery,
            localizationProjection: item.projection,
          },
        },
      };
      changed = true;
    }
  }
  if (changed) {
    // Recovery awaits a network write. Merge only unchanged receipts into the
    // latest state so concurrent scans, settings and other refreshes survive.
    const liveState = input.getState();
    let committedState = liveState;
    for (const query of discoveryQueries) {
      const before = previousState.publicPluginDiscoveries[query.pluginId];
      const after = nextState.publicPluginDiscoveries[query.pluginId];
      if (after === before) continue;
      if (currentDiscoveryForStatusQuery(liveState, query) !== before) {
        sourceVersionIds.delete(query.pluginId);
        failedStatusPluginIds.add(query.pluginId);
        failedStatusSources.add("public-discovery");
        continue;
      }
      committedState = { ...committedState, publicPluginDiscoveries: {
        ...committedState.publicPluginDiscoveries, [query.pluginId]: after,
      } };
    }
    if (committedState !== liveState) {
      input.replaceState(committedState);
      try {
        await input.save();
      } catch (error) {
        if (input.getState() === committedState) input.replaceState(liveState);
        throw error;
      }
    }
  }
  for (const { pluginId } of discoveryQueries) {
    const discovery = input.getState().publicPluginDiscoveries[pluginId];
    if (
      discovery?.taskState === "blocked"
      || discovery?.localizationProjection?.stage === "blocked"
    ) {
      if (isPublicDiscoveryManuallyRetryable(discovery, input.targetLocale)) {
        discoveryFailed.add(pluginId);
      } else {
        discoveryBlocked.add(pluginId);
      }
    } else if (discovery?.localizationProjection?.stage !== "published") {
      discoveryWaiting.add(pluginId);
    }
  }
  return { sourceVersionIds, summary: {
    submittedCount,
    requestedCount: 0,
    pulledCount: 0,
    translationCount: 0,
    waitingCount: discoveryWaiting.size,
    ...(discoveryWaiting.size === 0 ? {} : { waitingPluginIds: [...discoveryWaiting] }),
    ...(discoveryFailed.size === 0 ? {} : { failedPluginIds: [...discoveryFailed] }),
    ...(discoveryBlocked.size === 0 ? {} : { blockedPluginIds: [...discoveryBlocked] }),
    statusRead: pluginStatusReadResult(failedStatusPluginIds, failedStatusSources),
    ...(discoveryQueries.length === 0 ? {} : { statusReadPluginIds: discoveryQueries.map((query) => query.pluginId) }),
  } };
}

function isAuthenticatedDiscoveryNotFound(error: unknown): boolean {
  return error instanceof Error
    && "diagnostic" in error && typeof error.diagnostic === "object" && error.diagnostic !== null
    && "operation" in error.diagnostic && "status" in error.diagnostic
    && "code" in error && error.code === "PC_HTTP_STATUS"
    && error.diagnostic.operation === "public-discovery-status"
    && error.diagnostic.status === 404;
}

function currentDiscoveryForStatusQuery(
  state: PluginState,
  query: PublicStatusQuery,
): PublicPluginDiscoveryState | undefined {
  const catalog = state.pluginCatalogs[query.pluginId];
  const discovery = state.publicPluginDiscoveries[query.pluginId];
  return catalog?.digest === query.catalogIdentityDigest
    && discovery?.discoveryId === query.discoveryId
    && discovery.installationId === query.installationId
    && discovery.receiptId === query.receiptId
    && discovery.catalogIdentityDigest === query.catalogIdentityDigest
    && discovery.targetLocales.some((locale) => locale === query.targetLocale)
    ? discovery
    : undefined;
}

function mergePublicDiscoveryStatus(
  discovery: PublicPluginDiscoveryState,
  status: PublicDiscoveryStatus,
): PublicPluginDiscoveryState {
  if (
    discovery.updatedAt !== undefined
    && Date.parse(status.updatedAt) < Date.parse(discovery.updatedAt)
  ) return discovery;
  const blockedReasonCode = status.blockedReasonCode ?? undefined;
  const next: PublicPluginDiscoveryState = {
    ...discovery,
    statusRevision: status.statusRevision,
    receiptId: status.receiptId,
    taskId: status.taskId,
    classification: status.classification,
    taskState: status.taskState,
    taskGeneration: status.taskGeneration,
    attemptCount: status.attemptCount,
    outcome: status.outcome,
    commandDigestHex: status.commandDigest.hex,
    credentialEpoch: status.credentialEpoch,
    receiptRecordedAt: status.receiptRecordedAt,
    updatedAt: status.updatedAt,
    retryAfterSeconds: status.retryAfterSeconds,
    retryAllowed: status.retryAllowed,
    ...(blockedReasonCode === undefined ? {} : { blockedReasonCode }),
  };
  if (blockedReasonCode === undefined && discovery.blockedReasonCode !== undefined) {
    const { blockedReasonCode: discarded, ...withoutBlockedReason } = next;
    void discarded;
    return samePublicDiscoveryLifecycle(discovery, withoutBlockedReason)
      ? discovery
      : withoutBlockedReason;
  }
  return samePublicDiscoveryLifecycle(discovery, next) ? discovery : next;
}

function samePublicDiscoveryLifecycle(
  left: PublicPluginDiscoveryState,
  right: PublicPluginDiscoveryState,
): boolean {
  return left.statusRevision === right.statusRevision
    && left.receiptId === right.receiptId
    && left.taskId === right.taskId
    && left.classification === right.classification
    && left.taskState === right.taskState
    && left.taskGeneration === right.taskGeneration
    && left.attemptCount === right.attemptCount
    && left.outcome === right.outcome
    && left.commandDigestHex === right.commandDigestHex
    && left.credentialEpoch === right.credentialEpoch
    && left.receiptRecordedAt === right.receiptRecordedAt
    && left.updatedAt === right.updatedAt
    && left.retryAfterSeconds === right.retryAfterSeconds
    && left.retryAllowed === right.retryAllowed
    && left.blockedReasonCode === right.blockedReasonCode;
}

function samePublicLocalizationProjection(
  left: PublicLocalizationStatusProjection | undefined,
  right: PublicLocalizationStatusProjection,
): boolean {
  return left !== undefined
    && left.discoveryId === right.discoveryId
    && left.registryKey === right.registryKey
    && left.externalObjectId === right.externalObjectId
    && left.targetLocale === right.targetLocale
    && left.catalogIdentityDigest?.hex === right.catalogIdentityDigest?.hex
    && left.sourceVersionId === right.sourceVersionId
    && left.stage === right.stage
    && left.updatedAt === right.updatedAt;
}

function pluginStatusReadResult(
  failedPluginIds: ReadonlySet<string>,
  failedSources: ReadonlySet<PluginStatusReadSource>,
): PluginStatusReadResult {
  return failedSources.size === 0
    ? { kind: "fresh" }
    : {
        kind: "stale",
        failedPluginIds: [...failedPluginIds],
        failedSources: [...failedSources],
      };
}

const missingReceiptRecoveries = new WeakMap<PublicPluginDiscoveryState, Promise<PublicDiscoveryReceipt>>();

async function readLifecycles(
  client: Awaited<ReturnType<ActivationStore["client"]>>["client"],
  queries: readonly PublicStatusQuery[],
) {
  const results: { query: PublicStatusQuery; status: PublicDiscoveryStatus | null; error?: unknown }[] = [];
  // Bound lifecycle reads independently from the projection batch size.
  for (let offset = 0; offset < queries.length; offset += 4) {
    results.push(...await Promise.all(queries.slice(offset, offset + 4).map(async (query) => {
      try {
        return { query, status: await client.getPublicDiscoveryStatus(query.discoveryId) };
      } catch (error) {
        return { query, status: null, error };
      }
    })));
  }
  return results;
}

async function readProjections(
  client: Awaited<ReturnType<ActivationStore["client"]>>["client"],
  queries: readonly PublicStatusQuery[],
) {
  type Item = PublicLocalizationStatusBatch["items"][number];
  const results: { query: PublicStatusQuery; item: Item | null }[] = [];
  for (let offset = 0; offset < queries.length; offset += 100) {
    const batchQueries = queries.slice(offset, offset + 100);
    let batch: PublicLocalizationStatusBatch | null;
    try {
      batch = await client.getPublicLocalizationStatusBatch({
        queries: batchQueries.map(({ discoveryId, targetLocale }) => ({ discoveryId, targetLocale })),
      });
    } catch {
      batch = null;
    }
    batchQueries.forEach((query, index) => {
      const item = batch?.items[index];
      const projection = item?.projection;
      const valid = item !== undefined && item.discoveryId === query.discoveryId
        && item.targetLocale === query.targetLocale
        && (!item.found || (projection !== null && projection !== undefined
          && projection.discoveryId === query.discoveryId
          && projection.targetLocale === query.targetLocale
          && projection.registryKey === "official-directory"
          && projection.externalObjectId === query.pluginId));
      results.push({ query, item: valid ? item : null });
    });
  }
  return results;
}
