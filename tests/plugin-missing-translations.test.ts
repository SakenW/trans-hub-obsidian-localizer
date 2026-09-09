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
      { source: "Missing text", reason: "尚无匹配译文" },
      { source: "示例文字", reason: "原文含中文，保留原文" },
    ]);
  });
  it("explains version mismatch without asserting that the server never translated it", () => {
    expect(describeMissingTranslations(catalog, { ...translation, authorityPluginVersion: "2.0" })
      .find((entry) => entry.source === "Missing text")?.reason).toBe("未找到安全匹配；当前译文来自其他版本");
  });
  it("does not classify mixed-language examples as already Chinese", () => {
    const mixed = { ...catalog, strings: [{ ...catalog.strings[0], source: "示例: Link to original note" }] };
    expect(describeMissingTranslations(mixed, translation)[0]?.reason).toBe("尚无匹配译文");
  });
  it("does not list an exact local native translation as missing", () => {
    const native = { ...catalog, strings: catalog.strings.map((entry) => entry.source === "Missing text"
      ? { ...entry, nativeTarget: "自带译文", nativeTargetLocale: "zh-CN" } : entry) };
    expect(describeMissingTranslations(native, translation).some((entry) => entry.source === "Missing text")).toBe(false);
  });
});
