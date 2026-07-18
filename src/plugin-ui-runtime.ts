export type PluginTranslationProvenanceKind =
  | "upstream-native"
  | "th-reviewed-fill"
  | "th-reviewed-correction"
  | "th-automatic"
  | "th-published";

export type PluginTranslationApplication = "fill" | "correction";
export type PluginTranslationScope = "runtime-ui" | "metadata" | "readme";

export interface PluginUiTranslation {
  readonly pluginId: string;
  readonly source: string;
  readonly target: string;
  readonly provenanceKind?: PluginTranslationProvenanceKind;
  readonly application?: PluginTranslationApplication;
  readonly scopes?: readonly PluginTranslationScope[];
  /** Exact upstream-native target that an explicitly reviewed correction may replace. */
  readonly nativeTarget?: string;
}

const TRANSLATABLE_ATTRIBUTES = ["aria-label", "placeholder", "title"] as const;
const EXCLUDED_SELECTOR = ".markdown-source-view, .markdown-preview-view, .cm-editor, code, pre, script, style, [contenteditable='true']";
const SEARCH_HIGHLIGHT_SELECTOR = ".suggestion-highlight";
const COMMUNITY_FIELD_SELECTOR = ".community-item-name, .community-item-desc";
const COMMUNITY_FIELD_BADGE_SELECTOR = ".flair";
const METADATA_TEXT_SELECTOR = ".vertical-tab-nav-item-title, .installed-plugins-container .setting-item-name, .installed-plugins-container .setting-item-description";
const README_CONTAINER_SELECTOR = ".community-modal-readme.markdown-rendered";
const README_BLOCK_SELECTOR = "h1, h2, h3, h4, h5, h6, p, li, blockquote, th, td";
const README_PROTECTED_SELECTOR = "a, code, kbd, samp, var";
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
    && element.closest(SEARCH_HIGHLIGHT_SELECTOR) === null
    && element.closest(README_CONTAINER_SELECTOR) === null;
}

export function translatePluginUiFieldParts(
  parts: readonly string[],
  plan: RuntimeTranslationPlan,
): readonly string[] | undefined {
  const translated = translatePluginUiValue(parts.join(""), plan);
  if (translated === undefined) return undefined;
  return parts.map((_part, index) => index === 0 ? translated : "");
}

export function translatePluginReadmeTemplate(
  sourceTemplate: string,
  protectedValueCount: number,
  plan: RuntimeTranslationPlan,
): string | undefined {
  const target = plan.exact.get(sourceTemplate);
  if (target === undefined) return undefined;
  const expectedIndexes = Array.from({ length: protectedValueCount }, (_value, index) => index);
  const sourceIndexes = templateTokenIndexes(sourceTemplate);
  const targetIndexes = templateTokenIndexes(target);
  return sourceIndexes.join("\u0000") === expectedIndexes.join("\u0000")
    && targetIndexes.join("\u0000") === expectedIndexes.join("\u0000")
    ? target
    : undefined;
}

function emptyPlan(): RuntimeTranslationPlan {
  return { exact: new Map(), templates: [], nativeTargetTemplates: [] };
}

export function filterTranslationScope(
  translations: readonly PluginUiTranslation[],
  scope: PluginTranslationScope,
): readonly PluginUiTranslation[] {
  return translations.filter((translation) =>
    translation.scopes === undefined || translation.scopes.includes(scope));
}

export class PluginUiTranslationRuntime {
  private runtimePlan: RuntimeTranslationPlan = emptyPlan();
  private metadataPlan: RuntimeTranslationPlan = emptyPlan();
  private readmePlan: RuntimeTranslationPlan = emptyPlan();
  private observer: MutationObserver | null = null;
  private readonly restoredText = new Map<Text, { original: string; translated: string }>();
  private readonly restoredAttributes = new Map<Element, Map<string, { original: string; translated: string }>>();
  private readonly restoredReadmeBlocks = new Map<Element, {
    readonly original: readonly Node[];
    readonly translated: readonly Node[];
  }>();

