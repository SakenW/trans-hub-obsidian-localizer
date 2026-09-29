import {
  matchingTokenIndex,
  readCallArguments,
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
import { addIndirectText, hasUnsafeTemplateReference, identifierUses, staticDescriptionBindings } from "./plugin-string-scanner-indirect";
import { staticSvelteTemplateTextNodes } from "./plugin-svelte-template-text";

const SETTINGS_SCHEMA_MIN_ENTRIES = 3;
const SETTINGS_SCHEMA_MAX_PARENT_TOKENS = 20_000;
const SETTINGS_SCHEMA_MAX_ENTRY_TOKENS = 500;
const UI_TEXT_DICTIONARY_MIN_GROUPS = 3;
const UI_TEXT_DICTIONARY_MIN_VALUES = 30;
const UI_TEXT_DICTIONARY_MIN_TITLE_RATIO = 0.85;
const UI_TEXT_DICTIONARY_MAX_DEPTH = 3;
const SVELTE_REACTIVE_TEXT_WINDOW = 512;
/** Conservative English function/UI words used to tell the English settings
 * schema apart from a plugin's other Latin-script language packs. */
const ENGLISH_SCHEMA_STOP_WORDS = new RegExp(
  String.raw`\b(?:the|of|to|and|for|with|from|is|are|show|select|choose|display|when|how|if|not|all|new|default|file|folder|note|list|view|setting|option|enable|disable|sort|group|title|name|value|item|this|that|you|your|will|can|also|only|size|color|icon|date|time|field|property|text|page|row|column|pane|panel|window|open|close|add|remove|edit|save|apply|back|next|previous|first|last|other|same|each|between|during|after|before|above|below|left|right|top|bottom|into|out|more|less|most|least|few|many|much|such|both|every|own|another|use|hide)\b`,
  "iu",
);
const ENGLISH_SCHEMA_MIN_DESC_SAMPLES = 5;
const ENGLISH_SCHEMA_MIN_HIT_RATIO = 0.8;

export function collectStructuralRuleMatches(
  bundle: string,
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
  onPhaseMeasured?: (phase: string, elapsedMs: number) => void,
): void {
  let startedAt = performance.now();
  const finishPhase = (phase: string): void => {
    const finishedAt = performance.now();
    onPhaseMeasured?.(phase, Math.round(finishedAt - startedAt));
    startedAt = finishedAt;
  };
  collectSettingsSchemaEntries(tokens, matching, target, sourceLocale);
  finishPhase("settings-schema");
  collectPluginSettingTabDefinitions(tokens, matching, target, sourceLocale);
  finishPhase("plugin-setting-tab");
  const linkedDescriptionHelpers = findLinkedDescriptionHelpers(tokens, matching);
  const groupDescriptions = collectSettingsGroupDescriptors(tokens, matching, target, sourceLocale, linkedDescriptionHelpers);
  finishPhase("settings-groups");
  collectComposedSettingsDescriptions(tokens, matching, groupDescriptions, linkedDescriptionHelpers, target, sourceLocale);
  finishPhase("settings-composed-docs");
  collectSvelteFormDescriptors(tokens, matching, target, sourceLocale);
  finishPhase("svelte-forms");
  collectSvelteTemplateText(tokens, target, sourceLocale);
  finishPhase("svelte-template");
  collectSvelteDomAttributeLabels(tokens, matching, target, sourceLocale);
  finishPhase("svelte-dom-attributes");
  collectSvelteReturnText(bundle, tokens, matching, target, sourceLocale);
  finishPhase("svelte-return-text");
  collectSvelteReactiveText(tokens, matching, target, sourceLocale);
  finishPhase("svelte-reactive-text");
  collectChoiceNameFactories(tokens, matching, target, sourceLocale);
  finishPhase("choice-factories");
  collectIndexedErrorMessages(tokens, matching, target, sourceLocale);
  finishPhase("indexed-error-messages");
  collectGroupedUiTextDictionary(tokens, matching, target, sourceLocale);
  finishPhase("ui-dictionary");
}

/** Obsidian's PluginSettingTab renders descriptors returned by this method.
 * Restrict helper arguments to methods that return name/desc plus a renderer. */
function collectPluginSettingTabDefinitions(
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (tokens[index]?.raw !== "PluginSettingTab" || tokens[index + 1]?.raw !== "{"
      || !tokens.slice(Math.max(0, index - 5), index).some((token) => token.raw === "extends")
      || !tokens.slice(Math.max(0, index - 10), index).some((token) => token.raw === "class")) continue;
    const classEnd = matching[index + 1] ?? -1;
    if (classEnd < 0 || classEnd - index > SETTINGS_SCHEMA_MAX_PARENT_TOKENS) continue;
    const helpers = new Set<string>();
    const methodCounts = new Map<string, number>();
    let definitions: readonly (readonly Token[])[] | undefined;
    for (let method = index + 2; method + 2 < classEnd; method += 1) {
      if (tokens[method]?.kind !== "identifier" || tokens[method + 1]?.raw !== "(") continue;
      const close = matching[method + 1] ?? -1;
      const open = close + 1;
      const end = matching[open] ?? -1;
      if (close < 0 || tokens[open]?.raw !== "{" || end < 0 || end > classEnd) continue;
      const methodName = tokens[method]?.raw ?? "";
      methodCounts.set(methodName, (methodCounts.get(methodName) ?? 0) + 1);
      if (tokens[method]?.raw === "getSettingDefinitions") {
        for (let cursor = open + 1; cursor + 1 < end; cursor += 1) {
          if (tokens[cursor]?.raw === "{" && (matching[cursor] ?? -1) > cursor) {
            cursor = matching[cursor] ?? cursor;
            continue;
          }
          if (tokens[cursor]?.raw !== "return" || tokens[cursor + 1]?.raw !== "[") continue;
          const arrayEnd = matching[cursor + 1] ?? -1;
          if (arrayEnd > cursor && arrayEnd < end) {
            definitions = splitTopLevelTokens(tokens.slice(cursor + 2, arrayEnd));
          }
          break;
        }
      } else {
        const params = splitTopLevelTokens(tokens.slice(method + 2, close));
        if (params.length >= 2 && params[0]?.length === 1 && params[1]?.length === 1
          && params[0]?.[0]?.kind === "identifier" && params[1]?.[0]?.kind === "identifier") {
          for (let cursor = open + 1; cursor + 1 < end; cursor += 1) {
            if (tokens[cursor]?.raw === "{" && (matching[cursor] ?? -1) > cursor) {
              cursor = matching[cursor] ?? cursor;
              continue;
            }
            if (tokens[cursor]?.raw !== "return" || tokens[cursor + 1]?.raw !== "{") continue;
            const objectEnd = matching[cursor + 1] ?? -1;
            if (objectEnd < 0 || objectEnd >= end) break;
            const object = tokens.slice(cursor + 1, objectEnd + 1);
            const name = staticObjectProperty(object, "name");
            const description = staticObjectProperty(object, "desc");
            if (name?.length === 1 && name[0]?.raw === params[0][0]?.raw
              && description?.length === 1 && description[0]?.raw === params[1][0]?.raw
              && staticObjectProperty(object, "render") !== undefined) helpers.add(tokens[method]?.raw ?? "");
            break;
          }
        }
      }
      method = end;
    }
    if (methodCounts.get("getSettingDefinitions") !== 1) definitions = undefined;
    for (const name of helpers) if (methodCounts.get(name) !== 1) helpers.delete(name);
    for (const item of definitions ?? []) {
      if (item[0]?.raw !== "{" || matchingTokenIndex(item, 0) !== item.length - 1) continue;
      const name = staticObjectStringProperty(item, "name");
      if (name !== undefined && (staticObjectProperty(item, "render") !== undefined
        || staticObjectProperty(item, "control") !== undefined)) {
        addSettingsSchemaValue(target, name, name[0], sourceLocale, "pluginSettingTab");
        const description = staticObjectStringProperty(item, "desc");
        if (description !== undefined) addSettingsSchemaValue(target, description, description[0], sourceLocale, "pluginSettingTab");
      }
      const type = staticObjectStringProperty(item, "type");
      const heading = staticObjectStringProperty(item, "heading");
      const children = staticObjectArrayProperty(item, "items");
      if (decodeJsLiteral(type?.[0]?.raw ?? "") !== "group" || heading === undefined || children === undefined) continue;
      let proven = false;
      for (const child of children) {
        if (child[0]?.raw !== "this" || child[1]?.raw !== "."
          || !helpers.has(child[2]?.raw ?? "") || child[3]?.raw !== "("
          || matchingTokenIndex(child, 3) !== child.length - 1) continue;
        const arguments_ = splitTopLevelTokens(child.slice(4, -1));
        if (arguments_[0]?.length !== 1 || arguments_[0]?.[0]?.kind !== "literal"
          || arguments_[1]?.length !== 1 || arguments_[1]?.[0]?.kind !== "literal") continue;
        proven = true;
        for (const argument of arguments_.slice(0, 2)) {
          const literal = argument[0];
          if (literal !== undefined) addSettingsSchemaValue(target, argument, literal, sourceLocale, "pluginSettingTabHelper");
        }
      }
      if (proven) addSettingsSchemaValue(target, heading, heading[0], sourceLocale, "pluginSettingTab");
    }
    index = classEnd;
  }
}

