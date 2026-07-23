import {
  parseSourceCatalogIdentity,
  type LocalizationDemandState,
  type SourceCatalogIdentity,
} from "@trans-hub/client-protocol";

export interface NoteSubmissionState {
  readonly noteId: string;
  readonly filePath: string;
  readonly sourceDigest: string;
  readonly sourceStreamId: string;
  readonly sourceVersionId: string;
  readonly headVersion: number;
  readonly submittedAt: string;
}

export interface GeneratedTargetState {
  readonly path: string;
  readonly digest: string;
  readonly sourceVersionId: string;
  readonly targetLocale: string;
  readonly generatedAt: string;
}

export interface PendingSubmissionState {
  readonly clientSubmissionId: string;
  readonly sourceStreamId: string;
  readonly expectedHeadVersion: number;
  readonly attemptToken: string;
  readonly snapshotDigest: string;
  readonly commandIds: SourceSubmissionCommandIds;
  readonly preparedState?: SourceSubmissionPreparedState;
  readonly updatedAt: string;
}

export interface PluginTranslationState {
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly sourceVersionId: string;
  readonly sourceSnapshotDigest?: string;
  readonly artifactDigest?: string;
  readonly catalogIdentity?: SourceCatalogIdentity;
  readonly targetLocale: string;
  readonly sourceUnitCount?: number;
  readonly upstreamNativeCount?: number;
  readonly publishedUnitCount?: number;
  readonly missingUnitCount?: number;
  readonly entries: readonly PluginUiTranslation[];
  readonly pulledAt: string;
}

export interface PluginSubmissionState {
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly catalogDigest: string;
  readonly adapterProfileDigest?: string;
  readonly installationId?: string;
  readonly contributionId: string;
  readonly contributionState: string;
  readonly observationGeneration?: number;
  readonly repository?: string;
  readonly localizationTargetLocale?: string;
  readonly localizationContributionId?: string;
  readonly localizationContributionState?: string;
  readonly localizationDemandStatus?: PluginLocalizationDemandStatusState;
  readonly sourceVersionId?: string;
  readonly lastError?: PluginSynchronizationErrorState;
  readonly submittedAt: string;
}

export interface PluginLocalizationDemandStatusState {
  readonly state: LocalizationDemandState;
  readonly sourceVersionId?: string;
  readonly targetLocale?: string;
  readonly targetVariant?: string;
  readonly totalUnitCount: number;
  readonly workItemCount: number;
  readonly nativeUnitCount: number;
  readonly queuedCount: number;
  readonly runningCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly reviewedUnitCount: number;
  readonly publishedUnitCount: number;
  readonly manifestId?: string;
  readonly generationNumber?: number;
  readonly retryAfterSeconds: number;
  readonly failureCode?: string;
  readonly failureRetryable: boolean;
  readonly failureAttemptNumber?: number;
  readonly updatedAt: string;
}

export interface PluginSynchronizationErrorState {
  readonly code: string;
  readonly message: string;
  readonly updatedAt: string;
}

export interface PluginState {
  readonly notes: Readonly<Record<string, NoteSubmissionState>>;
  readonly pendingSubmissions: Readonly<Record<string, PendingSubmissionState>>;
  readonly generatedTargets: Readonly<Record<string, GeneratedTargetState>>;
  readonly enabledPluginIds: readonly string[];
  readonly pluginCatalogs: Readonly<Record<string, PluginUiCatalog>>;
  readonly pluginSubmissions: Readonly<Record<string, PluginSubmissionState>>;
  readonly pluginTranslations: Readonly<Record<string, PluginTranslationState>>;
  readonly translationExportStates: Readonly<Record<string, TranslationSyncState>>;
}

export const EMPTY_PLUGIN_STATE: PluginState = {
  notes: {},
  pendingSubmissions: {},
  generatedTargets: {},
  enabledPluginIds: [],
  pluginCatalogs: {},
  pluginSubmissions: {},
  pluginTranslations: {},
  translationExportStates: {},
};

