import type { LocalizationDemandState } from "@trans-hub/client-protocol";
import {
  packKeysForManifest,
  type LocalPackKey,
  type ScopeAwarePackStore,
} from "@trans-hub/translation-export-client";

import {
  refreshPluginStatuses,
  normalizeDiscoveryLocales,
  sameTargetLocales,
  publicDiscoveryFromReceipt,
  type PluginStatusReadResult,
} from "./plugin-status-refresh";
export { refreshConfiguredPluginStatuses } from "./plugin-status-refresh";
export type { PluginStatusReadResult, PluginStatusReadSource } from "./plugin-status-refresh";

import type { ActivationStore } from "./activation";
import { ObsidianHttpTransport } from "./http-transport";
import { mergePublishedPluginTranslation } from "./plugin-catalog-diff";
import {
  loadPublishedEcosystemCatalog,
  isPublishedPluginCoverageRefreshing,
  resolvePublishedPluginArtifactDigestFromCatalog,
  resolvePublishedPluginSourceFromCatalog,
  type PublishedPluginSource,
} from "./plugin-source-resolution";
import { type PluginUiCatalog } from "./plugin-string-scanner";
import {
  deletePluginTranslation,
  getPluginTranslation,
  setPluginTranslation,
  translationExportStateKey,
  type PluginState,
  type PluginTranslationState,
  type PublicPluginDiscoveryState,
  type PluginSubmissionState,
} from "./plugin-state";
import {
  isPublicDiscoveryManuallyRetryable,
  visiblePluginManualRetryKind,
} from "./plugin-localization-status";
import type { TargetLocale } from "./product-config";
import {
  OBSIDIAN_PUBLIC_PROFILE,
  submitObsidianPluginDiscovery,
} from "./submission";
import { downloadPluginTranslations } from "./translation-sync";
import { validatePluginTranslations } from "./plugin-translation-validation";
export { validatePluginTranslations } from "./plugin-translation-validation";

declare const __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__: "development" | "production";

const ALLOW_DEVELOPMENT_DOWNLOAD_ORIGIN =
  __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__ === "development";

export interface PluginSyncSummary {
  /** Full checked scope completed without stale status or per-plugin delivery failures. */
  readonly checkSucceeded?: boolean;
  readonly submittedCount: number;
  readonly requestedCount: number;
  readonly pulledCount: number;
  /** Published generation or local safe projection actually changed. */
  readonly updatedCount?: number;
  readonly updatedTranslationCount?: number;
  readonly waitingCount: number;
  /**
   * Machine translation is complete and the server is building its public
   * distribution package. These items remain in the automatic polling loop.
   */
  readonly exportPendingCount?: number;
  readonly translationCount: number;
  readonly waitingPluginIds?: readonly string[];
  readonly exportPendingPluginIds?: readonly string[];
  /** 已明确撤回此前发布的译文；同步层只报告事实，不直接写入插件文件。 */
  readonly withdrawnExportPluginIds?: readonly string[];
  readonly failedPluginIds?: readonly string[];
  readonly blockedPluginIds?: readonly string[];
  readonly nextRetryAfterMs?: number;
  readonly demandStateCounts?: Readonly<Partial<Record<LocalizationDemandState, number>>>;
  readonly authorityRefreshingCount?: number;
  /** Status-only reads keep cached facts on failure, but must never report them as freshly read. */
  readonly statusRead?: PluginStatusReadResult;
  readonly statusReadPluginIds?: readonly string[];
}

export interface PublishedPluginSyncProgress {
  readonly checkedCount: number;
  readonly totalCount: number;
  readonly availableCount: number;
}

