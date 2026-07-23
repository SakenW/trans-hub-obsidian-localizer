import { getLanguage, Notice, Plugin } from "obsidian";

import { ActivationStore } from "./activation";
import { localizedClientName, setClientLocale, translate } from "./client-localization";
import { errorMessage } from "./error-message";
import { registerPluginTranslationCommands } from "./plugin-actions";
import {
  PluginAutomationController,
  type PluginScanResult,
} from "./plugin-automation";
import { synchronizeConfiguredPluginTranslations, type PluginSyncSummary } from "./plugin-sync";
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
import { EMPTY_PLUGIN_STATE, parsePluginState, type PluginState } from "./plugin-state";
import {
  OBSIDIAN_AUTH_CALLBACK_ACTION,
  OBSIDIAN_ECOSYSTEM_SLUG,
  OBSIDIAN_SOURCE_LOCALE,
  TRANS_HUB_API_BASE_URL,
  TRANS_HUB_WEB_BASE_URL,
  resolveObsidianTargetLocale,
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

  override async onload(): Promise<void> {
    this.loadPluginData(await this.loadData(), resolveObsidianTargetLocale(getLanguage()));
    this.applyClientLocale(this.settings.targetLocale);
    this.activation = new ActivationStore(this.app);
    this.translationPackStore = new ObsidianTranslationPackStore(
      this.app.vault,
      this.manifest.id,
    );
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
          await this.processSelectedPlugins();
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
      synchronize: () => this.autoSyncInstalledPluginTranslations(),
    });
    this.settingTab = new TransHubSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.register(() => this.pluginAutomation.stop());
    this.register(() => this.clearPendingTranslationRetry());
    this.pluginAutomation.start();
    this.app.workspace.onLayoutReady(() => {
      void this.runAutomaticPluginTranslation();
    });
    this.registerInterval(window.setInterval(() => { void this.runAutomaticPluginTranslation(); }, AUTOMATION_INTERVAL_MS));
    registerPluginTranslationCommands(this, {
      scan: () => this.scanInstalledPluginStrings(),
      synchronize: () => this.syncInstalledPluginTranslations(),
      apply: () => this.applyCachedPluginTranslations(),
      reportStatus: (message, failed) => this.settingTab.reportCommandStatus(message, failed),
    });
  }

  async savePluginData(): Promise<void> {
    await this.saveData({ settings: this.settings, state: this.state });
  }

  async connect(): Promise<void> {
    const url = await this.activation.beginBrowserAuthorization({
      webBaseUrl: TRANS_HUB_WEB_BASE_URL,
      ecosystemSlug: OBSIDIAN_ECOSYSTEM_SLUG,
      callbackAction: OBSIDIAN_AUTH_CALLBACK_ACTION,
    });
    window.open(url, "_blank", "noopener,noreferrer");
  }

  disconnect(): void { this.activation.clear(); }
  hasUserSession(): boolean { return this.activation.isConfigured(); }
  requiresReconnect(): boolean { return this.activation.requiresReconnect(); }
  getPluginState(): PluginState { return this.state; }

  applyClientLocale(locale: TransHubPluginSettings["targetLocale"]): void {
    setClientLocale(locale);
    this.manifest.name = localizedClientName();
  }

  scanInstalledPluginStrings(onlyPluginIds?: readonly string[]): Promise<PluginScanResult> {
    return this.pluginAutomation.scanInstalledPlugins(onlyPluginIds);
  }
  applyCachedPluginTranslations(): void { this.pluginAutomation.applyCachedTranslations(); }
  refreshPluginTranslationRuntime(): void { this.pluginAutomation.refreshRuntime(); }

  processSelectedPlugins(): Promise<PluginSelectionProcessingResult> {
    return this.processPlugins();
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
    return this.pluginProcessingQueue.run(async () => {
      const result = await processPluginSelection({
        scan: () => this.scanInstalledPluginStrings(onlyPluginIds),
        hasSession: () => this.activation.isConfigured(),
        synchronize: () => this.syncInstalledPluginTranslations(
          onlyPluginIds,
          manualResubmitPluginIds,
        ),
        applyCached: () => { this.applyCachedPluginTranslations(); },
      });
      this.schedulePendingTranslationRetry(result);
      return result;
    });
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
      throw new Error(translate("插件目录已变化，请先重新处理该插件。"));
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
    manualResubmitPluginIds?: readonly string[],
  ): Promise<PluginSyncSummary> {
    if (this.settings.targetLocale === OBSIDIAN_SOURCE_LOCALE) {
      this.pluginAutomation.applyCachedTranslations();
      return emptyPluginSyncSummary();
    }
    const result = await synchronizeConfiguredPluginTranslations({
      apiBaseUrl: TRANS_HUB_API_BASE_URL,
      targetLocale: this.settings.targetLocale,
      excludedPluginIds: this.settings.excludedPluginIds,
      ...(onlyPluginIds === undefined ? {} : { onlyPluginIds }),
      ...(manualResubmitPluginIds === undefined ? {} : { manualResubmitPluginIds }),
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
    this.state = parsePluginState(stored.state);
  }

  private async runAutomaticPluginTranslation(): Promise<void> {
    try {
      const result = await this.processSelectedPlugins();
      this.settingTab.reportCommandStatus(describePluginSelectionProcessing(result), false);
    }
    catch (error) {
      const message = errorMessage(error);
      console.warn("[Trans-Hub] 插件自动翻译暂未完成", error);
      this.settingTab.reportCommandStatus(message, true);
    }
  }

  private async autoSyncInstalledPluginTranslations(): Promise<PluginSyncSummary> {
    if (!this.activation.isConfigured()) {
      return { submittedCount: 0, requestedCount: 0, pulledCount: 0, waitingCount: 0, translationCount: 0 };
    }
    return this.syncInstalledPluginTranslations();
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
        .then((result) => {
          this.settingTab.reportCommandStatus(
            describePluginSelectionProcessing(result),
            false,
          );
        })
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
