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
export type PluginContentScope = "runtime-ui" | "metadata" | "readme";

export interface PluginStringEvidence {
  readonly origin: PluginStringOrigin;
  readonly strategy: PluginStringExtractionStrategy;
  readonly symbol: string;
  readonly offset: number | null;
  readonly line: number | null;
  readonly column: number | null;
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
  /** Missing only on catalogs persisted before identity revision 1. */
  readonly catalogIdentity?: SourceCatalogIdentity;
  readonly strings: readonly PluginUiString[];
  readonly scannedAt: string;
}

interface CandidateAggregate {
  readonly origins: Set<PluginStringOrigin>;
  readonly evidence: Map<string, PluginStringEvidence>;
}

interface Token {
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

const DYNAMIC_PLACEHOLDER_PREFIX = "th:expr:";
const UI_CALL_NAMES = new Set([
  "Notice", "setText", "setButtonText", "setName", "setDesc", "setPlaceholder",
  "setTooltip", "setTitle", "addHeading", "appendText",
]);
const UI_PROPERTY_NAMES = new Set([
  "name", "description", "text", "placeholder", "label", "tooltip", "title", "header", "desc",
  "message", "buttonText", "ariaLabel", "caption", "subtitle", "summary", "warning", "error", "success", "hint",
]);
const UI_CONTEXT_SIGNAL_PROPERTIES = new Set([
  "callback", "checkCallback", "editorCallback", "editorCheckCallback", "onClick", "onclick",
]);
const QUOTED = String.raw`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\])*\x60)`;
const UI_CALL = new RegExp(String.raw`(?:Notice|setText|setButtonText|setName|setDesc|setPlaceholder|setTooltip|setTitle|addHeading|appendText)\s*\(\s*${QUOTED}`, "gu");
const OPTION_CALL = new RegExp(String.raw`addOption\s*\(\s*${QUOTED}\s*,\s*${QUOTED}`, "gu");
const UI_PROPERTY = new RegExp(String.raw`(?:name|description|text|placeholder|label|tooltip|title|header|desc|message|buttonText|ariaLabel|caption|subtitle|summary|warning|error|success|hint)\s*:\s*${QUOTED}`, "gu");
// Obsidian's community installer may append this source-map suppression comment
// after downloading a release asset. It is not part of the publisher's artifact.
const COMMUNITY_INSTALLER_NO_SOURCEMAP_SUFFIX = "\n/* nosourcemap */";

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
  const collected = new Map<string, CandidateAggregate>();
  addCandidate(collected, input.plugin.name, "manifest.name", input.sourceLocale, {
    origin: "manifest.name", strategy: "manifest", symbol: "manifest.name", offset: null, line: null, column: null,
  });
  addCandidate(collected, input.plugin.description, "manifest.description", input.sourceLocale, {
    origin: "manifest.description", strategy: "manifest", symbol: "manifest.description", offset: null, line: null, column: null,
  });
  if (input.registryMetadata !== undefined) {
    addCandidate(collected, input.registryMetadata.name, "registry.name", input.sourceLocale, {
      origin: "registry.name", strategy: "registry", symbol: "community-plugins.name", offset: null, line: null, column: null,
    });
    addCandidate(collected, input.registryMetadata.description, "registry.description", input.sourceLocale, {
      origin: "registry.description", strategy: "registry", symbol: "community-plugins.description", offset: null, line: null, column: null,
    });
  }
  if (input.readmeMarkdown !== undefined) {
    for (const source of extractPluginReadmeStrings(input.readmeMarkdown)) {
      addCandidate(collected, source, "readme", input.sourceLocale, {
        origin: "readme", strategy: "markdown", symbol: "README.md", offset: null, line: null, column: null,
      });
    }
  }
  const detectedNativeTargets = await collectEmbeddedEnglishCatalog(
    input.bundle,
    collected,
    input.sourceLocale,
    input.targetLocale,
  );
  if (detectedNativeTargets === null) {
    const BUNDLE_STRUCTURED_SCAN_BYTE_LIMIT = 1_048_576;
    if (input.bundle.length <= BUNDLE_STRUCTURED_SCAN_BYTE_LIMIT) {
      if (!collectStructuredMatches(input.bundle, collected, input.sourceLocale)) {
        collectRegexMatches(input.bundle, UI_CALL, "ui-call", "ui-call", collected, input.sourceLocale);
        collectRegexMatches(input.bundle, OPTION_CALL, "ui-call", "addOption", collected, input.sourceLocale, 2);
        collectRegexMatches(input.bundle, UI_PROPERTY, "ui-property", "ui-property", collected, input.sourceLocale);
      }
    } else {
      collectRegexMatches(input.bundle, UI_CALL, "ui-call", "ui-call", collected, input.sourceLocale);
      collectRegexMatches(input.bundle, OPTION_CALL, "ui-call", "addOption", collected, input.sourceLocale, 2);
    }
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
      ...(input.targetLocale === undefined || nativeTargets.get(source.normalize("NFC")) === undefined
        ? {}
        : {
            nativeTarget: nativeTargets.get(source.normalize("NFC")),
            nativeTargetLocale: input.targetLocale,
          }),
      evidence: [...aggregate.evidence.values()].sort(compareEvidence),
    })));
  const artifactDigest = await sha256Hex(normalizeCommunityInstalledBundle(input.bundle));
  const canonicalStrings = strings.filter((item) =>
    item.origins.some((origin) => origin !== "registry.name" && origin !== "registry.description"));
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
    sourceLocale: input.sourceLocale,
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
    sourceLocale: input.sourceLocale,
    digest: catalogIdentity.digest,
    artifactDigest,
    catalogIdentity,
    strings,
    scannedAt: (input.now?.() ?? new Date()).toISOString(),
  };
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

