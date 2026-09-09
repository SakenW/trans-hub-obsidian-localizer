import {
  App,
  type ButtonComponent,
  Notice,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
} from "obsidian";

import { errorMessage } from "./error-message";
import { describeMissingTranslations } from "./plugin-missing-translations";
import { isClientDisplayName, localizedClientName, translate } from "./client-localization";
import type TransHubObsidianPlugin from "./main";
import { localizedPluginDescription, localizedPluginDisplayName } from "./plugin-catalog-diff";
import { discoverInstalledPlugins, type InstalledObsidianPlugin } from "./plugin-discovery";
import { getPluginSubmissionForLocale, getPluginTranslation } from "./plugin-state";
import {
  filterSelectablePlugins,
  selectedPluginCount,
  setAllPluginsSelected,
  setPluginSelected,
} from "./plugin-selection";
import {
  isPluginSourceSelectable,
  resolveInstalledPluginSources,
  trustedPublishedPluginVersions,
  type InstalledPluginWithSource,
  type PluginSourceState,
} from "./plugin-picker-source";
import {
  describePluginSelectionProcessing,
  pluginSelectionNeedsAttention,
} from "./plugin-selection-processing";
import {
  capturePluginListScrollTop,
  restorePluginListScrollTop,
} from "./plugin-picker-scroll";
import {
  describePluginLocalizationStatus,
  visiblePluginManualRetryKind,
  type PluginManualRetryKind,
} from "./plugin-localization-status";
import {
  renderPluginPickerCatalogMismatchDetails,
  renderPluginPickerCoverageDetails,
} from "./plugin-picker-status-details";
import {
  TARGET_LOCALE_OPTIONS,
  TRANS_HUB_OBSIDIAN_ECOSYSTEM_URL,
  TRANS_HUB_WEB_BASE_URL,
  parseTargetLocale,
} from "./product-config";

import { PLUGIN_PICKER_FILTERS, presentPluginLocalization, type PluginPickerDisplayKind } from "./plugin-picker-presentation";
import { describeFileRestore, renderPluginPatchControls } from "./plugin-patch-controls";
import type { PluginStatusReadResult } from "./plugin-sync";
import type { PluginFilePatchState } from "./third-party-plugin-patcher";

const ORIGINAL_PLUGIN_NAME_ATTRIBUTE = "data-trans-hub-official-plugin-name";

export class TransHubSettingTab extends PluginSettingTab {
  private renderVersion = 0;
  private selectionRevision = 0;
  private selectionProcessing: Promise<void> | null = null;
  private selectionStatus = translate("选择变化后会自动扫描并同步。");
  private selectionStatusFailed = false;
  private readonly selectionProcessingPluginIds = new Set<string>();
  private readonly pendingSelectionPluginIds = new Set<string>();
  private pluginListScrollTop = 0;
  private pluginSearchQuery = "";
  private pluginStatusFilter: PluginPickerDisplayKind | "all" = "all";
  private patchStateByPluginId = new Map<string, PluginFilePatchState>();
  private selectionStatusAt: Date | null = null;
  private connectionPending = false;
  private managerActionPending = false;
  private readonly stalePluginIds = new Set<string>();
  private renderedContainerEl: HTMLElement | null = null;
  private managerContainerEl: HTMLElement | null = null;
  private managerStatusEl: HTMLElement | null = null;

  constructor(app: App, private readonly plugin: TransHubObsidianPlugin) {
    super(app, plugin);
  }

  reportCommandStatus(message: string, failed: boolean): void {
    this.selectionStatus = message;
    this.selectionStatusFailed = failed;
    this.selectionStatusAt = new Date();
    // Browser authorization can finish while this form remains open. Rebuild
    // it so renderConnection() observes the newly persisted session.
    this.refreshSettings();
  }

  /**
   * Update only the picker status line instead of rebuilding the whole list.
   * Intermediate sync states ("正在…") change far more often than plugin row
   * content; rebuilding the list for every state change is what made the
   * manager stutter and the status line jump.
   */
  private updateStatusLine(): void {
    const status = this.managerStatusEl;
    if (status === null || !status.isConnected) {
      this.refreshSettings();
      return;
    }
    this.selectionStatusAt = new Date();
    status.setText(this.describeLastAction());
    status.toggleClass("mod-warning", this.selectionStatusFailed);
    status.setAttr("role", "status");
    status.setAttr("aria-live", "polite");
  }

  refreshPluginCards(statusRead?: PluginStatusReadResult, checkedPluginIds: readonly string[] = []): void {
    this.updateStalePluginStatus(statusRead, checkedPluginIds);
    this.refreshPluginManager();
    void this.refreshObsidianPluginNavigationNames();
  }

  private updateStalePluginStatus(statusRead: PluginStatusReadResult | undefined, checkedPluginIds: readonly string[]): void {
    if (statusRead === undefined) return;
    for (const pluginId of checkedPluginIds) this.stalePluginIds.delete(pluginId);
    if (statusRead.kind === "stale") for (const pluginId of statusRead.failedPluginIds) this.stalePluginIds.add(pluginId);
  }

  mountPluginManager(containerEl: HTMLElement): void {
    this.managerContainerEl = containerEl;
    this.refreshPluginManager();
  }

  unmountPluginManager(containerEl: HTMLElement): void {
    if (this.managerContainerEl === containerEl) this.managerContainerEl = null;
  }

