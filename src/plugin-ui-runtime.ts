import { MenuItem } from "obsidian";

export type PluginTranslationProvenanceKind =
  | "upstream-native"
  | "th-reviewed-fill"
  | "th-reviewed-correction"
  | "th-automatic"
  | "th-published";

export type PluginTranslationApplication = "fill" | "correction";
export type PluginTranslationScope = "runtime-ui" | "metadata" | "readme";

export interface PluginSourceCompatibility {
  readonly semanticRole: string;
  readonly contentScopes: readonly string[];
  readonly placeholderSignature: string;
  readonly formatSignature: string;
  /** Server digest over exact raw UTF-8 source bytes; retained as evidence. */
  readonly sourceContentDigest: string;
}

export interface PluginUiTranslation {
  readonly pluginId: string;
  readonly source: string;
  readonly target: string;
  readonly provenanceKind?: PluginTranslationProvenanceKind;
  readonly application?: PluginTranslationApplication;
  readonly scopes?: readonly PluginTranslationScope[];
  /** Required for runtime reuse when the server authority version differs. */
  readonly sourceCompatibility?: PluginSourceCompatibility;
  /** Exact upstream-native target that an explicitly reviewed correction may replace. */
  readonly nativeTarget?: string;
}

const TRANSLATABLE_ATTRIBUTES = ["aria-label", "placeholder", "title"] as const;
const EXCLUDED_SELECTOR = ".markdown-source-view, .markdown-preview-view, .cm-editor, code, pre, script, style, [contenteditable='true']";
const SEARCH_HIGHLIGHT_SELECTOR = ".suggestion-highlight";
const COMMUNITY_FIELD_SELECTOR = ".community-item-name, .community-item-desc";
const COMMUNITY_FIELD_BADGE_SELECTOR = ".flair";
// Obsidian 1.13 can flatten an installed-plugin row into a generic setting
// item, so its old name/description descendants are not a durable boundary.
// A settings modal also contains runtime text from whichever plugin tab is
// active; it is resolved separately through a verified active-tab owner.
const METADATA_TEXT_SELECTOR = [
  ".vertical-tab-nav-item-title",
  ".installed-plugins-container",
].join(", ");
const SETTINGS_MODAL_SELECTOR = ".modal.mod-settings";
const SETTINGS_NAV_ITEM_SELECTOR = ".vertical-tab-nav-item.is-active, .vertical-tab-nav-item[aria-selected='true'], [role='tab'][aria-selected='true']";
const SETTINGS_PLUGIN_ID_ATTRIBUTES = ["data-plugin-id", "data-id", "data-setting-id"] as const;
const QUICKADD_CHOICE_MENU_TRIGGER_SELECTOR = "button.qaNewChoiceBtn[aria-haspopup='menu']";
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
    if (!sameRuntimeExpressionMultiset(targetTokenIndexes, sourceTemplate.tokenIndexes)) continue;
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
  if (exactTarget !== undefined) return raw.replace(source, () => exactTarget);
  if (plan.nativeTargetTemplates.some((pattern) => pattern.test(source))) return undefined;
  const candidates = new Set<string>();
  for (const rule of plan.templates) {
    const match = rule.source.exec(source);
    if (match === null) continue;
    const values = new Map(rule.tokenIndexes.map((index, position) => [index, match[position + 1] ?? ""]));
    candidates.add(rule.target.replace(DYNAMIC_TOKEN, (_token, index: string) => values.get(Number(index)) ?? ""));
  }
  if (candidates.size !== 1) return undefined;
  return raw.replace(source, () => [...candidates][0] ?? source);
}

export function shouldTranslatePluginUiElement(element: Pick<Element, "closest">): boolean {
  return element.closest(EXCLUDED_SELECTOR) === null
    && element.closest(SEARCH_HIGHLIGHT_SELECTOR) === null
    && element.closest(README_CONTAINER_SELECTOR) === null;
}

