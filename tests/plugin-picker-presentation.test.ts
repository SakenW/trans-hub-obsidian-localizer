import { describe, expect, it } from "vitest";
import { presentPluginLocalization } from "../src/plugin-picker-presentation";
import { filterSelectablePlugins } from "../src/plugin-selection";
const input = { source: { kind: "published" as const }, selected: true, enabled: true, localization: { kind: "localized" as const, label: "cached" } };
describe("plugin picker presentation", () => {
  it("关闭与暂停优先于缓存可用事实", () => {
    expect(presentPluginLocalization({ ...input, selected: false }).kind).toBe("off");
    expect(presentPluginLocalization({ ...input, enabled: false }).kind).toBe("paused");
    expect(presentPluginLocalization(input).kind).toBe("localized");
  });
  it("未知来源不伪装成不支持，阻断必须显示需处理", () => {
    expect(presentPluginLocalization({ ...input, source: { kind: "pending" } }).kind).toBe("source-pending");
    expect(presentPluginLocalization({ ...input, localization: { kind: "blocked", label: "reason" } }).kind).toBe("attention");
  });
  it("按用户看到的译名、官方名和ID都能找到插件", () => {
    const plugins = [{ id: "dataview", name: "Dataview", displayName: "数据视图" }];
    for (const query of ["数据视图", "DATAVIEW", "data"]) expect(filterSelectablePlugins(plugins, query)).toEqual(plugins);
    expect(filterSelectablePlugins([{ ...plugins[0], displayName: "データビュー" }], "データビュー")).toHaveLength(1);
  });
});