export async function synchronizeConfiguredPluginTranslations(input: {
  readonly apiBaseUrl: string;
  readonly targetLocale: TargetLocale;
  readonly excludedPluginIds: readonly string[];
  readonly onlyPluginIds?: readonly string[];
  readonly manualResubmitPluginIds?: readonly string[];
  readonly sourceSelectablePluginIds?: readonly string[];
  readonly activationStore: ActivationStore;
  readonly translationPackStore: ScopeAwarePackStore;
  readonly getState: () => PluginState;
  readonly replaceState: (state: PluginState) => void;
  readonly save: () => Promise<void>;
  /** Called only after a plugin's active dictionary is durably saved. */
  readonly onPluginPersisted?: () => void;
  /** Presentation-only progress over plugins with a current published source. */
  readonly onPublishedProgress?: (progress: PublishedPluginSyncProgress) => void;
}): Promise<PluginSyncSummary> {
  const { client, bootstrap, authorityWorkspaceId } = await input.activationStore.client({
    apiBaseUrl: input.apiBaseUrl,
  });
  const excluded = new Set(input.excludedPluginIds);
  const only = input.onlyPluginIds === undefined ? null : new Set(input.onlyPluginIds);
  const manualResubmit = new Set(input.manualResubmitPluginIds ?? []);
  const transport = new ObsidianHttpTransport(input.apiBaseUrl);
  const catalogs = Object.values(input.getState().pluginCatalogs).filter(
    (catalog) => !excluded.has(catalog.pluginId) && (only === null || only.has(catalog.pluginId)),
  );
  // The production caller supplies the exact eligibility snapshot obtained in
  // the same scan.  Keep direct/library callers backward-compatible: they
  // have no picker snapshot and historically treated this catalog batch as
  // their selectable set.
  const sourceSelectablePluginIds = new Set(
    input.sourceSelectablePluginIds ?? catalogs.map((catalog) => catalog.pluginId),
  );
  const projectionRefresh = await refreshPluginStatuses(
    input, client, bootstrap.installationId,
  );
  const staleStatus = projectionRefresh.summary.statusRead;
  const stalePluginIds = new Set(staleStatus?.kind === "stale" ? staleStatus.failedPluginIds : []);
  const publishedCatalog = await loadPublishedCatalogForSynchronization(
    transport,
    catalogs,
    input.targetLocale,
  );
  let submittedCount = 0;
  const requestedCount = 0;
  let pulledCount = 0;
  let updatedCount = 0;
  let updatedTranslationCount = 0;
  let waitingCount = 0;
  const exportPendingCount = 0;
  let translationCount = 0;
  const waitingPluginIds: string[] = [];
  const exportPendingPluginIds: string[] = [];
  const withdrawnExportPluginIds: string[] = [];
  const failedPluginIds: string[] = [];
  const blockedPluginIds: string[] = [];
  const demandStateCounts: Partial<Record<LocalizationDemandState, number>> = {};
  const authorityRefreshingCount = 0;
  let nextRetryAfterMs: number | undefined;
  let packsMayNeedPruning = false;
  let publishedTotalCount = 0;
  let publishedCheckedCount = 0;
  const reportPublishedProgress = (): void => {
    if (publishedTotalCount === 0) return;
    try {
      input.onPublishedProgress?.({
        checkedCount: publishedCheckedCount,
        totalCount: publishedTotalCount,
        availableCount: pulledCount,
      });
    } catch (error) {
      console.warn("[Trans-Hub] 译文同步进度界面暂未刷新：", error);
    }
  };
  const markPersisted = (): void => {
    packsMayNeedPruning = true;
    try {
      input.onPluginPersisted?.();
    } catch (error) {
      // A presentation refresh cannot undo an already durable dictionary.
      console.warn("[Trans-Hub] 已保存译文，界面刷新将在本轮结束时重试：", error);
    }
  };
  const iterations = orderedPluginSyncItems({
    catalogs,
    publishedCatalog,
    sourceVersionIds: projectionRefresh.sourceVersionIds,
    stalePluginIds,
    input,
    transport,
    accessToken: bootstrap.intakeCredential.value,
    authorityWorkspaceId,
    onPlanned: (total) => {
      publishedTotalCount = total;
      reportPublishedProgress();
    },
  });
  try {
  for await (const iteration of iterations) {
    const { catalog } = iteration;
    if (stalePluginIds.has(catalog.pluginId)) {
      if (projectionRefresh.summary.waitingPluginIds?.includes(catalog.pluginId)) {
        waitingCount += 1;
        waitingPluginIds.push(catalog.pluginId);
      }
      if (projectionRefresh.summary.blockedPluginIds?.includes(catalog.pluginId)) blockedPluginIds.push(catalog.pluginId);
      if (projectionRefresh.summary.failedPluginIds?.includes(catalog.pluginId)) failedPluginIds.push(catalog.pluginId);
      continue;
    }
    try {
      if (publishedCatalog?.failedPluginIds?.includes(catalog.pluginId)) {
        throw new Error("此插件的译文目录读取失败，请稍后重试。");
      }
      const authoritativeSourceVersionId = projectionRefresh.sourceVersionIds.get(
        catalog.pluginId,
      );
      if (iteration.resolution?.kind === "failed") throw iteration.resolution.error;
      const publishedResolution = iteration.resolution?.kind === "resolved"
        ? iteration.resolution.value
        : (publishedCatalog === undefined
            ? undefined
            : resolvePublishedPluginSourceFromCatalog(publishedCatalog, {
                pluginId: catalog.pluginId,
                pluginVersion: catalog.pluginVersion,
                targetLocale: input.targetLocale,
                localCatalogIdentity: catalog.catalogIdentity,
                authoritativeSourceVersionId,
              }));
      if (publishedResolution !== undefined && isPublishedPluginCoverageRefreshing(publishedResolution)) {
        // Freshness rebuilding makes aggregate totals intentionally unknown.
        // It is not permission loss or zero coverage, so leave any verified
        // cache and its manifest reference untouched until available coverage arrives.
        if (projectionRefresh.summary.blockedPluginIds?.includes(catalog.pluginId)) {
          blockedPluginIds.push(catalog.pluginId);
        } else {
          waitingCount += 1;
          waitingPluginIds.push(catalog.pluginId);
        }
        continue;
      }
      const published = publishedResolution;
      if (authoritativeSourceVersionId !== undefined) {
        await discardSupersededActiveTranslation(
          input,
          catalog.pluginId,
          authoritativeSourceVersionId,
          markPersisted,
        );
      }
      // Prefer the resolved coverage identity digest: it is the current
      // authoritative scan digest, which is what the local scanner produces.
      // The raw catalog fallback only applies when no locale coverage exists.
      const authoritativeArtifactDigest = published?.artifactDigest
        ?? (publishedCatalog === undefined
          ? undefined
          : resolvePublishedPluginArtifactDigestFromCatalog(publishedCatalog, {
              pluginId: catalog.pluginId,
              pluginVersion: catalog.pluginVersion,
              targetLocale: input.targetLocale,
            }));
      const localArtifactVariant = authoritativeArtifactDigest !== undefined
        && authoritativeArtifactDigest !== catalog.artifactDigest;
      if (published !== undefined) {
        // A local bundle can legitimately differ from the immutable upstream
        // artifact while retaining the same plugin version.  That only limits
        // what the client may apply (to the verified string intersection); it
        // does not mean the authoritative source still needs a translation
        // demand.  Keep the two facts independent so an already complete
        // public source cannot leave the local client at export_pending forever.
        const publishedTranslationCoverageIncomplete = Math.min(
          published.sourceUnitCount,
          published.upstreamNativeCount + published.publishedUnitCount,
        ) < published.sourceUnitCount;
        const sourceVersionId = published.sourceVersionId;
        const existingSubmission = input.getState().pluginSubmissions[catalog.pluginId];
        const activeBeforePull = getPluginTranslation(
          input.getState(),
          catalog.pluginId,
          input.targetLocale,
        );
        const hasRetainedLocalEntries = activeBeforePull?.sourceVersionId === sourceVersionId
          && activeBeforePull.entries.length > 0;
        let deliveryWaiting = false;
        try {
          const pulled = await pullPluginTranslation({
            input,
            transport,
            catalog,
            published,
            accessToken: bootstrap.intakeCredential.value,
            authorityWorkspaceId,
            upstreamNativeCount: published.upstreamNativeCount,
            onPersisted: markPersisted,
            ...(iteration.preparation === undefined ? {} : { preparation: iteration.preparation }),
          });
          pulledCount += 1;
          translationCount += pulled.entryCount;
          if (pulled.updated) {
            updatedCount += 1;
            updatedTranslationCount += pulled.entryCount;
          }
        } catch (error) {
          if (!isPublishedExportPending(error)) throw error;
          const exportWithdrawn = isPublishedExportWithdrawn(error);
          if (exportWithdrawn) {
            withdrawnExportPluginIds.push(catalog.pluginId);
          }
          await saveNativeCoverage(
            input,
            catalog,
            published,
            published.upstreamNativeCount,
            !exportWithdrawn,
            markPersisted,
          );
          if (exportWithdrawn) {
            // A 410 is an explicit revocation, unlike a transient 404 while
            // the published manifest is being restored.  Clear the retired
            // payload above, then retain the failure signal for the UI.
            throw new Error("服务器公开目录与译文制品状态不一致，请稍后重试。");
          }
          const catalogUnitCount = new Set(catalog.strings.map((item) => item.source)).size;
          if (published.upstreamNativeCount >= catalogUnitCount || hasRetainedLocalEntries) {
            pulledCount += 1;
          } else {
            deliveryWaiting = true;
          }
        }
        const currentProjection = input.getState().publicPluginDiscoveries[catalog.pluginId]?.localizationProjection;
        if (!deliveryWaiting && currentProjection?.stage === "published"
          && currentProjection.sourceVersionId === sourceVersionId
          && currentProjection.targetLocale === input.targetLocale) {
          // Missing local matches do not prove ongoing server work. The
          // current source has published and its available export was pulled.
          continue;
        }
        const localCatalogUnitCount = catalog.catalogIdentity?.unitCount ?? catalog.strings.length;
        const publishedCatalogNeedsExpansion = !localArtifactVariant
          && !published.catalogIdentityExact
          && localCatalogUnitCount > published.sourceUnitCount;
        if (!publishedTranslationCoverageIncomplete && !publishedCatalogNeedsExpansion) {
          if (deliveryWaiting) {
            throw new Error("服务器公开目录与译文制品状态不一致，请稍后重试。");
          }
          if (existingSubmission !== undefined) {
            await saveSubmission(
              input,
              { ...existingSubmission, sourceVersionId },
            );
          }
          continue;
        }
      }
      const existingDiscovery = input.getState().publicPluginDiscoveries[catalog.pluginId];
      {
        const manualRecoveryDiscovery = manualResubmit.has(catalog.pluginId)
          && existingDiscovery?.statusRevision === 2
          && isPublicDiscoveryManuallyRetryable(existingDiscovery, input.targetLocale)
          && visiblePluginManualRetryKind({
            state: input.getState(), pluginId: catalog.pluginId,
            targetLocale: input.targetLocale, sourceSelectable: true, hasSession: true,
          }) === "resubmit";
        const targetLocales = normalizeDiscoveryLocales(
          existingDiscovery?.installationId === bootstrap.installationId
            ? [...existingDiscovery.targetLocales, input.targetLocale]
            : [input.targetLocale],
        );
        const requiresSubmission = existingDiscovery === undefined
          || existingDiscovery.installationId !== bootstrap.installationId
          || existingDiscovery.sourceDiscoveryEpoch !== OBSIDIAN_PUBLIC_PROFILE.sourceDiscoveryEpoch
          || existingDiscovery.catalogIdentityDigest !== catalog.digest
          || !sameTargetLocales(existingDiscovery.targetLocales, targetLocales)
          || manualRecoveryDiscovery;
        if (requiresSubmission) {
          const retryGeneration = manualRecoveryDiscovery
            ? (existingDiscovery.retryGeneration ?? 0) + 1
            : 0;
          const receipt = await submitObsidianPluginDiscovery({
            client,
            installationId: bootstrap.installationId,
            catalog,
            targetLocales,
            ...(retryGeneration === 0 ? {} : { observationGeneration: retryGeneration }),
          });
          await savePublicDiscovery(
            input,
            catalog.pluginId,
            publicDiscoveryFromReceipt({
              receipt, targetLocales, installationId: bootstrap.installationId,
              retryGeneration, catalogIdentityDigest: catalog.digest,
            }),
          );
          submittedCount += 1;
          if (receipt.taskState === "blocked" || receipt.classification === "blocked") {
            blockedPluginIds.push(catalog.pluginId);
          } else {
            waitingCount += 1;
            waitingPluginIds.push(catalog.pluginId);
          }
        } else if (existingDiscovery.taskState === "blocked" || existingDiscovery.classification === "blocked") {
          if (isPublicDiscoveryManuallyRetryable(existingDiscovery, input.targetLocale)) {
            failedPluginIds.push(catalog.pluginId);
          } else {
            blockedPluginIds.push(catalog.pluginId);
          }
        } else {
          waitingCount += 1;
          waitingPluginIds.push(catalog.pluginId);
        }
        // The public directory has either not published this entry yet, or
        // has no complete translation coverage. New requests end here: never
        // fall through into the retired URL-based source-discovery or
        // localization-observation writes.
        continue;
      }
    } catch (error) {
      if (isGlobalSynchronizationError(error)) throw error;
      failedPluginIds.push(catalog.pluginId);
      await saveSynchronizationError(input, catalog, bootstrap.installationId, error);
    } finally {
      if (iteration.preparation !== undefined) {
        publishedCheckedCount += 1;
        reportPublishedProgress();
      }
    }
  }
  } finally {
    // All downloads in this pass have settled before collecting unreferenced
    // packs. Use the latest persisted references, including other plugins and
    // languages, and never reclaim after a failed first save.
    if (packsMayNeedPruning) await pruneUnreferencedTranslationPacks(input, input.getState());
  }
  return {
    checkSucceeded: staleStatus?.kind !== "stale"
      && failedPluginIds.length === 0
      && (publishedCatalog?.failedPluginIds?.length ?? 0) === 0,
    submittedCount,
    requestedCount,
    pulledCount,
    updatedCount,
    updatedTranslationCount,
    waitingCount,
    ...(exportPendingCount === 0 ? {} : { exportPendingCount }),
    translationCount,
    waitingPluginIds,
    ...(exportPendingPluginIds.length === 0 ? {} : { exportPendingPluginIds }),
    ...(withdrawnExportPluginIds.length === 0
      ? {}
      : { withdrawnExportPluginIds: [...new Set(withdrawnExportPluginIds)] }),
    failedPluginIds: retryableFailedPluginIds(
      input,
      failedPluginIds,
      sourceSelectablePluginIds,
    ),
    ...(blockedPluginIds.length === 0
      ? {}
      : { blockedPluginIds: [...new Set(blockedPluginIds)] }),
    ...(nextRetryAfterMs === undefined ? {} : { nextRetryAfterMs }),
    demandStateCounts,
    ...(authorityRefreshingCount === 0 ? {} : { authorityRefreshingCount }),
    ...(projectionRefresh.summary.statusReadPluginIds?.length ? {
      statusRead: projectionRefresh.summary.statusRead,
      statusReadPluginIds: projectionRefresh.summary.statusReadPluginIds,
    } : {}),
  };
}

