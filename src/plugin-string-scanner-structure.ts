import {
  findQuotedEnd,
  matchingTokenIndex,
  splitTopLevelTokens,
  tokenizeJavascript,
  topLevelTokenIndex,
  type Token,
} from "./plugin-string-scanner-lexical";
import {
  addCandidate,
  decodeJsLiteral,
  placeholderSignature,
  renderExpression,
  staticCatalogKey,
  type CandidateAggregate,
  type RenderedExpression,
} from "./plugin-string-scanner-evidence";
import { lazyLocaleCatalogs } from "./plugin-lazy-locale-catalog";

const MAX_EMBEDDED_LOCALE_CATALOG_ENTRIES = 10_000;

interface EmbeddedCatalogScan {
  readonly nativeTargets: ReadonlyMap<string, string> | null;
  readonly tokens: readonly Token[] | null;
}
export async function collectEmbeddedEnglishCatalog(
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
  const lazy = lazyLocaleCatalogs(tokens, assignments, targetLocale);
  if (lazy !== undefined) {
    const english = collectBoundedLocaleEntries(lazy.english);
    const reference = new Map((collectBoundedLocaleEntries(lazy.englishReference) ?? [])
      .map((entry) => [entry.path, entry.value.text]));
    const native = collectBoundedLocaleEntries(lazy.native) ?? [];
    if (english !== undefined && english.length >= 3
      && english.filter((entry) => reference.get(entry.path) === entry.value.text).length / english.length >= 0.8) {
      addLocaleEntries(target, english, sourceLocale);
      return { nativeTargets: mapNativeTargets(english, native), tokens };
    }
  }
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

export function canonicalLocale(value: string): string {
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
