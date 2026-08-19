import {
  computeSourceCatalogIdentity,
  type SourceCatalogIdentity,
} from "@trans-hub/client-protocol";

import { sha256Hex } from "./identity";
import type { InstalledObsidianPlugin } from "./plugin-discovery";
import { extractPluginReadmeStrings } from "./plugin-readme";

export type PluginStringOrigin =
  | "manifest.name"
  | "manifest.description"
  | "registry.name"
  | "registry.description"
  | "readme"
  | "ui-call"
  | "ui-property";
export type PluginStringExtractionStrategy = "manifest" | "registry" | "markdown" | "structured" | "regex-fallback";
export type PluginStringSemanticRole = "official-name" | "description" | "readme" | "runtime-ui";

export function isCanonicalPluginCatalogString(
  item: Pick<PluginUiString, "origins">,
): boolean {
  return item.origins.some(
    (origin) => origin !== "registry.name" && origin !== "registry.description",
  );
}
export type PluginContentScope = "runtime-ui" | "metadata" | "readme";

export interface PluginStringEvidence {
  readonly origin: PluginStringOrigin;
  readonly strategy: PluginStringExtractionStrategy;
  readonly symbol: string;
  readonly offset: number | null;
  readonly line: number | null;
  readonly column: number | null;
  /** Exact static JS literal span, only for a structured, proven UI sink. */
  readonly literalStart?: number;
  readonly literalEnd?: number;
}

export interface PluginUiString {
  readonly key: string;
  readonly source: string;
  readonly origins: readonly PluginStringOrigin[];
  /** Optional for persisted catalogs; fresh scans always populate it. */
  readonly semanticRole?: PluginStringSemanticRole;
  readonly placeholderSignature: string;
  /** Target-language text embedded in this exact installed plugin artifact. */
  readonly nativeTarget?: string;
  /** Locale for nativeTarget; both fields are present together. */
  readonly nativeTargetLocale?: string;
  /** Optional for persisted v1 catalogs; fresh scans always populate it. */
  readonly evidence?: readonly PluginStringEvidence[];
}

export interface PluginUiCatalog {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly pluginVersion: string;
  readonly sourceLocale: string;
  readonly digest: string;
  readonly artifactDigest: string;
  /** Bumped when persisted catalogs gain patch-safe literal evidence. */
  readonly patchEvidenceRevision?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  /** Missing only on catalogs persisted before identity revision 1. */
  readonly catalogIdentity?: SourceCatalogIdentity;
  readonly strings: readonly PluginUiString[];
  readonly scannedAt: string;
}

interface CandidateAggregate {
  readonly origins: Set<PluginStringOrigin>;
  readonly evidence: Map<string, PluginStringEvidence>;
}

export interface Token {
  readonly kind: "identifier" | "literal" | "punctuation" | "other";
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
}

interface RenderedExpression {
  readonly text: string;
  readonly staticText: string;
}

interface EmbeddedCatalogScan {
  readonly nativeTargets: ReadonlyMap<string, string> | null;
  readonly tokens: readonly Token[] | null;
}

type MatchingTokenIndexes = Int32Array;

