import { describe, expect, it, vi } from "vitest";

import type { InstalledObsidianPlugin } from "../src/plugin-discovery";
import {
  resolveInstalledPluginSources,
  trustedPublishedPluginVersions,
} from "../src/plugin-picker-source";
import { EMPTY_PLUGIN_STATE } from "../src/plugin-state";

const DATAVIEW: InstalledObsidianPlugin = {
  id: "dataview",
  name: "Dataview",
  version: "0.5.68",
  description: "Complex data views.",
  dir: ".obsidian/plugins/dataview",
  enabled: true,
};

describe("resolveInstalledPluginSources", () => {
  it("verifies public registry eligibility without requiring a Trans-Hub session", async () => {
    const resolveEligibility = vi.fn().mockResolvedValue(new Map([
      ["dataview", { kind: "supported", repository: "blacksmithgu/obsidian-dataview" }],
    ]));

    await expect(resolveInstalledPluginSources([DATAVIEW], resolveEligibility)).resolves.toEqual([{
      ...DATAVIEW,
      source: { kind: "supported", repository: "blacksmithgu/obsidian-dataview" },
    }]);
    expect(resolveEligibility).toHaveBeenCalledOnce();
    expect(resolveEligibility).toHaveBeenCalledWith(["dataview"]);
  });

  it("uses source-pending only after the public registry request actually fails", async () => {
    const resolveEligibility = vi.fn().mockRejectedValue(new Error("registry unavailable"));

    await expect(resolveInstalledPluginSources([DATAVIEW], resolveEligibility)).resolves.toEqual([{
      ...DATAVIEW,
      source: { kind: "pending" },
    }]);
  });

  it("uses the matching scan snapshot instead of sampling the registry again", async () => {
    const resolveEligibility = vi.fn();
    await expect(resolveInstalledPluginSources(
      [DATAVIEW],
      resolveEligibility,
      new Set(),
      new Map([["dataview", {
        pluginVersion: "0.5.68",
        source: { kind: "supported", repository: "blacksmithgu/obsidian-dataview" },
      }]]),
    )).resolves.toEqual([{
      ...DATAVIEW,
      source: { kind: "supported", repository: "blacksmithgu/obsidian-dataview" },
    }]);
    expect(resolveEligibility).not.toHaveBeenCalled();
  });

  it("does not reuse a scan snapshot after the plugin exact version changes", async () => {
    const resolveEligibility = vi.fn().mockResolvedValue(new Map([
      ["dataview", { kind: "unsupported" }],
    ]));
    await expect(resolveInstalledPluginSources(
      [{ ...DATAVIEW, version: "0.5.69" }],
      resolveEligibility,
      new Set(),
      new Map([["dataview", {
        pluginVersion: "0.5.68",
        source: { kind: "supported", repository: "blacksmithgu/obsidian-dataview" },
      }]]),
    )).resolves.toEqual([{
      ...DATAVIEW,
      version: "0.5.69",
      source: { kind: "unsupported" },
    }]);
  });

  it("keeps matching snapshot rows stable when another plugin is absent from the snapshot", async () => {
    const other = { ...DATAVIEW, id: "tasks", version: "1.0.0" };
    const resolveEligibility = vi.fn().mockRejectedValue(new Error("registry unavailable"));
    await expect(resolveInstalledPluginSources(
      [DATAVIEW, other],
      resolveEligibility,
      new Set(),
      new Map([["dataview", {
        pluginVersion: "0.5.68",
        source: { kind: "supported", repository: "blacksmithgu/obsidian-dataview" },
      }]]),
    )).resolves.toEqual([
      { ...DATAVIEW, source: { kind: "supported", repository: "blacksmithgu/obsidian-dataview" } },
      { ...other, source: { kind: "pending" } },
    ]);
    expect(resolveEligibility).toHaveBeenCalledWith(["tasks"]);
  });

  it("官方当前快照缺项时保留精确版本的已发布权威来源", async () => {
    const resolveEligibility = vi.fn().mockResolvedValue(new Map([
      ["dataview", { kind: "unsupported" }],
    ]));

    await expect(resolveInstalledPluginSources(
      [DATAVIEW],
      resolveEligibility,
      new Set(["dataview\u00000.5.68"]),
    )).resolves.toEqual([{
      ...DATAVIEW,
      source: { kind: "published" },
    }]);
  });

  it("不将旧版权威来源沿用到新插件版本", async () => {
    const resolveEligibility = vi.fn().mockResolvedValue(new Map([
      ["dataview", { kind: "unsupported" }],
    ]));

    await expect(resolveInstalledPluginSources(
      [{ ...DATAVIEW, version: "0.5.69" }],
      resolveEligibility,
      new Set(["dataview\u00000.5.68"]),
    )).resolves.toEqual([{
      ...DATAVIEW,
      version: "0.5.69",
      source: { kind: "unsupported" },
    }]);
  });

  it("已验证权威来源跨目标语言可复用但不信任手动导入", () => {
    const identity = {
      protocol: "trans-hub.source-catalog-identity" as const,
      revision: 2 as const,
      resourceKey: "dataview",
      resourceVersion: "0.5.68",
      sourceLocale: "en",
      artifactDigest: "a".repeat(64),
      unitCount: 1,
      digest: "b".repeat(64),
      scopes: [],
    };
    const trusted = trustedPublishedPluginVersions({
      ...EMPTY_PLUGIN_STATE,
      pluginTranslations: {
        dataview: {
          ja: {
            pluginId: "dataview", pluginVersion: "0.5.68", sourceVersionId: "source",
            artifactDigest: "a".repeat(64), catalogIdentity: identity,
            targetLocale: "ja", entries: [], pulledAt: "now",
          },
        },
        local: {
          "zh-CN": {
            pluginId: "local", pluginVersion: "1", sourceVersionId: "manual-import",
            artifactDigest: "c".repeat(64), catalogIdentity: { ...identity, resourceKey: "local", resourceVersion: "1" },
            targetLocale: "zh-CN", entries: [], pulledAt: "now",
          },
        },
      },
    });

    expect([...trusted]).toEqual(["dataview\u00000.5.68"]);
  });
});