  update(translations: readonly PluginUiTranslation[]): void {
    this.restore();
    this.runtimePlan = buildRuntimeTranslationPlan(filterTranslationScope(translations, "runtime-ui"));
    this.metadataPlan = buildRuntimeTranslationPlan(filterTranslationScope(translations, "metadata"));
    this.readmePlan = buildRuntimeTranslationPlan(filterTranslationScope(translations, "readme"));
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
    if (root instanceof Element) {
      this.translateAttributes(root);
      this.translateReadmeBlock(root);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();
    while (current !== null) {
      if (current instanceof Text) this.translateText(current);
      else if (current instanceof Element) {
        this.translateAttributes(current);
        this.translateReadmeBlock(current);
      }
      current = walker.nextNode();
    }
  }

  private translateText(node: Text): void {
    const parent = node.parentElement;
    if (parent === null || parent.closest(EXCLUDED_SELECTOR) !== null) return;
    const readmeContainer = parent.closest(README_CONTAINER_SELECTOR);
    if (readmeContainer !== null) {
      const block = parent.closest(README_BLOCK_SELECTOR);
      if (block !== null && readmeContainer.contains(block)) this.translateReadmeBlock(block);
      return;
    }
    const field = parent.closest(COMMUNITY_FIELD_SELECTOR);
    if (field !== null) {
      this.translateCommunityField(field);
      return;
    }
    const raw = node.data;
    const plan = parent.closest(METADATA_TEXT_SELECTOR) === null
      ? this.runtimePlan
      : this.metadataPlan;
    const translated = translatePluginUiValue(raw, plan);
    if (translated === undefined) return;
    if (!this.restoredText.has(node)) this.restoredText.set(node, { original: raw, translated });
    node.data = translated;
  }

  private translateCommunityField(field: Element): void {
    if (field.closest(EXCLUDED_SELECTOR) !== null) return;
    const nodes = communityFieldTextNodes(field);
    const translatedParts = translatePluginUiFieldParts(nodes.map((node) => node.data), this.metadataPlan);
    if (translatedParts === undefined) return;
    nodes.forEach((node, index) => {
      const translated = translatedParts[index] ?? "";
      if (!this.restoredText.has(node)) {
        this.restoredText.set(node, { original: node.data, translated });
      }
      node.data = translated;
    });
  }

  private translateReadmeBlock(block: Element): void {
    if (
      this.restoredReadmeBlocks.has(block)
      || !block.matches(README_BLOCK_SELECTOR)
      || block.closest(README_CONTAINER_SELECTOR) === null
      || block.closest("pre") !== null
    ) return;
    const serialized = serializeReadmeBlock(block);
    if (serialized === undefined) return;
    const targetTemplate = translatePluginReadmeTemplate(
      serialized.sourceTemplate,
      serialized.protectedNodes.length,
      this.readmePlan,
    );
    if (targetTemplate === undefined) return;
    const translated = renderReadmeTarget(targetTemplate, serialized.protectedNodes, this.readmePlan);
    if (translated === undefined) return;
    const original = Array.from(block.childNodes);
    block.replaceChildren(...translated);
    this.restoredReadmeBlocks.set(block, { original, translated });
  }

  private translateAttributes(element: Element): void {
    if (!shouldTranslatePluginUiElement(element)) return;
    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      const raw = element.getAttribute(attribute);
      if (raw === null) continue;
      const translated = translatePluginUiValue(raw, this.runtimePlan);
      if (translated === undefined) continue;
      const values = this.restoredAttributes.get(element) ?? new Map<string, { original: string; translated: string }>();
      if (!values.has(attribute)) values.set(attribute, { original: raw, translated });
      this.restoredAttributes.set(element, values);
      element.setAttribute(attribute, translated);
    }
  }

  private restore(): void {
    for (const [block, value] of this.restoredReadmeBlocks) {
      const current = Array.from(block.childNodes);
      if (sameNodes(current, value.translated)) block.replaceChildren(...value.original);
    }
    this.restoredReadmeBlocks.clear();
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

interface SerializedReadmeBlock {
  readonly sourceTemplate: string;
  readonly protectedNodes: readonly Element[];
}

function serializeReadmeBlock(block: Element): SerializedReadmeBlock | undefined {
  const protectedNodes: Element[] = [];
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node instanceof Text) {
      parts.push(node.data);
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.matches(README_PROTECTED_SELECTOR)) {
      if ((node.textContent ?? "").trim() !== "") {
        parts.push(`{{th:expr:${protectedNodes.length}}}`);
        protectedNodes.push(node);
      }
      return;
    }
    if (node.matches("img, svg, button")) return;
    if (node.tagName === "BR") parts.push(" ");
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  for (const child of Array.from(block.childNodes)) visit(child);
  const sourceTemplate = normalizeReadmeText(parts.join(""));
  return sourceTemplate === "" ? undefined : { sourceTemplate, protectedNodes };
}

function renderReadmeTarget(
  targetTemplate: string,
  protectedNodes: readonly Element[],
  plan: RuntimeTranslationPlan,
): Node[] | undefined {
  const output: Node[] = [];
  let cursor = 0;
  for (const match of targetTemplate.matchAll(DYNAMIC_TOKEN)) {
    const position = match.index ?? 0;
    const text = targetTemplate.slice(cursor, position);
    if (text !== "") output.push(document.createTextNode(text));
    const index = Number(match[1]);
    const protectedNode = protectedNodes[index];
    if (protectedNode === undefined) return undefined;
    const clone = protectedNode.cloneNode(true) as Element;
    translateProtectedReadmeLabel(clone, plan);
    output.push(clone);
    cursor = position + match[0].length;
  }
  const trailing = targetTemplate.slice(cursor);
  if (trailing !== "") output.push(document.createTextNode(trailing));
  return output;
}

function translateProtectedReadmeLabel(element: Element, plan: RuntimeTranslationPlan): void {
  if (element.tagName !== "A" || element.querySelector("code, kbd, samp, var") !== null) return;
  const source = normalizeReadmeText(element.textContent ?? "");
  if (source === "" || /^https?:\/\//iu.test(source) || source === element.getAttribute("href")) return;
  const target = translatePluginUiValue(source, plan);
  if (target !== undefined && target !== source) element.textContent = target;
}

function normalizeReadmeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function sameNodes(left: readonly Node[], right: readonly Node[]): boolean {
  return left.length === right.length && left.every((node, index) => node === right[index]);
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
