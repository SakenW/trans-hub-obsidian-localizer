import { describe, expect, it } from "vitest";
import { scanPluginUiStrings } from "../src/plugin-string-scanner";
import { validatePluginTranslations } from "../src/plugin-translation-validation";
import { parsePluginState } from "../src/plugin-state";
import { localizedPluginDisplayName, selectCurrentCatalogTranslations } from "../src/plugin-catalog-diff";
import { buildRuntimeTranslationPlan, translatePluginUiValue, type PluginUiTranslation } from "../src/plugin-ui-runtime";
import { preservesCalloutMarkers } from "../src/plugin-protected-text";

async function importerCatalog() {
  return scanPluginUiStrings({
    plugin: { id: "obsidian-importer", name: "Importer", description: "Import notes", version: "3.1.5", dir: "obsidian-importer", enabled: true },
    bundle: 'el.appendText("[!important]"); new Setting(el).setName("Import notes");',
    sourceLocale: "en", targetLocale: "zh-CN",
  });
}

describe("official names and host callout syntax", () => {
  it.each([
    ["[!important]", "[! important]", false],
    ["[!note]+ Read this", "[!note]+ 阅读此处", true],
    ["[!tip]- Details", "[!tip]+ 详情", false],
    ["[!warning] [!note]", "[!note] [!warning]", false],
    ["Read this", "[!warning] 阅读此处", false],
    ["Settings", "设置", true],
  ])("preserves marker identity and fold modifiers in %s", (source, target, safe) => {
    expect(preservesCalloutMarkers(source, target)).toBe(safe);
  });

  it("filters the real Importer mistakes from a new export, preserving valid text", async () => {
    const catalog = await importerCatalog();
    const state = validatePluginTranslations(catalog, catalog.strings.map((item) => ({
      stringKey: item.key,
      translatedText: item.source === "Importer" ? "进口商"
        : item.source === "[!important]" ? "[! important]" : "导入笔记",
      provenanceKind: "th-automatic" as const,
    })), "new-version", "zh-CN");
    expect(state.entries.map((entry) => entry.source)).toEqual(["Import notes"]);
    expect(localizedPluginDisplayName("Importer", catalog, state, "zh-CN")).toBe("Importer");
  });

  it("applies the same rule to persisted entries, including a reviewed malformed marker", () => {
    const rows: PluginUiTranslation[] = [
      { pluginId: "sample", source: "Importer", target: "进口商", provenanceKind: "th-automatic",
        sourceCompatibility: { semanticRole: "official-name", contentScopes: ["metadata"], placeholderSignature: "", formatSignature: "plain-text-v1", sourceContentDigest: "sha256:" + "a".repeat(64) } },
      { pluginId: "sample", source: "[!important]", target: "[! important]", provenanceKind: "th-reviewed-fill" },
      { pluginId: "sample", source: "Settings", target: "设置", provenanceKind: "th-automatic" },
    ];
    const parsed = parsePluginState({ pluginTranslations: { sample: { "zh-CN": {
      pluginId: "sample", pluginVersion: "1", sourceVersionId: "v", targetLocale: "zh-CN",
      pulledAt: "2026-11-04T00:00:00Z", entries: rows,
    } } } });
    expect(parsed.pluginTranslations.sample?.["zh-CN"]?.entries.map((entry) => entry.source)).toEqual(["Settings"]);
    const plan = buildRuntimeTranslationPlan(rows);
    expect(translatePluginUiValue("Importer", plan)).toBeUndefined();
    expect(translatePluginUiValue("[!important]", plan)).toBeUndefined();
    expect(translatePluginUiValue("Settings", plan)).toBe("设置");
  });

  it("keeps legacy unreviewed names unchanged but accepts an explicitly reviewed name", async () => {
    const catalog = await importerCatalog();
    for (const provenanceKind of [undefined, "th-published", "th-automatic", "th-reviewed-fill", "upstream-native"] as const) {
      const entry = { pluginId: catalog.pluginId, source: "Importer", target: "导入工具", provenanceKind };
      const state = { pluginId: catalog.pluginId, pluginVersion: "3.1.5", sourceVersionId: "v", targetLocale: "zh-CN", pulledAt: "2026-11-04T00:00:00Z", upstreamNativeCount: 0, entries: [entry] };
      const reviewed = provenanceKind === "th-reviewed-fill" || provenanceKind === "upstream-native";
      expect(localizedPluginDisplayName("Importer", catalog, state, "zh-CN")).toBe(reviewed ? "导入工具" : "Importer");
      expect(selectCurrentCatalogTranslations(catalog, state)).toHaveLength(reviewed ? 1 : 0);
    }
  });

  it("never translates callout markers through native-language aliases", () => {
    const plan = buildRuntimeTranslationPlan([
      { pluginId: "other", source: "Notice", target: "提示", nativeSource: "[!note]" },
      { pluginId: "other", source: "Warning", target: "警告", nativeTarget: "[!warning]", application: "correction", provenanceKind: "th-reviewed-correction" },
    ]);
    expect(translatePluginUiValue("[!note]", plan)).toBeUndefined();
    expect(translatePluginUiValue("[!warning]", plan)).toBeUndefined();
    expect(translatePluginUiValue("Notice", plan)).toBe("提示");
  });
});
