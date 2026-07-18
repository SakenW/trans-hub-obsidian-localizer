import { describe, expect, it } from "vitest";

import { describePluginLocalizationStatus } from "../src/plugin-localization-status";

const baseSubmission = {
  pluginId: "dataview",
  pluginVersion: "0.5.68",
  catalogDigest: "catalog",
  contributionId: "source-contribution",
  contributionState: "received",
  submittedAt: "2026-07-18T00:00:00Z",
};

describe("describePluginLocalizationStatus", () => {
  it("marks the English source locale as complete without waiting for translation", () => {
    expect(describePluginLocalizationStatus({ targetLocale: "en" })).toEqual({
      kind: "localized",
      label: "源语言，无需翻译",
    });
  });

  it("shows the generic contribution state without an ecosystem-specific job", () => {
    expect(describePluginLocalizationStatus({
      submission: {
        ...baseSubmission,
        localizationContributionId: "localization-contribution",
        localizationContributionState: "received",
      },
      targetLocale: "zh-CN",
    })).toEqual({ kind: "waiting", label: "等待本地化需求处理" });
  });

  it("prioritizes an applied translation for the selected locale", () => {
    expect(describePluginLocalizationStatus({
      submission: baseSubmission,
      translation: {
        pluginId: "dataview",
        pluginVersion: "0.5.68",
        sourceVersionId: "source-version",
        targetLocale: "zh-CN",
        entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
        pulledAt: "2026-07-18T00:00:00Z",
      },
      targetLocale: "zh-CN",
    })).toEqual({ kind: "localized", label: "已本地化 1 条" });
  });

  it("将未收录和被拒绝的需求稳定归类，供列表筛选和单项重试使用", () => {
    expect(describePluginLocalizationStatus({ targetLocale: "zh-CN" })).toEqual({
      kind: "unrecorded", label: "未收录",
    });
    expect(describePluginLocalizationStatus({
      submission: { ...baseSubmission, localizationContributionState: "rejected" },
      targetLocale: "zh-CN",
    })).toEqual({ kind: "failed", label: "处理失败：需求未被接受" });
  });

  it("显示当前目录的真实覆盖率，而不是仅显示缓存条目数", () => {
    expect(describePluginLocalizationStatus({
      catalog: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.69",
        sourceLocale: "en", digest: "new", artifactDigest: "artifact", scannedAt: "2026-07-18T00:00:00Z",
        strings: [
          { key: "one", source: "Settings", origins: ["ui-call"], placeholderSignature: "" },
          { key: "two", source: "New option", origins: ["ui-call"], placeholderSignature: "" },
        ],
      },
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
        targetLocale: "zh-CN", entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
        pulledAt: "2026-07-18T00:00:00Z",
      },
      targetLocale: "zh-CN",
    })).toEqual({ kind: "waiting", label: "已本地化 1/2 条（50%），1 条等待发布" });
  });

  it("有可信来源元数据时展示原生、补充、校订和自动翻译构成", () => {
    expect(describePluginLocalizationStatus({
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
        targetLocale: "zh-CN",
        entries: [
          { pluginId: "dataview", source: "One", target: "一", provenanceKind: "upstream-native" },
          { pluginId: "dataview", source: "Two", target: "二", provenanceKind: "th-reviewed-fill" },
          {
            pluginId: "dataview", source: "Three", target: "三",
            provenanceKind: "th-reviewed-correction", application: "correction", nativeTarget: "叁",
          },
          { pluginId: "dataview", source: "Four", target: "四", provenanceKind: "th-automatic" },
        ],
        pulledAt: "2026-07-18T00:00:00Z",
      },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "localized",
      label: "已本地化 4 条；插件自带 1 · 语枢补充 1 · 语枢校订 1 · 自动翻译 1",
    });
  });
});
