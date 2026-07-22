import type { PluginUiCatalog } from "./plugin-string-scanner";
import {
  placeholderSignature,
  resolvePluginStringScopes,
  resolvePluginStringSemanticRole,
} from "./plugin-string-scanner";
import type { PluginTranslationState } from "./plugin-state";
import type { PluginUiTranslation } from "./plugin-ui-runtime";

export interface PluginTranslationCoverage {
  readonly totalCount: number;
  readonly translatedCount: number;
  readonly missingCount: number;
  readonly staleCount: number;
  readonly percent: number;
  readonly exactPluginVersion: boolean;
  readonly scopes: readonly PluginScopeTranslationCoverage[];
  readonly unattributedNativeCount: number;
}

export interface PluginScopeTranslationCoverage {
  readonly scope: "runtime-ui" | "metadata" | "readme";
  readonly totalCount: number;
  readonly translatedCount: number;
  readonly missingCount: number;
  readonly percent: number;
}

export type PluginCatalogIdentityMismatchKind =
  | "legacy"
  | "artifact"
  | "catalog";

export interface PluginCatalogIdentityComparison {
  readonly exact: boolean;
  readonly kind?: PluginCatalogIdentityMismatchKind;
  readonly mismatchedScopes: readonly string[];
  readonly safelyAppliedCount: number;
}

export function comparePluginCatalogIdentity(
  catalog: PluginUiCatalog,
  translation: PluginTranslationState,
): PluginCatalogIdentityComparison {
  const currentSources = new Map(catalog.strings.map((item) => [item.source, item.placeholderSignature]));
  const safelyAppliedCount = new Set(translation.entries
    .filter((entry) => isCompatibleEntry(entry, currentSources))
    .map((entry) => entry.source)).size;
  const local = catalog.catalogIdentity;
  const authority = translation.catalogIdentity;
  if (local === undefined || authority === undefined) {
    return { exact: false, kind: "legacy", mismatchedScopes: [], safelyAppliedCount };
  }
  if (local.artifactDigest !== authority.artifactDigest
    || catalog.artifactDigest !== authority.artifactDigest
    || translation.artifactDigest !== undefined
      && translation.artifactDigest !== catalog.artifactDigest) {
    return {
      exact: false,
      kind: "artifact",
      mismatchedScopes: [...new Set([...local.scopes, ...authority.scopes].map((item) => item.scope))].sort(),
      safelyAppliedCount,
    };
  }
  if (local.digest === authority.digest
    && local.resourceKey === authority.resourceKey
    && local.resourceVersion === authority.resourceVersion
    && local.sourceLocale === authority.sourceLocale) {
    return { exact: true, mismatchedScopes: [], safelyAppliedCount };
  }
  const localScopes = new Map(local.scopes.map((item) => [item.scope, item.digest]));
  const authorityScopes = new Map(authority.scopes.map((item) => [item.scope, item.digest]));
  const mismatchedScopes = [...new Set([...localScopes.keys(), ...authorityScopes.keys()])]
    .filter((scope) => localScopes.get(scope) !== authorityScopes.get(scope))
    .sort();
  return {
    exact: false,
    kind: "catalog",
    mismatchedScopes,
    safelyAppliedCount,
  };
}

export function calculatePluginTranslationCoverage(
  catalog: PluginUiCatalog | undefined,
  translation: PluginTranslationState | undefined,
  targetLocale: string,
): PluginTranslationCoverage | undefined {
  if (catalog === undefined || translation?.targetLocale !== targetLocale) return undefined;
  const currentSources = new Map(catalog.strings.map((item) => [item.source, item.placeholderSignature]));
  const translatedSources = new Set(translation.entries
    .filter((entry) => isCompatibleEntry(entry, currentSources))
    .map((entry) => entry.source));
  const staleCount = new Set(translation.entries
    .map((entry) => entry.source)
    .filter((source) => !currentSources.has(source))).size;
  const correctionCount = translation.entries.filter(
    (entry) => entry.provenanceKind === "th-reviewed-correction"
      && translatedSources.has(entry.source),
  ).length;
  const effectiveNativeCount = Math.max((translation.upstreamNativeCount ?? 0) - correctionCount, 0);
  const attributedNativeSources = new Set(translation.entries
    .filter((entry) => entry.provenanceKind === "upstream-native" && translatedSources.has(entry.source))
    .map((entry) => entry.source));
  const unattributedNativeCount = Math.max(effectiveNativeCount - attributedNativeSources.size, 0);
  const translatedCount = Math.min(currentSources.size, translatedSources.size + unattributedNativeCount);
  const totalCount = currentSources.size;
  const scopes = (["runtime-ui", "metadata", "readme"] as const).flatMap((scope) => {
    const sources = new Set(catalog.strings
      .filter((item) => resolvePluginStringScopes(item.origins).includes(scope))
      .map((item) => item.source));
    if (sources.size === 0) return [];
    const translated = [...sources].filter((source) => translatedSources.has(source)).length;
    return [{
      scope,
      totalCount: sources.size,
      translatedCount: translated,
      missingCount: Math.max(sources.size - translated, 0),
      percent: Math.round((translated / sources.size) * 100),
    }];
  });
  return {
    totalCount,
    translatedCount,
    missingCount: Math.max(totalCount - translatedCount, 0),
    staleCount,
    percent: totalCount === 0 ? 100 : Math.round((translatedCount / totalCount) * 100),
    exactPluginVersion: translation.pluginVersion === catalog.pluginVersion,
    scopes,
    unattributedNativeCount,
  };
}