/** A small error-message bag is UI copy only when its indexed values reach a
 * local helper that forwards its argument to Obsidian's createEl text option. */
function collectIndexedErrorMessages(
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  for (let index = 0; index + 4 < tokens.length; index += 1) {
    if (tokens[index]?.raw !== "this" || tokens[index + 1]?.raw !== "."
      || tokens[index + 2]?.raw !== "errorMessages" || tokens[index + 3]?.raw !== "="
      || tokens[index + 4]?.raw !== "{") continue;
    const end = matching[index + 4] ?? -1;
    if (end < 0 || end - index > 128) continue;
    const windowEnd = Math.min(tokens.length, end + 512);
    if (!hasIndexedErrorMessageSink(tokens, matching, end + 1, windowEnd)) continue;
    const entries = splitTopLevelTokens(tokens.slice(index + 5, end));
    if (entries.length === 0 || entries.length > 16) continue;
    for (const entry of entries) {
      const colon = topLevelTokenIndex(entry, ":");
      if (colon !== 1 || staticCatalogKey(entry.slice(0, colon)) === null
        || entry.length !== 3 || entry[2]?.kind !== "literal") continue;
      addSettingsSchemaValue(target, [entry[2]], entry[0], sourceLocale, "indexedErrorMessage");
    }
  }
}

