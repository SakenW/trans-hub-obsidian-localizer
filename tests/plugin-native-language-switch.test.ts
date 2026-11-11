import { describe, expect, it } from "vitest";
import { scanPluginUiStrings } from "../src/plugin-string-scanner";
import { selectCurrentCatalogTranslations } from "../src/plugin-catalog-diff";
import { parsePluginState } from "../src/plugin-state";
import { canReuseScannedPluginCatalog } from "../src/plugin-automation";
import { buildRuntimeTranslationPlan, PluginUiTranslationRuntime, translatePluginUiValue } from "../src/plugin-ui-runtime";

const plugin = {
  id: "sample", name: "Sample", description: "Sample plugin", version: "1.0.0",
  dir: ".obsidian/plugins/sample", enabled: true,
};
const bundle = `
var english={title:"Show card checkbox",description:"Show a checkbox on each card",button:"Reset to default"};
var chinese={title:"展示卡片复选框",description:"在每张卡片上显示复选框",button:"还原初始设置"};
var french={title:"Afficher la case à cocher",description:"Afficher une case sur chaque carte",button:"Réinitialiser"};
var german={title:"Kartenkontrollkästchen anzeigen",description:"Ein Kontrollkästchen pro Karte anzeigen",button:"Zurücksetzen"};
var languages={en:english,zh:chinese,fr:french,de:german};
`;

describe("built-in host language to target language", () => {
  it.each([
    ["fr", "Afficher la case à cocher"],
    ["de", "Kartenkontrollkästchen anzeigen"],
    ["en", "Show card checkbox"],
  ])("uses exact catalog keys from Chinese to %s, preserving restart state", async (locale, expected) => {
    const catalog = await scanPluginUiStrings({ plugin, bundle, sourceLocale: "en", targetLocale: locale, displayLocale: "zh" });
    const persisted = parsePluginState(JSON.parse(JSON.stringify({ pluginCatalogs: { sample: catalog } })));
    const restored = persisted.pluginCatalogs.sample;
    expect(restored.scannerDisplayLocale).toBe("zh-CN");
    const translations = selectCurrentCatalogTranslations(restored, {
      pluginId: "sample", pluginVersion: "1.0.0", sourceVersionId: "source", targetLocale: locale,
      pulledAt: "2026-09-30T00:00:00Z", entries: [],
    });
    const plan = buildRuntimeTranslationPlan(translations);
    expect(translatePluginUiValue("展示卡片复选框", plan)).toBe(expected);
    expect(translatePluginUiValue("Show card checkbox", plan)).toBe(locale === "en" ? undefined : expected);
    expect(translatePluginUiValue(expected, plan)).toBeUndefined();
    expect(translatePluginUiValue("用户笔记内容", plan)).toBeUndefined();
  });

  it("does not change public source identity or aliases when host already uses target language", async () => {
    const plain = await scanPluginUiStrings({ plugin, bundle, sourceLocale: "en", targetLocale: "fr" });
    const cross = await scanPluginUiStrings({ plugin, bundle, sourceLocale: "en", targetLocale: "fr", displayLocale: "zh" });
    expect(cross.digest).toBe(plain.digest);
    expect(cross.catalogIdentity).toEqual(plain.catalogIdentity);
    expect(canReuseScannedPluginCatalog(cross, plugin, cross.artifactDigest, "fr", "zh-CN")).toBe(true);
    expect(canReuseScannedPluginCatalog(cross, plugin, cross.artifactDigest, "fr", "de")).toBe(false);
    expect(canReuseScannedPluginCatalog(plain, plugin, plain.artifactDigest, "fr", "zh-CN")).toBe(false);
    const same = await scanPluginUiStrings({ plugin, bundle, sourceLocale: "en", targetLocale: "fr", displayLocale: "fr" });
    expect(same.strings.every((row) => row.nativeSource === undefined)).toBe(true);
  });

  it("rejects conflicting aliases and does not rewrite target text", () => {
    const plan = buildRuntimeTranslationPlan([
      { pluginId: "sample", source: "Open", target: "Ouvrir", nativeSource: "打开" },
      { pluginId: "sample", source: "Launch", target: "Lancer", nativeSource: "打开" },
      { pluginId: "sample", source: "Other", target: "Autre", nativeSource: "Ouvrir" },
    ]);
    expect(translatePluginUiValue("打开", plan)).toBeUndefined();
    expect(translatePluginUiValue("Ouvrir", plan)).toBeUndefined();
  });

  it("restores the built-in Chinese value before switching and when disabled", () => {
    const runtime = new PluginUiTranslationRuntime();
    const internal = runtime as unknown as { translateText(node: Text): void };
    const modal = { querySelector: () => ({ getAttribute: () => "sample" }) };
    const parentElement = { closest: (selector: string) => selector === ".modal.mod-settings" ? modal : null };
    const node = { nodeType: 3, data: "展示卡片复选框", parentElement } as unknown as Text;
    runtime.update([{ pluginId: "sample", source: "Display card checkbox", nativeSource: "展示卡片复选框", target: "Afficher la case" }]);
    internal.translateText(node);
    expect(node.data).toBe("Afficher la case");
    runtime.update([{ pluginId: "sample", source: "Display card checkbox", nativeSource: "展示卡片复选框", target: "Kontrollkästchen anzeigen" }]);
    expect(node.data).toBe("展示卡片复选框");
    internal.translateText(node);
    expect(node.data).toBe("Kontrollkästchen anzeigen");
    runtime.stop();
    expect(node.data).toBe("展示卡片复选框");
  });
});