export function mergePublishedPluginTranslation(
  catalog: PluginUiCatalog,
  incoming: PluginTranslationState,
  previous: PluginTranslationState | undefined,
): PluginTranslationState {
  if (previous?.targetLocale !== incoming.targetLocale) return incoming;
  const currentSources = new Map(catalog.strings.map((item) => [item.source, item.placeholderSignature]));
  const entries = new Map<string, PluginUiTranslation>();
  for (const entry of previous.entries) {
    if (isCompatibleEntry(entry, currentSources)) entries.set(entry.source, entry);
  }
  for (const entry of incoming.entries) entries.set(entry.source, entry);
  return {
    ...incoming,
    pluginVersion: catalog.pluginVersion,
    entries: [...entries.values()].sort((left, right) => left.source.localeCompare(right.source)),
  };
}

export function selectCurrentCatalogTranslations(
  catalog: PluginUiCatalog | undefined,
  translation: PluginTranslationState,
  includeMetadata = true,
): readonly PluginUiTranslation[] {
  if (catalog === undefined) return [];
  const catalogBySource = new Map(catalog.strings.map((item) => [item.source, item]));
  const currentSources = new Map(catalog.strings
    .filter((item) => includeMetadata || resolvePluginStringScopes(item.origins).includes("runtime-ui"))
    .map((item) => [item.source, item.placeholderSignature]));
  return translation.entries
    .filter((entry) => isCompatibleEntry(entry, currentSources))
    .map((entry) => ({
      ...entry,
      scopes: resolvePluginStringScopes(catalogBySource.get(entry.source)?.origins ?? []),
    }));
}

export function localizedPluginDisplayName(
  officialName: string,
  catalog: PluginUiCatalog | undefined,
  translation: PluginTranslationState | undefined,
  targetLocale: string,
): string {
  if (catalog === undefined || translation?.targetLocale !== targetLocale) return officialName;
  const nameString = findMetadataString(catalog, "official-name", officialName);
  if (nameString === undefined) return officialName;
  const translated = translation.entries.find((entry) =>
    entry.source === nameString.source
    && isCompatibleEntry(entry, new Map([[nameString.source, nameString.placeholderSignature]])));
  const localizedName = translated?.target.normalize("NFC").trim();
  return localizedName === undefined || localizedName === ""
    ? officialName
    : localizedName;
}

export function localizedPluginDescription(
  officialDescription: string,
  catalog: PluginUiCatalog | undefined,
  translation: PluginTranslationState | undefined,
  targetLocale: string,
): string {
  if (catalog === undefined || translation?.targetLocale !== targetLocale) return officialDescription;
  const descriptionString = findMetadataString(catalog, "description", officialDescription);
  if (descriptionString === undefined) return officialDescription;
  const translated = translation.entries.find((entry) =>
    entry.source === descriptionString.source
    && isCompatibleEntry(entry, new Map([[descriptionString.source, descriptionString.placeholderSignature]])));
  const localizedDescription = translated?.target.normalize("NFC").trim();
  return localizedDescription === undefined || localizedDescription === ""
    ? officialDescription
    : localizedDescription;
}

function findMetadataString(
  catalog: PluginUiCatalog,
  role: "official-name" | "description",
  officialText: string,
): PluginUiCatalog["strings"][number] | undefined {
  const candidates = catalog.strings.filter(
    (item) => (item.semanticRole ?? resolvePluginStringSemanticRole(item.origins)) === role,
  );
  return candidates.find((item) => item.source === officialText) ?? candidates[0];
}

function isCompatibleEntry(
  entry: PluginUiTranslation,
  currentSources: ReadonlyMap<string, string>,
): boolean {
  const expectedSignature = currentSources.get(entry.source);
  return expectedSignature !== undefined
    && placeholderSignature(entry.source) === expectedSignature
    && placeholderSignature(entry.target) === expectedSignature;
}
