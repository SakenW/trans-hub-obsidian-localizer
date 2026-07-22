import type { ContributionStateReceipt, LocalizationDemandState } from "@trans-hub/client-protocol";
import type { ScopeAwarePackStore } from "@trans-hub/translation-export-client";

import type { ActivationStore } from "./activation";
import { ObsidianHttpTransport } from "./http-transport";
import { mergePublishedPluginTranslation } from "./plugin-catalog-diff";
import { resolvePluginDemandStatus } from "./plugin-demand-status";
import { resolveCommunityPluginIdentity } from "./plugin-registry";
import {
  loadPublishedEcosystemCatalog,
  resolvePublishedPluginSourceFromCatalog,
  type PublishedPluginSource,
} from "./plugin-source-resolution";
import {
  placeholderSignature,
  resolvePluginStringScopes,
  type PluginUiCatalog,
} from "./plugin-string-scanner";
import type { PluginState, PluginSubmissionState, PluginTranslationState } from "./plugin-state";
import type { PluginUiTranslation } from "./plugin-ui-runtime";
import {
  OBSIDIAN_PUBLIC_PROFILE,
  submitObsidianLocalizationObservation,
  submitObsidianPluginDiscovery,
} from "./submission";
import { downloadPluginTranslations } from "./translation-sync";

export interface PluginSyncSummary {
  readonly submittedCount: number;
  readonly requestedCount: number;
  readonly pulledCount: number;
  readonly waitingCount: number;
  readonly translationCount: number;
  readonly waitingPluginIds?: readonly string[];
  readonly failedPluginIds?: readonly string[];
  readonly nextRetryAfterMs?: number;
  readonly demandStateCounts?: Readonly<Partial<Record<LocalizationDemandState, number>>>;
}