export function parsePluginState(value: unknown): PluginState {
  if (!isRecord(value)) return EMPTY_PLUGIN_STATE;
  return {
    notes: isRecord(value.notes)
      ? (value.notes as unknown as Record<string, NoteSubmissionState>)
      : {},
    pendingSubmissions: isRecord(value.pendingSubmissions)
      ? (value.pendingSubmissions as unknown as Record<string, PendingSubmissionState>)
      : {},
    generatedTargets: isRecord(value.generatedTargets)
      ? (value.generatedTargets as unknown as Record<string, GeneratedTargetState>)
      : {},
    enabledPluginIds: Array.isArray(value.enabledPluginIds)
      ? value.enabledPluginIds.filter((item): item is string => typeof item === "string")
      : [],
    pluginCatalogs: isRecord(value.pluginCatalogs)
      ? parseRecord(value.pluginCatalogs, parsePluginCatalog)
      : {},
    pluginSubmissions: isRecord(value.pluginSubmissions)
      ? parseRecord(value.pluginSubmissions, parsePluginSubmission)
      : {},
    pluginTranslations: isRecord(value.pluginTranslations)
      ? parseRecord(value.pluginTranslations, parsePluginTranslation)
      : {},
    translationExportStates: isRecord(value.translationExportStates)
      ? parseRecord(value.translationExportStates, parseTranslationExportState)
      : {},
  };
}

function parseTranslationExportState(value: unknown): TranslationSyncState | null {
  if (!isRecord(value) || typeof value.etag !== "string" || value.etag === "") return null;
  try {
    return {
      etag: value.etag,
      manifest: parseStoredTranslationExportManifest(value.manifest),
    };
  } catch {
    return null;
  }
}

function parsePluginCatalog(value: unknown): PluginUiCatalog | null {
  if (!isRecord(value) || !Array.isArray(value.strings)) return null;
  const pluginId = stringValue(value.pluginId);
  const pluginName = stringValue(value.pluginName);
  const pluginVersion = stringValue(value.pluginVersion);
  const sourceLocale = stringValue(value.sourceLocale);
  const digest = stringValue(value.digest);
  const artifactDigest = stringValue(value.artifactDigest);
  const scannedAt = stringValue(value.scannedAt);
  if ([pluginId, pluginName, pluginVersion, sourceLocale, digest, artifactDigest, scannedAt].some((item) => item === null)) return null;
  let catalogIdentity: SourceCatalogIdentity | undefined;
  try {
    catalogIdentity = value.catalogIdentity === undefined
      ? undefined
      : parseSourceCatalogIdentity(value.catalogIdentity);
  } catch {
    return null;
  }
  const strings = value.strings.map((item) => {
    if (!isRecord(item) || !Array.isArray(item.origins)) return null;
    const key = stringValue(item.key);
    const source = stringValue(item.source);
    const placeholder = typeof item.placeholderSignature === "string" ? item.placeholderSignature : null;
    const origins = item.origins.filter(isPluginStringOrigin);
    if (key === null || source === null || placeholder === null || origins.length !== item.origins.length) return null;
    const evidence = item.evidence === undefined
      ? undefined
      : Array.isArray(item.evidence)
        ? item.evidence.map(parsePluginStringEvidence)
        : [null];
    if (evidence?.some((entry) => entry === null) === true) return null;
    return {
      key,
      source,
      placeholderSignature: placeholder,
      origins,
      semanticRole: isPluginStringSemanticRole(item.semanticRole)
        ? item.semanticRole
        : resolvePluginStringSemanticRole(origins),
      ...(evidence === undefined
        ? {}
        : { evidence: evidence.filter((entry): entry is PluginStringEvidence => entry !== null) }),
    };
  });
  if (strings.some((item) => item === null)) return null;
  return {
    pluginId: pluginId!, pluginName: pluginName!, pluginVersion: pluginVersion!,
    sourceLocale: sourceLocale!, digest: digest!, artifactDigest: artifactDigest!, scannedAt: scannedAt!,
    ...(catalogIdentity === undefined ? {} : { catalogIdentity }),
    strings: strings.filter((item): item is NonNullable<typeof item> => item !== null),
  };
}

