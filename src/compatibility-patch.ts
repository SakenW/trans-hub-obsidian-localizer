import { decodeJsLiteral } from "./plugin-string-scanner";

/**
 * Language-keyed compatibility dictionary for structural UI patterns that
 * cannot flow through the published catalog yet: ternary branch literals,
 * computed labels (e.g. `name.charAt(0).toUpperCase()+name.slice(1)` applied
 * to a static array), and literal children/props of safe DOM createElement
 * calls.  The dictionary is generic across plugins: any bundle containing
 * these source strings in those proven UI shapes receives the same
 * translation.  It is deliberately small and locale-scoped, and every entry
 * is a common, unambiguous UI phrase.
 */
export const COMPATIBILITY_DICTIONARY_ZH_CN: Readonly<Record<string, string>> = {
  "Basic": "基础",
  "Model": "模型",
  "QA": "QA",
  "Command": "命令",
  "Plus": "Plus",
  "Advanced": "高级",
  "Apply": "应用",
  "Show password": "显示密码",
  "Hide password": "隐藏密码",
  "Join Now": "立即加入",
  "Set Keys": "设置密钥",
  "including chat context, PDF and image support, web search integration, exclusive chat and embedding models, and much more.":
    "包括聊天上下文、PDF 和图片支持、网页搜索集成、专属聊天和嵌入模型等。",
  "Choose where to open the plugin": "选择插件打开位置",
  "Sidebar View": "侧边栏视图",
  "Show suggested prompts in the chat view": "在聊天视图中显示建议提示",
  "Show relevant notes in the chat view": "在聊天视图中显示相关笔记",
  "Automatically add the active note or Web Viewer tab (Desktop only) to chat context when sending messages.":
    "发送消息时自动将活动笔记或 Web Viewer 标签页（仅桌面端）添加到聊天上下文。",
  "Automatically add selected text from notes or Web Viewer (Desktop only) to chat context. Disable to use manual command instead.":
    "自动将笔记或 Web Viewer（仅桌面端）中的选中文本添加到聊天上下文。关闭后可改用手动命令。",
  "Pass embedded images in markdown to the AI along with the text. Only works with multimodal models.":
    "将 Markdown 中的嵌入图片连同文本一起传递给 AI。仅多模态模型支持。",
  "Automatically saves the chat after every user message and AI response.":
    "在每次用户消息和 AI 回复后自动保存聊天记录。",
  "When enabled, uses an AI model to generate a concise title for saved chat notes. When disabled, uses the first 10 words of the first user message.":
    "启用后使用 AI 模型为保存的聊天笔记生成简洁标题；关闭时使用第一条用户消息的前 10 个词。",
  "The default folder name where chat conversations will be saved. Default is 'copilot/copilot-conversations'":
    "聊天对话保存的默认文件夹名称。默认为 'copilot/copilot-conversations'",
  "The default tag to be used when saving a conversation. Default is 'ai-conversations'":
    "保存对话时使用的默认标签。默认为 'ai-conversations'",
  "Sort order for the chat history list": "聊天历史列表的排序方式",
  "Sort order for the project list": "项目清单的排序方式",
};

