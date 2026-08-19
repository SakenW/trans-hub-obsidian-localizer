import {
  App,
  type ButtonComponent,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
} from "obsidian";

import { errorMessage } from "./error-message";
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
  describePluginStatusRefresh,
} from "./plugin-selection-processing";
import {
  capturePluginListScrollTop,
  restorePluginListScrollTop,
} from "./plugin-picker-scroll";
import {
  describePluginLocalizationStatus,
  PLUGIN_LOCALIZATION_STATUS_FILTERS,
  visiblePluginManualRetryKind,
  type PluginManualRetryKind,
  type PluginLocalizationStatusKind,
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

const ORIGINAL_PLUGIN_NAME_ATTRIBUTE = "data-trans-hub-official-plugin-name";

type PluginPickerStatusKind = PluginLocalizationStatusKind | "unsupported" | "source-pending";
type PluginPickerVisualKind = PluginPickerStatusKind | "localized-complete" | "localized-partial";

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
  private pluginStatusFilter: PluginPickerStatusKind | "all" = "all";
  private patchStateByPluginId = new Map<string, boolean>();
  private renderedContainerEl: HTMLElement | null = null;
  private managerContainerEl: HTMLElement | null = null;
  private managerStatusEl: HTMLElement | null = null;

  constructor(app: App, private readonly plugin: TransHubObsidianPlugin) {
    super(app, plugin);
  }

  reportCommandStatus(message: string, failed: boolean): void {
    this.selectionStatus = message;
    this.selectionStatusFailed = failed;
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
    status.setText(this.selectionStatus);
    status.toggleClass("mod-warning", this.selectionStatusFailed);
    status.setAttr("role", "status");
    status.setAttr("aria-live", "polite");
  }

  refreshPluginCards(): void {
    this.refreshPluginManager();
    void this.refreshObsidianPluginNavigationNames();
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
        translate("翻译为"),
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
      text: translate("为官方社区插件补齐缺失界面译文；保留插件自带语言，并随精确版本安全更新。"),
      cls: "trans-hub-settings__summary",
    });
    const facts = header.createDiv({ cls: "trans-hub-settings__facts setting-item-description" });
    facts.createSpan({ text: translate("插件自带译文优先") });
    facts.createSpan({ text: translate("标明机器翻译与人工校对") });
    facts.createSpan({ text: translate("不修改插件文件或笔记正文") });
    const scope = header.createDiv({ cls: "trans-hub-settings__scope" });
    scope.createSpan({
      text: translate("仅支持官方社区插件"),
      cls: "trans-hub-settings__scope-label",
    });
    scope.createSpan({
      text: translate("非社区插件缺少可验证的官方目录和版本来源。为避免对未知版本错误应用译文，语枢不会自动处理它们。"),
      cls: "trans-hub-settings__scope-description",
    });

    this.renderContributionCallout(containerEl);

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
        this.plugin.refreshPluginTranslationRuntime();
        this.refreshSettings();
      },
    );

    const localeSetting = new Setting(preferences)
      .setName(translate("翻译为"))
      .setDesc(translate("插件自带的目标语言会优先保留，语枢只补齐仍显示原文的界面。插件自身界面也使用这里选择的语言。"))
      .addDropdown((dropdown) => {
        dropdown.addOptions(Object.fromEntries(TARGET_LOCALE_OPTIONS.map((option) => [option.value, option.label])));
        dropdown.setValue(this.plugin.settings.targetLocale).setDisabled(!this.plugin.settings.pluginTranslationEnabled)
          .onChange(async (value) => {
            const targetLocale = parseTargetLocale(value);
            this.selectionStatus = translate("正在切换目标语言…");
            this.selectionStatusFailed = false;
            const result = await this.plugin.changeTargetLocale(targetLocale);
            if (result !== null && this.plugin.settings.targetLocale === targetLocale) {
              this.selectionStatus = describePluginSelectionProcessing(result);
            } else if (!this.plugin.hasUserSession()) {
              this.selectionStatus = translate("已切换目标语言；登录语枢后会继续同步。");
            }
            this.refreshSettings();
          });
      });
    localeSetting.settingEl.toggleClass("is-disabled", !this.plugin.settings.pluginTranslationEnabled);

    addToggleSetting(
      preferences,
      translate("翻译插件名称和说明"),
      translate("默认开启。开启时显示译名和译文说明；关闭时显示官方名称和原始说明。尚无名称译文的插件会保留官方名称。"),
      this.plugin.settings.pluginMetadataTranslationEnabled,
      async (value) => {
        this.plugin.settings.pluginMetadataTranslationEnabled = value;
        await this.plugin.savePluginData();
        this.plugin.refreshPluginTranslationRuntime();
        this.plugin.refreshPluginDisplayNames();
        this.plugin.refreshSettingsWindowLocalization();
        this.refreshSettings();
      },
      !this.plugin.settings.pluginTranslationEnabled,
    );

    addToggleSetting(
      preferences,
      translate("高级兼容模式（会修改插件文件）"),
      translate("默认关闭。大多数界面文案可在运行时直接显示译文，不需要修改插件文件。少数插件把设置页单独渲染，运行时无法触及，才需要开启此模式。开启后，请在插件管理器中为符合条件的插件单独使用兼容补丁。系统只写入已发布、与当前版本完全匹配且位置可确认的静态文案，并先保存可恢复备份。动态文案、带变量的模板、未收录版本或无法确认写入位置的插件不会提供补丁，以免改坏插件。关闭后会恢复原文件；更改后请重启 Obsidian 或重新加载目标插件。"),
      this.plugin.settings.thirdPartyFilePatchingEnabled,
      async (value) => {
        this.plugin.settings.thirdPartyFilePatchingEnabled = value;
        await this.plugin.savePluginData();
        if (!value) {
          const result = await this.plugin.restoreThirdPartyPluginFiles();
          this.selectionStatus = translate("已恢复 {restored} 个插件文件；{conflicts} 个文件已被外部更新，未覆盖。", result);
        } else {
          this.selectionStatus = translate("兼容补丁已允许。它只用于设置页等运行时无法覆盖的位置；请在插件管理器中为符合条件的插件单独使用。");
        }
        this.selectionStatusFailed = false;
        this.refreshSettings();
      },
      !this.plugin.settings.pluginTranslationEnabled,
    );

    const pluginHeading = new Setting(containerEl).setName(translate("插件管理")).setHeading();
    pluginHeading.settingEl.addClass("trans-hub-settings__section-heading");
    new Setting(containerEl)
      .setName(translate("管理已安装插件"))
      .setDesc(translate("在可缩放的独立窗口中选择插件、查看来源与译文状态；状态刷新不会跳回列表顶部。"))
      .addButton((button) => button
        .setButtonText(translate("打开插件管理器"))
        .setCta()
        .onClick(() => { void this.plugin.openPluginManager(); }));

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
        ? translate("此设备会在重启 Obsidian 后自动恢复连接；离线时继续使用已缓存的已发布译文。")
        : reconnectRequired
          ? translate("此设备的授权已过期或被撤销。重新连接后会继续同步；已缓存译文仍可离线使用。")
          : translate("将在系统默认浏览器中登录并授权此设备；Obsidian 内置浏览器无法完成回调。注册目前为邀请制，插件不会接触或保存账号密码。"));
    connection.settingEl.addClass("trans-hub-settings__card", "trans-hub-settings__connection");
    if (connected) {
      connection
        .addButton((button) => button.setButtonText(translate("清除本机连接")).onClick(() => {
          this.plugin.disconnect();
          new Notice(translate("已清除本机连接信息；服务器上的短期凭据会自动过期。"));
          this.refreshSettings();
        }));
      return;
    }
    connection
      .addButton((button) => button.setButtonText(reconnectRequired
        ? translate("重新连接")
        : translate("在浏览器中连接")).setCta().onClick(async () => {
        try {
          await this.plugin.connect();
          this.selectionStatus = translate("请在浏览器中完成登录和设备授权。");
          this.selectionStatusFailed = false;
          this.refreshSettings();
        } catch (error) {
          new Notice(errorMessage(error), 10_000);
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
    let statusRefreshButton: ButtonComponent;
    let resyncButton: ButtonComponent;

    // Obsidian 1.13 compresses ItemView header descendants into an empty
    // visual strip. Keep the manager's live summary in a normal content row
    // so the check/processing status remains visible in both tabs and popouts.
    const overview = container.createDiv({ cls: "trans-hub-plugin-picker__overview" });
    const summary = overview.createDiv({ cls: "trans-hub-plugin-picker__summary" });
    const summaryText = summary.createSpan();
    const summaryTotal = summary.createSpan({ cls: "trans-hub-plugin-picker__total" });
    const status = overview.createDiv({
      text: this.selectionStatus,
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
          [
            ...PLUGIN_LOCALIZATION_STATUS_FILTERS,
            { value: "unsupported", label: "暂不支持" },
            { value: "source-pending", label: "来源待验证" },
          ].map((option) => [option.value, translate(option.label)]),
        ));
        dropdown.setValue(statusFilter).onChange((value) => {
          statusFilter = value as PluginPickerStatusKind | "all";
          this.pluginStatusFilter = statusFilter;
          this.pluginListScrollTop = 0;
          renderRows();
        });
      })
      .addButton((button) => {
        statusRefreshButton = button
          .setButtonText(translate("刷新状态"))
          .setTooltip(translate("读取所选插件的服务器收录、来源与译文状态（不重新扫描、不提交或重新验证本地文件）"))
          .setCta()
          .onClick(async () => { await this.refreshSelectedPluginStatus(list, eligiblePluginIds); });
      })
      .addButton((button) => {
        resyncButton = button
          .setButtonText(translate("重新同步"))
          .setTooltip(translate("重新扫描所选插件并只同步真实变化的译文提交；批量恢复请对单个插件使用“重试此插件”。"))
          .onClick(async () => { await this.refreshSelectedPlugins(list); });
      })
      .addButton((button) => {
        selectAllButton = button.setButtonText(translate("全选")).onClick(async () => {
          await persistSelection(setAllPluginsSelected(this.plugin.settings.excludedPluginIds, eligiblePluginIds, true));
          renderRows();
        });
      })
      .addButton((button) => {
        clearButton = button.setButtonText(translate("取消全选")).onClick(async () => {
          await persistSelection(setAllPluginsSelected(this.plugin.settings.excludedPluginIds, eligiblePluginIds, false));
          renderRows();
        });
      });
    actionsSetting.settingEl.addClass("trans-hub-plugin-picker__actions");

    const list = container.createDiv({ cls: "trans-hub-plugin-picker__list" });
    list.setAttr("role", "list");

    const updateSummary = (): void => {
      const selected = selectedPluginCount(eligiblePluginIds, this.plugin.settings.excludedPluginIds);
      summaryText.setText(translate("已选择 {selected}", { selected }));
      summaryTotal.setText(translate("可本地化 {eligible} / 已启用 {total}", {
        eligible: eligiblePluginIds.length,
        total: plugins.length,
      }));
      selectAllButton.setDisabled(selected === eligiblePluginIds.length);
      clearButton.setDisabled(selected === 0);
      statusRefreshButton.setDisabled(selected === 0 || !this.plugin.hasUserSession());
      resyncButton.setDisabled(selected === 0 || !this.plugin.hasUserSession());
    };

    const persistSelection = async (excludedPluginIds: string[], pluginId?: string, selected?: boolean): Promise<void> => {
      this.plugin.settings.excludedPluginIds = excludedPluginIds;
      await this.plugin.savePluginData();
      this.plugin.refreshPluginTranslationRuntime();
      updateSummary();
      if (selected === true && pluginId !== undefined) {
        this.queueSelectionProcessing(status, pluginId);
      } else {
        this.refreshSettings(list);
      }
    };

    const renderRows = (): void => {
      list.empty();
      const pluginState = this.plugin.getPluginState();
      const hasSession = this.plugin.hasUserSession();
      const requiresReconnect = this.plugin.requiresReconnect();
      const visiblePlugins = filterSelectablePlugins(plugins, query).filter((plugin) => {
        const sourceStatus = pluginSourceStatus(plugin.source);
        if (sourceStatus !== null) return statusFilter === "all" || sourceStatus.kind === statusFilter;
        const localizationStatus = describePluginLocalizationStatus({
          submission: getPluginSubmissionForLocale(
            pluginState,
            plugin.id,
            this.plugin.settings.targetLocale,
          ),
          translation: getPluginTranslation(
            pluginState,
            plugin.id,
            this.plugin.settings.targetLocale,
          ),
          catalog: pluginState.pluginCatalogs[plugin.id],
          targetLocale: this.plugin.settings.targetLocale,
          hasSession,
          requiresReconnect,
        });
        return statusFilter === "all" || localizationStatus.kind === statusFilter;
      });
      if (visiblePlugins.length === 0) {
        list.createDiv({
          text: translate("没有匹配的插件。"),
          cls: "trans-hub-plugin-picker__empty setting-item-description",
        });
        return;
      }
      const excluded = new Set(this.plugin.settings.excludedPluginIds);
      for (const plugin of visiblePlugins) {
        const sourceStatus = pluginSourceStatus(plugin.source);
        const localizationStatus = describePluginLocalizationStatus({
          submission: getPluginSubmissionForLocale(
            pluginState,
            plugin.id,
            this.plugin.settings.targetLocale,
          ),
          translation: getPluginTranslation(
            pluginState,
            plugin.id,
            this.plugin.settings.targetLocale,
          ),
          catalog: pluginState.pluginCatalogs[plugin.id],
          targetLocale: this.plugin.settings.targetLocale,
          hasSession,
          requiresReconnect,
        });
        const displayName = this.plugin.settings.pluginMetadataTranslationEnabled
          ? localizedPluginDisplayName(
            plugin.name,
            pluginState.pluginCatalogs[plugin.id],
            getPluginTranslation(pluginState, plugin.id, this.plugin.settings.targetLocale),
            this.plugin.settings.targetLocale,
          )
          : plugin.name;
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
        const initialSubmission = localizationStatus.initialSubmission === true;
        const initialCataloging = selected
          && initialSubmission
          && this.selectionProcessingPluginIds.has(plugin.id);
        const statusLabel = sourceStatus?.label ?? (
          !selected && initialSubmission
            ? translate("未启用本地化")
            : initialCataloging
              ? translate("正在首次自动收录…")
              : localizationStatus.label
        );
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
        if (!renderCoverageDetails) {
          descriptionEl.createDiv({ text: statusLabel, cls: "trans-hub-plugin-picker__provenance" });
        }
        if (sourceStatus === null && localizationStatus.catalogMismatch !== undefined) {
          renderPluginPickerCatalogMismatchDetails(descriptionEl, localizationStatus.catalogMismatch);
        } else if (renderCoverageDetails) {
          renderPluginPickerCoverageDetails(descriptionEl, localizationStatus.coverage);
        }
        const visualKind: PluginPickerVisualKind = sourceStatus?.kind
          ?? (localizationStatus.kind !== "localized" || localizationStatus.coverage === undefined
            ? localizationStatus.kind
            : localizationStatus.coverage.complete ? "localized-complete" : "localized-partial");
        row.settingEl.addClass(`trans-hub-plugin-picker__item--${visualKind}`);
        if (plugin.source.kind !== "supported") row.settingEl.addClass("is-disabled");
        const retryKind = visiblePluginManualRetryKind({
          state: pluginState,
          pluginId: plugin.id,
          targetLocale: this.plugin.settings.targetLocale,
          sourceSelectable: isPluginSourceSelectable(plugin.source),
          hasSession,
        });
        if (retryKind !== null) {
          row.addButton((button) => {
            button
              .setButtonText(translate("重试此插件"))
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
        if (
          this.plugin.settings.thirdPartyFilePatchingEnabled
          && selected
          && sourceStatus === null
          && hasReactStaticSettingsText
        ) {
          const patched = this.patchStateByPluginId.get(plugin.id) === true;
          if (patched) {
            row.addButton((button) => {
              button
                .setButtonText(translate("取消兼容补丁"))
                .setTooltip(translate("恢复该插件文件的原始内容并删除补丁备份。重新加载目标插件后生效。"));
              button.onClick(async () => {
                button.buttonEl.disabled = true;
                button.setButtonText(translate("正在取消…"));
                try {
                  const result = await this.plugin.restoreThirdPartyPluginFiles([plugin.id]);
                  if (result.conflicts > 0 && result.restored === 0) {
                    // The plugin file was externally modified after the patch
                    // was applied, so the safe restore refused to overwrite
                    // it.  Ask whether to force-restore from the verified
                    // backup before doing anything.
                    const confirmed = await confirmForceRestore(
                      this.app,
                      displayName,
                      translate("该插件文件在补丁后被外部修改，无法安全恢复。是否强制用备份覆盖当前文件？"),
                    );
                    if (confirmed) {
                      const forced = await this.plugin.restoreThirdPartyPluginFiles([plugin.id], true);
                      this.patchStateByPluginId.set(plugin.id, forced.restored > 0);
                      this.selectionStatus = translate("已强制恢复 {restored} 个插件文件。重新加载目标插件后生效。", forced);
                      this.selectionStatusFailed = forced.conflicts > 0;
                    } else {
                      this.patchStateByPluginId.set(plugin.id, true);
                      this.selectionStatus = translate("已保留当前插件文件；可先重装该插件后再取消补丁。");
                      this.selectionStatusFailed = true;
                    }
                  } else {
                    this.patchStateByPluginId.set(plugin.id, result.restored > 0);
                    this.selectionStatus = translate("已取消兼容补丁：恢复 {restored} 个插件文件，冲突 {conflicts} 个。重新加载目标插件后生效。", result);
                    this.selectionStatusFailed = result.conflicts > 0;
                  }
                  new Notice(this.selectionStatus, this.selectionStatusFailed ? 10_000 : 0);
                } catch (error) {
                  this.selectionStatus = translate("处理失败：{message}", { message: errorMessage(error) });
                  this.selectionStatusFailed = true;
                  new Notice(this.selectionStatus, 10_000);
                }
                this.refreshSettings();
              });
            });
          } else {
            row.addButton((button) => {
              button.setButtonText(translate("使用兼容补丁"));
              button.setTooltip(translate("此插件的设置页无法由运行时本地化覆盖。仅写入已发布、与当前版本完全匹配且位置可确认的静态文案，并先保存备份；动态文案、带变量的模板和不匹配版本不会修改。"));
              button.onClick(async () => {
                button.buttonEl.disabled = true;
                button.setButtonText(translate("正在应用…"));
                try {
                  const result = await this.plugin.applyThirdPartyPluginFileTranslations([plugin.id]);
                  if (result.applied > 0) {
                    this.patchStateByPluginId.set(plugin.id, true);
                    this.selectionStatus = translate("已写入 {applied} 条静态界面译文；跳过 {skipped} 个插件，冲突 {conflicts} 个。重启或重新加载目标插件后生效。", result);
                    this.selectionStatusFailed = result.conflicts > 0;
                  } else if (result.conflicts > 0) {
                    this.selectionStatus = translate("兼容补丁写入冲突：插件文件与已发布制品不一致，已跳过。重新安装该插件后可重试。");
                    this.selectionStatusFailed = true;
                  } else if (result.skipped > 0) {
                    this.selectionStatus = translate("暂无可写入的静态界面译文：本地目录与服务端权威目录尚未一致，或该插件暂无匹配的已发布静态译文。服务端目录更新后会自动可用。");
                    this.selectionStatusFailed = true;
                  } else {
                    this.selectionStatus = translate("该插件没有可写入的静态界面译文。");
                    this.selectionStatusFailed = false;
                  }
                  new Notice(this.selectionStatus);
                } catch (error) {
                  this.selectionStatus = translate("处理失败：{message}", { message: errorMessage(error) });
                  this.selectionStatusFailed = true;
                  new Notice(this.selectionStatus, 10_000);
                }
                this.refreshSettings();
              });
            });
          }
        }
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
              ), plugin.id, selected);
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
    if (this.selectionProcessing !== null) await this.selectionProcessing;
    this.selectionStatus = translate("正在重试 {pluginName}…", { pluginName });
    this.selectionStatusFailed = false;
    this.updateStatusLine();
    new Notice(this.selectionStatus);
    try {
      const result = await this.plugin.processSinglePlugin(
        pluginId,
        retryKind === "resubmit",
      );
      this.selectionStatus = describePluginSelectionProcessing(result, "single-retry");
      new Notice(this.selectionStatus);
    } catch (error) {
      console.error("[Trans-Hub] plugin selection processing failed", error);
      this.selectionStatus = translate("处理失败：{message}", { message: errorMessage(error) });
      this.selectionStatusFailed = true;
      new Notice(this.selectionStatus, 10_000);
    } finally { this.refreshSettings(scrollSource); }
  }

  private async refreshSelectedPlugins(scrollSource: HTMLElement): Promise<void> {
    if (this.selectionProcessing !== null) await this.selectionProcessing;
    this.selectionStatus = translate("正在重新同步所选插件…");
    this.selectionStatusFailed = false;
    this.updateStatusLine();
    try {
      // 普通“重新同步”只提交真实本地变化，不把全部已启用插件传为人工重提；
      // 仅“重试此插件”会创建恢复观察（R-028/034 Phase 3，避免批量恢复放大）。
      const result = await this.plugin.processSelectedPlugins();
      this.selectionStatus = describePluginSelectionProcessing(result);
      new Notice(this.selectionStatus);
    } catch (error) {
      console.error("[Trans-Hub] plugin resync failed", error);
      this.selectionStatus = translate("处理失败：{message}", { message: errorMessage(error) });
      this.selectionStatusFailed = true;
      new Notice(this.selectionStatus, 10_000);
    } finally { this.refreshSettings(scrollSource); }
  }

  private async refreshSelectedPluginStatus(
    scrollSource: HTMLElement,
    eligiblePluginIds: readonly string[],
  ): Promise<void> {
    if (this.selectionProcessing !== null) await this.selectionProcessing;
    const excluded = new Set(this.plugin.settings.excludedPluginIds);
    const selectedPluginIds = eligiblePluginIds.filter((pluginId) => !excluded.has(pluginId));
    if (selectedPluginIds.length === 0) return;
    this.selectionStatus = translate("正在刷新所选插件状态…");
    this.selectionStatusFailed = false;
    this.updateStatusLine();
    try {
      const result = await this.plugin.refreshPluginStatusBatch(selectedPluginIds);
      this.selectionStatus = describePluginStatusRefresh(result, selectedPluginIds.length);
      new Notice(this.selectionStatus);
    } catch (error) {
      console.error("[Trans-Hub] plugin status refresh failed", error);
      this.selectionStatus = translate("处理失败：{message}", { message: errorMessage(error) });
      this.selectionStatusFailed = true;
      new Notice(this.selectionStatus, 10_000);
    } finally { this.refreshSettings(scrollSource); }
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

  private queueSelectionProcessing(status: HTMLElement, pluginId: string): void {
    this.selectionRevision += 1;
    this.pendingSelectionPluginIds.add(pluginId);
    this.selectionProcessingPluginIds.add(pluginId);
    this.selectionStatus = translate("正在首次自动收录…");
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
        if (processedRevision === this.selectionRevision) {
          this.selectionStatus = describePluginSelectionProcessing(result, "selected");
          this.selectionStatusFailed = false;
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
    .addToggle((toggle) => toggle.setValue(value).setDisabled(disabled).onChange(onChange));
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

function confirmForceRestore(app: App, pluginName: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    class ForceRestoreModal extends Modal {
      private settled = false;

      override onOpen(): void {
        this.contentEl.empty();
        this.contentEl.createEl("h2", { text: translate("确认强制恢复") });
        this.contentEl.createEl("p", { text: pluginName });
        this.contentEl.createEl("p", { text: message });
        this.contentEl.createEl("p", {
          text: translate("此操作会覆盖该插件当前的 main.js；仅当备份摘要仍与原始文件一致时才会继续。"),
        });
        new Setting(this.contentEl)
          .addButton((button) => button
            .setButtonText(translate("保留当前文件"))
            .onClick(() => this.finish(false)))
          .addButton((button) => button
            .setButtonText(translate("强制恢复"))
            .setCta()
            .onClick(() => this.finish(true)));
      }

      override onClose(): void {
        this.contentEl.empty();
        this.finish(false);
      }

      private finish(value: boolean): void {
        if (this.settled) return;
        this.settled = true;
        resolve(value);
        this.close();
      }
    }

    new ForceRestoreModal(app).open();
  });
}