function retryableFailedPluginIds(
  input: Pick<
    Parameters<typeof synchronizeConfiguredPluginTranslations>[0],
    "getState" | "targetLocale"
  >,
  failedPluginIds: readonly string[],
  selectablePluginIds: ReadonlySet<string>,
): readonly string[] {
  const state = input.getState();
  return [...new Set(failedPluginIds)].filter((pluginId) => visiblePluginManualRetryKind({
    state,
    pluginId,
    targetLocale: input.targetLocale,
    sourceSelectable: selectablePluginIds.has(pluginId),
    // Reaching this point means ActivationStore produced an authenticated
    // Public Client. Global session failures abort before a summary is shown.
    hasSession: true,
  }) !== null);
}


interface PluginPullInput {
  readonly input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0];
  readonly transport: ObsidianHttpTransport;
  readonly catalog: PluginUiCatalog;
  readonly published: PublishedPluginSource;
  readonly accessToken: string;
  readonly authorityWorkspaceId: string;
  readonly upstreamNativeCount?: number;
}

type PluginPullPreparation =
  | { readonly kind: "ready"; readonly value: Awaited<ReturnType<typeof preparePluginTranslation>> }
  | { readonly kind: "failed"; readonly error: unknown };

interface PluginSyncItem {
  readonly catalog: PluginUiCatalog;
  readonly resolution?:
    | { readonly kind: "resolved"; readonly value: ReturnType<typeof resolvePublishedPluginSourceFromCatalog> }
    | { readonly kind: "failed"; readonly error: unknown };
  readonly preparation?: PluginPullPreparation;
}

