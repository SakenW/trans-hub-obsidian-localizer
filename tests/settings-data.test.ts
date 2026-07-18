import { describe, expect, it } from "vitest";

import { loadSettings } from "../src/settings-data";

describe("loadSettings", () => {
  it("keeps only user-selectable behavior and target language", () => {
    const settings = loadSettings({
      apiBaseUrl: "https://wrong.example.com",
      workspaceId: "tenant-workspace",
      sourceLocale: "fr",
      targetLocale: "ja",
      pluginTranslationEnabled: false,
      pluginMetadataTranslationEnabled: false,
      autoScanPlugins: false,
      autoSyncPluginTranslations: false,
      autoApplyPluginTranslations: false,
      excludedPluginIds: ["sample"],
    });

    expect(settings).toMatchObject({
      targetLocale: "ja",
      pluginTranslationEnabled: false,
      pluginMetadataTranslationEnabled: false,
      excludedPluginIds: ["sample"],
    });
    expect(settings).not.toHaveProperty("apiBaseUrl");
    expect(settings).not.toHaveProperty("workspaceId");
    expect(settings).not.toHaveProperty("sourceLocale");
    expect(settings).not.toHaveProperty("autoScanPlugins");
    expect(settings).not.toHaveProperty("autoSyncPluginTranslations");
    expect(settings).not.toHaveProperty("autoApplyPluginTranslations");
  });

  it("rejects arbitrary target-language values", () => {
    expect(loadSettings({ targetLocale: "en" }).targetLocale).toBe("en");
    expect(loadSettings({ targetLocale: "invalid" }).targetLocale).toBe("zh-CN");
  });

  it("uses the Obsidian language only before a target language has been saved", () => {
    expect(loadSettings(undefined, "ja").targetLocale).toBe("ja");
    expect(loadSettings({}, "ja").targetLocale).toBe("ja");
    expect(loadSettings({ targetLocale: "de" }, "ja").targetLocale).toBe("de");
  });

  it("enables plugin name and description translations by default", () => {
    expect(loadSettings({}).pluginMetadataTranslationEnabled).toBe(true);
  });
});