export function shouldUsePluginMetadataPlan(element: Pick<Element, "closest">): boolean {
  return element.closest(METADATA_TEXT_SELECTOR) !== null;
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

function isTextNode(node: Node): node is Text {
  return node.nodeType === 3;
}

function isElementNode(node: Node): node is Element {
  return node.nodeType === 1;
}

function isDocumentFragmentNode(node: Node): node is DocumentFragment {
  return node.nodeType === 11;
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
  private readonly runtimePlansByPluginId = new Map<string, RuntimeTranslationPlan>();
  private readonly metadataPlansByPluginId = new Map<string, RuntimeTranslationPlan>();
  private readonly settingsOwnerByLabel = new Map<string, string>();
  private readonly observers = new Map<HTMLElement, MutationObserver>();
  private readonly menuListeners = new Map<HTMLElement, EventListener>();
  private readonly menuIntentByDocument = new WeakMap<Document, object>();
  private readonly menuOwnerByElement = new WeakMap<Element, string>();
  private activeNativeMenuIntent: { readonly document: Document; readonly token: object } | null = null;
  private nativeMenuTitleHook: { readonly original: typeof MenuItem.prototype.setTitle; readonly wrapper: typeof MenuItem.prototype.setTitle } | null = null;
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
    this.runtimePlansByPluginId.clear();
    this.metadataPlansByPluginId.clear();
    this.settingsOwnerByLabel.clear();
    const translationsByPluginId = new Map<string, PluginUiTranslation[]>();
    for (const translation of translations) {
      const pluginTranslations = translationsByPluginId.get(translation.pluginId) ?? [];
      pluginTranslations.push(translation);
      translationsByPluginId.set(translation.pluginId, pluginTranslations);
    }
    const settingsOwnerCandidates = new Map<string, Set<string>>();
    for (const [pluginId, pluginTranslations] of translationsByPluginId) {
      this.runtimePlansByPluginId.set(
        pluginId,
        buildRuntimeTranslationPlan(filterTranslationScope(pluginTranslations, "runtime-ui")),
      );
      this.metadataPlansByPluginId.set(
        pluginId,
        buildRuntimeTranslationPlan(filterTranslationScope(pluginTranslations, "metadata")),
      );
      for (const translation of pluginTranslations) {
        if (!translation.scopes?.includes("metadata")) continue;
        for (const label of [translation.source, translation.target]) {
          const normalized = normalizeSettingsOwnerLabel(label);
          if (normalized === "") continue;
          const candidates = settingsOwnerCandidates.get(normalized) ?? new Set<string>();
          candidates.add(pluginId);
          settingsOwnerCandidates.set(normalized, candidates);
        }
      }
    }
    for (const [label, candidates] of settingsOwnerCandidates) {
      if (candidates.size === 1) this.settingsOwnerByLabel.set(label, [...candidates][0] ?? "");
    }
    for (const root of this.observers.keys()) this.translateTree(root);
  }

  start(root: HTMLElement = document.body): void {
    if (this.observers.has(root)) return;
    this.installNativeMenuTitleHook();
    this.translateTree(root);
    const menuListener: EventListener = (event) => this.rememberMenuTrigger(event, root.ownerDocument);
    root.addEventListener?.("click", menuListener, true);
    this.menuListeners.set(root, menuListener);
    const Observer = root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
    const observer = new Observer((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && isTextNode(mutation.target)) {
          this.translateText(mutation.target);
        }
        if (mutation.type === "childList" && isElementNode(mutation.target)) {
          const field = mutation.target.closest(COMMUNITY_FIELD_SELECTOR);
          if (field !== null) this.translateCommunityField(field);
        }
        if (mutation.type === "attributes" && isElementNode(mutation.target)) {
          this.translateAttributes(mutation.target);
        }
        for (const node of Array.from(mutation.removedNodes)) {
          this.forgetMenuOwner(node);
          this.restoreDetachedTree(node);
        }
        for (const node of Array.from(mutation.addedNodes)) {
          this.claimTriggeredMenu(node);
          this.translateTree(node);
        }
      }
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    });
    this.observers.set(root, observer);
  }

  stop(): void {
    this.activeNativeMenuIntent = null;
    if (this.nativeMenuTitleHook !== null) {
      if (MenuItem.prototype.setTitle === this.nativeMenuTitleHook.wrapper) {
        MenuItem.prototype.setTitle = this.nativeMenuTitleHook.original;
      }
      this.nativeMenuTitleHook = null;
    }
    for (const [root, listener] of this.menuListeners) root.removeEventListener?.("click", listener, true);
    this.menuListeners.clear();
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    this.restore();
  }

  stopRoot(root: HTMLElement): void {
    const listener = this.menuListeners.get(root);
    if (listener !== undefined) root.removeEventListener?.("click", listener, true);
    this.menuListeners.delete(root);
    this.observers.get(root)?.disconnect();
    this.observers.delete(root);
    this.restoreWhere((node) => root.contains(node));
  }

  private translateTree(root: Node): void {
    if (isTextNode(root)) { this.translateText(root); return; }
    if (!isElementNode(root) && !isDocumentFragmentNode(root)) return;
    if (isElementNode(root)) {
      this.translateAttributes(root);
      this.translateReadmeBlock(root);
    }
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();
    while (current !== null) {
      if (isTextNode(current)) this.translateText(current);
      else if (isElementNode(current)) {
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
    if (this.restoredText.get(node)?.translated === raw) return;
    // The host replaced our output: its latest value is now the restore source.
    this.restoredText.delete(node);
    const plan = this.metadataPlanForElement(parent) ?? this.runtimePlanForElement(parent);
    if (plan === undefined) return;
    const translated = translatePluginUiValue(raw, plan);
    if (translated === undefined) return;
    this.restoredText.set(node, { original: raw, translated });
    node.data = translated;
  }

  private translateCommunityField(field: Element): void {
    if (field.closest(EXCLUDED_SELECTOR) !== null) return;
    const nodes = communityFieldTextNodes(field);
    for (const node of nodes) {
      if (this.restoredText.get(node)?.translated !== node.data) this.restoredText.delete(node);
    }
    if (nodes.every((node) => this.restoredText.get(node)?.translated === node.data)) return;
    const translatedParts = translatePluginUiFieldParts(nodes.map((node) => node.data), this.metadataPlan);
    if (translatedParts === undefined) return;
    nodes.forEach((node, index) => {
      const translated = translatedParts[index] ?? "";
      const original = this.restoredText.get(node)?.original ?? node.data;
      this.restoredText.set(node, { original, translated });
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
    const plan = this.metadataPlanForElement(element) ?? this.runtimePlanForElement(element);
    if (plan === undefined) return;
    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      const raw = element.getAttribute(attribute);
      const values = this.restoredAttributes.get(element) ?? new Map<string, { original: string; translated: string }>();
      if (values.get(attribute)?.translated === raw) continue;
      values.delete(attribute);
      if (raw === null) continue;
      const translated = translatePluginUiValue(raw, plan);
      if (translated === undefined) continue;
      values.set(attribute, { original: raw, translated });
      this.restoredAttributes.set(element, values);
      element.setAttribute(attribute, translated);
    }
  }

  private runtimePlanForElement(element: Element): RuntimeTranslationPlan | undefined {
    const settingsModal = element.closest(SETTINGS_MODAL_SELECTOR);
    if (settingsModal === null) {
      const menu = element.closest(".menu");
      if (menu !== null && this.menuOwnerByElement.get(menu) === "quickadd") {
        return this.runtimePlansByPluginId.get("quickadd");
      }
      // Notebook Navigator's resize separator is plugin-owned chrome inside
      // its exact view root. Do not scope the whole view: it renders vault file
      // names and other user text alongside controls.
      if (element.closest(".nn-shortcuts-resize-handle[role='separator']") === element
        && element.closest(".view-content.notebook-navigator") !== null) {
        return this.runtimePlansByPluginId.get("notebook-navigator");
      }
      // QuickAdd's choice builder opens a separate Obsidian modal outside the
      // settings tab. Its own two-class container is an explicit owner marker;
      // an unmarked modal still has no runtime translation plan.
      const modal = element.closest(".modal");
      return modal?.parentElement?.matches(".modal-container.quickAddModal.qa-choice-builder")
        ? this.runtimePlansByPluginId.get("quickadd") : undefined;
    }
    // A matching source string alone never proves which plugin rendered a
    // normal workspace node. The active settings tab supplies the owner here;
    // other unmarked runtime surfaces still fail closed.
    if (element.closest(".vertical-tab-nav-item") !== null) return this.metadataPlan;
    const owner = this.settingsPluginOwner(settingsModal);
    return owner === undefined ? undefined : this.runtimePlansByPluginId.get(owner);
  }

  private rememberMenuTrigger(event: Event, document: Document): void {
    const target = event.target;
    if (target === null || !isElementNode(target as Node)) return;
    const trigger = target as Element;
    if (trigger.closest(QUICKADD_CHOICE_MENU_TRIGGER_SELECTOR) === null) return;
    const modal = trigger.closest(SETTINGS_MODAL_SELECTOR);
    if (modal === null || this.settingsPluginOwner(modal) !== "quickadd") return;
    const intent = {};
    this.menuIntentByDocument.set(document, intent);
    this.activeNativeMenuIntent = { document, token: intent };
    // The menu is normally mounted in the same click task. A later unrelated
    // popup must not inherit this plugin's translation plan.
    const ownerWindow = document.defaultView;
    if (ownerWindow === null) {
      this.menuIntentByDocument.delete(document);
      if (this.activeNativeMenuIntent?.token === intent) this.activeNativeMenuIntent = null;
      return;
    }
    ownerWindow.setTimeout(() => {
      if (this.menuIntentByDocument.get(document) === intent) this.menuIntentByDocument.delete(document);
      if (this.activeNativeMenuIntent?.token === intent) this.activeNativeMenuIntent = null;
    }, 0);
  }

  private installNativeMenuTitleHook(): void {
    if (this.nativeMenuTitleHook !== null) return;
    const prototype = MenuItem.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "setTitle");
    if (descriptor?.writable !== true) return;
    const original = Reflect.get(prototype, "setTitle");
    const translateTitle = (title: string | DocumentFragment): string | DocumentFragment => {
      const intent = this.activeNativeMenuIntent;
      const plan = intent !== null && this.menuIntentByDocument.get(intent.document) === intent.token
        ? this.runtimePlansByPluginId.get("quickadd") : undefined;
      return typeof title === "string" && plan !== undefined
        ? translatePluginUiValue(title, plan) ?? title : title;
    };
    const wrapper: typeof MenuItem.prototype.setTitle = function (this: MenuItem, title) {
      return original.call(this, translateTitle(title));
    };
    try { prototype.setTitle = wrapper; }
    catch { return; }
    this.nativeMenuTitleHook = { original, wrapper };
  }

  private claimTriggeredMenu(node: Node): void {
    if (!isElementNode(node)) return;
    if (this.menuIntentByDocument.get(node.ownerDocument) === undefined) return;
    const menus = node.matches(".menu") ? [node] : Array.from(node.querySelectorAll(".menu"));
    for (const menu of menus) this.menuOwnerByElement.set(menu, "quickadd");
    if (menus.length > 0) this.menuIntentByDocument.delete(node.ownerDocument);
  }

  private forgetMenuOwner(node: Node): void {
    if (!isElementNode(node)) return;
    const menus = node.matches(".menu") ? [node] : Array.from(node.querySelectorAll(".menu"));
    for (const menu of menus) this.menuOwnerByElement.delete(menu);
  }

  private metadataPlanForElement(element: Element): RuntimeTranslationPlan | undefined {
    if (shouldUsePluginMetadataPlan(element)) return this.metadataPlan;
    // Obsidian 1.13.7 places installed plugins directly in setting-item rows,
    // outside the older installed-plugins-container. The exact row identity and
    // active community-plugins tab jointly scope metadata to its owning plugin.
    const row = element.closest<HTMLElement>(".setting-item.mod-toggle[data-plugin-id]");
    const modal = row?.closest(SETTINGS_MODAL_SELECTOR);
    const active = modal?.querySelector(SETTINGS_NAV_ITEM_SELECTOR);
    if (active?.getAttribute("data-setting-id") !== "community-plugins") return undefined;
    const pluginId = row?.getAttribute("data-plugin-id");
    return pluginId === null || pluginId === undefined
      ? undefined : this.metadataPlansByPluginId.get(pluginId);
  }

  private settingsPluginOwner(settingsModal: Element): string | undefined {
    const activeItem = settingsModal.querySelector<HTMLElement>(SETTINGS_NAV_ITEM_SELECTOR);
    if (activeItem === null) return undefined;
    for (const attribute of SETTINGS_PLUGIN_ID_ATTRIBUTES) {
      const candidate = activeItem.getAttribute(attribute);
      if (candidate !== null && this.runtimePlansByPluginId.has(candidate)) return candidate;
    }
    return this.settingsOwnerForLabel(normalizeSettingsOwnerLabel(activeItem.textContent ?? ""));
  }

  private settingsOwnerForLabel(label: string): string | undefined {
    const exact = this.settingsOwnerByLabel.get(label);
    if (exact !== undefined) return exact;
    // Obsidian 1.13 may show an active plugin tab as "Plugin Settings vX".
    // A unique plugin-name prefix is still an owner proof; a generic global
    // runtime plan is not, because it could translate unrelated settings.
    const candidates = new Set(
      [...this.settingsOwnerByLabel.entries()]
        .filter(([knownLabel]) => label.startsWith(`${knownLabel} `))
        .map(([, pluginId]) => pluginId),
    );
    return candidates.size === 1 ? [...candidates][0] : undefined;
  }

  private restore(): void {
    this.restoreWhere(() => true);
  }

  private restoreDetachedTree(root: Node): void {
    this.restoreWhere((node) => containsNode(root, node));
  }

  private restoreWhere(contains: (node: Node) => boolean): void {
    for (const [block, value] of this.restoredReadmeBlocks) {
      if (!contains(block)) continue;
      const current = Array.from(block.childNodes);
      if (sameNodes(current, value.translated)) block.replaceChildren(...value.original);
      this.restoredReadmeBlocks.delete(block);
    }
    for (const [node, value] of this.restoredText) {
      if (!contains(node)) continue;
      if (node.data === value.translated) node.data = value.original;
      this.restoredText.delete(node);
    }
    for (const [element, attributes] of this.restoredAttributes) {
      if (!contains(element)) continue;
      for (const [name, value] of attributes) {
        if (element.getAttribute(name) === value.translated) element.setAttribute(name, value.original);
      }
      this.restoredAttributes.delete(element);
    }
  }
}

function containsNode(root: Node, candidate: Node): boolean {
  if (root === candidate) return true;
  return "contains" in root && root.contains(candidate);
}

interface SerializedReadmeBlock {
  readonly sourceTemplate: string;
  readonly protectedNodes: readonly Element[];
}

function serializeReadmeBlock(block: Element): SerializedReadmeBlock | undefined {
  const protectedNodes: Element[] = [];
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (isTextNode(node)) {
      parts.push(node.data);
      return;
    }
    if (!isElementNode(node)) return;
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
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function normalizeSettingsOwnerLabel(value: string): string {
  if (typeof value !== "string") return "";
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

function sameRuntimeExpressionMultiset(
  left: readonly number[],
  right: readonly number[],
): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function communityFieldTextNodes(field: Element): Text[] {
  const walker = field.ownerDocument.createTreeWalker(field, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current !== null) {
    if (
      isTextNode(current)
      && current.parentElement?.closest(COMMUNITY_FIELD_BADGE_SELECTOR) === null
    ) {
      nodes.push(current);
    }
    current = walker.nextNode();
  }
  return nodes;
}