/** Only immutable pack preparation overlaps. Active dictionaries and saves
 * remain in the single consumer's completion order. */
async function* orderedPluginSyncItems(input: {
  readonly catalogs: readonly PluginUiCatalog[];
  readonly publishedCatalog: Awaited<ReturnType<typeof loadPublishedCatalogForSynchronization>>;
  readonly sourceVersionIds: ReadonlyMap<string, string>;
  readonly stalePluginIds: ReadonlySet<string>;
  readonly input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0];
  readonly transport: ObsidianHttpTransport;
  readonly accessToken: string;
  readonly authorityWorkspaceId: string;
  readonly onPlanned: (total: number) => void;
}): AsyncGenerator<PluginSyncItem> {
  const candidates: { readonly catalog: PluginUiCatalog; readonly published: PublishedPluginSource }[] = [];
  const remaining: PluginSyncItem[] = [];
  for (const catalog of input.catalogs) {
    if (input.stalePluginIds.has(catalog.pluginId)
      || input.publishedCatalog?.failedPluginIds?.includes(catalog.pluginId)) {
      remaining.push({ catalog });
      continue;
    }
    try {
      const published = input.publishedCatalog === undefined ? undefined
        : resolvePublishedPluginSourceFromCatalog(input.publishedCatalog, {
            pluginId: catalog.pluginId,
            pluginVersion: catalog.pluginVersion,
            targetLocale: input.input.targetLocale,
            localCatalogIdentity: catalog.catalogIdentity,
            authoritativeSourceVersionId: input.sourceVersionIds.get(catalog.pluginId),
          });
      if (published !== undefined && !isPublishedPluginCoverageRefreshing(published)) {
        candidates.push({ catalog, published });
      } else {
        remaining.push({ catalog, resolution: { kind: "resolved", value: published } });
      }
    } catch (error) {
      // Preserve the existing per-plugin error path, including its persisted
      // diagnostic, in the serial consumer below.
      remaining.push({ catalog, resolution: { kind: "failed", error } });
    }
  }
  input.onPlanned(candidates.length);
  type Settled = { readonly candidate: typeof candidates[number]; readonly preparation: PluginPullPreparation };
  const active: Promise<Settled>[] = [];
  let next = 0;
  const launch = (): void => {
    while (active.length < 3 && next < candidates.length) {
      const candidate = candidates[next++];
      if (candidate === undefined) break;
      void active.push(preparePluginTranslation({
        input: input.input,
        transport: input.transport,
        catalog: candidate.catalog,
        published: candidate.published,
        accessToken: input.accessToken,
        authorityWorkspaceId: input.authorityWorkspaceId,
        upstreamNativeCount: candidate.published.upstreamNativeCount,
      }).then(
        (value): Settled => ({ candidate, preparation: { kind: "ready", value } }),
        (error): Settled => ({ candidate, preparation: { kind: "failed", error } }),
      ));
    }
  };
  try {
    launch();
    while (active.length > 0) {
      const settled = await Promise.race(active.map(async (promise, index) => ({
        index, result: await promise,
      })));
      void active.splice(settled.index, 1);
      yield {
        catalog: settled.result.candidate.catalog,
        resolution: { kind: "resolved", value: settled.result.candidate.published },
        preparation: settled.result.preparation,
      };
      launch();
    }
    for (const item of remaining) yield item;
  } finally {
    // A fatal identity error or save failure must not let the round's GC race
    // with a pack preparation that is still writing verified objects.
    await Promise.all(active);
  }
}

