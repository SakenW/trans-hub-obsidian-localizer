import { describe, expect, it, vi } from "vitest";

import {
  buildConflictSafeDictionary,
  buildRuntimeTranslationPlan,
  filterTranslationScope,
  PluginUiTranslationRuntime,
  shouldUsePluginMetadataPlan,
  shouldTranslatePluginUiElement,
  translatePluginReadmeTemplate,
  translatePluginUiFieldParts,
  translatePluginUiValue,
} from "../src/plugin-ui-runtime";

describe("buildConflictSafeDictionary", () => {
  it("keeps exact unambiguous translations and drops cross-plugin conflicts", () => {
    const dictionary = buildConflictSafeDictionary([
      { pluginId: "one", source: "Settings", target: "设置" },
      { pluginId: "two", source: "Settings", target: "设置" },
      { pluginId: "one", source: "Open", target: "打开" },
      { pluginId: "two", source: "Open", target: "开启" },
      { pluginId: "one", source: "Same", target: "Same" },
      { pluginId: "one", source: "Search", target: "Rechercher" },
      { pluginId: "one", source: "Rechercher", target: "Recherche" },
      { pluginId: "two", source: "Delete", target: "削除" },
      { pluginId: "two", source: "削除", target: "消去" },
    ]);

    expect(dictionary.get("Settings")).toBe("设置");
    expect(dictionary.has("Open")).toBe(false);
    expect(dictionary.has("Same")).toBe(false);
    expect(dictionary.get("Search")).toBe("Rechercher");
    expect(dictionary.has("Rechercher")).toBe(false);
    expect(dictionary.get("Delete")).toBe("削除");
    expect(dictionary.has("削除")).toBe(false);
  });
});

describe("dynamic UI template replacement", () => {
  it.each(["$&", "$$", "$`", "$'", "$1", "C:/notes/42"])("preserves literal runtime and exact target values: %s", (value) => {
    const dynamic = buildRuntimeTranslationPlan([{
      pluginId: "sample", source: "Count {{th:expr:0}}", target: "数量 {{th:expr:0}}",
    }]);
    expect(translatePluginUiValue(`  Count ${value}  `, dynamic)).toBe(`  数量 ${value}  `);
    const exact = buildRuntimeTranslationPlan([{
      pluginId: "sample", source: "Count", target: `数量 ${value}`,
    }]);
    expect(translatePluginUiValue("  Count  ", exact)).toBe(`  数量 ${value}  `);
  });

  it("preserves runtime values while translating static text", () => {
    const plan = buildRuntimeTranslationPlan([{
      pluginId: "dataview",
      source: "Currently: {{th:expr:0}} ({{th:expr:1}} rows)",
      target: "当前：{{th:expr:0}}（{{th:expr:1}} 行）",
    }]);
    expect(translatePluginUiValue("Currently: 2026-07-18 (42 rows)", plan))
      .toBe("当前：2026-07-18（42 行）");
  });

  it("permits a target-language reorder of unique runtime expression slots", () => {
    const plan = buildRuntimeTranslationPlan([{
      pluginId: "dataview",
      source: "From {{th:expr:0}} to {{th:expr:1}}",
      target: "从 {{th:expr:1}} 到 {{th:expr:0}}",
    }]);
    expect(translatePluginUiValue("From alpha to beta", plan))
      .toBe("从 beta 到 alpha");
  });

  it("only lets an explicit reviewed correction replace exact upstream-native text", () => {
    const reviewed = buildRuntimeTranslationPlan([{
      pluginId: "sample",
      source: "Settings",
      target: "设置",
      provenanceKind: "th-reviewed-correction",
      application: "correction",
      nativeTarget: "设定",
    }]);
    expect(translatePluginUiValue("Settings", reviewed)).toBe("设置");
    expect(translatePluginUiValue("设定", reviewed)).toBe("设置");

    const unreviewed = buildRuntimeTranslationPlan([{
      pluginId: "sample",
      source: "Settings",
      target: "设置",
      provenanceKind: "th-automatic",
      application: "correction",
      nativeTarget: "设定",
    }]);
    expect(translatePluginUiValue("设定", unreviewed)).toBeUndefined();
  });

  it("fails closed for placeholder loss, ambiguous patterns, and native target text", () => {
    const unsafe = buildRuntimeTranslationPlan([{
      pluginId: "one", source: "Rows: {{th:expr:0}}", target: "行数",
    }]);
    expect(translatePluginUiValue("Rows: 42", unsafe)).toBeUndefined();

    const ambiguous = buildRuntimeTranslationPlan([
      { pluginId: "one", source: "Rows: {{th:expr:0}}", target: "行：{{th:expr:0}}" },
      { pluginId: "two", source: "{{th:expr:0}}: 42", target: "值：{{th:expr:0}}" },
    ]);
    expect(translatePluginUiValue("Rows: 42", ambiguous)).toBeUndefined();

    const native = buildRuntimeTranslationPlan([{
      pluginId: "one", source: "Rows: {{th:expr:0}}", target: "行数：{{th:expr:0}}",
    }]);
    expect(translatePluginUiValue("行数：42", native)).toBeUndefined();
  });
});

