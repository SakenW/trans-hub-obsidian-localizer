export interface Token {
  readonly kind: "identifier" | "literal" | "punctuation" | "other";
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
}


export type MatchingTokenIndexes = Int32Array;

export function splitTopLevelTokens(
  tokens: readonly Token[],
): readonly (readonly Token[])[] {
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

export function topLevelTokenIndex(
  tokens: readonly Token[],
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

export function readCallArguments(
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

export function buildMatchingTokenIndexes(tokens: readonly Token[]): MatchingTokenIndexes | null {
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

export function readPropertyExpression(tokens: readonly Token[], start: number): readonly Token[] {
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

export function matchingTokenIndex(tokens: readonly Token[], openIndex: number): number {
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

export function findQuotedEnd(source: string, start: number, quote: string): number {
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