  refreshPluginManager(): void {
    const containerEl = this.managerContainerEl;
    if (containerEl === null || !containerEl.isConnected) return;
    this.pluginListScrollTop = capturePluginListScrollTop(containerEl, this.pluginListScrollTop);
    const renderVersion = ++this.renderVersion;
    containerEl.empty();
    containerEl.addClass("trans-hub-plugin-manager__content");
    containerEl.createDiv({
      text: translate("正在读取已启用插件…"),
      cls: "trans-hub-plugin-picker__empty setting-item-description",
    });
    void this.renderPluginPicker(containerEl, renderVersion);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      name: localizedClientName(),
      desc: translate("连接语枢、选择目标语言和需要本地化的插件。"),
      aliases: [
        translate("启用插件本地化"),
        translate("翻译插件名称和说明"),
        translate("译文语言"),
        translate("选择插件"),
      ],
      render: (setting) => {
        // Obsidian 1.13 renders custom definitions inside a native
        // `.setting-item`, whose flex layout must not become the page layout.
        setting.settingEl.empty();
        setting.settingEl.removeClass("trans-hub-settings");
        setting.settingEl.addClass("trans-hub-settings-host");
        this.renderSettings(setting.settingEl.createDiv());
      },
    }];
  }

  // Obsidian 1.12 and earlier require display(); 1.13+ uses getSettingDefinitions().
  override display(): void {
    this.renderSettings(this.containerEl);
  }

  private renderSettings(containerEl: HTMLElement): void {
    this.renderedContainerEl = containerEl;
    containerEl.empty();
    containerEl.addClass("trans-hub-settings");
    const header = containerEl.createEl("header", { cls: "trans-hub-settings__header" });
    const title = header.createDiv({ text: localizedClientName(), cls: "trans-hub-settings__title" });
    title.setAttrs({ role: "heading", "aria-level": "2" });
    header.createEl("p", {
      text: translate("为已启用的社区插件显示译文。默认不修改插件文件，始终不修改笔记正文。"),
      cls: "trans-hub-settings__summary",
    });
    const facts = header.createDiv({ cls: "trans-hub-settings__facts" });
    facts.createSpan({ text: translate("插件自带译文优先") });
    facts.createSpan({ text: translate("仅处理已选插件") });
    facts.createSpan({ text: translate("译文按版本匹配") });
    const scope = header.createEl("details", { cls: "trans-hub-settings__scope" });
    scope.createEl("summary", {
      text: translate("仅支持官方社区插件"),
      cls: "trans-hub-settings__scope-label",
    });
    scope.createEl("p", {
      text: translate("仅处理官方社区目录中来源可验证的插件；未收录或来源暂时无法确认时，会保留原文并显示原因。"),
      cls: "trans-hub-settings__scope-description",
    });
    header.createEl("p", {
      text: translate("当前多数译文由机器翻译生成，未经人工校对；插件管理器会标明译文来源。"),
      cls: "trans-hub-settings__notice",
    });
    this.renderConnection(containerEl);
    const preferencesHeading = new Setting(containerEl).setName(translate("本地化设置")).setHeading();
    preferencesHeading.settingEl.addClass("trans-hub-settings__section-heading");
    const preferences = containerEl.createDiv({ cls: "trans-hub-settings__group" });
    addToggleSetting(
      preferences,
      translate("启用插件本地化"),
      translate("关闭后立即恢复被运行时替换的原文；重新开启后继续应用所选插件的已发布译文。"),
      this.plugin.settings.pluginTranslationEnabled,
      async (value) => {
        this.plugin.settings.pluginTranslationEnabled = value;
        await this.plugin.savePluginData();
        await this.plugin.refreshPluginTranslationRuntime();
        if (value) await this.refreshSelectedPlugins(preferences);
        else this.refreshSettings();
      },
    );

    const localeSetting = new Setting(preferences)
      .setName(translate("译文语言"))
      .setDesc(translate("优先保留插件自带的目标语言，补齐仍显示原文的界面。语枢自身界面目前支持简体中文和英语，其他语言使用英语界面。"))
      .addDropdown((dropdown) => {
        dropdown.addOptions(Object.fromEntries(TARGET_LOCALE_OPTIONS.map((option) => [option.value, option.label])));
        dropdown.setValue(this.plugin.settings.targetLocale).setDisabled(!this.plugin.settings.pluginTranslationEnabled)
          .onChange(async (value) => {
            const targetLocale = parseTargetLocale(value);
            this.selectionStatus = translate("正在切换目标语言…");
            this.selectionStatusFailed = false;
            this.selectionStatusAt = new Date();
            try {
              const result = await this.plugin.changeTargetLocale(targetLocale);
              if (result !== null && this.plugin.settings.targetLocale === targetLocale) {
                this.selectionStatus = describePluginSelectionProcessing(result);
                this.selectionStatusFailed = pluginSelectionNeedsAttention(result);
                if (result.kind === "synchronized") this.updateStalePluginStatus(result.sync.statusRead, result.sync.statusReadPluginIds ?? []);
              } else if (!this.plugin.hasUserSession()) {
                this.selectionStatus = translate("已切换目标语言；登录语枢后会继续同步。");
              }
            } catch (error) {
              this.selectionStatus = errorMessage(error);
              this.selectionStatusFailed = true;
              new Notice(this.selectionStatus, 10_000);
            } finally { this.refreshSettings(); }
          });
      });
    localeSetting.settingEl.toggleClass("is-disabled", !this.plugin.settings.pluginTranslationEnabled);

    const pluginHeading = new Setting(containerEl).setName(translate("插件管理")).setHeading();
    pluginHeading.settingEl.addClass("trans-hub-settings__section-heading");
    new Setting(containerEl)
      .setName(translate("管理已安装插件"))
      .setDesc(translate("勾选后自动获取译文，首次收录需要一些时间。"))
      .addButton((button) => button
        .setButtonText(translate("打开插件管理器"))
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          try {
            // Obsidian's settings host can stay above workspace popouts.
            // Close it before revealing the manager, including an existing one.
            const host = this.app as typeof this.app & { setting?: { close?: () => void } };
            host.setting?.close?.();
            await this.plugin.openPluginManager();
          } catch (error) {
            new Notice(errorMessage(error), 10_000);
          } finally { button.setDisabled(false); }
        }));

    this.renderFileRecovery(containerEl);
    const advancedDetails = containerEl.createEl("details", { cls: "trans-hub-settings__advanced" });
    advancedDetails.createEl("summary", { text: translate("高级选项") });
    const advanced = advancedDetails.createDiv({ cls: "trans-hub-settings__group" });
    addToggleSetting(
      advanced,
      translate("翻译插件名称和说明"),
      translate("默认开启。开启时显示译名和译文说明；关闭时显示官方名称和原始说明。尚无名称译文的插件会保留官方名称。"),
      this.plugin.settings.pluginMetadataTranslationEnabled,
      async (value) => {
        this.plugin.settings.pluginMetadataTranslationEnabled = value;
        await this.plugin.savePluginData();
        await this.plugin.refreshPluginTranslationRuntime();
        this.plugin.refreshPluginDisplayNames();
        this.plugin.refreshSettingsWindowLocalization();
        this.refreshSettings();
      },
    );

    addToggleSetting(
      advanced,
      translate("高级兼容模式（会修改插件文件）"),
      translate("仅在普通本地化无法覆盖时使用。允许为单个插件写入匹配的静态译文，并先备份；应用或恢复后需重新加载该插件。"),
      this.plugin.settings.thirdPartyFilePatchingEnabled,
      async (value) => {
        this.plugin.settings.thirdPartyFilePatchingEnabled = value;
        await this.plugin.savePluginData();
        if (!value) {
          const result = await this.plugin.restoreThirdPartyPluginFiles();
          this.selectionStatus = describeFileRestore(result);
          this.selectionStatusFailed = result.conflicts > 0;
        } else {
          this.selectionStatus = translate("已允许兼容补丁，请在插件管理器中为单个插件应用。");
          this.selectionStatusFailed = false;
        }
        this.selectionStatusAt = new Date();
        this.refreshSettings();
      },
    );

    new Setting(advanced)
      .setName(translate("恢复所有兼容补丁"))
      .setDesc(translate("也会检查未启用的插件；遇到外部改动时保留文件并列出需处理项。"))
      .addButton((button) => button.setButtonText(translate("恢复原始文件")).onClick(async () => {
        button.setDisabled(true);
        try {
          const result = await this.plugin.restoreThirdPartyPluginFiles();
          this.reportCommandStatus(describeFileRestore(result), result.conflicts > 0);
        } catch (error) { this.reportCommandStatus(errorMessage(error), true); }
        finally { button.setDisabled(false); }
      }));
    advanced.createEl("p", {
      text: translate("仅支持官方社区目录中来源可验证的插件。离线时可继续使用已缓存的译文。"),
      cls: "setting-item-description",
    });
    this.renderBrand(containerEl);
    void this.refreshObsidianPluginNavigationNames();
  }

  private async refreshObsidianPluginNavigationNames(): Promise<void> {
    try {
      const plugins = (await discoverInstalledPlugins(this.app, this.plugin.manifest.id))
        .filter((plugin) => plugin.enabled);
      this.updateObsidianPluginNavigationNames(plugins);
    } catch (error) {
      console.warn("[Trans-Hub] failed to refresh localized plugin navigation names", error);
    }
  }

  private renderContributionCallout(container: HTMLElement): void {
    const callout = container.createDiv({ cls: "trans-hub-settings__contribution" });
    const copy = callout.createDiv({ cls: "trans-hub-settings__contribution-copy" });
    const title = copy.createDiv({
      text: translate("一起完善插件本地化"),
      cls: "trans-hub-settings__contribution-title",
    });
    title.setAttrs({ role: "heading", "aria-level": "3" });
    copy.createEl("p", {
      text: translate("当前多数语枢译文由机器翻译生成，并会明确标注未经人工校对。如果你熟悉某个插件或语言，欢迎参与翻译、校对和审查，让译文更准确，也能随插件版本持续维护。"),
      cls: "trans-hub-settings__contribution-description",
    });
    callout.createEl("a", {
      text: translate("查看进展并参与贡献"),
      cls: "trans-hub-settings__contribution-link",
      href: TRANS_HUB_OBSIDIAN_ECOSYSTEM_URL,
      attr: {
        target: "_blank",
        rel: "noopener noreferrer",
      },
    });
  }

  private renderConnection(container: HTMLElement): void {
    const connected = this.plugin.hasUserSession();
    const reconnectRequired = this.plugin.requiresReconnect();
    const connection = new Setting(container)
      .setName(connected
        ? translate("语枢已连接")
        : reconnectRequired ? translate("需要重新连接语枢") : translate("连接语枢"))
      .setDesc(connected
        ? translate("重启后自动连接；离线时使用已缓存译文。断开连接会清除本机同步记录，之后需要重新连接并同步。")
        : reconnectRequired
          ? translate("此设备的授权已过期或被撤销。重新连接后会继续同步；已缓存译文仍可离线使用。")
          : translate("将在系统默认浏览器中登录并授权此设备；Obsidian 内置浏览器无法完成回调。注册目前为邀请制，插件不会接触或保存账号密码。"));
    connection.settingEl.addClass("trans-hub-settings__card", "trans-hub-settings__connection");
    if (this.selectionStatusAt !== null) {
      const feedback = connection.settingEl.createDiv({
        text: this.describeLastAction(),
        cls: "trans-hub-settings__feedback",
      });
      feedback.setAttrs({ role: "status", "aria-live": "polite" });
      feedback.toggleClass("mod-warning", this.selectionStatusFailed);
    }
    if (connected) {
      connection
        .addButton((button) => button.setButtonText(translate("断开此设备连接")).onClick(async () => {
          try {
            await this.plugin.disconnect();
            this.reportCommandStatus(translate("已断开连接并清除本机同步记录；服务器上的短期凭据会自动过期。"), false);
          } catch (error) {
            this.reportCommandStatus(errorMessage(error), true);
            new Notice(errorMessage(error), 10_000);
          }
        }));
      return;
    }
    connection
      .addButton((button) => button.setButtonText(reconnectRequired
        ? translate("重新连接")
        : translate("在浏览器中连接")).setCta().onClick(async () => {
        if (this.connectionPending) return;
        this.connectionPending = true;
        try {
          await this.plugin.connect();
          this.selectionStatus = translate("请在浏览器中完成登录和设备授权。");
          this.selectionStatusFailed = false;
          this.selectionStatusAt = new Date();
        } catch (error) {
          this.selectionStatus = errorMessage(error);
          this.selectionStatusFailed = true;
          new Notice(this.selectionStatus, 10_000);
        } finally {
          this.connectionPending = false;
          this.refreshSettings();
        }
      }))
      .addButton((button) => {
        button
          .setButtonText(translate("注册"))
          .setTooltip(translate("打开邀请制注册页面"))
          .onClick(async () => {
            try {
              await this.plugin.openRegistration();
            } catch (error) {
              new Notice(errorMessage(error), 10_000);
            }
          });
      });
  }

  private describeLastAction(): string {
    return this.selectionStatusAt === null ? this.selectionStatus : translate("上次操作 {time}：{message}", {
      time: this.selectionStatusAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      message: this.selectionStatus,
    });
  }

  private renderFileRecovery(container: HTMLElement): void {
    const result = this.plugin.getFileRestoreResult();
    if (result === undefined || (result.restored === 0 && result.conflicts === 0)) return;
    const message = container.createDiv({
      text: describeFileRestore(result),
      cls: result.conflicts > 0 ? "trans-hub-settings__recovery mod-warning" : "trans-hub-settings__recovery",
    });
    message.setAttrs({ role: "status", "aria-live": "polite" });
    if (result.restoredPluginIds.length > 0) message.createDiv({ text: result.restoredPluginIds.join("、") });
    for (const pluginId of result.conflictPluginIds) {
      renderPluginPatchControls(new Setting(message).setName(pluginId), {
        app: this.app, pluginName: pluginId, state: "conflict", canApply: false,
        apply: () => this.plugin.applyThirdPartyPluginFileTranslations([pluginId]),
        restore: (force) => this.plugin.restoreThirdPartyPluginFiles([pluginId], force),
        onComplete: (text, failed) => this.reportCommandStatus(text, failed),
      });
    }
  }

  private async renderPluginPicker(container: HTMLElement, renderVersion: number): Promise<void> {
    try {
      const plugins = (await discoverInstalledPlugins(this.app, this.plugin.manifest.id))
        .filter((plugin) => plugin.enabled);
      if (renderVersion !== this.renderVersion || container !== this.managerContainerEl) return;
      container.empty();
      if (plugins.length === 0) {
        this.updateObsidianPluginNavigationNames([]);
        container.createDiv({
          text: translate("没有发现已启用的第三方插件。启用插件后重新打开此页面即可选择。"),
          cls: "trans-hub-plugin-picker__empty setting-item-description",
        });
        return;
      }
      const pluginsWithSource = await resolveInstalledPluginSources(
        plugins,
        undefined,
        trustedPublishedPluginVersions(this.plugin.getPluginState()),
        this.plugin.getPluginSourceSnapshot(),
      );
      if (renderVersion !== this.renderVersion || container !== this.managerContainerEl) return;
      this.updateObsidianPluginNavigationNames(plugins);
      this.renderPluginPickerContents(container, pluginsWithSource);
    } catch (error) {
      if (renderVersion !== this.renderVersion || container !== this.managerContainerEl) return;
      container.empty();
      container.createDiv({
        text: translate("读取插件失败：{message}", { message: errorMessage(error) }),
        cls: "trans-hub-plugin-picker__empty mod-warning",
      });
    }
  }

  updateObsidianPluginNavigationNames(
    plugins: readonly InstalledObsidianPlugin[],
  ): void {
    const settingsModal = this.containerEl.closest(".modal");
    if (settingsModal === null) return;
    const markedTitles = settingsModal.querySelectorAll<HTMLElement>(
      `.vertical-tab-nav-item-title[${ORIGINAL_PLUGIN_NAME_ATTRIBUTE}]`,
    );
    for (const title of Array.from(markedTitles)) {
      const officialName = title.getAttribute(ORIGINAL_PLUGIN_NAME_ATTRIBUTE);
      if (officialName !== null) title.textContent = officialName;
      title.removeAttribute(ORIGINAL_PLUGIN_NAME_ATTRIBUTE);
    }
    const state = this.plugin.getPluginState();
    const localizedNames = new Map(plugins.map((plugin) => [
      plugin.name,
      localizedPluginDisplayName(
        plugin.name,
        state.pluginCatalogs[plugin.id],
        getPluginTranslation(state, plugin.id, this.plugin.settings.targetLocale),
        this.plugin.settings.targetLocale,
      ),
    ]));
    const pluginGroups = Array.from(settingsModal.querySelectorAll<HTMLElement>(".vertical-tab-header-group"))
      .filter((group) => Array.from(group.querySelectorAll<HTMLElement>(".vertical-tab-nav-item-title"))
        .some((title) => isClientDisplayName(title.textContent?.trim() ?? "")));
    for (const group of pluginGroups) {
      for (const title of Array.from(group.querySelectorAll<HTMLElement>(".vertical-tab-nav-item-title"))) {
        const officialName = title.textContent?.trim() ?? "";
        if (isClientDisplayName(officialName)) {
          const clientName = localizedClientName();
          if (clientName !== officialName) {
            title.setAttribute(ORIGINAL_PLUGIN_NAME_ATTRIBUTE, officialName);
            title.textContent = clientName;
          }
          continue;
        }
        if (
          !this.plugin.settings.pluginTranslationEnabled
          || !this.plugin.settings.pluginMetadataTranslationEnabled
        ) continue;
        const localizedName = localizedNames.get(officialName);
        if (localizedName === undefined || localizedName === officialName) continue;
        title.setAttribute(ORIGINAL_PLUGIN_NAME_ATTRIBUTE, officialName);
        title.textContent = localizedName;
      }
    }
  }

  private renderPluginPickerContents(container: HTMLElement, plugins: readonly InstalledPluginWithSource[]): void {
    void this.refreshPluginPatchStates(plugins.map((plugin) => plugin.id));
    const eligiblePluginIds = plugins.filter((plugin) => isPluginSourceSelectable(plugin.source))
      .map((plugin) => plugin.id);
    let query = this.pluginSearchQuery;
    let statusFilter = this.pluginStatusFilter;
    let selectAllButton: ButtonComponent;
    let clearButton: ButtonComponent;
    let resyncButton: ButtonComponent;
    let batchRetryButton: ButtonComponent;

    // Obsidian 1.13 compresses ItemView header descendants into an empty
    // visual strip. Keep the manager's live summary in a normal content row
    // so the check/processing status remains visible in both tabs and popouts.
    const context = new Setting(container)
      .setName(translate("{language} · {connection}", {
        language: TARGET_LOCALE_OPTIONS.find((option) => option.value === this.plugin.settings.targetLocale)?.label ?? this.plugin.settings.targetLocale,
        connection: this.plugin.hasUserSession() ? translate("已连接") : translate("需要连接"),
      }))
      .setDesc(this.plugin.settings.pluginTranslationEnabled
        ? this.stalePluginIds.size > 0
          ? translate("暂时无法更新进度，当前显示上次结果。请稍后检查进度。")
          : translate("自动检查插件变化并同步译文，也可点击“同步译文”立即更新。")
        : translate("本地化已暂停。请在设置中开启后继续。"));
    context.settingEl.addClass("trans-hub-plugin-picker__context");
    if (!this.plugin.hasUserSession()) context.addButton((button) => button
      .setButtonText(translate("连接语枢")).setCta().onClick(async () => {
        if (this.connectionPending) return;
        this.connectionPending = true;
        button.setDisabled(true);
        try {
          await this.plugin.connect();
          this.reportCommandStatus(translate("请在浏览器中完成登录和设备授权。"), false);
        } catch (error) { this.reportCommandStatus(errorMessage(error), true); }
        finally { this.connectionPending = false; button.setDisabled(false); }
      }));
    if (plugins.some((plugin) => plugin.source.kind === "pending")) context.addButton((button) => button
      .setButtonText(translate("重新读取来源")).onClick(() => this.refreshPluginManager()));
    this.renderFileRecovery(container);
    const overview = container.createDiv({ cls: "trans-hub-plugin-picker__overview" });
    const summary = overview.createDiv({ cls: "trans-hub-plugin-picker__summary" });
    const summaryText = summary.createSpan();
    const summaryTotal = summary.createSpan({ cls: "trans-hub-plugin-picker__total" });
    const status = overview.createDiv({
      text: this.describeLastAction(),
      cls: [
        "trans-hub-plugin-picker__status",
        ...(this.selectionStatusFailed ? ["mod-warning"] : []),
      ],
    });
    this.managerStatusEl = status;
    status.setAttr("role", "status");
    status.setAttr("aria-live", "polite");

    const controls = container.createDiv({ cls: "trans-hub-plugin-picker__controls" });
    const searchSetting = new Setting(controls)
      .addText((text) => {
        text.inputEl.setAttr("aria-label", translate("搜索插件"));
        text.setPlaceholder(translate("搜索插件名称或 ID")).setValue(query).onChange((value) => {
          query = value;
          this.pluginSearchQuery = value;
          this.pluginListScrollTop = 0;
          renderRows();
        });
      });
    searchSetting.settingEl.addClass("trans-hub-plugin-picker__search");

    const actionsSetting = new Setting(controls)
      .addDropdown((dropdown) => {
        dropdown.selectEl.addClass("trans-hub-plugin-picker__status-filter");
        dropdown.selectEl.setAttr("aria-label", translate("按本地化状态筛选插件"));
        dropdown.addOptions(Object.fromEntries(
          PLUGIN_PICKER_FILTERS.map((option) => [option.value, translate(option.label)]),
        ));
        dropdown.setValue(statusFilter).onChange((value) => {
          statusFilter = value as PluginPickerDisplayKind | "all";
          this.pluginStatusFilter = statusFilter;
          this.pluginListScrollTop = 0;
          renderRows();
        });
      })
      .addButton((button) => {
        resyncButton = button
          .setButtonText(translate("同步译文"))
          .setCta()
          .setTooltip(translate("检查插件变化、更新处理进度并获取可用译文。"))
          .onClick(async () => { await this.refreshSelectedPlugins(list); });
      })
      .addButton((button) => {
        batchRetryButton = button
          .setButtonText(translate("重试失败项（0）"))
          .setTooltip(translate("重试已选择且可恢复的插件；服务端阻断项不会提交。"))
          .onClick(async () => {
            await this.retryRecoverablePlugins(list, this.selectedRecoverablePluginIds(plugins));
          });
      })
      .addButton((button) => {
        selectAllButton = button.setButtonText(translate("全部开启")).onClick(async () => {
          await persistSelection(setAllPluginsSelected(this.plugin.settings.excludedPluginIds, eligiblePluginIds, true));
          renderRows();
        });
      })
      .addButton((button) => {
        clearButton = button.setButtonText(translate("全部关闭")).onClick(async () => {
          await persistSelection(setAllPluginsSelected(this.plugin.settings.excludedPluginIds, eligiblePluginIds, false));
          renderRows();
        });
      });
    actionsSetting.settingEl.addClass("trans-hub-plugin-picker__actions");

    const list = container.createDiv({ cls: "trans-hub-plugin-picker__list" });
    list.setAttr("role", "list");

    const updateSummary = (): void => {
      const selected = selectedPluginCount(eligiblePluginIds, this.plugin.settings.excludedPluginIds);
      summaryText.setText(translate("已开启 {selected}", { selected }));
      summaryTotal.setText(translate("可本地化 {eligible} / 已启用 {total}", {
        eligible: eligiblePluginIds.length,
        total: plugins.length,
      }));
      selectAllButton.setDisabled(selected === eligiblePluginIds.length);
      clearButton.setDisabled(selected === 0);
      resyncButton.setDisabled(selected === 0 || !this.plugin.hasUserSession() || !this.plugin.settings.pluginTranslationEnabled);
      const recoverableCount = this.selectedRecoverablePluginIds(plugins).length;
      batchRetryButton.buttonEl.toggleClass("trans-hub-hidden", recoverableCount === 0);
      batchRetryButton.setButtonText(translate("重试失败项（{count}）", { count: recoverableCount }));
      batchRetryButton.setDisabled(recoverableCount === 0 || !this.plugin.settings.pluginTranslationEnabled);
    };

    const persistSelection = async (excludedPluginIds: string[]): Promise<void> => {
      const previous = new Set(this.plugin.settings.excludedPluginIds);
      const next = new Set(excludedPluginIds);
      const enabled = eligiblePluginIds.filter((id) => previous.has(id) && !next.has(id));
      const disabled = eligiblePluginIds.filter((id) => !previous.has(id) && next.has(id));
      this.plugin.settings.excludedPluginIds = excludedPluginIds;
      await this.plugin.savePluginData();
      if (disabled.length > 0) await this.plugin.restoreThirdPartyPluginFiles(disabled);
      await this.plugin.refreshPluginTranslationRuntime();
      updateSummary();
      if (enabled.length > 0 && this.plugin.settings.pluginTranslationEnabled) {
        this.queueSelectionProcessing(status, enabled);
      } else {
        this.refreshSettings(list);
      }
    };

    const renderRows = (): void => {
      list.empty();
      const pluginState = this.plugin.getPluginState();
      const hasSession = this.plugin.hasUserSession();
      const requiresReconnect = this.plugin.requiresReconnect();
      const excluded = new Set(this.plugin.settings.excludedPluginIds);
      const rows = plugins.map((plugin) => {
        const translation = getPluginTranslation(pluginState, plugin.id, this.plugin.settings.targetLocale);
        const localizationStatus = describePluginLocalizationStatus({
          submission: getPluginSubmissionForLocale(pluginState, plugin.id, this.plugin.settings.targetLocale),
          publicDiscovery: pluginState.publicPluginDiscoveries[plugin.id],
          translation, catalog: pluginState.pluginCatalogs[plugin.id],
          targetLocale: this.plugin.settings.targetLocale, hasSession, requiresReconnect,
        });
        const displayName = this.plugin.settings.pluginMetadataTranslationEnabled
          ? localizedPluginDisplayName(plugin.name, pluginState.pluginCatalogs[plugin.id], translation, this.plugin.settings.targetLocale)
          : plugin.name;
        const presentation = presentPluginLocalization({
          source: plugin.source, selected: !excluded.has(plugin.id),
          enabled: this.plugin.settings.pluginTranslationEnabled, localization: localizationStatus,
          processing: this.selectionProcessingPluginIds.has(plugin.id),
        });
        return { ...plugin, displayName, localizationStatus, presentation, translation };
      });
      const currentCounts = rows.reduce((counts, row) => {
        if (row.presentation.kind === "localized") counts.complete += 1;
        if (row.presentation.kind === "restricted") counts.restricted += 1;
        if (row.presentation.kind === "partial") counts.partial += 1;
        if (row.presentation.kind === "processing") counts.processing += 1;
        if (["attention", "login-required", "source-pending"].includes(row.presentation.kind)) counts.attention += 1;
        return counts;
      }, { complete: 0, partial: 0, processing: 0, attention: 0, restricted: 0 });
      summaryTotal.setText(translate("完整 {complete} · 部分 {partial} · 准备中 {processing} · 需处理 {attention} · 服务端受限 {restricted}", currentCounts));
      const visiblePlugins = filterSelectablePlugins(rows, query)
        .filter((plugin) => statusFilter === "all" || plugin.presentation.kind === statusFilter);
      if (visiblePlugins.length === 0) {
        list.createDiv({
          text: translate("没有匹配的插件。"),
          cls: "trans-hub-plugin-picker__empty setting-item-description",
        });
        new Setting(list).addButton((button) => button.setButtonText(translate("清除搜索和筛选")).onClick(() => {
          this.pluginSearchQuery = "";
          this.pluginStatusFilter = "all";
          this.refreshPluginManager();
        }));
        return;
      }
      for (const plugin of visiblePlugins) {
        const sourceStatus = pluginSourceStatus(plugin.source);
        const { localizationStatus, displayName, presentation } = plugin;
        const displayDescription = this.plugin.settings.pluginMetadataTranslationEnabled
          ? localizedPluginDescription(
            plugin.description,
            pluginState.pluginCatalogs[plugin.id],
            getPluginTranslation(pluginState, plugin.id, this.plugin.settings.targetLocale),
            this.plugin.settings.targetLocale,
          )
          : plugin.description;
        const selectable = isPluginSourceSelectable(plugin.source);
        const selected = selectable && !excluded.has(plugin.id);
        const statusLabel = presentation.label;
        const statusStale = this.stalePluginIds.has(plugin.id);
        const renderCoverageDetails = sourceStatus === null && localizationStatus.coverage !== undefined;
        const row = new Setting(list)
          .setName(displayName)
          .setDesc("");
        const descriptionEl = row.descEl;
        if (displayDescription !== "") {
          descriptionEl.createDiv({ text: displayDescription, cls: "trans-hub-plugin-picker__description" });
        }
        descriptionEl.createDiv({
          text: `${plugin.id} · v${plugin.version}`,
          cls: "trans-hub-plugin-picker__metadata",
        });
        descriptionEl.createDiv({ text: statusLabel, cls: "trans-hub-plugin-picker__provenance" });
        if (statusStale) descriptionEl.createDiv({ text: translate("进度可能已过期，请检查进度。"), cls: "mod-warning" });
        if (presentation.kind === "processing" && !statusStale && localizationStatus.kind === "unrecorded") {
          descriptionEl.createDiv({
            text: translate("首次收录需要一些时间，期间可正常使用插件。"),
            cls: "trans-hub-plugin-picker__description",
          });
        }
        if (displayName !== plugin.name) descriptionEl.createDiv({ text: plugin.name, cls: "trans-hub-plugin-picker__metadata" });
        if (localizationStatus.coverage !== undefined) descriptionEl.createDiv({
          text: localizationStatus.coverage.headline, cls: "trans-hub-plugin-picker__catalog-applied",
        });
        const detailStatus = sourceStatus?.label ?? localizationStatus.label;
        const showInitialPreparationNote = presentation.kind === "processing"
          && localizationStatus.initialSubmission
          && !statusStale;
        const catalog = pluginState.pluginCatalogs[plugin.id];
        const missing = localizationStatus.coverage?.complete === false
          && catalog !== undefined
          && plugin.translation !== undefined
          ? describeMissingTranslations(catalog, plugin.translation)
          : [];
        const shouldRenderDetails = renderCoverageDetails
          || localizationStatus.catalogMismatch !== undefined
          || detailStatus !== statusLabel
          || showInitialPreparationNote
          || missing.length > 0;
        if (shouldRenderDetails) {
          const details = descriptionEl.createEl("details", { cls: "trans-hub-plugin-picker__details" });
          details.createEl("summary", { text: translate("进度与版本详情") });
          if (!renderCoverageDetails && detailStatus !== statusLabel) {
            details.createDiv({ text: detailStatus });
          }
          if (showInitialPreparationNote) {
            details.createDiv({
              text: translate("首次准备完成后会自动同步，无需反复重试。"),
            });
          }
          if (sourceStatus === null && localizationStatus.catalogMismatch !== undefined) {
            renderPluginPickerCatalogMismatchDetails(details, localizationStatus.catalogMismatch);
          } else if (renderCoverageDetails) {
            renderPluginPickerCoverageDetails(details, localizationStatus.coverage);
          }
          if (missing.length > 0) {
            const missingDetails = details.createEl("details", {
              cls: "trans-hub-plugin-picker__missing-details",
            });
            missingDetails.createEl("summary", { text: translate("未匹配文案（{count}）", { count: missing.length }) });
            const reasons = [...new Set(missing.map((entry) => entry.reason))];
            const singleReason = reasons.length === 1 ? reasons[0] : undefined;
            if (singleReason !== undefined) {
              missingDetails.createDiv({
                text: singleReason,
                cls: "trans-hub-plugin-picker__missing-reason",
              });
            }
            const items = missingDetails.createEl("ul", {
              cls: "trans-hub-plugin-picker__missing-list",
            });
            for (const entry of missing.slice(0, 20)) {
              const item = items.createEl("li", {
                text: entry.source,
                cls: "trans-hub-plugin-picker__missing-item",
              });
              if (singleReason === undefined) {
                item.createDiv({
                  text: entry.reason,
                  cls: "trans-hub-plugin-picker__missing-item-reason",
                });
              }
            }
            if (missing.length > 20) missingDetails.createDiv({ text: translate("仅展示前 20 条未匹配文案。") });
          }
        }
        row.settingEl.addClass(`trans-hub-plugin-picker__item--${presentation.kind}`);
        if (!selectable || !selected || !this.plugin.settings.pluginTranslationEnabled) row.settingEl.addClass("is-disabled");
        const retryKind = visiblePluginManualRetryKind({
          state: pluginState,
          pluginId: plugin.id,
          targetLocale: this.plugin.settings.targetLocale,
          sourceSelectable: isPluginSourceSelectable(plugin.source),
          hasSession,
        });
        if (retryKind !== null && selected && this.plugin.settings.pluginTranslationEnabled) {
          row.addButton((button) => {
            button
              .setButtonText(translate(retryKind === "resubmit" ? "重新检查来源" : "重试同步"))
              .setTooltip(translate("重新检查并重试 {pluginName}，无需关闭本地化开关", {
                pluginName: displayName,
              }))
              .setCta();
            button.buttonEl.setAttr("aria-label", translate("重试 {pluginName} 本地化", {
              pluginName: displayName,
            }));
            button.onClick(async () => {
              button.buttonEl.disabled = true;
              button.setButtonText(translate("正在重试…"));
              await this.retrySinglePlugin(plugin.id, displayName, retryKind, list);
            });
          });
        }
        const hasReactStaticSettingsText = pluginState.pluginCatalogs[plugin.id]?.strings.some((item) =>
          item.evidence?.some((evidence) => evidence.symbol === "createElement"
            && evidence.literalStart !== undefined && evidence.literalEnd !== undefined
            && (evidence.strategy === "structured" || evidence.strategy === "regex-fallback"))) === true;
        renderPluginPatchControls(row, {
          app: this.app, pluginName: displayName,
          state: this.patchStateByPluginId.get(plugin.id) ?? "none",
          canApply: this.plugin.settings.pluginTranslationEnabled && this.plugin.settings.thirdPartyFilePatchingEnabled
            && selected && sourceStatus === null && hasReactStaticSettingsText,
          apply: () => this.plugin.applyThirdPartyPluginFileTranslations([plugin.id]),
          restore: (force) => this.plugin.restoreThirdPartyPluginFiles([plugin.id], force),
          onComplete: (message, failed) => this.reportCommandStatus(message, failed),
        });
        // The enable toggle is appended last so it is the rightmost control
        // in every layout (desktop and mobile), keeping row switches aligned
        // with the settings-page toggles on the right edge.
        row.addToggle((toggle) => {
          toggle.setValue(selectable && !excluded.has(plugin.id)).setDisabled(!selectable);
          toggle.toggleEl.setAttr("aria-label", selectable
            ? translate("切换 {pluginName} 本地化", { pluginName: displayName })
            : translate("{pluginName} 不可开启：{reason}", { pluginName: displayName, reason: statusLabel }));
          if (selectable) {
            toggle.onChange(async (selected) => {
              await persistSelection(setPluginSelected(
                this.plugin.settings.excludedPluginIds,
                plugin.id,
                selected,
              ));
            });
          }
        });
        row.settingEl.setAttr("role", "listitem");
      }
    };

    updateSummary();
    renderRows();
    restorePluginListScrollTop(list, this.pluginListScrollTop);
  }

  private async retrySinglePlugin(
    pluginId: string,
    pluginName: string,
    retryKind: PluginManualRetryKind,
    scrollSource: HTMLElement,
  ): Promise<void> {
    if (this.managerActionPending) return;
    this.managerActionPending = true;
    if (this.selectionProcessing !== null) await this.selectionProcessing;
    this.selectionStatus = translate("正在重试 {pluginName}…", { pluginName });
    this.selectionStatusFailed = false;
    this.updateStatusLine();
    try {
      const result = await this.plugin.processSinglePlugin(
        pluginId,
        retryKind === "resubmit",
      );
      this.selectionStatus = describePluginSelectionProcessing(result, "single-retry");
      this.selectionStatusFailed = pluginSelectionNeedsAttention(result);
      if (result.kind === "synchronized") this.updateStalePluginStatus(result.sync.statusRead, result.sync.statusReadPluginIds ?? []);
      new Notice(this.selectionStatus);
    } catch (error) {
      console.error("[Trans-Hub] plugin selection processing failed", error);
      this.selectionStatus = translate("处理失败：{message}", { message: errorMessage(error) });
      this.selectionStatusFailed = true;
      new Notice(this.selectionStatus, 10_000);
    } finally { this.managerActionPending = false; this.refreshSettings(scrollSource); }
  }

  private selectedRecoverablePluginIds(plugins: readonly InstalledPluginWithSource[]): string[] {
    const state = this.plugin.getPluginState();
    const excluded = new Set(this.plugin.settings.excludedPluginIds);
    const hasSession = this.plugin.hasUserSession();
    return plugins.filter((plugin) => isPluginSourceSelectable(plugin.source)
      && !excluded.has(plugin.id)
      && visiblePluginManualRetryKind({
        state,
        pluginId: plugin.id,
        targetLocale: this.plugin.settings.targetLocale,
        sourceSelectable: true,
        hasSession,
      }) !== null).map((plugin) => plugin.id);
  }

  private async retryRecoverablePlugins(scrollSource: HTMLElement, pluginIds: readonly string[]): Promise<void> {
    if (pluginIds.length === 0 || this.selectionProcessing !== null || this.managerActionPending) return;
    this.managerActionPending = true;
    this.selectionStatus = translate("正在批量重试 {count} 个可恢复插件…", { count: pluginIds.length });
    this.selectionStatusFailed = false;
    this.updateStatusLine();
    try {
      const result = await this.plugin.retryPluginIds(pluginIds);
      this.selectionStatus = describePluginSelectionProcessing(result, "batch-retry");
      this.selectionStatusFailed = pluginSelectionNeedsAttention(result);
      if (result.kind === "synchronized") this.updateStalePluginStatus(result.sync.statusRead, result.sync.statusReadPluginIds ?? []);
      new Notice(this.selectionStatus);
    } catch (error) {
      this.selectionStatus = translate("处理失败：{message}", { message: errorMessage(error) });
      this.selectionStatusFailed = true;
      new Notice(this.selectionStatus, 10_000);
    } finally { this.managerActionPending = false; this.refreshSettings(scrollSource); }
  }

  private async refreshSelectedPlugins(scrollSource: HTMLElement): Promise<void> {
    if (this.managerActionPending) return;
    this.managerActionPending = true;
    if (this.selectionProcessing !== null) await this.selectionProcessing;
    this.selectionStatus = translate("正在同步译文…");
    this.selectionStatusFailed = false;
    this.updateStatusLine();
    try {
      // Normal synchronization checks changes and downloads available translations.
      // Fresh recovery observations belong to the explicit retry action.
      const result = await this.plugin.processSelectedPlugins();
      this.selectionStatus = describePluginSelectionProcessing(result);
      this.selectionStatusFailed = pluginSelectionNeedsAttention(result);
      if (result.kind === "synchronized") this.updateStalePluginStatus(result.sync.statusRead, result.sync.statusReadPluginIds ?? []);
      new Notice(this.selectionStatus);
    } catch (error) {
      console.error("[Trans-Hub] plugin resync failed", error);
      this.selectionStatus = translate("处理失败：{message}", { message: errorMessage(error) });
      this.selectionStatusFailed = true;
      new Notice(this.selectionStatus, 10_000);
    } finally { this.managerActionPending = false; this.refreshSettings(scrollSource); }
  }

  private async refreshPluginPatchStates(pluginIds: readonly string[]): Promise<void> {
    if (!this.plugin.settings.thirdPartyFilePatchingEnabled || pluginIds.length === 0) return;
    try {
      const states = await this.plugin.pluginFilePatchStates(pluginIds);
      const unchanged = states.size === this.patchStateByPluginId.size
        && [...states].every(([pluginId, patched]) => this.patchStateByPluginId.get(pluginId) === patched);
      if (unchanged) return;
      this.patchStateByPluginId = new Map(states);
      this.refreshSettings();
    } catch (error) {
      console.warn("[Trans-Hub] failed to read plugin file patch states", error);
    }
  }

  private queueSelectionProcessing(status: HTMLElement, pluginIds: readonly string[]): void {
    this.selectionRevision += 1;
    for (const pluginId of pluginIds) {
      this.pendingSelectionPluginIds.add(pluginId);
      this.selectionProcessingPluginIds.add(pluginId);
    }
    this.selectionStatus = translate("正在准备所选插件的译文…");
    this.selectionStatusAt = new Date();
    this.selectionStatusFailed = false;
    status.setText(this.selectionStatus);
    status.removeClass("mod-warning");
    if (this.selectionProcessing !== null) return;
    this.selectionProcessing = this.processLatestSelection().finally(() => {
      this.selectionProcessing = null;
    });
  }

  private async processLatestSelection(): Promise<void> {
    let processedRevision = 0;
    while (processedRevision !== this.selectionRevision) {
      processedRevision = this.selectionRevision;
      const pluginIds = [...this.pendingSelectionPluginIds];
      this.pendingSelectionPluginIds.clear();
      try {
        const result = await this.plugin.processPluginIds(pluginIds);
        for (const pluginId of pluginIds) this.selectionProcessingPluginIds.delete(pluginId);
        if (result.kind === "synchronized") this.updateStalePluginStatus(result.sync.statusRead, result.sync.statusReadPluginIds ?? []);
        if (processedRevision === this.selectionRevision) {
          this.selectionStatus = describePluginSelectionProcessing(result, "selected");
          this.selectionStatusFailed = pluginSelectionNeedsAttention(result);
        }
      } catch (error) {
        for (const pluginId of pluginIds) this.selectionProcessingPluginIds.delete(pluginId);
        if (processedRevision === this.selectionRevision) {
          const message = translate("处理失败：{message}", { message: errorMessage(error) });
          this.selectionStatus = message;
          this.selectionStatusFailed = true;
          new Notice(message, 10_000);
        }
      }
    }
    this.refreshSettings();
  }

  private refreshSettings(scrollSource?: HTMLElement): void {
    if (scrollSource?.isConnected) {
      this.pluginListScrollTop = scrollSource.scrollTop;
    } else {
      this.pluginListScrollTop = capturePluginListScrollTop(
        this.renderedContainerEl ?? this.containerEl,
        this.pluginListScrollTop,
      );
    }
    const update = (this as { update?: () => void }).update;
    if (typeof update === "function") {
      update.call(this);
      this.refreshPluginManager();
      return;
    }
    this.renderSettings(this.containerEl);
    this.refreshPluginManager();
  }

  private renderBrand(container: HTMLElement): void {
    const details = container.createEl("details", { cls: "trans-hub-settings__brand" });
    const summary = details.createEl("summary");
    const summaryText = summary.createSpan();
    summaryText.createEl("strong", { text: translate("关于语枢") });
    summaryText.createSpan({ text: "Trans-Hub", cls: "trans-hub-settings__brand-name" });
    summaryText.createSpan({
      text: translate("万语汇于一枢，创想行于无碍"),
      cls: "trans-hub-settings__brand-tagline",
    });
    const content = details.createDiv({ cls: "trans-hub-settings__brand-content" });
    this.renderContributionCallout(content);
    const principles = content.createDiv({ cls: "trans-hub-settings__brand-principles" });
    principles.createEl("p", { text: translate("连接全球生态，沉淀语言资产"), cls: "trans-hub-settings__brand-lead" });
    principles.createEl("p", {
      text: translate("Trans-Hub —— AI 时代的全球本地化基础设施"),
      cls: "trans-hub-settings__brand-infrastructure",
    });
    const positioning = content.createDiv({ text: translate("品牌定位"), cls: "trans-hub-settings__brand-heading" });
    positioning.setAttrs({ role: "heading", "aria-level": "3" });
    const description = content.createDiv({ cls: "trans-hub-settings__brand-description" });
    description.createEl("p", { text: translate("语枢（Trans-Hub）不是普通翻译工具，而是连接数字生态与全球语言的本地化基础设施。") });
    description.createEl("p", { text: translate("AI 正在让语言转换变得越来越容易，但真正困难的是，让不断增长的多语言内容保持一致、可维护，并持续演进。") });
    description.createEl("p", { text: translate("语枢将本地化从一次性的翻译流程，升级为可持续发展的语言资产体系。") });
    description.createEl("p", { text: translate("通过内容身份管理、智能翻译、协作审核、版本追踪和生态连接，让软件、游戏、社区项目与数字生态能够持续走向全球。") });
    content.createEl("a", {
      text: translate("了解语枢"),
      cls: "trans-hub-settings__brand-link",
      href: TRANS_HUB_WEB_BASE_URL,
      attr: { target: "_blank", rel: "noopener noreferrer" },
    });
  }
}

function addToggleSetting(
  container: HTMLElement,
  name: string,
  description: string,
  value: boolean,
  onChange: (value: boolean) => Promise<void>,
  disabled = false,
): void {
  const setting = new Setting(container)
    .setName(name)
    .setDesc(description)
    .addToggle((toggle) => toggle.setValue(value).setDisabled(disabled).onChange(async (selected) => {
      try { await onChange(selected); }
      catch (error) { new Notice(errorMessage(error), 10_000); }
    }));
  setting.settingEl.toggleClass("is-disabled", disabled);
}

function pluginSourceStatus(source: PluginSourceState): {
  readonly kind: "unsupported" | "source-pending";
  readonly label: string;
} | null {
  if (isPluginSourceSelectable(source)) return null;
  return source.kind === "unsupported"
    ? { kind: "unsupported", label: translate("暂不支持：未找到可信 GitHub 来源") }
    : { kind: "source-pending", label: translate("来源待验证：暂时无法读取 Obsidian 官方目录") };
}
