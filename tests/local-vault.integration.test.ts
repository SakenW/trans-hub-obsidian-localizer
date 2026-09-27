import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import type { Vault } from "obsidian";
import { describe, expect, it } from "vitest";

import { calculatePluginTranslationCoverage, comparePluginCatalogIdentity, isPluginInterfaceString, selectCurrentCatalogTranslations } from "../src/plugin-catalog-diff";
import { selectApplicablePluginTranslations } from "../src/plugin-automation";
import { describeMissingTranslations } from "../src/plugin-missing-translations";
import { getPluginTranslation, parsePluginState, type PluginTranslationState } from "../src/plugin-state";
import { scanPluginUiStrings, tokenizeJavascript, type PluginUiCatalog } from "../src/plugin-string-scanner";
import { buildRuntimeTranslationPlan, translatePluginUiValue } from "../src/plugin-ui-runtime";
import { OBSIDIAN_PLUGIN_ID, parseTargetLocale } from "../src/product-config";
import {
  applyPublishedPluginFilePatch,
  inspectPluginFilePatch,
  logicalPluginBundle,
  previewPublishedPluginFilePatch,
  restorePublishedPluginFilePatch,
} from "../src/third-party-plugin-patcher";

const vaultRoot = process.env.OBSIDIAN_TEST_VAULT;
const scanAllInstalled = process.env.OBSIDIAN_SCAN_ALL_PLUGINS === "1";
const profileScan = process.env.OBSIDIAN_PROFILE_SCAN === "1";
const profileOnlyPlugin = process.env.OBSIDIAN_PROFILE_ONLY_PLUGIN;
const auditPatchEligibility = process.env.OBSIDIAN_AUDIT_PATCH_ELIGIBILITY === "1";
const auditMissingReasons = process.env.OBSIDIAN_AUDIT_MISSING_REASONS === "1";
const auditRuntimePlans = process.env.OBSIDIAN_AUDIT_RUNTIME_PLANS === "1";
const auditAllInstalled = process.env.OBSIDIAN_AUDIT_ALL_INSTALLED === "1";
const auditAllCatalogs = process.env.OBSIDIAN_AUDIT_ALL_CATALOGS === "1";
const patchCyclePlugin = process.env.OBSIDIAN_AUDIT_PATCH_PLUGIN;
const describeLocal = vaultRoot === undefined ? describe.skip : describe;

function catalogStructureDigest(catalog: PluginUiCatalog): string {
  return createHash("sha256").update(JSON.stringify(catalog.strings
    .map((item) => [item.key, item.source, item.semanticRole, item.placeholderSignature, [...item.origins].sort()])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0]))))).digest("hex");
}