function hasIndexedErrorMessageSink(
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  start: number,
  end: number,
): boolean {
  let helperParameter: string | null = null;
  let helperRendersText = false;
  let bagPassedToHelper = false;
  for (let index = start; index + 7 < end; index += 1) {
    if (tokens[index]?.raw !== "createError") continue;
    if (tokens[index + 1]?.raw === "=" && tokens[index + 2]?.raw === "("
      && tokens[index + 3]?.kind === "identifier" && tokens[index + 4]?.raw === ")"
      && tokens[index + 5]?.raw === "=" && tokens[index + 6]?.raw === ">") {
      helperParameter = tokens[index + 3]?.raw ?? null;
      for (let cursor = index + 7; cursor < Math.min(end, index + 80); cursor += 1) {
        if (tokens[cursor]?.raw === ";") break;
        if (tokens[cursor]?.raw !== "createEl" || tokens[cursor + 1]?.raw !== "(") continue;
        const call = readCallArguments(tokens, cursor + 1, matching);
        if (call === null) continue;
        const options = call.arguments[1];
        if (options?.[0]?.raw !== "{" || matchingTokenIndex(options, 0) !== options.length - 1) continue;
        helperRendersText ||= splitTopLevelTokens(options.slice(1, -1)).some((property) =>
          (property.length === 1 && property[0]?.raw === "text" && helperParameter === "text")
          || (property.length === 3 && property[0]?.raw === "text"
            && property[1]?.raw === ":" && property[2]?.raw === helperParameter));
      }
    }
    if (tokens[index + 1]?.raw !== "(") continue;
    const call = readCallArguments(tokens, index + 1, matching);
    const argument = call?.arguments[0];
    if (argument?.[0]?.raw === "this" && argument[1]?.raw === "."
      && argument[2]?.raw === "errorMessages" && argument[3]?.raw === "["
      && matchingTokenIndex(argument, 3) === argument.length - 1) bagPassedToHelper = true;
  }
  return helperRendersText && bagPassedToHelper;
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
  symbol = "settingsSchema",
): void {
  const counter = { value: 0 };
  const rendered = renderExpression(expression, counter);
  if (rendered === null) return;
  const literal = expression[0];
  addCandidate(target, rendered.text, "ui-property", sourceLocale, {
    origin: "ui-property",
    strategy: "structured",
    symbol,
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
  linkedDescriptionHelpers: ReadonlySet<string>,
): ReadonlySet<Token> {
  const descriptionNames = new Set<Token>();
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
      for (const property of ["desc", "description"]) {
        const descriptionReference = staticObjectProperty(item, property);
        if (descriptionReference?.length === 1 && descriptionReference[0]?.kind === "identifier") {
          descriptionNames.add(descriptionReference[0]);
        }
      }
      for (const property of ["name", "desc", "description"]) {
        const expression = staticObjectStringProperty(item, property);
        if (expression !== undefined) {
          addSettingsSchemaValue(target, expression, descriptorKey, sourceLocale);
        } else if (property !== "name") {
          const description = staticObjectProperty(item, property);
          const documentationLead = firstLiteralArgument(description);
          if (documentationLead !== undefined) {
            addSettingsSchemaValue(target, documentationLead, descriptorKey, sourceLocale, "settingsDocumentation");
          }
          for (const literal of linkedDescriptionLiterals(description, linkedDescriptionHelpers)) {
            addSettingsSchemaValue(target, literal, descriptorKey, sourceLocale, "settingsLinkedFragment");
          }
        }
      }
      collectSettingsDropdownOptions(item, descriptorKey, target, sourceLocale);
    }
  }
  return descriptionNames;
}

/** Only a helper that creates the first text node and passes the third
 * argument to a proven link-text sink may expose both literal arguments. */