async function pullPluginTranslation(input: PluginPullInput & {
  readonly onPersisted: () => void;
  readonly preparation?: PluginPullPreparation;
}): Promise<{ readonly entryCount: number; readonly updated: boolean }> {
  if (input.preparation?.kind === "failed") throw input.preparation.error;
  const { output, downloaded } = input.preparation?.kind === "ready"
    ? input.preparation.value
    : await preparePluginTranslation(input);
  const state = input.input.getState();
  const dictionary = mergePublishedPluginTranslation(
    input.catalog,
    downloaded,
    getPluginTranslation(state, input.catalog.pluginId, input.input.targetLocale),
  );
  const exportStateKey = translationExportStateKey(input.published.sourceVersionId, input.input.targetLocale);
  const previousExport = state.translationExportStates[exportStateKey];
  const active = getPluginTranslation(state, input.catalog.pluginId, input.input.targetLocale);
  if (output.status === "not_modified"
    && previousExport?.etag === output.etag
    && previousExport.manifest.manifestDigest === output.manifest.manifestDigest
    && state.pluginSubmissions[input.catalog.pluginId] === undefined
    && active !== undefined
    && samePluginTranslationProjection(active, dictionary)) {
    return { entryCount: dictionary.entries.length, updated: false };
  }
  const nextState = setPluginTranslation({
    ...state,
    pluginSubmissions: clearedPluginSubmissions(state, input.catalog.pluginId),
    translationExportStates: {
      ...state.translationExportStates,
      [exportStateKey]: { etag: output.etag, manifest: output.manifest },
    },
  }, input.catalog.pluginId, input.input.targetLocale, dictionary);
  input.input.replaceState(nextState);
  try {
    await input.input.save();
  } catch (error) {
    if (input.input.getState() === nextState) input.input.replaceState(state);
    throw error;
  }
  input.onPersisted();
  return { entryCount: dictionary.entries.length, updated: true };
}

