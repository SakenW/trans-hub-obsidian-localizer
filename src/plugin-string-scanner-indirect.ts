import {
  readCallArguments, splitTopLevelTokens, topLevelTokenIndex,
  type MatchingTokenIndexes, type Token,
} from "./plugin-string-scanner-lexical";
import { addCandidate, decodeJsLiteral, staticCatalogKey, type CandidateAggregate } from "./plugin-string-scanner-evidence";

/** Indirect values can also be command IDs or data: never expose patch spans. */
export function addIndirectText(
  target: Map<string, CandidateAggregate>, text: string, token: Token,
  symbol: string, sourceLocale: string,
): void {
  addCandidate(target, text, "ui-property", sourceLocale, {
    origin: "ui-property", strategy: "structured", symbol,
    offset: token.start, line: token.line, column: token.column,
  }, text, true);
}

function isPropertyName(tokens: readonly Token[], index: number): boolean {
  return tokens[index - 1]?.raw === "."
    || (tokens[index + 1]?.raw === ":" && ["{", ","].includes(tokens[index - 1]?.raw ?? ""));
}

/** Deliberately global uniqueness: ambiguous shadowing fails closed. */
export function identifierUses(tokens: readonly Token[], name: string): number[] {
  const result: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.kind === "identifier" && tokens[index]?.raw === name && !isPropertyName(tokens, index)) result.push(index);
  }
  return result;
}

/** Templates are opaque lexical tokens; never overlook a write/escape inside
 * an interpolation. Only exact read-only substitutions may be folded. */
export function hasUnsafeTemplateReference(tokens: readonly Token[], name: string, allowSimple = false): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const reference = new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, "u");
  const simple = new RegExp(`\\$\\{\\s*${escaped}\\s*\\}`, "gu");
  return tokens.some((token) => {
    if (token.kind !== "literal" || !token.raw.startsWith("`") || !token.raw.includes("${")) return false;
    // Conservatively inspect the whole opaque template, including nested
    // interpolations. This may reject a name repeated in static prose.
    return reference.test(allowSimple ? token.raw.replace(simple, "") : token.raw);
  });
}

function bindingScope(tokens: readonly Token[], matching: MatchingTokenIndexes, index: number): readonly [number, number] {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (tokens[cursor]?.raw === "{" && (matching[cursor] ?? -1) > index) return [cursor, matching[cursor]];
  }
  return [0, tokens.length];
}

export interface StaticDescriptionBinding {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** Only a whole literal initializer and proven description references are allowed.
 * Other bare occurrences include writes, parameters, destructuring and aliases. */
export function staticDescriptionBindings(
  tokens: readonly Token[], matching: MatchingTokenIndexes, references: ReadonlySet<Token>,
): ReadonlyMap<string, StaticDescriptionBinding> {
  const names = new Set([...references].map((token) => token.raw));
  const result = new Map<string, StaticDescriptionBinding>();
  for (const name of names) {
    if (hasUnsafeTemplateReference(tokens, name, true)) continue;
    const uses = identifierUses(tokens, name);
    const declarations = uses.filter((index) => ["const", "let", "var"].includes(tokens[index - 1]?.raw ?? "")
      && tokens[index + 1]?.raw === "=" && tokens[index + 2]?.kind === "literal"
      && [";", ","].includes(tokens[index + 3]?.raw ?? ""));
    if (declarations.length !== 1) continue;
    const declaration = declarations[0];
    const text = decodeJsLiteral(tokens[declaration + 2]?.raw ?? "");
    const [start, end] = bindingScope(tokens, matching, declaration);
    if (text === null || uses.some((index) => index !== declaration
      && (!references.has(tokens[index]) || index <= declaration || index >= end))) continue;
    result.set(name, { text, start, end });
  }
  return result;
}

interface Method {
  readonly name: string;
  readonly params: readonly (readonly Token[])[];
  readonly start: number;
  readonly end: number;
  readonly eligible: boolean;
}

function changesThisBinding(tokens: readonly Token[], matching: MatchingTokenIndexes, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (["function", "class"].includes(tokens[index]?.raw ?? "")) return true;
    if (tokens[index]?.kind === "identifier" && tokens[index + 1]?.raw === "("
      && !["if", "for", "while", "switch", "catch", "with"].includes(tokens[index].raw)
      && tokens[(matching[index + 1] ?? -2) + 1]?.raw === "{") return true;
  }
  return false;
}

