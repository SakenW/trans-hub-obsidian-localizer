import type { App } from "obsidian";

import { selectCurrentCatalogTranslations } from "./plugin-catalog-diff";
import { discoverInstalledPlugins, readPluginBundle } from "./plugin-discovery";
import {
  resolveCommunityPluginIdentity,
  resolveCommunityPluginSourceEligibility,
} from "./plugin-registry";
import type { PluginState, PluginTranslationState } from "./plugin-state";
import { scanPluginUiStrings } from "./plugin-string-scanner";
import { PluginUiTranslationRuntime, type PluginUiTranslation } from "./plugin-ui-runtime";
import type { PluginSyncSummary } from "./plugin-sync";
import { OBSIDIAN_SOURCE_LOCALE } from "./product-config";

export interface PluginAutomationSettings {
  readonly targetLocale: string;
  readonly pluginTranslationEnabled: boolean;
  readonly pluginMetadataTranslationEnabled: boolean;
  readonly excludedPluginIds: readonly string[];
}

export interface PluginAutomationSummary {
  readonly catalogCount: number;
  readonly sourceStringCount: number;
  readonly translatedPluginCount: number;
  readonly translationCount: number;
}

export interface PluginScanResult {
  readonly discoveredCount: number;
  readonly scannedCount: number;
  readonly changedCount: number;
  readonly stringCount: number;
}

export class PluginAutomationController {
  private readonly runtime = new PluginUiTranslationRuntime();

  constructor(private readonly input: {
    readonly app: App;
    readonly ownPluginId: string;
    readonly settings: () => PluginAutomationSettings;
    readonly state: () => PluginState;
    readonly replaceState: (state: PluginState) => void;
    readonly save: () => Promise<void>;
    readonly synchronize: () => Promise<PluginSyncSummary>;
  }) {}

  start(): void {
    if (!this.input.settings().pluginTranslationEnabled) return;
    this.runtime.update(this.allTranslations());
    this.runtime.start();
  }

  stop(): void { this.runtime.stop(); }

  refreshRuntime(): void {
    this.runtime.stop();
    this.start();
  }

  async runAutomaticScan(): Promise<PluginScanResult | null> {
    if (!this.input.settings().pluginTranslationEnabled) return null;
    const result = await this.scanInstalledPlugins();
    await this.input.synchronize();
    this.applyCachedTranslations();
    return result;
  }

  async scanInstalledPlugins(onlyPluginIds?: readonly string[]): Promise<PluginScanResult> {
    const settings = this.input.settings();
    const excluded = new Set(settings.excludedPluginIds);
    const discovered = await discoverInstalledPlugins(this.input.app, this.input.ownPluginId);
    const selected = discovered.filter((plugin) => plugin.enabled && !excluded.has(plugin.id));
    const eligibility = await resolveCommunityPluginSourceEligibility(selected.map((plugin) => plugin.id));
    const eligibleSelected = selected.filter((plugin) => eligibility.get(plugin.id)?.kind === "supported");
    const only = onlyPluginIds === undefined ? null : new Set(onlyPluginIds);
    const candidates = only === null
      ? eligibleSelected
      : eligibleSelected.filter((plugin) => only.has(plugin.id));
    const enabledPluginIds = eligibleSelected.map((plugin) => plugin.id);
    const activeIds = new Set(enabledPluginIds);
    const catalogs = Object.fromEntries(
      Object.entries(this.input.state().pluginCatalogs).filter(([pluginId]) => activeIds.has(pluginId)),
    );
    let changedCount = 0;
    let stringCount = 0;
    for (const plugin of candidates) {
      const bundle = await readPluginBundle(this.input.app.vault, plugin);
      const identity = await resolveCommunityPluginIdentity(plugin.id, plugin.version);
      const catalog = await scanPluginUiStrings({
        plugin,
        bundle,
        sourceLocale: OBSIDIAN_SOURCE_LOCALE,
        registryMetadata: {
          name: identity.officialName,
          description: identity.officialDescription,
        },
        ...(identity.readmeMarkdown === undefined ? {} : { readmeMarkdown: identity.readmeMarkdown }),
      });
      stringCount += catalog.strings.length;
      const previous = catalogs[plugin.id];
      const unchanged = previous?.digest === catalog.digest &&
        previous.artifactDigest === catalog.artifactDigest &&
        previous.pluginVersion === catalog.pluginVersion;
      if (!unchanged) changedCount += 1;
      catalogs[plugin.id] = unchanged ? { ...catalog, scannedAt: previous.scannedAt } : catalog;
    }
    this.input.replaceState({ ...this.input.state(), enabledPluginIds, pluginCatalogs: catalogs });
    await this.input.save();
    return {
      discoveredCount: discovered.length,
      scannedCount: candidates.length,
      changedCount,
      stringCount,
    };
  }