function samePluginTranslationProjection(
  previous: PluginTranslationState,
  current: PluginTranslationState,
): boolean {
  const { pulledAt: previousPulledAt, ...previousProjection } = previous;
  const { pulledAt: currentPulledAt, ...currentProjection } = current;
  void previousPulledAt;
  void currentPulledAt;
  return JSON.stringify(previousProjection) === JSON.stringify(currentProjection);
}

async function preparePluginTranslation(input: PluginPullInput): Promise<{
  readonly output: Awaited<ReturnType<typeof downloadPluginTranslations>>;
  readonly downloaded: ReturnType<typeof validatePluginTranslations>;
}> {
  const exportStateKey = translationExportStateKey(
    input.published.sourceVersionId,
    input.input.targetLocale,
  );
  const previous = input.input.getState().translationExportStates[exportStateKey];
  const output = await downloadPluginTranslations({
    transport: input.transport,
    accessToken: input.accessToken,
    workspaceId: input.authorityWorkspaceId,
    sourceVersionId: input.published.sourceVersionId,
    targetLocale: input.input.targetLocale,
    packStore: input.input.translationPackStore,
    ...(previous === undefined ? {} : { previous }),
    expectedPluginId: input.catalog.pluginId,
    ...(ALLOW_DEVELOPMENT_DOWNLOAD_ORIGIN && isLocalHttp(input.input.apiBaseUrl)
      ? { developmentDownloadOrigin: input.input.apiBaseUrl }
      : {}),
  });
  const downloaded = validatePluginTranslations(
    input.catalog,
    output.rows.map((row) => ({
      stringKey: row.stringKey,
      translatedText: row.translatedText,
      ...(row.provenanceKind === undefined ? {} : { provenanceKind: row.provenanceKind }),
      ...(row.application === undefined ? {} : { application: row.application }),
      ...(row.nativeTarget === undefined ? {} : { nativeTarget: row.nativeTarget }),
      ...(row.sourceCompatibility === undefined
        ? {}
        : { sourceCompatibility: row.sourceCompatibility }),
    })),
    input.published.sourceVersionId,
    input.input.targetLocale,
    input.upstreamNativeCount,
    input.published,
  );
  return { output, downloaded };
}

async function saveNativeCoverage(
  input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0],
  catalog: PluginUiCatalog,
  published: PublishedPluginSource,
  upstreamNativeCount = 0,
  preserveSameSourceEntries = true,
  onPersisted: () => void,
): Promise<void> {
  const state = input.getState();
  const exportStateKey = translationExportStateKey(published.sourceVersionId, input.targetLocale);
  const { [exportStateKey]: discardedExportState, ...remainingExportStates } =
    state.translationExportStates;
  void discardedExportState;
  const active = getPluginTranslation(state, catalog.pluginId, input.targetLocale);
  // A 404 is a transient disagreement between the public directory and pack
  // delivery.  Keep a verified dictionary for this exact source rather than
  // replacing a usable local UI with an empty one.  A withdrawn (410) export
  // follows the separate clearing path above this helper.
  const retainedEntries = preserveSameSourceEntries
    && active?.sourceVersionId === published.sourceVersionId
    ? active.entries
    : [];
  const nextState = setPluginTranslation({
    ...state,
    pluginSubmissions: clearedPluginSubmissions(state, catalog.pluginId),
    translationExportStates: remainingExportStates,
  }, catalog.pluginId, input.targetLocale, {
    pluginId: catalog.pluginId,
    pluginVersion: catalog.pluginVersion,
    ...(published.authorityPluginVersion === undefined
      ? {}
      : { authorityPluginVersion: published.authorityPluginVersion }),
    sourceVersionId: published.sourceVersionId,
    artifactDigest: published.artifactDigest,
    ...(published.sourceSnapshotDigest === undefined
      ? {}
      : { sourceSnapshotDigest: published.sourceSnapshotDigest }),
    ...(published.catalogIdentity === undefined
      ? {}
      : { catalogIdentity: published.catalogIdentity }),
    targetLocale: input.targetLocale,
    sourceUnitCount: published.sourceUnitCount,
    upstreamNativeCount,
    ...(published.upstreamScopedNativeCount === undefined
      ? {}
      : { upstreamScopedNativeCount: published.upstreamScopedNativeCount }),
    ...(published.upstreamScopeCoverage === undefined
      ? {}
      : { upstreamScopeCoverage: published.upstreamScopeCoverage }),
    publishedUnitCount: published.publishedUnitCount,
    missingUnitCount: published.missingUnitCount,
    entries: retainedEntries,
    pulledAt: preserveSameSourceEntries && active?.sourceVersionId === published.sourceVersionId
      ? active.pulledAt
      : new Date().toISOString(),
  });
  input.replaceState(nextState);
  try {
    await input.save();
  } catch (error) {
    if (input.getState() === nextState) input.replaceState(state);
    throw error;
  }
  onPersisted();
}

