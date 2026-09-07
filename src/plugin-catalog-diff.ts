import type { PluginUiCatalog } from "./plugin-string-scanner";
import {
  isCanonicalPluginCatalogString,
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
  const crossVersion = authorityPluginVersion(translation) !== catalog.pluginVersion;
  const currentSources = groupCatalogStringsBySource(catalog);
  const safelyAppliedCount = new Set(translation.entries
    .filter((entry) => isCompatibleCatalogEntry(
      entry,
      currentSources.get(entry.source),
      crossVersion,
    ))
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
  if (local.unitCount === authority.unitCount
    && local.digest === authority.digest
    && local.resourceKey === authority.resourceKey
    && local.resourceVersion === authority.resourceVersion
    && local.sourceLocale === authority.sourceLocale
    && local.scopes.length === authority.scopes.length
    && local.scopes.every((scope, index) => {
      const authorityScope = authority.scopes[index];
      return authorityScope !== undefined
        && scope.scope === authorityScope.scope
        && scope.unitCount === authorityScope.unitCount
        && scope.digest === authorityScope.digest;
    })) {
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

/** Current product coverage excludes documentation, even when the local scan has it. */
export function isPluginInterfaceString(item: PluginUiCatalog["strings"][number]): boolean {
  return isCanonicalPluginCatalogString(item)
    && resolvePluginStringScopes(item.origins).some((scope) => scope === "runtime-ui" || scope === "metadata");
}

export function calculatePluginTranslationCoverage(
  catalog: PluginUiCatalog | undefined,
  translation: PluginTranslationState | undefined,
  targetLocale: string,
): PluginTranslationCoverage | undefined {
  if (catalog === undefined || translation?.targetLocale !== targetLocale) return undefined;
  const effectiveTranslation = mergeCatalogNativeTranslations(catalog, translation);
  const canonicalStrings = catalog.strings.filter(isPluginInterfaceString);
  const currentSources = groupCatalogStringsBySource({ strings: canonicalStrings });
  const crossVersion = authorityPluginVersion(effectiveTranslation) !== catalog.pluginVersion;
  const authorityIdentity = effectiveTranslation.catalogIdentity;
  // An equal installed artifact does not prove an equal source catalog: the
  // adapter can safely discover additional UI strings without changing
  // main.js. An authority catalog may still describe a deliberately smaller
  // local scan, but it must never hide strings that the current scan found.
  const authorityCatalogCoversLocalCatalog = authorityIdentity !== undefined
    && authorityPluginVersion(effectiveTranslation) === catalog.pluginVersion
    && effectiveTranslation.sourceUnitCount === authorityIdentity.unitCount
    && (effectiveTranslation.upstreamNativeCount ?? 0) <= authorityIdentity.unitCount
    && authorityIdentity.artifactDigest === catalog.artifactDigest
    && effectiveTranslation.artifactDigest === catalog.artifactDigest
    && authorityIdentity.unitCount >= canonicalStrings.length;
  // Historical scope totals overlap, so subtracting README would invent a UI
  // union. Use the authoritative runtime scope as the primary denominator;
  // keep metadata as a separately reported scope.
  const authorityIncludesReadme = authorityCatalogCoversLocalCatalog
    && authorityIdentity.scopes.some((item) => item.scope === "readme" && item.unitCount > 0);
  const primaryRuntimeScope = authorityIncludesReadme
    ? authorityIdentity.scopes.find((item) => item.scope === "runtime-ui")
    : undefined;
  const allCatalogSources = new Set(catalog.strings.map((item) => item.source));
  const translatedSources = new Set(effectiveTranslation.entries
    .filter((entry) => isCompatibleCatalogEntry(
      entry,
      currentSources.get(entry.source),
      crossVersion,
    ))
    .map((entry) => entry.source));
  const staleCount = new Set(effectiveTranslation.entries
    .map((entry) => entry.source)
    .filter((source) => !allCatalogSources.has(source))).size;
  const correctionCount = effectiveTranslation.entries.filter(
    (entry) => entry.provenanceKind === "th-reviewed-correction"
      && translatedSources.has(entry.source),
  ).length;
  const primarySources = primaryRuntimeScope === undefined ? currentSources
    : groupCatalogStringsBySource({ strings: canonicalStrings.filter((item) => resolvePluginStringScopes(item.origins).includes("runtime-ui")) });
  const primaryTranslatedSources = new Set([...translatedSources].filter((source) => primarySources.has(source)));
  const effectiveNativeCount = primaryRuntimeScope === undefined
    ? Math.max((effectiveTranslation.upstreamNativeCount ?? 0) - correctionCount, 0)
    : Math.max(Math.min(effectiveTranslation.upstreamScopeCoverage?.["runtime-ui"] ?? 0, primaryRuntimeScope.unitCount)
      - effectiveTranslation.entries.filter((entry) => entry.provenanceKind === "th-reviewed-correction" && primaryTranslatedSources.has(entry.source)).length, 0);
  const attributedNativeSources = new Set(effectiveTranslation.entries
    .filter((entry) => entry.provenanceKind === "upstream-native" && translatedSources.has(entry.source))
    .map((entry) => entry.source));
  // A source-level native total is meaningful only when it was measured against
  // the same catalog cardinality as this local scan and cannot exceed that
  // scan. Otherwise it can belong to an older or broader parser profile and
  // must not inflate current coverage.
  const nativeCoverageAligned = (authorityCatalogCoversLocalCatalog
      && (!authorityIncludesReadme || primaryRuntimeScope !== undefined))
    || (canonicalStrings.length === catalog.strings.filter(isCanonicalPluginCatalogString).length
      && !authorityIdentity?.scopes.some((item) => item.scope === "readme" && item.unitCount > 0)
      && (effectiveTranslation.sourceUnitCount === undefined
        || effectiveTranslation.sourceUnitCount === currentSources.size)
      && effectiveNativeCount <= currentSources.size);
  const primaryAttributedNativeCount = [...attributedNativeSources].filter((source) => primarySources.has(source)).length;
  const nativeCountWithoutEntries = nativeCoverageAligned
    ? Math.max(effectiveNativeCount - primaryAttributedNativeCount, 0)
    : 0;
  const scopedNativeCount = Math.min(
    effectiveTranslation.upstreamScopedNativeCount ?? 0,
    effectiveNativeCount,
  );
  const unattributedNativeCount = nativeCoverageAligned
    ? Math.max(
      effectiveNativeCount - Math.max(scopedNativeCount, attributedNativeSources.size),
      0,
    )
    : 0;
  const totalCount = primaryRuntimeScope?.unitCount ?? (authorityCatalogCoversLocalCatalog && !authorityIncludesReadme
    ? authorityIdentity.unitCount
    : currentSources.size);
  const translatedCount = Math.min(totalCount, primaryTranslatedSources.size + nativeCountWithoutEntries);
  const authorityScopeTotals = authorityCatalogCoversLocalCatalog
    ? new Map(authorityIdentity.scopes.map((item) => [item.scope, item.unitCount]))
    : undefined;
  const scopes = (["runtime-ui", "metadata"] as const).flatMap((scope) => {
    const sources = new Set(canonicalStrings
      .filter((item) => resolvePluginStringScopes(item.origins).includes(scope))
      .map((item) => item.source));
    const scopeTotal = authorityScopeTotals?.get(scope) ?? sources.size;
    if (scopeTotal === 0) return [];
    const translatedInEntries = [...sources].filter((source) => translatedSources.has(source)).length;
    const attributedNativeInScope = [...attributedNativeSources]
      .filter((source) => sources.has(source)).length;
    const scopedNativeWithoutEntries = nativeCoverageAligned
      ? Math.max(
        Math.min(effectiveTranslation.upstreamScopeCoverage?.[scope] ?? 0, scopeTotal)
          - attributedNativeInScope,
        0,
      )
      : 0;
    const translated = Math.min(scopeTotal, translatedInEntries + scopedNativeWithoutEntries);
    return [{
      scope,
      totalCount: scopeTotal,
      translatedCount: translated,
      missingCount: Math.max(scopeTotal - translated, 0),
      percent: Math.round((translated / scopeTotal) * 100),
    }];
  });
  return {
    totalCount,
    translatedCount,
    missingCount: Math.max(totalCount - translatedCount, 0),
    staleCount,
    percent: totalCount === 0 ? 100 : Math.round((translatedCount / totalCount) * 100),
    exactPluginVersion: authorityPluginVersion(effectiveTranslation) === catalog.pluginVersion,
    scopes,
    unattributedNativeCount,
  };
}

export function mergePublishedPluginTranslation(
  catalog: PluginUiCatalog,
  incoming: PluginTranslationState,
  previous: PluginTranslationState | undefined,
): PluginTranslationState {
  void catalog;
  void previous;
  // A verified manifest is a complete active generation. Replacing the
  // dictionary prevents removed rows or an older sourceVersionId from leaking
  // into runtime state; immutable pack bytes remain independently cached.
  return incoming;
}

/**
 * An exact installed-artifact language pack wins over non-reviewed server text.
 * A reviewed correction remains the only permitted replacement for native text.
 */
export function mergeCatalogNativeTranslations(
  catalog: PluginUiCatalog | undefined,
  translation: PluginTranslationState,
): PluginTranslationState {
  if (catalog === undefined) return translation;
  const entries = new Map(translation.entries.map((entry) => [entry.source, entry]));
  const nativeTargets = failClosedCatalogNativeTargets(catalog, translation.targetLocale);
  const originsBySource = new Map(catalog.strings.map((item) => [
    item.source.normalize("NFC").trim(),
    item.origins,
  ]));
  for (const [source, nativeTarget] of nativeTargets) {
    const existing = entries.get(source);
    if (
      existing?.provenanceKind === "th-reviewed-correction"
      && existing.application === "correction"
    ) continue;
    entries.set(source, {
      pluginId: translation.pluginId,
      source,
      target: nativeTarget,
      provenanceKind: "upstream-native",
      scopes: resolvePluginStringScopes(originsBySource.get(source) ?? []),
    });
  }
  return { ...translation, entries: [...entries.values()] };
}

function failClosedCatalogNativeTargets(
  catalog: PluginUiCatalog,
  targetLocale: string,
): ReadonlyMap<string, string> {
  const nativeTargets = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const item of catalog.strings) {
    if (item.nativeTargetLocale !== targetLocale || item.nativeTarget === undefined) continue;
    const source = item.source.normalize("NFC").trim();
    const target = item.nativeTarget.normalize("NFC").trim();
    if (conflicts.has(source)) continue;
    if (
      source === target
      || target.trim() === ""
      || placeholderSignature(source) !== item.placeholderSignature
      || placeholderSignature(target) !== item.placeholderSignature
    ) {
      nativeTargets.delete(source);
      conflicts.add(source);
      continue;
    }
    const existing = nativeTargets.get(source);
    if (existing !== undefined && existing !== target) {
      nativeTargets.delete(source);
      conflicts.add(source);
      continue;
    }
    nativeTargets.set(source, target);
  }
  return nativeTargets;
}

export function selectCurrentCatalogTranslations(
  catalog: PluginUiCatalog | undefined,
  translation: PluginTranslationState,
  includeMetadata = true,
): readonly PluginUiTranslation[] {
  if (catalog === undefined) return [];
  const catalogBySource = new Map(catalog.strings.map((item) => [item.source, item]));
  const currentSources = groupCatalogStringsBySource({
    strings: catalog.strings.filter(
      (item) => includeMetadata || resolvePluginStringScopes(item.origins).includes("runtime-ui"),
    ),
  });
  const crossVersion = authorityPluginVersion(translation) !== catalog.pluginVersion;
  return mergeCatalogNativeTranslations(catalog, translation).entries
    .filter((entry) => isCompatibleCatalogEntry(
      entry,
      currentSources.get(entry.source),
      crossVersion,
    ))
    .map((entry) => {
      const { sourceCompatibility: compatibilityEvidence, ...runtimeEntry } = entry;
      void compatibilityEvidence;
      return {
        ...runtimeEntry,
        scopes: resolvePluginStringScopes(catalogBySource.get(entry.source)?.origins ?? []),
      };
    });
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
    && isCompatibleCatalogEntry(
      entry,
      [nameString],
      authorityPluginVersion(translation) !== catalog.pluginVersion,
    ));
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
    && isCompatibleCatalogEntry(
      entry,
      [descriptionString],
      authorityPluginVersion(translation) !== catalog.pluginVersion,
    ));
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

function isCompatibleCatalogEntry(
  entry: PluginUiTranslation,
  candidates: readonly PluginUiCatalog["strings"][number][] | undefined,
  crossVersion: boolean,
): boolean {
  if (candidates?.length !== 1) return false;
  const source = candidates[0];
  if (source === undefined
    || placeholderSignature(entry.source) !== source.placeholderSignature
    || placeholderSignature(entry.target) !== source.placeholderSignature) return false;
  if (!crossVersion || entry.provenanceKind === "upstream-native") return true;
  const compatibility = entry.sourceCompatibility;
  const scopes = [...resolvePluginStringScopes(source.origins)].sort();
  const semanticRole = source.semanticRole ?? resolvePluginStringSemanticRole(source.origins);
  return compatibility !== undefined
    && compatibility.semanticRole === semanticRole
    && compatibility.placeholderSignature === source.placeholderSignature
    && compatibility.formatSignature === "plain-text-v1"
    && compatibility.contentScopes.length === scopes.length
    && compatibility.contentScopes.every((scope, index) => scope === scopes[index]);
}

function groupCatalogStringsBySource(
  catalog: Pick<PluginUiCatalog, "strings">,
): ReadonlyMap<string, readonly PluginUiCatalog["strings"][number][]> {
  const grouped = new Map<string, PluginUiCatalog["strings"][number][]>();
  for (const item of catalog.strings) {
    const candidates = grouped.get(item.source) ?? [];
    candidates.push(item);
    grouped.set(item.source, candidates);
  }
  return grouped;
}

function authorityPluginVersion(translation: PluginTranslationState): string {
  return translation.authorityPluginVersion ?? translation.pluginVersion;
}
