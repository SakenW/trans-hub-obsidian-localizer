import type { SourceCatalogIdentity } from "@trans-hub/client-protocol";

import {
  findQuotedEnd,
  matchingTokenIndex,
  splitTopLevelTokens,
  tokenizeJavascript,
  type Token,
} from "./plugin-string-scanner-lexical";

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
  /** Active target locale when this catalog's embedded native targets were scanned. */
  readonly scannerTargetLocale?: string;
  /** Bumped when persisted catalogs gain patch-safe literal evidence. */
  readonly patchEvidenceRevision?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
  /** Missing only on catalogs persisted before identity revision 1. */
  readonly catalogIdentity?: SourceCatalogIdentity;
  readonly strings: readonly PluginUiString[];
  readonly scannedAt: string;
}

export interface CandidateAggregate {
  readonly origins: Set<PluginStringOrigin>;
  readonly evidence: Map<string, PluginStringEvidence>;
}

export interface RenderedExpression {
  readonly text: string;
  readonly staticText: string;
}

const DYNAMIC_PLACEHOLDER_PREFIX = "th:expr:";
const UI_PROPERTY_EVIDENCE_SYMBOLS = new Set([
  "name",
  "description",
  "text",
  "placeholder",
  "label",
  "tooltip",
  "title",
  "header",
  "desc",
  "message",
  "buttonText",
  "ariaLabel",
  "caption",
  "subtitle",
  "summary",
  "warning",
  "error",
  "success",
  "hint",
]);

export function staticCatalogKey(tokens: readonly Token[]): string | null {
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

export function resolvePluginStringScopes(
  origins: readonly PluginStringOrigin[],
): readonly PluginContentScope[] {
  const scopes = new Set<PluginContentScope>();
  if (origins.some((origin) => origin === "ui-call" || origin === "ui-property")) {
    scopes.add("runtime-ui");
  }
  if (origins.some((origin) => (
    origin === "manifest.name"
    || origin === "manifest.description"
    || origin === "registry.name"
    || origin === "registry.description"
  ))) {
    scopes.add("metadata");
  }
  if (origins.includes("readme")) scopes.add("readme");
  return [...scopes];
}

export function renderExpression(tokens: readonly Token[], counter: { value: number }): RenderedExpression | null {
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
    if (transparentArgument === null) return null;
    const rendered = renderExpression(transparentArgument, counter);
    return rendered !== null && isPlausibleTransparentWrapperText(rendered.staticText)
      ? rendered
      : null;
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

function isPlausibleTransparentWrapperText(value: string): boolean {
  const text = value.trim();
  if (text.includes("_") || /[^\p{Script=Latin}\p{N}\s.,:;!?()'"-]/u.test(text)) return false;
  const latinLetters = [...text].filter((character) => /\p{Script=Latin}/u.test(character));
  if (latinLetters.length < 2) return false;
  return /^\p{Lu}/u.test(text) || /\s/u.test(text);
}

export function renderSafeNativeDomExpression(
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

export function renderTemplateLiteral(raw: string, counter: { value: number }): RenderedExpression | null {
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

export function stripWrappingParentheses(tokens: readonly Token[]): readonly Token[] {
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

export function addCandidate(
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
    && (UI_PROPERTY_EVIDENCE_SYMBOLS.has(evidence.symbol) || evidence.symbol === "ui-property")
    && !uiContextVerified
  ) return;
  if (!isTranslatableUiText(value) || !isTranslatableUiText(probe) || !isPlausibleSourceLocaleText(value, sourceLocale)) return;
  const aggregate = target.get(value) ?? { origins: new Set<PluginStringOrigin>(), evidence: new Map<string, PluginStringEvidence>() };
  aggregate.origins.add(origin);
  aggregate.evidence.set(JSON.stringify(evidence), evidence);
  target.set(value, aggregate);
}

export function compareEvidence(left: PluginStringEvidence, right: PluginStringEvidence): number {
  return (left.offset ?? -1) - (right.offset ?? -1)
    || left.origin.localeCompare(right.origin)
    || left.strategy.localeCompare(right.strategy)
    || left.symbol.localeCompare(right.symbol);
}

export function compareUnicodeScalars(left: string, right: string): number {
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

export function offsetLocation(source: string, offset: number): { readonly line: number; readonly column: number } {
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

/**
 * Runtime expression placeholders name their capture slot, so an otherwise
 * exact UI translation may safely reorder them for natural target-language
 * grammar. Other placeholder families keep their ordered signature: tags,
 * printf substitutions, and arbitrary template fragments are not movable by
 * this client contract.
 */
export function hasCompatiblePlaceholderSignature(
  source: string,
  target: string,
): boolean {
  const sourceSignature = placeholderSignature(source);
  if (sourceSignature === placeholderSignature(target)) return true;
  const sourceTokens = placeholderTokens(source);
  const targetTokens = placeholderTokens(target);
  if (
    sourceTokens.length === 0
    || sourceTokens.length !== targetTokens.length
    || !sourceTokens.every(isRuntimeExpressionToken)
    || !targetTokens.every(isRuntimeExpressionToken)
  ) return false;
  return [...sourceTokens].sort().join("\u0000")
    === [...targetTokens].sort().join("\u0000");
}

function placeholderTokens(value: string): string[] {
  return [...value.matchAll(/\$\{[^}]+\}|\{\{[^}]+\}\}|\{\d+\}|%[sdif]|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w:.-]*(?:=(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/gu)]
    .map((match) => match[0]);
}

function isRuntimeExpressionToken(value: string): boolean {
  return /^\{\{th:expr:\d+\}\}$/u.test(value);
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
      if (codePoint >= 0xD800 && codePoint <= 0xDBFF) {
        const lowStart = index + 5;
        if (body[lowStart] !== "\\" || body[lowStart + 1] !== "u") return null;
        const lowHex = body.slice(lowStart + 2, lowStart + 6);
        if (!/^[0-9a-f]{4}$/iu.test(lowHex)) return null;
        const low = Number.parseInt(lowHex, 16);
        if (low < 0xDC00 || low > 0xDFFF) return null;
        output += String.fromCodePoint(
          0x10000 + ((codePoint - 0xD800) << 10) + low - 0xDC00,
        );
        index = lowStart + 5;
      } else if (codePoint >= 0xDC00 && codePoint <= 0xDFFF) {
        return null;
      } else {
        output += String.fromCodePoint(codePoint);
        index += 4;
      }
    } else output += escaped;
  }
  return output;
}
function transparentWrapperArgument(tokens: readonly Token[]): readonly Token[] | null {
  const wrapper = tokens[0];
  if (
    tokens.length < 3
    || wrapper?.kind !== "identifier"
    // A lower-case call such as t("key") is commonly the plugin's own
    // localization lookup: its argument is an internal key, not source copy.
    // Keep only the generated Pascal/camel wrapper shape used by compiled UI
    // helpers (for example Yt("Wrapped setting description")).
    || !/^[A-Z][A-Za-z0-9_$]*$/u.test(wrapper.raw)
    || tokens[1]?.raw !== "("
    || matchingTokenIndex(tokens, 1) !== tokens.length - 1
  ) return null;
  const arguments_ = splitTopLevelTokens(tokens.slice(2, -1));
  const argument = arguments_[0];
  return arguments_.length === 1 && argument !== undefined && argument.length > 0 ? argument : null;
}
