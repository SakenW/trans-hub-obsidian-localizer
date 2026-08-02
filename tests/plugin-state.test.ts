import { describe, expect, it } from "vitest";

import {
  getPluginSubmissionForLocale,
  getPluginTranslation,
  isPluginLocalizationDerivedCacheCurrent,
  parsePluginState,
  resetPluginLocalizationDerivedState,
} from "../src/plugin-state";

describe("parsePluginState", () => {
  it("clears only derived localization caches when the persisted cache revision expires", () => {
    expect(isPluginLocalizationDerivedCacheCurrent(undefined)).toBe(false);
    expect(isPluginLocalizationDerivedCacheCurrent(1)).toBe(true);
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
    expect(reset.pluginTranslations).toEqual({});
    expect(reset.translationExportStates).toEqual({});
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
          ...base,
          entries: [{
            pluginId: "dataview",
            source: "Settings",
            target: "设置",
            scopes: ["runtime-ui", "metadata"],
          }],
        },
      },
    });
    expect(getPluginTranslation(valid, "dataview", "zh-CN")?.entries[0]?.scopes)
      .toEqual(["runtime-ui", "metadata"]);

    const invalid = parsePluginState({
      pluginTranslations: {
        dataview: {
          ...base,
          entries: [{
            pluginId: "dataview",
            source: "Settings",
            target: "设置",
            scopes: ["unknown"],
          }],
        },
      },
    });
    expect(invalid.pluginTranslations).toEqual({});
  });

  it("迁移旧平面译文并逐槽隔离新格式中的坏值", () => {
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
    expect(getPluginTranslation(legacy, "dataview", "ko")?.entries[0]?.target).toBe("설정");

    const nested = parsePluginState({
      pluginTranslations: {
        dataview: {
          ko: translation("ko", "설정"),
          "zh-CN": translation("zh-CN", "设置"),
          ja: { ...translation("ko", "壊れた"), targetLocale: "ko" },
          invalid: translation("invalid", "bad locale"),
        },
      },
    });
    expect(getPluginTranslation(nested, "dataview", "ko")?.entries[0]?.target).toBe("설정");
    expect(getPluginTranslation(nested, "dataview", "zh-CN")?.entries[0]?.target).toBe("设置");
    expect(nested.pluginTranslations.dataview?.ja).toBeUndefined();
    expect(Object.keys(nested.pluginTranslations.dataview ?? {})).toEqual(["ko", "zh-CN"]);
  });

  it("不让旧语言的需求与错误状态冒充当前语言", () => {
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

    expect(getPluginSubmissionForLocale(state, "dataview", "zh-CN")).toEqual(
      expect.objectContaining({ contributionId: "source" }),
    );
    expect(getPluginSubmissionForLocale(state, "dataview", "zh-CN")).not.toHaveProperty("lastError");
    expect(getPluginSubmissionForLocale(state, "dataview", "zh-CN")).not.toHaveProperty("localizationContributionId");
    expect(getPluginSubmissionForLocale(state, "dataview", "ko")?.lastError?.message).toBe("ko failed");
  });

  it("round-trips an authority-backed demand without a source contribution id", () => {
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
    const { localizationDemandStatus, ...sourceAndDemand } = submission ?? {};
    expect(sourceAndDemand).toEqual({
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
      sourceVersionId: "source-version",
      submittedAt: "2026-07-29T00:00:00.000Z",
    });
    expect(localizationDemandStatus).toEqual(expect.objectContaining({
        state: "distribution_blocked",
        failureCode: "PublicDistributionPolicyUnavailable",
      }));
  });
});
