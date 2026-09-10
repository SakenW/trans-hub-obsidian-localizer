import {
  parseSourceCatalogIdentity,
  parsePublicLocalizationStatusProjection,
  type PublicLocalizationStatusProjection,
  type SourceCatalogIdentity,
} from "@trans-hub/client-protocol";

import { isTargetLocale, type TargetLocale } from "./product-config";

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
  /** Server-current version that owns sourceVersionId; defaults to pluginVersion for legacy caches. */
  readonly authorityPluginVersion?: string;
  readonly sourceVersionId: string;
  readonly sourceSnapshotDigest?: string;
  readonly artifactDigest?: string;
  readonly catalogIdentity?: SourceCatalogIdentity;
  readonly targetLocale: string;
  readonly sourceUnitCount?: number;
  readonly upstreamNativeCount?: number;
  readonly upstreamScopedNativeCount?: number;
  readonly upstreamScopeCoverage?: Readonly<Record<string, number>>;
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
  readonly registryPolicyRevision?: number;
  readonly sourceDiscoveryEpoch?: number;
  readonly installationId?: string;
  readonly sourceAuthority?: "published";
  readonly contributionId?: string;
  readonly contributionState: string;
  readonly observationGeneration?: number;
  readonly repository?: string;
  readonly sourceVersionId?: string;
  readonly lastError?: PluginSynchronizationErrorState;
  readonly submittedAt: string;
}

export interface PluginSynchronizationErrorState {
  readonly code: string;
  readonly message: string;
  readonly targetLocale?: TargetLocale;
  readonly updatedAt: string;
}

export type PluginTranslationsByLocale = Readonly<
  Record<string, Readonly<Partial<Record<TargetLocale, PluginTranslationState>>>>
>;

export interface PublicPluginDiscoveryState {
  readonly statusRevision?: 2;
  readonly receiptId?: string;
  readonly discoveryId: string;
  readonly taskId?: string | null;
  readonly targetLocales: readonly TargetLocale[];
  readonly classification: string;
  readonly taskState: string;
  readonly taskGeneration?: number | null;
  readonly attemptCount?: number;
  readonly outcome?: string;
  readonly commandDigestHex?: string;
  readonly credentialEpoch?: number;
  readonly receiptRecordedAt?: string;
  readonly updatedAt?: string;
  readonly retryAfterSeconds?: number;
  readonly retryAllowed?: boolean;
  readonly blockedReasonCode?: string;
  readonly retryGeneration?: number;
  readonly installationId: string;
  readonly submittedAt: string;
  /** Source-discovery contract that created this task; a different epoch is a new task namespace. */
  readonly sourceDiscoveryEpoch?: number;
  /** Exact local catalog that caused this discovery submission. */
  readonly catalogIdentityDigest?: string;
  readonly localizationProjection?: PublicLocalizationStatusProjection;
}

export interface PluginState {
  readonly notes: Readonly<Record<string, NoteSubmissionState>>;
  readonly pendingSubmissions: Readonly<Record<string, PendingSubmissionState>>;
  readonly generatedTargets: Readonly<Record<string, GeneratedTargetState>>;
  readonly enabledPluginIds: readonly string[];
  readonly pluginCatalogs: Readonly<Record<string, PluginUiCatalog>>;
  readonly pluginSubmissions: Readonly<Record<string, PluginSubmissionState>>;
  readonly publicPluginDiscoveries: Readonly<Record<string, PublicPluginDiscoveryState>>;
  readonly pluginTranslations: PluginTranslationsByLocale;
  readonly translationExportStates: Readonly<
    Record<string, TranslationSyncState<AnyTranslationExportManifest>>
  >;
}

// v3 removes every locally persisted discovery and delivery reference from
// the retired public-discovery runtime. A clean source epoch must not poll an
// old receipt, legacy localization demand, or cached translation package.
export const PLUGIN_LOCALIZATION_DERIVED_CACHE_REVISION = 3;

export function isPluginLocalizationDerivedCacheCurrent(value: unknown): boolean {
  return value === 2 || value === PLUGIN_LOCALIZATION_DERIVED_CACHE_REVISION;
}

export const EMPTY_PLUGIN_STATE: PluginState = {
  notes: {},
  pendingSubmissions: {},
  generatedTargets: {},
  enabledPluginIds: [],
  pluginCatalogs: {},
  pluginSubmissions: {},
  publicPluginDiscoveries: {},
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
    publicPluginDiscoveries: isRecord(value.publicPluginDiscoveries)
      ? parseRecord(value.publicPluginDiscoveries, parsePublicPluginDiscovery)
      : {},
    pluginTranslations: parsePluginTranslations(value.pluginTranslations),
    translationExportStates: isRecord(value.translationExportStates)
      ? parseRecord(value.translationExportStates, parseTranslationExportState)
      : {},
  };
}

