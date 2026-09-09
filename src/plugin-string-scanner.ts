import {
  computeSourceCatalogIdentity,
  type SourceCatalogIdentity,
} from "@trans-hub/client-protocol";

import { sha256Hex } from "./identity";
import {
  addCandidate,
  compareEvidence,
  compareUnicodeScalars,
  isCanonicalPluginCatalogString,
  placeholderSignature,
  resolvePluginStringScopes,
  resolvePluginStringSemanticRole,
  type CandidateAggregate,
  type PluginStringOrigin,
  type PluginUiCatalog,
  type PluginUiString,
} from "./plugin-string-scanner-evidence";
import {
  collectRegexFallbackMatches,
  collectStructuredMatches,
} from "./plugin-string-scanner-outputs";
import {
  canonicalLocale,
  collectEmbeddedEnglishCatalog,
} from "./plugin-string-scanner-structure";
import type { InstalledObsidianPlugin } from "./plugin-discovery";
import { extractPluginReadmeStrings } from "./plugin-readme";

export type {
  PluginContentScope,
  PluginStringEvidence,
  PluginStringExtractionStrategy,
  PluginStringOrigin,
  PluginStringSemanticRole,
  PluginUiCatalog,
  PluginUiString,
} from "./plugin-string-scanner-evidence";
export {
  decodeJsLiteral,
  hasCompatiblePlaceholderSignature,
  isCanonicalPluginCatalogString,
  isPlausibleSourceLocaleText,
  isTranslatableUiText,
  placeholderSignature,
  resolvePluginStringScopes,
  resolvePluginStringSemanticRole,
} from "./plugin-string-scanner-evidence";
export type { Token } from "./plugin-string-scanner-lexical";
export { tokenizeJavascript } from "./plugin-string-scanner-lexical";

const COMMUNITY_INSTALLER_NO_SOURCEMAP_SUFFIX = "\n/* nosourcemap */";
const INLINE_SOURCE_MAP_LINE = "\n//# sourceMappingURL=";

export async function scanPluginUiStrings(input: {
  readonly plugin: InstalledObsidianPlugin;
  readonly registryMetadata?: {
    readonly name: string;
    readonly description: string;
  };
  readonly readmeMarkdown?: string;
  readonly bundle: string;
  readonly sourceLocale: string;
  /** The active target locale; used only for local upstream-native detection. */
  readonly targetLocale?: string;
  readonly now?: () => Date;
}): Promise<PluginUiCatalog> {
  const sourceLocale = canonicalLocale(input.sourceLocale);
  const targetLocale = input.targetLocale === undefined
    ? undefined
    : canonicalLocale(input.targetLocale);
  const collected = new Map<string, CandidateAggregate>();

  addMetadataCandidates(input, collected, sourceLocale);

  const embeddedCatalog = await collectEmbeddedEnglishCatalog(
    input.bundle,
    collected,
    sourceLocale,
    targetLocale,
  );
  // Embedded catalogs are often partial, so hardcoded UI scanning always
  // continues. Structured parsing owns the normal path; damaged/unbalanced
  // bundles fail over to the conservative regex exits only.
  const structuredScanSucceeded = embeddedCatalog.tokens !== null
    && collectStructuredMatches(embeddedCatalog.tokens, collected, sourceLocale);
  if (!structuredScanSucceeded) {
    collectRegexFallbackMatches(input.bundle, collected, sourceLocale);
  }

  const nativeTargets = embeddedCatalog.nativeTargets ?? new Map<string, string>();
  const strings = await Promise.all([...collected.entries()]
    .sort(([left], [right]) => compareUnicodeScalars(left, right))
    .map(async ([source, aggregate]): Promise<PluginUiString> => ({
      key: (await sha256Hex(`${input.plugin.id}\u0000${source.normalize("NFC")}`)).slice(0, 32),
      source: source.normalize("NFC"),
      origins: [...aggregate.origins].sort(),
      semanticRole: resolvePluginStringSemanticRole(aggregate.origins),
      placeholderSignature: placeholderSignature(source),
      ...(targetLocale === undefined || nativeTargets.get(source.normalize("NFC")) === undefined
        ? {}
        : {
            nativeTarget: nativeTargets.get(source.normalize("NFC")),
            nativeTargetLocale: targetLocale,
          }),
      evidence: [...aggregate.evidence.values()].sort(compareEvidence),
    })));

  const artifactDigest = await digestPluginBundle(input.bundle);
  const canonicalStrings = strings.filter(isCanonicalPluginCatalogString);
  const canonicalUnits = canonicalStrings.map((item) => ({
    item,
    sourceKey: resolvePluginStringSourceKey(item.origins),
  }));
  const activeSourceKeys = new Set(canonicalUnits.map(({ sourceKey }) => sourceKey));
  const sourceDefinitions = [
    { key: "runtime", logicalPath: "main.js", formatFamily: "javascript" },
    { key: "metadata", logicalPath: "manifest.json", formatFamily: "json" },
    { key: "documentation", logicalPath: "README.md", formatFamily: "markdown" },
  ] as const;
  const catalogIdentity: SourceCatalogIdentity = await computeSourceCatalogIdentity({
    resourceKey: input.plugin.id,
    resourceVersion: input.plugin.version,
    sourceLocale,
    artifactDigest,
    sources: sourceDefinitions.filter((source) => activeSourceKeys.has(source.key)),
    units: canonicalUnits.map(({ item, sourceKey }) => ({
      key: item.key,
      text: item.source,
      placeholderSignature: item.placeholderSignature,
      formatSignature: "plain-text-v1",
      scopes: resolvePluginStringScopes(item.origins),
      sourceKey,
    })),
  }, { sha256Hex });

  return {
    pluginId: input.plugin.id,
    pluginName: input.plugin.name,
    pluginVersion: input.plugin.version,
    sourceLocale,
    digest: catalogIdentity.digest,
    artifactDigest,
    ...(targetLocale === undefined ? {} : { scannerTargetLocale: targetLocale }),
    patchEvidenceRevision: 11,
    catalogIdentity,
    strings,
    scannedAt: (input.now?.() ?? new Date()).toISOString(),
  };
}