export async function synchronizeConfiguredPluginTranslations(input: {
  readonly apiBaseUrl: string;
  readonly targetLocale: string;
  readonly excludedPluginIds: readonly string[];
  readonly onlyPluginIds?: readonly string[];
  readonly activationStore: ActivationStore;
  readonly translationPackStore: ScopeAwarePackStore;
  readonly getState: () => PluginState;
  readonly replaceState: (state: PluginState) => void;
  readonly save: () => Promise<void>;
}): Promise<PluginSyncSummary> {
  const { client, bootstrap, authorityWorkspaceId } = await input.activationStore.client({
    apiBaseUrl: input.apiBaseUrl,
  });
  const excluded = new Set(input.excludedPluginIds);
  const only = input.onlyPluginIds === undefined ? null : new Set(input.onlyPluginIds);
  const transport = new ObsidianHttpTransport(input.apiBaseUrl);
  const publishedCatalog = await loadPublishedEcosystemCatalog(transport);
  let submittedCount = 0;
  let requestedCount = 0;
  let pulledCount = 0;
  let waitingCount = 0;
  let translationCount = 0;
  const waitingPluginIds: string[] = [];
  const failedPluginIds: string[] = [];
  const demandStateCounts: Partial<Record<LocalizationDemandState, number>> = {};
  let nextRetryAfterMs: number | undefined;
  for (const catalog of Object.values(input.getState().pluginCatalogs)) {
    if (excluded.has(catalog.pluginId) || (only !== null && !only.has(catalog.pluginId))) continue;
    try {
      const savedSubmission = input.getState().pluginSubmissions[catalog.pluginId];
      const profileChanged = savedSubmission !== undefined
        && savedSubmission.adapterProfileDigest !== OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex;
      const published = profileChanged
        ? undefined
        : publishedCatalog === undefined
          ? undefined
          : resolvePublishedPluginSourceFromCatalog(publishedCatalog, {
              pluginId: catalog.pluginId,
              pluginVersion: catalog.pluginVersion,
              targetLocale: input.targetLocale,
              localCatalogIdentity: catalog.catalogIdentity,
            });
      if (published !== undefined) {
        const sourceVersionId = published.sourceVersionId;
        const existingSubmission = input.getState().pluginSubmissions[catalog.pluginId];
        if (
          existingSubmission !== undefined
          && existingSubmission.sourceVersionId !== sourceVersionId
        ) {
          await saveSubmission(input, { ...existingSubmission, sourceVersionId });
        }
        try {
          const count = await pullPluginTranslation({
            input,
            transport,
            catalog,
            published,
            accessToken: bootstrap.intakeCredential.value,
            authorityWorkspaceId,
            upstreamNativeCount: published.upstreamNativeCount,
          });
          pulledCount += 1;
          translationCount += count;
        } catch (error) {
          if (!isPublishedExportPending(error)) throw error;
          await saveNativeCoverage(
            input,
            catalog,
            published,
            published.upstreamNativeCount,
          );
          const catalogUnitCount = new Set(catalog.strings.map((item) => item.source)).size;
          if (published.upstreamNativeCount >= catalogUnitCount) {
            pulledCount += 1;
          } else {
            waitingCount += 1;
            waitingPluginIds.push(catalog.pluginId);
          }
        }
        continue;
      }
      const identity = await resolveCommunityPluginIdentity(
        catalog.pluginId,
        catalog.pluginVersion,
      );
      let submission = input.getState().pluginSubmissions[catalog.pluginId];
      if (
        submission?.installationId !== bootstrap.installationId
        || submission.catalogDigest !== catalog.digest
        || submission.pluginVersion !== catalog.pluginVersion
        || submission.adapterProfileDigest !== OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex
      ) {
        const receipt = await submitObsidianPluginDiscovery({
          client,
          installationId: bootstrap.installationId,
          catalog,
          repository: identity.repository,
          candidateLocators: identity.candidateLocators,
        });
        submission = submissionFromReceipt(
          catalog,
          identity.repository,
          bootstrap.installationId,
          receipt,
        );
        await saveSubmission(input, submission);
        submittedCount += 1;
      } else {
        const receipt = await client.getContributionStatus(submission.contributionId);
        submission = {
          ...submission,
          contributionState: receipt.state,
        };
        await saveSubmission(input, submission);
      }
      if (
        submission.localizationTargetLocale !== input.targetLocale
        || submission.localizationContributionId === undefined
      ) {
        const receipt = await submitObsidianLocalizationObservation({
          client,
          installationId: bootstrap.installationId,
          catalog,
          repository: identity.repository,
          targetLocale: input.targetLocale,
        });
        submission = {
          ...submission,
          repository: identity.repository,
          localizationTargetLocale: input.targetLocale,
          localizationContributionId: receipt.contributionId,
          localizationContributionState: receipt.state,
        };
        await saveSubmission(input, submission);
        requestedCount += 1;
      } else {
        const status = await client.getLocalizationDemandStatus(
          submission.localizationContributionId,
        );
        const demand = resolvePluginDemandStatus(status, input.targetLocale);
        incrementDemandState(demandStateCounts, demand.coordinate.state);
        submission = {
          ...submission,
          localizationContributionState: status.state,
          localizationDemandStatus: demand.snapshot,
          ...(demand.coordinate.sourceVersionId === null
            ? {}
            : { sourceVersionId: demand.coordinate.sourceVersionId }),
        };
        await saveSubmission(input, submission);
        const demandPublished = publishedCatalog === undefined
          ? undefined
          : resolvePublishedPluginSourceFromCatalog(publishedCatalog, {
              pluginId: catalog.pluginId,
              pluginVersion: catalog.pluginVersion,
              targetLocale: input.targetLocale,
              localCatalogIdentity: catalog.catalogIdentity,
            });
        if (demand.disposition === "native") {
          if (demand.coordinate.sourceVersionId === null) {
            throw new Error("插件自带语言状态缺少来源版本。");
          }
          if (demandPublished?.sourceVersionId !== demand.coordinate.sourceVersionId) {
            waitingCount += 1;
            waitingPluginIds.push(catalog.pluginId);
            continue;
          }
          await saveNativeCoverage(
            input,
            catalog,
            demandPublished,
            demand.coordinate.nativeUnitCount,
          );
          pulledCount += 1;
          continue;
        }
        if (demand.disposition === "ready") {
          if (demand.coordinate.sourceVersionId === null) {
            throw new Error("已发布译文状态缺少来源版本。");
          }
          if (demandPublished?.sourceVersionId !== demand.coordinate.sourceVersionId) {
            waitingCount += 1;
            waitingPluginIds.push(catalog.pluginId);
            continue;
          }
          try {
            const count = await pullPluginTranslation({
              input,
              transport,
              catalog,
              published: demandPublished,
              accessToken: bootstrap.intakeCredential.value,
              authorityWorkspaceId,
              upstreamNativeCount: demand.coordinate.nativeUnitCount,
            });
            pulledCount += 1;
            translationCount += count;
            continue;
          } catch (error) {
            if (!isPublishedExportPending(error)) throw error;
          }
        }
        if (demand.disposition === "failed") {
          await clearPluginDelivery(
            input,
            catalog.pluginId,
            demand.coordinate.sourceVersionId ?? submission.sourceVersionId,
          );
          failedPluginIds.push(catalog.pluginId);
          continue;
        }
        nextRetryAfterMs = mergeRetryAfter(nextRetryAfterMs, demand.retryAfterMs);
      }
      waitingCount += 1;
      waitingPluginIds.push(catalog.pluginId);
    } catch (error) {
      if (isGlobalSynchronizationError(error)) throw error;
      failedPluginIds.push(catalog.pluginId);
      await saveSynchronizationError(input, catalog.pluginId, error);
    }
  }
  return {
    submittedCount,
    requestedCount,
    pulledCount,
    waitingCount,
    translationCount,
    waitingPluginIds,
    failedPluginIds,
    ...(nextRetryAfterMs === undefined ? {} : { nextRetryAfterMs }),
    demandStateCounts,
  };
}