const DYNAMIC_PLACEHOLDER_PREFIX = "th:expr:";
const UI_CALL_NAMES = new Set([
  "Notice", "setText", "setButtonText", "setName", "setDesc", "setPlaceholder",
  "setTooltip", "setTitle", "addHeading", "appendText",
]);
const UI_PROPERTY_NAMES = new Set([
  "name", "description", "text", "placeholder", "label", "tooltip", "title", "header", "desc",
  "message", "buttonText", "ariaLabel", "caption", "subtitle", "summary", "warning", "error", "success", "hint",
]);
// DOM text sinks assigned through member expressions (for example Svelte
// compiled `p1.textContent = "..."` or `this.summary.innerText = "..."`).
// Unlike object properties they cannot be configuration literals, so a
// member-expression receiver is sufficient proof of a presentation sink.
const DOM_TEXT_SINK_PROPERTIES = new Set(["textContent", "innerText", "innerHTML"]);
// Obsidian DOM creation helpers that accept a display-text option:
// `container.createEl("h4", { text: "..." })` and the createSpan/createDiv/
// createButton wrappers. The text option is a proven presentation sink.
const OBSIDIAN_CREATE_CALL_NAMES = new Set([
  "createEl", "createSpan", "createDiv", "createButton",
]);
const UI_CONTEXT_SIGNAL_PROPERTIES = new Set([
  "callback", "checkCallback", "editorCallback", "editorCheckCallback", "onClick", "onclick",
]);
const SAFE_NATIVE_DOM_TAG_NAMES = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "button",
  "caption", "cite", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt", "em",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
  "h6", "header", "hgroup", "i", "input", "ins", "label", "legend", "li", "main", "mark",
  "menu", "meter", "nav", "ol", "optgroup", "option", "output", "p", "progress", "q", "rp",
  "rt", "ruby", "s", "section", "select", "small", "span", "strong", "sub", "summary", "sup",
  "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "time", "tr", "u", "ul",
]);
const SAFE_NATIVE_DOM_VISIBLE_PROPERTIES = new Set([
  "aria-label", "ariaLabel", "placeholder", "title",
]);
const MAX_NESTED_CREATE_ELEMENT_DEPTH = 8;
const SETTINGS_SCHEMA_MIN_ENTRIES = 3;
const SETTINGS_SCHEMA_MAX_PARENT_TOKENS = 20_000;
const SETTINGS_SCHEMA_MAX_ENTRY_TOKENS = 500;
const QUOTED = String.raw`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\])*\x60)`;
const QUOTED_NO_CAPTURE = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\])*\x60)`;
const UI_CALL = new RegExp(String.raw`(?:Notice|setText|setButtonText|setName|setDesc|setPlaceholder|setTooltip|setTitle|addHeading|appendText)\s*\(\s*${QUOTED}`, "gu");
const OPTION_CALL = new RegExp(String.raw`addOption\s*\(\s*${QUOTED}\s*,\s*${QUOTED}`, "gu");
const UI_PROPERTY = new RegExp(String.raw`(?:name|description|text|placeholder|label|tooltip|title|header|desc|message|buttonText|ariaLabel|caption|subtitle|summary|warning|error|success|hint)\s*:\s*${QUOTED}`, "gu");
const TEXT_CONTENT_ASSIGNMENT = new RegExp(String.raw`\.textContent\s*=\s*${QUOTED}`, "gu");
const INNER_TEXT_ASSIGNMENT = new RegExp(String.raw`\.innerText\s*=\s*${QUOTED}`, "gu");
const INNER_HTML_ASSIGNMENT = new RegExp(String.raw`\.innerHTML\s*=\s*${QUOTED}`, "gu");
const OBSIDIAN_CREATE_TEXT = new RegExp(
  String.raw`\b(?:createEl|createSpan|createDiv|createButton)\s*\(\s*(?:${QUOTED_NO_CAPTURE}\s*,\s*)?\{[^{}]{0,512}?\btext\s*:\s*${QUOTED}`,
  "gu",
);
const REACT_DEFAULT_CREATE_ELEMENT_CHILD = new RegExp(
  String.raw`\b[A-Za-z_$][A-Za-z0-9_$]*\.default\.createElement\(\s*(?:${QUOTED_NO_CAPTURE}|[A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*(?:null|\{[^{}]{0,4096}\})\s*,\s*${QUOTED}`,
  "gud",
);
const REACT_DEFAULT_CREATE_ELEMENT_PROPERTY = new RegExp(
  String.raw`\b[A-Za-z_$][A-Za-z0-9_$]*\.default\.createElement\(\s*(?:${QUOTED_NO_CAPTURE}|[A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*\{[^{}]{0,4096}?\b(?:placeholder|title|aria-label)\s*:\s*${QUOTED}`,
  "gud",
);
// Obsidian's community installer may append this source-map suppression comment
// after downloading a release asset. It is not part of the publisher's artifact.
const COMMUNITY_INSTALLER_NO_SOURCEMAP_SUFFIX = "\n/* nosourcemap */";
const INLINE_SOURCE_MAP_LINE = "\n//# sourceMappingURL=";
const MAX_EMBEDDED_LOCALE_CATALOG_ENTRIES = 10_000;
const UI_TEXT_DICTIONARY_MIN_GROUPS = 3;
const UI_TEXT_DICTIONARY_MIN_VALUES = 30;
const UI_TEXT_DICTIONARY_MIN_TITLE_RATIO = 0.85;
const UI_TEXT_DICTIONARY_MAX_DEPTH = 3;
/** Conservative English function/UI words used to tell the English settings
 * schema apart from a plugin's other Latin-script language packs (German,
 * Dutch, Portuguese, ...), which share the same `name`/`desc` object shape. */
const ENGLISH_SCHEMA_STOP_WORDS = new RegExp(
  String.raw`\b(?:the|of|to|and|for|with|from|is|are|show|select|choose|display|when|how|if|not|all|new|default|file|folder|note|list|view|setting|option|enable|disable|sort|group|title|name|value|item|this|that|you|your|will|can|also|only|size|color|icon|date|time|field|property|text|page|row|column|pane|panel|window|open|close|add|remove|edit|save|apply|back|next|previous|first|last|other|same|each|between|during|after|before|above|below|left|right|top|bottom|into|out|more|less|most|least|few|many|much|such|both|every|own|another|use|hide)\b`,
  "iu",
);
const ENGLISH_SCHEMA_MIN_DESC_SAMPLES = 5;
const ENGLISH_SCHEMA_MIN_HIT_RATIO = 0.8;

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
  addCandidate(collected, input.plugin.name, "manifest.name", sourceLocale, {
    origin: "manifest.name", strategy: "manifest", symbol: "manifest.name", offset: null, line: null, column: null,
  });
  addCandidate(collected, input.plugin.description, "manifest.description", sourceLocale, {
    origin: "manifest.description", strategy: "manifest", symbol: "manifest.description", offset: null, line: null, column: null,
  });
  if (input.registryMetadata !== undefined) {
    addCandidate(collected, input.registryMetadata.name, "registry.name", sourceLocale, {
      origin: "registry.name", strategy: "registry", symbol: "community-plugins.name", offset: null, line: null, column: null,
    });
    addCandidate(collected, input.registryMetadata.description, "registry.description", sourceLocale, {
      origin: "registry.description", strategy: "registry", symbol: "community-plugins.description", offset: null, line: null, column: null,
    });
  }
  if (input.readmeMarkdown !== undefined) {
    for (const source of extractPluginReadmeStrings(input.readmeMarkdown)) {
      addCandidate(collected, source, "readme", sourceLocale, {
        origin: "readme", strategy: "markdown", symbol: "README.md", offset: null, line: null, column: null,
      });
    }
  }
  const embeddedCatalog = await collectEmbeddedEnglishCatalog(
    input.bundle,
    collected,
    sourceLocale,
    targetLocale,
  );
  const detectedNativeTargets = embeddedCatalog.nativeTargets;
  // An embedded English catalog is merged as upstream-native evidence, but it
  // is often partial (Style Settings ships a tiny locale pack over a large
  // hardcoded UI). The UI scan therefore always runs so hardcoded strings are
  // still collected; same-source entries deduplicate and keep their native
  // target metadata.
  const structuredScanSucceeded = embeddedCatalog.tokens !== null
    && collectStructuredMatches(
      embeddedCatalog.tokens,
      collected,
      sourceLocale,
    );
  if (!structuredScanSucceeded) {
    collectRegexMatches(input.bundle, UI_CALL, "ui-call", "ui-call", collected, sourceLocale);
    collectRegexMatches(input.bundle, OPTION_CALL, "ui-call", "addOption", collected, sourceLocale, 2);
    collectRegexMatches(input.bundle, UI_PROPERTY, "ui-property", "ui-property", collected, sourceLocale);
    collectRegexMatches(input.bundle, TEXT_CONTENT_ASSIGNMENT, "ui-property", "textContent", collected, sourceLocale, 1, true);
    collectRegexMatches(input.bundle, INNER_TEXT_ASSIGNMENT, "ui-property", "innerText", collected, sourceLocale, 1, true, singleLineText);
    collectRegexMatches(input.bundle, INNER_HTML_ASSIGNMENT, "ui-property", "innerHTML", collected, sourceLocale, 1, true, undefined, renderInnerHtmlText);
    collectRegexMatches(input.bundle, OBSIDIAN_CREATE_TEXT, "ui-property", "createEl", collected, sourceLocale, 1, true);
    collectAddOptionsRegexMatches(input.bundle, collected, sourceLocale);
    collectRegexMatches(input.bundle, REACT_DEFAULT_CREATE_ELEMENT_CHILD, "ui-call", "createElement", collected, sourceLocale);
    collectRegexMatches(input.bundle, REACT_DEFAULT_CREATE_ELEMENT_PROPERTY, "ui-property", "createElement", collected, sourceLocale, 1, true);
  }
  const nativeTargets = detectedNativeTargets ?? new Map<string, string>();
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
  const catalogIdentity = await computeSourceCatalogIdentity({
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
    patchEvidenceRevision: 10,
    catalogIdentity,
    strings,
    scannedAt: (input.now?.() ?? new Date()).toISOString(),
  };
}

/**
 * Stable digest of the installed release payload.  Keep the community
 * installer's source-map suppression suffix out of the identity so a routine
 * Obsidian download does not force a full UI scanner pass.
 */
export async function digestPluginBundle(bundle: string): Promise<string> {
  return sha256Hex(normalizeCommunityInstalledBundle(bundle));
}

/**
 * The community installer may append a source-map suppression comment after
 * downloading a release asset.  File patching and restore compare the same
 * logical artifact identity as the scanner, so the suffix is stripped there
 * too before hashing.
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
 * Digest scheme used by file-patch receipts.  Receipts must record the scheme
 * they were created with: the bundle normalization is a durable contract and
 * changing it silently invalidates every older receipt (restore then misreads
 * an intact patch as a conflict).
 */
export type PluginBundleDigestScheme = "bundle-v1" | "bundle-v2";

/**
 * Legacy normalization (receipt scheme `bundle-v1`, used until 2026-08-05):
 * only the community-installer no-sourcemap suffix was stripped.  No inline
 * source map handling and no trailing whitespace trim.
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
  // The community installer also deletes an inline source map comment (with
  // its preceding newline) before appending the suppression suffix, so the
  // installed artifact is byte-identical to the release asset minus that
  // line. The server adapter applies the same normalization to its
  // authoritative digest; stripping here keeps both sides equal even for
  // manually installed raw release assets.
  const mapIndex = withoutSuffix.lastIndexOf(INLINE_SOURCE_MAP_LINE);
  const withoutSourceMap = mapIndex >= 0
    ? withoutSuffix.slice(0, mapIndex)
    : withoutSuffix.startsWith("//# sourceMappingURL=") ? "" : withoutSuffix;
  return withoutSourceMap.trimEnd();
}

export function resolvePluginStringScopes(
  origins: readonly PluginStringOrigin[],
): readonly PluginContentScope[] {
  const scopes = new Set<PluginContentScope>();
  if (origins.some((origin) => origin === "ui-call" || origin === "ui-property")) {
    scopes.add("runtime-ui");
  }
  if (origins.some((origin) => origin === "manifest.name" || origin === "manifest.description"
    || origin === "registry.name" || origin === "registry.description")) {
    scopes.add("metadata");
  }
  if (origins.includes("readme")) scopes.add("readme");
  return [...scopes];
}

async function collectEmbeddedEnglishCatalog(
  bundle: string,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
  targetLocale: string | undefined,
): Promise<EmbeddedCatalogScan> {
  const packedNative = await collectStandalonePackedNativeCatalog(bundle, targetLocale);
  if (packedNative !== undefined) {
    addLocaleEntries(target, packedNative.english, sourceLocale);
    return { nativeTargets: packedNative.nativeTargets, tokens: null };
  }
  const tokens = tokenizeJavascript(bundle);
  if (tokens === null) return { nativeTargets: null, tokens: null };
  const assignments = new Map<string, readonly Token[]>();
  for (let index = 0; index < tokens.length - 2; index += 1) {
    const name = tokens[index];
    if (name?.kind !== "identifier" || tokens[index + 1]?.raw !== "=" || tokens[index + 2]?.raw !== "{") continue;
    const end = matchingTokenIndex(tokens, index + 2);
    if (end === -1) continue;
    assignments.set(name.raw, tokens.slice(index + 2, end + 1));
  }
  const packedEnglish = assignments.get("en");
  if (targetLocale !== undefined && packedEnglish !== undefined) {
    const englishEntries = collectBoundedLocaleEntries(packedEnglish);
    if (englishEntries !== undefined) {
      const nativeEntries = await collectNativeLocaleEntries(
        assignments,
        new Map(),
        targetLocale,
      );
      const nativeTargets = mapNativeTargets(englishEntries, nativeEntries);
      if (nativeTargets.size > 0) {
        addLocaleEntries(target, englishEntries, sourceLocale);
        return { nativeTargets, tokens };
      }
    }
  }
  for (const registry of assignments.values()) {
    const localeTargets = localeRegistryTargets(registry);
    if (localeTargets.size < 3) continue;
    const englishTarget = localeTargets.get("en");
    const english = englishTarget === undefined ? undefined : assignments.get(englishTarget);
    if (english === undefined) continue;
    const englishEntries = collectBoundedLocaleEntries(english);
    if (englishEntries === undefined) continue;
    addLocaleEntries(target, englishEntries, sourceLocale);
    if (targetLocale === undefined) return { nativeTargets: new Map(), tokens };
    const nativeEntries = await collectNativeLocaleEntries(
      assignments,
      localeTargets,
      targetLocale,
    );
    return { nativeTargets: mapNativeTargets(englishEntries, nativeEntries), tokens };
  }
  const exportedNative = collectExportedLocaleCatalog(tokens, targetLocale);
  if (exportedNative !== undefined) {
    addLocaleEntries(target, exportedNative.english, sourceLocale);
    return { nativeTargets: exportedNative.nativeTargets, tokens };
  }
  return { nativeTargets: null, tokens };
}

/**
 * Matches the adapter's compiled-bundle locale export form:
 * `STRINGS_EN: () => englishCatalog`.  Some plugins expose no runtime
 * registration calls at all, so falling through to the large-bundle regex
 * path would otherwise discard their canonical English UI catalog locally.
 */
function collectExportedLocaleCatalog(
  tokens: readonly Token[],
  targetLocale: string | undefined,
): { readonly english: readonly LocaleEntry[]; readonly nativeTargets: ReadonlyMap<string, string> } | undefined {
  const targets = new Map<string, string>();
  for (let index = 0; index + 6 < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    const match = /^STRINGS_([A-Z]{2,3}(?:_[A-Z0-9]{2,8})*)$/u.exec(token.raw);
    const target = tokens[index + 6];
    if (match === null || target?.kind !== "identifier") continue;
    const sequence = tokens.slice(index + 1, index + 6).map((entry) => entry?.raw);
    if (sequence.join("\u0000") !== [":", "(", ")", "=", ">"].join("\u0000")) continue;
    targets.set(target.raw, canonicalLocale(match[1]?.replaceAll("_", "-") ?? ""));
  }
  if (![...targets.values()].includes("en")) return undefined;

  const catalogs = new Map<string, readonly LocaleEntry[]>();
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    const locale = targets.get(tokens[index]?.raw ?? "");
    if (locale === undefined || tokens[index + 1]?.raw !== "=" || tokens[index + 2]?.raw !== "{") continue;
    const end = matchingTokenIndex(tokens, index + 2);
    if (end === -1) continue;
    const entries = collectBoundedLocaleEntries(tokens.slice(index + 2, end + 1));
    if (entries !== undefined) catalogs.set(locale, entries);
  }
  const english = catalogs.get("en");
  if (english === undefined) return undefined;
  const native = targetLocale === undefined
    ? []
    : (catalogs.get(canonicalLocale(targetLocale)) ?? []);
  return { english, nativeTargets: mapNativeTargets(english, native) };
}

async function collectStandalonePackedNativeCatalog(
  bundle: string,
  targetLocale: string | undefined,
): Promise<{ readonly english: readonly LocaleEntry[]; readonly nativeTargets: ReadonlyMap<string, string> } | undefined> {
  if (targetLocale === undefined) return undefined;
  const packedStart = bundle.indexOf("PLUGIN_LANGUAGES");
  if (packedStart === -1) return undefined;
  const packedSource = extractAssignedObjectLiteral(bundle, /\bPLUGIN_LANGUAGES\s*=\s*/gu, packedStart);
  if (packedSource === undefined) return undefined;
  const englishSource = extractAssignedObjectLiteral(bundle, /\b(?:var|let|const)\s+en\s*=\s*/gu, packedStart);
  if (englishSource === undefined) return undefined;
  const packedTokens = tokenizeJavascript(packedSource);
  const englishTokens = tokenizeJavascript(englishSource);
  if (packedTokens === null) return undefined;
  const packed = packedLocaleValue(packedTokens, targetLocale);
  if (packed === undefined) return undefined;
  const unpacked = await inflateBase64Deflate(packed);
  if (unpacked === undefined) return undefined;
  const nativeTokens = tokenizeJavascript(unpacked);
  const nativeObject = nativeTokens === null ? undefined : assignmentObjectTokens(nativeTokens);
  const english = englishTokens === null
    ? collectFlatLocaleEntries(englishSource)
    : collectLocaleEntries(englishTokens);
  const native = nativeObject === undefined
    ? collectFlatLocaleEntries(unpacked)
    : collectLocaleEntries(nativeObject);
  if (
    english.length === 0
    || english.length > MAX_EMBEDDED_LOCALE_CATALOG_ENTRIES
    || native.length > MAX_EMBEDDED_LOCALE_CATALOG_ENTRIES
  ) return undefined;
  const nativeTargets = mapNativeTargets(english, native);
  return { english, nativeTargets };
}

function collectFlatLocaleEntries(source: string): readonly LocaleEntry[] {
  const entries = new Map<string, LocaleEntry>();
  const pattern = /(?:^|[,{])\s*([A-Z][A-Z0-9_]*)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gu;
  for (const match of source.matchAll(pattern)) {
    const key = match[1];
    const rawValue = match[2];
    if (key === undefined || rawValue === undefined) continue;
    const value = decodeJsLiteral(rawValue);
    if (value === null) continue;
    const start = match.index ?? 0;
    entries.set(key, {
      path: key,
      symbol: { kind: "identifier", raw: key, start, end: start + key.length, line: 1, column: start },
      value: { text: value, staticText: value },
    });
  }
  return [...entries.values()];
}

function extractAssignedObjectLiteral(
  source: string,
  pattern: RegExp,
  startAt: number,
): string | undefined {
  pattern.lastIndex = startAt;
  const match = pattern.exec(source);
  if (match === null || match.index < startAt) return undefined;
  const open = source.indexOf("{", match.index + match[0].length);
  if (open === -1) return undefined;
  const localeEnd = source.indexOf("};let locale=null", open);
  if (localeEnd !== -1) return source.slice(open, localeEnd + 1);
  const close = matchingObjectBrace(source, open);
  return close === -1 ? undefined : source.slice(open, close + 1);
}

function matchingObjectBrace(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (character === "\\") { index += 1; continue; }
    if (character === "\"" || character === "'" || character === "`") {
      const end = findQuotedEnd(source, index, character);
      if (end === -1) return -1;
      index = end;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function assignmentObjectTokens(tokens: readonly Token[]): readonly Token[] | undefined {
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index]?.kind !== "identifier" || tokens[index + 1]?.raw !== "=" || tokens[index + 2]?.raw !== "{") continue;
    const end = matchingTokenIndex(tokens, index + 2);
    if (end !== -1) return tokens.slice(index + 2, end + 1);
  }
  return undefined;
}

function addLocaleEntries(
  target: Map<string, CandidateAggregate>,
  entries: readonly LocaleEntry[],
  sourceLocale: string,
): void {
  for (const entry of entries) {
    addCandidate(target, entry.value.text, "ui-property", sourceLocale, {
      origin: "ui-property",
      strategy: "structured",
      symbol: "locale:en",
      offset: entry.symbol.start,
      line: entry.symbol.line,
      column: entry.symbol.column,
    }, entry.value.staticText);
  }
}

function localeRegistryTargets(tokens: readonly Token[]): ReadonlyMap<string, string> {
  const targets = new Map<string, string>();
  if (tokens[0]?.raw !== "{" || matchingTokenIndex(tokens, 0) !== tokens.length - 1) return targets;
  for (const entry of splitTopLevelTokens(tokens.slice(1, -1))) {
    const colon = topLevelTokenIndex(entry, ":");
    if (colon <= 0) continue;
    const key = staticCatalogKey(entry.slice(0, colon));
    const value = entry.slice(colon + 1);
    if (key === null || value.length !== 1 || value[0]?.kind !== "identifier") continue;
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/u.test(key)) continue;
    targets.set(canonicalLocale(key), value[0].raw);
  }
  return targets;
}

function canonicalLocale(value: string): string {
  const parts = value.split("-");
  const canonical = parts.map((part, index) => {
    if (index === 0) return part.toLowerCase();
    if (part.length === 4) return part[0]?.toUpperCase() + part.slice(1).toLowerCase();
    if (part.length === 2) return part.toUpperCase();
    return part.toLowerCase();
  }).join("-");
  // Obsidian has historically used bare `zh` for Simplified Chinese.
  return canonical === "zh" ? "zh-CN" : canonical;
}

interface LocaleEntry {
  readonly path: string;
  readonly symbol: Token;
  readonly value: RenderedExpression;
}

function collectLocaleEntries(
  tokens: readonly Token[],
  path: readonly string[] = [],
): readonly LocaleEntry[] {
  if (tokens[0]?.raw === "{" && matchingTokenIndex(tokens, 0) === tokens.length - 1) {
    const entries: LocaleEntry[] = [];
    for (const entry of splitTopLevelTokens(tokens.slice(1, -1))) {
      const colon = topLevelTokenIndex(entry, ":");
      if (colon <= 0) continue;
      const key = staticCatalogKey(entry.slice(0, colon));
      if (key === null) continue;
      entries.push(...collectLocaleEntries(entry.slice(colon + 1), [...path, key]));
    }
    return entries;
  }
  if (tokens[0]?.raw === "[" && matchingTokenIndex(tokens, 0) === tokens.length - 1) {
    return splitTopLevelTokens(tokens.slice(1, -1))
      .flatMap((entry, index) => collectLocaleEntries(entry, [...path, String(index)]));
  }
  const counter = { value: 0 };
  const rendered = renderExpression(tokens, counter);
  const symbol = tokens[0];
  return rendered === null || symbol === undefined
    ? []
    : [{ path: path.join("\u0000"), symbol, value: rendered }];
}

function collectBoundedLocaleEntries(tokens: readonly Token[]): readonly LocaleEntry[] | undefined {
  const entries = collectLocaleEntries(tokens);
  return entries.length > 0 && entries.length <= MAX_EMBEDDED_LOCALE_CATALOG_ENTRIES
    ? entries
    : undefined;
}

async function collectNativeLocaleEntries(
  assignments: ReadonlyMap<string, readonly Token[]>,
  localeTargets: ReadonlyMap<string, string>,
  targetLocale: string,
): Promise<readonly LocaleEntry[]> {
  const target = localeTargets.get(canonicalLocale(targetLocale));
  if (target !== undefined) {
    const tokens = assignments.get(target);
    if (tokens !== undefined) return collectBoundedLocaleEntries(tokens) ?? [];
  }
  const packed = packedLocaleValue(assignments.get("PLUGIN_LANGUAGES"), targetLocale);
  if (packed === undefined) return [];
  const unpacked = await inflateBase64Deflate(packed);
  if (unpacked === undefined) return [];
  const tokens = tokenizeJavascript(unpacked);
  if (tokens === null) return [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index]?.kind !== "identifier" || tokens[index + 1]?.raw !== "=" || tokens[index + 2]?.raw !== "{") continue;
    const end = matchingTokenIndex(tokens, index + 2);
    if (end !== -1) return collectBoundedLocaleEntries(tokens.slice(index + 2, end + 1)) ?? [];
  }
  return [];
}

function packedLocaleValue(tokens: readonly Token[] | undefined, targetLocale: string): string | undefined {
  if (tokens === undefined || tokens[0]?.raw !== "{" || matchingTokenIndex(tokens, 0) !== tokens.length - 1) return undefined;
  const canonicalTarget = canonicalLocale(targetLocale);
  for (const entry of splitTopLevelTokens(tokens.slice(1, -1))) {
    const colon = topLevelTokenIndex(entry, ":");
    if (colon <= 0 || canonicalLocale(staticCatalogKey(entry.slice(0, colon)) ?? "") !== canonicalTarget) continue;
    const value = entry.slice(colon + 1);
    if (value.length !== 1 || value[0]?.kind !== "literal") continue;
    const decoded = decodeJsLiteral(value[0].raw);
    if (decoded !== null && decoded.length <= 1_000_000) return decoded;
  }
  return undefined;
}

async function inflateBase64Deflate(value: string): Promise<string | undefined> {
  if (typeof DecompressionStream === "undefined") return undefined;
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    const unpacked = await new Response(stream).text();
    return unpacked.length <= 2_000_000 ? unpacked : undefined;
  } catch {
    return undefined;
  }
}

function mapNativeTargets(
  english: readonly LocaleEntry[],
  native: readonly LocaleEntry[],
): ReadonlyMap<string, string> {
  const nativeByPath = new Map(native.map((entry) => [entry.path, entry.value]));
  const targets = new Map<string, string>();
  // string_key is derived from the normalized source, not the locale resource
  // path. Any unsafe path therefore invalidates native coverage for that source.
  const rejectedSources = new Set<string>();
  for (const source of english) {
    const target = nativeByPath.get(source.path);
    if (target === undefined || target.text.trim() === "") continue;
    const normalizedSource = source.value.text.normalize("NFC").trim();
    const normalizedTarget = target.text.normalize("NFC").trim();
    if (rejectedSources.has(normalizedSource)) continue;
    if (
      normalizedSource === normalizedTarget
      || placeholderSignature(normalizedSource) !== placeholderSignature(normalizedTarget)
    ) {
      targets.delete(normalizedSource);
      rejectedSources.add(normalizedSource);
      continue;
    }
    const existing = targets.get(normalizedSource);
    if (existing !== undefined && existing !== normalizedTarget) {
      targets.delete(normalizedSource);
      rejectedSources.add(normalizedSource);
      continue;
    }
    targets.set(normalizedSource, normalizedTarget);
  }
  return targets;
}

function splitTopLevelTokens(tokens: readonly Token[]): readonly (readonly Token[])[] {
  const result: Token[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token.raw === "(" || token.raw === "[" || token.raw === "{") depth += 1;
    else if (token.raw === ")" || token.raw === "]" || token.raw === "}") depth -= 1;
    if (token.raw === "," && depth === 0) result.push([]);
    else result.at(-1)?.push(token);
  }
  return result;
}

function topLevelTokenIndex(tokens: readonly Token[], expected: string): number {
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const raw = tokens[index]?.raw;
    if (raw === "(" || raw === "[" || raw === "{") depth += 1;
    else if (raw === ")" || raw === "]" || raw === "}") depth -= 1;
    else if (raw === expected && depth === 0) return index;
  }
  return -1;
}

function staticCatalogKey(tokens: readonly Token[]): string | null {
  if (tokens.length !== 1) return null;
  if (tokens[0]?.kind === "identifier") return tokens[0].raw;
  if (tokens[0]?.kind === "literal") return decodeJsLiteral(tokens[0].raw);
  return null;
}

export function resolvePluginStringSemanticRole(
  origins: Iterable<PluginStringOrigin>,
): PluginStringSemanticRole {
  const values = new Set(origins);
  if (values.has("manifest.name") || values.has("registry.name")) return "official-name";
  if (values.has("manifest.description") || values.has("registry.description")) return "description";
  if (values.has("readme")) return "readme";
  return "runtime-ui";
}

function collectStructuredMatches(
  tokens: readonly Token[],
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): boolean {
  const matching = buildMatchingTokenIndexes(tokens);
  if (matching === null) return false;
  const uiContextPropertyIndices = findUiRegistrationContextPropertyIndices(tokens);
  const createElementEnds: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    while (createElementEnds.at(-1) !== undefined && (createElementEnds.at(-1) ?? -1) < index) {
      createElementEnds.pop();
    }
    const token = tokens[index];
    if (token?.kind !== "identifier") continue;
    const next = tokens[index + 1];
    if (isSafeReactCreateElementCall(tokens, index) && next?.raw === "(") {
      const call = readCallArguments(tokens, index + 1, matching);
      if (call === null) return false;
      if (createElementEnds.length < MAX_NESTED_CREATE_ELEMENT_DEPTH) {
        collectReactCreateElement(call.arguments, token, target, sourceLocale);
      }
      createElementEnds.push(call.endIndex);
      continue;
    }
    if ((UI_CALL_NAMES.has(token.raw) || token.raw === "addOption") && next?.raw === "(") {
      const call = readCallArguments(tokens, index + 1, matching);
      if (call === null) return false;
      const argumentIndex = token.raw === "addOption" ? 1 : 0;
      const expression = call.arguments[argumentIndex];
      if (expression !== undefined) {
        addStructuredExpression(target, expression, "ui-call", token, sourceLocale);
      }
      continue;
    }
    if (OBSIDIAN_CREATE_CALL_NAMES.has(token.raw) && next?.raw === "(") {
      const call = readCallArguments(tokens, index + 1, matching);
      if (call === null) return false;
      for (const argument of call.arguments) {
        collectObsidianCreateTextOption(argument, token, target, sourceLocale);
      }
      continue;
    }
    if (token.raw === "addOptions" && next?.raw === "(") {
      const call = readCallArguments(tokens, index + 1, matching);
      if (call === null) return false;
      const options = call.arguments[0];
      if (options !== undefined) {
        collectAddOptionsLabels(options, token, target, sourceLocale);
      }
      continue;
    }
    if (
      DOM_TEXT_SINK_PROPERTIES.has(token.raw)
      && next?.raw === "="
      && isMemberExpressionReceiver(tokens, index)
    ) {
      const expression = readPropertyExpression(tokens, index + 2);
      if (expression.length === 0) continue;
      if (token.raw === "innerHTML") {
        const counter = { value: 0 };
        const rendered = renderExpression(expression, counter);
        if (rendered === null) continue;
        const text = innerHtmlTextContent(rendered.text);
        if (text === null) continue;
        addCandidate(target, text, "ui-property", sourceLocale, {
          origin: "ui-property", strategy: "structured", symbol: "innerHTML",
          offset: token.start, line: token.line, column: token.column,
        }, text, true);
        continue;
      }
      addStructuredExpression(
        target,
        expression,
        "ui-property",
        token,
        sourceLocale,
        true,
        token.raw === "innerText" ? singleLineText : undefined,
      );
      continue;
    }
    if (
      createElementEnds.length === 0
      && UI_PROPERTY_NAMES.has(token.raw)
      && next?.raw === ":"
    ) {
      const expression = readPropertyExpression(tokens, index + 2);
      if (expression.length > 0) {
        addStructuredExpression(
          target,
          expression,
          "ui-property",
          token,
          sourceLocale,
          uiContextPropertyIndices.has(index),
        );
      }
    }
  }
  collectSettingsSchemaEntries(tokens, matching, target, sourceLocale);
  collectSettingsGroupDescriptors(tokens, matching, target, sourceLocale);
  collectGroupedUiTextDictionary(tokens, matching, target, sourceLocale);
  return true;
}

/**
 * Plugins such as make.md keep their UI copy in a grouped literal object
 * (`var wfe={hintText:{fileName:"Enter File Name"},timeUnits:{hour:"Hour"},
 * aggregates:{values:"Values",...},...}`) that no UI sink call ever
 * references directly. The plugin's own language manager renders every entry
 * as an editable UI string, so the leaves are presentation text.
 *
 * Only a grouped, title-case dictionary is accepted: the outer object must
 * contain several nested group objects, most leaf string values must read as
 * title-case English UI copy, and there must be enough of them. Flat lookup
 * tables (keyboard key names, HTML entities, emoji descriptors, easing
 * function names, locale codes) are rejected by the group or ratio gate.
 */
function collectGroupedUiTextDictionary(
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  for (let index = 0; index < tokens.length - 2; index += 1) {
    const name = tokens[index];
    if (name?.kind !== "identifier" || tokens[index + 1]?.raw !== "=" || tokens[index + 2]?.raw !== "{") continue;
    const before = index === 0 ? null : tokens[index - 1];
    if (
      before !== null
      && before.raw !== "var"
      && before.raw !== "let"
      && before.raw !== "const"
      && before.raw !== ";"
      && before.raw !== ","
    ) continue;
    const open = index + 2;
    const end = matching[open];
    if (end === -1 || end - open > SETTINGS_SCHEMA_MAX_PARENT_TOKENS) continue;
    const groups = collectUiTextDictionaryGroups(
      tokens.slice(open + 1, end),
      sourceLocale,
      0,
    );
    if (
      groups.groupCount < UI_TEXT_DICTIONARY_MIN_GROUPS
      || groups.valueCount < UI_TEXT_DICTIONARY_MIN_VALUES
      || groups.titleCaseCount / groups.valueCount < UI_TEXT_DICTIONARY_MIN_TITLE_RATIO
    ) continue;
    for (const entry of groups.entries) {
      addCandidate(target, entry.value, "ui-property", sourceLocale, {
        origin: "ui-property",
        strategy: "structured",
        symbol: "dictionary",
        offset: entry.token.start,
        line: entry.token.line,
        column: entry.token.column,
      });
    }
  }
}

function collectUiTextDictionaryGroups(
  body: readonly Token[],
  sourceLocale: string,
  depth: number,
): {
  readonly groupCount: number;
  readonly valueCount: number;
  readonly titleCaseCount: number;
  readonly entries: readonly { readonly value: string; readonly token: Token }[];
} {
  let groupCount = 0;
  let valueCount = 0;
  let titleCaseCount = 0;
  const entries: { readonly value: string; readonly token: Token }[] = [];
  for (const entry of splitTopLevelTokens(body)) {
    if (entry.length === 0) continue;
    const colon = topLevelTokenIndex(entry, ":");
    if (colon <= 0) continue;
    const value = entry.slice(colon + 1);
    if (value.length === 0) continue;
    if (value[0]?.raw === "{" && depth < UI_TEXT_DICTIONARY_MAX_DEPTH) {
      groupCount += 1;
      const nested = collectUiTextDictionaryGroups(value.slice(1, -1), sourceLocale, depth + 1);
      groupCount += nested.groupCount;
      valueCount += nested.valueCount;
      titleCaseCount += nested.titleCaseCount;
      entries.push(...nested.entries);
      continue;
    }
    if (value.length !== 1 || value[0]?.kind !== "literal") continue;
    const decoded = decodeJsLiteral(value[0].raw);
    if (decoded === null || !isTranslatableUiText(decoded) || !isPlausibleSourceLocaleText(decoded, sourceLocale)) continue;
    valueCount += 1;
    if (isTitleCaseUiText(decoded)) titleCaseCount += 1;
    entries.push({ value: decoded, token: value[0] });
  }
  return { groupCount, valueCount, titleCaseCount, entries };
}

function isTitleCaseUiText(value: string): boolean {
  if (value.length < 2 || value.length > 200) return false;
  if (!/^[A-Za-z]/.test(value)) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (/[:/.[\]{}<>]/.test(value)) return false;
  return true;
}

function isMemberExpressionReceiver(tokens: readonly Token[], propertyIndex: number): boolean {
  // Accept `receiver.prop = ...` where receiver is an identifier chain such
  // as `p1.textContent`, `this.summary.innerText` or `refs.tab.innerText`.
  // Calls, indexing and arbitrary expressions remain unproven and are skipped.
  if (tokens[propertyIndex - 1]?.raw !== ".") return false;
  let index = propertyIndex - 2;
  if (tokens[index]?.raw === "this") return true;
  if (tokens[index]?.kind !== "identifier") return false;
  index -= 1;
  while (tokens[index]?.raw === "." && tokens[index - 1]?.kind === "identifier") index -= 2;
  return true;
}

/**
 * Declarative settings schemas such as make.md's
 * `{ navigatorEnabled: { name: "Navigator", desc: "..." }, ... }` render the
 * name/desc values as setting labels, but the outer keys are plugin-specific
 * identifiers, so they are only provable as presentation when the parent
 * object has several sibling entries that all carry a static `name` plus a
 * static `desc`/`description`. That bounded pattern keeps model metadata,
 * grammar rules and other configuration dictionaries out of the catalog.
 */
function collectSettingsSchemaEntries(
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  interface SchemaEntry {
    readonly key: Token;
    readonly valueOpen: number;
    readonly valueEnd: number;
  }
  const openBraces: number[] = [];
  const entriesByParent = new Map<number, SchemaEntry[]>();
  for (let index = 0; index < tokens.length; index += 1) {
    const raw = tokens[index]?.raw;
    if (raw === "{") {
      openBraces.push(index);
      continue;
    }
    if (raw === "}") {
      openBraces.pop();
      continue;
    }
    if (raw !== ":") continue;
    const key = tokens[index - 1];
    if (key?.kind !== "identifier" || tokens[index + 1]?.raw !== "{") continue;
    const valueEnd = matching[index + 1];
    if (
      valueEnd < 0
      || valueEnd - (index + 1) > SETTINGS_SCHEMA_MAX_ENTRY_TOKENS
    ) continue;
    const parent = openBraces.at(-1);
    if (parent === undefined) continue;
    const entries = entriesByParent.get(parent) ?? [];
    entries.push({ key, valueOpen: index + 1, valueEnd });
    entriesByParent.set(parent, entries);
  }
  for (const [parent, entries] of entriesByParent) {
    if (entries.length < SETTINGS_SCHEMA_MIN_ENTRIES) continue;
    if (matching[parent] - parent > SETTINGS_SCHEMA_MAX_PARENT_TOKENS) continue;
    const qualified = entries.filter((entry) => {
      const value = tokens.slice(entry.valueOpen, entry.valueEnd + 1);
      return staticObjectStringProperty(value, "name") !== undefined
        && (staticObjectStringProperty(value, "desc") !== undefined
          || staticObjectStringProperty(value, "description") !== undefined);
    });
    if (qualified.length < SETTINGS_SCHEMA_MIN_ENTRIES) continue;
    // Plugins such as notebook-navigator ship one full settings schema per
    // language. The English source catalog must only contain the English
    // schema; other Latin-script packs pass the character-level source-locale
    // filter, so judge the whole parent object by how much of its description
    // copy reads as English. With too few description samples the gate is
    // skipped to avoid dropping small but valid English schemas.
    if (sourceLocale === "en" && !isEnglishSettingsSchema(tokens, qualified)) continue;
    for (const entry of qualified) {
      const value = tokens.slice(entry.valueOpen, entry.valueEnd + 1);
      for (const property of ["name", "desc", "description"]) {
        const expression = staticObjectStringProperty(value, property);
        if (expression === undefined) continue;
        addSettingsSchemaValue(target, expression, entry.key, sourceLocale);
      }
    }
  }
}

function isEnglishSettingsSchema(
  tokens: readonly Token[],
  qualified: readonly { readonly key: Token; readonly valueOpen: number; readonly valueEnd: number }[],
): boolean {
  const samples: string[] = [];
  for (const entry of qualified) {
    const value = tokens.slice(entry.valueOpen, entry.valueEnd + 1);
    for (const property of ["desc", "description"]) {
      const expression = staticObjectStringProperty(value, property);
      if (expression === undefined || expression[0]?.kind !== "literal") continue;
      const decoded = decodeJsLiteral(expression[0].raw);
      if (decoded !== null && decoded.length > 5) samples.push(decoded);
    }
  }
  if (samples.length < ENGLISH_SCHEMA_MIN_DESC_SAMPLES) return true;
  let hits = 0;
  for (const sample of samples) {
    ENGLISH_SCHEMA_STOP_WORDS.lastIndex = 0;
    if (ENGLISH_SCHEMA_STOP_WORDS.test(sample)) hits += 1;
  }
  return hits / samples.length >= ENGLISH_SCHEMA_MIN_HIT_RATIO;
}

function staticObjectStringProperty(
  object: readonly Token[],
  property: string,
): readonly Token[] | undefined {
  for (const prop of splitTopLevelTokens(object.slice(1, -1))) {
    const colon = topLevelTokenIndex(prop, ":");
    if (colon <= 0) continue;
    if (staticCatalogKey(prop.slice(0, colon)) !== property) continue;
    const value = prop.slice(colon + 1);
    if (value.length === 1 && value[0]?.kind === "literal") return value;
  }
  return undefined;
}

function addSettingsSchemaValue(
  target: Map<string, CandidateAggregate>,
  expression: readonly Token[],
  key: Token,
  sourceLocale: string,
): void {
  const counter = { value: 0 };
  const rendered = renderExpression(expression, counter);
  if (rendered === null) return;
  const literal = expression[0];
  addCandidate(target, rendered.text, "ui-property", sourceLocale, {
    origin: "ui-property",
    strategy: "structured",
    symbol: "settingsSchema",
    offset: key.start,
    line: key.line,
    column: key.column,
    ...(literal === undefined ? {} : { literalStart: literal.start, literalEnd: literal.end }),
  }, rendered.staticText, true);
}

function collectObsidianCreateTextOption(
  argument: readonly Token[],
  callToken: Token,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  const options = stripWrappingParentheses(argument);
  if (options[0]?.raw !== "{" || matchingTokenIndex(options, 0) !== options.length - 1) return;
  for (const entry of splitTopLevelTokens(options.slice(1, -1))) {
    const colon = topLevelTokenIndex(entry, ":");
    if (colon <= 0) continue;
    const key = staticCatalogKey(entry.slice(0, colon));
    if (key !== "text") continue;
    addStructuredExpression(
      target,
      entry.slice(colon + 1),
      "ui-property",
      callToken,
      sourceLocale,
      true,
    );
  }
}

/**
 * Obsidian DropdownComponent labels: `dropdown.addOptions({ never: "Never",
 * "bullet-only": "Stick cursor out of bullets", ... })`. The option keys are
 * identifiers while the values are the user-visible labels, so every static
 * string value of the options object is a proven presentation sink.
 */
function collectAddOptionsLabels(
  argument: readonly Token[],
  callToken: Token,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  const options = stripWrappingParentheses(argument);
  if (options[0]?.raw !== "{" || matchingTokenIndex(options, 0) !== options.length - 1) return;
  for (const entry of splitTopLevelTokens(options.slice(1, -1))) {
    const colon = topLevelTokenIndex(entry, ":");
    if (colon <= 0) continue;
    const value = entry.slice(colon + 1);
    if (value.length !== 1 || value[0]?.kind !== "literal") continue;
    addStructuredExpression(
      target,
      value,
      "ui-property",
      callToken,
      sourceLocale,
      true,
    );
  }
}

/**
 * Regex fallback for `addOptions({ key: "Label", ... })`: find each options
 * object and collect every static string value inside it. Used only when
 * structured tokenization fails, mirroring the structured collector.
 */
function collectAddOptionsRegexMatches(
  bundle: string,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  const callPattern = /addOptions\s*\(\s*\{/gu;
  const entryPattern = /(?:[A-Za-z_$][A-Za-z0-9_$]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/gu;
  for (const call of bundle.matchAll(callPattern)) {
    const start = call.index + call[0].length;
    const end = Math.min(bundle.length, start + 4_096);
    const body = bundle.slice(start, end);
    const close = body.indexOf("}");
    if (close === -1) continue;
    const location = offsetLocation(bundle, call.index);
    for (const entry of body.slice(0, close).matchAll(entryPattern)) {
      const literal = entry[1];
      if (literal === undefined) continue;
      const rendered = renderFallbackLiteral(literal);
      if (rendered === null) continue;
      const entryIndex = entry.index ?? 0;
      const literalStart = start + entryIndex + entry[0].indexOf(literal);
      addCandidate(target, rendered.text, "ui-property", sourceLocale, {
        origin: "ui-property",
        strategy: "regex-fallback",
        symbol: "addOptions",
        offset: call.index,
        line: location.line,
        column: location.column,
        ...(literal.includes("${") ? {} : { literalStart, literalEnd: literalStart + literal.length }),
      }, rendered.staticText, true);
    }
  }
}

/**
 * Declarative settings-group descriptors such as QuickAdd's and Minimal
 * theme settings' `{ type: "group", heading: "Choice picker", items: [
 * { name: "Search nested choices", desc: "..." } ] }`. The static `heading`
 * and the item `name`/`desc`/`description` values are user-visible labels;
 * requiring the `type` + `heading` + `items` trio keeps configuration
 * objects without a heading out.
 */
function collectSettingsGroupDescriptors(
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.raw !== "{") continue;
    const end = matching[index];
    if (end < 0 || end - index > SETTINGS_SCHEMA_MAX_PARENT_TOKENS) continue;
    const object = tokens.slice(index, end + 1);
    const typeValue = staticObjectStringProperty(object, "type");
    const headingValue = staticObjectStringProperty(object, "heading");
    const items = staticObjectArrayProperty(object, "items");
    if (typeValue === undefined || headingValue === undefined || items === undefined) continue;
    const itemCount = items.filter((item) => staticObjectStringProperty(item, "name") !== undefined).length;
    if (itemCount < 1) continue;
    const descriptorKey = tokens[index + 1] ?? tokens[index] ?? headingValue[0];
    addSettingsSchemaValue(target, headingValue, descriptorKey, sourceLocale);
    for (const item of items) {
      for (const property of ["name", "desc", "description"]) {
        const expression = staticObjectStringProperty(item, property);
        if (expression !== undefined) {
          addSettingsSchemaValue(target, expression, descriptorKey, sourceLocale);
        }
      }
    }
  }
}

function staticObjectArrayProperty(
  object: readonly Token[],
  property: string,
): readonly (readonly Token[])[] | undefined {
  for (const prop of splitTopLevelTokens(object.slice(1, -1))) {
    const colon = topLevelTokenIndex(prop, ":");
    if (colon <= 0) continue;
    if (staticCatalogKey(prop.slice(0, colon)) !== property) continue;
    const value = stripWrappingParentheses(prop.slice(colon + 1));
    if (value[0]?.raw !== "[" || matchingTokenIndex(value, 0) !== value.length - 1) continue;
    return splitTopLevelTokens(value.slice(1, -1));
  }
  return undefined;
}

function isSafeReactCreateElementCall(tokens: readonly Token[], index: number): boolean {
  if (tokens[index - 1]?.raw !== ".") return false;
  if (tokens[index - 2]?.raw === "React" || tokens[index - 2]?.raw === "ReactDOM") return true;
  // Bundlers commonly rewrite `React.createElement` to
  // `interop(require_react()).default.createElement`.  Accept only that
  // default-interop shape; plain `factory.createElement` remains rejected.
  return tokens[index - 2]?.raw === "default"
    && tokens[index - 3]?.raw === "."
    && tokens[index - 4]?.kind === "identifier";
}

function collectReactCreateElement(
  args: readonly (readonly Token[])[],
  callToken: Token,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  const tagExpression = stripWrappingParentheses(args[0] ?? []);
  const tagName = tagExpression.length === 1 && tagExpression[0]?.kind === "literal"
    ? decodeJsLiteral(tagExpression[0].raw)
    : null;
  const nativeTag = tagName !== null && SAFE_NATIVE_DOM_TAG_NAMES.has(tagName);
  const componentTag = tagExpression.length === 1 && tagExpression[0]?.kind === "identifier";
  if (!nativeTag && !componentTag) return;

  const properties = args[1];
  if (properties !== undefined) {
    collectNativeDomVisibleProperties(properties, callToken, target, sourceLocale, nativeTag || componentTag);
  }
  for (const child of args.slice(2)) {
    addSafeNativeDomExpression(target, child, "ui-call", callToken, "createElement", sourceLocale);
  }
}

function collectNativeDomVisibleProperties(
  expression: readonly Token[],
  callToken: Token,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
  acceptsChildren: boolean,
): void {
  const properties = stripWrappingParentheses(expression);
  if (properties[0]?.raw !== "{" || matchingTokenIndex(properties, 0) !== properties.length - 1) return;
  for (const entry of splitTopLevelTokens(properties.slice(1, -1))) {
    const colon = topLevelTokenIndex(entry, ":");
    if (colon <= 0) continue;
    const key = staticCatalogKey(entry.slice(0, colon));
    if (key === "children" && acceptsChildren) {
      addSafeNativeDomExpression(
        target, entry.slice(colon + 1), "ui-call", callToken, "createElement", sourceLocale,
      );
      continue;
    }
    if (key === null || !SAFE_NATIVE_DOM_VISIBLE_PROPERTIES.has(key)) continue;
    const keyToken = entry[0] ?? callToken;
    addSafeNativeDomExpression(
      target, entry.slice(colon + 1), "ui-property", keyToken, key, sourceLocale, true,
    );
  }
}

function addSafeNativeDomExpression(
  target: Map<string, CandidateAggregate>,
  expression: readonly Token[],
  origin: PluginStringOrigin,
  symbol: Token,
  symbolName: string,
  sourceLocale: string,
  uiContextVerified = false,
): void {
  const counter = { value: 0 };
  const rendered = renderSafeNativeDomExpression(expression, counter);
  if (rendered === null) return;
  addCandidate(target, rendered.text, origin, sourceLocale, withPatchableLiteral({
    origin, strategy: "structured", symbol: symbolName,
    offset: symbol.start, line: symbol.line, column: symbol.column,
  }, expression), rendered.staticText, uiContextVerified);
}

function addStructuredExpression(
  target: Map<string, CandidateAggregate>,
  expression: readonly Token[],
  origin: PluginStringOrigin,
  symbol: Token,
  sourceLocale: string,
  uiContextVerified = false,
  acceptRendered?: (rendered: RenderedExpression) => boolean,
): void {
  const counter = { value: 0 };
  const rendered = renderExpression(expression, counter);
  if (rendered === null) return;
  if (acceptRendered !== undefined && !acceptRendered(rendered)) return;
  addCandidate(target, rendered.text, origin, sourceLocale, withPatchableLiteral({
    origin,
    strategy: "structured",
    symbol: symbol.raw,
    offset: symbol.start,
    line: symbol.line,
    column: symbol.column,
  }, expression), rendered.staticText, uiContextVerified);
}

function withPatchableLiteral(
  evidence: PluginStringEvidence,
  expression: readonly Token[],
): PluginStringEvidence {
  const literal = stripWrappingParentheses(expression);
  const token = literal.length === 1 ? literal[0] : undefined;
  if (token?.kind !== "literal" || (token.raw.startsWith("`") && token.raw.includes("${"))) return evidence;
  return { ...evidence, literalStart: token.start, literalEnd: token.end };
}

function findUiRegistrationContextPropertyIndices(tokens: readonly Token[]): ReadonlySet<number> {
  const delimiterStack: { readonly raw: "(" | "[" | "{"; readonly index: number }[] = [];
  const braceStack: number[] = [];
  const propertyObjects = new Map<number, number>();
  const registrationObjects = new Set<number>();
  const matchingOpen = Object.create(null) as Record<string, "(" | "[" | "{">;
  matchingOpen[")"] = "("; matchingOpen["]"] = "["; matchingOpen["}"] = "{";

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    const expectedOpen = matchingOpen[token.raw];
    if (Object.hasOwn(matchingOpen, token.raw)) {
      const top = delimiterStack.at(-1);
      if (top?.raw === expectedOpen) {
        delimiterStack.pop();
        if (expectedOpen === "{" && braceStack.at(-1) === top.index) braceStack.pop();
      }
      continue;
    }

    const openIndex = braceStack.at(-1);
    if (
      token.kind === "identifier"
      && tokens[index + 1]?.raw === ":"
      && openIndex !== undefined
      && isObjectLiteralOpen(tokens, openIndex)
    ) {
      if (UI_PROPERTY_NAMES.has(token.raw)) propertyObjects.set(index, openIndex);
      const top = delimiterStack.at(-1);
      if (
        UI_CONTEXT_SIGNAL_PROPERTIES.has(token.raw)
        && top?.raw === "{"
        && top.index === openIndex
      ) registrationObjects.add(openIndex);
    }

    if (token.raw === "(" || token.raw === "[" || token.raw === "{") {
      delimiterStack.push({ raw: token.raw, index });
      if (token.raw === "{") braceStack.push(index);
    }
  }

  return new Set(
    [...propertyObjects]
      .filter(([, openIndex]) => registrationObjects.has(openIndex))
      .map(([propertyIndex]) => propertyIndex),
  );
}

function isObjectLiteralOpen(tokens: readonly Token[], openIndex: number): boolean {
  const previous = tokens[openIndex - 1]?.raw;
  return previous !== undefined
    && ["=", "(", "[", ",", ":", "return", ">"].includes(previous);
}

function renderExpression(tokens: readonly Token[], counter: { value: number }): RenderedExpression | null {
  const expression = stripWrappingParentheses(tokens);
  if (expression.length === 1 && expression[0]?.kind === "literal") {
    const token = expression[0];
    if (token.raw.startsWith("`")) return renderTemplateLiteral(token.raw, counter);
    const decoded = decodeJsLiteral(token.raw);
    return decoded === null ? null : { text: decoded, staticText: decoded };
  }
  const plus = findLastTopLevelPlus(expression);
  if (plus === -1) {
    const transparentArgument = transparentWrapperArgument(expression);
    return transparentArgument === null ? null : renderExpression(transparentArgument, counter);
  }
  const left = renderExpression(expression.slice(0, plus), counter);
  const rightTokens = expression.slice(plus + 1);
  if (left !== null) {
    const right = renderExpression(rightTokens, counter);
    return right === null
      ? { text: left.text + nextDynamicPlaceholder(counter), staticText: left.staticText }
      : { text: left.text + right.text, staticText: left.staticText + right.staticText };
  }
  const right = renderExpression(rightTokens, counter);
  return right === null
    ? null
    : { text: nextDynamicPlaceholder(counter) + right.text, staticText: right.staticText };
}

function transparentWrapperArgument(tokens: readonly Token[]): readonly Token[] | null {
  if (
    tokens.length < 3
    || tokens[0]?.kind !== "identifier"
    || tokens[1]?.raw !== "("
    || matchingTokenIndex(tokens, 1) !== tokens.length - 1
  ) return null;
  const arguments_ = splitTopLevelTokens(tokens.slice(2, -1));
  const argument = arguments_[0];
  return arguments_.length === 1 && argument !== undefined && argument.length > 0 ? argument : null;
}

function renderSafeNativeDomExpression(
  tokens: readonly Token[],
  counter: { value: number },
): RenderedExpression | null {
  const expression = stripWrappingParentheses(tokens);
  if (expression.length === 1 && expression[0]?.kind === "literal") {
    const token = expression[0];
    if (token.raw.startsWith("`")) return renderSafeNativeDomTemplateLiteral(token.raw, counter);
    const decoded = decodeJsLiteral(token.raw);
    return decoded === null ? null : { text: decoded, staticText: decoded };
  }
  const plus = findLastTopLevelPlus(expression);
  if (plus !== -1) {
    const left = renderSafeNativeDomExpression(expression.slice(0, plus), counter);
    const right = renderSafeNativeDomExpression(expression.slice(plus + 1), counter);
    return left === null || right === null
      ? null
      : { text: left.text + right.text, staticText: left.staticText + right.staticText };
  }
  return isSafeNativeDomDynamicReference(expression)
    ? { text: nextDynamicPlaceholder(counter), staticText: "" }
    : null;
}

function renderSafeNativeDomTemplateLiteral(
  raw: string,
  counter: { value: number },
): RenderedExpression | null {
  const body = raw.slice(1, -1);
  let text = "";
  let staticText = "";
  let chunk = "";
  for (let index = 0; index < body.length;) {
    const character = body[index] ?? "";
    if (character === "\\") {
      if (index + 1 >= body.length) return null;
      chunk += body.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character !== "$" || body[index + 1] !== "{") {
      chunk += character;
      index += 1;
      continue;
    }
    const decoded = decodeJsLiteral(`\`${chunk}\``);
    if (decoded === null) return null;
    text += decoded;
    staticText += decoded;
    chunk = "";
    const end = findTemplateExpressionEnd(body, index + 2);
    if (end === -1) return null;
    const dynamicTokens = tokenizeJavascript(body.slice(index + 2, end));
    if (dynamicTokens === null || !isSafeNativeDomDynamicReference(dynamicTokens)) return null;
    text += nextDynamicPlaceholder(counter);
    index = end + 1;
  }
  const decoded = decodeJsLiteral(`\`${chunk}\``);
  if (decoded === null) return null;
  return { text: text + decoded, staticText: staticText + decoded };
}

function isSafeNativeDomDynamicReference(tokens: readonly Token[]): boolean {
  const expression = stripWrappingParentheses(tokens);
  const first = expression[0];
  if (
    first?.kind !== "identifier"
    || ["false", "null", "true", "undefined"].includes(first.raw)
  ) return false;
  for (let index = 1; index < expression.length;) {
    if (expression[index]?.raw === "." && expression[index + 1]?.kind === "identifier") {
      index += 2;
      continue;
    }
    if (
      expression[index]?.raw === "?"
      && expression[index + 1]?.raw === "."
      && expression[index + 2]?.kind === "identifier"
    ) {
      index += 3;
      continue;
    }
    return false;
  }
  return true;
}

function renderTemplateLiteral(raw: string, counter: { value: number }): RenderedExpression | null {
  const body = raw.slice(1, -1);
  let text = "";
  let staticText = "";
  let chunk = "";
  for (let index = 0; index < body.length;) {
    const character = body[index] ?? "";
    if (character === "\\") {
      if (index + 1 >= body.length) return null;
      chunk += body.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character !== "$" || body[index + 1] !== "{") {
      chunk += character;
      index += 1;
      continue;
    }
    const decoded = decodeJsLiteral(`\`${chunk}\``);
    if (decoded === null) return null;
    text += decoded;
    staticText += decoded;
    chunk = "";
    const end = findTemplateExpressionEnd(body, index + 2);
    if (end === -1) return null;
    text += nextDynamicPlaceholder(counter);
    index = end + 1;
  }
  const decoded = decodeJsLiteral(`\`${chunk}\``);
  if (decoded === null) return null;
  return { text: text + decoded, staticText: staticText + decoded };
}

function findTemplateExpressionEnd(body: string, start: number): number {
  let depth = 1;
  for (let index = start; index < body.length; index += 1) {
    const character = body[index] ?? "";
    if (character === "\\") { index += 1; continue; }
    if (character === "\"" || character === "'" || character === "`") {
      const end = findQuotedEnd(body, index, character);
      if (end === -1) return -1;
      index = end;
    } else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function nextDynamicPlaceholder(counter: { value: number }): string {
  const placeholder = `{{${DYNAMIC_PLACEHOLDER_PREFIX}${counter.value}}}`;
  counter.value += 1;
  return placeholder;
}

function stripWrappingParentheses(tokens: readonly Token[]): readonly Token[] {
  let current = tokens;
  while (current[0]?.raw === "(" && matchingTokenIndex(current, 0) === current.length - 1) {
    current = current.slice(1, -1);
  }
  return current;
}

function findLastTopLevelPlus(tokens: readonly Token[]): number {
  let depth = 0;
  let last = -1;
  for (let index = 0; index < tokens.length; index += 1) {
    const raw = tokens[index]?.raw;
    if (raw === "(" || raw === "[" || raw === "{") depth += 1;
    else if (raw === ")" || raw === "]" || raw === "}") depth -= 1;
    else if (raw === "+" && depth === 0) last = index;
  }
  return last;
}

function readCallArguments(
  tokens: readonly Token[],
  openIndex: number,
  matching: MatchingTokenIndexes,
): { readonly arguments: readonly (readonly Token[])[]; readonly endIndex: number } | null {
  const args: Token[][] = [[]];
  const endIndex = matching[openIndex] ?? -1;
  if (endIndex < 0) return null;
  for (let index = openIndex + 1; index < endIndex; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token.raw === "(" || token.raw === "[" || token.raw === "{") {
      const nestedEnd = matching[index] ?? -1;
      if (nestedEnd < 0 || nestedEnd > endIndex) return null;
      const argument = args.at(-1);
      if (argument === undefined) return null;
      // Do not spread an attacker-controlled token range into function
      // arguments: V8 rejects roughly 125k arguments with RangeError.
      for (let nestedIndex = index; nestedIndex <= nestedEnd; nestedIndex += 1) {
        const nestedToken = tokens[nestedIndex];
        if (nestedToken !== undefined) argument.push(nestedToken);
      }
      index = nestedEnd;
      continue;
    }
    if (token.raw === ",") args.push([]);
    else args.at(-1)?.push(token);
  }
  return { arguments: args, endIndex };
}

function buildMatchingTokenIndexes(tokens: readonly Token[]): MatchingTokenIndexes | null {
  const pairs = Object.create(null) as Record<string, string>;
  pairs["("] = ")"; pairs["["] = "]"; pairs["{"] = "}";
  const openingFor = Object.create(null) as Record<string, string>;
  openingFor[")"] = "("; openingFor["]"] = "["; openingFor["}"] = "{";
  const stack: { readonly raw: string; readonly index: number }[] = [];
  // A dense typed array keeps the index table proportional to the token
  // stream without the object/key overhead of Map on large minified bundles.
  const matching = new Int32Array(tokens.length);
  matching.fill(-1);
  for (let index = 0; index < tokens.length; index += 1) {
    const raw = tokens[index]?.raw;
    if (raw === undefined) continue;
    if (Object.hasOwn(pairs, raw)) {
      stack.push({ raw, index });
      continue;
    }
    const expected = openingFor[raw];
    if (!Object.hasOwn(openingFor, raw)) continue;
    const open = stack.pop();
    if (open?.raw !== expected) return null;
    matching[open.index] = index;
    matching[index] = open.index;
  }
  return stack.length === 0 ? matching : null;
}

function readPropertyExpression(tokens: readonly Token[], start: number): readonly Token[] {
  const result: Token[] = [];
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token.raw === "(" || token.raw === "[" || token.raw === "{") depth += 1;
    else if (token.raw === ")" || token.raw === "]" || token.raw === "}") {
      if (depth === 0) break;
      depth -= 1;
    }
    if (depth === 0 && (token.raw === "," || token.raw === ";")) break;
    result.push(token);
  }
  return result;
}