function addMetadataCandidates(
  input: {
    readonly plugin: InstalledObsidianPlugin;
    readonly registryMetadata?: {
      readonly name: string;
      readonly description: string;
    };
    readonly readmeMarkdown?: string;
  },
  collected: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  addCandidate(collected, input.plugin.name, "manifest.name", sourceLocale, {
    origin: "manifest.name",
    strategy: "manifest",
    symbol: "manifest.name",
    offset: null,
    line: null,
    column: null,
  });
  addCandidate(collected, input.plugin.description, "manifest.description", sourceLocale, {
    origin: "manifest.description",
    strategy: "manifest",
    symbol: "manifest.description",
    offset: null,
    line: null,
    column: null,
  });
  if (input.registryMetadata !== undefined) {
    addCandidate(collected, input.registryMetadata.name, "registry.name", sourceLocale, {
      origin: "registry.name",
      strategy: "registry",
      symbol: "community-plugins.name",
      offset: null,
      line: null,
      column: null,
    });
    addCandidate(collected, input.registryMetadata.description, "registry.description", sourceLocale, {
      origin: "registry.description",
      strategy: "registry",
      symbol: "community-plugins.description",
      offset: null,
      line: null,
      column: null,
    });
  }
  if (input.readmeMarkdown !== undefined) {
    for (const source of extractPluginReadmeStrings(input.readmeMarkdown)) {
      addCandidate(collected, source, "readme", sourceLocale, {
        origin: "readme",
        strategy: "markdown",
        symbol: "README.md",
        offset: null,
        line: null,
        column: null,
      });
    }
  }
}

/**
 * Stable digest of the installed release payload. Keep the community
 * installer's source-map suppression suffix out of the identity so a routine
 * Obsidian download does not force a full UI scanner pass.
 */
export async function digestPluginBundle(bundle: string): Promise<string> {
  return sha256Hex(normalizeCommunityInstalledBundle(bundle));
}

/**
 * File patching and restore use the same logical artifact identity as scanning.
 */
export function normalizePluginBundle(bundle: string): string {
  return normalizeCommunityInstalledBundle(bundle);
}

function resolvePluginStringSourceKey(
  origins: readonly PluginStringOrigin[],
): "runtime" | "metadata" | "documentation" {
  if (origins.some((origin) => origin === "ui-call" || origin === "ui-property")) {
    return "runtime";
  }
  if (origins.some((origin) => origin === "manifest.name" || origin === "manifest.description")) {
    return "metadata";
  }
  return "documentation";
}

/**
 * Digest scheme used by file-patch receipts. Receipts must record their scheme
 * because normalization is a durable restore compatibility contract.
 */
export type PluginBundleDigestScheme = "bundle-v1" | "bundle-v2";

/**
 * Legacy normalization used by bundle-v1 receipts until 2026-08-05.
 */
export function normalizePluginBundleV1(bundle: string): string {
  return bundle.endsWith(COMMUNITY_INSTALLER_NO_SOURCEMAP_SUFFIX)
    ? bundle.slice(0, -COMMUNITY_INSTALLER_NO_SOURCEMAP_SUFFIX.length)
    : bundle;
}

export function normalizePluginBundleWithScheme(
  scheme: PluginBundleDigestScheme,
  bundle: string,
): string {
  return scheme === "bundle-v1"
    ? normalizePluginBundleV1(bundle)
    : normalizePluginBundle(bundle);
}

function normalizeCommunityInstalledBundle(bundle: string): string {
  const withoutSuffix = bundle.endsWith(COMMUNITY_INSTALLER_NO_SOURCEMAP_SUFFIX)
    ? bundle.slice(0, -COMMUNITY_INSTALLER_NO_SOURCEMAP_SUFFIX.length)
    : bundle;
  const mapIndex = withoutSuffix.lastIndexOf(INLINE_SOURCE_MAP_LINE);
  const withoutSourceMap = mapIndex >= 0
    ? withoutSuffix.slice(0, mapIndex)
    : withoutSuffix.startsWith("//# sourceMappingURL=") ? "" : withoutSuffix;
  return withoutSourceMap.trimEnd();
}