async function pullPluginTranslation(input: {
  readonly input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0];
  readonly transport: ObsidianHttpTransport;
  readonly catalog: PluginUiCatalog;
  readonly published: PublishedPluginSource;
  readonly accessToken: string;
  readonly authorityWorkspaceId: string;
  readonly upstreamNativeCount?: number;
}): Promise<number> {
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
    ...(isLocalHttp(input.input.apiBaseUrl)
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
    })),
    input.published.sourceVersionId,
    input.input.targetLocale,
    input.upstreamNativeCount,
    input.published,
  );
  const state = input.input.getState();
  const dictionary = mergePublishedPluginTranslation(
    input.catalog,
    downloaded,
    state.pluginTranslations[input.catalog.pluginId],
  );
  input.input.replaceState({
    ...state,
    pluginTranslations: {
      ...state.pluginTranslations,
      [input.catalog.pluginId]: dictionary,
    },
    translationExportStates: {
      ...state.translationExportStates,
      [exportStateKey]: { etag: output.etag, manifest: output.manifest },
    },
  });
  await input.input.save();
  return dictionary.entries.length;
}

async function saveNativeCoverage(
  input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0],
  catalog: PluginUiCatalog,
  published: PublishedPluginSource,
  upstreamNativeCount = 0,
): Promise<void> {
  const state = input.getState();
  const exportStateKey = translationExportStateKey(published.sourceVersionId, input.targetLocale);
  const { [exportStateKey]: discardedExportState, ...remainingExportStates } =
    state.translationExportStates;
  void discardedExportState;
  input.replaceState({
    ...state,
    pluginTranslations: {
      ...state.pluginTranslations,
      [catalog.pluginId]: {
        pluginId: catalog.pluginId,
        pluginVersion: catalog.pluginVersion,
        sourceVersionId: published.sourceVersionId,
        artifactDigest: published.artifactDigest,
        ...(published.sourceSnapshotDigest === undefined
          ? {}
          : { sourceSnapshotDigest: published.sourceSnapshotDigest }),
        ...(published.catalogIdentity === undefined
          ? {}
          : { catalogIdentity: published.catalogIdentity }),
        targetLocale: input.targetLocale,
        upstreamNativeCount,
        entries: [],
        pulledAt: new Date().toISOString(),
      },
    },
    translationExportStates: remainingExportStates,
  });
  await input.save();
}

async function clearPluginDelivery(
  input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0],
  pluginId: string,
  sourceVersionId: string | undefined,
): Promise<void> {
  const state = input.getState();
  const { [pluginId]: discardedTranslation, ...remainingTranslations } =
    state.pluginTranslations;
  void discardedTranslation;
  const exportStateKey = sourceVersionId === undefined
    ? undefined
    : translationExportStateKey(sourceVersionId, input.targetLocale);
  const remainingExportStates = Object.fromEntries(
    Object.entries(state.translationExportStates).filter(([key]) =>
      exportStateKey === undefined || key !== exportStateKey
    ),
  );
  input.replaceState({
    ...state,
    pluginTranslations: remainingTranslations,
    translationExportStates: remainingExportStates,
  });
  await input.save();
}

function submissionFromReceipt(
  catalog: PluginUiCatalog,
  repository: string,
  installationId: string,
  receipt: ContributionStateReceipt<"source_discovery">,
): PluginSubmissionState {
  return {
    pluginId: catalog.pluginId,
    pluginVersion: catalog.pluginVersion,
    catalogDigest: catalog.digest,
    adapterProfileDigest: OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex,
    installationId,
    contributionId: receipt.contributionId,
    contributionState: receipt.state,
    repository,
    submittedAt: receipt.recordedAt,
  };
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
  input: Pick<Parameters<typeof synchronizeConfiguredPluginTranslations>[0], "getState" | "replaceState" | "save">,
  pluginId: string,
  error: unknown,
): Promise<void> {
  const state = input.getState();
  const submission = state.pluginSubmissions[pluginId];
  if (submission === undefined) return;
  input.replaceState({
    ...state,
    pluginSubmissions: {
      ...state.pluginSubmissions,
      [pluginId]: {
        ...submission,
        lastError: {
          code: synchronizationErrorCode(error),
          message: synchronizationErrorMessage(error),
          updatedAt: new Date().toISOString(),
        },
      },
    },
  });
  await input.save();
}