function matchingTokenIndex(tokens: readonly Token[], openIndex: number): number {
  const pairs = Object.create(null) as Record<string, string>;
  pairs["("] = ")"; pairs["["] = "]"; pairs["{"] = "}";
  const close = pairs[tokens[openIndex]?.raw ?? ""];
  if (close === undefined) return -1;
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index]?.raw === tokens[openIndex]?.raw) depth += 1;
    else if (tokens[index]?.raw === close && --depth === 0) return index;
  }
  return -1;
}

export function tokenizeJavascript(source: string): Token[] | null {
  const tokens: Token[] = [];
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) if (source[index] === "\n") lineStarts.push(index + 1);
  for (let index = 0; index < source.length;) {
    const character = source[index] ?? "";
    if (/\s/u.test(character)) { index += 1; continue; }
    if (character === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) break;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) return null;
      index = end + 2;
      continue;
    }
    const start = index;
    if (character === "/" && isRegexLiteralStart(tokens)) {
      const end = findRegexEnd(source, index);
      if (end === -1) {
        // Not a regex after all: division or another operator. A regex literal
        // containing a raw newline is invalid JavaScript, so falling back to
        // an operator token keeps large multi-line bundles tokenizable.
        index += 1;
        tokens.push(makeToken("other", character, start, index, lineStarts));
        continue;
      }
      index = end;
      while (index < source.length && /[A-Za-z]/u.test(source[index] ?? "")) index += 1;
      tokens.push(makeToken("other", source.slice(start, index), start, index, lineStarts));
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      const end = findQuotedEnd(source, index, character);
      if (end === -1) return null;
      index = end + 1;
      tokens.push(makeToken("literal", source.slice(start, index), start, index, lineStarts));
      continue;
    }
    if (/[$_\p{L}]/u.test(character)) {
      index += 1;
      while (index < source.length && /[$_\p{L}\p{N}]/u.test(source[index] ?? "")) index += 1;
      tokens.push(makeToken("identifier", source.slice(start, index), start, index, lineStarts));
      continue;
    }
    index += 1;
    const kind = "()[]{}:,.+;?".includes(character) ? "punctuation" : "other";
    tokens.push(makeToken(kind, character, start, index, lineStarts));
  }
  return tokens;
}