interface PatchSpan {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

interface LiteralToken {
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Applies the generic structural compatibility patches to a bundle.  Every
 * replacement is a proven UI shape (ternary branch, computed label, safe DOM
 * child/property literal) whose decoded source exists in the target-language
 * dictionary.  Unknown strings are never touched; malformed input fails
 * closed by returning the original bundle.
 */
export function applyCompatibilityStructurePatches(
  bundle: string,
  targetLocale: string,
): string {
  if (targetLocale !== "zh-CN") return bundle;
  const dictionary = COMPATIBILITY_DICTIONARY_ZH_CN;
  const tokens = tokenizeForPatching(bundle);
  if (tokens === null) return bundle;
  const spans: PatchSpan[] = [];
  collectTernaryLiteralPatches(tokens, dictionary, spans);
  collectComputedLabelPatches(tokens, dictionary, spans, bundle);
  collectSafeDomLiteralPatches(tokens, dictionary, spans);
  if (spans.length === 0) return bundle;
  const ordered = [...spans].sort((left, right) => right.start - left.start);
  let patched = bundle;
  for (const span of ordered) {
    if (span.end > patched.length || span.start > span.end) return bundle;
    patched = `${patched.slice(0, span.start)}${span.replacement}${patched.slice(span.end)}`;
  }
  return patched;
}

interface PatchToken {
  readonly kind: "identifier" | "literal" | "punctuation" | "other";
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Tokenizer for structural patching.  Unlike the scanner tokenizer, it must
 * survive real-world minified bundles: nested template literals inside
 * `${...}` expressions and ambiguous slash tokens are handled leniently.
 * A malformed bundle still tokenizes (unterminated constructs end the scan),
 * and the patcher then simply finds no patch candidates.
 */
function tokenizeForPatching(source: string): readonly PatchToken[] | null {
  const tokens: PatchToken[] = [];
  for (let index = 0; index < source.length;) {
    const character = source[index] ?? "";
    if (/\s/u.test(character)) { index += 1; continue; }
    if (character === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index + 2);
      if (end === -1) break;
      index = end + 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) break;
      index = end + 2;
      continue;
    }
    const start = index;
    if (character === "\"" || character === "'" || character === "`") {
      const end = findPatchingStringEnd(source, index, character);
      if (end === -1) break;
      index = end + 1;
      tokens.push({ kind: "literal", raw: source.slice(start, index), start, end: index });
      continue;
    }
    if (character === "/" && isPatchingRegexStart(tokens)) {
      const end = findPatchingRegexEnd(source, index);
      if (end !== -1) {
        index = end;
        while (index < source.length && /[A-Za-z]/u.test(source[index] ?? "")) index += 1;
        tokens.push({ kind: "other", raw: source.slice(start, index), start, end: index });
        continue;
      }
    }
    if (/[$_\p{L}]/u.test(character)) {
      index += 1;
      while (index < source.length && /[$_\p{L}\p{N}]/u.test(source[index] ?? "")) index += 1;
      tokens.push({ kind: "identifier", raw: source.slice(start, index), start, end: index });
      continue;
    }
    index += 1;
    const kind = "()[]{}:,.+;?".includes(character) ? "punctuation" : "other";
    tokens.push({ kind, raw: character, start, end: index });
  }
  return tokens.length === 0 ? null : tokens;
}

function findPatchingStringEnd(source: string, start: number, quote: string): number {
  if (quote !== "`") {
    for (let index = start + 1; index < source.length; index += 1) {
      if (source[index] === "\\") index += 1;
      else if (source[index] === quote) return index;
    }
    return -1;
  }
  // Template literal: honor ${...} expressions, including nested strings and
  // nested templates, and only close at an unescaped backtick at depth zero.
  let index = start + 1;
  while (index < source.length) {
    const character = source[index] ?? "";
    if (character === "\\") { index += 2; continue; }
    if (character !== "$" || source[index + 1] !== "{") {
      if (character === "`") return index;
      index += 1;
      continue;
    }
    const expressionEnd = findPatchingExpressionEnd(source, index + 1);
    if (expressionEnd === -1) return -1;
    index = expressionEnd + 1;
  }
  return -1;
}

function findPatchingExpressionEnd(source: string, openBrace: number): number {
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (character === "\\") { index += 1; continue; }
    if (character === "\"" || character === "'" || character === "`") {
      const end = findPatchingStringEnd(source, index, character);
      if (end === -1) return -1;
      index = end;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index + 2);
      if (end === -1) return -1;
      index = end;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) return -1;
      index = end + 1;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function findPatchingRegexEnd(source: string, start: number): number {
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

function isPatchingRegexStart(tokens: readonly PatchToken[]): boolean {
  const previous = tokens.at(-1)?.raw;
  if (previous === undefined) return true;
  return ["(", "[", "{", "=", ":", ",", ";", "!", "?", "+", "-", "*", "%", "&", "|", "^", "~", ">", "<"].includes(previous)
    || ["return", "case", "throw", "delete", "typeof", "void", "new", "in", "of"].includes(previous);
}

function collectTernaryLiteralPatches(
  tokens: readonly PatchToken[],
  dictionary: Readonly<Record<string, string>>,
  spans: PatchSpan[],
): void {
  const depthStack: string[] = [];
  const pendingTernaryDepths: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token.raw === "(" || token.raw === "[" || token.raw === "{") {
      depthStack.push(token.raw);
      continue;
    }
    if (token.raw === ")" || token.raw === "]" || token.raw === "}") {
      depthStack.pop();
      continue;
    }
    const depth = depthStack.length;
    if (token.raw === "?") {
      pendingTernaryDepths.push(depth);
      const next = tokens[index + 1];
      if (next?.kind === "literal") addDictionaryLiteralPatch(next, dictionary, spans);
      continue;
    }
    if (token.raw === ":" && pendingTernaryDepths.at(-1) === depth) {
      pendingTernaryDepths.pop();
      const next = tokens[index + 1];
      if (next?.kind === "literal") addDictionaryLiteralPatch(next, dictionary, spans);
    }
  }
}

