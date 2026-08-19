import { getLanguage, Notice, Plugin } from "obsidian";

import { ActivationStore } from "./activation";
import { localizedClientName, setClientLocale, translate } from "./client-localization";
import { retireExpiredDerivedCache } from "./derived-cache-migration";
import { errorMessage } from "./error-message";
import { openSystemBrowser } from "./external-browser";
import { PluginManagerView, PLUGIN_MANAGER_VIEW_TYPE } from "./plugin-manager-view";
import { registerPluginTranslationCommands } from "./plugin-actions";
import {
  PluginAutomationController,
  type PluginScanResult,
} from "./plugin-automation";
import type { PluginSourceSnapshot } from "./plugin-picker-source";
import {
  refreshConfiguredPluginStatuses,
  synchronizeConfiguredPluginTranslations,
  type PluginSyncSummary,
} from "./plugin-sync";
import {
  describePluginSelectionProcessing,
  MAX_PENDING_TRANSLATION_QUICK_RETRIES,
  pendingTranslationPluginIds,
  pendingTranslationRetryDelay,
  PluginProcessingQueue,
  processPluginSelection,
  type PluginSelectionProcessingResult,
} from "./plugin-selection-processing";
import { resolveCommunityPluginIdentity } from "./plugin-registry";
import {
  EMPTY_PLUGIN_STATE,
  isPluginLocalizationDerivedCacheCurrent,
  parsePluginState,
  PLUGIN_LOCALIZATION_DERIVED_CACHE_REVISION,
  resetPluginLocalizationDerivedState,
  type PluginState,
} from "./plugin-state";
import {
  OBSIDIAN_AUTH_CALLBACK_ACTION,
  OBSIDIAN_ECOSYSTEM_SLUG,
  OBSIDIAN_SOURCE_LOCALE,
  TRANS_HUB_API_BASE_URL,
  TRANS_HUB_REGISTRATION_URL,
  TRANS_HUB_WEB_BASE_URL,
  resolveObsidianTargetLocale,
  type TargetLocale,
} from "./product-config";
import { TransHubSettingTab } from "./settings";
import { DEFAULT_SETTINGS, loadSettings, type TransHubPluginSettings } from "./settings-data";
import { ObsidianTranslationPackStore } from "./translation-pack-store";
import {
  submitObsidianLocalizationIssue,
  type ObsidianLocalizationIssueKind,
} from "./submission";

const AUTOMATION_INTERVAL_MS = 15 * 60 * 1000;

interface StoredPluginData {
  readonly pluginLocalizationDerivedCacheRevision?: unknown;
  readonly settings?: unknown;
  readonly state?: unknown;
}

export default class TransHubObsidianPlugin extends Plugin {
  override settings: TransHubPluginSettings = { ...DEFAULT_SETTINGS };
  private state: PluginState = EMPTY_PLUGIN_STATE;
  private activation!: ActivationStore;
  private pluginAutomation!: PluginAutomationController;
  private settingTab!: TransHubSettingTab;
  private translationPackStore!: ObsidianTranslationPackStore;
  private pendingRetryTimer: number | null = null;
  private pendingRetryAttempt = 0;
  private readonly pendingRetryPluginIds = new Set<string>();
  private readonly pluginProcessingQueue = new PluginProcessingQueue();
  private automaticPluginTranslationInFlight: Promise<void> | null = null;
  private targetLocaleRevision = 0;
  private resetPluginLocalizationDerivedCache = false;

