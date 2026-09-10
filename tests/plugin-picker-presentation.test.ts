import { describe, expect, it } from "vitest";
import { presentPluginLocalization } from "../src/plugin-picker-presentation";
import { filterSelectablePlugins } from "../src/plugin-selection";
const input = { source: { kind: "published" as const }, selected: true, enabled: true, localization: { kind: "localized" as const, label: "cached" } };
describe("plugin picker presentation", () => {
  it("shows published delivery progress instead of first-time translation preparation", () => {
    expect(presentPluginLocalization({ ...input,
      localization: { kind: "waiting", label: "译文已发布，等待客户端下载" },
    }).label).toBe("译文已发布，等待客户端下载");
  });
  it("关闭与暂停优先于缓存可用事实", () => {
    expect(presentPluginLocalization({ ...input, selected: false }).kind).toBe("off");
    expect(presentPluginLocalization({ ...input, enabled: false }).kind).toBe("paused");
    expect(presentPluginLocalization(input).kind).toBe("localized");
  });
  it("未知来源不伪装成不支持，阻断单独显示服务端受限", () => {
    expect(presentPluginLocalization({ ...input, source: { kind: "pending" } }).kind).toBe("source-pending");
    expect(presentPluginLocalization({ ...input, localization: { kind: "blocked", label: "reason" } }).kind).toBe("restricted");
  });
  it("按用户看到的译名、官方名和ID都能找到插件", () => {
    const plugins = [{ id: "dataview", name: "Dataview", displayName: "数据视图" }];
    for (const query of ["数据视图", "DATAVIEW", "data"]) expect(filterSelectablePlugins(plugins, query)).toEqual(plugins);
    expect(filterSelectablePlugins([{ ...plugins[0], displayName: "データビュー" }], "データビュー")).toHaveLength(1);
  });
});

  it("将权威制品不匹配列为需要处理，不伪装成准备翻译", () => {
    expect(presentPluginLocalization({ ...input,
      localization: { kind: "catalog-mismatch", label: "本地安装与权威目录的精确制品不一致，已暂停同步" },
    }).kind).toBe("attention");
  });