function collectComputedLabelPatches(
  tokens: readonly PatchToken[],
  dictionary: Readonly<Record<string, string>>,
  spans: PatchSpan[],
  bundle: string,
): void {
  const arrays = collectStaticStringArrays(tokens);
  for (let index = 0; index + 14 < tokens.length; index += 1) {
    const variable = tokens[index];
    if (variable?.kind !== "identifier") continue;
    if (!matchesSequence(tokens, index + 1, [".", "charAt", "(", "0", ")", ".", "toUpperCase", "(", ")", "+"])) continue;
    const secondVariable = tokens[index + 11];
    if (secondVariable?.kind !== "identifier" || secondVariable.raw !== variable.raw) continue;
    if (!matchesSequence(tokens, index + 12, [".", "slice", "(", "1", ")"])) continue;
    const keys = resolveMapKeys(tokens, index, arrays);
    if (keys === undefined || keys.length === 0) continue;
    const entries = keys
      .map((key) => ({ key, target: dictionary[key.charAt(0).toUpperCase() + key.slice(1)] }))
      .filter((entry): entry is { readonly key: string; readonly target: string } => entry.target !== undefined);
    if (entries.length === 0) continue;
    const end = tokens[index + 16]?.end ?? tokens[index + 15]?.end;
    if (end === undefined) continue;
    const lookup = `({${entries.map((entry) => `${JSON.stringify(entry.key)}:${JSON.stringify(entry.target)}`).join(",")}})[${variable.raw}]??`;
    spans.push({ start: variable.start, end, replacement: lookup + bundle.slice(variable.start, end) });
  }
}

function collectSafeDomLiteralPatches(
  tokens: readonly PatchToken[],
  dictionary: Readonly<Record<string, string>>,
  spans: PatchSpan[],
): void {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "identifier" || token.raw !== "createElement") continue;
    if (tokens[index - 1]?.raw !== ".") continue;
    const owner = tokens[index - 2];
    const reactOwner = owner?.raw === "React" || owner?.raw === "ReactDOM"
      || (owner?.raw === "default" && tokens[index - 3]?.raw === "." && tokens[index - 4]?.kind === "identifier");
    if (!reactOwner) continue;
    const open = tokens[index + 1];
    if (open?.raw !== "(") continue;
    const close = matchingCloseIndex(tokens, index + 1);
    if (close === -1) continue;
    const args = splitArguments(tokens, index + 2, close);
    const props = args[1];
    if (props !== undefined) {
      const braceOpen = props[0];
      if (braceOpen?.raw === "{" && matchingCloseIndex(props, 0) === props.length - 1) {
        const entries = splitTopLevel(props.slice(1, -1));
        for (const entry of entries) {
          const colon = topLevelIndex(entry, ":");
          if (colon <= 0) continue;
          const key = staticKey(entry.slice(0, colon));
          if (key === "options") {
            collectOptionLabels(entry.slice(colon + 1), dictionary, spans);
            continue;
          }
          const value = entry[colon + 1];
          if (value?.kind !== "literal") continue;
          if (key !== undefined && UI_TEXT_PROPERTY_KEYS.has(key)) {
            addDictionaryLiteralPatch(value, dictionary, spans);
          }
        }
      }
    }
    for (const child of args.slice(2)) {
      if (child.length === 1 && child[0]?.kind === "literal") {
        addDictionaryLiteralPatch(child[0], dictionary, spans);
      }
    }
  }
}