function isRegexLiteralStart(tokens: readonly Token[]): boolean {
  const previous = tokens.at(-1)?.raw;
  if (previous === undefined) return true;
  return ["(", "[", "{", "=", ":", ",", ";", "!", "?", "+", "-", "*", "%", "&", "|", "^", "~", ">", "<"].includes(previous)
    || ["return", "case", "throw", "delete", "typeof", "void", "new", "in", "of"].includes(previous);
}

function findRegexEnd(source: string, start: number): number {
  let inCharacterClass = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") index += 1;
    else if (character === "\n" || character === "\r") return -1;
    else if (character === "[") inCharacterClass = true;
    else if (character === "]") inCharacterClass = false;
    else if (character === "/" && !inCharacterClass) return index + 1;
  }
  return -1;
}

function findQuotedEnd(source: string, start: number, quote: string): number {
  let templateDepth = 0;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") { index += 1; continue; }
    if (quote === "`") {
      if (character === "$" && source[index + 1] === "{") {
        templateDepth += 1;
        index += 1;
        continue;
      }
      if (character === "{" && templateDepth > 0) {
        templateDepth += 1;
        continue;
      }
      if (character === "}" && templateDepth > 0) {
        templateDepth -= 1;
        continue;
      }
    }
    if (character === quote && templateDepth === 0) return index;
  }
  return -1;
}