function normalizeCommunityInstalledBundle(bundle: string): string {
  return bundle.endsWith(COMMUNITY_INSTALLER_NO_SOURCEMAP_SUFFIX)
    ? bundle.slice(0, -COMMUNITY_INSTALLER_NO_SOURCEMAP_SUFFIX.length)
    : bundle;
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
): Promise<ReadonlyMap<string, string> | null> {
  const packedNative = await collectStandalonePackedNativeCatalog(bundle, targetLocale);
  if (packedNative !== undefined) {
    addLocaleEntries(target, packedNative.english, sourceLocale);
    return packedNative.nativeTargets;
  }
  const tokens = tokenizeJavascript(bundle);
  if (tokens === null) return null;
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
    const englishEntries = collectLocaleEntries(packedEnglish);
    const nativeEntries = await collectNativeLocaleEntries(
      assignments,
      new Map(),
      targetLocale,
    );
    const nativeTargets = mapNativeTargets(englishEntries, nativeEntries);
    if (nativeTargets.size > 0) {
      addLocaleEntries(target, englishEntries, sourceLocale);
      return nativeTargets;
    }
  }
  for (const registry of assignments.values()) {
    const localeTargets = localeRegistryTargets(registry);
    if (localeTargets.size < 3) continue;
    const englishTarget = localeTargets.get("en");
    const english = englishTarget === undefined ? undefined : assignments.get(englishTarget);
    if (english === undefined) continue;
    const englishEntries = collectLocaleEntries(english);
    addLocaleEntries(target, englishEntries, sourceLocale);
    if (targetLocale === undefined) return new Map();
    const nativeEntries = await collectNativeLocaleEntries(
      assignments,
      localeTargets,
      targetLocale,
    );
    return mapNativeTargets(englishEntries, nativeEntries);
  }
  return null;
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
  const nativeTargets = mapNativeTargets(english, native);
  return nativeTargets.size === 0 ? undefined : { english, nativeTargets };
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
  return parts.map((part, index) => {
    if (index === 0) return part.toLowerCase();
    if (part.length === 4) return part[0]?.toUpperCase() + part.slice(1).toLowerCase();
    if (part.length === 2) return part.toUpperCase();
    return part.toLowerCase();
  }).join("-");
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

