import type { App, EventRef } from "obsidian";

import {
  localizedPluginDisplayName,
  selectCurrentCatalogTranslations,
} from "./plugin-catalog-diff";
import {
  discoverInstalledPlugins,
  type InstalledObsidianPlugin,
} from "./plugin-discovery";
import {
  resolveCommunityPluginIdentity,
  resolveCommunityPluginSourceEligibility,
} from "./plugin-registry";
import {
  hasTrustedPublishedPluginVersion,
  isPluginSourceSelectable,
  type PluginSourceSnapshot,
  type PluginSourceState,
  trustedPublishedPluginVersions,
} from "./plugin-picker-source";
import {
  getPluginTranslation,
  setPluginTranslation,
  type PluginState,
  type PluginTranslationState,
} from "./plugin-state";
import {
  digestPluginBundle,
  scanPluginUiStrings,
  type PluginUiCatalog,
} from "./plugin-string-scanner";
import { PluginUiTranslationRuntime, type PluginUiTranslation } from "./plugin-ui-runtime";
import {
  applyPublishedPluginFilePatch,
  hasActivePluginFilePatch,
  logicalPluginBundle,
  restorePublishedPluginFilePatch,
} from "./third-party-plugin-patcher";
import type { PluginSyncSummary } from "./plugin-sync";
import { isTargetLocale, OBSIDIAN_SOURCE_LOCALE, type TargetLocale } from "./product-config";

export interface PluginAutomationSettings {
  readonly targetLocale: TargetLocale;
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
  readonly selectablePluginIds: readonly string[];
}

/** Data attribute that keeps the official title of a settings nav item so the rewrite can be reversed. */
const SETTINGS_NAV_ORIGINAL_ATTRIBUTE = "data-th-nav-original";

export class PluginAutomationController {
  private readonly runtime = new PluginUiTranslationRuntime();
  private windowOpenEvent: EventRef | null = null;
  private windowCloseEvent: EventRef | null = null;
  private sourceSnapshot: PluginSourceSnapshot = new Map();
  private readonly localizedDisplayNames = new Map<string, {
    readonly original: string;
    readonly manifest: { readonly name: string };
  }>();

  constructor(private readonly input: {
    readonly app: App;
    readonly ownPluginId: string;
    readonly settings: () => PluginAutomationSettings;
    readonly state: () => PluginState;
    readonly replaceState: (state: PluginState) => void;
    readonly save: () => Promise<void>;
    readonly synchronize: (sourceSelectablePluginIds?: readonly string[]) => Promise<PluginSyncSummary>;
  }) {}

  start(): void {
    if (!this.input.settings().pluginTranslationEnabled) return;
    this.applyPluginDisplayNames();
    this.localizeSettingsWindowNavigation();
    this.observeSettingsWindow();
    this.runtime.update(this.allTranslations());
    this.runtime.start();
    this.windowOpenEvent ??= this.input.app.workspace.on("window-open", (_workspaceWindow, window) => {
      this.runtime.start(window.document.body);
    });
    this.windowCloseEvent ??= this.input.app.workspace.on("window-close", (_workspaceWindow, window) => {
      this.runtime.stopRoot(window.document.body);
    });
  }

  stop(): void {
    if (this.windowOpenEvent !== null) {
      this.input.app.workspace.offref(this.windowOpenEvent);
      this.windowOpenEvent = null;
    }
    if (this.windowCloseEvent !== null) {
      this.input.app.workspace.offref(this.windowCloseEvent);
      this.windowCloseEvent = null;
    }
    this.runtime.stop();
    this.restorePluginDisplayNames();
    this.restoreSettingsWindowNavigation();
  }

  refreshRuntime(): void {
    // Stop through the controller so workspace listeners are removed too.
    // Calling the runtime directly leaves a stale window-open callback alive
    // after the user disables translation.
    this.stop();
    this.start();
  }

  async runAutomaticScan(): Promise<PluginScanResult | null> {
    if (!this.input.settings().pluginTranslationEnabled) return null;
    const result = await this.scanInstalledPlugins();
    await this.input.synchronize(result.selectablePluginIds);
    this.applyCachedTranslations();
    return result;
  }

