import { describe, expect, it } from "vitest";

import {
  describePluginLocalizationStatus,
  PLUGIN_LOCALIZATION_STATUS_FILTERS,
  pluginManualRetryKind,
  visiblePluginManualRetryKind,
} from "../src/plugin-localization-status";
import { EMPTY_PLUGIN_STATE } from "../src/plugin-state";

const baseSubmission = {
  pluginId: "dataview",
  pluginVersion: "0.5.68",
  catalogDigest: "catalog",
  contributionId: "source-contribution",
  contributionState: "source_attested",
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

  it("prioritizes connection state over stale cached server progress", () => {
    const cachedTranslation = {
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      sourceVersionId: "source",
      targetLocale: "zh-CN",
      entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
      pulledAt: "2026-07-18T00:00:00Z",
    };
    expect(describePluginLocalizationStatus({
      submission: baseSubmission,
      translation: cachedTranslation,
      targetLocale: "zh-CN",
      hasSession: false,
    })).toEqual({ kind: "login-required", label: "登录后同步" });
    expect(describePluginLocalizationStatus({
      submission: baseSubmission,
      translation: cachedTranslation,
      targetLocale: "zh-CN",
      hasSession: false,
      requiresReconnect: true,
    })).toEqual({ kind: "login-required", label: "重新连接后继续同步" });
  });

  it("新来源仍在处理时不显示旧的本地化终止状态", () => {
    expect(describePluginLocalizationStatus({
      submission: {
        ...baseSubmission,
        contributionState: "received",
        localizationContributionId: "localization-contribution",
        localizationContributionState: "received",
        localizationDemandStatus: {
          state: "distribution_blocked",
          sourceVersionId: "old-source",
          targetLocale: "zh-CN",
          targetVariant: "default",
          totalUnitCount: 1,
          workItemCount: 1,
          nativeUnitCount: 0,
          queuedCount: 0,
          runningCount: 0,
          succeededCount: 1,
          failedCount: 0,
          reviewedUnitCount: 0,
          publishedUnitCount: 0,
          retryAfterSeconds: 0,
          failureCode: "PublicDistributionLicenseEvidenceMissing",
          failureRetryable: false,
          updatedAt: "2026-07-29T00:00:00Z",
        },
      },
      catalog: {
        pluginId: "dataview",
        pluginName: "Dataview",
        pluginVersion: "0.5.68",
        sourceLocale: "en",
        digest: "catalog",
        artifactDigest: "ab".repeat(32),
        scannedAt: "2026-07-29T00:00:00Z",
        strings: [],
      },
      targetLocale: "zh-CN",
    })).toEqual({ kind: "waiting", label: "等待可信来源收录" });
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
      label: "翻译已完成 7/7 条，正在生成可下载包",
    });
  });

  it("does not call an unprojected export a client pullback delay", () => {
    const demand = {
      state: "export_ready" as const,
      sourceVersionId: "source-version",
      targetLocale: "zh-CN",
      targetVariant: "default",
      totalUnitCount: 123,
      workItemCount: 123,
      nativeUnitCount: 0,
      queuedCount: 0,
      runningCount: 0,
      succeededCount: 123,
      failedCount: 0,
      reviewedUnitCount: 0,
      publishedUnitCount: 0,
      manifestId: "manifest",
      generationNumber: 17,
      retryAfterSeconds: 0,
      failureRetryable: false,
      updatedAt: "2026-07-27T00:00:00Z",
    };
    expect(describePluginLocalizationStatus({
      submission: { ...baseSubmission, localizationDemandStatus: demand },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "waiting",
      label: "译文制品已生成，等待服务端公共目录更新",
    });
    expect(describePluginLocalizationStatus({
      submission: {
        ...baseSubmission,
        localizationDemandStatus: { ...demand, publishedUnitCount: 123 },
      },
      targetLocale: "zh-CN",
    })).toEqual({ kind: "waiting", label: "译文已发布，等待客户端回拉" });
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

  it("does not offer a manual retry for a deterministically unprocessable source", () => {
    const demand = {
      state: "mt_failed" as const,
      sourceVersionId: "source-version",
      targetLocale: "zh-CN",
      targetVariant: "default",
      totalUnitCount: 1,
      workItemCount: 1,
      nativeUnitCount: 0,
      queuedCount: 0,
      runningCount: 0,
      succeededCount: 0,
      failedCount: 1,
      reviewedUnitCount: 0,
      publishedUnitCount: 0,
      retryAfterSeconds: 0,
      failureCode: "MachineTranslationUnsupportedComplexPlaceholder",
      failureRetryable: false,
      failureAttemptNumber: 1,
      updatedAt: "2026-08-02T00:00:00Z",
    };
    const input = {
      catalog: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
        sourceLocale: "en", digest: exactIdentity.digest,
        artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
        scannedAt: "2026-08-02T00:00:00Z",
        strings: [{ key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "" }],
      },
      submission: {
        ...baseSubmission,
        catalogDigest: exactIdentity.digest,
        contributionState: "rejected" as const,
        sourceVersionId: "source-version",
        localizationContributionState: "rejected" as const,
        localizationDemandStatus: demand,
      },
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source-version",
        targetLocale: "zh-CN", entries: [], pulledAt: "2026-08-02T00:00:00Z",
      },
      targetLocale: "zh-CN",
    } as const;

    expect(pluginManualRetryKind(input)).toBeNull();
    const status = describePluginLocalizationStatus(input);
    expect(status.kind).toBe("preserved-source");
    expect(status.label).toContain("无法安全处理当前来源中的复杂占位符");
    expect(status.label).not.toContain("重试");
    expect(PLUGIN_LOCALIZATION_STATUS_FILTERS.find((item) => item.value === "preserved-source")?.label)
      .toBe("保留原文");
    expect(PLUGIN_LOCALIZATION_STATUS_FILTERS.find((item) => item.value === "failed")?.label)
      .toBe("处理失败");

    const recoverableSynchronizationError = {
      ...input,
      submission: {
        ...input.submission,
        lastError: {
          code: "PC_RETRY_EXHAUSTED",
          message: "服务器暂时不可用",
          targetLocale: "zh-CN",
          updatedAt: "2026-08-02T00:01:00Z",
        },
      },
    } as const;
    expect(pluginManualRetryKind(recoverableSynchronizationError)).toBe("resynchronize");
    expect(describePluginLocalizationStatus(recoverableSynchronizationError).label)
      .toContain("同步失败");
  });

  it("does not offer a stale machine retry after the exact catalog is complete", () => {
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
      sourceLocale: "en", digest: exactIdentity.digest,
      artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
      scannedAt: "2026-07-29T00:00:00Z",
      strings: [
        { key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "" },
        { key: "two", source: "Index", origins: ["ui-call" as const], placeholderSignature: "" },
      ],
    };
    const submission = {
      ...baseSubmission,
      catalogDigest: exactIdentity.digest,
      sourceVersionId: "current-source",
      localizationContributionState: "mt_failed",
      localizationDemandStatus: {
        state: "mt_failed" as const,
        sourceVersionId: "current-source",
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
        failureCode: "MachineTranslationRejected",
        failureRetryable: false,
        failureAttemptNumber: 1,
        updatedAt: "2026-07-29T00:00:00Z",
      },
    };
    const translation = {
      pluginId: "dataview", pluginVersion: "0.5.68",
      sourceVersionId: "current-source", targetLocale: "zh-CN",
      artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
      sourceUnitCount: 2, publishedUnitCount: 2, missingUnitCount: 0,
      entries: [
        { pluginId: "dataview", source: "Settings", target: "设置" },
        { pluginId: "dataview", source: "Index", target: "索引" },
      ],
      pulledAt: "2026-07-29T00:00:00Z",
    };

    const input = {
      catalog, submission, translation, targetLocale: "zh-CN",
    } as const;
    expect(pluginManualRetryKind(input)).toBeNull();
    const status = describePluginLocalizationStatus(input);
    expect(status.kind).toBe("localized");
    expect(status.coverage?.complete).toBe(true);
    expect(status.label).not.toContain("重试");
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
    })).toEqual({ kind: "waiting", label: "已获取 1 条缓存译文，等待当前目录匹配" });
  });

  it("将首次本地化准备和被拒绝的需求稳定归类，供列表筛选和单项重试使用", () => {
    expect(describePluginLocalizationStatus({ targetLocale: "zh-CN" })).toEqual({
      kind: "waiting", label: "正在准备首次本地化…", initialSubmission: true,
    });
    expect(describePluginLocalizationStatus({
      submission: { ...baseSubmission, localizationContributionState: "rejected" },
      targetLocale: "zh-CN",
    })).toEqual({ kind: "failed", label: "需求未被接受。点击右侧“重试此插件”。" });
  });

  it("以当前精确需求的公开分发阻断覆盖旧来源拒绝，且不显示不可执行的重试", () => {
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
      sourceLocale: "en", digest: "catalog", artifactDigest: "artifact",
      scannedAt: "2026-08-02T00:00:00Z", strings: [],
    };
    const submission = {
      ...baseSubmission,
      catalogDigest: "catalog",
      contributionState: "rejected",
      sourceVersionId: "source-version",
      localizationContributionState: "distribution_blocked",
      localizationDemandStatus: {
        state: "distribution_blocked" as const,
        sourceVersionId: "source-version", targetLocale: "zh-CN", targetVariant: "default",
        totalUnitCount: 1, workItemCount: 1, nativeUnitCount: 0,
        queuedCount: 0, runningCount: 0, succeededCount: 1, failedCount: 0,
        reviewedUnitCount: 0, publishedUnitCount: 0, retryAfterSeconds: 0,
        failureCode: "PublicDistributionAuthorityRetryExhausted",
        failureRetryable: false,
        updatedAt: "2026-08-02T00:00:00Z",
      },
    };
    const translation = {
      pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source-version",
      targetLocale: "zh-CN", entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
      pulledAt: "2026-08-02T00:00:00Z",
    };
    const input = { catalog, submission, translation, targetLocale: "zh-CN" } as const;

    const status = describePluginLocalizationStatus(input);
    expect(status.kind).toBe("blocked");
    expect(status.label).toContain("无法公开发布：权威来源校验多次失败，服务器已停止自动重试");
    expect(pluginManualRetryKind(input)).toBeNull();
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
    })).toMatchObject({
      kind: "localized",
      coverage: {
        headline: "可安全应用 1/2 条匹配译文，1 条暂不可安全应用",
        complete: false,
      },
    });
  });

  it("目录不一致时只展示当前本地目录的覆盖构成", () => {
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
    })).toMatchObject({
      kind: "localized",
      coverage: {
        headline: "可安全应用 1/1 条匹配译文",
        complete: true,
      },
    });
  });

  it("本地制品变体只显示安全交集，不误报服务器目录待同步", () => {
    const localIdentity = {
      ...exactIdentity,
      artifactDigest: "cd".repeat(32),
      digest: "ef".repeat(32),
      unitCount: 2,
      scopes: [{ scope: "runtime-ui", unitCount: 2, digest: "12".repeat(32) }],
    } as const;
    const status = describePluginLocalizationStatus({
      catalog: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
        sourceLocale: "en", digest: localIdentity.digest,
        artifactDigest: localIdentity.artifactDigest, catalogIdentity: localIdentity,
        scannedAt: "2026-07-29T00:00:00Z",
        strings: [
          { key: "one", source: "Settings", origins: ["ui-call"], placeholderSignature: "" },
          { key: "two", source: "Local only", origins: ["ui-call"], placeholderSignature: "" },
        ],
      },
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "official-source",
        artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
        targetLocale: "zh-CN",
        entries: [{
          pluginId: "dataview", source: "Settings", target: "设置", provenanceKind: "th-automatic",
        }],
        pulledAt: "2026-07-29T00:00:00Z",
      },
      targetLocale: "zh-CN",
    });

    expect(status.kind).toBe("localized");
    expect(status.coverage?.headline).toBe("可安全应用 1/2 条匹配译文，1 条暂不可安全应用");
    expect(status.coverage?.notice).toBeUndefined();
    expect(status.coverage?.complete).toBe(false);
  });

  it("来源许可阻断时保留安全交集且不再提示等待或重试", () => {
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
      sourceLocale: "en", digest: "new-catalog", artifactDigest: exactIdentity.artifactDigest,
      catalogIdentity: {
        ...exactIdentity,
        digest: "12".repeat(32),
        scopes: [{ scope: "runtime-ui", unitCount: 2, digest: "34".repeat(32) }],
      },
      scannedAt: "2026-07-29T00:00:00Z",
      strings: [
        { key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "" },
        { key: "two", source: "New local source", origins: ["ui-call" as const], placeholderSignature: "" },
      ],
    };
    const submission = {
      ...baseSubmission,
      catalogDigest: "new-catalog",
      localizationDemandStatus: {
        state: "distribution_blocked" as const,
        sourceVersionId: "old-source",
        targetLocale: "zh-CN",
        targetVariant: "default",
        totalUnitCount: 2,
        workItemCount: 2,
        nativeUnitCount: 0,
        queuedCount: 0,
        runningCount: 0,
        succeededCount: 2,
        failedCount: 0,
        reviewedUnitCount: 0,
        publishedUnitCount: 0,
        retryAfterSeconds: 0,
        failureCode: "PublicDistributionPolicyUnavailable",
        failureRetryable: false,
        updatedAt: "2026-07-29T00:00:00Z",
      },
    };
    const translation = {
      pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "old-source",
      artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
      targetLocale: "zh-CN",
      entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
      pulledAt: "2026-07-29T00:00:00Z",
    };

    const status = describePluginLocalizationStatus({
      catalog, submission, translation, targetLocale: "zh-CN",
    });
    expect(status.kind).toBe("blocked");
    expect(status.coverage?.headline).toBe(
      "无法公开发布：当前精确版本的公开分发策略不可用",
    );
    expect(status.coverage?.notice).toBe(
      "可安全应用 1/2 条匹配译文，1 条暂不可安全应用",
    );
    expect(status.label).not.toContain("等待");
    expect(pluginManualRetryKind({
      catalog, submission, translation, targetLocale: "zh-CN",
    })).toBeNull();
  });

  it("已有安全交集时仍以终止的机器翻译失败作为主状态", () => {
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
      sourceLocale: "en", digest: exactIdentity.digest,
      artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
      scannedAt: "2026-07-29T00:00:00Z",
      strings: [
        { key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "" },
        { key: "two", source: "New local source", origins: ["ui-call" as const], placeholderSignature: "" },
      ],
    };
    const status = describePluginLocalizationStatus({
      catalog,
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
        artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
        targetLocale: "zh-CN",
        entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
        pulledAt: "2026-07-29T00:00:00Z",
      },
      submission: {
        ...baseSubmission,
        localizationDemandStatus: {
          state: "mt_failed", sourceVersionId: "source", targetLocale: "zh-CN",
          targetVariant: "default", totalUnitCount: 2, workItemCount: 2,
          nativeUnitCount: 0, queuedCount: 0, runningCount: 0, succeededCount: 1,
          failedCount: 1, reviewedUnitCount: 0, publishedUnitCount: 0,
          retryAfterSeconds: 0, failureRetryable: false,
          updatedAt: "2026-07-29T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    });

    expect(status.kind).toBe("failed");
    expect(status.coverage?.headline).toBe(
      "机器翻译失败，服务器已停止自动重试。点击右侧“重试此插件”。",
    );
    expect(status.coverage?.notice).toBe(
      "可安全应用 1/2 条匹配译文，1 条暂不可安全应用",
    );
  });

  it.each([
    {
      retryable: true,
      expectedKind: "waiting" as const,
      expectedLabel: "机器翻译暂时失败，服务器将自动重试（第 2/5 次）",
    },
    {
      retryable: false,
      expectedKind: "failed" as const,
      expectedLabel: "机器翻译失败，服务器已停止自动重试。点击右侧“重试此插件”。",
    },
  ])("本地目录暂缺时仍显示当前来源的机器翻译失败（retryable=$retryable）", ({
    retryable, expectedKind, expectedLabel,
  }) => {
    const input = {
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
        targetLocale: "zh-CN",
        entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
        pulledAt: "2026-07-29T00:00:00Z",
      },
      submission: {
        ...baseSubmission,
        localizationDemandStatus: {
          state: "mt_failed", sourceVersionId: "source", targetLocale: "zh-CN",
          targetVariant: "default", totalUnitCount: 2, workItemCount: 2,
          nativeUnitCount: 0, queuedCount: 0, runningCount: 0, succeededCount: 1,
          failedCount: 1, reviewedUnitCount: 0, publishedUnitCount: 0,
          retryAfterSeconds: retryable ? 30 : 0, failureRetryable: retryable,
          failureAttemptNumber: 2, updatedAt: "2026-07-29T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    } as const;
    const status = describePluginLocalizationStatus(input);

    expect(status).toMatchObject({ kind: expectedKind });
    expect(status.label).toContain(expectedLabel);
    expect(pluginManualRetryKind(input)).toBe(retryable ? null : "resubmit");
  });

  it("没有历史译文时按服务端失败码显示独立分发受限状态", () => {
    expect(describePluginLocalizationStatus({
      submission: {
        ...baseSubmission,
        localizationDemandStatus: {
          state: "distribution_blocked",
          sourceVersionId: "blocked-source",
          targetLocale: "zh-CN",
          targetVariant: "default",
          totalUnitCount: 2,
          workItemCount: 2,
          nativeUnitCount: 0,
          queuedCount: 0,
          runningCount: 0,
          succeededCount: 2,
          failedCount: 0,
          reviewedUnitCount: 0,
          publishedUnitCount: 0,
          retryAfterSeconds: 0,
          failureCode: "PublicDistributionLicenseEvidenceMissing",
          failureRetryable: false,
          updatedAt: "2026-07-29T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "blocked",
      label: "无法公开发布：缺少当前精确版本的许可证证据",
    });
  });

  it("分发受限缺少失败码时仍显示通用阻断原因", () => {
    const status = describePluginLocalizationStatus({
      catalog: {
        pluginId: "generic", pluginName: "Generic", pluginVersion: "1.0.0",
        sourceLocale: "en", digest: exactIdentity.digest,
        artifactDigest: exactIdentity.artifactDigest,
        catalogIdentity: exactIdentity, scannedAt: "2026-07-29T00:00:00Z",
        strings: [
          { key: "one", source: "Settings", origins: ["ui-call"], placeholderSignature: "" },
          { key: "two", source: "Missing", origins: ["ui-call"], placeholderSignature: "" },
        ],
      },
      translation: {
        pluginId: "generic", pluginVersion: "1.0.0", sourceVersionId: "source",
        artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
        targetLocale: "zh-CN",
        entries: [{ pluginId: "generic", source: "Settings", target: "设置" }],
        pulledAt: "2026-07-29T00:00:00Z",
      },
      submission: {
        ...baseSubmission,
        pluginId: "generic",
        pluginVersion: "1.0.0",
        catalogDigest: exactIdentity.digest,
        sourceVersionId: "source",
        localizationDemandStatus: {
          state: "distribution_blocked", sourceVersionId: "source", targetLocale: "zh-CN",
          targetVariant: "default", totalUnitCount: 2, workItemCount: 1,
          nativeUnitCount: 0, queuedCount: 0, runningCount: 0, succeededCount: 1,
          failedCount: 0, reviewedUnitCount: 0, publishedUnitCount: 0,
          retryAfterSeconds: 0, failureRetryable: false,
          updatedAt: "2026-07-29T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    });

    expect(status.kind).toBe("blocked");
    expect(status.coverage?.headline).toBe(
      "无法公开发布：当前精确版本的公开分发策略不可用",
    );
    expect(status.coverage?.notice).toBe(
      "可安全应用 1/2 条匹配译文，1 条暂不可安全应用",
    );
  });

  it("完整安全覆盖也不会遮挡分发受限状态", () => {
    const catalog = {
      pluginId: "generic", pluginName: "Generic", pluginVersion: "1.0.0",
      sourceLocale: "en", digest: exactIdentity.digest,
      artifactDigest: exactIdentity.artifactDigest,
      catalogIdentity: exactIdentity, scannedAt: "2026-07-29T00:00:00Z",
      strings: [{ key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "" }],
    };
    const status = describePluginLocalizationStatus({
      catalog,
      translation: {
        pluginId: "generic", pluginVersion: "1.0.0", sourceVersionId: "source",
        artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
        targetLocale: "zh-CN",
        entries: [{ pluginId: "generic", source: "Settings", target: "设置" }],
        pulledAt: "2026-07-29T00:00:00Z",
      },
      submission: {
        ...baseSubmission,
        pluginId: "generic",
        pluginVersion: "1.0.0",
        catalogDigest: exactIdentity.digest,
        sourceVersionId: "source",
        localizationDemandStatus: {
          state: "distribution_blocked", sourceVersionId: "source", targetLocale: "zh-CN",
          targetVariant: "default", totalUnitCount: 1, workItemCount: 1,
          nativeUnitCount: 0, queuedCount: 0, runningCount: 0, succeededCount: 1,
          failedCount: 0, reviewedUnitCount: 0, publishedUnitCount: 0,
          retryAfterSeconds: 0, failureCode: "PublicDistributionLicenseUnsupported",
          failureRetryable: false, updatedAt: "2026-07-29T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    });

    expect(status.kind).toBe("blocked");
    expect(status.coverage?.complete).toBe(true);
    expect(status.coverage?.headline).toBe(
      "无法公开发布：上游许可证不在当前安全分发范围",
    );
    expect(status.coverage?.notice).toBe("可安全应用 1/1 条匹配译文");
  });

  it("新权威来源完整覆盖时不沿用旧来源的分发阻断", () => {
    const status = describePluginLocalizationStatus({
      translation: {
        pluginId: "generic", pluginVersion: "2.0.0", sourceVersionId: "new-source",
        targetLocale: "zh-CN",
        entries: [{ pluginId: "generic", source: "Settings", target: "设置" }],
        pulledAt: "2026-07-30T00:00:00Z",
      },
      submission: {
        ...baseSubmission,
        localizationDemandStatus: {
          state: "distribution_blocked", sourceVersionId: "old-source", targetLocale: "zh-CN",
          targetVariant: "default", totalUnitCount: 1, workItemCount: 1,
          nativeUnitCount: 0, queuedCount: 0, runningCount: 0, succeededCount: 1,
          failedCount: 0, reviewedUnitCount: 0, publishedUnitCount: 0,
          retryAfterSeconds: 0, failureCode: "PublicDistributionLicenseUnsupported",
          failureRetryable: false, updatedAt: "2026-07-29T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    });

    expect(status.kind).toBe("waiting");
    expect(status.label).toBe("已获取 1 条缓存译文，等待当前目录匹配");
  });

  it("提交记录已指向新权威来源时不显示旧译文缓存的分发阻断", () => {
    const status = describePluginLocalizationStatus({
      translation: {
        pluginId: "generic", pluginVersion: "2.0.0", sourceVersionId: "old-source",
        targetLocale: "zh-CN",
        entries: [{ pluginId: "generic", source: "Settings", target: "设置" }],
        pulledAt: "2026-07-30T00:00:00Z",
      },
      submission: {
        ...baseSubmission,
        sourceVersionId: "current-source",
        localizationDemandStatus: {
          state: "distribution_blocked", sourceVersionId: "old-source", targetLocale: "zh-CN",
          targetVariant: "default", totalUnitCount: 1, workItemCount: 1,
          nativeUnitCount: 0, queuedCount: 0, runningCount: 0, succeededCount: 1,
          failedCount: 0, reviewedUnitCount: 0, publishedUnitCount: 0,
          retryAfterSeconds: 0, failureCode: "PublicDistributionPolicyAmbiguous",
          failureRetryable: false, updatedAt: "2026-07-29T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    });

    expect(status).toEqual({ kind: "waiting", label: "已获取 1 条缓存译文，等待当前目录匹配" });
  });

  it("没有本地目录时仍显示当前来源的分发阻断", () => {
    const status = describePluginLocalizationStatus({
      translation: {
        pluginId: "generic", pluginVersion: "1.0.0", sourceVersionId: "source",
        targetLocale: "zh-CN",
        entries: [{ pluginId: "generic", source: "Settings", target: "设置" }],
        pulledAt: "2026-07-30T00:00:00Z",
      },
      submission: {
        ...baseSubmission,
        localizationDemandStatus: {
          state: "distribution_blocked", sourceVersionId: "source", targetLocale: "zh-CN",
          targetVariant: "default", totalUnitCount: 1, workItemCount: 1,
          nativeUnitCount: 0, queuedCount: 0, runningCount: 0, succeededCount: 1,
          failedCount: 0, reviewedUnitCount: 0, publishedUnitCount: 0,
          retryAfterSeconds: 0, failureCode: "PublicDistributionLicenseUnsupported",
          failureRetryable: false, updatedAt: "2026-07-29T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    });

    expect(status).toEqual({
      kind: "blocked",
      label: "无法公开发布：上游许可证不在当前安全分发范围",
    });
  });

  it.each([
    ["PublicDistributionPolicyPending", "暂无法公开发布：许可证证据已确认，服务端正在生成公开分发策略"],
    ["PublicDistributionLicenseUnsupported", "无法公开发布：上游许可证不在当前安全分发范围"],
    ["PublicDistributionLicenseRedistributionProhibited", "无法公开发布：当前来源的许可证明确禁止公开分发"],
    ["PublicDistributionLicenseReviewRequired", "暂无法公开发布：当前来源的许可证需要人工确认"],
    ["PublicDistributionLicenseEvidenceAmbiguous", "无法公开发布：当前来源的许可证证据存在冲突，服务器无法唯一确认许可证"],
    ["PublicDistributionPolicyAmbiguous", "无法公开发布：当前精确版本存在冲突的公开分发策略"],
    ["PublicSourceVersionYanked", "无法公开发布：当前来源版本已下架"],
    ["PublicDistributionSourceDrift", "暂无法公开发布：当前来源与权威来源不一致，需重新收录精确来源版本"],
    ["PublicDistributionSourceUnsupported", "无法公开发布：当前来源未通过权威来源校验"],
    ["PublicDistributionManualDeny", "无法公开发布：管理员已关闭当前精确版本的公开分发"],
    ["PublicDistributionAuthorizationDenied", "无法公开发布：服务器无权为当前来源建立公开分发策略"],
    ["PublicDistributionAuthorityInvalid", "无法公开发布：当前来源的权威证据无效"],
    ["PublicDistributionAuthorityRetryExhausted", "无法公开发布：权威来源校验多次失败，服务器已停止自动重试"],
    ["PublicDistributionPolicyUnavailable", "无法公开发布：当前精确版本的公开分发策略不可用"],
  ])("将 %s 映射为精确的分发受限原因", (failureCode, label) => {
    expect(describePluginLocalizationStatus({
      submission: {
        ...baseSubmission,
        localizationDemandStatus: {
          state: "distribution_blocked",
          sourceVersionId: "blocked-source",
          targetLocale: "zh-CN",
          targetVariant: "default",
          totalUnitCount: 2,
          workItemCount: 2,
          nativeUnitCount: 0,
          queuedCount: 0,
          runningCount: 0,
          succeededCount: 2,
          failedCount: 0,
          reviewedUnitCount: 0,
          publishedUnitCount: 0,
          retryAfterSeconds: 0,
          failureCode,
          failureRetryable: false,
          updatedAt: "2026-07-29T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    })).toEqual({ kind: "blocked", label });
  });

  it("权威来源仍在校验时显示服务端真实进度", () => {
    expect(describePluginLocalizationStatus({
      submission: {
        ...baseSubmission,
        localizationDemandStatus: {
          state: "reconciled",
          sourceVersionId: "source",
          targetLocale: "zh-CN",
          targetVariant: "default",
          totalUnitCount: 2,
          workItemCount: 2,
          nativeUnitCount: 0,
          queuedCount: 0,
          runningCount: 0,
          succeededCount: 0,
          failedCount: 0,
          reviewedUnitCount: 0,
          publishedUnitCount: 0,
          retryAfterSeconds: 15,
          failureCode: "PublicDistributionAuthorityRefreshing",
          failureRetryable: true,
          updatedAt: "2026-07-30T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "waiting",
      label: "服务器正在校验当前精确版本的权威来源与许可证",
    });
  });

  it.each([false, true])("已有缓存译文时仍优先显示权威校验进度（目录漂移=%s）", (drift) => {
    const catalog = {
      pluginId: "dataview",
      pluginName: "Dataview",
      pluginVersion: "0.5.68",
      sourceLocale: "en",
      digest: drift ? "new-catalog" : exactIdentity.digest,
      artifactDigest: exactIdentity.artifactDigest,
      catalogIdentity: drift
        ? { ...exactIdentity, digest: "12".repeat(32) }
        : exactIdentity,
      scannedAt: "2026-07-30T00:00:00Z",
      strings: [
        { key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "" },
        { key: "two", source: drift ? "New command" : "Command", origins: ["ui-call" as const], placeholderSignature: "" },
      ],
    };
    const status = describePluginLocalizationStatus({
      catalog,
      translation: {
        pluginId: "dataview",
        pluginVersion: "0.5.68",
        sourceVersionId: "source",
        artifactDigest: exactIdentity.artifactDigest,
        catalogIdentity: exactIdentity,
        targetLocale: "zh-CN",
        entries: [
          { pluginId: "dataview", source: "Settings", target: "设置" },
          { pluginId: "dataview", source: "Command", target: "命令" },
        ],
        pulledAt: "2026-07-30T00:00:00Z",
      },
      submission: {
        ...baseSubmission,
        catalogDigest: catalog.digest,
        localizationDemandStatus: {
          state: "reconciled",
          sourceVersionId: "source",
          targetLocale: "zh-CN",
          targetVariant: "default",
          totalUnitCount: 2,
          workItemCount: 2,
          nativeUnitCount: 0,
          queuedCount: 0,
          runningCount: 0,
          succeededCount: 2,
          failedCount: 0,
          reviewedUnitCount: 0,
          publishedUnitCount: 0,
          retryAfterSeconds: 15,
          failureCode: "PublicDistributionAuthorityRefreshing",
          failureRetryable: true,
          updatedAt: "2026-07-30T00:00:00Z",
        },
      },
      targetLocale: "zh-CN",
    });

    expect(status.kind).toBe("waiting");
    expect(status.coverage?.headline).toBe("服务器正在校验当前精确版本的权威来源与许可证");
    expect(status.coverage?.notice).toBe(
      drift
        ? "可安全应用 1/2 条匹配译文，1 条暂不可安全应用"
        : "可安全应用 2/2 条匹配译文",
    );
  });

  it("当前目录重建失败时不被旧译文的目录差异状态遮挡", () => {
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.69",
      sourceLocale: "en", digest: "current", artifactDigest: "artifact",
      scannedAt: "2026-07-27T00:00:00Z",
      strings: [{ key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "" }],
    };
    const submission = {
      ...baseSubmission,
      pluginVersion: "0.5.69",
      catalogDigest: "current",
      lastError: {
        code: "catalog_refresh_failed",
        message: "目录观察提交失败",
        updatedAt: "2026-07-27T00:00:00Z",
      },
    };
    const translation = {
      pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "stale-source",
      targetLocale: "zh-CN", entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
      pulledAt: "2026-07-27T00:00:00Z",
    };

    expect(describePluginLocalizationStatus({
      catalog, submission, translation, targetLocale: "zh-CN",
    })).toEqual({
      kind: "failed",
      label: "同步失败：目录观察提交失败。点击右侧“重试此插件”，无需关闭开关。",
    });
    expect(pluginManualRetryKind({
      catalog, submission, translation, targetLocale: "zh-CN",
    })).toBe("resynchronize");
  });

  it("可恢复同步错误优先于旧分发阻断和目录差异", () => {
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.69",
      sourceLocale: "en", digest: "new-catalog", artifactDigest: "new-artifact",
      scannedAt: "2026-08-02T00:00:00Z",
      strings: [{ key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "" }],
    };
    const submission = {
      ...baseSubmission,
      pluginVersion: "0.5.68", catalogDigest: "old-catalog", sourceVersionId: "old-source",
      localizationTargetLocale: "zh-CN",
      localizationDemandStatus: {
        state: "distribution_blocked" as const,
        sourceVersionId: "old-source", targetLocale: "zh-CN", targetVariant: "default",
        totalUnitCount: 1, workItemCount: 1, nativeUnitCount: 0, queuedCount: 0,
        runningCount: 0, succeededCount: 0, failedCount: 0, reviewedUnitCount: 0,
        publishedUnitCount: 0, retryAfterSeconds: 0,
        failureCode: "PublicDistributionLicenseEvidenceMissing", failureRetryable: false,
        updatedAt: "2026-08-02T00:00:00Z",
      },
      lastError: {
        code: "PC_RETRY_EXHAUSTED", message: "目录刷新暂时失败",
        targetLocale: "zh-CN", updatedAt: "2026-08-02T00:01:00Z",
      },
    } as const;
    const translation = {
      pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "old-source",
      targetLocale: "zh-CN", entries: [], pulledAt: "2026-08-02T00:00:00Z",
    };
    const input = { catalog, submission, translation, targetLocale: "zh-CN" } as const;

    expect(pluginManualRetryKind(input)).toBe("resynchronize");
    expect(describePluginLocalizationStatus(input)).toEqual({
      kind: "failed",
      label: "同步失败：目录刷新暂时失败。点击右侧“重试此插件”，无需关闭开关。",
    });
  });

  it("行可见重试判定统一投影 locale、来源资格和会话", () => {
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
      sourceLocale: "en", digest: "catalog", artifactDigest: "artifact",
      scannedAt: "2026-08-02T00:00:00Z", strings: [],
    };
    const state = {
      ...EMPTY_PLUGIN_STATE,
      pluginCatalogs: { dataview: catalog },
      pluginSubmissions: {
        dataview: {
          ...baseSubmission,
          localizationTargetLocale: "zh-CN",
          lastError: {
            code: "PC_RETRY_EXHAUSTED", message: "temporary",
            targetLocale: "zh-CN", updatedAt: "2026-08-02T00:00:00Z",
          },
        },
      },
    } as const;
    const visible = {
      state, pluginId: "dataview", targetLocale: "zh-CN" as const,
      sourceSelectable: true, hasSession: true,
    };

    expect(visiblePluginManualRetryKind(visible)).toBe("resynchronize");
    expect(visiblePluginManualRetryKind({ ...visible, targetLocale: "ja" })).toBeNull();
    expect(visiblePluginManualRetryKind({ ...visible, sourceSelectable: false })).toBeNull();
    expect(visiblePluginManualRetryKind({ ...visible, hasSession: false })).toBeNull();
  });

  it("精确制品不一致时明确暂停同步而非提示首次收录等待", () => {
    const catalog = {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.69",
      sourceLocale: "en", digest: "current", artifactDigest: "artifact",
      scannedAt: "2026-08-01T00:00:00Z", strings: [],
    };
    const submission = {
      ...baseSubmission,
      pluginVersion: "0.5.69",
      catalogDigest: "current",
      lastError: {
        code: "source_artifact_mismatch",
        message: "本地安装与权威目录的精确制品不一致，已暂停同步。",
        updatedAt: "2026-08-01T00:00:00Z",
      },
    };

    expect(describePluginLocalizationStatus({
      catalog, submission, targetLocale: "zh-CN",
    })).toEqual({
      kind: "catalog-mismatch",
      label: "本地安装与权威目录的精确制品不一致，已暂停同步",
    });
    // 贡献未被拒绝时（正常暂停）不提供重试按钮。
    expect(pluginManualRetryKind({
      catalog, submission, targetLocale: "zh-CN",
    })).toBeNull();
    // 服务端权威摘要可能因规范化变更而陈旧（R-019 follow-up）：本地制品
    // 与官方 release 一致但被暂停时，贡献已拒绝状态下必须提供手动重试，
    // 以便提交新观察触发服务端一次性权威恢复（重新获取并核对摘要）。
    expect(pluginManualRetryKind({
      catalog,
      submission: { ...submission, contributionState: "rejected" },
      targetLocale: "zh-CN",
    })).toBe("resubmit");
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
      kind: "waiting",
      label: "已获取 4 条缓存译文，等待当前目录匹配；插件自带 1 · 语枢已校对 1 · 语枢校对修正 1 · 语枢机翻 1（未经人工校对）",
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

    expect(status.label).toContain("已获取 1/2 条匹配译文（50%），1 条尚未发布");
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
      label: "已获取 1/2 条匹配译文（50%），1 条尚未发布；插件界面 1/2",
      coverage: {
        headline: "已获取 1/2 条匹配译文（50%），1 条尚未发布",
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
      label: "已获取 1/2 条匹配译文（50%），1 条尚未发布；插件界面 1/2",
      coverage: {
        headline: "已获取 1/2 条匹配译文（50%），1 条尚未发布",
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
      label: "已准备 1/2 条匹配译文（50%），1 条等待发布；插件界面 1/2",
      coverage: {
        headline: "已准备 1/2 条匹配译文（50%），1 条等待发布",
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
      label: "已获取 2/2 条匹配译文（100%）；插件自带 2 条（范围明细待同步）",
      coverage: {
        headline: "已获取 2/2 条匹配译文（100%）",
        complete: true,
        scopeMetrics: ["插件自带 2 条（范围明细待同步）"],
        sourceMetrics: [],
      },
    });
  });

  it("制品相同但目录身份不同时采用权威目录并只报告安全交集", () => {
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
    })).toMatchObject({
      kind: "localized",
      coverage: {
        headline: "可安全应用 1/2 条匹配译文，1 条暂不可安全应用",
        complete: false,
      },
    });
  });

  it("官方目录缺项的同一制品不再退化为仅显示本地两条元数据", () => {
    expect(describePluginLocalizationStatus({
      catalog: {
        pluginId: "notebook-navigator", pluginName: "Notebook Navigator", pluginVersion: "3.2.4",
        sourceLocale: "en", digest: "11".repeat(32), artifactDigest: "aa".repeat(32),
        catalogIdentity: {
          protocol: "trans-hub.source-catalog-identity", revision: 2,
          resourceKey: "notebook-navigator", resourceVersion: "3.2.4", sourceLocale: "en",
          artifactDigest: "aa".repeat(32), unitCount: 2, digest: "11".repeat(32),
          scopes: [{ scope: "metadata", unitCount: 2, digest: "22".repeat(32) }],
        },
        scannedAt: "2026-07-29T00:00:00Z",
        strings: [
          { key: "name", source: "Notebook Navigator", origins: ["manifest.name"], placeholderSignature: "" },
          { key: "description", source: "Replace the default file explorer", origins: ["manifest.description"], placeholderSignature: "" },
        ],
      },
      translation: {
        pluginId: "notebook-navigator", pluginVersion: "3.2.4", sourceVersionId: "source",
        artifactDigest: "aa".repeat(32), targetLocale: "zh-CN",
        sourceUnitCount: 1683, upstreamNativeCount: 1350, upstreamScopedNativeCount: 1350,
        upstreamScopeCoverage: { "runtime-ui": 1350 },
        catalogIdentity: {
          protocol: "trans-hub.source-catalog-identity", revision: 2,
          resourceKey: "notebook-navigator", resourceVersion: "3.2.4", sourceLocale: "en",
          artifactDigest: "aa".repeat(32), unitCount: 1683, digest: "33".repeat(32),
          scopes: [
            { scope: "metadata", unitCount: 2, digest: "44".repeat(32) },
            { scope: "readme", unitCount: 290, digest: "55".repeat(32) },
            { scope: "runtime-ui", unitCount: 1402, digest: "66".repeat(32) },
          ],
        },
        entries: [], pulledAt: "2026-07-29T00:00:00Z",
      },
      targetLocale: "zh-CN",
    })).toMatchObject({
      kind: "localized",
      coverage: {
        headline: "可安全应用 1350/1683 条匹配译文，333 条暂不可安全应用",
        complete: false,
        scopeMetrics: ["插件界面 1350/1402", "名称与说明 0/2", "README 0/290"],
        sourceMetrics: [{ label: "插件自带 1350", tone: "native" }],
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
      kind: "waiting",
      label: "已获取 1 条缓存译文，等待当前目录匹配；语枢已校对 1",
    });
  });
});