async function discardSupersededActiveTranslation(
  input: Pick<
    Parameters<typeof synchronizeConfiguredPluginTranslations>[0],
    "targetLocale" | "getState" | "replaceState" | "save" | "translationPackStore"
  >,
  pluginId: string,
  sourceVersionId: string,
  onPersisted: () => void,
): Promise<void> {
  const previousState = input.getState();
  const active = getPluginTranslation(previousState, pluginId, input.targetLocale);
  if (active === undefined || active.sourceVersionId === sourceVersionId) return;
  const withoutActive = deletePluginTranslation(
    previousState,
    pluginId,
    input.targetLocale,
  );
  // A confirmed current-source switch also retires the old manifest reference.
  // Preserve an exact shared reference if another dictionary still uses it.
  const oldKey = translationExportStateKey(active.sourceVersionId, input.targetLocale);
  const stillReferenced = Object.values(withoutActive.pluginTranslations)
    .some((locales) => Object.values(locales).some((translation) =>
      translation?.sourceVersionId === active.sourceVersionId
      && translation.targetLocale === input.targetLocale));
  const nextState = stillReferenced ? withoutActive : {
    ...withoutActive,
    translationExportStates: Object.fromEntries(
      Object.entries(withoutActive.translationExportStates).filter(([key]) => key !== oldKey),
    ),
  };
  input.replaceState(nextState);
  try {
    await input.save();
  } catch (error) {
    if (input.getState() === nextState) input.replaceState(previousState);
    throw error;
  }
  onPersisted();
}

async function pruneUnreferencedTranslationPacks(
  input: Pick<Parameters<typeof synchronizeConfiguredPluginTranslations>[0], "translationPackStore">,
  state: PluginState,
): Promise<void> {
  const store = input.translationPackStore as ScopeAwarePackStore & {
    pruneUnreferenced?: (keep: readonly LocalPackKey[]) => Promise<number>;
  };
  if (store.pruneUnreferenced === undefined) return;
  const keep = Object.values(state.translationExportStates)
    .flatMap((entry) => packKeysForManifest(entry.manifest));
  try {
    await store.pruneUnreferenced(keep);
  } catch (error) {
    // Cache reclamation is never allowed to turn a verified, persisted active
    // translation into a failed synchronization. The next completed sync may
    // retry it with the same reference set.
    console.warn("[Trans-Hub] 无法回收未引用译文缓存；保留现有缓存：", error);
  }
}


async function savePublicDiscovery(
  input: Pick<Parameters<typeof synchronizeConfiguredPluginTranslations>[0], "getState" | "replaceState" | "save">,
  pluginId: string,
  discovery: PublicPluginDiscoveryState,
): Promise<void> {
  const state = input.getState();
  input.replaceState({
    ...state,
    publicPluginDiscoveries: {
      ...state.publicPluginDiscoveries,
      [pluginId]: discovery,
    },
  });
  await input.save();
}

async function saveSubmission(
  input: Pick<Parameters<typeof synchronizeConfiguredPluginTranslations>[0], "getState" | "replaceState" | "save">,
  submission: PluginSubmissionState,
): Promise<void> {
  const { lastError: discardedLastError, ...cleanSubmission } = submission;
  void discardedLastError;
  const state = input.getState();
  input.replaceState({
    ...state,
    pluginSubmissions: {
      ...state.pluginSubmissions,
      [submission.pluginId]: cleanSubmission,
    },
  });
  await input.save();
}

async function saveSynchronizationError(
  input: Pick<
    Parameters<typeof synchronizeConfiguredPluginTranslations>[0],
    "getState" | "replaceState" | "save" | "targetLocale"
  >,
  catalog: PluginUiCatalog,
  installationId: string,
  error: unknown,
): Promise<void> {
  const state = input.getState();
  const pluginId = catalog.pluginId;
  const submission = state.pluginSubmissions[pluginId];
  const errorRecord = {
    code: synchronizationErrorCode(error),
    message: synchronizationErrorMessage(error),
    targetLocale: input.targetLocale,
    updatedAt: new Date().toISOString(),
  };
  if (submission === undefined) {
    console.error(`[Trans-Hub] ${pluginId} sync failed (no prior submission):`, error);
    input.replaceState({
      ...state,
      pluginSubmissions: {
        ...state.pluginSubmissions,
        [pluginId]: {
          pluginId,
          pluginVersion: catalog.pluginVersion,
          catalogDigest: catalog.digest,
          adapterProfileDigest: OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex,
          registryPolicyRevision: OBSIDIAN_PUBLIC_PROFILE.registryPolicyRevision,
          sourceDiscoveryEpoch: OBSIDIAN_PUBLIC_PROFILE.sourceDiscoveryEpoch,
          installationId,
          contributionState: "rejected",
          submittedAt: new Date().toISOString(),
          lastError: errorRecord,
        },
      },
    });
    await input.save();
    return;
  }
  input.replaceState({
    ...state,
    pluginSubmissions: {
      ...state.pluginSubmissions,
      [pluginId]: {
        ...submission,
        lastError: errorRecord,
      },
    },
  });
  await input.save();
}