  override async onload(): Promise<void> {
    this.loadPluginData(await this.loadData(), resolveObsidianTargetLocale(getLanguage()));
    this.applyClientLocale(this.settings.targetLocale);
    this.activation = new ActivationStore(this.app);
    this.translationPackStore = new ObsidianTranslationPackStore(
      this.app.vault,
      this.manifest.id,
    );
    if (this.resetPluginLocalizationDerivedCache) {
      const retired = await retireExpiredDerivedCache({
        clearAll: () => this.translationPackStore.clearAll(),
        persistCurrentRevision: async () => {
          this.resetPluginLocalizationDerivedCache = false;
          await this.savePluginData();
        },
        reportFailure: (error) => console.warn(
          "[Trans-Hub] failed to retire an expired localization cache; "
            + "the client will retry on next load",
          error,
        ),
      });
      this.resetPluginLocalizationDerivedCache = !retired;
    }
    this.registerObsidianProtocolHandler(
      OBSIDIAN_AUTH_CALLBACK_ACTION,
      async (parameters) => {
        try {
          await this.activation.completeBrowserAuthorization({
            apiBaseUrl: TRANS_HUB_API_BASE_URL,
            state: requiredProtocolParameter(parameters, "state"),
            authorityWorkspaceId: requiredProtocolParameter(parameters, "workspace_id"),
            linkingCode: requiredProtocolParameter(parameters, "linking_code"),
            bindingDigest: requiredProtocolParameter(parameters, "binding_digest"),
          });
          new Notice(translate("语枢已连接，此设备以后会自动恢复连接。"));
          this.settingTab.reportCommandStatus(translate("连接成功，正在同步所选插件…"), false);
          await this.runAutomaticPluginTranslation(true);
        } catch (error) {
          const message = error instanceof Error ? error.message : translate("语枢连接失败。");
          new Notice(message, 10_000);
          this.settingTab.reportCommandStatus(message, true);
        }
      },
    );
    this.pluginAutomation = new PluginAutomationController({
      app: this.app,
      ownPluginId: this.manifest.id,
      settings: () => this.settings,
      state: () => this.state,
      replaceState: (state) => { this.state = state; },
      save: () => this.savePluginData(),
      synchronize: (sourceSelectablePluginIds) => this.autoSyncInstalledPluginTranslations(sourceSelectablePluginIds),
    });
    this.settingTab = new TransHubSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerView(
      PLUGIN_MANAGER_VIEW_TYPE,
      (leaf) => new PluginManagerView(leaf, this.settingTab),
    );
    this.addCommand({
      id: "open-plugin-localization-manager",
      name: translate("打开插件本地化管理器"),
      callback: () => { void this.openPluginManager(); },
    });
    this.register(() => this.pluginAutomation.stop());
    this.register(() => this.clearPendingTranslationRetry());
    this.pluginAutomation.start();
    // Apply persisted translations immediately so settings windows and the
    // sidebar are localized from the stored state without waiting for the
    // first full scan+sync pass to finish.
    this.pluginAutomation.applyCachedTranslations();
    // Community-plugin reloads can occur after Obsidian has already emitted
    // layout-ready, so do not leave the persisted catalog stale until the
    // periodic pass runs.
    void this.runAutomaticPluginTranslation(true);
    this.app.workspace.onLayoutReady(() => {
      // All community plugins are registered by layout-ready; re-apply the
      // display names captured at onload so manifests loaded after ours are
      // localized too, and refresh an already-open settings window.
      this.pluginAutomation.applyPluginDisplayNames();
      this.pluginAutomation.localizeSettingsWindowNavigation();
      this.pluginAutomation.observeSettingsWindow();
      void this.runAutomaticPluginTranslation();
    });
    // Obsidian 1.13 keeps the settings window alive without workspace window
    // events, and its sidebar does not re-render from the manifest registry.
    // A lightweight tick keeps late-registered plugins and the open settings
    // window consistent without waiting for the next scan.
    this.registerInterval(window.setInterval(() => {
      this.pluginAutomation.applyPluginDisplayNames();
      this.pluginAutomation.localizeSettingsWindowNavigation();
      this.pluginAutomation.observeSettingsWindow();
    }, 2_000));
    this.registerInterval(window.setInterval(() => { void this.runAutomaticPluginTranslation(); }, AUTOMATION_INTERVAL_MS));
    registerPluginTranslationCommands(this, {
      scan: () => this.scanInstalledPluginStrings(),
      synchronize: () => this.syncInstalledPluginTranslations(),
      apply: () => this.applyCachedPluginTranslations(),
      reportStatus: (message, failed) => this.settingTab.reportCommandStatus(message, failed),
    });
  }