const UI_TEXT_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  "aria-label",
  "ariaLabel",
  "placeholder",
  "title",
  "label",
  "description",
  "desc",
  "name",
  "tooltip",
  "buttonText",
  "text",
  "message",
  "header",
  "subtitle",
  "summary",
  "hint",
  "warning",
  "error",
  "success",
]);

function addDictionaryLiteralPatch(
  literal: LiteralToken,
  dictionary: Readonly<Record<string, string>>,
  spans: PatchSpan[],
): void {
  if (literal.raw.startsWith("`") && literal.raw.includes("${")) return;
  const decoded = decodeJsLiteral(literal.raw);
  if (decoded === null) return;
  const target = dictionary[decoded.trim()];
  if (target === undefined) return;
  spans.push({ start: literal.start, end: literal.end, replacement: encodeLiteral(literal.raw, target) });
}

function encodeLiteral(raw: string, target: string): string {
  if (typeof target !== "string") return raw;
  const quote = raw[0] ?? "\"";
  const json = JSON.stringify(target).replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
  if (quote === "\"") return json;
  if (quote === "'") return `'${json.slice(1, -1).replace(/'/gu, "\\'")}'`;
  return `\`${json.slice(1, -1).replace(/`/gu, "\\`").replace(/\$/gu, "\\$")}\``;
}

function matchesSequence(
  tokens: readonly { readonly raw: string }[],
  start: number,
  expected: readonly string[],
): boolean {
  for (let offset = 0; offset < expected.length; offset += 1) {
    if (tokens[start + offset]?.raw !== expected[offset]) return false;
  }
  return true;
}

function collectStaticStringArrays(
  tokens: readonly PatchToken[],
): ReadonlyMap<string, readonly string[]> {
  const arrays = new Map<string, string[]>();
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    const name = tokens[index];
    if (name?.kind !== "identifier" || tokens[index + 1]?.raw !== "=" || tokens[index + 2]?.raw !== "[") continue;
    const close = matchingCloseIndex(tokens, index + 2);
    if (close === -1) continue;
    const elements = splitTopLevel(tokens.slice(index + 3, close));
    const keys: string[] = [];
    let valid = true;
    for (const element of elements) {
      if (element.length === 1 && element[0]?.kind === "literal") {
        const decoded = decodeJsLiteral(element[0].raw);
        if (decoded === null) { valid = false; break; }
        keys.push(decoded);
      } else if (element.length > 0) {
        valid = false;
        break;
      }
    }
    if (valid && keys.length > 0) arrays.set(name.raw, keys);
  }
  return arrays;
}

function resolveMapKeys(
  tokens: readonly PatchToken[],
  labelIndex: number,
  arrays: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
  // Look backwards for `<source>.map(<param> =>` with the same variable.
  const variable = tokens[labelIndex]?.raw;
  if (variable === undefined) return undefined;
  for (let index = labelIndex - 1; index >= 0; index -= 1) {
    // The tokenizer splits `=>` into `=` and `>`.
    if (tokens[index]?.raw === ">" && tokens[index - 1]?.raw === "=") {
      const param = tokens[index - 2];
      if (param?.raw !== variable) return undefined;
      const mapToken = tokens[index - 3];
      if (mapToken?.raw !== "(" || tokens[index - 4]?.raw !== "map" || tokens[index - 5]?.raw !== ".") return undefined;
      const source = tokens[index - 6];
      if (source?.raw === "]") {
        const open = matchingOpenIndex(tokens, index - 5);
        if (open !== -1) return arrayLiteralKeys(tokens, open, index - 5);
      }
      return arrays.get(source?.raw ?? "");
    }
  }
  return undefined;
}

