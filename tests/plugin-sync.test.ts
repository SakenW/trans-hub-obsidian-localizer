import { describe, expect, it } from "vitest";

import { isPublishedExportPending, validatePluginTranslations } from "../src/plugin-sync";

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
    expect(state.entries).toEqual([{
      pluginId: "sample-plugin",
      source: "Delete {0} items?",
      target: "删除 {0} 个项目？",
      scopes: ["runtime-ui"],
    }]);
  });

  it("fails closed for placeholder loss or unknown keys", () => {
    expect(() => validatePluginTranslations(catalog, [{ stringKey: "a".repeat(32), translatedText: "删除项目？" }], "v", "zh-CN")).toThrow("占位符");
    expect(() => validatePluginTranslations(catalog, [{ stringKey: "b".repeat(32), translatedText: "设置" }], "v", "zh-CN")).toThrow("没有安全交集");
  });

  it("accepts a safe reordered runtime expression but rejects missing or duplicated slots", () => {
    const dynamicCatalog = {
      ...catalog,
      strings: [{
        key: "c".repeat(32),
        source: "From {{th:expr:0}} to {{th:expr:1}}",
        origins: ["ui-call" as const],
        placeholderSignature: '["{{th:expr:0}}","{{th:expr:1}}"]',
      }],
    } as const;
    expect(validatePluginTranslations(
      dynamicCatalog,
      [{ stringKey: "c".repeat(32), translatedText: "从 {{th:expr:1}} 到 {{th:expr:0}}" }],
      "v",
      "zh-CN",
    ).entries[0]?.target).toBe("从 {{th:expr:1}} 到 {{th:expr:0}}");
    expect(() => validatePluginTranslations(
      dynamicCatalog,
      [{ stringKey: "c".repeat(32), translatedText: "从 {{th:expr:0}} 到 {{th:expr:0}}" }],
      "v",
      "zh-CN",
    )).toThrow("占位符");
  });

  it("fails closed when distinct occurrences of one source disagree", () => {
    const repeatedSourceCatalog = {
      ...catalog,
      strings: [
        catalog.strings[0],
        { ...catalog.strings[0], key: "b".repeat(32) },
      ],
    };
    expect(() => validatePluginTranslations(
      repeatedSourceCatalog,
      [
        { stringKey: "a".repeat(32), translatedText: "删除 {0} 个项目？" },
        { stringKey: "b".repeat(32), translatedText: "移除 {0} 个条目？" },
      ],
      "v",
      "zh-CN",
    )).toThrow("同源 occurrence 冲突");

    expect(validatePluginTranslations(
      repeatedSourceCatalog,
      [
        { stringKey: "a".repeat(32), translatedText: "删除 {0} 个项目？" },
        { stringKey: "b".repeat(32), translatedText: "删除 {0} 个项目？" },
      ],
      "v",
      "zh-CN",
    ).entries).toHaveLength(1);
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
      scopes: ["runtime-ui"],
    }]);
  });

  it("只保存插件自带语言的覆盖数量，不保存其目标正文", () => {
    const state = validatePluginTranslations(catalog, [], "v", "zh-CN", 1);

    expect(state.upstreamNativeCount).toBe(1);
    expect(state.entries).toEqual([]);
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
      scopes: ["runtime-ui"],
    });
    expect(() => validatePluginTranslations(catalog, [{
      stringKey: "a".repeat(32),
      translatedText: "移除 {0} 个项目？",
      provenanceKind: "th-automatic",
      application: "correction",
      nativeTarget: "删除 {0} 项？",
    }], "v", "zh-CN")).toThrow("缺少已审核");
  });

  it("applies only the structured safe intersection from a newer authority version", () => {
    const compatibility = {
      semanticRole: "runtime-ui",
      contentScopes: ["runtime-ui"],
      placeholderSignature: "{0}",
      formatSignature: "plain-text-v1",
      // The client retains this raw-byte digest as evidence but does not fake
      // a comparison against its NFC-normalized persisted source.
      sourceContentDigest: `sha256:${"f".repeat(64)}`,
    } as const;
    const published = {
      sourceVersionId: "current-source", objectVersionId: "current-object",
      authorityPluginVersion: "1.1.0", artifactDigest: "b".repeat(64),
      catalogIdentityExact: false, sourceUnitCount: 1, upstreamNativeCount: 0,
      publishedUnitCount: 1, missingUnitCount: 0,
    } as const;
    const rows = [
      { stringKey: "a".repeat(32), translatedText: "删除 {0} 个项目？", sourceCompatibility: compatibility },
      { stringKey: "b".repeat(32), translatedText: "错误键 {0}", sourceCompatibility: compatibility },
      { stringKey: "a".repeat(32), translatedText: "缺少占位符", sourceCompatibility: compatibility },
      { stringKey: "a".repeat(32), translatedText: "角色 {0}", sourceCompatibility: { ...compatibility, semanticRole: "description" } },
      { stringKey: "a".repeat(32), translatedText: "范围 {0}", sourceCompatibility: { ...compatibility, contentScopes: ["metadata"] } },
      { stringKey: "a".repeat(32), translatedText: "格式 {0}", sourceCompatibility: { ...compatibility, formatSignature: "markdown-v1" } },
      { stringKey: "a".repeat(32), translatedText: "签名 {0}", sourceCompatibility: { ...compatibility, placeholderSignature: "" } },
      { stringKey: "a".repeat(32), translatedText: "缺证据 {0}" },
    ] as const;

    const state = validatePluginTranslations(
      catalog,
      rows,
      "current-source",
      "zh-CN",
      0,
      published,
    );

    expect(state).toMatchObject({
      pluginVersion: "1.0.0",
      authorityPluginVersion: "1.1.0",
      sourceVersionId: "current-source",
    });
    expect(state.entries).toEqual([expect.objectContaining({
      source: "Delete {0} items?",
      target: "删除 {0} 个项目？",
      sourceCompatibility: compatibility,
    })]);
  });

  it("returns an empty current dictionary when every cross-version row is unsafe", () => {
    const state = validatePluginTranslations(
      catalog,
      [{ stringKey: "a".repeat(32), translatedText: "删除 {0} 个项目？" }],
      "current-source",
      "zh-CN",
      0,
      {
        sourceVersionId: "current-source", objectVersionId: "current-object",
        authorityPluginVersion: "1.1.0", artifactDigest: "b".repeat(64),
        catalogIdentityExact: false, sourceUnitCount: 1, upstreamNativeCount: 0,
        publishedUnitCount: 1, missingUnitCount: 0,
      },
    );
    expect(state.entries).toEqual([]);
  });
});

describe("isPublishedExportPending", () => {
  it("only classifies an explicit 404 as a pending publication", () => {
    expect(isPublishedExportPending(new Error("Published export not found：HTTP 404"))).toBe(true);
    expect(isPublishedExportPending(new Error("translation_manifest_failed:404"))).toBe(true);
    expect(isPublishedExportPending(new Error("Published export not found：HTTP 401"))).toBe(false);
    expect(isPublishedExportPending(new Error("Published export not found：HTTP 500"))).toBe(false);
    expect(isPublishedExportPending(new Error("Other request failed：HTTP 404"))).toBe(false);
  });
});