export function resetPluginLocalizationDerivedState(state: PluginState): PluginState {
  return {
    ...state,
    pluginSubmissions: {},
    publicPluginDiscoveries: {},
    pluginTranslations: {},
    translationExportStates: {},
  };
}

export function getPluginTranslation(
  state: Pick<PluginState, "pluginTranslations">,
  pluginId: string,
  targetLocale: TargetLocale,
): PluginTranslationState | undefined {
  const translation = state.pluginTranslations[pluginId]?.[targetLocale];
  return translation?.pluginId === pluginId && translation.targetLocale === targetLocale
    ? translation
    : undefined;
}

export function setPluginTranslation(
  state: PluginState,
  pluginId: string,
  targetLocale: TargetLocale,
  translation: PluginTranslationState,
): PluginState {
  if (translation.pluginId !== pluginId || translation.targetLocale !== targetLocale) {
    throw new Error("Plugin translation storage key does not match its content.");
  }
  return {
    ...state,
    pluginTranslations: {
      ...state.pluginTranslations,
      [pluginId]: {
        ...state.pluginTranslations[pluginId],
        [targetLocale]: translation,
      },
    },
  };
}

export function deletePluginTranslation(
  state: PluginState,
  pluginId: string,
  targetLocale: TargetLocale,
): PluginState {
  const translationsByLocale = state.pluginTranslations[pluginId];
  if (translationsByLocale === undefined || translationsByLocale[targetLocale] === undefined) {
    return state;
  }
  const { [targetLocale]: discardedTranslation, ...remainingByLocale } = translationsByLocale;
  void discardedTranslation;
  if (Object.keys(remainingByLocale).length === 0) {
    const { [pluginId]: discardedPlugin, ...remainingPlugins } = state.pluginTranslations;
    void discardedPlugin;
    return { ...state, pluginTranslations: remainingPlugins };
  }
  return {
    ...state,
    pluginTranslations: {
      ...state.pluginTranslations,
      [pluginId]: remainingByLocale,
    },
  };
}

export function getPluginSubmissionForLocale(
  state: Pick<PluginState, "pluginSubmissions">,
  pluginId: string,
  targetLocale: TargetLocale,
): PluginSubmissionState | undefined {
  const submission = state.pluginSubmissions[pluginId];
  if (submission === undefined) return undefined;
  const {
    lastError,
    ...sourceSubmission
  } = submission;
  return {
    ...sourceSubmission,
    ...(lastError?.targetLocale === targetLocale ? { lastError } : {}),
  };
}

function parsePluginTranslations(value: unknown): PluginTranslationsByLocale {
  if (!isRecord(value)) return {};
  const parsed: Record<string, Partial<Record<TargetLocale, PluginTranslationState>>> = {};
  for (const [pluginId, rawPluginTranslations] of Object.entries(value)) {
    if (!isRecord(rawPluginTranslations)) continue;
    for (const [locale, rawTranslation] of Object.entries(rawPluginTranslations)) {
      if (!isTargetLocale(locale)) continue;
      const translation = parsePluginTranslation(rawTranslation);
      if (
        translation === null
        || translation.pluginId !== pluginId
        || translation.targetLocale !== locale
      ) continue;
      (parsed[pluginId] ??= {})[locale] = translation;
    }
    if (Object.keys(parsed[pluginId] ?? {}).length === 0) delete parsed[pluginId];
  }
  return parsed;
}