/** Same-class this.method calls only; method names are never globally trusted. */
export function collectForwardedMethodLabels(
  tokens: readonly Token[], matching: MatchingTokenIndexes, sinks: ReadonlySet<string>,
  target: Map<string, CandidateAggregate>, sourceLocale: string,
): void {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.raw !== "class") continue;
    let open = index + 1;
    while (open < index + 12 && open < tokens.length && tokens[open]?.raw !== "{") open += 1;
    const end = matching[open] ?? -1;
    if (tokens[open]?.raw !== "{" || end < 0) continue;
    const methods: Method[] = [];
    const fields = new Set<string>();
    let ambiguousMembers = false;
    for (let cursor = open + 1; cursor < end; cursor += 1) {
      if (tokens[cursor]?.raw === "[") { ambiguousMembers = true; break; }
      if (tokens[cursor]?.kind === "identifier" && ["=", ";"].includes(tokens[cursor + 1]?.raw ?? "")) fields.add(tokens[cursor].raw);
      if (tokens[cursor]?.kind === "identifier" && tokens[cursor + 1]?.raw === "(") {
        const close = matching[cursor + 1] ?? -1;
        const bodyEnd = matching[close + 1] ?? -1;
        if (close > cursor && tokens[close + 1]?.raw === "{" && bodyEnd < end && bodyEnd > close) {
          // Static/get/set methods are a different dispatch surface.
          methods.push({ name: tokens[cursor].raw, params: splitTopLevelTokens(tokens.slice(cursor + 2, close)),
            start: close + 2, end: bodyEnd, eligible: !["static", "get", "set", "*"].includes(tokens[cursor - 1]?.raw ?? "")
              && !(tokens[cursor - 1]?.raw === "async" && tokens[cursor - 2]?.raw === "static") });
          cursor = bodyEnd;
          continue;
        }
      }
      if (["{", "(", "["].includes(tokens[cursor]?.raw ?? "")) cursor = matching[cursor] ?? cursor;
    }
    if (ambiguousMembers) continue;
    for (const method of methods) {
      if (fields.has(method.name) || !method.eligible || changesThisBinding(tokens, matching, method.start, method.end)) continue;
      if (methods.filter((entry) => entry.name === method.name).length !== 1) continue;
      if (method.params.some((part) => part.length !== 1 || part[0]?.kind !== "identifier")
        || new Set(method.params.map((part) => part[0].raw)).size !== method.params.length) continue;
      const body = tokens.slice(method.start, method.end);
      if (body.some((token) => ["eval", "with", "arguments"].includes(token.raw))) continue;
      if (hasUnsafeTemplateReference(tokens.slice(open + 1, end), method.name)) continue;
      const sinkArguments = new Set<number>();
      for (let cursor = method.start; cursor < method.end; cursor += 1) {
        const sink = tokens[cursor]?.raw ?? "";
        if ((!sinks.has(sink) && sink !== "addOption") || tokens[cursor + 1]?.raw !== "(") continue;
        const args = readCallArguments(tokens, cursor + 1, matching)?.arguments;
        const argument = args?.[sink === "addOption" ? 1 : 0];
        if (argument?.length === 1 && argument[0]?.kind === "identifier") sinkArguments.add(argument[0].start);
      }
      const forwarded = new Set<number>();
      for (const [position, parameter] of method.params.entries()) {
        const uses = identifierUses(body, parameter[0].raw);
        if (uses.length === 0 || hasUnsafeTemplateReference(body, parameter[0].raw)) continue;
        // Every use must be the sole direct UI argument. Reassignment, closure
        // shadowing and any non-UI reuse are intentionally rejected.
        if (uses.every((relative) => sinkArguments.has(body[relative].start))) forwarded.add(position);
      }
      if (forwarded.size === 0) continue;
      let replaced = false;
      for (let cursor = open + 1; cursor < end; cursor += 1) {
        if (tokens[cursor]?.raw === "this" && tokens[cursor + 1]?.raw === "[") {
          const property = tokens[cursor + 2];
          if (property?.kind !== "literal" || decodeJsLiteral(property.raw) === method.name) replaced = true;
        }
        if (tokens[cursor]?.raw === "this" && tokens[cursor + 1]?.raw === "."
          && tokens[cursor + 2]?.raw === method.name && tokens[cursor + 3]?.raw !== "(") replaced = true;
      }
      if (replaced) continue;
      for (const caller of methods) {
        // Nested functions/classes can change `this`; don't borrow their calls.
        if (!caller.eligible || changesThisBinding(tokens, matching, caller.start, caller.end)) continue;
        for (let cursor = caller.start; cursor + 3 < caller.end; cursor += 1) {
          if (tokens[cursor]?.raw !== "this" || tokens[cursor + 1]?.raw !== "."
            || tokens[cursor + 2]?.raw !== method.name || tokens[cursor + 3]?.raw !== "(") continue;
          const call = readCallArguments(tokens, cursor + 3, matching);
          for (const position of forwarded) {
            const argument = call?.arguments[position];
            if (argument?.length !== 1 || argument[0]?.kind !== "literal") continue;
            const text = decodeJsLiteral(argument[0].raw);
            if (text !== null) addIndirectText(target, text, argument[0], "forwardedUiParameter", sourceLocale);
          }
        }
      }
    }
  }
}

