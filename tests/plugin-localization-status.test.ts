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

const exactIdentity = {
  protocol: "trans-hub.source-catalog-identity" as const,
  revision: 1 as const,
  resourceKey: "dataview",
  resourceVersion: "0.5.68",
  sourceLocale: "en",
  artifactDigest: "ab".repeat(32),
  unitCount: 2,
  digest: "cd".repeat(32),
  scopes: [{ scope: "runtime-ui", unitCount: 2, digest: "ef".repeat(32) }],
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

  it("shows actionable machine translation and publication progress", () => {
    const status = {
      state: "mt_running" as const,
      sourceVersionId: "source-version",
      targetLocale: "zh-CN",
      targetVariant: "default",
      totalUnitCount: 77,
      workItemCount: 7,
      nativeUnitCount: 70,
      queuedCount: 0,
      runningCount: 2,
      succeededCount: 5,
      failedCount: 0,
      reviewedUnitCount: 0,
      publishedUnitCount: 0,
      retryAfterSeconds: 10,
      failureRetryable: false,
      updatedAt: "2026-07-20T00:00:00Z",
    };
    expect(describePluginLocalizationStatus({
      submission: { ...baseSubmission, localizationDemandStatus: status },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "waiting",
      label: "机器翻译中：已完成 5/7 条，正在处理 2 条",
    });
    expect(describePluginLocalizationStatus({
      submission: {
        ...baseSubmission,
        localizationDemandStatus: {
          ...status,
          state: "export_pending",
          runningCount: 0,
          succeededCount: 7,
        },
      },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "waiting",
      label: "翻译已完成 7/7 条，等待译文制品发布",
    });
  });

  it("distinguishes retryable and terminal machine translation failures", () => {
    const failed = {
      state: "mt_failed" as const,
      sourceVersionId: "source-version",
      targetLocale: "zh-CN",
      targetVariant: "default",
      totalUnitCount: 2,
      workItemCount: 2,
      nativeUnitCount: 0,
      queuedCount: 0,
      runningCount: 0,
      succeededCount: 1,
      failedCount: 1,
      reviewedUnitCount: 0,
      publishedUnitCount: 0,
      retryAfterSeconds: 60,
      failureCode: "MachineTranslationTransientError",
      failureRetryable: true,
      failureAttemptNumber: 2,
      updatedAt: "2026-07-20T00:00:00Z",
    };
    expect(describePluginLocalizationStatus({
      submission: { ...baseSubmission, localizationDemandStatus: failed },
      targetLocale: "zh-CN",
    }).label).toContain("服务器将自动重试（第 2/5 次）");
    expect(describePluginLocalizationStatus({
      submission: {
        ...baseSubmission,
        localizationDemandStatus: { ...failed, failureRetryable: false },
      },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "failed",
      label: "机器翻译失败，服务器已停止自动重试。点击右侧“重试此插件”。",
    });
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
    })).toEqual({ kind: "failed", label: "需求未被接受。点击右侧“重试此插件”。" });
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
    })).toEqual({
      kind: "catalog-mismatch",
      label: "服务器正在更新目录身份",
      catalogMismatch: { safelyAppliedCount: 1 },
    });
  });

  it("将目录不一致状态与安全应用量、权威目录构成分开提供给列表呈现", () => {
    expect(describePluginLocalizationStatus({
      catalog: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.69",
        sourceLocale: "en", digest: "new", artifactDigest: "new-artifact", scannedAt: "2026-07-18T00:00:00Z",
        strings: [{ key: "one", source: "Settings", origins: ["ui-call"], placeholderSignature: "" }],
      },
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
        targetLocale: "zh-CN", sourceUnitCount: 79, upstreamNativeCount: 12,
        publishedUnitCount: 64, missingUnitCount: 3,
        entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
        pulledAt: "2026-07-18T00:00:00Z",
      },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "catalog-mismatch",
      label: "服务器正在更新目录身份",
      catalogMismatch: {
        safelyAppliedCount: 1,
        authorityCatalog: {
          totalCount: 79,
          upstreamNativeCount: 12,
          publishedCount: 64,
          missingCount: 3,
        },
      },
    });
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
      label: "已本地化 4 条；插件自带 1 · 语枢已校对 1 · 语枢校对修正 1 · 语枢机翻 1（未经人工校对）",
    });
  });

  it("本地逐键识别的原生语言不受旧权威目录总数影响", () => {
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
      sourceLocale: "en", digest: exactIdentity.digest,
      artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
      scannedAt: "2026-07-18T00:00:00Z",
      strings: [
        {
          key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "",
          nativeTarget: "设置（插件自带）", nativeTargetLocale: "zh-CN",
        },
        { key: "two", source: "New option", origins: ["ui-call" as const], placeholderSignature: "" },
      ],
    };
    const status = describePluginLocalizationStatus({
      catalog,
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
        artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
        targetLocale: "zh-CN", sourceUnitCount: 79, upstreamNativeCount: 12,
        entries: [
          { pluginId: "dataview", source: "Settings", target: "设置（语枢机翻）", provenanceKind: "th-automatic" as const },
          { pluginId: "dataview", source: "New option", target: "新选项", provenanceKind: "th-automatic" as const },
        ],
        pulledAt: "2026-07-18T00:00:00Z",
      },
      targetLocale: "zh-CN",
    });

    expect(status.label).toContain("插件自带 1");
    expect(status.label).toContain("语枢机翻 1（未经人工校对）");
  });

  it("不把超过当前目录规模的原生汇总显示为当前插件来源", () => {
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
      sourceLocale: "en", digest: exactIdentity.digest,
      artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
      scannedAt: "2026-07-18T00:00:00Z",
      strings: [
        { key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "" },
        { key: "two", source: "New option", origins: ["ui-call" as const], placeholderSignature: "" },
      ],
    };
    const status = describePluginLocalizationStatus({
      catalog,
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
        artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
        targetLocale: "zh-CN", sourceUnitCount: 2, upstreamNativeCount: 856,
        entries: [{ pluginId: "dataview", source: "Settings", target: "设置", provenanceKind: "th-automatic" as const }],
        pulledAt: "2026-07-18T00:00:00Z",
      },
      targetLocale: "zh-CN",
    });

    expect(status.label).toContain("已发布 1/2 条（50%），1 条尚未发布");
    expect(status.label).not.toContain("插件自带");
    expect(status.coverage?.sourceMetrics).toEqual([
      { label: "语枢机翻 1（未经人工校对）", tone: "automatic" },
    ]);
  });

  it("仅在权威需求仍处理中时把精确目录缺口称为等待发布", () => {
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
      sourceLocale: "en", digest: exactIdentity.digest,
      artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
      scannedAt: "2026-07-18T00:00:00Z",
      strings: [
        { key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "" },
        { key: "two", source: "New option", origins: ["ui-call" as const], placeholderSignature: "" },
      ],
    };
    const translation = {
      pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
      artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
      targetLocale: "zh-CN",
      entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
      pulledAt: "2026-07-18T00:00:00Z",
    };
    expect(describePluginLocalizationStatus({ catalog, translation, targetLocale: "zh-CN" })).toEqual({
      kind: "localized",
      label: "已发布 1/2 条（50%），1 条尚未发布；插件界面 1/2",
      coverage: {
        headline: "已发布 1/2 条（50%），1 条尚未发布",
        complete: false,
        scopeMetrics: ["插件界面 1/2"],
        sourceMetrics: [],
      },
    });
    expect(describePluginLocalizationStatus({
      catalog,
      translation,
      submission: {
        ...baseSubmission,
        localizationDemandStatus: {
          state: "mt_running", sourceVersionId: "stale-source", targetLocale: "zh-CN",
          targetVariant: "default", totalUnitCount: 2, workItemCount: 1,
          nativeUnitCount: 0, queuedCount: 0, runningCount: 1, succeededCount: 0,
          failedCount: 0, reviewedUnitCount: 0, publishedUnitCount: 1,
          retryAfterSeconds: 5, failureRetryable: false,
          updatedAt: "2026-07-20T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "localized",
      label: "已发布 1/2 条（50%），1 条尚未发布；插件界面 1/2",
      coverage: {
        headline: "已发布 1/2 条（50%），1 条尚未发布",
        complete: false,
        scopeMetrics: ["插件界面 1/2"],
        sourceMetrics: [],
      },
    });
    expect(describePluginLocalizationStatus({
      catalog,
      translation,
      submission: {
        ...baseSubmission,
        localizationDemandStatus: {
          state: "mt_running", sourceVersionId: "source", targetLocale: "zh-CN",
          targetVariant: "default", totalUnitCount: 2, workItemCount: 1,
          nativeUnitCount: 0, queuedCount: 0, runningCount: 1, succeededCount: 0,
          failedCount: 0, reviewedUnitCount: 0, publishedUnitCount: 1,
          retryAfterSeconds: 5, failureRetryable: false,
          updatedAt: "2026-07-20T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "waiting",
      label: "已本地化 1/2 条（50%），1 条等待发布；插件界面 1/2",
      coverage: {
        headline: "已本地化 1/2 条（50%），1 条等待发布",
        complete: false,
        scopeMetrics: ["插件界面 1/2"],
        sourceMetrics: [],
      },
    });
  });

  it("仅有覆盖摘要时也展示插件自带语言，不伪造语枢译文条目", () => {
    expect(describePluginLocalizationStatus({
      catalog: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
        sourceLocale: "en", digest: exactIdentity.digest,
        artifactDigest: exactIdentity.artifactDigest,
        catalogIdentity: exactIdentity,
        scannedAt: "2026-07-18T00:00:00Z",
        strings: [
          { key: "one", source: "Settings", origins: ["ui-call"], placeholderSignature: "" },
          { key: "two", source: "New option", origins: ["ui-call"], placeholderSignature: "" },
        ],
      },
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
        artifactDigest: exactIdentity.artifactDigest,
        catalogIdentity: exactIdentity,
        targetLocale: "zh-CN", upstreamNativeCount: 2, entries: [],
        pulledAt: "2026-07-18T00:00:00Z",
      },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "localized",
      label: "已本地化 2/2 条（100%）；插件自带 2 条（范围明细待同步）",
      coverage: {
        headline: "已本地化 2/2 条（100%）",
        complete: true,
        scopeMetrics: ["插件自带 2 条（范围明细待同步）"],
        sourceMetrics: [],
      },
    });
  });

  it("制品相同但目录身份不同时只报告安全交集并等待权威目录更新", () => {
    expect(describePluginLocalizationStatus({
      catalog: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
        sourceLocale: "en", digest: "11".repeat(32), artifactDigest: "ab".repeat(32),
        catalogIdentity: {
          ...exactIdentity,
          digest: "11".repeat(32),
          scopes: [{ scope: "runtime-ui", unitCount: 2, digest: "22".repeat(32) }],
        },
        scannedAt: "2026-07-18T00:00:00Z",
        strings: [
          { key: "one", source: "Settings", origins: ["ui-call"], placeholderSignature: "" },
          { key: "two", source: "New option", origins: ["ui-call"], placeholderSignature: "" },
        ],
      },
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
        artifactDigest: "ab".repeat(32),
        catalogIdentity: {
          ...exactIdentity,
          digest: "33".repeat(32),
          scopes: [{ scope: "runtime-ui", unitCount: 1, digest: "44".repeat(32) }],
        },
        targetLocale: "zh-CN",
        entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
        pulledAt: "2026-07-18T00:00:00Z",
      },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "catalog-mismatch",
      label: "服务器目录正在更新：插件界面",
      catalogMismatch: {
        safelyAppliedCount: 1,
        authorityCatalog: undefined,
      },
    });
  });

  it("deduplicates historical rows by source and reports only the strongest effective provenance", () => {
    expect(describePluginLocalizationStatus({
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
        targetLocale: "zh-CN",
        entries: [
          { pluginId: "dataview", source: "One", target: "一", provenanceKind: "th-automatic" },
          { pluginId: "dataview", source: "One", target: "壹", provenanceKind: "th-reviewed-fill" },
        ],
        pulledAt: "2026-07-18T00:00:00Z",
      },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "localized",
      label: "已本地化 1 条；语枢已校对 1",
    });
  });
});