function parseTranslationExportState(
  value: unknown,
): TranslationSyncState<AnyTranslationExportManifest> | null {
  if (!isRecord(value) || typeof value.etag !== "string" || value.etag === "") return null;
  try {
    const manifestValue = isRecord(value.manifest) ? value.manifest : undefined;
    const manifest = manifestValue?.revision === 3
      ? parseStoredTranslationExportManifest(manifestValue, 3)
      : parseStoredTranslationExportManifest(manifestValue);
    return {
      etag: value.etag,
      manifest,
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
  const scannerTargetLocale = typeof value.scannerTargetLocale === "string" && value.scannerTargetLocale.trim() !== ""
    ? value.scannerTargetLocale
    : undefined;
  const scannedAt = stringValue(value.scannedAt);
  if ([pluginId, pluginName, pluginVersion, sourceLocale, digest, artifactDigest, scannedAt].some((item) => item === null)) return null;
  if (
    value.patchEvidenceRevision !== undefined
    && value.patchEvidenceRevision !== 1
    && value.patchEvidenceRevision !== 2
    && value.patchEvidenceRevision !== 3
    && value.patchEvidenceRevision !== 4
    && value.patchEvidenceRevision !== 5
    && value.patchEvidenceRevision !== 6
    && value.patchEvidenceRevision !== 7
    && value.patchEvidenceRevision !== 10
    && value.patchEvidenceRevision !== 11
  ) return null;
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
    const nativeTarget = typeof item.nativeTarget === "string" && item.nativeTarget.trim() !== ""
      ? item.nativeTarget.normalize("NFC")
      : undefined;
    const nativeTargetLocale = typeof item.nativeTargetLocale === "string" && item.nativeTargetLocale.trim() !== ""
      ? item.nativeTargetLocale
      : undefined;
    const origins = item.origins.filter(isPluginStringOrigin);
    if (
      key === null || source === null || placeholder === null || origins.length !== item.origins.length
      || (nativeTarget === undefined) !== (nativeTargetLocale === undefined)
    ) return null;
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
      ...(nativeTarget === undefined || nativeTargetLocale === undefined
        ? {}
        : { nativeTarget, nativeTargetLocale }),
      ...(evidence === undefined
        ? {}
        : { evidence: evidence.filter((entry): entry is PluginStringEvidence => entry !== null) }),
    };
  });
  if (strings.some((item) => item === null)) return null;
  return {
    pluginId: pluginId!, pluginName: pluginName!, pluginVersion: pluginVersion!,
    sourceLocale: sourceLocale!, digest: digest!, artifactDigest: artifactDigest!, scannedAt: scannedAt!,
    ...(scannerTargetLocale === undefined ? {} : { scannerTargetLocale }),
    ...(value.patchEvidenceRevision === undefined
      ? {}
      : { patchEvidenceRevision: value.patchEvidenceRevision }),
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
  if (
    (value.literalStart !== undefined && !isNullableNonNegativeInteger(value.literalStart))
    || (value.literalEnd !== undefined && !isNullableNonNegativeInteger(value.literalEnd))
    || (typeof value.literalStart === "number" && typeof value.literalEnd === "number" && value.literalEnd <= value.literalStart)
  ) return null;
  return {
    origin: value.origin,
    strategy: value.strategy,
    symbol,
    offset: value.offset,
    line: value.line,
    column: value.column,
    ...(typeof value.literalStart === "number" && typeof value.literalEnd === "number"
      ? { literalStart: value.literalStart, literalEnd: value.literalEnd }
      : {}),
  };
}

function parsePluginSubmission(value: unknown): PluginSubmissionState | null {
  if (!isRecord(value)) return null;
  const strings = [value.pluginId, value.pluginVersion, value.catalogDigest, value.contributionState, value.submittedAt];
  if (!strings.every((item) => typeof item === "string" && item !== "")) return null;
  const sourceAuthority = value.sourceAuthority === "published" ? "published" : undefined;
  const contributionId = typeof value.contributionId === "string" && value.contributionId !== ""
    ? value.contributionId
    : undefined;
  if (value.sourceAuthority !== undefined && sourceAuthority === undefined) return null;
  if (
    sourceAuthority === "published"
    && (
      contributionId !== undefined
      || stringValue(value.sourceVersionId) === null
      || stringValue(value.repository) === null
    )
  ) return null;
  const lastError = parsePluginSynchronizationError(value.lastError);
  return {
    pluginId: value.pluginId as string,
    pluginVersion: value.pluginVersion as string,
    catalogDigest: value.catalogDigest as string,
    ...(typeof value.adapterProfileDigest === "string" && value.adapterProfileDigest !== ""
      ? { adapterProfileDigest: value.adapterProfileDigest }
      : {}),
    ...(isNonNegativeInteger(value.registryPolicyRevision)
      ? { registryPolicyRevision: value.registryPolicyRevision }
      : {}),
    ...(isNonNegativeInteger(value.sourceDiscoveryEpoch)
      ? { sourceDiscoveryEpoch: value.sourceDiscoveryEpoch }
      : {}),
    ...(typeof value.installationId === "string" && value.installationId !== ""
      ? { installationId: value.installationId }
      : {}),
    ...(sourceAuthority === undefined ? {} : { sourceAuthority }),
    ...(contributionId === undefined ? {} : { contributionId }),
    contributionState: value.contributionState as string,
    ...(isNonNegativeInteger(value.observationGeneration)
      ? { observationGeneration: value.observationGeneration }
      : {}),
    ...(typeof value.repository === "string" && value.repository !== "" ? { repository: value.repository } : {}),
    ...(typeof value.sourceVersionId === "string" && value.sourceVersionId !== "" ? { sourceVersionId: value.sourceVersionId } : {}),
    ...(lastError === null ? {} : { lastError }),
    submittedAt: value.submittedAt as string,
  };
}