function makeToken(kind: Token["kind"], raw: string, start: number, end: number, lineStarts: readonly number[]): Token {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= start) low = middle;
    else high = middle;
  }
  return { kind, raw, start, end, line: low + 1, column: start - (lineStarts[low] ?? 0) };
}

function collectRegexMatches(
  bundle: string,
  pattern: RegExp,
  origin: PluginStringOrigin,
  symbol: string,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
  captureIndex = 1,
  uiContextVerified = false,
  acceptRendered?: (rendered: RenderedExpression) => boolean,
  transformRendered?: (rendered: RenderedExpression) => RenderedExpression | null,
): void {
  pattern.lastIndex = 0;
  for (const match of bundle.matchAll(pattern)) {
    const literal = match[captureIndex];
    if (literal === undefined) continue;
    const rendered = renderFallbackLiteral(literal);
    if (rendered === null) continue;
    if (acceptRendered !== undefined && !acceptRendered(rendered)) continue;
    const transformed = transformRendered === undefined ? rendered : transformRendered(rendered);
    if (transformed === null) continue;
    const location = offsetLocation(bundle, match.index);
    const literalStart = literalSpanStart(match, captureIndex);
    addCandidate(target, transformed.text, origin, sourceLocale, {
      origin, strategy: "regex-fallback", symbol, offset: match.index, line: location.line, column: location.column,
      ...(symbol === "innerHTML" || literalStart === undefined || literal.includes("${")
        ? {}
        : { literalStart, literalEnd: literalStart + literal.length }),
    }, transformed.staticText, uiContextVerified);
  }
}

