import type { ContributionStateReceipt, LocalizationDemandState } from "@trans-hub/client-protocol";
import type { ScopeAwarePackStore } from "@trans-hub/translation-export-client";

import type { ActivationStore } from "./activation";
import { ObsidianHttpTransport } from "./http-transport";
import { mergePublishedPluginTranslation } from "./plugin-catalog-diff";
import {
  isUnprocessableMachineTranslationFailure,
  resolvePluginDemandStatus,
} from "./plugin-demand-status";
import {
  isCommunityPluginNotFoundError,
  resolveCommunityPluginIdentity,
} from "./plugin-registry";
import {
  loadPublishedEcosystemCatalog,
  normalizeGitHubRepository,
  resolvePublishedPluginArtifactDigestFromCatalog,
  resolvePublishedPluginSourceFromCatalog,
  type PublishedPluginSource,
} from "./plugin-source-resolution";
import {
  placeholderSignature,
  resolvePluginStringScopes,
  type PluginUiCatalog,
} from "./plugin-string-scanner";
import {
  deletePluginTranslation,
  getPluginTranslation,
  setPluginTranslation,
  type PluginState,
  type PluginSubmissionState,
  type PluginTranslationState,
} from "./plugin-state";
import { visiblePluginManualRetryKind } from "./plugin-localization-status";
import type { PluginUiTranslation } from "./plugin-ui-runtime";
import type { TargetLocale } from "./product-config";
import {
  OBSIDIAN_PUBLIC_PROFILE,
  submitObsidianLocalizationObservation,
  submitObsidianPluginDiscovery,
} from "./submission";
import { downloadPluginTranslations } from "./translation-sync";
import { refreshPluginStatusFromBatch } from "./plugin-status-refresh";

export interface PluginSyncSummary {
  readonly submittedCount: number;
  readonly requestedCount: number;
  readonly pulledCount: number;
  readonly waitingCount: number;
  /**
   * Machine translation is complete and the server is building its public
   * distribution package. These items remain in the automatic polling loop.
   */
  readonly exportPendingCount?: number;
  readonly translationCount: number;
  readonly waitingPluginIds?: readonly string[];
  readonly exportPendingPluginIds?: readonly string[];
  readonly failedPluginIds?: readonly string[];
  readonly nextRetryAfterMs?: number;
  readonly demandStateCounts?: Readonly<Partial<Record<LocalizationDemandState, number>>>;
  readonly authorityRefreshingCount?: number;
}

const MAX_AUTOMATIC_SOURCE_RESUBMISSIONS = 1;
const SOURCE_ARTIFACT_MISMATCH_CODE = "source_artifact_mismatch";

class SourceArtifactMismatchError extends Error {
  readonly code = SOURCE_ARTIFACT_MISMATCH_CODE;