  async savePluginData(): Promise<void> {
    await this.saveData({
      pluginLocalizationDerivedCacheRevision:
        this.resetPluginLocalizationDerivedCache
          ? undefined
          : PLUGIN_LOCALIZATION_DERIVED_CACHE_REVISION,
      settings: this.settings,
      state: this.state,
    });
  }

  async connect(): Promise<void> {
    const url = await this.activation.beginBrowserAuthorization({
      webBaseUrl: TRANS_HUB_WEB_BASE_URL,
      ecosystemSlug: OBSIDIAN_ECOSYSTEM_SLUG,
      callbackAction: OBSIDIAN_AUTH_CALLBACK_ACTION,
    });
    await openSystemBrowser(url);
  }

  openRegistration(): Promise<void> {
    return openSystemBrowser(TRANS_HUB_REGISTRATION_URL);
  }

  disconnect(): void {
    this.activation.clear();
    this.state = structuredClone(EMPTY_PLUGIN_STATE);
    void this.savePluginData();
  }
  hasUserSession(): boolean { return this.activation.isConfigured(); }
  requiresReconnect(): boolean { return this.activation.requiresReconnect(); }
  getPluginState(): PluginState { return this.state; }
  getPluginSourceSnapshot(): PluginSourceSnapshot { return this.pluginAutomation.getSourceSnapshot(); }

  async openPluginManager(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(PLUGIN_MANAGER_VIEW_TYPE)[0];
    try {
      const leaf = this.app.workspace.openPopoutLeaf({
        size: { width: 960, height: 760 },
      });
      await leaf.setViewState({ type: PLUGIN_MANAGER_VIEW_TYPE, active: true });
      existingLeaf?.detach();
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) {
      if (existingLeaf !== undefined) {
        await this.app.workspace.revealLeaf(existingLeaf);
        return;
      }
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: PLUGIN_MANAGER_VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(leaf);
      console.warn("[Trans-Hub] failed to open the plugin manager in a separate window", error);
      new Notice(translate("此设备无法打开独立窗口，已在工作区中打开插件管理器。"), 10_000);
    }
  }

  refreshPluginManager(): void { this.settingTab.refreshPluginManager(); }

  updateObsidianPluginNavigationNames(
    plugins: Parameters<TransHubSettingTab["updateObsidianPluginNavigationNames"]>[0],
  ): void {
    this.settingTab.updateObsidianPluginNavigationNames(plugins);
  }

  applyClientLocale(locale: TransHubPluginSettings["targetLocale"]): void {
    setClientLocale(locale);
    this.manifest.name = localizedClientName();
  }

  async changeTargetLocale(
    targetLocale: TargetLocale,
  ): Promise<PluginSelectionProcessingResult | null> {
    const revision = ++this.targetLocaleRevision;
    this.settings.targetLocale = targetLocale;
    this.applyClientLocale(targetLocale);
    return this.pluginProcessingQueue.run(async () => {
      if (revision !== this.targetLocaleRevision) return null;
      await this.savePluginData();
      if (revision !== this.targetLocaleRevision) return null;
      this.refreshPluginTranslationRuntime();
      if (!this.activation.isConfigured() && targetLocale !== OBSIDIAN_SOURCE_LOCALE) {
        return null;
      }
      const result = await this.processPluginsNow(undefined, targetLocale, undefined);
      return revision === this.targetLocaleRevision ? result : null;
    });
  }