function parsePluginStringEvidence(value: unknown): PluginStringEvidence | null {
  if (!isRecord(value) || !isPluginStringOrigin(value.origin) || !isPluginStringExtractionStrategy(value.strategy)) {
    return null;
  }
  const symbol = stringValue(value.symbol);
  if (symbol === null || !isNullableNonNegativeInteger(value.offset)
    || !isNullableNonNegativeInteger(value.line) || !isNullableNonNegativeInteger(value.column)) {
    return null;
  }
  return {
    origin: value.origin,
    strategy: value.strategy,
    symbol,
    offset: value.offset,
    line: value.line,
    column: value.column,
  };
}

function parsePluginSubmission(value: unknown): PluginSubmissionState | null {
  if (!isRecord(value)) return null;
  const strings = [value.pluginId, value.pluginVersion, value.catalogDigest, value.contributionId, value.contributionState, value.submittedAt];
  if (!strings.every((item) => typeof item === "string" && item !== "")) return null;
  const localizationDemandStatus = parsePluginLocalizationDemandStatus(
    value.localizationDemandStatus,
  );
  const lastError = parsePluginSynchronizationError(value.lastError);
  return {
    pluginId: value.pluginId as string,
    pluginVersion: value.pluginVersion as string,
    catalogDigest: value.catalogDigest as string,
    ...(typeof value.adapterProfileDigest === "string" && value.adapterProfileDigest !== ""
      ? { adapterProfileDigest: value.adapterProfileDigest }
      : {}),
    ...(typeof value.installationId === "string" && value.installationId !== ""
      ? { installationId: value.installationId }
      : {}),
    contributionId: value.contributionId as string,
    contributionState: value.contributionState as string,
    ...(isNonNegativeInteger(value.observationGeneration)
      ? { observationGeneration: value.observationGeneration }
      : {}),
    ...(typeof value.repository === "string" && value.repository !== "" ? { repository: value.repository } : {}),
    ...(typeof value.localizationTargetLocale === "string" && value.localizationTargetLocale !== "" ? { localizationTargetLocale: value.localizationTargetLocale } : {}),
    ...(typeof value.localizationContributionId === "string" && value.localizationContributionId !== "" ? { localizationContributionId: value.localizationContributionId } : {}),
    ...(typeof value.localizationContributionState === "string" && value.localizationContributionState !== "" ? { localizationContributionState: value.localizationContributionState } : {}),
    ...(localizationDemandStatus === null ? {} : { localizationDemandStatus }),
    ...(typeof value.sourceVersionId === "string" && value.sourceVersionId !== "" ? { sourceVersionId: value.sourceVersionId } : {}),
    ...(lastError === null ? {} : { lastError }),
    submittedAt: value.submittedAt as string,
  };
}

function parsePluginLocalizationDemandStatus(
  value: unknown,
): PluginLocalizationDemandStatusState | null {
  if (!isRecord(value) || !isLocalizationDemandState(value.state)) return null;
  const integerFields = [
    "totalUnitCount", "workItemCount", "nativeUnitCount", "queuedCount",
    "runningCount", "succeededCount", "failedCount", "reviewedUnitCount",
    "publishedUnitCount", "retryAfterSeconds",
  ] as const;
  if (!integerFields.every((field) => isNonNegativeInteger(value[field]))) return null;
  const updatedAt = stringValue(value.updatedAt);
  if (updatedAt === null || typeof value.failureRetryable !== "boolean") return null;
  const failureAttemptNumber = value.failureAttemptNumber;
  if (failureAttemptNumber !== undefined && !isPositiveInteger(failureAttemptNumber)) return null;
  const generationNumber = value.generationNumber;
  if (generationNumber !== undefined && !isPositiveInteger(generationNumber)) return null;
  return {
    state: value.state,
    ...(optionalString(value.sourceVersionId, "sourceVersionId")),
    ...(optionalString(value.targetLocale, "targetLocale")),
    ...(optionalString(value.targetVariant, "targetVariant")),
    totalUnitCount: value.totalUnitCount as number,
    workItemCount: value.workItemCount as number,
    nativeUnitCount: value.nativeUnitCount as number,
    queuedCount: value.queuedCount as number,
    runningCount: value.runningCount as number,
    succeededCount: value.succeededCount as number,
    failedCount: value.failedCount as number,
    reviewedUnitCount: value.reviewedUnitCount as number,
    publishedUnitCount: value.publishedUnitCount as number,
    ...(optionalString(value.manifestId, "manifestId")),
    ...(generationNumber === undefined ? {} : { generationNumber }),
    retryAfterSeconds: value.retryAfterSeconds as number,
    ...(optionalString(value.failureCode, "failureCode")),
    failureRetryable: value.failureRetryable,
    ...(failureAttemptNumber === undefined ? {} : { failureAttemptNumber }),
    updatedAt,
  };
}