/** Static Map keys need a bounded for-of -> addOption(label) proof. Reads via
 * get/has are allowed; mutation, aliasing and other escapes reject the map. */
export function collectMapOptionLabels(
  tokens: readonly Token[], matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>, sourceLocale: string,
): void {
  for (let index = 1; index + 11 < tokens.length; index += 1) {
    const name = tokens[index];
    if (name?.kind !== "identifier" || !["const", "let", "var"].includes(tokens[index - 1]?.raw ?? "")
      || !["=", "new", "Map", "(", "Object", ".", "entries", "(", "{"].every((raw, offset) => tokens[index + 1 + offset]?.raw === raw)) continue;
    const objectEnd = matching[index + 9] ?? -1;
    if (objectEnd < 0 || tokens[objectEnd + 1]?.raw !== ")" || tokens[objectEnd + 2]?.raw !== ")"
      || ![";", ","].includes(tokens[objectEnd + 3]?.raw ?? "")) continue;
    const entries = splitTopLevelTokens(tokens.slice(index + 10, objectEnd));
    const labels = entries.map((entry) => {
      const colon = topLevelTokenIndex(entry, ":");
      return colon === 1 ? staticCatalogKey(entry.slice(0, colon)) : null;
    });
    if (labels.length === 0 || labels.some((label) => label === null) || new Set(labels).size !== labels.length) continue;
    if (hasUnsafeTemplateReference(tokens, name.raw)) continue;
    const [, scopeEnd] = bindingScope(tokens, matching, index);
    let safe = true;
    let consumed = false;
    for (const use of identifierUses(tokens, name.raw)) {
      if (use === index) continue;
      if (use <= index || use >= scopeEnd || tokens[use + 1]?.raw !== ".") { safe = false; break; }
      const operation = tokens[use + 2]?.raw;
      if ((operation === "get" || operation === "has") && tokens[use + 3]?.raw === "(") continue;
      if (operation !== "keys" || !["(", ")", ")"].every((raw, offset) => tokens[use + 3 + offset]?.raw === raw)
        || tokens[use - 1]?.raw !== "of" || tokens[use - 2]?.kind !== "identifier"
        || !["let", "const"].includes(tokens[use - 3]?.raw ?? "")
        || tokens[use - 4]?.raw !== "(" || tokens[use - 5]?.raw !== "for") { safe = false; break; }
      const iterator = tokens[use - 2].raw;
      const bodyStart = use + 6;
      let bodyEnd = matching[bodyStart] ?? -1;
      if (tokens[bodyStart]?.raw !== "{") {
        // A single receiver.addOption(...) statement, as in minified bundles.
        if (tokens[bodyStart]?.kind !== "identifier" || tokens[bodyStart + 1]?.raw !== "."
          || tokens[bodyStart + 2]?.raw !== "addOption" || tokens[bodyStart + 3]?.raw !== "(") { safe = false; break; }
        bodyEnd = matching[bodyStart + 3] ?? -1;
        if (![";", "}"].includes(tokens[bodyEnd + 1]?.raw ?? "")) { safe = false; break; }
      }
      if (bodyEnd < bodyStart) { safe = false; break; }
      let labelUse = false;
      const allowed = new Set<number>();
      for (let cursor = bodyStart; cursor < bodyEnd; cursor += 1) {
        if (tokens[cursor]?.raw !== "addOption" || tokens[cursor - 1]?.raw !== "." || tokens[cursor + 1]?.raw !== "(") continue;
        const args = readCallArguments(tokens, cursor + 1, matching)?.arguments;
        if (args?.length !== 2) continue;
        for (const [position, argument] of args.entries()) {
          if (argument.length !== 1 || argument[0]?.raw !== iterator) continue;
          allowed.add(argument[0].start);
          if (position === 1) labelUse = true;
        }
      }
      if (hasUnsafeTemplateReference(tokens.slice(bodyStart, bodyEnd + 1), iterator)) { safe = false; break; }
      const uses = identifierUses(tokens.slice(bodyStart, bodyEnd + 1), iterator);
      if (uses.some((relative) => !allowed.has(tokens[bodyStart + relative].start))) { safe = false; break; }
      consumed ||= labelUse;
    }
    if (safe && consumed) for (const label of labels) {
      if (label !== null && label !== "__proto__") addIndirectText(target, label, name, "mapOptionLabel", sourceLocale);
    }
  }
}