/**
 * Setting `innerText` to a value containing line breaks makes Chromium split
 * the text into separate nodes around `<br>` elements, so the runtime exact
 * match cannot apply the translation as one unit. Such sinks fail closed;
 * `textContent` keeps a single text node and stays eligible.
 */
function singleLineText(rendered: RenderedExpression): boolean {
  return !/[\r\n]/u.test(rendered.text);
}

/**
 * `innerHTML = "<div class=\"icon\">Add Item</div>"` is a presentation sink,
 * but the browser parses the fragment, so the runtime matches the resulting
 * text nodes rather than the raw markup. Extract the static text content as
 * the source and never mark the markup literal as patchable: the file patch
 * would need an HTML-aware rewrite and is skipped for these entries.
 */
function renderInnerHtmlText(rendered: RenderedExpression): RenderedExpression | null {
  const text = innerHtmlTextContent(rendered.text);
  return text === null ? null : { text, staticText: text };
}

function innerHtmlTextContent(raw: string): string | null {
  if (typeof raw !== "string") return null;
  if (raw.includes("${") || raw.includes(`{{${DYNAMIC_PLACEHOLDER_PREFIX}`)) return null;
  const text = raw.replace(/<[^>]*>/gu, "").trim();
  return text === "" || !/\p{L}/u.test(text) ? null : text;
}