function parsePluginSynchronizationError(
  value: unknown,
): PluginSynchronizationErrorState | null {
  if (!isRecord(value)) return null;
  const code = stringValue(value.code);
  const message = stringValue(value.message);
  const updatedAt = stringValue(value.updatedAt);
  return code === null || message === null || updatedAt === null
    ? null
    : { code, message, updatedAt };
}

function isLocalizationDemandState(value: unknown): value is LocalizationDemandState {
  return [
    "awaiting_source", "rejected", "reconciled", "mt_queued", "mt_running",
    "mt_failed", "export_pending", "export_ready", "native_complete",
  ].includes(String(value));
}

function optionalString<Key extends string>(
  value: unknown,
  key: Key,
): Partial<Record<Key, string>> {
  const parsed = stringValue(value);
  return parsed === null ? {} : { [key]: parsed } as Record<Key, string>;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parsePluginTranslation(value: unknown): PluginTranslationState | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null;
  const pluginId = stringValue(value.pluginId);
  const pluginVersion = stringValue(value.pluginVersion);
  const sourceVersionId = stringValue(value.sourceVersionId);
  const targetLocale = stringValue(value.targetLocale);
  const pulledAt = stringValue(value.pulledAt);
  const upstreamNativeCount = typeof value.upstreamNativeCount === "number"
    && Number.isInteger(value.upstreamNativeCount) && value.upstreamNativeCount >= 0
    ? value.upstreamNativeCount
    : 0;
  const sourceUnitCount = optionalNonNegativeInteger(value.sourceUnitCount);
  const publishedUnitCount = optionalNonNegativeInteger(value.publishedUnitCount);
  const missingUnitCount = optionalNonNegativeInteger(value.missingUnitCount);
  if ([pluginId, pluginVersion, sourceVersionId, targetLocale, pulledAt].some((item) => item === null)) return null;
  let catalogIdentity: SourceCatalogIdentity | undefined;
  try {
    catalogIdentity = value.catalogIdentity === undefined
      ? undefined
      : parseSourceCatalogIdentity(value.catalogIdentity);
  } catch {
    return null;
  }
  const sourceSnapshotDigest = optionalSha256(value.sourceSnapshotDigest);
  const artifactDigest = optionalSha256(value.artifactDigest);
  if ((value.sourceSnapshotDigest !== undefined && sourceSnapshotDigest === undefined)
    || (value.artifactDigest !== undefined && artifactDigest === undefined)) return null;
  const entries = value.entries.map((entry) => {
    if (!isRecord(entry)) return null;
    const entryPluginId = stringValue(entry.pluginId);
    const source = stringValue(entry.source);
    const target = stringValue(entry.target);
    const provenanceKind = isPluginTranslationProvenanceKind(entry.provenanceKind)
      ? entry.provenanceKind
      : undefined;
    const application = isPluginTranslationApplication(entry.application)
      ? entry.application
      : undefined;
    const nativeTarget = typeof entry.nativeTarget === "string" && entry.nativeTarget.trim() !== ""
      ? entry.nativeTarget
      : undefined;
    const scopes = parsePluginTranslationScopes(entry.scopes);
    if (entry.scopes !== undefined && scopes === undefined) return null;
    if (
      (application === "correction" && (provenanceKind !== "th-reviewed-correction" || nativeTarget === undefined))
      || (provenanceKind === "th-reviewed-correction" && application !== "correction")
      || (nativeTarget !== undefined && application !== "correction")
    ) {
      return null;
    }
    return entryPluginId === pluginId && source !== null && target !== null
      ? {
        pluginId: entryPluginId,
        source,
        target,
        ...(provenanceKind === undefined ? {} : { provenanceKind }),
        ...(application === undefined ? {} : { application }),
        ...(scopes === undefined ? {} : { scopes }),
        ...(nativeTarget === undefined ? {} : { nativeTarget }),
      }
      : null;
  });
  if (entries.some((entry) => entry === null)) return null;
  return {
    pluginId: pluginId!, pluginVersion: pluginVersion!, sourceVersionId: sourceVersionId!,
    ...(sourceSnapshotDigest === undefined ? {} : { sourceSnapshotDigest }),
    ...(artifactDigest === undefined ? {} : { artifactDigest }),
    ...(catalogIdentity === undefined ? {} : { catalogIdentity }),
    targetLocale: targetLocale!, pulledAt: pulledAt!,
    ...(sourceUnitCount === undefined ? {} : { sourceUnitCount }),
    upstreamNativeCount,
    ...(publishedUnitCount === undefined ? {} : { publishedUnitCount }),
    ...(missingUnitCount === undefined ? {} : { missingUnitCount }),
    entries: entries.filter((entry): entry is PluginUiTranslation => entry !== null),
  };
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function parsePluginTranslationScopes(
  value: unknown,
): NonNullable<PluginUiTranslation["scopes"]> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const scopes = value.filter((scope): scope is "runtime-ui" | "metadata" | "readme" => (
    scope === "runtime-ui" || scope === "metadata" || scope === "readme"
  ));
  if (scopes.length !== value.length || new Set(scopes).size !== scopes.length) return undefined;
  return scopes;
}