async function collectNativeLocaleEntries(
  assignments: ReadonlyMap<string, readonly Token[]>,
  localeTargets: ReadonlyMap<string, string>,
  targetLocale: string,
): Promise<readonly LocaleEntry[]> {
  const target = localeTargets.get(canonicalLocale(targetLocale));
  if (target !== undefined) {
    const tokens = assignments.get(target);
    if (tokens !== undefined) return collectLocaleEntries(tokens);
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
    if (end !== -1) return collectLocaleEntries(tokens.slice(index + 2, end + 1));
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
  for (const source of english) {
    const target = nativeByPath.get(source.path);
    if (target === undefined || target.text.trim() === "") continue;
    if (placeholderSignature(source.value.text) !== placeholderSignature(target.text)) continue;
    targets.set(source.value.text.normalize("NFC"), target.text.normalize("NFC"));
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
  bundle: string,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): boolean {
  const tokens = tokenizeJavascript(bundle);
  if (tokens === null) return false;
  const uiContextPropertyIndices = findUiRegistrationContextPropertyIndices(tokens);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "identifier") continue;
    const next = tokens[index + 1];
    if ((UI_CALL_NAMES.has(token.raw) || token.raw === "addOption") && next?.raw === "(") {
      const call = readCallArguments(tokens, index + 1);
      if (call === null) return false;
      const argumentIndex = token.raw === "addOption" ? 1 : 0;
      const expression = call.arguments[argumentIndex];
      if (expression !== undefined) {
        addStructuredExpression(target, expression, "ui-call", token, sourceLocale);
      }
      continue;
    }
    if (UI_PROPERTY_NAMES.has(token.raw) && next?.raw === ":") {
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
  return true;
}

function addStructuredExpression(
  target: Map<string, CandidateAggregate>,
  expression: readonly Token[],
  origin: PluginStringOrigin,
  symbol: Token,
  sourceLocale: string,
  uiContextVerified = false,
): void {
  const counter = { value: 0 };
  const rendered = renderExpression(expression, counter);
  if (rendered === null) return;
  addCandidate(target, rendered.text, origin, sourceLocale, {
    origin,
    strategy: "structured",
    symbol: symbol.raw,
    offset: symbol.start,
    line: symbol.line,
    column: symbol.column,
  }, rendered.staticText, uiContextVerified);
}

function findUiRegistrationContextPropertyIndices(tokens: readonly Token[]): ReadonlySet<number> {
  const delimiterStack: { readonly raw: "(" | "[" | "{"; readonly index: number }[] = [];
  const braceStack: number[] = [];
  const propertyObjects = new Map<number, number>();
  const registrationObjects = new Set<number>();
  const matchingOpen: Readonly<Record<string, "(" | "[" | "{">> = {
    ")": "(", "]": "[", "}": "{",
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    const expectedOpen = matchingOpen[token.raw];
    if (expectedOpen !== undefined) {
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
  if (plus === -1) return null;
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

function readCallArguments(tokens: readonly Token[], openIndex: number): { readonly arguments: readonly (readonly Token[])[] } | null {
  const args: Token[][] = [[]];
  let depth = 1;
  for (let index = openIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token.raw === "(" || token.raw === "[" || token.raw === "{") depth += 1;
    else if (token.raw === ")" || token.raw === "]" || token.raw === "}") {
      depth -= 1;
      if (depth === 0) return { arguments: args };
      if (depth < 0) return null;
    }
    if (token.raw === "," && depth === 1) args.push([]);
    else args.at(-1)?.push(token);
  }
  return null;
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
  const pairs: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
  const close = pairs[tokens[openIndex]?.raw ?? ""];
  if (close === undefined) return -1;
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index]?.raw === tokens[openIndex]?.raw) depth += 1;
    else if (tokens[index]?.raw === close && --depth === 0) return index;
  }
  return -1;
}

function tokenizeJavascript(source: string): Token[] | null {
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
      if (end === -1) return null;
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
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") index += 1;
    else if (source[index] === quote) return index;
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
): void {
  pattern.lastIndex = 0;
  for (const match of bundle.matchAll(pattern)) {
    const literal = match[captureIndex];
    if (literal === undefined) continue;
    const decoded = decodeJsLiteral(literal);
    if (decoded === null) continue;
    const location = offsetLocation(bundle, match.index);
    addCandidate(target, decoded, origin, sourceLocale, {
      origin, strategy: "regex-fallback", symbol, offset: match.index, line: location.line, column: location.column,
    });
  }
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
  return true;
}

export function placeholderSignature(value: string): string {
  const placeholders = [...value.matchAll(/\$\{[^}]+\}|\{\{[^}]+\}\}|\{\d+\}|%[sdif]|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w:.-]*(?:=(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/gu)]
    .map((match) => match[0]);
  if (placeholders.length < 2) return placeholders[0] ?? "";
  return JSON.stringify(placeholders);
}

function decodeJsLiteral(literal: string): string | null {
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