function literalSpanStart(match: RegExpMatchArray, captureIndex: number): number | undefined {
  const captured = match[captureIndex];
  if (captured === undefined) return undefined;
  const indices = match.indices;
  const span = indices?.[captureIndex];
  return span === undefined ? undefined : span[0];
}

function renderFallbackLiteral(raw: string): RenderedExpression | null {
  if (!raw.startsWith("`") || !raw.includes("${")) {
    const decoded = decodeJsLiteral(raw);
    return decoded === null ? null : { text: decoded, staticText: decoded };
  }
  return renderTemplateLiteral(raw, { value: 0 });
}

function addCandidate(
  target: Map<string, CandidateAggregate>,
  raw: string,
  origin: PluginStringOrigin,
  sourceLocale: string,
  evidence: PluginStringEvidence,
  staticProbe = raw,
  uiContextVerified = false,
): void {
  const value = raw.normalize("NFC").trim();
  const probe = staticProbe.normalize("NFC").trim();
  if (
    origin === "ui-property"
    && (UI_PROPERTY_NAMES.has(evidence.symbol) || evidence.symbol === "ui-property")
    && !uiContextVerified
  ) return;
  if (!isTranslatableUiText(value) || !isTranslatableUiText(probe) || !isPlausibleSourceLocaleText(value, sourceLocale)) return;
  const aggregate = target.get(value) ?? { origins: new Set<PluginStringOrigin>(), evidence: new Map<string, PluginStringEvidence>() };
  aggregate.origins.add(origin);
  aggregate.evidence.set(JSON.stringify(evidence), evidence);
  target.set(value, aggregate);
}