function findLinkedDescriptionHelpers(tokens: readonly Token[], matching: MatchingTokenIndexes): ReadonlySet<string> {
  const declarations = new Map<string, { readonly params: readonly string[]; readonly start: number; readonly end: number }>();
  const duplicates = new Set<string>();
  for (let index = 0; index + 4 < tokens.length; index += 1) {
    if (tokens[index]?.raw !== "function" || tokens[index + 1]?.kind !== "identifier"
      || tokens[index + 2]?.raw !== "(") continue;
    const name = tokens[index + 1]?.raw ?? "";
    const close = matching[index + 2] ?? -1;
    const open = close + 1;
    const end = matching[open] ?? -1;
    if (close < 0 || tokens[open]?.raw !== "{" || end < 0 || end - open > 180) continue;
    if (declarations.has(name)) duplicates.add(name);
    const params = splitTopLevelTokens(tokens.slice(index + 3, close))
      .map((part) => part[0]?.kind === "identifier" ? part[0].raw : "");
    declarations.set(name, { params, start: open + 1, end });
  }
  // A minified helper name is evidence only while it denotes one declaration.
  // Assignments, parameter shadowing, aliases and out-of-scope calls reject it.
  const unambiguousHelper = (name: string): boolean => {
    const uses = identifierUses(tokens, name);
    const definitions = uses.filter((index) => tokens[index - 1]?.raw === "function");
    if (definitions.length !== 1 || hasUnsafeTemplateReference(tokens, name)) return false;
    const definition = definitions[0];
    let scopeStart = 0;
    let scopeEnd = tokens.length;
    for (let cursor = definition - 1; cursor >= 0; cursor -= 1) {
      if (tokens[cursor]?.raw === "{" && (matching[cursor] ?? -1) > definition) {
        scopeStart = cursor;
        scopeEnd = matching[cursor];
        break;
      }
    }
    return !uses.some((index) => index !== definition && (tokens[index + 1]?.raw !== "("
      || index < scopeStart || index >= scopeEnd));
  };
  const linkHelpers = new Set<string>();
  for (const [name, declaration] of declarations) {
    if (duplicates.has(name) || declaration.params.length < 3) continue;
    const [parent, url, label] = declaration.params;
    const body = tokens.slice(declaration.start, declaration.end);
    if (parent !== undefined && url !== undefined && label !== undefined
      && hasTokenSequence(body, ["textContent", "=", label])
      && hasTokenSequence(body, ["href", "=", url])
      && hasTokenSequence(body, [parent, ".", "append", "("])
      && unambiguousHelper(name)) linkHelpers.add(name);
  }
  const wrappers = new Set<string>();
  for (const [name, declaration] of declarations) {
    if (duplicates.has(name) || declaration.params.length < 3) continue;
    const [lead, url, label] = declaration.params;
    const body = tokens.slice(declaration.start, declaration.end);
    if (lead === undefined || url === undefined || label === undefined
      || !hasTokenSequence(body, ["createFragment", "("])
      || !hasTokenSequence(body, ["document", ".", "createTextNode", "(", lead, ")"])
      || !hasTokenSequence(body, ["return"])) continue;
    const leadUses = identifierUses(body, lead);
    if (hasUnsafeTemplateReference(body, lead) || leadUses.some((index) =>
      body[index - 4]?.raw !== "document" || body[index - 3]?.raw !== "."
      || body[index - 2]?.raw !== "createTextNode" || body[index - 1]?.raw !== "("
      || body[index + 1]?.raw !== ")")) continue;
    for (let index = declaration.start; index + 1 < declaration.end; index += 1) {
      if (!linkHelpers.has(tokens[index]?.raw ?? "") || tokens[index + 1]?.raw !== "(") continue;
      const args = readCallArguments(tokens, index + 1, matching)?.arguments;
      if (args?.length === 3 && args[1]?.length === 1 && args[1][0]?.raw === url
        && args[2]?.length === 1 && args[2][0]?.raw === label
        && unambiguousHelper(name)) wrappers.add(name);
    }
  }
  return wrappers;
}

function hasTokenSequence(tokens: readonly Token[], sequence: readonly string[]): boolean {
  return tokens.some((_token, index) => sequence.every((raw, offset) => tokens[index + offset]?.raw === raw));
}

function linkedDescriptionLiterals(
  expression: readonly Token[] | undefined,
  helpers: ReadonlySet<string>,
): readonly (readonly Token[])[] {
  if (expression?.[0]?.kind !== "identifier" || !helpers.has(expression[0].raw)
    || expression[1]?.raw !== "(" || matchingTokenIndex(expression, 1) !== expression.length - 1) return [];
  const args = splitTopLevelTokens(expression.slice(2, -1));
  return [args[0], args[2]].filter((part): part is readonly Token[] =>
    part?.length === 1 && part[0]?.kind === "literal");
}

/** A proven settings description may be reused inside linked documentation.
 * Fold only a single immutable literal reference in both static branches;
 * each resulting text node is a separate runtime translation, never a patch. */