function parsePublicPluginDiscovery(value: unknown): PublicPluginDiscoveryState | null {
  if (!isRecord(value)) return null;
  if (value.statusRevision !== 2) return null;
  const receiptId = stringValue(value.receiptId);
  const discoveryId = stringValue(value.discoveryId);
  const taskId = value.taskId === null ? null : stringValue(value.taskId);
  const classification = stringValue(value.classification);
  const taskState = stringValue(value.taskState);
  const outcome = stringValue(value.outcome);
  const commandDigestHex = stringValue(value.commandDigestHex);
  const receiptRecordedAt = stringValue(value.receiptRecordedAt);
  const updatedAt = stringValue(value.updatedAt);
  const installationId = stringValue(value.installationId);
  const submittedAt = stringValue(value.submittedAt);
  const sourceDiscoveryEpoch = value.sourceDiscoveryEpoch === undefined
    ? undefined
    : value.sourceDiscoveryEpoch;
  const catalogIdentityDigest = value.catalogIdentityDigest === undefined
    ? undefined
    : stringValue(value.catalogIdentityDigest);
  if (
    receiptId === null
    || discoveryId === null
    || (value.taskId !== null && taskId === null)
    || classification === null
    || taskState === null
    || outcome === null
    || commandDigestHex === null
    || !/^[a-f0-9]{64}$/u.test(commandDigestHex)
    || !isPositiveInteger(value.credentialEpoch)
    || receiptRecordedAt === null
    || updatedAt === null
    || !isNonNegativeInteger(value.attemptCount)
    || !isNonNegativeInteger(value.retryAfterSeconds)
    || typeof value.retryAllowed !== "boolean"
    || !isNonNegativeInteger(value.retryGeneration)
    || (value.taskGeneration !== null && !isPositiveInteger(value.taskGeneration))
    || (taskId === null && value.taskGeneration !== null)
    || installationId === null
    || submittedAt === null
    || (sourceDiscoveryEpoch !== undefined && !isNonNegativeInteger(sourceDiscoveryEpoch))
    || (
      value.catalogIdentityDigest !== undefined
      && !/^[a-f0-9]{64}$/u.test(catalogIdentityDigest ?? "")
    )
    || !Array.isArray(value.targetLocales)
  ) return null;
  const targetLocales = [...new Set(value.targetLocales.filter(isTargetLocale))];
  let localizationProjection: PublicLocalizationStatusProjection | undefined;
  try {
    localizationProjection = value.localizationProjection === undefined
      ? undefined
      : parsePublicLocalizationStatusProjection(
        value.localizationProjection,
        "$.localizationProjection",
      );
  } catch {
    return null;
  }
  if (
    localizationProjection !== undefined
    && (
      localizationProjection.discoveryId !== discoveryId
      || !targetLocales.includes(localizationProjection.targetLocale as TargetLocale)
    )
  ) return null;
  return targetLocales.length === 0
    ? null
    : {
      statusRevision: 2, receiptId, discoveryId, taskId, targetLocales,
      classification, taskState, taskGeneration: value.taskGeneration,
      attemptCount: value.attemptCount, outcome, commandDigestHex,
      credentialEpoch: value.credentialEpoch, receiptRecordedAt, updatedAt,
      retryAfterSeconds: value.retryAfterSeconds, retryAllowed: value.retryAllowed,
      ...(typeof catalogIdentityDigest === "string" ? { catalogIdentityDigest } : {}),
      ...(sourceDiscoveryEpoch === undefined ? {} : { sourceDiscoveryEpoch }),
      ...(typeof value.blockedReasonCode === "string" && value.blockedReasonCode !== ""
        ? { blockedReasonCode: value.blockedReasonCode }
        : {}),
      retryGeneration: value.retryGeneration, installationId, submittedAt,
      ...(localizationProjection === undefined ? {} : { localizationProjection }),
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
    : {
        code,
        message,
        ...(isTargetLocale(value.targetLocale) ? { targetLocale: value.targetLocale } : {}),
        updatedAt,
      };
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
  const authorityPluginVersion = value.authorityPluginVersion === undefined
    ? undefined
    : stringValue(value.authorityPluginVersion);
  const sourceVersionId = stringValue(value.sourceVersionId);
  const targetLocale = isTargetLocale(value.targetLocale) ? value.targetLocale : null;
  const pulledAt = stringValue(value.pulledAt);
  const upstreamNativeCount = typeof value.upstreamNativeCount === "number"
    && Number.isInteger(value.upstreamNativeCount) && value.upstreamNativeCount >= 0
    ? value.upstreamNativeCount
    : 0;
  const sourceUnitCount = optionalNonNegativeInteger(value.sourceUnitCount);
  const upstreamScopedNativeCount = optionalNonNegativeInteger(value.upstreamScopedNativeCount);
  const upstreamScopeCoverage = parseNonNegativeIntegerRecord(value.upstreamScopeCoverage);
  const publishedUnitCount = optionalNonNegativeInteger(value.publishedUnitCount);
  const missingUnitCount = optionalNonNegativeInteger(value.missingUnitCount);
  if ([pluginId, pluginVersion, sourceVersionId, targetLocale, pulledAt].some((item) => item === null)
    || (value.authorityPluginVersion !== undefined && authorityPluginVersion === null)) return null;
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
    || (value.artifactDigest !== undefined && artifactDigest === undefined)
    || (value.upstreamScopeCoverage !== undefined && upstreamScopeCoverage === undefined)) return null;
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
    const sourceCompatibility = parsePluginSourceCompatibility(entry.sourceCompatibility);
    if (entry.scopes !== undefined && scopes === undefined) return null;
    if (entry.sourceCompatibility !== undefined && sourceCompatibility === undefined) return null;
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
        ...(sourceCompatibility === undefined ? {} : { sourceCompatibility }),
        ...(nativeTarget === undefined ? {} : { nativeTarget }),
      }
      : null;
  });
  if (entries.some((entry) => entry === null)) return null;
  return {
    pluginId: pluginId!, pluginVersion: pluginVersion!,
    ...(typeof authorityPluginVersion === "string" ? { authorityPluginVersion } : {}),
    sourceVersionId: sourceVersionId!,
    ...(sourceSnapshotDigest === undefined ? {} : { sourceSnapshotDigest }),
    ...(artifactDigest === undefined ? {} : { artifactDigest }),
    ...(catalogIdentity === undefined ? {} : { catalogIdentity }),
    targetLocale: targetLocale!, pulledAt: pulledAt!,
    ...(sourceUnitCount === undefined ? {} : { sourceUnitCount }),
    upstreamNativeCount,
    ...(upstreamScopedNativeCount === undefined ? {} : { upstreamScopedNativeCount }),
    ...(upstreamScopeCoverage === undefined ? {} : { upstreamScopeCoverage }),
    ...(publishedUnitCount === undefined ? {} : { publishedUnitCount }),
    ...(missingUnitCount === undefined ? {} : { missingUnitCount }),
    entries: entries.filter((entry): entry is PluginUiTranslation => entry !== null),
  };
}

