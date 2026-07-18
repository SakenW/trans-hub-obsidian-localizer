import { describe, expect, it } from "vitest";

import {
  calculatePluginTranslationCoverage,
  localizedPluginDisplayName,
  localizedPluginDescription,
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
    { key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "" },
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
      { pluginId: "sample", source: "Settings", target: "设置" },
    ]);
    expect(calculatePluginTranslationCoverage(catalog, previous, "zh-CN")).toEqual({
      totalCount: 5,
      translatedCount: 1,
      missingCount: 4,
      staleCount: 1,
      percent: 20,
      exactPluginVersion: false,
    });
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
      { pluginId: "sample", source: "Sample", target: "示例插件" },
    );
    expect(selectCurrentCatalogTranslations(catalog, translation)).toContainEqual(
      { pluginId: "sample", source: "Sample description", target: "示例说明" },
    );
    expect(localizedPluginDisplayName("Sample", catalog, translation, "zh-CN"))
      .toBe("示例插件");
    expect(localizedPluginDescription("Sample description", catalog, translation, "zh-CN"))
      .toBe("示例说明");
    expect(localizedPluginDescription("Find sample workflows.", catalog, translation, "zh-CN"))
      .toBe("查找示例工作流。");
    expect(selectCurrentCatalogTranslations(catalog, translation, false)).not.toContainEqual(
      { pluginId: "sample", source: "Sample description", target: "示例说明" },
    );
    expect(selectCurrentCatalogTranslations(catalog, translation, false)).not.toContainEqual(
      { pluginId: "sample", source: "Sample", target: "示例插件" },
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