function incrementDemandState(
  counts: Partial<Record<LocalizationDemandState, number>>,
  state: LocalizationDemandState,
): void {
  counts[state] = (counts[state] ?? 0) + 1;
}

function mergeRetryAfter(current: number | undefined, next: number): number {
  if (!Number.isFinite(next) || next <= 0) return current ?? 5_000;
  return current === undefined ? next : Math.max(current, next);
}

function isGlobalSynchronizationError(error: unknown): boolean {
  if (!isDiagnosticError(error)) return false;
  if (error.diagnostic.status === 401 || error.diagnostic.status === 403) return true;
  return [
    "PC_CONFIGURATION",
    "PC_CREDENTIAL_AUDIENCE",
    "PC_EXPIRED",
    "PC_INSTALLATION_REQUIRED",
    "PC_STORAGE",
  ].includes(error.code);
}

function synchronizationErrorCode(error: unknown): string {
  return isDiagnosticError(error) ? error.code : "plugin_sync_failed";
}

function synchronizationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 240);
}

function isDiagnosticError(error: unknown): error is Error & {
  readonly code: string;
  readonly diagnostic: { readonly status?: number };
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

export function validatePluginTranslations(
  catalog: PluginUiCatalog,
  rows: readonly {
    readonly stringKey: string;
    readonly translatedText: string;
    readonly provenanceKind?: PluginUiTranslation["provenanceKind"];
    readonly application?: PluginUiTranslation["application"];
    readonly nativeTarget?: string;
  }[],
  sourceVersionId: string,
  targetLocale: string,
  upstreamNativeCount = 0,
  published?: PublishedPluginSource,
): PluginTranslationState {
  const sourceByKey = new Map(catalog.strings.map((item) => [item.key, item]));
  const matchingRows = rows.filter((row) => sourceByKey.has(row.stringKey));
  if (rows.length > 0 && matchingRows.length === 0) {
    throw new Error(`插件译文与本地扫描结果没有安全交集：${catalog.pluginId}`);
  }
  const entries = matchingRows.map((row) => {
    const source = sourceByKey.get(row.stringKey);
    if (source === undefined) throw new Error(`插件译文 string key 无法解析：${row.stringKey}`);
    const target = row.translatedText.normalize("NFC").trim();
    if (target === "") throw new Error(`插件译文为空：${row.stringKey}`);
    if (placeholderSignature(target) !== source.placeholderSignature) {
      throw new Error(`插件译文占位符不匹配：${catalog.pluginId}:${row.stringKey}`);
    }
    const nativeTarget = row.nativeTarget?.normalize("NFC").trim();
    if (row.application === "correction") {
      if (row.provenanceKind !== "th-reviewed-correction" || nativeTarget === undefined || nativeTarget === "") {
        throw new Error(`插件校订缺少已审核的原生目标：${catalog.pluginId}:${row.stringKey}`);
      }
      if (placeholderSignature(nativeTarget) !== source.placeholderSignature) {
        throw new Error(`插件原生目标占位符不匹配：${catalog.pluginId}:${row.stringKey}`);
      }
    }
    return {
      pluginId: catalog.pluginId,
      source: source.source,
      target,
      scopes: resolvePluginStringScopes(source.origins),
      ...(row.provenanceKind === undefined ? {} : { provenanceKind: row.provenanceKind }),
      ...(row.application === undefined ? {} : { application: row.application }),
      ...(nativeTarget === undefined ? {} : { nativeTarget }),
    };
  });
  return {
    pluginId: catalog.pluginId,
    pluginVersion: catalog.pluginVersion,
    sourceVersionId,
    ...(published?.sourceSnapshotDigest === undefined
      ? {}
      : { sourceSnapshotDigest: published.sourceSnapshotDigest }),
    ...(published?.artifactDigest === undefined
      ? {}
      : { artifactDigest: published.artifactDigest }),
    ...(published?.catalogIdentity === undefined
      ? {}
      : { catalogIdentity: published.catalogIdentity }),
    targetLocale,
    upstreamNativeCount,
    entries,
    pulledAt: new Date().toISOString(),
  };
}

export function isPublishedExportPending(error: unknown): boolean {
  return error instanceof Error && (
    error.message === "translation_manifest_failed:404"
    || error.message === "translation_manifest_unavailable:404"
    || error.message === "translation_manifest_unavailable:410"
    || error.message === "Published export not found：HTTP 404"
  );
}

function translationExportStateKey(sourceVersionId: string, targetLocale: string): string {
  return `${encodeURIComponent(sourceVersionId)}:${encodeURIComponent(targetLocale)}:default`;
}

function isLocalHttp(value: string): boolean {
  return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(value);
}
