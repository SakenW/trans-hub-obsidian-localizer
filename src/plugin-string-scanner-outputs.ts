import {
  buildMatchingTokenIndexes,
  matchingTokenIndex,
  readCallArguments,
  readPropertyExpression,
  splitTopLevelTokens,
  topLevelTokenIndex,
  type Token,
} from "./plugin-string-scanner-lexical";
import {
  addCandidate,
  decodeJsLiteral,
  offsetLocation,
  renderExpression,
  renderTemplateLiteral,
  renderSafeNativeDomExpression,
  staticCatalogKey,
  stripWrappingParentheses,
  type CandidateAggregate,
  type PluginStringEvidence,
  type PluginStringOrigin,
  type RenderedExpression,
} from "./plugin-string-scanner-evidence";
import { collectStructuralRuleMatches } from "./plugin-string-scanner-structural-rules";

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

export function collectRegexFallbackMatches(
  bundle: string,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  collectRegexMatches(bundle, UI_CALL, "ui-call", "ui-call", target, sourceLocale);
  collectRegexMatches(bundle, OPTION_CALL, "ui-call", "addOption", target, sourceLocale, 2);
  collectRegexMatches(bundle, UI_PROPERTY, "ui-property", "ui-property", target, sourceLocale);
  collectRegexMatches(bundle, TEXT_CONTENT_ASSIGNMENT, "ui-property", "textContent", target, sourceLocale, 1, true);
  collectRegexMatches(bundle, INNER_TEXT_ASSIGNMENT, "ui-property", "innerText", target, sourceLocale, 1, true, singleLineText);
  collectRegexMatches(bundle, INNER_HTML_ASSIGNMENT, "ui-property", "innerHTML", target, sourceLocale, 1, true, undefined, renderInnerHtmlText);
  collectRegexMatches(bundle, OBSIDIAN_CREATE_TEXT, "ui-property", "createEl", target, sourceLocale, 1, true);
  collectAddOptionsRegexMatches(bundle, target, sourceLocale);
  collectRegexMatches(bundle, REACT_DEFAULT_CREATE_ELEMENT_CHILD, "ui-call", "createElement", target, sourceLocale);
  collectRegexMatches(bundle, REACT_DEFAULT_CREATE_ELEMENT_PROPERTY, "ui-property", "createElement", target, sourceLocale, 1, true);
}

export function collectStructuredMatches(
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
  collectStructuralRuleMatches(tokens, matching, target, sourceLocale);
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