  scanInstalledPluginStrings(onlyPluginIds?: readonly string[]): Promise<PluginScanResult> {
    return this.pluginAutomation.scanInstalledPlugins(onlyPluginIds);
  }
  applyCachedPluginTranslations(): void { this.pluginAutomation.applyCachedTranslations(); }
  applyThirdPartyPluginFileTranslations(pluginIds: readonly string[]): Promise<{ readonly applied: number; readonly skipped: number; readonly conflicts: number }> {
    return this.pluginAutomation.applyThirdPartyFilePatches(pluginIds);
  }
  restoreThirdPartyPluginFiles(pluginIds?: readonly string[], force = false): Promise<{ readonly restored: number; readonly conflicts: number }> {
    return this.pluginAutomation.restoreThirdPartyFilePatches(pluginIds, force);
  }
  pluginFilePatchStates(pluginIds: readonly string[]): Promise<ReadonlyMap<string, boolean>> {
    return this.pluginAutomation.pluginFilePatchStates(pluginIds);
  }
  refreshPluginTranslationRuntime(): void { this.pluginAutomation.refreshRuntime(); }
  refreshPluginDisplayNames(): void { this.pluginAutomation.applyPluginDisplayNames(); }
  refreshSettingsWindowLocalization(): void { this.pluginAutomation.localizeSettingsWindowNavigation(); }

  processSelectedPlugins(
    resubmitRecoverableAuthorityObservations = false,
  ): Promise<PluginSelectionProcessingResult> {
    return this.processPlugins(
      undefined,
      resubmitRecoverableAuthorityObservations ? this.state.enabledPluginIds : undefined,
    );
  }

  processPluginIds(pluginIds: readonly string[]): Promise<PluginSelectionProcessingResult> {
    return this.processPlugins(pluginIds);
  }

  processSinglePlugin(
    pluginId: string,
    resubmitObservation = false,
  ): Promise<PluginSelectionProcessingResult> {
    return this.processPlugins(
      [pluginId],
      resubmitObservation ? [pluginId] : undefined,
    );
  }

  private async processPlugins(
    onlyPluginIds?: readonly string[],
    manualResubmitPluginIds?: readonly string[],
  ): Promise<PluginSelectionProcessingResult> {
    const targetLocale = this.settings.targetLocale;
    return this.pluginProcessingQueue.run(
      () => this.processPluginsNow(
        onlyPluginIds,
        targetLocale,
        manualResubmitPluginIds,
      ),
    );
  }

  private async processPluginsNow(
    onlyPluginIds: readonly string[] | undefined,
    targetLocale: TargetLocale,
    manualResubmitPluginIds: readonly string[] | undefined,
  ): Promise<PluginSelectionProcessingResult> {
    let selectablePluginIds = this.state.enabledPluginIds;
    const result = await processPluginSelection({
      scan: async () => {
        const scan = await this.scanInstalledPluginStrings(onlyPluginIds);
        selectablePluginIds = scan.selectablePluginIds;
        return scan;
      },
      hasSession: () => targetLocale === OBSIDIAN_SOURCE_LOCALE || this.activation.isConfigured(),
      synchronize: () => this.synchronizePluginTranslationsNow(
        onlyPluginIds,
        targetLocale,
        manualResubmitPluginIds,
        selectablePluginIds,
      ),
      applyCached: () => { this.applyCachedPluginTranslations(); },
    });
    if (targetLocale === this.settings.targetLocale) this.schedulePendingTranslationRetry(result);
    return result;
  }

  async reportPluginLocalizationIssue(input: {
    readonly issueKind: ObsidianLocalizationIssueKind;
    readonly pluginId: string;
    readonly pluginVersion: string;
    readonly sourceText: string;
    readonly currentTargetText?: string;
    readonly suggestedTargetText?: string;
  }): Promise<void> {
    const catalog = this.state.pluginCatalogs[input.pluginId];
    if (catalog === undefined || catalog.pluginVersion !== input.pluginVersion) {
      throw new Error(translate("插件目录已变化，请先在插件管理器中重新同步该插件。"));
    }
    const { client, bootstrap } = await this.activation.client({
      apiBaseUrl: TRANS_HUB_API_BASE_URL,
    });
    const identity = await resolveCommunityPluginIdentity(input.pluginId, input.pluginVersion);
    await submitObsidianLocalizationIssue({
      client,
      installationId: bootstrap.installationId,
      issueKind: input.issueKind,
      pluginId: input.pluginId,
      pluginVersion: input.pluginVersion,
      repository: identity.repository,
      targetLocale: this.settings.targetLocale,
      sourceText: input.sourceText,
      currentTargetText: input.currentTargetText,
      suggestedTargetText: input.suggestedTargetText,
    });
  }