function optionalSha256(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : undefined;
}

function parseRecord<T>(value: Record<string, unknown>, parser: (item: unknown) => T | null): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, item] of Object.entries(value)) {
    const parsed = parser(item);
    if (parsed !== null) result[key] = parsed;
  }
  return result;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function isPluginStringOrigin(value: unknown): value is PluginUiCatalog["strings"][number]["origins"][number] {
  return value === "manifest.name" || value === "manifest.description"
    || value === "registry.name" || value === "registry.description"
    || value === "readme"
    || value === "ui-call" || value === "ui-property";
}

function isPluginStringExtractionStrategy(value: unknown): value is PluginStringExtractionStrategy {
  return value === "manifest" || value === "registry"
    || value === "markdown"
    || value === "structured" || value === "regex-fallback";
}

function isPluginStringSemanticRole(value: unknown): value is PluginStringSemanticRole {
  return value === "official-name" || value === "description" || value === "readme" || value === "runtime-ui";
}

function isPluginTranslationProvenanceKind(
  value: unknown,
): value is NonNullable<PluginUiTranslation["provenanceKind"]> {
  return value === "upstream-native" || value === "th-reviewed-fill"
    || value === "th-reviewed-correction" || value === "th-automatic"
    || value === "th-published";
}

function isPluginTranslationApplication(
  value: unknown,
): value is NonNullable<PluginUiTranslation["application"]> {
  return value === "fill" || value === "correction";
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
type SourceSubmissionCommandIds = Readonly<Record<string, string | readonly string[]>>;
type SourceSubmissionPreparedState = Readonly<Record<string, unknown>>;

import type {
  PluginStringEvidence,
  PluginStringExtractionStrategy,
  PluginStringSemanticRole,
  PluginUiCatalog,
} from "./plugin-string-scanner";
import { resolvePluginStringSemanticRole } from "./plugin-string-scanner";
import type { PluginUiTranslation } from "./plugin-ui-runtime";
import {
  parseStoredTranslationExportManifest,
  type TranslationSyncState,
} from "@trans-hub/translation-export-client";