  constructor() {
    super("本地安装与权威目录的精确制品不一致，已暂停同步。");
    this.name = "SourceArtifactMismatchError";
  }
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
  const publishedCatalog = await loadPublishedCatalogForSynchronization(
    transport,
    catalogs,
    input.targetLocale,
  );
  let submittedCount = 0;
  let requestedCount = 0;
  let pulledCount = 0;
  let waitingCount = 0;
  let exportPendingCount = 0;
  let translationCount = 0;
  const waitingPluginIds: string[] = [];
  const exportPendingPluginIds: string[] = [];
  const failedPluginIds: string[] = [];
  const demandStateCounts: Partial<Record<LocalizationDemandState, number>> = {};
  let authorityRefreshingCount = 0;
  let nextRetryAfterMs: number | undefined;
  for (const catalog of catalogs) {
    try {
      const published = publishedCatalog === undefined
        ? undefined
        : resolvePublishedPluginSourceFromCatalog(publishedCatalog, {
            pluginId: catalog.pluginId,
            pluginVersion: catalog.pluginVersion,
            targetLocale: input.targetLocale,
            localCatalogIdentity: catalog.catalogIdentity,
          });
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
      let publishedDeliverySynchronized = false;
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
        let deliveryWaiting = false;
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
          publishedDeliverySynchronized = true;
        } catch (error) {
          if (!isPublishedExportPending(error)) throw error;
          await saveNativeCoverage(
            input,
            catalog,
            published,
            published.upstreamNativeCount,
          );
          publishedDeliverySynchronized = true;
          const catalogUnitCount = new Set(catalog.strings.map((item) => item.source)).size;
          if (published.upstreamNativeCount >= catalogUnitCount) {
            pulledCount += 1;
          } else {
            deliveryWaiting = true;
          }
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
              submissionForCompletedAuthoritativeSource(existingSubmission, sourceVersionId),
            );
          }
          continue;
        }
      }
      if (published === undefined && localArtifactVariant && !manualResubmit.has(catalog.pluginId)) {
        // A manual resubmit may still submit the discovery observation: the
        // authoritative digest can be stale server-side (an object version
        // acquired before the bundle-normalization change), and the server
        // reconciles it by re-acquiring the upstream artifact.  Without this
        // escape hatch the client would stay paused forever and could never
        // trigger the one-time authority recovery observation.
        await saveSynchronizationError(
          input,
          catalog,
          bootstrap.installationId,
          new SourceArtifactMismatchError(),
        );
        continue;
      }
      let identity: Pick<
        Awaited<ReturnType<typeof resolveCommunityPluginIdentity>>,
        "repository" | "candidateLocators"
      >;
      if (published !== undefined && published.repository !== undefined) {
        identity = { repository: published.repository, candidateLocators: [] };
      } else {
        try {
          identity = await resolveCommunityPluginIdentity(
            catalog.pluginId,
            catalog.pluginVersion,
          );
        } catch (error) {
          if (published?.catalogIdentityExact === true && isCommunityPluginNotFoundError(error)) {
            const repository = trustedStoredRepository(
              input.getState().pluginSubmissions[catalog.pluginId],
              catalog,
              published.sourceVersionId,
            );
            if (repository === undefined) {
              throw new Error("权威来源缺少可信 GitHub 仓库定位，无法建立本地化需求。");
            }
            identity = { repository, candidateLocators: [] };
          } else if (published !== undefined && isCommunityPluginNotFoundError(error)) {
            continue;
          } else {
            throw error;
          }
        }
      }
      const manuallyResubmit = manualResubmit.has(catalog.pluginId);
      let submission = input.getState().pluginSubmissions[catalog.pluginId];
      if (published !== undefined) {
        if (
          submission !== undefined
          && submission.registryPolicyRevision
            !== OBSIDIAN_PUBLIC_PROFILE.registryPolicyRevision
        ) {
          await submitObsidianPluginDiscovery({
            client,
            installationId: bootstrap.installationId,
            catalog,
            repository: identity.repository,
            candidateLocators: identity.candidateLocators,
          });
          submittedCount += 1;
        }
        submission = authoritativeLocalizationSubmission({
          catalog,
          existing: submission,
          installationId: bootstrap.installationId,
          manuallyResubmit,
          repository: identity.repository,
          sourceVersionId: published.sourceVersionId,
          targetLocale: input.targetLocale,
        });
        await saveSubmission(input, submission);
      } else if (
        submission?.installationId !== bootstrap.installationId
        || submission.catalogDigest !== catalog.digest
        || submission.pluginVersion !== catalog.pluginVersion
        || submission.adapterProfileDigest !== OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex
        || submission.registryPolicyRevision !== OBSIDIAN_PUBLIC_PROFILE.registryPolicyRevision
        || submission.sourceDiscoveryEpoch !== OBSIDIAN_PUBLIC_PROFILE.sourceDiscoveryEpoch
        || submission.contributionId === undefined
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
        if (submission.contributionId === undefined) {
          throw new Error("来源贡献状态缺少贡献 ID。");
        }
        const receipt = await client.getContributionStatus(submission.contributionId);
        const observationGeneration = submission.observationGeneration ?? 0;
        if (
          receipt.state === "rejected"
          && (
            manuallyResubmit
            || observationGeneration < MAX_AUTOMATIC_SOURCE_RESUBMISSIONS
          )
        ) {
          const nextGeneration = observationGeneration + 1;
          const retryReceipt = await submitObsidianPluginDiscovery({
            client,
            installationId: bootstrap.installationId,
            catalog,
            repository: identity.repository,
            candidateLocators: identity.candidateLocators,
            observationGeneration: nextGeneration,
          });
          submission = submissionFromReceipt(
            catalog,
            identity.repository,
            bootstrap.installationId,
            retryReceipt,
            nextGeneration,
          );
          submittedCount += 1;
        } else {
          submission = manuallyResubmit
            ? prepareManualLocalizationResubmission(
                submission,
                receipt.state,
                observationGeneration + 1,
              )
            : {
                ...submission,
                contributionState: receipt.state,
              };
        }
        await saveSubmission(input, submission);
        if (
          submission.contributionState === "rejected"
          && (submission.observationGeneration ?? 0)
            >= MAX_AUTOMATIC_SOURCE_RESUBMISSIONS
        ) {
          failedPluginIds.push(catalog.pluginId);
          continue;
        }
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
          observationGeneration: submission.observationGeneration,
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
        if (
          demand.disposition === "waiting"
          && demand.coordinate.failureCode === "PublicDistributionAuthorityRefreshing"
        ) {
          authorityRefreshingCount += 1;
        } else {
          incrementDemandState(demandStateCounts, demand.coordinate.state);
        }
        submission = {
          ...submission,
          localizationContributionState: status.state,
          localizationDemandStatus: demand.snapshot,
          ...(demand.coordinate.sourceVersionId === null
            ? {}
            : { sourceVersionId: demand.coordinate.sourceVersionId }),
        };
        await saveSubmission(input, submission);
        const requestsAuthorityRecoveryObservation = manuallyResubmit
          && demand.coordinate.state === "distribution_blocked"
          && demand.coordinate.failureCode === "PublicDistributionAuthorityRetryExhausted"
          && demand.coordinate.sourceVersionId !== null
          && demand.coordinate.sourceVersionId === submission.sourceVersionId;
        if (requestsAuthorityRecoveryObservation) {
          const receipt = await submitObsidianLocalizationObservation({
            client,
            installationId: bootstrap.installationId,
            catalog,
            repository: identity.repository,
            targetLocale: input.targetLocale,
            observationGeneration: submission.observationGeneration,
          });
          submission = {
            ...submission,
            localizationContributionId: receipt.contributionId,
            localizationContributionState: receipt.state,
          };
          await saveSubmission(input, submission);
          requestedCount += 1;
          waitingCount += 1;
          waitingPluginIds.push(catalog.pluginId);
          continue;
        }
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
          const failedSourceVersionId = demand.coordinate.sourceVersionId
            ?? submission.sourceVersionId;
          const partialPublishedDelivery = demandPublished !== undefined
            && demandPublished.sourceVersionId === failedSourceVersionId
            && Math.min(
              demandPublished.sourceUnitCount,
              demandPublished.upstreamNativeCount + demandPublished.publishedUnitCount,
            ) > 0;
          if (partialPublishedDelivery) {
            if (!publishedDeliverySynchronized) {
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
              } catch (error) {
                if (!isPublishedExportPending(error)) throw error;
                await saveNativeCoverage(
                  input,
                  catalog,
                  demandPublished,
                  demand.coordinate.nativeUnitCount,
                );
                pulledCount += 1;
              }
            }
          } else {
            await clearPluginDelivery(
              input,
              catalog.pluginId,
              failedSourceVersionId,
            );
          }
          if (!isUnprocessableMachineTranslationFailure(demand.coordinate.failureCode)) {
            failedPluginIds.push(catalog.pluginId);
          }
          continue;
        }
        if (demand.disposition === "blocked") continue;
        if (demand.coordinate.state === "export_pending") {
          // The machine results are ready, but the server still needs to build
          // and publish the immutable public distribution package. Keep this
          // in the ordinary retry loop: no human review is required here.
          exportPendingCount += 1;
          exportPendingPluginIds.push(catalog.pluginId);
          nextRetryAfterMs = mergeRetryAfter(nextRetryAfterMs, demand.retryAfterMs);
          waitingCount += 1;
          waitingPluginIds.push(catalog.pluginId);
          continue;
        }
        nextRetryAfterMs = mergeRetryAfter(nextRetryAfterMs, demand.retryAfterMs);
      }
      waitingCount += 1;
      waitingPluginIds.push(catalog.pluginId);
    } catch (error) {
      if (isGlobalSynchronizationError(error)) throw error;
      failedPluginIds.push(catalog.pluginId);
      await saveSynchronizationError(input, catalog, bootstrap.installationId, error);
    }
  }
  return {
    submittedCount,
    requestedCount,
    pulledCount,
    waitingCount,
    ...(exportPendingCount === 0 ? {} : { exportPendingCount }),
    translationCount,
    waitingPluginIds,
    ...(exportPendingPluginIds.length === 0 ? {} : { exportPendingPluginIds }),
    failedPluginIds: retryableFailedPluginIds(
      input,
      failedPluginIds,
      sourceSelectablePluginIds,
    ),
    ...(nextRetryAfterMs === undefined ? {} : { nextRetryAfterMs }),
    demandStateCounts,
    ...(authorityRefreshingCount === 0 ? {} : { authorityRefreshingCount }),
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

function trustedStoredRepository(
  submission: PluginSubmissionState | undefined,
  catalog: PluginUiCatalog,
  sourceVersionId: string,
): string | undefined {
  if (
    submission === undefined
    || submission.pluginId !== catalog.pluginId
    || submission.pluginVersion !== catalog.pluginVersion
    || submission.catalogDigest !== catalog.digest
    || submission.sourceVersionId !== sourceVersionId
    || !(
      submission.sourceAuthority === "published"
      || submission.contributionId !== undefined
        && submission.contributionState === "source_attested"
    )
    || submission.repository === undefined
  ) return undefined;
  return normalizeGitHubRepository(submission.repository);
}

function submissionForCompletedAuthoritativeSource(
  submission: PluginSubmissionState,
  sourceVersionId: string,
): PluginSubmissionState {
  const {
    localizationTargetLocale: discardedTargetLocale,
    localizationContributionId: discardedContributionId,
    localizationContributionState: discardedContributionState,
    localizationDemandStatus: discardedDemandStatus,
    ...sourceSubmission
  } = submission;
  void discardedTargetLocale;
  void discardedContributionId;
  void discardedContributionState;
  void discardedDemandStatus;
  return { ...sourceSubmission, sourceVersionId };
}

function authoritativeLocalizationSubmission(input: {
  readonly catalog: PluginUiCatalog;
  readonly existing: PluginSubmissionState | undefined;
  readonly installationId: string;
  readonly manuallyResubmit: boolean;
  readonly repository: string;
  readonly sourceVersionId: string;
  readonly targetLocale: string;
}): PluginSubmissionState {
  const { existing } = input;
  const sameObservationBase = existing !== undefined
    && existing.pluginId === input.catalog.pluginId
    && existing.pluginVersion === input.catalog.pluginVersion
    && existing.catalogDigest === input.catalog.digest
    && existing.adapterProfileDigest === OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex
    && existing.registryPolicyRevision === OBSIDIAN_PUBLIC_PROFILE.registryPolicyRevision
    && existing.sourceDiscoveryEpoch === OBSIDIAN_PUBLIC_PROFILE.sourceDiscoveryEpoch
    && existing.installationId === input.installationId
    && (existing.repository === undefined || existing.repository === input.repository);
  const sourceChanged = sameObservationBase
    && existing.sourceVersionId !== input.sourceVersionId;
  const observationGeneration = input.manuallyResubmit || sourceChanged
    ? (existing?.observationGeneration ?? 0) + 1
    : sameObservationBase
      ? existing.observationGeneration
      : undefined;
  const reuseLocalizationDemand = sameObservationBase
    && !input.manuallyResubmit
    && !sourceChanged
    && existing.localizationTargetLocale === input.targetLocale
    && existing.localizationContributionId !== undefined
    // A demand receipt is bound to its authoritative source version.  Do not
    // carry a cached terminal state into a newer authority observation merely
    // because the submission metadata itself was already updated.
    && (
      existing.localizationDemandStatus === undefined
      || existing.localizationDemandStatus.sourceVersionId === input.sourceVersionId
    );
  return {
    pluginId: input.catalog.pluginId,
    pluginVersion: input.catalog.pluginVersion,
    catalogDigest: input.catalog.digest,
    adapterProfileDigest: OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex,
    registryPolicyRevision: OBSIDIAN_PUBLIC_PROFILE.registryPolicyRevision,
    sourceDiscoveryEpoch: OBSIDIAN_PUBLIC_PROFILE.sourceDiscoveryEpoch,
    installationId: input.installationId,
    sourceAuthority: "published",
    contributionState: "source_attested",
    ...(observationGeneration === undefined ? {} : { observationGeneration }),
    repository: input.repository,
    ...(reuseLocalizationDemand
      ? {
          localizationTargetLocale: existing.localizationTargetLocale,
          localizationContributionId: existing.localizationContributionId,
          ...(existing.localizationContributionState === undefined
            ? {}
            : { localizationContributionState: existing.localizationContributionState }),
          ...(existing.localizationDemandStatus === undefined
            ? {}
            : { localizationDemandStatus: existing.localizationDemandStatus }),
        }
      : {}),
    sourceVersionId: input.sourceVersionId,
    submittedAt: sameObservationBase ? existing.submittedAt : input.catalog.scannedAt,
  };
}

function prepareManualLocalizationResubmission(
  submission: PluginSubmissionState,
  contributionState: string,
  observationGeneration: number,
): PluginSubmissionState {
  const {
    localizationTargetLocale: discardedTargetLocale,
    localizationContributionId: discardedContributionId,
    localizationContributionState: discardedContributionState,
    localizationDemandStatus: discardedDemandStatus,
    lastError: discardedLastError,
    ...sourceSubmission
  } = submission;
  void discardedTargetLocale;
  void discardedContributionId;
  void discardedContributionState;
  void discardedDemandStatus;
  void discardedLastError;
  return {
    ...sourceSubmission,
    contributionState,
    observationGeneration,
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
    getPluginTranslation(state, input.catalog.pluginId, input.input.targetLocale),
  );
  const nextState = setPluginTranslation({
    ...state,
    pluginSubmissions: clearedPluginSubmissions(state, input.catalog.pluginId),
    translationExportStates: {
      ...state.translationExportStates,
      [exportStateKey]: { etag: output.etag, manifest: output.manifest },
    },
  }, input.catalog.pluginId, input.input.targetLocale, dictionary);
  input.input.replaceState(nextState);
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
  const nextState = setPluginTranslation({
    ...state,
    pluginSubmissions: clearedPluginSubmissions(state, catalog.pluginId),
    translationExportStates: remainingExportStates,
  }, catalog.pluginId, input.targetLocale, {
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
    entries: [],
    pulledAt: new Date().toISOString(),
  });
  input.replaceState(nextState);
  await input.save();
}

async function clearPluginDelivery(
  input: Parameters<typeof synchronizeConfiguredPluginTranslations>[0],
  pluginId: string,
  sourceVersionId: string | undefined,
): Promise<void> {
  const state = input.getState();
  const stateWithoutTranslation = deletePluginTranslation(
    state,
    pluginId,
    input.targetLocale,
  );
  const exportStateKey = sourceVersionId === undefined
    ? undefined
    : translationExportStateKey(sourceVersionId, input.targetLocale);
  const remainingExportStates = Object.fromEntries(
    Object.entries(state.translationExportStates).filter(([key]) =>
      exportStateKey === undefined || key !== exportStateKey
    ),
  );
  input.replaceState({
    ...stateWithoutTranslation,
    translationExportStates: remainingExportStates,
  });
  await input.save();
}

function submissionFromReceipt(
  catalog: PluginUiCatalog,
  repository: string,
  installationId: string,
  receipt: ContributionStateReceipt<"source_discovery">,
  observationGeneration = 0,
): PluginSubmissionState {
  return {
    pluginId: catalog.pluginId,
    pluginVersion: catalog.pluginVersion,
    catalogDigest: catalog.digest,
    adapterProfileDigest: OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex,
    registryPolicyRevision: OBSIDIAN_PUBLIC_PROFILE.registryPolicyRevision,
    sourceDiscoveryEpoch: OBSIDIAN_PUBLIC_PROFILE.sourceDiscoveryEpoch,
    installationId,
    contributionId: receipt.contributionId,
    contributionState: receipt.state,
    ...(observationGeneration === 0 ? {} : { observationGeneration }),
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

function incrementDemandState(
  counts: Partial<Record<LocalizationDemandState, number>>,
  state: LocalizationDemandState,
): void {
  counts[state] = (counts[state] ?? 0) + 1;
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
    console.warn("[Trans-Hub] 权威公共目录暂不可用，改由服务器验证来源提交：", error);
    return undefined;
  }
}

function isTemporaryPublishedCatalogError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /^读取 Obsidian 公共目录失败：HTTP (?:408|429|5\d\d)$/u.test(error.message);
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
  if (error instanceof SourceArtifactMismatchError) return error.code;
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
  targetLocale: TargetLocale,
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
    ...(published === undefined ? {} : { sourceUnitCount: published.sourceUnitCount }),
    upstreamNativeCount,
    ...(published?.upstreamScopedNativeCount === undefined
      ? {}
      : { upstreamScopedNativeCount: published.upstreamScopedNativeCount }),
    ...(published?.upstreamScopeCoverage === undefined
      ? {}
      : { upstreamScopeCoverage: published.upstreamScopeCoverage }),
    ...(published === undefined ? {} : { publishedUnitCount: published.publishedUnitCount }),
    ...(published === undefined ? {} : { missingUnitCount: published.missingUnitCount }),
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

/**
 * R-028 / Phase 3: refresh the client status line with a single zero-write
 * batch read.  No observation, demand, job, retry or authority event is ever
 * submitted here.  Plugins without a mapped contribution are surfaced as
 * unknown (not "processing"), so the UI never misreads an absent item as
 * work in flight.
 */
export async function refreshConfiguredPluginStatuses(input: {
  readonly apiBaseUrl: string;
  readonly targetLocale: TargetLocale;
  readonly excludedPluginIds: readonly string[];
  readonly onlyPluginIds?: readonly string[];
  readonly activationStore: ActivationStore;
  readonly getState: () => PluginState;
}): Promise<PluginSyncSummary> {
  const { client } = await input.activationStore.client({
    apiBaseUrl: input.apiBaseUrl,
  });
  const excluded = new Set(input.excludedPluginIds);
  const only = input.onlyPluginIds === undefined ? null : new Set(input.onlyPluginIds);
  const contributionToPlugin = new Map<string, string>();
  for (const catalog of Object.values(input.getState().pluginCatalogs)) {
    if (excluded.has(catalog.pluginId) || (only !== null && !only.has(catalog.pluginId))) {
      continue;
    }
    const submission = input.getState().pluginSubmissions[catalog.pluginId];
    const contributionId = submission?.localizationContributionId;
    if (contributionId === undefined) {
      continue;
    }
    if (!contributionToPlugin.has(contributionId)) {
      contributionToPlugin.set(contributionId, catalog.pluginId);
    }
  }
  const contributionIds = [...contributionToPlugin.keys()];
  if (contributionIds.length === 0) {
    return {
      submittedCount: 0,
      requestedCount: 0,
      pulledCount: 0,
      translationCount: 0,
      waitingCount: 0,
    };
  }
  const batch = await client.getLocalizationDemandStatusBatch({ contributionIds });
  const summary = refreshPluginStatusFromBatch({
    batch: batch.items,
    contributionIdToPluginId: contributionToPlugin,
    targetLocale: input.targetLocale,
  });
  return summary;
}