  async syncInstalledPluginTranslations(
    onlyPluginIds?: readonly string[],
    sourceSelectablePluginIds?: readonly string[],
  ): Promise<PluginSyncSummary> {
    const targetLocale = this.settings.targetLocale;
    return this.pluginProcessingQueue.run(async () => {
      const selectablePluginIds = sourceSelectablePluginIds
        ?? (await this.scanInstalledPluginStrings(onlyPluginIds)).selectablePluginIds;
      return this.synchronizePluginTranslationsNow(
        onlyPluginIds,
        targetLocale,
        undefined,
        selectablePluginIds,
      );
    });
  }


  /** R-028/Phase 3: zero-write batch status refresh (never submits work). */
  async refreshPluginStatusBatch(onlyPluginIds?: readonly string[]): Promise<PluginSyncSummary> {
    const targetLocale = this.settings.targetLocale;
    if (targetLocale === OBSIDIAN_SOURCE_LOCALE) {
      return emptyPluginSyncSummary();
    }
    return refreshConfiguredPluginStatuses({
      apiBaseUrl: TRANS_HUB_API_BASE_URL,
      targetLocale,
      excludedPluginIds: this.settings.excludedPluginIds,
      ...(onlyPluginIds === undefined ? {} : { onlyPluginIds }),
      activationStore: this.activation,
      getState: () => this.state,
    });
  }