function clearedPluginSubmissions(
  state: PluginState,
  pluginId: string,
): PluginState["pluginSubmissions"] {
  const submission = state.pluginSubmissions[pluginId];
  if (submission?.lastError === undefined) return state.pluginSubmissions;
  const { lastError: discardedLastError, ...cleanSubmission } = submission;
  void discardedLastError;
  return {
    ...state.pluginSubmissions,
    [pluginId]: cleanSubmission,
  };
}


async function loadPublishedCatalogForSynchronization(
  transport: ObsidianHttpTransport,
  catalogs: readonly PluginUiCatalog[],
  targetLocale: TargetLocale,
): Promise<Awaited<ReturnType<typeof loadPublishedEcosystemCatalog>>> {
  if (catalogs.length === 0) return undefined;
  try {
    return await loadPublishedEcosystemCatalog(
      transport,
      catalogs.map((catalog) => ({
        pluginId: catalog.pluginId,
        pluginVersion: catalog.pluginVersion,
      })),
      targetLocale,
    );
  } catch (error) {
    if (!isTemporaryPublishedCatalogError(error)) throw error;
    console.warn("[Trans-Hub] 权威公共目录暂不可用，保留已有译文并标记同步失败：", error);
    return { objects: [], failedPluginIds: catalogs.map((catalog) => catalog.pluginId) };
  }
}

function isTemporaryPublishedCatalogError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /^读取 Obsidian 公共目录失败：HTTP (?:408|429|5\d\d)$/u.test(error.message);
}


function isGlobalSynchronizationError(error: unknown): boolean {
  if (!isDiagnosticError(error)) return false;
  if ([401, 403, 429].includes(error.diagnostic.status ?? 0)) return true;
  return [
    "PC_CONFIGURATION",
    "PC_CREDENTIAL_AUDIENCE",
    "PC_EXPIRED",
    "PC_INSTALLATION_REQUIRED",
    "PC_STORAGE",
  ].includes(error.code);
}

function synchronizationErrorCode(error: unknown): string {
  if (error instanceof Error && error.message === "此插件的译文目录读取失败，请稍后重试。") return "public_catalog_unavailable";
  return isDiagnosticError(error) ? error.code : "plugin_sync_failed";
}

function synchronizationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const protocolDiagnostic = protocolDiagnosticSuffix(error);
  return `${message}${protocolDiagnostic}`.replace(/[\r\n]+/gu, " ").slice(0, 240);
}

function isDiagnosticError(error: unknown): error is Error & {
  readonly code: string;
  readonly diagnostic: {
    readonly status?: number;
    readonly operation?: string;
    readonly protocolCode?: string;
    readonly detail?: string;
  };
} {
  if (!(error instanceof Error)) return false;
  const value = error as Partial<{
    code: string;
    diagnostic: { status?: number };
  }>;
  return typeof value.code === "string"
    && typeof value.diagnostic === "object"
    && value.diagnostic !== null;
}

function protocolDiagnosticSuffix(error: unknown): string {
  if (!isDiagnosticError(error) || error.code !== "PC_PROTOCOL_REJECTED") return "";
  const diagnostic = error.diagnostic;
  const parts = [
    protocolDiagnosticValue("operation", diagnostic.operation, /^[a-z][a-z-]{0,80}$/u),
    protocolDiagnosticValue("protocol", diagnostic.protocolCode, /^CP_[A-Z_]{3,80}$/u),
    protocolDiagnosticValue("path", diagnostic.detail, /^\$(?:\.[A-Za-z][A-Za-z0-9_]*|\[[0-9]+\])*$/u),
  ].filter((value): value is string => value !== null);
  return parts.length === 0 ? "" : ` [${parts.join("; ")}]`;
}

function protocolDiagnosticValue(
  label: string,
  value: string | undefined,
  pattern: RegExp,
): string | null {
  return value !== undefined && pattern.test(value) ? `${label}=${value}` : null;
}

export function isPublishedExportPending(error: unknown): boolean {
  return error instanceof Error && (
    error.message === "translation_manifest_failed:404"
    || error.message === "translation_manifest_unavailable:404"
    || error.message === "translation_manifest_unavailable:410"
    || error.message === "Published export not found：HTTP 404"
  );
}

function isPublishedExportWithdrawn(error: unknown): boolean {
  return error instanceof Error && error.message === "translation_manifest_unavailable:410";
}

function isLocalHttp(value: string): boolean {
  return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(value);
}
