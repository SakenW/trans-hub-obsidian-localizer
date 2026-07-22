import type { ContributionStateReceipt } from "@trans-hub/client-protocol";

import type { ActivationStore } from "./activation";
import { ObsidianHttpTransport } from "./http-transport";
import { mergePublishedPluginTranslation } from "./plugin-catalog-diff";
import { resolveCommunityPluginIdentity } from "./plugin-registry";
import { resolvePublishedPluginSource } from "./plugin-source-resolution";
import { placeholderSignature, type PluginUiCatalog } from "./plugin-string-scanner";
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
}

export async function synchronizeConfiguredPluginTranslations(input: {
  readonly apiBaseUrl: string;
  readonly targetLocale: string;
  readonly excludedPluginIds: readonly string[];
  readonly onlyPluginIds?: readonly string[];
  readonly activationStore: ActivationStore;
  readonly getState: () => PluginState;
  readonly replaceState: (state: PluginState) => void;
  readonly save: () => Promise<void>;
}): Promise<PluginSyncSummary> {
  const { client, bootstrap, authorityWorkspaceId } = await input.activationStore.client({
    apiBaseUrl: input.apiBaseUrl,
  });
  const excluded = new Set(input.excludedPluginIds);
  const only = input.onlyPluginIds === undefined ? null : new Set(input.onlyPluginIds);
  let submittedCount = 0;
  let requestedCount = 0;
  let pulledCount = 0;
  let waitingCount = 0;
  let translationCount = 0;
  const waitingPluginIds: string[] = [];
  for (const catalog of Object.values(input.getState().pluginCatalogs)) {
    if (excluded.has(catalog.pluginId) || (only !== null && !only.has(catalog.pluginId))) continue;
    const savedSubmission = input.getState().pluginSubmissions[catalog.pluginId];
    const profileChanged = savedSubmission !== undefined
      && savedSubmission.adapterProfileDigest !== OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex;
    const published = profileChanged
      ? undefined
      : await resolvePublishedPluginSource({
          transport: new ObsidianHttpTransport(input.apiBaseUrl),
          pluginId: catalog.pluginId,
          pluginVersion: catalog.pluginVersion,
          targetLocale: input.targetLocale,
        });
    if (published !== undefined) {
      const sourceVersionId = published.sourceVersionId;
      const existingSubmission = input.getState().pluginSubmissions[catalog.pluginId];
      if (existingSubmission !== undefined && existingSubmission.sourceVersionId !== sourceVersionId) {
        await saveSubmission(input, { ...existingSubmission, sourceVersionId });
      }
      try {
        const output = await downloadPluginTranslations({
          transport: new ObsidianHttpTransport(input.apiBaseUrl),
          accessToken: bootstrap.intakeCredential.value,
          workspaceId: authorityWorkspaceId,
          sourceVersionId,
          targetLocale: input.targetLocale,
          expectedPluginId: catalog.pluginId,
          ...(isLocalHttp(input.apiBaseUrl) ? { developmentDownloadOrigin: input.apiBaseUrl } : {}),
        });
        const downloaded = validatePluginTranslations(catalog, output.rows.map((row) => ({
          stringKey: row.stringKey,
          translatedText: row.translatedText,
          ...(row.provenanceKind === undefined ? {} : { provenanceKind: row.provenanceKind }),
          ...(row.application === undefined ? {} : { application: row.application }),
          ...(row.nativeTarget === undefined ? {} : { nativeTarget: row.nativeTarget }),
        })), sourceVersionId, input.targetLocale, published.upstreamNativeCount);
        const state = input.getState();
        const dictionary = mergePublishedPluginTranslation(
          catalog,
          downloaded,
          state.pluginTranslations[catalog.pluginId],
        );
        input.replaceState({
          ...state,
          pluginTranslations: { ...state.pluginTranslations, [catalog.pluginId]: dictionary },
        });
        await input.save();
        pulledCount += 1;
        translationCount += dictionary.entries.length;
      } catch (error) {
        if (!isPublishedExportPending(error)) throw error;
        const state = input.getState();
        input.replaceState({
          ...state,
          pluginTranslations: {
            ...state.pluginTranslations,
            [catalog.pluginId]: {
              pluginId: catalog.pluginId,
              pluginVersion: catalog.pluginVersion,
              sourceVersionId,
              targetLocale: input.targetLocale,
              upstreamNativeCount: published.upstreamNativeCount,
              entries: [],
              pulledAt: new Date().toISOString(),
            },
          },
        });
        await input.save();
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
    const identity = await resolveCommunityPluginIdentity(catalog.pluginId, catalog.pluginVersion);
    let submission = input.getState().pluginSubmissions[catalog.pluginId];
    if (submission?.installationId !== bootstrap.installationId ||
      submission.catalogDigest !== catalog.digest ||
      submission.pluginVersion !== catalog.pluginVersion ||
      submission.adapterProfileDigest !== OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex) {
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
      const receipt = await client.getContributionStatus(submission.localizationContributionId);
      submission = {
        ...submission,
        localizationContributionState: receipt.state,
      };
      await saveSubmission(input, submission);
    }
    waitingCount += 1;
    waitingPluginIds.push(catalog.pluginId);
  }
  return {
    submittedCount,
    requestedCount,
    pulledCount,
    waitingCount,
    translationCount,
    waitingPluginIds,
  };
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
  const state = input.getState();
  input.replaceState({
    ...state,
    pluginSubmissions: { ...state.pluginSubmissions, [submission.pluginId]: submission },
  });
  await input.save();
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
      ...(row.provenanceKind === undefined ? {} : { provenanceKind: row.provenanceKind }),
      ...(row.application === undefined ? {} : { application: row.application }),
      ...(nativeTarget === undefined ? {} : { nativeTarget }),
    };
  });
  return {
    pluginId: catalog.pluginId,
    pluginVersion: catalog.pluginVersion,
    sourceVersionId,
    targetLocale,
    upstreamNativeCount,
    entries,
    pulledAt: new Date().toISOString(),
  };
}

export function isPublishedExportPending(error: unknown): boolean {
  return error instanceof Error && /^Published export not found：HTTP 404$/u.test(error.message);
}

function isLocalHttp(value: string): boolean {
  return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(value);
}