  applyCachedTranslations(): PluginAutomationSummary {
    const translations = this.allTranslations();
    if (this.input.settings().pluginTranslationEnabled) this.runtime.update(translations);
    return this.summary();
  }

  async importTranslationDictionary(raw: string): Promise<PluginTranslationState> {
    const imported = parseTranslationDictionary(raw);
    const state = this.input.state();
    this.input.replaceState({
      ...state,
      pluginTranslations: { ...state.pluginTranslations, [imported.pluginId]: imported },
    });
    await this.input.save();
    this.runtime.update(this.allTranslations());
    return imported;
  }

  summary(): PluginAutomationSummary {
    const state = this.input.state();
    return {
      catalogCount: Object.keys(state.pluginCatalogs).length,
      sourceStringCount: Object.values(state.pluginCatalogs).reduce((sum, catalog) => sum + catalog.strings.length, 0),
      translatedPluginCount: Object.keys(state.pluginTranslations).length,
      translationCount: Object.values(state.pluginTranslations).reduce((sum, dictionary) => sum + dictionary.entries.length, 0),
    };
  }

  private allTranslations(): PluginUiTranslation[] {
    return selectApplicablePluginTranslations(this.input.state(), this.input.settings());
  }
}

export function selectApplicablePluginTranslations(
  state: PluginState,
  settings: Pick<
    PluginAutomationSettings,
    "excludedPluginIds" | "pluginMetadataTranslationEnabled" | "targetLocale"
  >,
): PluginUiTranslation[] {
  const excluded = new Set(settings.excludedPluginIds);
  const enabled = new Set(state.enabledPluginIds);
  return Object.values(state.pluginTranslations)
    .filter((dictionary) => dictionary.targetLocale === settings.targetLocale
      && enabled.has(dictionary.pluginId)
      && !excluded.has(dictionary.pluginId))
    .flatMap((dictionary) => selectCurrentCatalogTranslations(
      state.pluginCatalogs[dictionary.pluginId],
      dictionary,
      settings.pluginMetadataTranslationEnabled,
    ));
}

function parseTranslationDictionary(raw: string): PluginTranslationState {
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; }
  catch { throw new Error("插件译文字典不是有效 JSON。"); }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error("插件译文字典格式无效。");
  }
  const pluginId = requiredString(value.pluginId);
  const entries = value.entries.map((entry): PluginUiTranslation => {
    if (!isRecord(entry)) throw new Error("插件译文字典条目无效。");
    const provenanceKind = optionalProvenanceKind(entry.provenanceKind);
    const application = optionalApplication(entry.application);
    const nativeTarget = typeof entry.nativeTarget === "string" ? requiredString(entry.nativeTarget) : undefined;
    if (
      (application === "correction" && (provenanceKind !== "th-reviewed-correction" || nativeTarget === undefined))
      || (provenanceKind === "th-reviewed-correction" && application !== "correction")
      || (nativeTarget !== undefined && application !== "correction")
    ) {
      throw new Error("插件校订条目缺少已审核的原生目标。");
    }
    return {
      pluginId,
      source: requiredString(entry.source),
      target: requiredString(entry.target),
      ...(provenanceKind === undefined ? {} : { provenanceKind }),
      ...(application === undefined ? {} : { application }),
      ...(nativeTarget === undefined ? {} : { nativeTarget }),
    };
  });
  return {
    pluginId,
    pluginVersion: requiredString(value.pluginVersion),
    sourceVersionId: typeof value.sourceVersionId === "string" ? value.sourceVersionId : "manual-import",
    targetLocale: requiredString(value.targetLocale),
    entries,
    pulledAt: new Date().toISOString(),
  };
}

function optionalProvenanceKind(value: unknown): PluginUiTranslation["provenanceKind"] {
  if (value === undefined) return undefined;
  if (value === "upstream-native" || value === "th-reviewed-fill"
    || value === "th-reviewed-correction" || value === "th-automatic"
    || value === "th-published") return value;
  throw new Error("插件译文字典来源无效。");
}

function optionalApplication(value: unknown): PluginUiTranslation["application"] {
  if (value === undefined) return undefined;
  if (value === "fill" || value === "correction") return value;
  throw new Error("插件译文字典应用方式无效。");
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error("插件译文字典字段缺失。");
  return value.normalize("NFC").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
