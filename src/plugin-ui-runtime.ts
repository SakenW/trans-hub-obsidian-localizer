export type PluginTranslationProvenanceKind =
  | "upstream-native"
  | "th-reviewed-fill"
  | "th-reviewed-correction"
  | "th-automatic"
  | "th-published";

export type PluginTranslationApplication = "fill" | "correction";

export interface PluginUiTranslation {
  readonly pluginId: string;
  readonly source: string;
  readonly target: string;
  readonly provenanceKind?: PluginTranslationProvenanceKind;
  readonly application?: PluginTranslationApplication;
  /** Exact upstream-native target that an explicitly reviewed correction may replace. */
  readonly nativeTarget?: string;
}

const TRANSLATABLE_ATTRIBUTES = ["aria-label", "placeholder", "title"] as const;
const EXCLUDED_SELECTOR = ".markdown-source-view, .markdown-preview-view, .cm-editor, code, pre, script, style, [contenteditable='true']";
const SEARCH_HIGHLIGHT_SELECTOR = ".suggestion-highlight";
const COMMUNITY_FIELD_SELECTOR = ".community-item-name, .community-item-desc";
const COMMUNITY_FIELD_BADGE_SELECTOR = ".flair";
const DYNAMIC_TOKEN = /\{\{th:expr:(\d+)\}\}/gu;

interface RuntimeTemplateRule {
  readonly source: RegExp;
  readonly target: string;
  readonly tokenIndexes: readonly number[];
}

export interface RuntimeTranslationPlan {
  readonly exact: ReadonlyMap<string, string>;
  readonly templates: readonly RuntimeTemplateRule[];
  readonly nativeTargetTemplates: readonly RegExp[];
}

export function buildConflictSafeDictionary(
  translations: readonly PluginUiTranslation[],
): ReadonlyMap<string, string> {
  const nativeTargets = new Set(translations
    .map((translation) => translation.target.normalize("NFC").trim())
    .filter((target) => target !== ""));
  const candidates = new Map<string, Set<string>>();
  for (const translation of translations) {
    const source = translation.source.normalize("NFC").trim();
    const target = translation.target.normalize("NFC").trim();
    if (source === "" || target === "" || source === target) continue;
    addCandidate(candidates, source, target, !nativeTargets.has(source));
    if (
      translation.application === "correction"
      && translation.provenanceKind === "th-reviewed-correction"
      && translation.nativeTarget !== undefined
    ) {
      const nativeTarget = translation.nativeTarget.normalize("NFC").trim();
      if (nativeTarget !== "" && nativeTarget !== target) {
        addCandidate(candidates, nativeTarget, target, true);
      }
    }
  }
  return new Map([...candidates.entries()]
    .filter(([, values]) => values.size === 1)
    .map(([source, values]) => [source, [...values][0] ?? source]));
}

function addCandidate(
  candidates: Map<string, Set<string>>,
  source: string,
  target: string,
  allowed: boolean,
): void {
  if (!allowed) return;
  const values = candidates.get(source) ?? new Set<string>();
  values.add(target);
  candidates.set(source, values);
}

export function buildRuntimeTranslationPlan(
  translations: readonly PluginUiTranslation[],
): RuntimeTranslationPlan {
  const exact = buildConflictSafeDictionary(translations);
  const templates: RuntimeTemplateRule[] = [];
  const nativeTargetTemplates: RegExp[] = [];
  for (const [source, target] of exact) {
    const sourceTemplate = compileTemplate(source);
    if (sourceTemplate === null) continue;
    const targetTokenIndexes = templateTokenIndexes(target);
    if (targetTokenIndexes.join("\u0000") !== sourceTemplate.tokenIndexes.join("\u0000")) continue;
    templates.push({ source: sourceTemplate.pattern, target, tokenIndexes: sourceTemplate.tokenIndexes });
    const nativeTarget = compileTemplate(target);
    if (nativeTarget !== null) nativeTargetTemplates.push(nativeTarget.pattern);
  }
  return { exact, templates, nativeTargetTemplates };
}

export function translatePluginUiValue(
  raw: string,
  plan: RuntimeTranslationPlan,
): string | undefined {
  if (raw.length > 2_000) return undefined;
  const source = raw.trim();
  const exactTarget = plan.exact.get(source);
  if (exactTarget !== undefined) return raw.replace(source, exactTarget);
  if (plan.nativeTargetTemplates.some((pattern) => pattern.test(source))) return undefined;
  const candidates = new Set<string>();
  for (const rule of plan.templates) {
    const match = rule.source.exec(source);
    if (match === null) continue;
    const values = new Map(rule.tokenIndexes.map((index, position) => [index, match[position + 1] ?? ""]));
    candidates.add(rule.target.replace(DYNAMIC_TOKEN, (_token, index: string) => values.get(Number(index)) ?? ""));
  }
  if (candidates.size !== 1) return undefined;
  return raw.replace(source, [...candidates][0] ?? source);
}

export function shouldTranslatePluginUiElement(element: Pick<Element, "closest">): boolean {
  return element.closest(EXCLUDED_SELECTOR) === null
    && element.closest(SEARCH_HIGHLIGHT_SELECTOR) === null;
}

