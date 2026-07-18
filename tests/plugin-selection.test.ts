import { describe, expect, it } from "vitest";

import {
  filterSelectablePlugins,
  selectedPluginCount,
  setAllPluginsSelected,
  setPluginSelected,
} from "../src/plugin-selection";

describe("plugin selection", () => {
  it("默认选择全部，并用排除列表表达多选结果", () => {
    expect(selectedPluginCount(["dataview", "calendar", "tasks"], [])).toBe(3);
    expect(setPluginSelected([], "calendar", false)).toEqual(["calendar"]);
    expect(setPluginSelected(["calendar"], "calendar", true)).toEqual([]);
  });

  it("全选和清空只影响当前可选插件，保留其他排除项", () => {
    expect(setAllPluginsSelected(["legacy", "tasks"], ["dataview", "tasks"], true)).toEqual(["legacy"]);
    expect(setAllPluginsSelected(["legacy"], ["dataview", "tasks"], false)).toEqual([
      "dataview",
      "legacy",
      "tasks",
    ]);
  });

  it("可以按插件名称或 ID 搜索后逐项多选", () => {
    const plugins = [
      { id: "blacksmithgu.obsidian-dataview", name: "Dataview" },
      { id: "obsidian-tasks-plugin", name: "Tasks" },
    ];
    expect(filterSelectablePlugins(plugins, "data")).toEqual([plugins[0]]);
    expect(filterSelectablePlugins(plugins, "tasks-plugin")).toEqual([plugins[1]]);
    expect(filterSelectablePlugins(plugins, "  ")).toEqual(plugins);
  });
});
