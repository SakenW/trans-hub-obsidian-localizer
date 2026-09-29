import { describe, expect, it } from "vitest";
import { describeMissingTranslations } from "../src/plugin-missing-translations";
import type { PluginUiCatalog } from "../src/plugin-string-scanner";
import type { PluginTranslationState } from "../src/plugin-state";

const catalog: PluginUiCatalog = {
  pluginId: "sample", pluginName: "Sample", pluginVersion: "1.0", sourceLocale: "en",
  digest: "catalog", artifactDigest: "artifact", scannedAt: "2026-09-08T00:00:00Z",
  strings: ["Ready", "Save %s", "Missing text", "示例文字"].map((source, index) => ({
    key: index.toString().padStart(32, "0"), source, origins: ["ui-call"], placeholderSignature: source.includes("%s") ? "%s" : "",
  })),
};
const translation: PluginTranslationState = {
  pluginId: "sample", pluginVersion: "1.0", sourceVersionId: "source", targetLocale: "zh-CN",
  pulledAt: "2026-09-08T00:00:00Z", entries: [
    { pluginId: "sample", source: "Ready", target: "就绪" },
    { pluginId: "sample", source: "Save %s", target: "保存" },
  ],
};
describe("unmatched interface text", () => {
  it("distinguishes placeholder failures, already Chinese copy and unknown missing translations", () => {
    expect(describeMissingTranslations(catalog, translation)).toEqual([
      { source: "Save %s", reason: "占位符不一致，保留原文" },
      { source: "Missing text", reason: "当前译文包无此文案；来源与发布状态待核验" },
      { source: "示例文字", reason: "原文含中文，保留原文" },
    ]);
  });
  it("does not infer a server backlog from an absent cross-version pack entry", () => {
    expect(describeMissingTranslations(catalog, { ...translation, authorityPluginVersion: "2.0" })
      .find((entry) => entry.source === "Missing text")?.reason).toBe("跨版本匹配未找到可用译文，保留本机原文");
  });
  it("uses the runtime matcher to explain rejected cross-version entries", () => {
    const compatible = {
      semanticRole: "runtime-ui", contentScopes: ["runtime-ui"],
      placeholderSignature: "", formatSignature: "plain-text-v1", sourceContentDigest: "source",
    };
    const crossVersion = { ...translation, authorityPluginVersion: "2.0" };
    const reasonFor = (entry: PluginTranslationState["entries"][number], localCatalog = catalog) =>
      describeMissingTranslations(localCatalog, { ...crossVersion, entries: [entry] })
        .find((item) => item.source === "Ready")?.reason;
    expect(reasonFor({ pluginId: "sample", source: "Ready", target: "就绪" }))
      .toBe("跨版本译文缺少兼容证明，保留原文");
    expect(reasonFor({ pluginId: "sample", source: "Ready", target: "就绪", sourceCompatibility: { ...compatible, semanticRole: "description" } }))
      .toBe("界面语义不一致，保留原文");
    expect(reasonFor({ pluginId: "sample", source: "Ready", target: "就绪", sourceCompatibility: { ...compatible, contentScopes: ["metadata"] } }))
      .toBe("内容范围不一致，保留原文");
    expect(reasonFor({ pluginId: "sample", source: "Ready", target: "就绪", sourceCompatibility: { ...compatible, formatSignature: "html" } }))
      .toBe("文本格式不一致，保留原文");
    expect(reasonFor({ pluginId: "sample", source: "Ready", target: "就绪", sourceCompatibility: compatible }, {
      ...catalog, strings: [...catalog.strings, { ...catalog.strings[0], key: "duplicate" }],
    })).toBe("同一原文对应多个界面位置，无法安全匹配");
  });
  it("does not classify mixed-language examples as already Chinese", () => {
    const mixed = { ...catalog, strings: [{ ...catalog.strings[0], source: "示例: Link to original note" }] };
    expect(describeMissingTranslations(mixed, translation)[0]?.reason).toBe("当前译文包无此文案；来源与发布状态待核验");
  });
  it("does not list an exact local native translation as missing", () => {
    const native = { ...catalog, strings: catalog.strings.map((entry) => entry.source === "Missing text"
      ? { ...entry, nativeTarget: "自带译文", nativeTargetLocale: "zh-CN" } : entry) };
    expect(describeMissingTranslations(native, translation).some((entry) => entry.source === "Missing text")).toBe(false);
  });
});