function compareEvidence(left: PluginStringEvidence, right: PluginStringEvidence): number {
  return (left.offset ?? -1) - (right.offset ?? -1)
    || left.origin.localeCompare(right.origin)
    || left.strategy.localeCompare(right.strategy)
    || left.symbol.localeCompare(right.symbol);
}

function compareUnicodeScalars(left: string, right: string): number {
  const leftScalars = [...left];
  const rightScalars = [...right];
  const length = Math.min(leftScalars.length, rightScalars.length);
  for (let index = 0; index < length; index += 1) {
    const leftCodePoint = leftScalars[index]?.codePointAt(0);
    const rightCodePoint = rightScalars[index]?.codePointAt(0);
    if (leftCodePoint === undefined || rightCodePoint === undefined) break;
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint;
  }
  return leftScalars.length - rightScalars.length;
}

function offsetLocation(source: string, offset: number): { readonly line: number; readonly column: number } {
  const prefix = source.slice(0, offset);
  const line = prefix.split("\n").length;
  const lastNewline = prefix.lastIndexOf("\n");
  return { line, column: offset - lastNewline - 1 };
}

export function isPlausibleSourceLocaleText(value: string, sourceLocale: string): boolean {
  if (sourceLocale !== "en") return true;
  let letterCount = 0;
  let latinLetterCount = 0;
  for (const character of value) {
    if (!/\p{L}/u.test(character)) continue;
    letterCount += 1;
    if (/\p{Script=Latin}/u.test(character)) latinLetterCount += 1;
  }
  return letterCount === 0 || latinLetterCount * 2 >= letterCount;
}

export function isTranslatableUiText(value: string): boolean {
  if (value.length < 2 || value.length > 300 || !/\p{L}/u.test(value)) return false;
  if (/^(?:https?:|data:|app:|obsidian:)/iu.test(value)) return false;
  if (/[/\\].+\.(?:js|ts|json|css|svg|png|md)$/iu.test(value)) return false;
  if (/^[a-z0-9_.-]+(?:\/[a-z0-9_.{}:-]+)+$/u.test(value)) return false;
  if (/^[.#][A-Za-z0-9_-]+$/u.test(value)) return false;
  if (/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+){2,}$/u.test(value)) return false;
  if (/^[a-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)+$/u.test(value)) return false;
  if (/^[A-Z_][A-Z0-9_]+$/u.test(value)) return false;
  if (/^%[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) return false;
  if (isLanguageNeutralStructuredLiteral(value)) return false;
  return true;
}

function isLanguageNeutralStructuredLiteral(value: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object") return false;
  return hasOnlyStructuredIdentifiers(parsed);
}

function hasOnlyStructuredIdentifiers(value: unknown): boolean {
  if (typeof value === "string") {
    return /^[A-Za-z_$][A-Za-z0-9_$.-]*$/u.test(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return true;
  if (Array.isArray(value)) return value.every(hasOnlyStructuredIdentifiers);
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.every(([key]) => isStructuredMachineKey(key))) return false;
  return entries.every(([, item]) => hasOnlyStructuredIdentifiers(item));
}

function isStructuredMachineKey(key: string): boolean {
  return /^(?:kind|type|id|action|actions|mode|scope|scopes|status|variant|version|enabled|disabled)$/iu.test(key)
    // Configuration examples such as {"folderSortOrder":"alpha-desc"} are
    // machine-readable values, not UI copy. Keep this narrow so JSON with
    // visible keys such as title and summary remains localizable.
    || /^[a-z][A-Za-z0-9]*(?:mode|order|sort|variant|scope|status|id|type|version)$/iu.test(key);
}

export function placeholderSignature(value: string): string {
  if (typeof value !== "string") return "";
  const placeholders = [...value.matchAll(/\$\{[^}]+\}|\{\{[^}]+\}\}|\{\d+\}|%[sdif]|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w:.-]*(?:=(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/gu)]
    .map((match) => match[0]);
  if (placeholders.length < 2) return placeholders[0] ?? "";
  return JSON.stringify(placeholders);
}

export function decodeJsLiteral(literal: string): string | null {
  const quote = literal[0];
  if ((quote !== "\"" && quote !== "'" && quote !== "`") || literal.at(-1) !== quote) return null;
  const body = literal.slice(1, -1);
  if (quote === "`" && body.includes("${")) return null;
  let output = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? "";
    if (character !== "\\") { output += character; continue; }
    const escaped = body[index + 1];
    if (escaped === undefined) return null;
    index += 1;
    if (escaped === "n") output += "\n";
    else if (escaped === "r") output += "\r";
    else if (escaped === "t") output += "\t";
    else if (escaped === "b") output += "\b";
    else if (escaped === "f") output += "\f";
    else if (escaped === "v") output += "\v";
    else if (escaped === "x") {
      const hex = body.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/iu.test(hex)) return null;
      output += String.fromCodePoint(Number.parseInt(hex, 16));
      index += 2;
    } else if (escaped === "u") {
      const hex = body.slice(index + 1, index + 5);
      if (!/^[0-9a-f]{4}$/iu.test(hex)) return null;
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint >= 0xD800 && codePoint <= 0xDFFF) return null;
      output += String.fromCodePoint(codePoint);
      index += 4;
    } else output += escaped;
  }
  return output;
}
