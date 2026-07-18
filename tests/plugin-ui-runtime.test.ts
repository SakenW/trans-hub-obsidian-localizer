import { describe, expect, it } from "vitest";

import {
  buildConflictSafeDictionary,
  buildRuntimeTranslationPlan,
  filterTranslationScope,
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
  it("preserves runtime values while translating static text", () => {
    const plan = buildRuntimeTranslationPlan([{
      pluginId: "dataview",
      source: "Currently: {{th:expr:0}} ({{th:expr:1}} rows)",
      target: "当前：{{th:expr:0}}（{{th:expr:1}} 行）",
    }]);
    expect(translatePluginUiValue("Currently: 2026-07-18 (42 rows)", plan))
      .toBe("当前：2026-07-18（42 行）");
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
  it("does not translate search-highlight fragments as complete plugin strings", () => {
    const highlighted = {
      closest: (selector: string): Element | null => selector === ".suggestion-highlight" ? {} as Element : null,
    };
    const ordinary = { closest: (): Element | null => null };

    expect(shouldTranslatePluginUiElement(highlighted)).toBe(false);
    expect(shouldTranslatePluginUiElement(ordinary)).toBe(true);
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
