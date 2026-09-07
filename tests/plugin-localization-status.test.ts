import { describe, expect, it } from "vitest";

import {
  describePluginLocalizationStatus,
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

  it("将公共目录发现的等待与阻断状态明确呈现", () => {
    const baseDiscovery = {
      discoveryId: "019f0000-0000-7000-8000-000000000001",
      targetLocales: ["zh-CN"] as const,
      classification: "pending_registry_verification",
      taskState: "verifying_registry",
      installationId: "019f0000-0000-7000-8000-000000000002",
      submittedAt: "2026-08-01T00:00:00Z",
      catalogIdentityDigest: exactIdentity.digest,
    };
    expect(describePluginLocalizationStatus({
      publicDiscovery: baseDiscovery,
      targetLocale: "zh-CN",
    })).toEqual({ kind: "waiting", label: "正在验证公共目录条目…" });
    const retryableBlock = {
      ...baseDiscovery,
      statusRevision: 2 as const,
      classification: "blocked",
      taskState: "blocked",
      retryAllowed: true,
      retryAfterSeconds: 0,
      blockedReasonCode: "registry_projection_stale",
    };
    expect(describePluginLocalizationStatus({
      publicDiscovery: retryableBlock,
      targetLocale: "zh-CN",
    })).toEqual({ kind: "failed", label: "目录条目暂无法处理。点击右侧“重试此插件”。" });
    expect(visiblePluginManualRetryKind({
      state: {
        ...EMPTY_PLUGIN_STATE,
        publicPluginDiscoveries: {
          dataview: retryableBlock,
        },
      },
      pluginId: "dataview",
      targetLocale: "zh-CN",
      sourceSelectable: true,
      hasSession: true,
    })).toBe("resubmit");

  });

  it("本地化投影阻断但发现 lifecycle 仍在途时不允许重提", () => {
    expect(visiblePluginManualRetryKind({
      state: {
        ...EMPTY_PLUGIN_STATE,
        publicPluginDiscoveries: {
          dataview: {
            discoveryId: "019f0000-0000-7000-8000-000000000001",
            targetLocales: ["zh-CN"],
            classification: "eligible_for_processing",
            taskState: "queued_for_parsing",
            installationId: "019f0000-0000-7000-8000-000000000002",
            submittedAt: "2026-08-01T00:00:00Z",
            localizationProjection: {
              kind: "public_localization_status_projection",
              protocol: { protocol: "trans-hub.client-protocol", revision: 1, schemaRevision: 1 },
              projectionRevision: 1,
              discoveryId: "019f0000-0000-7000-8000-000000000001",
              registryKey: "official-directory",
              externalObjectId: "dataview",
              targetLocale: "zh-CN" as never,
              catalogIdentityDigest: null,
              sourceVersionId: null,
              stage: "blocked",
              updatedAt: "2026-08-01T00:01:00Z",
            },
          },
        },
      },
      pluginId: "dataview",
      targetLocale: "zh-CN",
      sourceSelectable: true,
      hasSession: true,
    })).toBeNull();

  });

  it("已验证但未形成发布投影的目录发现继续等待且不允许重提", () => {
    const discovery = {
      discoveryId: "019f0000-0000-7000-8000-000000000001",
      targetLocales: ["zh-CN"] as const,
      classification: "eligible_for_processing",
      taskState: "result_verified",
      installationId: "019f0000-0000-7000-8000-000000000002",
      submittedAt: "2026-08-01T00:00:00Z",
    };
    expect(describePluginLocalizationStatus({
      publicDiscovery: discovery,
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "waiting",
      label: "服务端已验证当前来源，正在建立本地化发布状态。",
    });
    expect(visiblePluginManualRetryKind({
      state: {
        ...EMPTY_PLUGIN_STATE,
        publicPluginDiscoveries: { dataview: discovery },
      },
      pluginId: "dataview",
      targetLocale: "zh-CN",
      sourceSelectable: true,
      hasSession: true,
    })).toBeNull();

    const parsingDiscovery = {
      ...discovery,
      localizationProjection: { stage: "parsing" } as never,
    };
    expect(describePluginLocalizationStatus({
      publicDiscovery: parsingDiscovery,
      targetLocale: "zh-CN",
    })).toEqual({
      kind: "waiting",
      label: "服务端已验证当前来源，正在建立本地化发布状态。",
    });
    expect(visiblePluginManualRetryKind({
      state: {
        ...EMPTY_PLUGIN_STATE,
        publicPluginDiscoveries: { dataview: parsingDiscovery },
      },
      pluginId: "dataview",
      targetLocale: "zh-CN",
      sourceSelectable: true,
      hasSession: true,
    })).toBeNull();
  });

  it.each([
    { retryAllowed: false, retryAfterSeconds: 0, reason: "registry_projection_stale" },
    { retryAllowed: true, retryAfterSeconds: 30, reason: "registry_projection_stale" },
    { retryAllowed: true, retryAfterSeconds: 0, reason: "executor_retry_exhausted" },
  ] as const)("只允许服务端明确可恢复的阻断重提：$reason", (contract) => {
    const discovery = {
      discoveryId: "019f0000-0000-7000-8000-000000000001",
      receiptId: "019f0000-0000-7000-8000-000000000003",
      statusRevision: 2 as const,
      targetLocales: ["zh-CN"] as const,
      classification: "blocked",
      taskState: "blocked",
      installationId: "019f0000-0000-7000-8000-000000000002",
      submittedAt: "2026-08-01T00:00:00Z",
      blockedReasonCode: contract.reason,
      retryAllowed: contract.retryAllowed,
      retryAfterSeconds: contract.retryAfterSeconds,
    };
    expect(visiblePluginManualRetryKind({
      state: {
        ...EMPTY_PLUGIN_STATE,
        publicPluginDiscoveries: { dataview: discovery },
      },
      pluginId: "dataview",
      targetLocale: "zh-CN",
      sourceSelectable: true,
      hasSession: true,
    })).toBeNull();
  });

  it.each([
    "discovered",
    "verifying_registry",
    "materialization_pending",
    "result_verified",
    "queued_for_parsing",
  ])("发现阶段 %s 在途时禁止人工重提", (taskState) => {
    expect(visiblePluginManualRetryKind({
      state: {
        ...EMPTY_PLUGIN_STATE,
        publicPluginDiscoveries: {
          dataview: {
            statusRevision: 2,
            receiptId: "019f0000-0000-7000-8000-000000000003",
            discoveryId: "019f0000-0000-7000-8000-000000000001",
            targetLocales: ["zh-CN"],
            classification: "eligible_for_processing",
            taskState,
            retryAllowed: false,
            retryAfterSeconds: 0,
            installationId: "019f0000-0000-7000-8000-000000000002",
            submittedAt: "2026-08-01T00:00:00Z",
          },
        },
      } as never,
      pluginId: "dataview",
      targetLocale: "zh-CN",
      sourceSelectable: true,
      hasSession: true,
    })).toBeNull();
  });

  it("发现虽可恢复但当前本地化投影健康在途时禁止重提", () => {
    expect(visiblePluginManualRetryKind({
      state: {
        ...EMPTY_PLUGIN_STATE,
        publicPluginDiscoveries: {
          dataview: {
            statusRevision: 2,
            receiptId: "019f0000-0000-7000-8000-000000000003",
            discoveryId: "019f0000-0000-7000-8000-000000000001",
            targetLocales: ["zh-CN"],
            classification: "blocked",
            taskState: "blocked",
            retryAllowed: true,
            retryAfterSeconds: 0,
            blockedReasonCode: "registry_projection_stale",
            installationId: "019f0000-0000-7000-8000-000000000002",
            submittedAt: "2026-08-01T00:00:00Z",
            localizationProjection: {
              targetLocale: "zh-CN",
              stage: "parsing",
            } as never,
          },
        },
      },
      pluginId: "dataview",
      targetLocale: "zh-CN",
      sourceSelectable: true,
      hasSession: true,
    })).toBeNull();
  });

  it("does not let an in-flight public discovery hide an exact published translation", () => {
    const discovery = {
      discoveryId: "019f0000-0000-7000-8000-000000000001",
      targetLocales: ["zh-CN"] as const,
      classification: "eligible_for_processing" as const,
      taskState: "queued_for_parsing" as const,
      installationId: "019f0000-0000-7000-8000-000000000002",
      submittedAt: "2026-08-01T00:00:00Z",
    };
    const status = describePluginLocalizationStatus({
      publicDiscovery: discovery,
      submission: {
        ...baseSubmission,
        catalogDigest: exactIdentity.digest,
        sourceVersionId: "current-source",
      },
      catalog: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
        sourceLocale: "en", digest: exactIdentity.digest,
        artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
        scannedAt: "2026-08-01T00:00:00Z",
        strings: [{ key: "one", source: "Settings", origins: ["ui-call"], placeholderSignature: "" }],
      },
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "current-source",
        artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
        targetLocale: "zh-CN",
        entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
        pulledAt: "2026-08-01T00:00:00Z",
      },
      targetLocale: "zh-CN",
    });

    expect(status.kind).toBe("localized");
    expect(status.label).not.toBe("正在验证公共目录条目…");
  });

  it("does not let a public discovery hide a safely applied published intersection", () => {
    const localIdentity = {
      ...exactIdentity,
      unitCount: 2,
      digest: "c".repeat(64),
      scopes: [{ scope: "runtime-ui", unitCount: 2, digest: "d".repeat(64) }],
    };
    const authorityIdentity = {
      ...exactIdentity,
      artifactDigest: "e".repeat(64),
      unitCount: 1,
      digest: "f".repeat(64),
      scopes: [{ scope: "runtime-ui", unitCount: 1, digest: "1".repeat(64) }],
    };
    const status = describePluginLocalizationStatus({
      submission: {
        ...baseSubmission,
        catalogDigest: localIdentity.digest,
        contributionState: "rejected",
      },
      publicDiscovery: {
        discoveryId: "019f0000-0000-7000-8000-000000000001",
        targetLocales: ["zh-CN"],
        classification: "eligible_for_processing",
        taskState: "queued_for_parsing",
        installationId: "019f0000-0000-7000-8000-000000000002",
        submittedAt: "2026-08-01T00:00:00Z",
      },
      catalog: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
        sourceLocale: "en", digest: localIdentity.digest,
        artifactDigest: localIdentity.artifactDigest, catalogIdentity: localIdentity,
        scannedAt: "2026-08-01T00:00:00Z",
        strings: [
          { key: "one", source: "Settings", origins: ["ui-call"], placeholderSignature: "" },
          { key: "two", source: "Extra", origins: ["ui-call"], placeholderSignature: "" },
        ],
      },
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "current-source",
        artifactDigest: authorityIdentity.artifactDigest, catalogIdentity: authorityIdentity,
        targetLocale: "zh-CN", sourceUnitCount: 1, upstreamNativeCount: 0,
        publishedUnitCount: 1, missingUnitCount: 0,
        entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
        pulledAt: "2026-08-01T00:00:00Z",
      },
      targetLocale: "zh-CN",
    });

    expect(status.kind).toBe("localized");
    expect(status.label).toContain("已获取 1/2 条匹配界面译文");
    expect(status.label).not.toBe("正在验证公共目录条目…");
  });

  it.each([
    ["discovery", "waiting", "已提交公共目录发现，等待服务端处理"],
    ["validating", "waiting", "正在校验公共目录与当前权威版本"],
    ["parsing", "waiting", "当前权威版本正在解析并建立来源目录"],
    ["translating", "waiting", "当前权威版本正在翻译"],
    ["publishing", "waiting", "译文正在生成可下载发布版本"],
    ["published", "waiting", "译文已发布，等待客户端下载"],
    ["blocked", "blocked", "当前权威版本暂无法公开发布"],
  ] as const)("renders the current %s projection without a legacy submission", (
    stage, expectedKind, expectedLabel,
  ) => {
    const withAuthority = ["translating", "publishing", "published", "blocked"].includes(stage);
    const publicDiscovery = {
      discoveryId: "019f0000-0000-7000-8000-000000000001",
      targetLocales: ["zh-CN"] as const,
      classification: "eligible_for_processing",
      taskState: "queued_for_parsing",
      installationId: "019f0000-0000-7000-8000-000000000002",
      submittedAt: "2026-08-01T00:00:00Z",
      catalogIdentityDigest: exactIdentity.digest,
      localizationProjection: {
        kind: "public_localization_status_projection" as const,
        protocol: {
          protocol: "trans-hub.client-protocol" as const,
          revision: 1 as const,
          schemaRevision: 1 as const,
        },
        projectionRevision: 1 as const,
        discoveryId: "019f0000-0000-7000-8000-000000000001",
        registryKey: "official-directory",
        externalObjectId: "dataview",
        targetLocale: "zh-CN",
        catalogIdentityDigest: withAuthority ? {
          algorithm: "sha256" as const,
          domain: "logical_object" as const,
          hex: exactIdentity.digest,
        } : null,
        sourceVersionId: withAuthority
          ? "019f0000-0000-7000-8000-000000000003"
          : null,
        stage,
        updatedAt: "2026-08-26T00:00:00.000Z",
      },
    };
    expect(describePluginLocalizationStatus({
      publicDiscovery: publicDiscovery as never,
      catalog: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
        sourceLocale: "en", digest: exactIdentity.digest,
        artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
        scannedAt: "2026-08-01T00:00:00Z", strings: [],
      },
      targetLocale: "zh-CN",
    })).toEqual({ kind: expectedKind, label: expectedLabel });
  });

  it("does not let a historical discovery projection shadow the current catalog", () => {
    expect(describePluginLocalizationStatus({
      publicDiscovery: {
        discoveryId: "019f0000-0000-7000-8000-000000000001",
        targetLocales: ["zh-CN"], classification: "eligible_for_processing",
        taskState: "queued_for_parsing",
        installationId: "019f0000-0000-7000-8000-000000000002",
        submittedAt: "2026-07-01T00:00:00.000Z",
        catalogIdentityDigest: "b".repeat(64),
        localizationProjection: {
          kind: "public_localization_status_projection",
          protocol: {
            protocol: "trans-hub.client-protocol", revision: 1, schemaRevision: 1,
          },
          projectionRevision: 1,
          discoveryId: "019f0000-0000-7000-8000-000000000001",
          registryKey: "official-directory", externalObjectId: "dataview",
          targetLocale: "zh-CN", catalogIdentityDigest: null,
          sourceVersionId: null, stage: "blocked",
          updatedAt: "2026-07-01T00:01:00.000Z",
        },
      } as never,
      catalog: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
        sourceLocale: "en", digest: exactIdentity.digest,
        artifactDigest: exactIdentity.artifactDigest, catalogIdentity: exactIdentity,
        scannedAt: "2026-08-01T00:00:00.000Z", strings: [],
      },
      targetLocale: "zh-CN",
    })).toEqual({ kind: "waiting", label: "正在验证公共目录条目…" });
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
        pluginId: "dataview", pluginVersion: "0.5.69", authorityPluginVersion: "0.5.70",
        sourceVersionId: "source", targetLocale: "zh-CN",
        entries: [{
          pluginId: "dataview", source: "Settings", target: "设置",
          sourceCompatibility: {
            semanticRole: "runtime-ui", contentScopes: ["runtime-ui"],
            placeholderSignature: "", formatSignature: "plain-text-v1",
            sourceContentDigest: `sha256:${"a".repeat(64)}`,
          },
        }],
        pulledAt: "2026-07-18T00:00:00Z",
      },
      targetLocale: "zh-CN",
    })).toMatchObject({
      kind: "localized",
      coverage: {
        headline: "已获取 1/2 条匹配界面译文，1 条保留原文；当前使用 0.5.70 的本地化译文；插件可继续使用，建议升级至 0.5.70 以获得最佳匹配",
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
        pluginId: "dataview", pluginVersion: "0.5.69", authorityPluginVersion: "0.5.70",
        sourceVersionId: "source",
        targetLocale: "zh-CN", sourceUnitCount: 79, upstreamNativeCount: 12,
        publishedUnitCount: 64, missingUnitCount: 3,
        entries: [{
          pluginId: "dataview", source: "Settings", target: "设置",
          sourceCompatibility: {
            semanticRole: "runtime-ui", contentScopes: ["runtime-ui"],
            placeholderSignature: "", formatSignature: "plain-text-v1",
            sourceContentDigest: `sha256:${"a".repeat(64)}`,
          },
        }],
        pulledAt: "2026-07-18T00:00:00Z",
      },
      targetLocale: "zh-CN",
    })).toMatchObject({
      kind: "localized",
      coverage: {
        headline: "已获取 1/1 条匹配界面译文；当前使用 0.5.70 的本地化译文；插件可继续使用，建议升级至 0.5.70 以获得最佳匹配",
        complete: true,
      },
    });
  });

  it("精确安装版本应用当前译文时不显示版本一致性建议", () => {
    const status = describePluginLocalizationStatus({
      catalog: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.70",
        sourceLocale: "en", digest: "exact", artifactDigest: "artifact",
        scannedAt: "2026-09-05T00:00:00Z",
        strings: [{ key: "one", source: "Settings", origins: ["ui-call"], placeholderSignature: "" }],
      },
      translation: {
        pluginId: "dataview", pluginVersion: "0.5.70", authorityPluginVersion: "0.5.70",
        sourceVersionId: "source", targetLocale: "zh-CN",
        entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
        pulledAt: "2026-09-05T00:00:00Z",
      },
      targetLocale: "zh-CN",
    });

    expect(status.label).not.toContain("当前本地化版本");
    expect(status.label).toContain("已获取 1/1 条匹配界面译文");
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
    expect(status.coverage?.headline).toBe("已获取 1/2 条匹配界面译文，1 条保留原文");
    expect(status.coverage?.notice).toBeUndefined();
    expect(status.coverage?.complete).toBe(false);
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

  it("来源已拒绝时优先重新提交新观察，而不是重复同步陈旧错误", () => {
    const input = {
      catalog: {
        pluginId: "dataview", pluginName: "Dataview", pluginVersion: "0.5.68",
        sourceLocale: "en", digest: "current-catalog", artifactDigest: "current-artifact",
        scannedAt: "2026-08-02T00:00:00Z",
        strings: [{ key: "one", source: "Settings", origins: ["ui-call" as const], placeholderSignature: "" }],
      },
      submission: {
        ...baseSubmission,
        catalogDigest: "current-catalog",
        contributionState: "rejected" as const,
        lastError: {
          code: "PC_RETRY_EXHAUSTED", message: "旧任务已耗尽重试次数",
          targetLocale: "zh-CN", updatedAt: "2026-08-02T00:01:00Z",
        },
      },
      targetLocale: "zh-CN",
    } as const;

    expect(pluginManualRetryKind(input)).toBe("resubmit");
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
        headline: "已获取 1/2 条匹配界面译文，1 条保留原文",
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
        headline: "已获取 1350/1402 条匹配界面译文，52 条保留原文",
        complete: false,
        scopeMetrics: ["插件界面 1350/1402", "名称与说明 0/2"],
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