describe("runtime DOM boundary", () => {
  it.each(["text", "metadata", "community", "title", "aria-label", "placeholder"])(
    "restores the latest host source after repeated %s updates without overwriting later host edits",
    (kind) => {
      const runtime = new PluginUiTranslationRuntime();
      const rows = [{ pluginId: "sample", source: "Count {{th:expr:0}}", target: "数量 {{th:expr:0}}" }];
      runtime.update(rows);
      const internal = runtime as unknown as {
        translateText(node: Text): void;
        translateAttributes(element: Element): void;
        restoreDetachedTree(node: Node): void;
      };
      const attribute = ["title", "aria-label", "placeholder"].includes(kind);
      const attributes = new Map<string, string>();
      const modal = { querySelector: () => ({ getAttribute: () => "sample" }) } as unknown as Element;
      const element = {
        closest: (selector: string): Element | null => {
          if (selector === ".modal.mod-settings") return modal;
          if (kind === "metadata" && selector.includes(".installed-plugins-container")) return element;
          if (kind === "community" && selector === ".community-item-name, .community-item-desc") return element;
          return null;
        },
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => { attributes.set(name, value); },
        ownerDocument: {
          createTreeWalker: () => {
            let visited = false;
            return { nextNode: () => { if (visited) return null; visited = true; return node; } };
          },
        },
      } as unknown as Element;
      const node = { nodeType: 3, data: "", parentElement: element } as unknown as Text;
      const set = (value: string) => { if (attribute) attributes.set(kind, value); else node.data = value; };
      const get = () => attribute ? attributes.get(kind) : node.data;
      const translate = () => attribute ? internal.translateAttributes(element) : internal.translateText(node);
      vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4 });
      try {
        for (const end of ["stop", "update", "detach"]) {
          runtime.update(rows);
          for (const count of [1, 2, 3]) {
            set(`Count ${count}`);
            translate();
            expect(get()).toBe(`数量 ${count}`);
            translate(); // MutationObserver sees our own write too.
          }
          if (end === "stop") runtime.stop();
          else if (end === "update") runtime.update([]);
          else internal.restoreDetachedTree({ contains: () => true } as unknown as Node);
          expect(get()).toBe("Count 3");
        }
        runtime.update(rows);
        set("Count 4");
        translate();
        set("Host replacement");
        runtime.stop();
        expect(get()).toBe("Host replacement");
        runtime.update(rows);
        set("Count 5");
        translate();
        set("Untranslated host value");
        translate();
        runtime.stop();
        expect(get()).toBe("Untranslated host value");
      } finally {
        runtime.stop();
        vi.unstubAllGlobals();
      }
    },
  );

  it("restores each latest community fragment including an unchanged empty translated fragment", () => {
    const runtime = new PluginUiTranslationRuntime();
    runtime.update([{ pluginId: "sample", source: "Count {{th:expr:0}}", target: "数量 {{th:expr:0}}" }]);
    const internal = runtime as unknown as { translateCommunityField(field: Element): void };
    const parentElement = { closest: () => null };
    const nodes = ["Count ", "1"].map((data) => ({ nodeType: 3, data, parentElement })) as unknown as Text[];
    const field = {
      closest: () => null,
      ownerDocument: { createTreeWalker: () => {
        let index = 0;
        return { nextNode: () => nodes[index++] ?? null };
      } },
    } as unknown as Element;
    vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4 });
    try {
      internal.translateCommunityField(field);
      expect(nodes.map((node) => node.data)).toEqual(["数量 1", ""]);
      nodes[0].data = "Count ";
      nodes[1].data = "2";
      internal.translateCommunityField(field);
      expect(nodes.map((node) => node.data)).toEqual(["数量 2", ""]);
      nodes[0].data = "Count 3";
      internal.translateCommunityField(field);
      runtime.stop();
      expect(nodes.map((node) => node.data)).toEqual(["Count 3", "2"]);
    } finally {
      runtime.stop();
      vi.unstubAllGlobals();
    }
  });

  it("detaches a closed popout root before allowing a replacement observer", () => {
    class MockMutationObserver {
      static instances: MockMutationObserver[] = [];
      disconnected = false;

      constructor(_callback: MutationCallback) { MockMutationObserver.instances.push(this); }
      observe(_target: Node, _options: MutationObserverInit): void {}
      disconnect(): void { this.disconnected = true; }
      takeRecords(): MutationRecord[] { return []; }
    }
    const root = {
      nodeType: 1,
      childNodes: [],
      closest: () => null,
      contains: () => true,
      getAttribute: () => null,
      matches: () => false,
      ownerDocument: {
        defaultView: { MutationObserver: MockMutationObserver },
        createTreeWalker: () => ({ nextNode: () => null }),
      },
    } as unknown as HTMLElement;
    const runtime = new PluginUiTranslationRuntime();
    vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4, SHOW_ELEMENT: 1 });
    try {
      runtime.start(root);
      runtime.stopRoot(root);
      runtime.start(root);

      expect(MockMutationObserver.instances).toHaveLength(2);
      expect(MockMutationObserver.instances[0]?.disconnected).toBe(true);
    } finally {
      runtime.stop();
      vi.unstubAllGlobals();
    }
  });

  it("does not translate search-highlight fragments as complete plugin strings", () => {
    const highlighted = {
      closest: (selector: string): Element | null => selector === ".suggestion-highlight" ? {} as Element : null,
    };
    const ordinary = { closest: (): Element | null => null };

    expect(shouldTranslatePluginUiElement(highlighted)).toBe(false);
    expect(shouldTranslatePluginUiElement(ordinary)).toBe(true);
  });

  it("keeps settings-modal bodies out of the global metadata plan", () => {
    const currentObsidianSetting = { closest: (): Element | null => null };
    const flattenedInstalledPluginRow = {
      closest: (selector: string): Element | null => selector.includes(".installed-plugins-container")
        ? {} as Element
        : null,
    };
    const regularRuntimeSurface = { closest: (): Element | null => null };

    expect(shouldUsePluginMetadataPlan(currentObsidianSetting)).toBe(false);
    expect(shouldUsePluginMetadataPlan(flattenedInstalledPluginRow)).toBe(true);
    expect(shouldUsePluginMetadataPlan(regularRuntimeSurface)).toBe(false);
  });

  it("uses the active plugin tab to select a settings runtime plan and leaves an unowned modal untouched", () => {
    const runtime = new PluginUiTranslationRuntime();
    runtime.update([
      { pluginId: "omnisearch", source: "Omnisearch", target: "全能搜索", scopes: ["metadata"] },
      { pluginId: "omnisearch", source: "Indexing", target: "索引", scopes: ["runtime-ui"] },
      { pluginId: "copilot", source: "Copilot", target: "副驾驶", scopes: ["metadata"] },
      { pluginId: "copilot", source: "Indexing", target: "建立索引", scopes: ["runtime-ui"] },
    ]);
    const activeItem = {
      getAttribute: () => null,
      textContent: "全能搜索",
    } as unknown as HTMLElement;
    const modal = {
      querySelector: () => activeItem,
    } as unknown as Element;
    const settingsBody = {
      closest: (selector: string): Element | null => selector === ".modal.mod-settings" ? modal : null,
    } as unknown as Element;
    const unownedModal = {
      querySelector: () => null,
    } as unknown as Element;
    const unownedBody = {
      closest: (selector: string): Element | null => selector === ".modal.mod-settings" ? unownedModal : null,
    } as unknown as Element;
    const unsafeRuntime = runtime as unknown as {
      runtimePlanForElement(element: Element): ReturnType<typeof buildRuntimeTranslationPlan> | undefined;
    };

    expect(translatePluginUiValue("Indexing", unsafeRuntime.runtimePlanForElement(settingsBody)!)).toBe("索引");
    expect(unsafeRuntime.runtimePlanForElement(unownedBody)).toBeUndefined();
  });

  it("does not use an unscoped global plan for a normal workspace node", () => {
    const runtime = new PluginUiTranslationRuntime();
    runtime.update([{
      pluginId: "plugin-a", source: "Rebuild index", target: "重建索引", scopes: ["runtime-ui"],
    }]);
    const workspaceNode = {
      closest: (): Element | null => null,
    } as unknown as Element;
    const unsafeRuntime = runtime as unknown as {
      runtimePlanForElement(element: Element): ReturnType<typeof buildRuntimeTranslationPlan> | undefined;
    };

    expect(unsafeRuntime.runtimePlanForElement(workspaceNode)).toBeUndefined();
  });

  it("restores and releases translated nodes removed from an observed tree", () => {
    const runtime = new PluginUiTranslationRuntime();
    const detachedText = { data: "设置" } as Text;
    const unsafeRuntime = runtime as unknown as {
      restoredText: Map<Text, { original: string; translated: string }>;
      restoreDetachedTree(root: Node): void;
    };
    unsafeRuntime.restoredText.set(detachedText, { original: "Settings", translated: "设置" });
    const detachedRoot = {
      contains: (node: Node) => node === detachedText,
    } as unknown as Node;

    unsafeRuntime.restoreDetachedTree(detachedRoot);

    expect(detachedText.data).toBe("Settings");
    expect(unsafeRuntime.restoredText).toHaveLength(0);
  });

  it("recognizes an active plugin tab that appends settings and version text", () => {
    const runtime = new PluginUiTranslationRuntime();
    runtime.update([
      { pluginId: "copilot", source: "Copilot", target: "副驾驶", scopes: ["metadata"] },
      { pluginId: "copilot", source: "Copilot Settings", target: "副驾驶设置", scopes: ["runtime-ui"] },
    ]);
    const activeItem = {
      getAttribute: () => null,
      textContent: "Copilot Settings v3.3.3",
    } as unknown as HTMLElement;
    const modal = { querySelector: () => activeItem } as unknown as Element;
    const settingsBody = {
      closest: (selector: string): Element | null => selector === ".modal.mod-settings" ? modal : null,
    } as unknown as Element;
    const unsafeRuntime = runtime as unknown as {
      runtimePlanForElement(element: Element): ReturnType<typeof buildRuntimeTranslationPlan> | undefined;
    };

    expect(translatePluginUiValue(
      "Copilot Settings",
      unsafeRuntime.runtimePlanForElement(settingsBody)!,
    )).toBe("副驾驶设置");
  });

  it("translates a complete fragmented field and never a keyword fragment", () => {
    const plan = buildRuntimeTranslationPlan([
      { pluginId: "dataview", source: "Dataview", target: "数据视图" },
      {
        pluginId: "metadata-menu",
        source: "For Dataview users on GitHub and Obsidian.",
        target: "面向 GitHub 和 Obsidian 上的 Dataview 用户。",
      },
    ]);

    expect(translatePluginUiFieldParts(["Dataview"], plan)).toEqual(["数据视图"]);
    expect(translatePluginUiFieldParts(["For ", "Dataview", " users"], plan)).toBeUndefined();
    expect(translatePluginUiFieldParts(
      ["For ", "Dataview", " users on ", "GitHub", " and ", "Obsidian", "."],
      plan,
    )).toEqual(["面向 GitHub 和 Obsidian 上的 Dataview 用户。", "", "", "", "", "", ""]);
  });
});

