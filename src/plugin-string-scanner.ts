import { canonicalizeProtocolJson } from "@trans-hub/client-protocol";

import { sha256Hex } from "./identity";
import type { InstalledObsidianPlugin } from "./plugin-discovery";

export type PluginStringOrigin =
  | "manifest.name"
  | "manifest.description"
  | "registry.name"
  | "registry.description"
  | "ui-call"
  | "ui-property";
export type PluginStringExtractionStrategy = "manifest" | "registry" | "structured" | "regex-fallback";
export type PluginStringSemanticRole = "official-name" | "description" | "runtime-ui";

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
const QUOTED = String.raw`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\])*\x60)`;
const UI_CALL = new RegExp(String.raw`(?:Notice|setText|setButtonText|setName|setDesc|setPlaceholder|setTooltip|setTitle|addHeading|appendText)\s*\(\s*${QUOTED}`, "gu");
const OPTION_CALL = new RegExp(String.raw`addOption\s*\(\s*${QUOTED}\s*,\s*${QUOTED}`, "gu");
const UI_PROPERTY = new RegExp(String.raw`(?:name|description|text|placeholder|label|tooltip|title|header|desc|message|buttonText|ariaLabel|caption|subtitle|summary|warning|error|success|hint)\s*:\s*${QUOTED}`, "gu");

export async function scanPluginUiStrings(input: {
  readonly plugin: InstalledObsidianPlugin;
  readonly registryMetadata?: {
    readonly name: string;
    readonly description: string;
  };
  readonly bundle: string;
  readonly sourceLocale: string;
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
  if (!collectStructuredMatches(input.bundle, collected, input.sourceLocale)) {
    collectRegexMatches(input.bundle, UI_CALL, "ui-call", "ui-call", collected, input.sourceLocale);
    collectRegexMatches(input.bundle, OPTION_CALL, "ui-call", "addOption", collected, input.sourceLocale, 2);
    collectRegexMatches(input.bundle, UI_PROPERTY, "ui-property", "ui-property", collected, input.sourceLocale);
  }
  const strings = await Promise.all([...collected.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(async ([source, aggregate]): Promise<PluginUiString> => ({
      key: (await sha256Hex(`${input.plugin.id}\u0000${source.normalize("NFC")}`)).slice(0, 32),
      source: source.normalize("NFC"),
      origins: [...aggregate.origins].sort(),
      semanticRole: resolvePluginStringSemanticRole(aggregate.origins),
      placeholderSignature: placeholderSignature(source),
      evidence: [...aggregate.evidence.values()].sort(compareEvidence),
    })));
  const digest = await sha256Hex(canonicalizeProtocolJson({
    plugin_id: input.plugin.id,
    plugin_version: input.plugin.version,
    source_locale: input.sourceLocale,
    strings: strings.map((item) => ({
      key: item.key,
      source: item.source,
      placeholder_signature: item.placeholderSignature,
    })),
  }));
  return {
    pluginId: input.plugin.id,
    pluginName: input.plugin.name,
    pluginVersion: input.plugin.version,
    sourceLocale: input.sourceLocale,
    digest,
    artifactDigest: await sha256Hex(input.bundle),
    strings,
    scannedAt: (input.now?.() ?? new Date()).toISOString(),
  };
}

export function resolvePluginStringSemanticRole(
  origins: Iterable<PluginStringOrigin>,
): PluginStringSemanticRole {
  const values = new Set(origins);
  if (values.has("manifest.name") || values.has("registry.name")) return "official-name";
  if (values.has("manifest.description") || values.has("registry.description")) return "description";
  return "runtime-ui";
}

function collectStructuredMatches(
  bundle: string,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): boolean {
  const tokens = tokenizeJavascript(bundle);
  if (tokens === null) return false;
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
      if (expression.length > 0) addStructuredExpression(target, expression, "ui-property", token, sourceLocale);
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
  }, rendered.staticText);
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
): void {
  const value = raw.normalize("NFC").trim();
  const probe = staticProbe.normalize("NFC").trim();
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

function offsetLocation(source: string, offset: number): { readonly line: number; readonly column: number } {
  const prefix = source.slice(0, offset);
  const line = prefix.split("\n").length;
  const lastNewline = prefix.lastIndexOf("\n");
  return { line, column: offset - lastNewline - 1 };
}

export function isPlausibleSourceLocaleText(value: string, sourceLocale: string): boolean {
  if (sourceLocale !== "en") return true;
  for (const character of value) {
    if (/\p{L}/u.test(character) && !/\p{Script=Latin}/u.test(character)) return false;
  }
  return true;
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
  return [...value.matchAll(/\$\{[^}]+\}|\{\{[^}]+\}\}|\{\d+\}|%[sdif]|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w:.-]*(?:=(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/gu)]
    .map((match) => match[0])
    .join("\u0000");
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