function collectComposedSettingsDescriptions(
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  descriptorReferences: ReadonlySet<Token>,
  helpers: ReadonlySet<string>,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  const references = new Set(descriptorReferences);
  for (let index = 0; index + 3 < tokens.length; index += 1) {
    if (tokens[index]?.raw === "setDesc" && tokens[index - 1]?.raw === "." && tokens[index + 1]?.raw === "("
      && tokens[index + 2]?.kind === "identifier" && tokens[index + 3]?.raw === ")") {
      references.add(tokens[index + 2]);
    }
  }
  const constants = staticDescriptionBindings(tokens, matching, references);
  for (const reference of references) {
    const binding = constants.get(reference.raw);
    if (binding !== undefined) addIndirectText(target, binding.text, reference, "settingsDescriptionReference", sourceLocale);
  }
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const call = tokens[index];
    if (call === undefined || !helpers.has(call.raw) || tokens[index - 1]?.raw === "."
      || tokens[index + 1]?.raw !== "(") continue;
    const args = readCallArguments(tokens, index + 1, matching)?.arguments;
    const expression = args?.[0];
    if (expression === undefined) continue;
    const question = topLevelTokenIndex(expression, "?");
    const colonOffset = question < 0 ? -1 : topLevelTokenIndex(expression.slice(question + 1), ":");
    const colon = colonOffset < 0 ? -1 : question + 1 + colonOffset;
    if (question < 0 || colon !== question + 2 || expression.length !== colon + 2) continue;
    const variants = [expression[question + 1], expression[colon + 1]];
    for (const variant of variants) {
      if (variant?.kind !== "literal" || !variant.raw.startsWith("`")) continue;
      for (const [name, binding] of constants) {
        if (index <= binding.start || index >= binding.end) continue;
        const marker = `\${${name}}`;
        const body = variant.raw.slice(1, -1);
        const at = body.indexOf(marker);
        if (at < 0 || body.indexOf("${") !== at || body.includes("${", at + marker.length)) continue;
        const prefix = decodeJsLiteral(`\`${body.slice(0, at)}\``);
        const suffix = decodeJsLiteral(`\`${body.slice(at + marker.length)}\``);
        if (prefix === null || suffix === null) continue;
        addIndirectText(target, prefix + binding.text + suffix, variant, "settingsComposedDocumentation", sourceLocale);
      }
    }
  }
}

/**
 * Some settings frameworks keep dropdown labels inside an item's declarative
 * control object rather than calling Obsidian's `addOptions`. Those values are
 * still visible UI copy, but only accept them while already inside a proven
 * settings-group descriptor.
 */
function collectSettingsDropdownOptions(
  item: readonly Token[],
  descriptorKey: Token,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  const control = staticObjectProperty(item, "control");
  if (control === undefined) return;
  const object = stripWrappingParentheses(control);
  if (object[0]?.raw !== "{" || matchingTokenIndex(object, 0) !== object.length - 1) return;
  const type = staticObjectStringProperty(object, "type");
  if (type === undefined || decodeJsLiteral(type[0]?.raw ?? "") !== "dropdown") return;
  const options = staticObjectProperty(object, "options");
  if (options === undefined) return;
  const optionObject = stripWrappingParentheses(options);
  if (optionObject[0]?.raw !== "{" || matchingTokenIndex(optionObject, 0) !== optionObject.length - 1) return;
  for (const entry of splitTopLevelTokens(optionObject.slice(1, -1))) {
    const colon = topLevelTokenIndex(entry, ":");
    if (colon <= 0) continue;
    const value = entry.slice(colon + 1);
    if (value.length !== 1 || value[0]?.kind !== "literal") continue;
    addSettingsSchemaValue(target, value, descriptorKey, sourceLocale, "settingsDropdownOption");
  }
}

/**
 * Svelte's production compiler commonly lowers a form row to an arbitrary
 * minified function call with an object such as `{name, desc, control}`.
 * The constructor name is unstable. A direct component call proves the row;
 * declarative settings entries instead need a recognized static control type.
 * Bare configuration objects and `children`-only JSX/MathML nodes do not.
 */
function collectSvelteFormDescriptors(
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.raw !== "{") continue;
    const end = matching[index];
    if (end < 0 || end - index > SETTINGS_SCHEMA_MAX_ENTRY_TOKENS) continue;
    const firstCallArgument = tokens[index - 1]?.raw === "("
      && tokens[index - 2]?.kind === "identifier";
    const secondCallArgument = tokens[index - 1]?.raw === ","
      && tokens[index - 2]?.kind === "identifier"
      && tokens[index - 3]?.raw === "("
      && tokens[index - 4]?.kind === "identifier";
    const directCall = (firstCallArgument || secondCallArgument) && tokens[end + 1]?.raw === ")";
    const object = tokens.slice(index, end + 1);
    const name = staticObjectStringProperty(object, "name");
    if (name === undefined) continue;
    const heading = staticObjectProperty(object, "heading");
    const isHeading = (heading?.length === 1 && heading[0]?.raw === "true")
      || (heading?.length === 2 && heading[0]?.raw === "!" && heading[1]?.raw === "0");
    const isInteractive = ["control", "$$slots"].some((property) => (
      staticObjectProperty(object, property) !== undefined
    ));
    const control = staticObjectProperty(object, "control");
    const controlObject = stripWrappingParentheses(control ?? []);
    const controlType = controlObject[0]?.raw === "{"
      ? staticObjectStringProperty(controlObject, "type") : undefined;
    const recognizedControl = controlType !== undefined
      && ["toggle", "text", "number", "folder", "dropdown"]
        .includes(decodeJsLiteral(controlType[0]?.raw ?? "") ?? "");
    if ((!directCall && !recognizedControl) || (!isHeading && !isInteractive)) continue;
    const descriptorKey = tokens[index + 1] ?? tokens[index] ?? name[0];
    addSettingsSchemaValue(target, name, descriptorKey, sourceLocale, "svelteForm");
    for (const property of ["desc", "description"]) {
      const description = staticObjectStringProperty(object, property);
      if (description !== undefined) addSettingsSchemaValue(target, description, descriptorKey, sourceLocale, "svelteForm");
    }
  }
}