describe("community README runtime", () => {
  it("keeps README-only strings out of generic runtime and metadata scopes", () => {
    const rows = [
      { pluginId: "dataview", source: "reference", target: "参考", scopes: ["readme"] as const },
      { pluginId: "dataview", source: "Settings", target: "设置", scopes: ["runtime-ui", "readme"] as const },
    ];
    expect(filterTranslationScope(rows, "runtime-ui").map((row) => row.source)).toEqual(["Settings"]);
    expect(filterTranslationScope(rows, "metadata")).toEqual([]);
    expect(filterTranslationScope(rows, "readme").map((row) => row.source)).toEqual(["reference", "Settings"]);
  });

  it("uses complete published block translations and preserves protected link slots", () => {
    const source = "Treat your {{th:expr:0}} as a database. See {{th:expr:1}}.";
    const plan = buildRuntimeTranslationPlan([{
      pluginId: "dataview",
      source,
      target: "将 {{th:expr:0}} 作为数据库使用。请参阅 {{th:expr:1}}。",
    }]);

    expect(translatePluginReadmeTemplate(source, 2, plan))
      .toBe("将 {{th:expr:0}} 作为数据库使用。请参阅 {{th:expr:1}}。");
    expect(translatePluginReadmeTemplate(source, 1, plan)).toBeUndefined();
  });

  it("fails closed when a README translation loses a protected slot", () => {
    const source = "Use {{th:expr:0}}.";
    const plan = buildRuntimeTranslationPlan([{
      pluginId: "dataview",
      source,
      target: "使用文档。",
    }]);
    expect(translatePluginReadmeTemplate(source, 1, plan)).toBeUndefined();
  });
});