describeLocal("local Obsidian vault integration", () => {
  it("scans real enabled plugin bundles without modifying them", async () => {
    const configDir = join(vaultRoot!, ".obsidian");
    const auditLocale = auditAllCatalogs
      ? parseTargetLocale((JSON.parse(await readFile(
        join(configDir, "plugins", OBSIDIAN_PLUGIN_ID, "data.json"), "utf8",
      )) as { settings?: { targetLocale?: unknown } }).settings?.targetLocale)
      : null;
    if (auditAllCatalogs && auditLocale === null) throw new Error("saved target locale is invalid");
    const enabled = JSON.parse(await readFile(join(configDir, "community-plugins.json"), "utf8")) as unknown;
    if (!Array.isArray(enabled)) throw new Error("community-plugins.json 格式无效");
    const pluginDirs = await readdir(join(configDir, "plugins"), { withFileTypes: true });
    const enabledIds = new Set(enabled.filter((item): item is string => typeof item === "string"));
    const results: { id: string; count: number; bytes: number; readMs: number; scanMs: number;
      phases?: Record<string, number> }[] = [];
    const allCatalogs: { id: string; directory: string; version: string; count: number; artifactDigest: string;
      structureDigest: string; sourceKeys: readonly string[] }[] = [];
    const startedAt = performance.now();
    let linterSources: ReadonlySet<string> | undefined;
    for (const dir of pluginDirs.filter((item) =>
      item.isDirectory()
      && !item.name.startsWith(".")
      && (scanAllInstalled || enabledIds.has(item.name))
      && (profileOnlyPlugin === undefined || item.name === profileOnlyPlugin)
    )) {
      const root = join(configDir, "plugins", dir.name);
      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as Record<string, unknown>;
      if (manifest.id === OBSIDIAN_PLUGIN_ID) continue;
      const readStartedAt = performance.now();
      const bundle = await readFile(join(root, "main.js"), "utf8");
      if (profileScan && profileOnlyPlugin === dir.name) {
        const lexicalStartedAt = performance.now();
        const tokens = tokenizeJavascript(bundle);
        process.stdout.write(`OBSIDIAN_LOCAL_LEXICAL_PROFILE ${JSON.stringify({
          id: dir.name,
          tokens: tokens?.length ?? null,
          elapsedMs: Math.round(performance.now() - lexicalStartedAt),
        })}\n`);
      }
      const scanStartedAt = performance.now();
      const phases: Record<string, number> = {};
      const catalog = await scanPluginUiStrings({
        plugin: {
          id: String(manifest.id),
          name: String(manifest.name),
          version: String(manifest.version),
          description: typeof manifest.description === "string" ? manifest.description : "",
          dir: root,
          enabled: true,
        },
        bundle,
        sourceLocale: "en",
        ...(auditLocale === null ? {} : { targetLocale: auditLocale }),
        ...(profileScan ? { onPhaseMeasured: (phase: string, elapsedMs: number) => { phases[phase] = elapsedMs; } } : {}),
      });
      results.push({
        id: catalog.pluginId,
        count: catalog.strings.length,
        bytes: Buffer.byteLength(bundle, "utf8"),
        readMs: Math.round(scanStartedAt - readStartedAt),
        scanMs: Math.round(performance.now() - scanStartedAt),
        ...(profileScan ? { phases } : {}),
      });
      if (auditAllCatalogs) allCatalogs.push({
        id: catalog.pluginId,
        directory: dir.name,
        version: catalog.pluginVersion,
        count: catalog.strings.length,
        artifactDigest: catalog.artifactDigest,
        structureDigest: catalogStructureDigest(catalog),
        sourceKeys: catalog.strings.map((item) => item.key),
      });
      if (catalog.pluginId === "quickadd" && process.env.OBSIDIAN_AUDIT_REACTIVE_CHOICES === "1") {
        const reactive = catalog.strings.filter((item) =>
          ["Add choice", "New choice", "Add folder", "New folder"].includes(item.source));
        expect(reactive.map((item) => item.source).sort()).toEqual([
          "Add choice", "Add folder", "New choice", "New folder",
        ]);
        expect(reactive.every((item) => item.evidence?.some((evidence) =>
          evidence.symbol === "svelteReactiveText"
          && evidence.literalStart === undefined
          && evidence.literalEnd === undefined))).toBe(true);
      }
      if (catalog.pluginId === "quickadd" && process.env.OBSIDIAN_AUDIT_COMPOSED_DOCS === "1") {
        const source = "Bundle or import QuickAdd automations as reusable packages. Export becomes available once you have a choice.";
        const item = catalog.strings.find((candidate) => candidate.source === source);
        expect(item?.evidence?.some((evidence) => evidence.symbol === "settingsComposedDocumentation"
          && evidence.literalStart === undefined && evidence.literalEnd === undefined)).toBe(true);
      }
      if (catalog.pluginId === "notebook-navigator" && process.env.OBSIDIAN_AUDIT_BUNDLED_JSX === "1") {
        const item = catalog.strings.find((candidate) => candidate.source === "Resize pinned shortcuts");
        expect(item?.semanticRole).toBe("runtime-ui");
        expect(item?.evidence?.some((evidence) => evidence.symbol === "aria-label"
          && evidence.strategy === "structured")).toBe(true);
        expect(catalog.strings.some((candidate) => candidate.source === "Aa")).toBe(false);
      }
      if (catalog.pluginId === "obsidian-linter") {
        linterSources = new Set(catalog.strings.map((item) => item.source));
      }
    }
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.count > 0)).toBe(true);
    if (auditAllCatalogs) {
      const output = process.env.OBSIDIAN_ALL_CATALOG_OUTPUT;
      if (output === undefined) throw new Error("OBSIDIAN_ALL_CATALOG_OUTPUT is required for catalog audit");
      const path = resolve(output);
      const vault = resolve(vaultRoot!);
      if (path === vault || path.startsWith(`${vault}${sep}`)) throw new Error("catalog audit output must be outside the Vault");
      await writeFile(path, `${JSON.stringify({ targetLocale: auditLocale, plugins: allCatalogs.length, rows: allCatalogs })}\n`,
        { flag: "wx", mode: 0o600 });
      process.stdout.write(`OBSIDIAN_LOCAL_ALL_CATALOG_AUDIT_FILE ${path}\n`);
    }
    if (profileScan) process.stdout.write(`OBSIDIAN_LOCAL_SCAN_PROFILE ${JSON.stringify({
      selected: scanAllInstalled ? "all-installed" : "host-enabled",
      plugins: results.length,
      elapsedMs: Math.round(performance.now() - startedAt),
      totalBundleBytes: results.reduce((sum, result) => sum + result.bytes, 0),
      rows: results,
    })}\n`);
    if (linterSources !== undefined) {
      expect(linterSources).toContain(
        'Tries to escape array values assuming that an array starts with "[", ends with "]", and has items that are delimited by ",".',
      );
      expect(linterSources).not.toContain(
        'Intenta escapar de los valores de matriz suponiendo que una matriz comienza con "[", termina con "]" y tiene elementos que están delimitados por ",".',
      );
    }
  }, 30_000);

  it("audits every locally selected plugin with the production coverage calculation", async () => {
    const configDir = join(vaultRoot!, ".obsidian");
    const saved = JSON.parse(await readFile(
      join(configDir, "plugins", OBSIDIAN_PLUGIN_ID, "data.json"), "utf8",
    )) as { settings?: { targetLocale?: unknown }; state?: unknown };
    const targetLocale = parseTargetLocale(saved.settings?.targetLocale);
    if (targetLocale === null) throw new Error("saved target locale is invalid");
    const state = parsePluginState(saved.state);
    const directoryById = new Map<string, string>();
    if (auditAllInstalled) {
      const installed = (await readdir(join(configDir, "plugins"), { withFileTypes: true }))
        .filter((item) => item.isDirectory() && !item.name.startsWith(".") && item.name !== OBSIDIAN_PLUGIN_ID);
      for (const item of installed) {
        const manifest = JSON.parse(await readFile(
          join(configDir, "plugins", item.name, "manifest.json"), "utf8",
        )) as Record<string, unknown>;
        const id = manifest.id;
        if (typeof id !== "string" || id === "" || id === OBSIDIAN_PLUGIN_ID || directoryById.has(id)) {
          throw new Error(`installed plugin id is invalid or duplicated: ${item.name}`);
        }
        directoryById.set(id, item.name);
      }
    }
    const selected = auditAllInstalled
      ? [...directoryById.keys()].sort()
      : [...new Set(state.enabledPluginIds)].sort();
    const hostEnabledValue = JSON.parse(await readFile(join(configDir, "community-plugins.json"), "utf8")) as unknown;
    if (!Array.isArray(hostEnabledValue)
      || !hostEnabledValue.every((item): item is string => typeof item === "string")) {
      throw new Error("community-plugins.json 格式无效");
    }
    const hostEnabled = new Set(hostEnabledValue);
    const localizerSelected = new Set(state.enabledPluginIds);
    const rows: Record<string, unknown>[] = [];
    for (const id of selected) {
      try {
        const directory = directoryById.get(id) ?? id;
        const root = join(configDir, "plugins", directory);
        const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as Record<string, unknown>;
        if (manifest.id !== id || typeof manifest.name !== "string" || typeof manifest.version !== "string") {
          throw new Error("installed manifest identity is invalid");
        }
        const bundle = await readFile(join(root, "main.js"), "utf8");
        const plugin = {
          id,
          name: manifest.name,
          version: manifest.version,
          description: typeof manifest.description === "string" ? manifest.description : "",
          dir: root,
          enabled: true,
        };
        const catalog = await scanPluginUiStrings({
          plugin,
          bundle,
          sourceLocale: "en",
          targetLocale,
        });
        const savedTranslation = getPluginTranslation(state, id, targetLocale);
        const nativeOnly: PluginTranslationState = {
          pluginId: id,
          pluginVersion: manifest.version,
          sourceVersionId: "local-native-only",
          targetLocale,
          entries: [],
          pulledAt: "",
        };
        const coverage = calculatePluginTranslationCoverage(catalog, savedTranslation ?? nativeOnly, targetLocale);
        if (coverage === undefined) throw new Error("coverage calculation returned no result");
        const missingSourceReasons: Record<string, number> = {};
        const localInterfaceSourceCount = auditMissingReasons
          ? new Set(catalog.strings.filter(isPluginInterfaceString).map((item) => item.source)).size
          : undefined;
        if (auditMissingReasons && savedTranslation !== undefined) {
          for (const { reason } of describeMissingTranslations(catalog, savedTranslation)) {
            missingSourceReasons[reason] = (missingSourceReasons[reason] ?? 0) + 1;
          }
        }
        const exactVersion = savedTranslation !== undefined
          && savedTranslation.pluginVersion === manifest.version
          && (savedTranslation.authorityPluginVersion ?? savedTranslation.pluginVersion) === manifest.version;
        const exactCatalog = savedTranslation === undefined
          ? false : comparePluginCatalogIdentity(catalog, savedTranslation).exact;
        const staticSources = new Set(savedTranslation === undefined ? []
          : selectCurrentCatalogTranslations(catalog, savedTranslation, false)
            .filter((entry) => entry.scopes?.includes("runtime-ui") && !entry.source.includes("{{th:expr:"))
            .map((entry) => entry.source));
        const staticLiteralSlots = catalog.strings.reduce((count, item) => count + (
          staticSources.has(item.source) && item.placeholderSignature === ""
            ? (item.evidence ?? []).filter((evidence) => evidence.literalStart !== undefined
              && evidence.literalEnd !== undefined
              && (evidence.strategy === "structured"
                || evidence.strategy === "regex-fallback" && evidence.symbol === "createElement")).length
            : 0
        ), 0);
        const exactLiteralPreview = auditPatchEligibility
          ? await previewPublishedPluginFilePatch({ plugin, catalog, translation: savedTranslation, original: bundle })
          : undefined;
        const runtimeApplicable = auditRuntimePlans
          ? selectApplicablePluginTranslations({ ...state,
            enabledPluginIds: auditAllInstalled ? [id] : state.enabledPluginIds,
            pluginCatalogs: { ...state.pluginCatalogs, [id]: catalog } },
            { targetLocale, excludedPluginIds: [], pluginMetadataTranslationEnabled: true })
            .filter((item) => item.pluginId === id)
          : [];
        const runtimePlan = auditRuntimePlans ? buildRuntimeTranslationPlan(runtimeApplicable) : undefined;
        const runtimeDirectUnmatchedReasons: Record<string, number> = {};
        let runtimeDirectMatches = 0;
        if (runtimePlan !== undefined) {
          for (const item of runtimeApplicable) {
            if (translatePluginUiValue(item.source, runtimePlan) === item.target) {
              runtimeDirectMatches += 1;
              continue;
            }
            const source = item.source.normalize("NFC").trim();
            const reason = source === item.target.normalize("NFC").trim() ? "identity"
              : source.includes("{{th:expr:") ? "template-placeholder"
                : item.source.length > 2_000 ? "too-long"
                  : !runtimePlan.exact.has(source) ? "no-exact-rule" : "other";
            runtimeDirectUnmatchedReasons[reason] = (runtimeDirectUnmatchedReasons[reason] ?? 0) + 1;
          }
        }
        const evidenceSymbols: Record<string, number> = {};
        for (const item of catalog.strings) {
          const symbol = item.evidence?.[0]?.symbol ?? "unknown";
          evidenceSymbols[symbol] = (evidenceSymbols[symbol] ?? 0) + 1;
        }
        rows.push({
          id,
          directory,
          hostEnabled: hostEnabled.has(id),
          localizerSelected: localizerSelected.has(id),
          installedVersion: manifest.version,
          cachedVersion: state.pluginCatalogs[id]?.pluginVersion ?? null,
          catalogStrings: catalog.strings.length,
          artifactDigest: catalog.artifactDigest,
          catalogDigest: catalog.digest,
          scopeDigests: catalog.catalogIdentity?.scopes.map((scope) => ({ scope: scope.scope, digest: scope.digest })) ?? [],
          structureDigest: catalogStructureDigest(catalog),
          ...(process.env.OBSIDIAN_AUDIT_KEYS_PLUGIN?.split(",").includes(id)
            ? { sourceKeys: catalog.strings.map((item) => item.key) }
            : {}),
          evidenceSymbols,
          nativeTargets: catalog.strings.filter((item) => item.nativeTargetLocale === targetLocale).length,
          translated: coverage.translatedCount,
          total: coverage.totalCount,
          missing: coverage.missingCount,
          ...(auditMissingReasons ? { missingSourceReasons } : {}),
          ...(auditMissingReasons ? { localInterfaceSourceCount,
            coverageDenominatorExcess: Math.max(coverage.totalCount - (localInterfaceSourceCount ?? 0), 0) } : {}),
          ...(runtimePlan === undefined ? {} : { runtimePlan: {
            applicable: runtimeApplicable.length,
            exactRules: runtimePlan.exact.size,
            templateRules: runtimePlan.templates.length,
            directMatches: runtimeDirectMatches,
            directUnmatchedReasons: runtimeDirectUnmatchedReasons,
          } }),
          exactVersion: coverage.exactPluginVersion,
          hasPublishedPack: savedTranslation !== undefined,
          ...(auditPatchEligibility ? { patchPreflight: {
            exactVersion,
            exactCatalog,
            staticLiteralSlots,
            exactLiteralPreview,
            reason: savedTranslation === undefined ? "no-pack"
              : !exactVersion ? "cross-version"
                : !exactCatalog ? "catalog-mismatch"
                  : staticLiteralSlots === 0 ? "no-static-literal"
                    : "static-candidate-needs-ui-proof",
          } } : {}),
          authorityVersion: savedTranslation?.authorityPluginVersion ?? savedTranslation?.pluginVersion ?? null,
          discoveryState: state.publicPluginDiscoveries[id]?.taskState ?? null,
          localizationStage: state.publicPluginDiscoveries[id]?.localizationProjection?.stage ?? null,
        });
      } catch (error) {
        rows.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const report = JSON.stringify({ targetLocale,
      scope: auditAllInstalled ? "all-installed" : "localizer-selected",
      selected: selected.length, rows });
    const output = process.env.OBSIDIAN_AUDIT_OUTPUT;
    if (output !== undefined) {
      const path = resolve(output);
      const vault = resolve(vaultRoot!);
      if (path === vault || path.startsWith(`${vault}${sep}`)) throw new Error("audit output must be outside the Vault");
      await writeFile(path, `${report}\n`, { flag: "wx", mode: 0o600 });
      process.stdout.write(`OBSIDIAN_LOCAL_SELECTED_AUDIT_FILE ${path}\n`);
    } else {
      process.stdout.write(`OBSIDIAN_LOCAL_SELECTED_AUDIT ${report}\n`);
    }
    const expected = process.env.OBSIDIAN_EXPECT_SELECTED_COUNT;
    if (expected !== undefined) expect(selected).toHaveLength(Number(expected));
    expect(rows.filter((row) => row.error !== undefined)).toEqual([]);
  }, 60_000);

  it.skipIf(process.env.OBSIDIAN_AUDIT_RUNTIME_PLUGIN === undefined)("builds an applicable runtime plan from a real local cached pack", async () => {
    const id = process.env.OBSIDIAN_AUDIT_RUNTIME_PLUGIN!;
    const configDir = join(vaultRoot!, ".obsidian");
    const stored = JSON.parse(await readFile(join(configDir, "plugins", OBSIDIAN_PLUGIN_ID, "data.json"), "utf8")) as {
      settings?: { targetLocale?: unknown }; state?: unknown;
    };
    const targetLocale = parseTargetLocale(stored.settings?.targetLocale);
    if (targetLocale === null) throw new Error("saved target locale is invalid");
    const state = parsePluginState(stored.state);
    const root = join(configDir, "plugins", id);
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as Record<string, unknown>;
    if (manifest.id !== id || typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      throw new Error("installed manifest identity is invalid");
    }
    const catalog = await scanPluginUiStrings({
      plugin: { id, name: manifest.name, version: manifest.version,
        description: typeof manifest.description === "string" ? manifest.description : "", dir: root, enabled: true },
      bundle: await readFile(join(root, "main.js"), "utf8"), sourceLocale: "en", targetLocale,
    });
    const applicable = selectApplicablePluginTranslations({
      ...state, pluginCatalogs: { ...state.pluginCatalogs, [id]: catalog },
    }, { targetLocale, excludedPluginIds: [], pluginMetadataTranslationEnabled: true });
    const plan = buildRuntimeTranslationPlan(applicable.filter((item) => item.pluginId === id));
    const matched = applicable.filter((item) => item.pluginId === id
      && translatePluginUiValue(item.source, plan) === item.target);
    process.stdout.write(`OBSIDIAN_LOCAL_RUNTIME_PLAN ${JSON.stringify({ id, applicable: applicable.length, matched: matched.length })}\n`);
    expect(matched.length).toBeGreaterThan(0);
  }, 30_000);

  it.skipIf(patchCyclePlugin === undefined)("applies and restores an exact real plugin patch in memory only", async () => {
    const id = patchCyclePlugin!;
    const configDir = join(vaultRoot!, ".obsidian");
    const saved = JSON.parse(await readFile(join(configDir, "plugins", OBSIDIAN_PLUGIN_ID, "data.json"), "utf8")) as {
      settings?: { targetLocale?: unknown }; state?: unknown;
    };
    const targetLocale = parseTargetLocale(saved.settings?.targetLocale);
    if (targetLocale === null) throw new Error("saved target locale is invalid");
    const state = parsePluginState(saved.state);
    const root = join(configDir, "plugins", id);
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as Record<string, unknown>;
    if (manifest.id !== id || typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      throw new Error("installed manifest identity is invalid");
    }
    const plugin = {
      id, name: manifest.name, version: manifest.version,
      description: typeof manifest.description === "string" ? manifest.description : "",
      dir: root, enabled: true,
    };
    const original = await readFile(join(root, "main.js"), "utf8");
    const catalog = await scanPluginUiStrings({ plugin, bundle: original, sourceLocale: "en", targetLocale });
    const translation = getPluginTranslation(state, id, targetLocale);
    const preview = await previewPublishedPluginFilePatch({ plugin, catalog, translation, original });
    expect(preview.kind).toBe("candidate");
    const memory = new MemoryPatchVault();
    memory.files.set(`${root}/main.js`, original);
    const vault = memory as unknown as Vault;

    const applied = await applyPublishedPluginFilePatch({ vault, plugin, catalog, translation });
    expect(applied).toEqual({ applied: preview.patchCount, skipped: 0, conflicts: 0 });
    expect(await inspectPluginFilePatch(vault, plugin)).toBe("active");
    expect((await logicalPluginBundle(vault, plugin)).content).toBe(original);
    expect(memory.files.get(`${root}/main.js`)).not.toBe(original);

    expect(await restorePublishedPluginFilePatch(vault, plugin)).toBe("restored");
    expect(memory.files.get(`${root}/main.js`)).toBe(original);
    expect(await inspectPluginFilePatch(vault, plugin)).toBe("none");

    expect((await applyPublishedPluginFilePatch({ vault, plugin, catalog, translation })).applied)
      .toBe(preview.patchCount);
    const externalEdit = `${memory.files.get(`${root}/main.js`)}\n// unrelated local edit`;
    memory.files.set(`${root}/main.js`, externalEdit);
    expect(await restorePublishedPluginFilePatch(vault, plugin)).toBe("conflict");
    expect(memory.files.get(`${root}/main.js`)).toBe(externalEdit);
    expect(await restorePublishedPluginFilePatch(vault, plugin, true)).toBe("restored");
    expect(memory.files.get(`${root}/main.js`)).toBe(original);
    process.stdout.write(`OBSIDIAN_LOCAL_PATCH_CYCLE ${JSON.stringify({
      id, pluginVersion: manifest.version, exactSlots: preview.patchCount,
      artifactDigest: catalog.artifactDigest, restored: true, externalEditPreserved: true,
    })}\n`);
  }, 30_000);
});

class MemoryPatchVault {
  readonly files = new Map<string, string>();
  readonly adapter = {
    exists: (path: string) => Promise.resolve(this.files.has(path)),
    read: (path: string) => {
      const value = this.files.get(path);
      return value === undefined
        ? Promise.reject(new Error(`missing in-memory file: ${path}`))
        : Promise.resolve(value);
    },
    write: (path: string, value: string) => { this.files.set(path, value); return Promise.resolve(); },
    remove: (path: string) => { this.files.delete(path); return Promise.resolve(); },
    rename: (from: string, to: string) => {
      const value = this.files.get(from);
      if (value === undefined) return Promise.reject(new Error(`missing in-memory rename source: ${from}`));
      this.files.delete(from);
      this.files.set(to, value);
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
    rmdir: () => Promise.resolve(),
  };
}