/** Svelte templates retain static text inside string literals with `<!>`
 * insertion markers. Restricting extraction to that compiler marker avoids
 * treating arbitrary HTML strings as application UI. */
function collectSvelteTemplateText(
  tokens: readonly Token[],
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  for (let index = 0; index + 3 < tokens.length; index += 1) {
    if (tokens[index]?.kind !== "identifier" || tokens[index + 1]?.raw !== "(") continue;
    const literal = tokens[index + 2];
    if (literal?.kind !== "literal" || tokens[index + 3]?.raw !== ")") continue;
    const template = decodeJsLiteral(literal.raw);
    if (template === null) continue;
    for (const text of staticSvelteTemplateTextNodes(template)) {
      addCandidate(target, text, "ui-property", sourceLocale, {
        origin: "ui-property", strategy: "structured", symbol: "svelteTemplate",
        offset: literal.start, line: literal.line, column: literal.column,
      }, text, true);
    }
  }
}

/** Svelte's `attr(node, name, value)` is a presentation sink only when its
 * unique local helper demonstrably forwards the value to setAttribute. */
function collectSvelteDomAttributeLabels(
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  const helpers = new Set<string>();
  const declarations = new Map<string, number>();
  for (let index = 0; index + 4 < tokens.length; index += 1) {
    if (tokens[index]?.raw !== "function" || tokens[index + 1]?.kind !== "identifier"
      || tokens[index + 2]?.raw !== "(") continue;
    const name = tokens[index + 1]?.raw;
    if (name === undefined) continue;
    declarations.set(name, (declarations.get(name) ?? 0) + 1);
    const close = matching[index + 2] ?? -1;
    const open = close + 1;
    const end = matching[open] ?? -1;
    if (close < 0 || tokens[open]?.raw !== "{" || end < 0 || end - open > 128) continue;
    const params = splitTopLevelTokens(tokens.slice(index + 3, close));
    if (params.length !== 3 || params.some((part) => part.length !== 1 || part[0]?.kind !== "identifier")) continue;
    const [node, attribute, value] = params.map((part) => part[0]?.raw ?? "");
    if (hasTokenSequence(tokens.slice(open + 1, end),
      [node, ".", "setAttribute", "(", attribute, ",", value, ")"])) helpers.add(name);
  }
  for (const name of helpers) if (declarations.get(name) !== 1) helpers.delete(name);
  if (helpers.size === 0) return;
  const visibleAttributes = new Set(["aria-label", "title", "placeholder"]);
  for (let index = 1; index + 1 < tokens.length; index += 1) {
    if (!helpers.has(tokens[index]?.raw ?? "") || tokens[index - 1]?.raw === "."
      || tokens[index + 1]?.raw !== "(") continue;
    const call = readCallArguments(tokens, index + 1, matching);
    if (call?.arguments.length !== 3) continue;
    const [receiver, attribute, value] = call.arguments;
    if (receiver?.length !== 1 || receiver[0]?.kind !== "identifier"
      || attribute?.length !== 1 || value?.length !== 1 || value[0]?.kind !== "literal"
      || !visibleAttributes.has(decodeJsLiteral(attribute[0]?.raw ?? "") ?? "")) continue;
    addSettingsSchemaValue(target, value, value[0], sourceLocale, "svelteDomAttribute");
  }
}

/** A compiled Svelte label helper is UI copy only when its context slot is
 * bound in a returned instance array and the annotated call creates a text
 * node. Function-return literals alone may also be control sentinels. */