  async scanInstalledPlugins(onlyPluginIds?: readonly string[]): Promise<PluginScanResult> {
    const settings = this.input.settings();
    const excluded = new Set(settings.excludedPluginIds);
    const discovered = await discoverInstalledPlugins(this.input.app, this.input.ownPluginId);
    const selected = discovered.filter((plugin) => plugin.enabled && !excluded.has(plugin.id));
    const eligibility = await resolveCommunityPluginSourceEligibility(selected.map((plugin) => plugin.id));
    const trustedPublished = trustedPublishedPluginVersions(this.input.state());
    const sourceSnapshot = new Map<string, {
      readonly pluginVersion: string;
      readonly source: PluginSourceState;
    }>();
    for (const plugin of selected) {
      const resolved = eligibility.get(plugin.id) ?? { kind: "unsupported" as const };
      sourceSnapshot.set(plugin.id, {
        pluginVersion: plugin.version,
        source: resolved.kind === "unsupported"
          && hasTrustedPublishedPluginVersion(trustedPublished, plugin.id, plugin.version)
          ? { kind: "published" }
          : resolved,
      });
    }
    this.sourceSnapshot = sourceSnapshot;
    const eligibleSelected = selected.filter((plugin) =>
      isPluginSourceSelectable(sourceSnapshot.get(plugin.id)?.source ?? { kind: "unsupported" }),
    );
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
      const { content: bundle } = await logicalPluginBundle(this.input.app.vault, plugin);
      const previous = catalogs[plugin.id];
      const artifactDigest = await digestPluginBundle(bundle);
      // The scanner is CPU-bound for large community bundles and runs on
      // Obsidian's UI thread. A matching exact artifact plus unchanged
      // manifest metadata is sufficient to reuse the immutable catalog.
      if (canReuseScannedPluginCatalog(previous, plugin, artifactDigest)) {
        catalogs[plugin.id] = previous;
        stringCount += previous.strings.length;
        continue;
      }
      const sourceSupported = eligibility.get(plugin.id)?.kind === "supported";
      const identity = sourceSupported
        ? await resolveCommunityPluginIdentity(plugin.id, plugin.version)
        : undefined;
      const catalog = await scanPluginUiStrings({
        plugin,
        bundle,
        sourceLocale: OBSIDIAN_SOURCE_LOCALE,
        targetLocale: settings.targetLocale,
        registryMetadata: {
          name: identity?.officialName ?? plugin.name,
          description: identity?.officialDescription ?? plugin.description,
        },
        ...(identity?.readmeMarkdown === undefined ? {} : { readmeMarkdown: identity.readmeMarkdown }),
      });
      stringCount += catalog.strings.length;
      const unchanged = previous?.digest === catalog.digest &&
        previous.artifactDigest === catalog.artifactDigest &&
        previous.pluginVersion === catalog.pluginVersion &&
        previous.patchEvidenceRevision === catalog.patchEvidenceRevision;
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
      selectablePluginIds: enabledPluginIds,
    };
  }

  getSourceSnapshot(): PluginSourceSnapshot { return this.sourceSnapshot; }

  applyCachedTranslations(): PluginAutomationSummary {
    const translations = this.allTranslations();
    if (this.input.settings().pluginTranslationEnabled) this.runtime.update(translations);
    this.applyPluginDisplayNames();
    this.localizeSettingsWindowNavigation();
    this.observeSettingsWindow();
    return this.summary();
  }

  /**
   * Obsidian 1.13 renders the settings sidebar from the in-memory plugin
   * registry, and community plugin code does not run in that window until its
   * own page is opened.  Localizing the registry display names from the main
   * window makes the sidebar titles translated from the first open.  This is
   * a reversible presentation-layer change: the original name is restored
   * when metadata localization is disabled or the plugin stops, and disk
   * manifests/identities are never touched.
   */
  applyPluginDisplayNames(): void {
    if (!this.input.settings().pluginMetadataTranslationEnabled) {
      this.restorePluginDisplayNames();
      return;
    }
    const manifests = this.pluginManifests();
    if (manifests === undefined) return;
    const state = this.input.state();
    const targetLocale = this.input.settings().targetLocale;
    for (const [pluginId, manifest] of Object.entries(manifests)) {
      if (pluginId === this.input.ownPluginId || manifest.name === "") continue;
      let previous = this.localizedDisplayNames.get(pluginId);
      if (previous === undefined) {
        previous = { original: manifest.name, manifest };
        this.localizedDisplayNames.set(pluginId, previous);
      }
      const localized = localizedPluginDisplayName(
        previous.original,
        state.pluginCatalogs[pluginId],
        getPluginTranslation(state, pluginId, targetLocale),
        targetLocale,
      );
      (manifest as { name: string }).name = localized === previous.original
        ? previous.original
        : localized;
    }
  }

  restorePluginDisplayNames(): void {
    for (const { original, manifest } of this.localizedDisplayNames.values()) {
      (manifest as { name: string }).name = original;
    }
    // Keep the map populated: `original` is the stable official name that the
    // settings-window nav restore reuses when Obsidian re-rendered a nav item
    // from the localized manifest (so no DOM attribute was ever recorded).
    // The controller is rebuilt on plugin reload, so the map cannot leak.
  }

  /**
   * The 1.13 settings window keeps a nav sidebar rendered from an early
   * registry snapshot and does not re-render it when the in-memory manifest
   * names change, and it does not emit workspace window events, so neither
   * manifest mutation nor the popout observer reaches it. Rewriting the nav
   * item titles in the live settings window from the main window keeps the
   * sidebar consistent from the first open. Original titles are preserved in
   * a data attribute and restored when metadata localization is disabled or
   * the plugin stops.
   */
  localizeSettingsWindowNavigation(): void {
    if (!this.input.settings().pluginMetadataTranslationEnabled) {
      this.restoreSettingsWindowNavigation();
      return;
    }
    const document = this.settingsWindowDocument();
    const manifests = this.pluginManifests();
    if (document === undefined || manifests === undefined) return;
    const state = this.input.state();
    const targetLocale = this.input.settings().targetLocale;
    for (const item of Array.from(
      document.querySelectorAll<HTMLElement>(".vertical-tab-nav-item[data-setting-id]"),
    )) {
      const pluginId = item.getAttribute("data-setting-id");
      if (pluginId === null || pluginId === "") continue;
      const manifest = manifests[pluginId];
      if (manifest === undefined) continue;
      const title = item.querySelector<HTMLElement>(".vertical-tab-nav-item-title");
      if (title === null) continue;
      const isOwn = pluginId === this.input.ownPluginId;
      const original = isOwn
        ? title.textContent ?? manifest.name
        : this.localizedDisplayNames.get(pluginId)?.original ?? manifest.name;
      // Record the official title even when Obsidian already rendered the
      // localized text (the manifest was rewritten before the sidebar was
      // rendered), so disabling metadata localization stays reversible.
      if (title.getAttribute(SETTINGS_NAV_ORIGINAL_ATTRIBUTE) === null) {
        title.setAttribute(SETTINGS_NAV_ORIGINAL_ATTRIBUTE, original);
      }
      const target = isOwn
        ? manifest.name
        : localizedPluginDisplayName(
            original,
            state.pluginCatalogs[pluginId],
            getPluginTranslation(state, pluginId, targetLocale),
            targetLocale,
          );
      if (target === "" || (title.textContent?.trim() ?? "") === target) continue;
      title.textContent = target;
    }
  }

  restoreSettingsWindowNavigation(): void {
    const document = this.settingsWindowDocument();
    if (document === undefined || !("querySelectorAll" in document)) return;
    const manifests = this.pluginManifests();
    for (const item of Array.from(
      document.querySelectorAll<HTMLElement>(".vertical-tab-nav-item[data-setting-id]"),
    )) {
      const pluginId = item.getAttribute("data-setting-id");
      if (pluginId === null || pluginId === "") continue;
      const title = item.querySelector<HTMLElement>(".vertical-tab-nav-item-title");
      if (title === null) continue;
      const original = title.getAttribute(SETTINGS_NAV_ORIGINAL_ATTRIBUTE)
        ?? this.localizedDisplayNames.get(pluginId)?.original
        ?? manifests?.[pluginId]?.name;
      if (original !== undefined && original !== "" && title.textContent !== original) {
        title.textContent = original;
      }
      title.removeAttribute(SETTINGS_NAV_ORIGINAL_ATTRIBUTE);
    }
  }

  /**
   * Obsidian 1.13 renders community-plugin settings pages lazily inside the
   * standalone settings window, which never emits workspace window events,
   * so the runtime observer never reaches that document on its own. Attaching
   * it to the settings window body from the main window translates the page
   * content when it is opened or switched, with the same reversible rules as
   * every other observed root.
   */
  observeSettingsWindow(): void {
    if (!this.input.settings().pluginTranslationEnabled) return;
    const document = this.settingsWindowDocument();
    if (document?.body === null || document?.body === undefined) return;
    this.runtime.start(document.body);
  }

  private pluginManifests(): Readonly<Record<string, { readonly name: string }>> | undefined {
    const manager = Reflect.get(this.input.app, "plugins") as
      | { readonly manifests?: Readonly<Record<string, { readonly name: string }>> }
      | undefined;
    return manager?.manifests;
  }

  private settingsWindowDocument(): Document | undefined {
    const setting = Reflect.get(this.input.app, "setting") as
      | { readonly win?: unknown }
      | undefined;
    const win = setting?.win;
    if (typeof win !== "object" || win === null || !("document" in win)) return undefined;
    return (win as { readonly document?: Document }).document;
  }

  async applyThirdPartyFilePatches(pluginIds: readonly string[]): Promise<{ readonly applied: number; readonly skipped: number; readonly conflicts: number }> {
    const plugins = await discoverInstalledPlugins(this.input.app, this.input.ownPluginId);
    const selectedIds = new Set(pluginIds);
    let applied = 0; let skipped = 0; let conflicts = 0;
    for (const plugin of plugins.filter((item) => selectedIds.has(item.id) && item.enabled && !this.input.settings().excludedPluginIds.includes(item.id))) {
      const result = await applyPublishedPluginFilePatch({
        vault: this.input.app.vault,
        plugin,
        catalog: this.input.state().pluginCatalogs[plugin.id],
        translation: getPluginTranslation(this.input.state(), plugin.id, this.input.settings().targetLocale),
      });
      applied += result.applied; skipped += result.skipped; conflicts += result.conflicts;
    }
    return { applied, skipped, conflicts };
  }

  async restoreThirdPartyFilePatches(
    pluginIds?: readonly string[],
    force = false,
  ): Promise<{ readonly restored: number; readonly conflicts: number }> {
    const plugins = await discoverInstalledPlugins(this.input.app, this.input.ownPluginId);
    const selectedIds = pluginIds === undefined ? null : new Set(pluginIds);
    let restored = 0; let conflicts = 0;
    for (const plugin of plugins.filter(
      (item) => selectedIds === null || selectedIds.has(item.id),
    )) {
      const result = await restorePublishedPluginFilePatch(this.input.app.vault, plugin, force);
      if (result === "restored") restored += 1;
      if (result === "conflict") conflicts += 1;
    }
    return { restored, conflicts };
  }

  async pluginFilePatchStates(
    pluginIds: readonly string[],
  ): Promise<ReadonlyMap<string, boolean>> {
    const plugins = await discoverInstalledPlugins(this.input.app, this.input.ownPluginId);
    const selectedIds = new Set(pluginIds);
    const states = new Map<string, boolean>();
    for (const plugin of plugins.filter((item) => selectedIds.has(item.id))) {
      states.set(plugin.id, await hasActivePluginFilePatch(this.input.app.vault, plugin));
    }
    return states;
  }

  async importTranslationDictionary(raw: string): Promise<PluginTranslationState> {
    const imported = parseTranslationDictionary(raw);
    if (!isTargetLocale(imported.targetLocale)) {
      throw new Error("插件译文字典目标语言不受支持。");
    }
    const state = this.input.state();
    this.input.replaceState(setPluginTranslation(
      state,
      imported.pluginId,
      imported.targetLocale,
      imported,
    ));
    await this.input.save();
    this.runtime.update(this.allTranslations());
    return imported;
  }

  summary(): PluginAutomationSummary {
    const state = this.input.state();
    const targetLocale = this.input.settings().targetLocale;
    const translations = Object.keys(state.pluginTranslations)
      .map((pluginId) => getPluginTranslation(state, pluginId, targetLocale))
      .filter((translation): translation is PluginTranslationState => translation !== undefined);
    return {
      catalogCount: Object.keys(state.pluginCatalogs).length,
      sourceStringCount: Object.values(state.pluginCatalogs).reduce((sum, catalog) => sum + catalog.strings.length, 0),
      translatedPluginCount: translations.length,
      translationCount: translations.reduce((sum, dictionary) => sum + dictionary.entries.length, 0),
    };
  }

  private allTranslations(): PluginUiTranslation[] {
    return selectApplicablePluginTranslations(this.input.state(), this.input.settings());
  }
}

export function canReuseScannedPluginCatalog(
  previous: PluginUiCatalog | undefined,
  plugin: Pick<InstalledObsidianPlugin, "name" | "version">,
  artifactDigest: string,
): boolean {
  return previous?.catalogIdentity !== undefined
    && previous.pluginVersion === plugin.version
    && previous.pluginName === plugin.name
    && previous.artifactDigest === artifactDigest
    && previous.patchEvidenceRevision === 10;
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
  return [...enabled]
    .filter((pluginId) => !excluded.has(pluginId))
    .map((pluginId) => getPluginTranslation(state, pluginId, settings.targetLocale))
    .filter((dictionary): dictionary is PluginTranslationState => dictionary !== undefined)
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
    targetLocale: requiredTargetLocale(value.targetLocale),
    entries,
    pulledAt: new Date().toISOString(),
  };
}

function requiredTargetLocale(value: unknown): TargetLocale {
  if (!isTargetLocale(value)) throw new Error("插件译文字典目标语言不受支持。");
  return value;
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
