import { describe, expect, it } from "vitest";

import {
  calculatePluginTranslationCoverage,
  localizedPluginDisplayName,
  localizedPluginDescription,
  mergeCatalogNativeTranslations,
  mergePublishedPluginTranslation,
  selectCurrentCatalogTranslations,
} from "../src/plugin-catalog-diff";

const catalog = {
  pluginId: "sample",
  pluginName: "Sample",
  pluginVersion: "2.0.0",
  sourceLocale: "en",
  digest: "catalog",
  artifactDigest: "artifact",
  scannedAt: "2026-07-18T00:00:00Z",
  strings: [
    { key: "name", source: "Sample", origins: ["manifest.name" as const], semanticRole: "official-name" as const, placeholderSignature: "" },
    { key: "description", source: "Sample description", origins: ["manifest.description" as const], semanticRole: "description" as const, placeholderSignature: "" },
    { key: "registry-description", source: "Find sample workflows.", origins: ["registry.description" as const], semanticRole: "description" as const, placeholderSignature: "" },
    { key: "one", source: "Settings", origins: ["readme" as const, "ui-call" as const], placeholderSignature: "" },
    { key: "two", source: "Rows: {{th:expr:0}}", origins: ["ui-call" as const], placeholderSignature: "{{th:expr:0}}" },
  ],
} as const;

const previous = {
  pluginId: "sample",
  pluginVersion: "1.0.0",
  sourceVersionId: "old-source",
  targetLocale: "zh-CN",
  pulledAt: "2026-07-17T00:00:00Z",
  entries: [
    { pluginId: "sample", source: "Settings", target: "设置" },
    { pluginId: "sample", source: "Removed", target: "已移除" },
    { pluginId: "sample", source: "Rows: {{th:expr:0}}", target: "行数" },
  ],
} as const;

