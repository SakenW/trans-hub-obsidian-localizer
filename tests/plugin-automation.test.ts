import { describe, expect, it } from "vitest";

import { selectApplicablePluginTranslations } from "../src/plugin-automation";
import { EMPTY_PLUGIN_STATE } from "../src/plugin-state";

describe("selectApplicablePluginTranslations", () => {
  it("applies cached translations only for currently enabled and non-excluded plugins", () => {
    const entry = (pluginId: string) => ({ pluginId, source: `Source ${pluginId}`, target: `Target ${pluginId}` });
    const state = {
      ...EMPTY_PLUGIN_STATE,
      enabledPluginIds: ["enabled", "excluded"],
      pluginCatalogs: Object.fromEntries(["enabled", "excluded"].map((pluginId) => [pluginId, {
        pluginId,
        pluginName: pluginId,
        pluginVersion: "1",
        sourceLocale: "en",
        digest: "digest",
        artifactDigest: "artifact",
        scannedAt: "now",
        strings: [{
          key: pluginId,
          source: `Source ${pluginId}`,
          origins: ["ui-call" as const],
          semanticRole: "runtime-ui" as const,
          placeholderSignature: "",
        }],
      }])),
      pluginTranslations: {
        enabled: { pluginId: "enabled", pluginVersion: "1", sourceVersionId: "v", targetLocale: "zh-CN", entries: [entry("enabled")], pulledAt: "now" },
        disabled: { pluginId: "disabled", pluginVersion: "1", sourceVersionId: "v", targetLocale: "zh-CN", entries: [entry("disabled")], pulledAt: "now" },
        excluded: { pluginId: "excluded", pluginVersion: "1", sourceVersionId: "v", targetLocale: "zh-CN", entries: [entry("excluded")], pulledAt: "now" },
      },
    };

    expect(selectApplicablePluginTranslations(state, {
      excludedPluginIds: ["excluded"],
      pluginMetadataTranslationEnabled: true,
      targetLocale: "zh-CN",
    })).toEqual([{ ...entry("enabled"), scopes: ["runtime-ui"] }]);
  });

  it("does not apply cached translations for a previously selected target language", () => {
    const state = {
      ...EMPTY_PLUGIN_STATE,
      enabledPluginIds: ["enabled"],
      pluginTranslations: {
        enabled: {
          pluginId: "enabled",
          pluginVersion: "1",
          sourceVersionId: "v",
          targetLocale: "zh-CN",
          entries: [{ pluginId: "enabled", source: "Settings", target: "设置" }],
          pulledAt: "now",
        },
      },
    };

    expect(selectApplicablePluginTranslations(state, {
      excludedPluginIds: [],
      pluginMetadataTranslationEnabled: true,
      targetLocale: "ja",
    })).toEqual([]);
  });

  it("applies composite plugin names only while metadata translation is enabled", () => {
    const state = {
      ...EMPTY_PLUGIN_STATE,
      enabledPluginIds: ["sample"],
      pluginCatalogs: {
        sample: {
          pluginId: "sample",
          pluginName: "Sample",
          pluginVersion: "1",
          sourceLocale: "en",
          digest: "digest",
          artifactDigest: "artifact",
          scannedAt: "now",
          strings: [
            {
              key: "name",
              source: "Sample",
              origins: ["manifest.name" as const],
              semanticRole: "official-name" as const,
              placeholderSignature: "",
            },
            {
              key: "description",
              source: "Sample description",
              origins: ["manifest.description" as const],
              semanticRole: "description" as const,
              placeholderSignature: "",
            },
          ],
        },
      },
      pluginTranslations: {
        sample: {
          pluginId: "sample",
          pluginVersion: "1",
          sourceVersionId: "v",
          targetLocale: "zh-CN",
          entries: [
            { pluginId: "sample", source: "Sample", target: "示例插件" },
            { pluginId: "sample", source: "Sample description", target: "示例说明" },
          ],
          pulledAt: "now",
        },
      },
    };

    expect(selectApplicablePluginTranslations(state, {
      excludedPluginIds: [],
      pluginMetadataTranslationEnabled: true,
      targetLocale: "zh-CN",
    })).toEqual([
      { pluginId: "sample", source: "Sample", target: "示例插件", scopes: ["metadata"] },
      { pluginId: "sample", source: "Sample description", target: "示例说明", scopes: ["metadata"] },
    ]);
    expect(selectApplicablePluginTranslations(state, {
      excludedPluginIds: [],
      pluginMetadataTranslationEnabled: false,
      targetLocale: "zh-CN",
    })).toEqual([]);
  });
});
