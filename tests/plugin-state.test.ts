import { describe, expect, it } from "vitest";

import {
  getPluginSubmissionForLocale,
  getPluginTranslation,
  isPluginLocalizationDerivedCacheCurrent,
  parsePluginState,
  resetPluginLocalizationDerivedState,
} from "../src/plugin-state";

describe("parsePluginState", () => {
  it("清空退役发现运行态及派生缓存，同时保留本地插件目录", () => {
    expect(isPluginLocalizationDerivedCacheCurrent(undefined)).toBe(false);
    expect(isPluginLocalizationDerivedCacheCurrent(1)).toBe(false);
    expect(isPluginLocalizationDerivedCacheCurrent(2)).toBe(true);
    expect(isPluginLocalizationDerivedCacheCurrent(3)).toBe(true);
    const reset = resetPluginLocalizationDerivedState(parsePluginState({
      enabledPluginIds: ["dataview"],
      notes: { note: { noteId: "note" } },
      pendingSubmissions: { pending: { clientSubmissionId: "pending" } },
      generatedTargets: { target: { path: "target" } },
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview", pluginName: "Dataview", pluginVersion: "1",
          sourceLocale: "en", digest: "catalog", artifactDigest: "a".repeat(64),
          scannedAt: "2026-07-31T00:00:00.000Z", strings: [],
        },
      },
      pluginSubmissions: { dataview: { pluginId: "dataview" } },
      pluginTranslations: { dataview: {} },
      translationExportStates: { export: { etag: '"old"' } },
    }));

    expect(reset.enabledPluginIds).toEqual(["dataview"]);
    expect(reset.pluginCatalogs).toHaveProperty("dataview");
    expect(reset.notes).toHaveProperty("note");
    expect(reset.pendingSubmissions).toHaveProperty("pending");
    expect(reset.generatedTargets).toHaveProperty("target");
    expect(reset.pluginSubmissions).toEqual({});
    expect(reset.publicPluginDiscoveries).toEqual({});
    expect(reset.pluginTranslations).toEqual({});
    expect(reset.translationExportStates).toEqual({});
  });

  it("不保留退役公共发现回执，且忽略旧本地化需求字段", () => {
    const state = parsePluginState({
      publicPluginDiscoveries: {
        dataview: {
          statusRevision: 2,
          receiptId: "019f0000-0000-7000-8000-000000000003",
          discoveryId: "019f0000-0000-7000-8000-000000000001",
          taskId: "019f0000-0000-7000-8000-000000000004",
          targetLocales: ["ja", "zh-CN", "zh_hant_tw", "ja"],
          classification: "pending_registry_verification",
          taskState: "verifying_registry",
          taskGeneration: 1,
          attemptCount: 0,
          outcome: "created",
          commandDigestHex: "a".repeat(64),
          credentialEpoch: 1,
          receiptRecordedAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          retryAfterSeconds: 0,
          retryAllowed: false,
          retryGeneration: 0,
          installationId: "019f0000-0000-7000-8000-000000000002",
          submittedAt: "2026-08-01T00:00:00.000Z",
          sourceDiscoveryEpoch: 19,
        },
      },
      pluginSubmissions: {
        dataview: {
          pluginId: "dataview", pluginVersion: "0.5.68", catalogDigest: "catalog",
          contributionState: "received", submittedAt: "2026-08-01T00:00:00.000Z",
          localizationContributionId: "legacy-demand",
        },
      },
    });

    expect(state.publicPluginDiscoveries.dataview?.targetLocales).toEqual(["ja", "zh-CN", "zh-Hant-TW"]);
    expect(state.publicPluginDiscoveries.dataview?.sourceDiscoveryEpoch).toBe(19);
    expect(state.pluginSubmissions.dataview).not.toHaveProperty("localizationContributionId");
    expect(resetPluginLocalizationDerivedState(state).publicPluginDiscoveries).toEqual({});
    expect(resetPluginLocalizationDerivedState(state).pluginSubmissions).toEqual({});
  });

  it("fail-safe 丢弃 revision 2 之前的发现状态但保留已发布译文和 ETag", () => {
    const translation = {
      pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
      targetLocale: "zh-CN", pulledAt: "2026-08-01T00:00:00.000Z",
      entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }],
    };
    const state = parsePluginState({
      publicPluginDiscoveries: {
        dataview: {
          discoveryId: "019f0000-0000-7000-8000-000000000001",
          targetLocales: ["zh-CN"], classification: "eligible_for_processing",
          taskState: "queued_for_parsing", installationId: "installation",
          submittedAt: "2026-08-01T00:00:00.000Z",
        },
      },
      pluginTranslations: { dataview: { "zh-CN": translation } },
      translationExportStates: {
        export: {
          etag: '"published"',
          manifest: {
            schema: "trans-hub.translation-export", revision: 1,
            manifestId: "manifest", generationId: "generation", generationNumber: 1,
            sourceStreamId: "stream", sourceVersionId: "source",
            targetLocale: "zh-CN", targetVariant: "default",
            scope: { kind: "public", publicScopeId: "scope" },
            manifestDigest: `sha256:${"a".repeat(64)}`, packs: [],
          },
        },
      },
    });

    expect(state.publicPluginDiscoveries).toEqual({});
    expect(getPluginTranslation(state, "dataview", "zh-CN")?.entries[0]?.target).toBe("设置");
    expect(state.translationExportStates.export?.etag).toBe('"published"');
  });

  it("persists installed and authority versions with cross-version compatibility evidence", () => {
    const state = parsePluginState({
      pluginTranslations: {
        dataview: {
          "zh-CN": {
            pluginId: "dataview", pluginVersion: "0.5.68",
            authorityPluginVersion: "0.5.70", sourceVersionId: "current-source",
            targetLocale: "zh-CN", pulledAt: "2026-09-05T00:00:00.000Z",
            entries: [{
              pluginId: "dataview", source: "Settings", target: "设置",
              sourceCompatibility: {
                semanticRole: "runtime-ui", contentScopes: ["runtime-ui"],
                placeholderSignature: "", formatSignature: "plain-text-v1",
                sourceContentDigest: `sha256:${"f".repeat(64)}`,
              },
            }],
          },
        },
      },
    });

    const translation = getPluginTranslation(state, "dataview", "zh-CN");
    expect(translation?.pluginVersion).toBe("0.5.68");
    expect(translation?.authorityPluginVersion).toBe("0.5.70");
    expect(translation?.entries[0]?.sourceCompatibility?.formatSignature)
      .toBe("plain-text-v1");
  });

  it("preserves valid extraction evidence across plugin reloads", () => {
    const state = parsePluginState({
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview",
          pluginName: "Dataview",
          pluginVersion: "0.5.68",
          sourceLocale: "en",
          digest: "catalog",
          artifactDigest: "artifact",
          scannedAt: "2026-07-18T00:00:00.000Z",
          strings: [{
            key: "row-count",
            source: "Rows: {{th:expr:0}}",
            origins: ["ui-call"],
            placeholderSignature: "{{th:expr:0}}",
            evidence: [{
              origin: "ui-call",
              strategy: "structured",
              symbol: "setDesc",
              offset: 24,
              line: 2,
              column: 8,
            }],
          }],
        },
      },
    });

    expect(state.pluginCatalogs.dataview?.strings[0]?.evidence).toEqual([{
      origin: "ui-call",
      strategy: "structured",
      symbol: "setDesc",
      offset: 24,
      line: 2,
      column: 8,
    }]);
  });

  it("保留扫描目标语言元数据，并兼容缺失该字段的旧目录缓存", () => {
    const state = parsePluginState({
      pluginCatalogs: {
        current: {
          pluginId: "current", pluginName: "Current", pluginVersion: "1.0.0",
          sourceLocale: "en", digest: "current", artifactDigest: "artifact",
          scannerTargetLocale: "ja", scannedAt: "2026-07-18T00:00:00.000Z", strings: [],
        },
        legacy: {
          pluginId: "legacy", pluginName: "Legacy", pluginVersion: "1.0.0",
          sourceLocale: "en", digest: "legacy", artifactDigest: "artifact",
          scannedAt: "2026-07-18T00:00:00.000Z", strings: [],
        },
      },
    });

    expect(state.pluginCatalogs.current?.scannerTargetLocale).toBe("ja");
    expect(state.pluginCatalogs.legacy).toBeDefined();
    expect(state.pluginCatalogs.legacy?.scannerTargetLocale).toBeUndefined();
  });

  it("rejects a catalog with malformed extraction evidence", () => {
    const state = parsePluginState({
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview",
          pluginName: "Dataview",
          pluginVersion: "0.5.68",
          sourceLocale: "en",
          digest: "catalog",
          artifactDigest: "artifact",
          scannedAt: "2026-07-18T00:00:00.000Z",
          strings: [{
            key: "settings",
            source: "Settings",
            origins: ["ui-call"],
            placeholderSignature: "",
            evidence: [{
              origin: "ui-call",
              strategy: "eval",
              symbol: "setName",
              offset: 1,
              line: 1,
              column: 1,
            }],
          }],
        },
      },
    });

    expect(state.pluginCatalogs).toEqual({});
  });

  it("保留官方社区目录元数据证据", () => {
    const state = parsePluginState({
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview",
          pluginName: "Dataview",
          pluginVersion: "0.5.68",
          sourceLocale: "en",
          digest: "catalog",
          artifactDigest: "artifact",
          scannedAt: "2026-07-19T00:00:00.000Z",
          strings: [{
            key: "registry-description",
            source: "Run advanced queries over your vault.",
            origins: ["registry.description"],
            semanticRole: "description",
            placeholderSignature: "",
            evidence: [{
              origin: "registry.description",
              strategy: "registry",
              symbol: "community-plugins.description",
              offset: null,
              line: null,
              column: null,
            }],
          }],
        },
      },
    });

    expect(state.pluginCatalogs.dataview?.strings[0]?.origins)
      .toEqual(["registry.description"]);
  });

  it("在重启后保留译文适用作用域并拒绝未知作用域", () => {
    const base = {
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      sourceVersionId: "source-version",
      targetLocale: "zh-CN",
      pulledAt: "2026-07-23T00:00:00.000Z",
    };
    const valid = parsePluginState({
      pluginTranslations: {
        dataview: {
          "zh-CN": {
            ...base,
            entries: [{
              pluginId: "dataview",
              source: "Settings",
              target: "设置",
              scopes: ["runtime-ui", "metadata"],
            }],
          },
        },
      },
    });
    expect(getPluginTranslation(valid, "dataview", "zh-CN")?.entries[0]?.scopes)
      .toEqual(["runtime-ui", "metadata"]);

    const invalid = parsePluginState({
      pluginTranslations: {
        dataview: {
          "zh-CN": {
            ...base,
            entries: [{
              pluginId: "dataview",
              source: "Settings",
              target: "设置",
              scopes: ["unknown"],
            }],
          },
        },
      },
    });
    expect(invalid.pluginTranslations).toEqual({});
  });

  it("丢弃退役平面译文，仅接受按语言分槽的当前格式", () => {
    const translation = (targetLocale: string, target: string) => ({
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      sourceVersionId: `source-${targetLocale}`,
      targetLocale,
      pulledAt: "2026-07-26T00:00:00.000Z",
      entries: [{ pluginId: "dataview", source: "Settings", target }],
    });

    const legacy = parsePluginState({
      pluginTranslations: { dataview: translation("ko", "설정") },
    });
    expect(legacy.pluginTranslations).toEqual({});

    const nested = parsePluginState({
      pluginTranslations: {
        dataview: {
          ko: translation("ko", "설정"),
          "zh-CN": translation("zh-CN", "设置"),
          ja: { ...translation("ko", "壊れた"), targetLocale: "ko" },
          invalid: translation("invalid!", "bad locale"),
        },
      },
    });
    expect(getPluginTranslation(nested, "dataview", "ko")?.entries[0]?.target).toBe("설정");
    expect(getPluginTranslation(nested, "dataview", "zh-CN")?.entries[0]?.target).toBe("设置");
    expect(nested.pluginTranslations.dataview?.ja).toBeUndefined();
    expect(Object.keys(nested.pluginTranslations.dataview ?? {})).toEqual(["ko", "zh-CN"]);
  });

  it("恢复规范化语言缓存时保留脚本和地区，并按目标语言隔离", () => {
    const translation = (targetLocale: string, target: string) => ({
      pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: `source-${targetLocale}`,
      targetLocale, pulledAt: "2026-09-12T00:00:00.000Z",
      entries: [{ pluginId: "dataview", source: "Settings", target }],
    });
    const state = parsePluginState({
      pluginTranslations: { dataview: {
        "zh_hant_tw": translation("zh-Hant-TW", "設定"),
        "sr_latn_rs": translation("sr-Latn-RS", "Podešavanja"),
      } },
    });

    expect(getPluginTranslation(state, "dataview", "zh-Hant-TW")?.entries[0]?.target).toBe("設定");
    expect(getPluginTranslation(state, "dataview", "sr-Latn-RS")?.entries[0]?.target).toBe("Podešavanja");
    expect(Object.keys(state.pluginTranslations.dataview ?? {})).toEqual(["zh-Hant-TW", "sr-Latn-RS"]);
  });

  it("不让旧持久化需求字段影响当前语言的真实同步错误", () => {
    const state = parsePluginState({
      pluginSubmissions: {
        dataview: {
          pluginId: "dataview",
          pluginVersion: "1",
          catalogDigest: "catalog",
          contributionId: "source",
          contributionState: "accepted",
          localizationTargetLocale: "ko",
          localizationContributionId: "ko-demand",
          localizationContributionState: "rejected",
          sourceVersionId: "ko-source",
          lastError: {
            code: "plugin_sync_failed",
            message: "ko failed",
            targetLocale: "ko",
            updatedAt: "2026-07-26T00:00:00.000Z",
          },
          submittedAt: "2026-07-26T00:00:00.000Z",
        },
      },
    });

    expect(getPluginSubmissionForLocale(state, "dataview", "zh-CN"))
      .toEqual(expect.objectContaining({ contributionId: "source" }));
    expect(getPluginSubmissionForLocale(state, "dataview", "zh-CN")).not.toHaveProperty("lastError");
    expect(getPluginSubmissionForLocale(state, "dataview", "zh-CN")).not.toHaveProperty("localizationContributionId");
    expect(getPluginSubmissionForLocale(state, "dataview", "ko")?.lastError?.message).toBe("ko failed");
    expect(state.pluginSubmissions.dataview).not.toHaveProperty("localizationTargetLocale");
    expect(state.pluginSubmissions.dataview).not.toHaveProperty("localizationContributionState");
  });

  it("保留现役来源身份，并忽略已下架公共分发的旧需求状态", () => {
    const persisted = JSON.parse(JSON.stringify({
      pluginSubmissions: {
        generic: {
          pluginId: "generic",
          pluginVersion: "2.0.0",
          catalogDigest: "catalog",
          adapterProfileDigest: "profile",
          registryPolicyRevision: 24,
          sourceDiscoveryEpoch: 21,
          installationId: "installation",
          sourceAuthority: "published",
          contributionState: "source_attested",
          repository: "owner/generic",
          localizationTargetLocale: "zh-CN",
          localizationContributionId: "localization",
          localizationContributionState: "received",
          localizationDemandStatus: {
            state: "distribution_blocked",
            sourceVersionId: "source-version",
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
            updatedAt: "2026-07-29T00:00:00.000Z",
          },
          sourceVersionId: "source-version",
          submittedAt: "2026-07-29T00:00:00.000Z",
        },
      },
    })) as unknown;

    const submission = parsePluginState(persisted).pluginSubmissions.generic;
    expect(submission).toEqual({
      pluginId: "generic",
      pluginVersion: "2.0.0",
      catalogDigest: "catalog",
      adapterProfileDigest: "profile",
      registryPolicyRevision: 24,
      sourceDiscoveryEpoch: 21,
      installationId: "installation",
      sourceAuthority: "published",
      contributionState: "source_attested",
      repository: "owner/generic",
      sourceVersionId: "source-version",
      submittedAt: "2026-07-29T00:00:00.000Z",
    });
    expect(submission).not.toHaveProperty("localizationDemandStatus");
  });
});
