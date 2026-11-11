import { describe, expect, it } from "vitest";
import { contaminatedMachineBatch, suspiciousMachineTarget } from "../src/plugin-machine-target-safety";
import { buildRuntimeTranslationPlan, translatePluginUiValue } from "../src/plugin-ui-runtime";
import { parsePluginState } from "../src/plugin-state";
import { scanPluginUiStrings } from "../src/plugin-string-scanner";
import { validatePluginTranslations } from "../src/plugin-translation-validation";

describe("cached and newly delivered machine target quarantine", () => {
  it("rejects the observed random targets but keeps ordinary text and reviewed corrections", () => {
    expect(suspiciousMachineTarget("Folder template", "1uuu69l54y1labr3wsig")).toBe(true);
    expect(suspiciousMachineTarget("Capture target", "uimvxazqqxpwxcxzaqcg")).toBe(true);
    expect(suspiciousMachineTarget("Folder template", "Modèle de dossier")).toBe(false);
    expect(suspiciousMachineTarget("Settings", "longlegitimatelabel")).toBe(false);
    expect(suspiciousMachineTarget("Settings", "Settings")).toBe(false);
    const rows = [
      { pluginId: "sample", source: "Folder template", target: "1uuu69l54y1labr3wsig", provenanceKind: "th-automatic" },
      { pluginId: "sample", source: "Other", target: "Autre", provenanceKind: "th-automatic" },
    ] as const;
    const parsed = parsePluginState({ pluginTranslations: { sample: { fr: {
      pluginId: "sample", pluginVersion: "1.0.0", sourceVersionId: "source", targetLocale: "fr",
      pulledAt: "2026-09-30T00:00:00Z", entries: rows,
    } } } }).pluginTranslations.sample?.fr;
    expect(parsed?.entries.map((entry) => entry.target)).toEqual(["Autre"]);
    const plan = buildRuntimeTranslationPlan(rows);
    expect(translatePluginUiValue("Folder template", plan)).toBeUndefined();
    expect(translatePluginUiValue("Other", plan)).toBe("Autre");
  });

  it("filters a newly downloaded machine target before it is saved", async () => {
    const catalog = await scanPluginUiStrings({
      plugin: { id: "sample", name: "Sample", description: "Sample", version: "1.0.0", dir: "sample", enabled: true },
      bundle: 'new Setting(el).setName("Folder template").setDesc("Other option");', sourceLocale: "en", targetLocale: "fr",
    });
    const bad = catalog.strings.find((item) => item.source === "Folder template")!;
    const good = catalog.strings.find((item) => item.source === "Other option")!;
    const validated = validatePluginTranslations(catalog, [
      { stringKey: bad.key, translatedText: "1uuu69l54y1labr3wsig", provenanceKind: "th-automatic" },
      { stringKey: good.key, translatedText: "Autre option", provenanceKind: "th-automatic" },
    ], "source", "fr");
    expect(validated.entries.map((entry) => entry.target)).toEqual(["Autre option"]);
  });

  it("quarantines a mostly corrupted old package including its superficially normal rows", () => {
    const entries = [
      { pluginId: "sample", source: "Folder template", target: "1uuu69l54y1labr3wsig", provenanceKind: "th-automatic" },
      { pluginId: "sample", source: "Syntax highlighting", target: "3vsyslaelyh01u6tgrby", provenanceKind: "th-automatic" },
      { pluginId: "sample", source: "System command", target: "lhvrdas60bp9g82up91a", provenanceKind: "th-automatic" },
      { pluginId: "sample", source: "Other", target: "Autre", provenanceKind: "th-automatic" },
    ] as const;
    expect(contaminatedMachineBatch(entries)).toBe(true);
    expect(buildRuntimeTranslationPlan(entries).exact.size).toBe(0);
    const state = parsePluginState({ pluginTranslations: { sample: { fr: {
      pluginId: "sample", pluginVersion: "1.0.0", sourceVersionId: "source", targetLocale: "fr",
      pulledAt: "2026-09-30T00:00:00Z", entries,
    } } } });
    expect(state.pluginTranslations.sample?.fr).toBeUndefined();
    expect(contaminatedMachineBatch([
      ...entries.slice(0, 1), ...Array.from({ length: 4 }, (_, index) => ({
        pluginId: "sample", source: `Other ${index}`, target: `Autre ${index}`, provenanceKind: "th-automatic",
      })),
    ])).toBe(false);
  });
});
