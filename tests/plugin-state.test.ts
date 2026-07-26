import { describe, expect, it } from "vitest";

import {
  getPluginSubmissionForLocale,
  getPluginTranslation,
  parsePluginState,
} from "../src/plugin-state";

describe("parsePluginState", () => {
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
});
