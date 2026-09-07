import {
  hasCompatiblePlaceholderSignature,
  resolvePluginStringScopes,
  resolvePluginStringSemanticRole,
  type PluginUiCatalog,
} from "./plugin-string-scanner";
import type { PluginTranslationState } from "./plugin-state";
import type { PublishedPluginSource } from "./plugin-source-resolution";
import type { PluginUiTranslation } from "./plugin-ui-runtime";
import type { TargetLocale } from "./product-config";

/** Pure semantic intersection between a verified export and local scan. */
export function validatePluginTranslations(
  catalog: PluginUiCatalog,
  rows: readonly {
    readonly stringKey: string;
    readonly translatedText: string;
    readonly provenanceKind?: PluginUiTranslation["provenanceKind"];
    readonly application?: PluginUiTranslation["application"];
    readonly nativeTarget?: string;
    readonly sourceCompatibility?: PluginUiTranslation["sourceCompatibility"];
  }[],
  sourceVersionId: string,
  targetLocale: TargetLocale,
  upstreamNativeCount = 0,
  published?: PublishedPluginSource,
): PluginTranslationState {
  const authorityPluginVersion = published?.authorityPluginVersion ?? catalog.pluginVersion;
  const crossVersion = authorityPluginVersion !== catalog.pluginVersion;
  const sourcesByKey = new Map<string, PluginUiCatalog["strings"][number][]>();
  for (const item of catalog.strings) {
    const candidates = sourcesByKey.get(item.key) ?? [];
    candidates.push(item);
    sourcesByKey.set(item.key, candidates);
  }
  const matchingRows = rows.filter((row) => {
    const sources = sourcesByKey.get(row.stringKey);
    if (sources?.length !== 1) return false;
    return !crossVersion || sourceCompatibilityMatches(sources[0], row.sourceCompatibility);
  });
  if (!crossVersion && rows.length > 0 && matchingRows.length === 0) {
    throw new Error(`插件译文与本地扫描结果没有安全交集：${catalog.pluginId}`);
  }
  const occurrenceEntries = matchingRows.flatMap((row) => {
    const source = sourcesByKey.get(row.stringKey)?.[0];
    if (source === undefined) return [];
    const target = row.translatedText.normalize("NFC").trim();
    if (target === "") {
      if (crossVersion) return [];
      throw new Error(`插件译文为空：${row.stringKey}`);
    }
    if (!hasCompatiblePlaceholderSignature(source.source, target)) {
      if (crossVersion) return [];
      throw new Error(`插件译文占位符不匹配：${catalog.pluginId}:${row.stringKey}`);
    }
    const nativeTarget = row.nativeTarget?.normalize("NFC").trim();
    if (row.application === "correction") {
      if (row.provenanceKind !== "th-reviewed-correction" || nativeTarget === undefined || nativeTarget === "") {
        if (crossVersion) return [];
        throw new Error(`插件校订缺少已审核的原生目标：${catalog.pluginId}:${row.stringKey}`);
      }
      if (!hasCompatiblePlaceholderSignature(source.source, nativeTarget)) {
        if (crossVersion) return [];
        throw new Error(`插件原生目标占位符不匹配：${catalog.pluginId}:${row.stringKey}`);
      }
    }
    return [{
      pluginId: catalog.pluginId,
      source: source.source,
      target,
      scopes: resolvePluginStringScopes(source.origins),
      ...(row.sourceCompatibility === undefined ? {} : { sourceCompatibility: row.sourceCompatibility }),
      ...(row.provenanceKind === undefined ? {} : { provenanceKind: row.provenanceKind }),
      ...(row.application === undefined ? {} : { application: row.application }),
      ...(nativeTarget === undefined ? {} : { nativeTarget }),
    }];
  });
  const entriesBySource = new Map<string, PluginUiTranslation>();
  const ambiguousSources = new Set<string>();
  for (const entry of occurrenceEntries) {
    if (ambiguousSources.has(entry.source)) continue;
    const previous = entriesBySource.get(entry.source);
    if (previous === undefined) {
      entriesBySource.set(entry.source, entry);
      continue;
    }
    // The runtime can prove a plugin/settings owner, but it cannot distinguish
    // two DOM occurrences of the same source text inside that owner. Equal
    // occurrence projections may collapse; conflicting projections must fail
    // closed instead of whichever row happened to arrive last winning.
    if (!sameRuntimeProjection(previous, entry)) {
      if (crossVersion) {
        entriesBySource.delete(entry.source);
        ambiguousSources.add(entry.source);
        continue;
      }
      throw new Error(`插件译文同源 occurrence 冲突：${catalog.pluginId}:${entry.source}`);
    }
  }
  const entries = [...entriesBySource.values()];
  return {
    pluginId: catalog.pluginId,
    pluginVersion: catalog.pluginVersion,
    authorityPluginVersion,
    sourceVersionId,
    ...(published?.sourceSnapshotDigest === undefined
      ? {}
      : { sourceSnapshotDigest: published.sourceSnapshotDigest }),
    ...(published?.artifactDigest === undefined ? {} : { artifactDigest: published.artifactDigest }),
    ...(published?.catalogIdentity === undefined ? {} : { catalogIdentity: published.catalogIdentity }),
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

function sourceCompatibilityMatches(
  source: PluginUiCatalog["strings"][number],
  compatibility: PluginUiTranslation["sourceCompatibility"],
): boolean {
  if (compatibility === undefined) return false;
  const expectedScopes = [...resolvePluginStringScopes(source.origins)].sort();
  const expectedRole = source.semanticRole ?? resolvePluginStringSemanticRole(source.origins);
  // sourceContentDigest is intentionally retained but not compared here. The
  // server hashes exact raw UTF-8 source bytes, while this persisted client
  // catalog stores NFC-normalized text and cannot reconstruct those bytes.
  return compatibility.semanticRole === expectedRole
    && compatibility.placeholderSignature === source.placeholderSignature
    && compatibility.formatSignature === "plain-text-v1"
    && compatibility.contentScopes.length === expectedScopes.length
    && compatibility.contentScopes.every((scope, index) => scope === expectedScopes[index]);
}

function sameRuntimeProjection(
  left: PluginUiTranslation,
  right: PluginUiTranslation,
): boolean {
  return left.target === right.target
    && left.provenanceKind === right.provenanceKind
    && left.application === right.application
    && left.nativeTarget === right.nativeTarget
    && sameSourceCompatibility(left.sourceCompatibility, right.sourceCompatibility);
}

function sameSourceCompatibility(
  left: PluginUiTranslation["sourceCompatibility"],
  right: PluginUiTranslation["sourceCompatibility"],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.semanticRole === right.semanticRole
    && left.placeholderSignature === right.placeholderSignature
    && left.formatSignature === right.formatSignature
    && left.sourceContentDigest === right.sourceContentDigest
    && left.contentScopes.length === right.contentScopes.length
    && left.contentScopes.every((scope, index) => scope === right.contentScopes[index]);
}