  private async synchronizePluginTranslationsNow(
    onlyPluginIds: readonly string[] | undefined,
    targetLocale: TargetLocale,
    manualResubmitPluginIds: readonly string[] | undefined,
    sourceSelectablePluginIds: readonly string[] = this.state.enabledPluginIds,
  ): Promise<PluginSyncSummary> {
    if (targetLocale === OBSIDIAN_SOURCE_LOCALE) {
      this.pluginAutomation.applyCachedTranslations();
      return emptyPluginSyncSummary();
    }
    const result = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: TRANS_HUB_API_BASE_URL,
      targetLocale,
      excludedPluginIds: this.settings.excludedPluginIds,
      ...(onlyPluginIds === undefined ? {} : { onlyPluginIds }),
      ...(manualResubmitPluginIds === undefined ? {} : { manualResubmitPluginIds }),
      sourceSelectablePluginIds,
      activationStore: this.activation,
      translationPackStore: this.translationPackStore,
      getState: () => this.state,
      replaceState: (state) => { this.state = state; },
      save: () => this.savePluginData(),
    });
    this.pluginAutomation.applyCachedTranslations();
    return result;
  }

  private loadPluginData(value: unknown, defaultTargetLocale: TransHubPluginSettings["targetLocale"]): void {
    const stored = isRecord(value) ? value as StoredPluginData : {};
    const legacySettings = isRecord(value) && "apiBaseUrl" in value ? value : stored.settings;
    this.settings = loadSettings(legacySettings, defaultTargetLocale);
    const parsedState = parsePluginState(stored.state);
    this.resetPluginLocalizationDerivedCache = !isPluginLocalizationDerivedCacheCurrent(
      stored.pluginLocalizationDerivedCacheRevision,
    );
    this.state = this.resetPluginLocalizationDerivedCache
      ? resetPluginLocalizationDerivedState(parsedState)
      : parsedState;
  }

  private runAutomaticPluginTranslation(announce = false): Promise<void> {
    if (this.automaticPluginTranslationInFlight !== null) {
      return this.automaticPluginTranslationInFlight;
    }
    const operation = this.runAutomaticPluginTranslationNow(announce);
    this.automaticPluginTranslationInFlight = operation;
    void operation.finally(() => {
      if (this.automaticPluginTranslationInFlight === operation) {
        this.automaticPluginTranslationInFlight = null;
      }
    });
    return operation;
  }

  private async runAutomaticPluginTranslationNow(announce: boolean): Promise<void> {
    try {
      const result = await this.processSelectedPlugins();
      if (announce) {
        this.settingTab.reportCommandStatus(describePluginSelectionProcessing(result), false);
      } else {
        // Periodic synchronization updates cards and persisted state, but it is
        // not a new user action and must not replace the last announced summary.
        this.settingTab.refreshPluginCards();
      }
    }
    catch (error) {
      const message = errorMessage(error);
      console.warn("[Trans-Hub] 插件自动翻译暂未完成", error);
      if (announce) this.settingTab.reportCommandStatus(message, true);
    }
  }

  private async autoSyncInstalledPluginTranslations(
    sourceSelectablePluginIds?: readonly string[],
  ): Promise<PluginSyncSummary> {
    if (!this.activation.isConfigured()) {
      return { submittedCount: 0, requestedCount: 0, pulledCount: 0, waitingCount: 0, translationCount: 0 };
    }
    return this.syncInstalledPluginTranslations(undefined, sourceSelectablePluginIds);
  }

  private schedulePendingTranslationRetry(
    result: PluginSelectionProcessingResult,
  ): void {
    const pluginIds = pendingTranslationPluginIds(result);
    if (pluginIds.length === 0) {
      if (this.pendingRetryPluginIds.size === 0) this.clearPendingTranslationRetry();
      return;
    }
    const retryAfterMs = result.kind === "synchronized"
      ? result.sync.nextRetryAfterMs
      : undefined;
    this.queuePendingTranslationRetry(pluginIds, retryAfterMs);
  }

  private queuePendingTranslationRetry(
    pluginIds: readonly string[],
    serverSuggestedMs?: number,
  ): void {
    for (const pluginId of pluginIds) this.pendingRetryPluginIds.add(pluginId);
    if (this.pendingRetryTimer !== null) return;
    if (this.pendingRetryAttempt >= MAX_PENDING_TRANSLATION_QUICK_RETRIES) {
      this.pendingRetryPluginIds.clear();
      return;
    }
    const delay = pendingTranslationRetryDelay(
      this.pendingRetryAttempt,
      serverSuggestedMs,
    );
    this.pendingRetryTimer = window.setTimeout(() => {
      this.pendingRetryTimer = null;
      this.pendingRetryAttempt += 1;
      const retryPluginIds = [...this.pendingRetryPluginIds];
      this.pendingRetryPluginIds.clear();
      void this.processPlugins(retryPluginIds)
        // Keep the last announced summary stable. This background pull still
        // persists fresh plugin data and refreshes the settings cards, but its
        // deliberately partial scan must not replace a full-scan summary.
        .then(() => { this.settingTab.refreshPluginCards(); })
        .catch((error: unknown) => {
          console.warn("[Trans-Hub] 等待译文自动回拉失败", error);
          this.queuePendingTranslationRetry(retryPluginIds);
        });
    }, delay);
  }

  private clearPendingTranslationRetry(): void {
    if (this.pendingRetryTimer !== null) window.clearTimeout(this.pendingRetryTimer);
    this.pendingRetryTimer = null;
    this.pendingRetryAttempt = 0;
    this.pendingRetryPluginIds.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function emptyPluginSyncSummary(): PluginSyncSummary {
  return {
    submittedCount: 0,
    requestedCount: 0,
    pulledCount: 0,
    waitingCount: 0,
    translationCount: 0,
    waitingPluginIds: [],
  };
}

function requiredProtocolParameter(
  parameters: Record<string, string>,
  name: string,
): string {
  const value = parameters[name];
  if (typeof value !== "string" || value === "") {
    throw new Error("浏览器返回的语枢授权信息不完整。");
  }
  return value;
}
