import {
  matchingTokenIndex,
  splitTopLevelTokens,
  topLevelTokenIndex,
  type MatchingTokenIndexes,
  type Token,
} from "./plugin-string-scanner-lexical";
import {
  addCandidate,
  decodeJsLiteral,
  isPlausibleSourceLocaleText,
  isTranslatableUiText,
  renderExpression,
  staticCatalogKey,
  stripWrappingParentheses,
  type CandidateAggregate,
} from "./plugin-string-scanner-evidence";

const SETTINGS_SCHEMA_MIN_ENTRIES = 3;
const SETTINGS_SCHEMA_MAX_PARENT_TOKENS = 20_000;
const SETTINGS_SCHEMA_MAX_ENTRY_TOKENS = 500;
const UI_TEXT_DICTIONARY_MIN_GROUPS = 3;
const UI_TEXT_DICTIONARY_MIN_VALUES = 30;
const UI_TEXT_DICTIONARY_MIN_TITLE_RATIO = 0.85;
const UI_TEXT_DICTIONARY_MAX_DEPTH = 3;
/** Conservative English function/UI words used to tell the English settings
 * schema apart from a plugin's other Latin-script language packs. */
const ENGLISH_SCHEMA_STOP_WORDS = new RegExp(
  String.raw`\b(?:the|of|to|and|for|with|from|is|are|show|select|choose|display|when|how|if|not|all|new|default|file|folder|note|list|view|setting|option|enable|disable|sort|group|title|name|value|item|this|that|you|your|will|can|also|only|size|color|icon|date|time|field|property|text|page|row|column|pane|panel|window|open|close|add|remove|edit|save|apply|back|next|previous|first|last|other|same|each|between|during|after|before|above|below|left|right|top|bottom|into|out|more|less|most|least|few|many|much|such|both|every|own|another|use|hide)\b`,
  "iu",
);
const ENGLISH_SCHEMA_MIN_DESC_SAMPLES = 5;
const ENGLISH_SCHEMA_MIN_HIT_RATIO = 0.8;

export function collectStructuralRuleMatches(
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  collectSettingsSchemaEntries(tokens, matching, target, sourceLocale);
  collectSettingsGroupDescriptors(tokens, matching, target, sourceLocale);
  collectGroupedUiTextDictionary(tokens, matching, target, sourceLocale);
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