function parsePluginSourceCompatibility(
  value: unknown,
): import("./plugin-ui-runtime").PluginSourceCompatibility | undefined {
  if (!isRecord(value)
    || typeof value.semanticRole !== "string" || value.semanticRole === ""
    || !Array.isArray(value.contentScopes) || value.contentScopes.length === 0
    || typeof value.placeholderSignature !== "string"
    || typeof value.formatSignature !== "string" || value.formatSignature === ""
    || typeof value.sourceContentDigest !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(value.sourceContentDigest)) return undefined;
  const contentScopes = value.contentScopes;
  if (!contentScopes.every((scope): scope is string => typeof scope === "string" && scope !== "")
    || [...new Set(contentScopes)].length !== contentScopes.length
    || [...contentScopes].sort().some((scope, index) => scope !== contentScopes[index])) {
    return undefined;
  }
  return {
    semanticRole: value.semanticRole,
    contentScopes,
    placeholderSignature: value.placeholderSignature,
    formatSignature: value.formatSignature,
    sourceContentDigest: value.sourceContentDigest,
  };
}

function parseNonNegativeIntegerRecord(
  value: unknown,
): Readonly<Record<string, number>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.every(([key, count]) => key.trim() !== "" && isNonNegativeInteger(count))) {
    return undefined;
  }
  return Object.fromEntries(entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => [key, count as number]));
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
  type AnyTranslationExportManifest,
  type TranslationSyncState,
} from "@trans-hub/translation-export-client";