export function translatePluginUiFieldParts(
  parts: readonly string[],
  plan: RuntimeTranslationPlan,
): readonly string[] | undefined {
  const translated = translatePluginUiValue(parts.join(""), plan);
  if (translated === undefined) return undefined;
  return parts.map((_part, index) => index === 0 ? translated : "");
}

export class PluginUiTranslationRuntime {
  private plan: RuntimeTranslationPlan = { exact: new Map(), templates: [], nativeTargetTemplates: [] };
  private observer: MutationObserver | null = null;
  private readonly restoredText = new Map<Text, { original: string; translated: string }>();
  private readonly restoredAttributes = new Map<Element, Map<string, { original: string; translated: string }>>();

  update(translations: readonly PluginUiTranslation[]): void {
    this.restore();
    this.plan = buildRuntimeTranslationPlan(translations);
    if (this.observer !== null && document.body !== null) this.translateTree(document.body);
  }

  start(root: HTMLElement = document.body): void {
    if (this.observer !== null) return;
    this.translateTree(root);
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target instanceof Text) {
          this.translateText(mutation.target);
        }
        if (mutation.type === "childList" && mutation.target instanceof Element) {
          const field = mutation.target.closest(COMMUNITY_FIELD_SELECTOR);
          if (field !== null) this.translateCommunityField(field);
        }
        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          this.translateAttributes(mutation.target);
        }
        for (const node of Array.from(mutation.addedNodes)) this.translateTree(node);
      }
    });
    this.observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.restore();
  }

  private translateTree(root: Node): void {
    if (root instanceof Text) { this.translateText(root); return; }
    if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return;
    if (root instanceof Element) this.translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();
    while (current !== null) {
      if (current instanceof Text) this.translateText(current);
      else if (current instanceof Element) this.translateAttributes(current);
      current = walker.nextNode();
    }
  }

  private translateText(node: Text): void {
    const parent = node.parentElement;
    if (parent === null || parent.closest(EXCLUDED_SELECTOR) !== null) return;
    const field = parent.closest(COMMUNITY_FIELD_SELECTOR);
    if (field !== null) {
      this.translateCommunityField(field);
      return;
    }
    const raw = node.data;
    const translated = translatePluginUiValue(raw, this.plan);
    if (translated === undefined) return;
    if (!this.restoredText.has(node)) this.restoredText.set(node, { original: raw, translated });
    node.data = translated;
  }

  private translateCommunityField(field: Element): void {
    if (field.closest(EXCLUDED_SELECTOR) !== null) return;
    const nodes = communityFieldTextNodes(field);
    const translatedParts = translatePluginUiFieldParts(nodes.map((node) => node.data), this.plan);
    if (translatedParts === undefined) return;
    nodes.forEach((node, index) => {
      const translated = translatedParts[index] ?? "";
      if (!this.restoredText.has(node)) {
        this.restoredText.set(node, { original: node.data, translated });
      }
      node.data = translated;
    });
  }

  private translateAttributes(element: Element): void {
    if (!shouldTranslatePluginUiElement(element)) return;
    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      const raw = element.getAttribute(attribute);
      if (raw === null) continue;
      const translated = translatePluginUiValue(raw, this.plan);
      if (translated === undefined) continue;
      const values = this.restoredAttributes.get(element) ?? new Map<string, { original: string; translated: string }>();
      if (!values.has(attribute)) values.set(attribute, { original: raw, translated });
      this.restoredAttributes.set(element, values);
      element.setAttribute(attribute, translated);
    }
  }

  private restore(): void {
    for (const [node, value] of this.restoredText) {
      if (node.data === value.translated) node.data = value.original;
    }
    for (const [element, attributes] of this.restoredAttributes) {
      for (const [name, value] of attributes) {
        if (element.getAttribute(name) === value.translated) element.setAttribute(name, value.original);
      }
    }
    this.restoredText.clear();
    this.restoredAttributes.clear();
  }
}

function compileTemplate(value: string): { readonly pattern: RegExp; readonly tokenIndexes: readonly number[] } | null {
  const matches = [...value.matchAll(DYNAMIC_TOKEN)];
  if (matches.length === 0) return null;
  let cursor = 0;
  let source = "^";
  const tokenIndexes: number[] = [];
  for (const match of matches) {
    const position = match.index ?? 0;
    source += escapeRegExp(value.slice(cursor, position));
    source += "([\\s\\S]*?)";
    tokenIndexes.push(Number(match[1]));
    cursor = position + match[0].length;
  }
  source += `${escapeRegExp(value.slice(cursor))}$`;
  return { pattern: new RegExp(source, "u"), tokenIndexes };
}

function templateTokenIndexes(value: string): number[] {
  return [...value.matchAll(DYNAMIC_TOKEN)].map((match) => Number(match[1]));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function communityFieldTextNodes(field: Element): Text[] {
  const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current !== null) {
    if (
      current instanceof Text
      && current.parentElement?.closest(COMMUNITY_FIELD_BADGE_SELECTOR) === null
    ) {
      nodes.push(current);
    }
    current = walker.nextNode();
  }
  return nodes;
}