describe("plugin catalog version carry-over", () => {
  it("只复用当前版本仍存在且占位符安全的译文，并给出真实覆盖率", () => {
    expect(selectCurrentCatalogTranslations(catalog, previous)).toEqual([
      { pluginId: "sample", source: "Settings", target: "设置", scopes: ["runtime-ui", "readme"] },
    ]);
    expect(calculatePluginTranslationCoverage(catalog, previous, "zh-CN")).toEqual({
      totalCount: 4,
      translatedCount: 1,
      missingCount: 3,
      staleCount: 1,
      percent: 25,
      exactPluginVersion: false,
      scopes: [
        { scope: "runtime-ui", totalCount: 2, translatedCount: 1, missingCount: 1, percent: 50 },
        { scope: "metadata", totalCount: 2, translatedCount: 0, missingCount: 2, percent: 0 },
        { scope: "readme", totalCount: 1, translatedCount: 1, missingCount: 0, percent: 100 },
      ],
      unattributedNativeCount: 0,
    });
  });

  it("把插件自带覆盖计入结果，并避免把语枢校订修正重复计数", () => {
    const translation = {
      ...previous,
      pluginVersion: "2.0.0",
      upstreamNativeCount: 4,
      entries: [
        { pluginId: "sample", source: "Settings", target: "设置", provenanceKind: "th-reviewed-fill" as const },
        {
          pluginId: "sample", source: "Rows: {{th:expr:0}}", target: "行数：{{th:expr:0}}",
          provenanceKind: "th-reviewed-correction" as const, application: "correction" as const,
          nativeTarget: "列数：{{th:expr:0}}",
        },
      ],
    };

    expect(calculatePluginTranslationCoverage(catalog, translation, "zh-CN")).toEqual({
      totalCount: 4,
      translatedCount: 4,
      missingCount: 0,
      staleCount: 0,
      percent: 100,
      exactPluginVersion: true,
      scopes: [
        { scope: "runtime-ui", totalCount: 2, translatedCount: 2, missingCount: 0, percent: 100 },
        { scope: "metadata", totalCount: 2, translatedCount: 0, missingCount: 2, percent: 0 },
        { scope: "readme", totalCount: 1, translatedCount: 1, missingCount: 0, percent: 100 },
      ],
      unattributedNativeCount: 3,
    });
  });

  it("不会把已带来源条目的插件自带覆盖重复计数", () => {
    const translation = {
      ...previous,
      pluginVersion: "2.0.0",
      upstreamNativeCount: 1,
      entries: [{
        pluginId: "sample",
        source: "Settings",
        target: "设置",
        provenanceKind: "upstream-native" as const,
      }],
    };

    expect(calculatePluginTranslationCoverage(catalog, translation, "zh-CN"))
      .toEqual(expect.objectContaining({
        translatedCount: 1,
        missingCount: 3,
        unattributedNativeCount: 0,
      }));
  });

  it("registry-only 观察可继续用于本地元数据呈现，但不制造覆盖缺口或陈旧译文", () => {
    const translation = {
      ...previous,
      pluginVersion: "2.0.0",
      entries: [
        { pluginId: "sample", source: "Settings", target: "设置" },
        { pluginId: "sample", source: "Find sample workflows.", target: "查找示例工作流。" },
      ],
    };

    expect(calculatePluginTranslationCoverage(catalog, translation, "zh-CN"))
      .toEqual(expect.objectContaining({
        totalCount: 4,
        translatedCount: 1,
        missingCount: 3,
        staleCount: 0,
      }));
    expect(selectCurrentCatalogTranslations(catalog, translation)).toContainEqual({
      pluginId: "sample",
      source: "Find sample workflows.",
      target: "查找示例工作流。",
      scopes: ["metadata"],
    });
  });

  it("忽略来自不同或不可能权威目录规模的插件自带汇总，避免膨胀当前覆盖率", () => {
    const translation = {
      ...previous,
      pluginVersion: "2.0.0",
      sourceUnitCount: 191,
      upstreamNativeCount: 134,
      entries: [{
        pluginId: "sample",
        source: "Settings",
        target: "设置",
        provenanceKind: "th-automatic" as const,
      }],
    };

    expect(calculatePluginTranslationCoverage(catalog, translation, "zh-CN"))
      .toEqual(expect.objectContaining({
        translatedCount: 1,
        missingCount: 3,
        unattributedNativeCount: 0,
      }));

    expect(calculatePluginTranslationCoverage(catalog, {
      ...translation,
      sourceUnitCount: 5,
    }, "zh-CN")).toEqual(expect.objectContaining({
      translatedCount: 1,
      missingCount: 3,
      unattributedNativeCount: 0,
    }));
  });

  it("将本地安装包的原生目标语言逐条归因，并仅让已审核校订覆盖它", () => {
    const nativeCatalog = {
      ...catalog,
      strings: catalog.strings.map((item) => {
        if (item.source === "Settings") {
          return { ...item, nativeTarget: "设置（原生）", nativeTargetLocale: "zh-CN" };
        }
        if (item.source === "Rows: {{th:expr:0}}") {
          return { ...item, nativeTarget: "行：{{th:expr:0}}", nativeTargetLocale: "zh-CN" };
        }
        return item;
      }),
    };
    const translation = {
      ...previous,
      entries: [
        { pluginId: "sample", source: "Settings", target: "设置（语枢机翻）", provenanceKind: "th-automatic" as const },
        {
          pluginId: "sample", source: "Rows: {{th:expr:0}}", target: "行数：{{th:expr:0}}",
          provenanceKind: "th-reviewed-correction" as const, application: "correction" as const,
          nativeTarget: "行：{{th:expr:0}}",
        },
      ],
    };

    expect(mergeCatalogNativeTranslations(nativeCatalog, translation).entries).toEqual(expect.arrayContaining([
      { pluginId: "sample", source: "Settings", target: "设置（原生）", provenanceKind: "upstream-native", scopes: ["runtime-ui", "readme"] },
      expect.objectContaining({ source: "Rows: {{th:expr:0}}", target: "行数：{{th:expr:0}}", provenanceKind: "th-reviewed-correction" }),
    ]));
    expect(calculatePluginTranslationCoverage(nativeCatalog, translation, "zh-CN")).toEqual(expect.objectContaining({
      translatedCount: 2,
      missingCount: 2,
      unattributedNativeCount: 0,
    }));
  });

  it("不修改官方身份，并在开关开启时显示名称和说明译文", () => {
    const translation = {
      ...previous,
      entries: [
        ...previous.entries,
        { pluginId: "sample", source: "Sample", target: "示例插件" },
        { pluginId: "sample", source: "Sample description", target: "示例说明" },
        { pluginId: "sample", source: "Find sample workflows.", target: "查找示例工作流。" },
      ],
    };
    expect(selectCurrentCatalogTranslations(catalog, translation)).toContainEqual(
      { pluginId: "sample", source: "Sample", target: "示例插件", scopes: ["metadata"] },
    );
    expect(selectCurrentCatalogTranslations(catalog, translation)).toContainEqual(
      { pluginId: "sample", source: "Sample description", target: "示例说明", scopes: ["metadata"] },
    );
    expect(localizedPluginDisplayName("Sample", catalog, translation, "zh-CN"))
      .toBe("示例插件");
    expect(localizedPluginDescription("Sample description", catalog, translation, "zh-CN"))
      .toBe("示例说明");
    expect(localizedPluginDescription("Find sample workflows.", catalog, translation, "zh-CN"))
      .toBe("查找示例工作流。");
    const runtimeOnly = selectCurrentCatalogTranslations(catalog, translation, false);
    expect(runtimeOnly.some((entry) => entry.source === "Sample description")).toBe(false);
    expect(runtimeOnly.some((entry) => entry.source === "Sample")).toBe(false);
    expect(runtimeOnly).toContainEqual(
      { pluginId: "sample", source: "Settings", target: "设置", scopes: ["runtime-ui", "readme"] },
    );
  });

  it("新发布译文优先，同时保留未变化的旧译文", () => {
    const incoming = {
      pluginId: "sample",
      pluginVersion: "2.0.0",
      sourceVersionId: "new-source",
      targetLocale: "zh-CN",
      pulledAt: "2026-07-18T00:00:00Z",
      entries: [{ pluginId: "sample", source: "Rows: {{th:expr:0}}", target: "行数：{{th:expr:0}}" }],
    } as const;
    expect(mergePublishedPluginTranslation(catalog, incoming, previous).entries).toEqual([
      { pluginId: "sample", source: "Rows: {{th:expr:0}}", target: "行数：{{th:expr:0}}" },
      { pluginId: "sample", source: "Settings", target: "设置" },
    ]);
  });
});