/** A flat immutable lookup is UI copy only when every read feeds a `label`
 * property inside an array map. This covers tab descriptors without pulling
 * arbitrary configuration/dispatch dictionaries into the catalog. */
export function collectMappedLabelDictionaries(
  tokens: readonly Token[], matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>, sourceLocale: string,
): void {
  for (let index = 1; index + 5 < tokens.length; index += 1) {
    const name = tokens[index];
    if (name?.kind !== "identifier" || !["var", "let", "const", ",", ";"].includes(tokens[index - 1]?.raw ?? "")
      || tokens[index + 1]?.raw !== "=" || tokens[index + 2]?.raw !== "{") continue;
    const end = matching[index + 2] ?? -1;
    if (end < 0 || end - index > 256 || ![",", ";"].includes(tokens[end + 1]?.raw ?? "")) continue;
    const entries = splitTopLevelTokens(tokens.slice(index + 3, end));
    if (entries.length < 2 || entries.length > 32) continue;
    const values: { key: string; text: string; token: Token }[] = [];
    for (const entry of entries) {
      const colon = topLevelTokenIndex(entry, ":");
      const key = colon === 1 ? staticCatalogKey(entry.slice(0, colon)) : null;
      const literal = colon === entry.length - 2 ? entry[colon + 1] : undefined;
      const decoded = literal?.kind === "literal" ? decodeJsLiteral(literal.raw) : null;
      if (key === null || key === "__proto__" || literal === undefined || decoded === null
        || literal.raw.startsWith("`") && literal.raw.includes("${")) break;
      values.push({ key, text: decoded, token: literal });
    }
    if (values.length !== entries.length || new Set(values.map((value) => value.key)).size !== values.length
      || hasUnsafeTemplateReference(tokens, name.raw)) continue;
    const uses = identifierUses(tokens, name.raw);
    if (uses.length < 2 || uses[0] !== index || uses.some((use) => use !== index && (
      use < end || tokens[use - 2]?.raw !== "label" || tokens[use - 1]?.raw !== ":"
      || tokens[use + 1]?.raw !== "[" || tokens[use + 2]?.kind !== "identifier"
      || tokens[use + 3]?.raw !== "]"
      || !insideArrayMap(tokens, matching, use, new Set(values.map((value) => value.key)))
    ))) continue;
    for (const value of values) {
      addCandidate(target, value.text, "ui-property", sourceLocale, {
        origin: "ui-property", strategy: "structured", symbol: "mappedLabel",
        offset: value.token.start, line: value.token.line, column: value.token.column,
        literalStart: value.token.start, literalEnd: value.token.end,
      }, value.text, true);
    }
  }
}

function insideArrayMap(
  tokens: readonly Token[], matching: MatchingTokenIndexes, use: number, keys: ReadonlySet<string>,
): boolean {
  for (let index = use - 1; index >= Math.max(0, use - 48); index -= 1) {
    if (tokens[index]?.raw !== "map" || tokens[index - 1]?.raw !== "."
      || tokens[index - 2]?.kind !== "identifier" || tokens[index - 3]?.raw === "."
      || tokens[index + 1]?.raw !== "(" || (matching[index + 1] ?? -1) < use
      || tokens[index + 2]?.raw !== tokens[use + 2]?.raw
      || tokens[index + 3]?.raw !== "=" || tokens[index + 4]?.raw !== ">") continue;
    const arrayName = tokens[index - 2]?.raw;
    if (arrayName !== undefined && staticArrayKeys(tokens, matching, arrayName, keys)) return true;
  }
  return false;
}

function staticArrayKeys(
  tokens: readonly Token[], matching: MatchingTokenIndexes, name: string, keys: ReadonlySet<string>,
): boolean {
  const uses = identifierUses(tokens, name);
  const declarations = uses.filter((index) =>
    ["var", "let", "const", ",", ";"].includes(tokens[index - 1]?.raw ?? "")
    && tokens[index + 1]?.raw === "=" && tokens[index + 2]?.raw === "[");
  if (declarations.length !== 1) return false;
  const declaration = declarations[0];
  const end = matching[declaration + 2] ?? -1;
  if (end < 0 || end - declaration > 128 || ![",", ";"].includes(tokens[end + 1]?.raw ?? "")
    || uses.some((index) => index !== declaration && (
      index < end || tokens[index + 1]?.raw !== "." || tokens[index + 2]?.raw !== "map"
    ))) return false;
  const values = splitTopLevelTokens(tokens.slice(declaration + 3, end))
    .map((entry) => entry.length === 1 && entry[0]?.kind === "literal"
      ? decodeJsLiteral(entry[0].raw) : null);
  return values.length === keys.size && values.every((value) => value !== null && keys.has(value))
    && new Set(values).size === keys.size;
}