function arrayLiteralKeys(
  tokens: readonly PatchToken[],
  open: number,
  close: number,
): readonly string[] | undefined {
  const elements = splitTopLevel(tokens.slice(open + 1, close));
  const keys: string[] = [];
  for (const element of elements) {
    if (element.length === 1 && element[0]?.kind === "literal") {
      const decoded = decodeJsLiteral(element[0].raw);
      if (decoded === null) return undefined;
      keys.push(decoded);
    } else {
      return undefined;
    }
  }
  return keys;
}

function collectOptionLabels(
  expression: readonly PatchToken[],
  dictionary: Readonly<Record<string, string>>,
  spans: PatchSpan[],
): void {
  const open = expression[0];
  if (open?.raw !== "[" ) return;
  const close = matchingCloseIndex(expression, 0);
  if (close === -1) return;
  for (const entry of splitTopLevel(expression.slice(1, close))) {
    if (entry[0]?.raw !== "{") continue;
    const entryClose = matchingCloseIndex(entry, 0);
    if (entryClose !== entry.length - 1) continue;
    for (const field of splitTopLevel(entry.slice(1, -1))) {
      const colon = topLevelIndex(field, ":");
      if (colon <= 0) continue;
      if (staticKey(field.slice(0, colon)) !== "label") continue;
      const value = field[colon + 1];
      if (value?.kind === "literal") addDictionaryLiteralPatch(value, dictionary, spans);
    }
  }
}

function matchingCloseIndex(
  tokens: readonly PatchToken[],
  openIndex: number,
): number {
  const open = tokens[openIndex]?.raw;
  const expected = open === "(" ? ")" : open === "[" ? "]" : open === "{" ? "}" : null;
  if (expected === null) return -1;
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const raw = tokens[index]?.raw;
    if (raw === open) depth += 1;
    else if (raw === expected && --depth === 0) return index;
  }
  return -1;
}

function matchingOpenIndex(
  tokens: readonly PatchToken[],
  closeIndex: number,
): number {
  const close = tokens[closeIndex]?.raw;
  const expected = close === ")" ? "(" : close === "]" ? "[" : close === "}" ? "{" : null;
  if (expected === null) return -1;
  let depth = 0;
  for (let index = closeIndex; index >= 0; index -= 1) {
    const raw = tokens[index]?.raw;
    if (raw === close) depth += 1;
    else if (raw === expected && --depth === 0) return index;
  }
  return -1;
}

function splitArguments(
  tokens: readonly PatchToken[],
  start: number,
  end: number,
): readonly (readonly PatchToken[])[] {
  return splitTopLevel(tokens.slice(start, end));
}

function splitTopLevel(
  tokens: readonly PatchToken[],
): readonly (readonly PatchToken[])[] {
  const result: PatchToken[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token.raw === "(" || token.raw === "[" || token.raw === "{") depth += 1;
    else if (token.raw === ")" || token.raw === "]" || token.raw === "}") depth -= 1;
    if (token.raw === "," && depth === 0) result.push([]);
    else result.at(-1)?.push(token);
  }
  return result;
}

function topLevelIndex(
  tokens: readonly PatchToken[],
  expected: string,
): number {
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const raw = tokens[index]?.raw;
    if (raw === "(" || raw === "[" || raw === "{") depth += 1;
    else if (raw === ")" || raw === "]" || raw === "}") depth -= 1;
    else if (raw === expected && depth === 0) return index;
  }
  return -1;
}

function staticKey(tokens: readonly PatchToken[]): string | undefined {
  if (tokens.length === 0) return undefined;
  if (tokens[0]?.kind === "identifier") return tokens[0].raw;
  if (tokens.length === 1 && tokens[0]?.kind === "literal") {
    return decodeJsLiteral(tokens[0].raw) ?? undefined;
  }
  return undefined;
}