function collectSvelteReturnText(
  bundle: string,
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  const markers = new Map<string, Set<number>>();
  const rendered = /\b(?:let|var|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\/\*([A-Za-z_$][A-Za-z0-9_$]*)\*\/\s*ctx\[(\d{1,2})\]\([^)]{1,256}\)\s*\+\s*(?:""|'')/gu;
  for (const match of bundle.matchAll(rendered)) {
    const [variable, helper, rawIndex] = match.slice(1);
    const contextIndex = Number(rawIndex);
    if (variable === undefined || helper === undefined || !Number.isSafeInteger(contextIndex)) continue;
    let low = 0;
    let high = tokens.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((tokens[middle]?.start ?? Number.MAX_SAFE_INTEGER) < match.index) low = middle + 1;
      else high = middle;
    }
    if (tokens[low]?.start !== match.index) continue;
    let scopeEnd = -1;
    for (let index = low - 1; index >= Math.max(0, low - 10_000); index -= 1) {
      if (tokens[index]?.raw === "{" && tokens[index - 1]?.raw === ")"
        && (matching[index] ?? -1) > low) {
        scopeEnd = matching[index] ?? -1;
        break;
      }
    }
    if (scopeEnd < 0 || !hasTokenSequence(tokens.slice(low, scopeEnd), ["text", "(", variable, ")"])) continue;
    const indexes = markers.get(helper) ?? new Set<number>();
    indexes.add(contextIndex);
    markers.set(helper, indexes);
  }
  if (markers.size === 0) return;
  const declarations = new Map<string, readonly Token[]>();
  const counts = new Map<string, number>();
  const bindings = new Map<string, number>();
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    if (tokens[index]?.raw === "function" && tokens[index + 1]?.kind === "identifier"
      && tokens[index + 2]?.raw === "(") {
      const name = tokens[index + 1]?.raw;
      if (name === undefined || !markers.has(name)) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      const close = matching[index + 2] ?? -1;
      const open = close + 1;
      const end = matching[open] ?? -1;
      if (close >= 0 && tokens[open]?.raw === "{" && end >= 0 && end - open <= 2048) {
        declarations.set(name, tokens.slice(open + 1, end));
      }
    }
    if (tokens[index]?.raw !== "return" || tokens[index + 1]?.raw !== "[") continue;
    const end = matching[index + 1] ?? -1;
    if (end < 0 || end - index > 128) continue;
    const parts = splitTopLevelTokens(tokens.slice(index + 2, end));
    for (const [name, indexes] of markers) {
      for (const contextIndex of indexes) {
        if (parts[contextIndex]?.length === 1 && parts[contextIndex]?.[0]?.raw === name) {
          bindings.set(name, (bindings.get(name) ?? 0) + 1);
        }
      }
    }
  }
  for (const [name, body] of declarations) {
    if (counts.get(name) !== 1 || bindings.get(name) !== 1) continue;
    const values = new Map<string, Token>();
    for (let index = 0; index + 1 < body.length; index += 1) {
      if (body[index]?.raw !== "return" || body[index + 1]?.kind !== "literal") continue;
      const literal = body[index + 1];
      const value = decodeJsLiteral(literal?.raw ?? "");
      if (literal !== undefined && value !== null) values.set(value, literal);
    }
    if (values.size < 3 || values.size > 64) continue;
    for (const [value, literal] of values) {
      addCandidate(target, value, "ui-property", sourceLocale, {
        origin: "ui-property", strategy: "structured", symbol: "svelteReturnText",
        offset: literal.start, line: literal.line, column: literal.column,
      }, value, true);
    }
  }
}

/** Svelte lowers a reactive button caption to a static two-arm store and a
 * later text-node update. Neither the store nor its literals prove UI use on
 * their own; the node creation plus direct update supplies that proof. */
function collectSvelteReactiveText(
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  const braces: number[] = [];
  for (let index = 1; index + 8 < tokens.length; index += 1) {
    const store = tokens[index];
    if (store?.raw === "{") braces.push(index);
    else if (store?.raw === "}") braces.pop();
    if (store?.kind !== "identifier"
      || !["let", "const", "var", ","].includes(tokens[index - 1]?.raw ?? "")
      || tokens[index + 1]?.raw !== "="
      || tokens[index + 2]?.kind !== "identifier"
      || tokens[index + 3]?.raw !== "("
      || tokens[index + 4]?.raw !== "("
      || tokens[index + 5]?.raw !== ")"
      || tokens[index + 6]?.raw !== "="
      || tokens[index + 7]?.raw !== ">") continue;
    const end = matching[index + 3];
    if (end < 0 || end - index > 64) continue;
    const body = tokens.slice(index + 8, end);
    const question = topLevelTokenIndex(body, "?");
    const colonOffset = question < 0 ? -1 : topLevelTokenIndex(body.slice(question + 1), ":");
    const colon = question < 0 || colonOffset < 0 ? -1 : question + 1 + colonOffset;
    if (question < 0 || colon < 0 || colon !== question + 2 || body.length !== colon + 2) continue;
    const values = [body[question + 1], body[colon + 1]];
    if (values.some((value) => value?.kind !== "literal" || decodeJsLiteral(value.raw) === null)) continue;
    const scopeEnd = matching[braces.at(-1) ?? -1] ?? tokens.length;
    if (!hasSvelteReactiveTextSink(tokens, store.raw, end + 1, scopeEnd)) continue;
    for (const value of values) {
      if (value === undefined) continue;
      const decoded = decodeJsLiteral(value.raw);
      if (decoded === null) continue;
      addCandidate(target, decoded, "ui-property", sourceLocale, {
        origin: "ui-property", strategy: "structured", symbol: "svelteReactiveText",
        offset: value.start, line: value.line, column: value.column,
      }, decoded, true);
    }
  }
}

