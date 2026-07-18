import { describe, expect, it } from "vitest";

import { validatePluginTranslations } from "../src/plugin-sync";

const catalog = {
  pluginId: "sample-plugin",
  pluginName: "Sample",
  pluginVersion: "1.0.0",
  sourceLocale: "en",
  digest: "digest",
  artifactDigest: "a".repeat(64),
  scannedAt: "2026-07-15T00:00:00.000Z",
  strings: [{
    key: "a".repeat(32),
    source: "Delete {0} items?",
    origins: ["ui-call" as const],
    placeholderSignature: "{0}",
  }],
} as const;

describe("validatePluginTranslations", () => {
  it("accepts known keys with preserved placeholders", () => {
    const state = validatePluginTranslations(
      catalog,
      [{ stringKey: "a".repeat(32), translatedText: "删除 {0} 个项目？" }],
      "source-version",
      "zh-CN",
    );
    expect(state.entries).toEqual([{ pluginId: "sample-plugin", source: "Delete {0} items?", target: "删除 {0} 个项目？" }]);
  });

  it("fails closed for placeholder loss or unknown keys", () => {
    expect(() => validatePluginTranslations(catalog, [{ stringKey: "a".repeat(32), translatedText: "删除项目？" }], "v", "zh-CN")).toThrow("占位符");
    expect(() => validatePluginTranslations(catalog, [{ stringKey: "b".repeat(32), translatedText: "设置" }], "v", "zh-CN")).toThrow("没有安全交集");
  });

  it("ignores official export rows that the local scanner did not discover", () => {
    const state = validatePluginTranslations(
      catalog,
      [
        { stringKey: "b".repeat(32), translatedText: "服务器额外译文" },
        { stringKey: "a".repeat(32), translatedText: "删除 {0} 个项目？" },
      ],
      "v",
      "zh-CN",
    );

    expect(state.entries).toEqual([{
      pluginId: "sample-plugin",
      source: "Delete {0} items?",
      target: "删除 {0} 个项目？",
    }]);
  });

  it("accepts only reviewed corrections bound to exact native text", () => {
    const state = validatePluginTranslations(catalog, [{
      stringKey: "a".repeat(32),
      translatedText: "移除 {0} 个项目？",
      provenanceKind: "th-reviewed-correction",
      application: "correction",
      nativeTarget: "删除 {0} 项？",
    }], "v", "zh-CN");
    expect(state.entries[0]).toEqual({
      pluginId: "sample-plugin",
      source: "Delete {0} items?",
      target: "移除 {0} 个项目？",
      provenanceKind: "th-reviewed-correction",
      application: "correction",
      nativeTarget: "删除 {0} 项？",
    });
    expect(() => validatePluginTranslations(catalog, [{
      stringKey: "a".repeat(32),
      translatedText: "移除 {0} 个项目？",
      provenanceKind: "th-automatic",
      application: "correction",
      nativeTarget: "删除 {0} 项？",
    }], "v", "zh-CN")).toThrow("缺少已审核");
  });
});