function hasSvelteReactiveTextSink(tokens: readonly Token[], store: string, start: number, scopeEnd: number): boolean {
  const nodes = new Set<string>();
  const end = Math.min(tokens.length, start + SVELTE_REACTIVE_TEXT_WINDOW, scopeEnd);
  for (let index = start; index + 8 < end; index += 1) {
    const name = tokens[index];
    if (name?.kind !== "identifier") continue;
    if (tokens[index + 1]?.raw === "="
      && tokens[index + 2]?.kind === "identifier"
      && tokens[index + 3]?.raw === "("
      && tokens[index + 4]?.kind === "identifier"
      && tokens[index + 5]?.raw === ","
      && ((tokens[index + 6]?.raw === "!" && tokens[index + 7]?.raw === "0" && tokens[index + 8]?.raw === ")")
        || (tokens[index + 6]?.raw === "true" && tokens[index + 7]?.raw === ")"))) {
      nodes.add(name.raw);
    }
    if (tokens[index + 1]?.raw === "("
      && nodes.has(tokens[index + 2]?.raw ?? "")
      && tokens[index + 3]?.raw === ","
      && tokens[index + 4]?.kind === "identifier"
      && tokens[index + 5]?.raw === "("
      && tokens[index + 6]?.raw === store
      && tokens[index + 7]?.raw === ")"
      && tokens[index + 8]?.raw === ")") return true;
  }
  return false;
}

/** A choice factory is UI copy only when its result enters the observed
 * choice-creation callback, not merely because its values start with New. */
function collectChoiceNameFactories(
  tokens: readonly Token[],
  matching: MatchingTokenIndexes,
  target: Map<string, CandidateAggregate>,
  sourceLocale: string,
): void {
  const uiFactoryNames = new Set<string>();
  const declarationCounts = new Map<string, number>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.raw === "function" && tokens[index + 1]?.kind === "identifier") {
      const name = tokens[index + 1]?.raw;
      if (name !== undefined) declarationCounts.set(name, (declarationCounts.get(name) ?? 0) + 1);
    }
    if (tokens[index]?.raw !== "onAddChoice" || tokens[index + 1]?.raw !== "(") continue;
    const firstArgument = tokens[index + 2];
    const factoryCallOpen = index + 3;
    if (firstArgument?.kind === "identifier" && tokens[factoryCallOpen]?.raw === "("
      && matching[factoryCallOpen] > factoryCallOpen
      && matching[factoryCallOpen] < matching[index + 1]) uiFactoryNames.add(firstArgument.raw);
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.kind !== "identifier" || tokens[index]?.raw !== "switch") continue;
    const functionBodyOpen = index - 1;
    const parametersClose = functionBodyOpen - 1;
    if (tokens[functionBodyOpen]?.raw !== "{" || tokens[parametersClose]?.raw !== ")") continue;
    const parametersOpen = matching[parametersClose];
    const functionName = tokens[parametersOpen - 1];
    if (parametersOpen < 0 || functionName?.kind !== "identifier"
      || tokens[parametersOpen - 2]?.raw !== "function"
      || declarationCounts.get(functionName.raw) !== 1
      || !uiFactoryNames.has(functionName.raw)) continue;
    const conditionOpen = index + 1;
    if (tokens[conditionOpen]?.raw !== "(") continue;
    const conditionEnd = matching[conditionOpen];
    if (conditionEnd < 0) continue;
    const open = conditionEnd + 1;
    if (tokens[open]?.raw !== "{") continue;
    const end = matching[open];
    if (end < 0) continue;
    const values: Token[] = [];
    for (let candidate = open + 1; candidate + 4 < end; candidate += 1) {
      if (
        tokens[candidate]?.raw !== "case"
        || tokens[candidate + 1]?.kind !== "literal"
        || tokens[candidate + 2]?.raw !== ":"
        || tokens[candidate + 3]?.raw !== "return"
        || tokens[candidate + 4]?.kind !== "literal"
      ) continue;
      const value = tokens[candidate + 4];
      if (value !== undefined) values.push(value);
    }
    if (values.length < 3) continue;
    const rendered = values.map((value) => decodeJsLiteral(value.raw));
    if (rendered.some((value) => value === null || !/^New\s+/iu.test(value))) continue;
    for (const value of values) {
      addSettingsSchemaValue(target, [value], value, sourceLocale, "choiceNameFactory");
    }
    index = end;
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

function staticObjectProperty(
  object: readonly Token[],
  property: string,
): readonly Token[] | undefined {
  for (const prop of splitTopLevelTokens(object.slice(1, -1))) {
    const colon = topLevelTokenIndex(prop, ":");
    if (colon <= 0 || staticCatalogKey(prop.slice(0, colon)) !== property) continue;
    return prop.slice(colon + 1);
  }
  return undefined;
}

function firstLiteralArgument(value: readonly Token[] | undefined): readonly Token[] | undefined {
  // Only this observed settings-description wrapper proves that its first
  // literal becomes visible copy. Arbitrary helpers may take internal keys.
  if (value?.[0]?.raw !== "this" || value[1]?.raw !== "."
    || value[2]?.raw !== "descWithDocsLink" || value[3]?.raw !== "(") return undefined;
  const first = value[4];
  return first?.kind === "literal" ? [first] : undefined;
}
