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
import { localizedClientName, translate } from "./client-localization";
import type TransHubObsidianPlugin from "./main";
import { localizedPluginDescription, localizedPluginDisplayName } from "./plugin-catalog-diff";
import { discoverInstalledPlugins, type InstalledObsidianPlugin } from "./plugin-discovery";
import {
  filterSelectablePlugins,
  selectedPluginCount,
  setAllPluginsSelected,
  setPluginSelected,
} from "./plugin-selection";
import {
  resolveCommunityPluginSourceEligibility,
  type CommunityPluginSourceEligibility,
} from "./plugin-registry";
import { describePluginSelectionProcessing } from "./plugin-selection-processing";
import {
  describePluginLocalizationStatus,
  PLUGIN_LOCALIZATION_STATUS_FILTERS,
  type PluginLocalizationStatusKind,
} from "./plugin-localization-status";
import {
  TARGET_LOCALE_OPTIONS,
  TRANS_HUB_OBSIDIAN_ECOSYSTEM_URL,
  TRANS_HUB_REGISTRATION_URL,
  TRANS_HUB_WEB_BASE_URL,
  parseTargetLocale,
} from "./product-config";
import { prepareUntranslatedFeedback } from "./untranslated-feedback";

const ORIGINAL_PLUGIN_NAME_ATTRIBUTE = "data-trans-hub-official-plugin-name";

type PluginSourceState = CommunityPluginSourceEligibility | { readonly kind: "pending" };
type PluginPickerStatusKind = PluginLocalizationStatusKind | "unsupported" | "source-pending";
type InstalledPluginWithSource = InstalledObsidianPlugin & { readonly source: PluginSourceState };

export class TransHubSettingTab extends PluginSettingTab {
  private renderVersion = 0;
  private selectionRevision = 0;
  private selectionProcessing: Promise<void> | null = null;
  private selectionStatus = translate("选择变化后会自动扫描并同步。");
  private selectionStatusFailed = false;

  constructor(app: App, private readonly plugin: TransHubObsidianPlugin) {
    super(app, plugin);
  }

  reportCommandStatus(message: string, failed: boolean): void {
    this.selectionStatus = message;
    this.selectionStatusFailed = failed;
    this.refreshSettings();
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
      render: (setting) => this.renderSettings(setting.settingEl),
    }];
  }

  // Obsidian 1.12 and earlier require display(); 1.13+ uses getSettingDefinitions().
  override display(): void {
    this.renderSettings(this.containerEl);
  }

  private renderSettings(containerEl: HTMLElement): void {
    const renderVersion = ++this.renderVersion;
    containerEl.empty();
    containerEl.addClass("trans-hub-settings");
    const header = containerEl.createEl("header", { cls: "trans-hub-settings__header" });
    const title = header.createDiv({ text: localizedClientName(), cls: "trans-hub-settings__title" });
    title.setAttrs({ role: "heading", "aria-level": "2" });
    header.createEl("p", {
      text: translate("自动识别插件已有语言，只补齐缺失界面，并随插件版本持续更新。"),
      cls: "trans-hub-settings__summary",
    });
    const facts = header.createDiv({ cls: "trans-hub-settings__facts setting-item-description" });
    facts.createSpan({ text: translate("插件自带译文优先") });
    facts.createSpan({ text: translate("标明机器翻译与人工校对") });
    facts.createSpan({ text: translate("不修改插件文件或笔记正文") });

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
            this.plugin.settings.targetLocale = parseTargetLocale(value);
            this.plugin.applyClientLocale(this.plugin.settings.targetLocale);
            this.selectionStatus = translate("选择变化后会自动扫描并同步。");
            this.selectionStatusFailed = false;
            await this.plugin.savePluginData();
            this.plugin.refreshPluginTranslationRuntime();
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
        this.refreshSettings();
      },
      !this.plugin.settings.pluginTranslationEnabled,
    );

    const pluginHeading = new Setting(containerEl).setName(translate("选择插件")).setHeading();
    pluginHeading.settingEl.addClass("trans-hub-settings__section-heading");
    containerEl.createEl("p", {
      text: translate("显示当前已启用的第三方插件。只有能绑定到 Obsidian 官方目录可信 GitHub 来源的插件可以开启；其他插件仍会显示，并说明暂不可用的原因。"),
      cls: "setting-item-description",
    });
    const pluginPicker = containerEl.createDiv({ cls: "trans-hub-plugin-picker" });
    pluginPicker.createDiv({
      text: translate("正在读取已启用插件…"),
      cls: "trans-hub-plugin-picker__empty setting-item-description",
    });
    void this.renderPluginPicker(pluginPicker, renderVersion);

    this.renderRecovery(containerEl);
    this.renderBrand(containerEl);
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
          : translate("将在系统浏览器中登录并授权此设备；注册目前为邀请制。插件不会接触或保存账号密码。"));
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
          .onClick(() => {
            button.buttonEl.win.open(
              TRANS_HUB_REGISTRATION_URL,
              "_blank",
              "noopener,noreferrer",
            );
          });
      });
  }

  private async renderPluginPicker(container: HTMLElement, renderVersion: number): Promise<void> {
    try {
      const plugins = (await discoverInstalledPlugins(this.app, this.plugin.manifest.id))
        .filter((plugin) => plugin.enabled);
      if (renderVersion !== this.renderVersion) return;
      container.empty();
      if (plugins.length === 0) {
        this.updateObsidianPluginNavigationNames([]);
        container.createDiv({
          text: translate("没有发现已启用的第三方插件。启用插件后重新打开此页面即可选择。"),
          cls: "trans-hub-plugin-picker__empty setting-item-description",
        });
        return;
      }
      let eligibility: ReadonlyMap<string, CommunityPluginSourceEligibility> | null = null;
      try {
        eligibility = await resolveCommunityPluginSourceEligibility(plugins.map((plugin) => plugin.id));
      } catch {
        // A temporary registry outage must not be presented as permanent lack of support.
      }
      if (renderVersion !== this.renderVersion) return;
      const pluginsWithSource: InstalledPluginWithSource[] = plugins.map((plugin) => ({
        ...plugin,
        source: eligibility?.get(plugin.id) ?? { kind: "pending" },
      }));
      this.updateObsidianPluginNavigationNames(plugins);
      this.renderPluginPickerContents(container, pluginsWithSource);
    } catch (error) {
      if (renderVersion !== this.renderVersion) return;
      container.empty();
      container.createDiv({
        text: translate("读取插件失败：{message}", { message: errorMessage(error) }),
        cls: "trans-hub-plugin-picker__empty mod-warning",
      });
    }
  }

  private updateObsidianPluginNavigationNames(
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
        state.pluginTranslations[plugin.id],
        this.plugin.settings.targetLocale,
      ),
    ]));
    const pluginGroups = Array.from(settingsModal.querySelectorAll<HTMLElement>(".vertical-tab-header-group"))
      .filter((group) => Array.from(group.querySelectorAll<HTMLElement>(".vertical-tab-nav-item-title"))
        .some((title) => title.textContent?.trim() === this.plugin.manifest.name));
    for (const group of pluginGroups) {
      for (const title of Array.from(group.querySelectorAll<HTMLElement>(".vertical-tab-nav-item-title"))) {
        const officialName = title.textContent?.trim() ?? "";
        if (officialName === this.plugin.manifest.name) {
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
    const eligiblePluginIds = plugins.filter((plugin) => plugin.source.kind === "supported")
      .map((plugin) => plugin.id);
    let query = "";
    let statusFilter: PluginPickerStatusKind | "all" = "all";
    let selectAllButton: ButtonComponent;
    let clearButton: ButtonComponent;

    const summary = container.createDiv({ cls: "trans-hub-plugin-picker__summary" });
    const summaryText = summary.createSpan();
    const summaryTotal = summary.createSpan({ cls: "trans-hub-plugin-picker__total" });
    const status = container.createDiv({
      text: this.selectionStatus,
      cls: [
        "trans-hub-plugin-picker__status",
        "setting-item-description",
        ...(this.selectionStatusFailed ? ["mod-warning"] : []),
      ],
    });

    const controls = container.createDiv({ cls: "trans-hub-plugin-picker__controls" });
    const searchSetting = new Setting(controls)
      .addText((text) => {
        text.inputEl.setAttr("aria-label", translate("搜索插件"));
        text.setPlaceholder(translate("搜索插件名称或 ID")).onChange((value) => {
          query = value;
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
          renderRows();
        });
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
    };

    const persistSelection = async (excludedPluginIds: string[]): Promise<void> => {
      this.plugin.settings.excludedPluginIds = excludedPluginIds;
      await this.plugin.savePluginData();
      this.plugin.refreshPluginTranslationRuntime();
      updateSummary();
      this.queueSelectionProcessing(status);
    };

    const renderRows = (): void => {
      list.empty();
      const pluginState = this.plugin.getPluginState();
      const visiblePlugins = filterSelectablePlugins(plugins, query).filter((plugin) => {
        const sourceStatus = pluginSourceStatus(plugin.source);
        if (sourceStatus !== null) return statusFilter === "all" || sourceStatus.kind === statusFilter;
        const localizationStatus = describePluginLocalizationStatus({
          submission: pluginState.pluginSubmissions[plugin.id],
          translation: pluginState.pluginTranslations[plugin.id],
          catalog: pluginState.pluginCatalogs[plugin.id],
          targetLocale: this.plugin.settings.targetLocale,
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
          submission: pluginState.pluginSubmissions[plugin.id],
          translation: pluginState.pluginTranslations[plugin.id],
          catalog: pluginState.pluginCatalogs[plugin.id],
          targetLocale: this.plugin.settings.targetLocale,
        });
        const displayName = this.plugin.settings.pluginMetadataTranslationEnabled
          ? localizedPluginDisplayName(
            plugin.name,
            pluginState.pluginCatalogs[plugin.id],
            pluginState.pluginTranslations[plugin.id],
            this.plugin.settings.targetLocale,
          )
          : plugin.name;
        const displayDescription = this.plugin.settings.pluginMetadataTranslationEnabled
          ? localizedPluginDescription(
            plugin.description,
            pluginState.pluginCatalogs[plugin.id],
            pluginState.pluginTranslations[plugin.id],
            this.plugin.settings.targetLocale,
          )
          : plugin.description;
        const statusLabel = sourceStatus?.label ?? localizationStatus.label;
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
        row.addToggle((toggle) => {
          const selectable = plugin.source.kind === "supported";
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
        const visualKind = sourceStatus?.kind ?? localizationStatus.kind;
        row.settingEl.addClass(`trans-hub-plugin-picker__item--${visualKind}`);
        if (plugin.source.kind !== "supported") row.settingEl.addClass("is-disabled");
        if (plugin.source.kind === "supported" && localizationStatus.kind === "failed") {
          row.addButton((button) => button.setButtonText(translate("重新处理")).setTooltip(translate("仅重新处理此插件")).onClick(async () => {
            await this.retrySinglePlugin(plugin.id);
          }));
        }
        const catalog = pluginState.pluginCatalogs[plugin.id];
        if (plugin.source.kind === "supported" && !excluded.has(plugin.id) && catalog !== undefined) {
          row.addButton((button) => button.setButtonText(translate("报告问题")).setTooltip(translate("报告漏译或不准确的插件译文")).onClick(() => {
            new UntranslatedFeedbackModal(this.app, this.plugin, catalog).open();
          }));
        }
        row.settingEl.setAttr("role", "listitem");
      }
    };

    updateSummary();
    renderRows();
  }

  private async retrySinglePlugin(pluginId: string): Promise<void> {
    if (this.selectionProcessing !== null) await this.selectionProcessing;
    this.selectionStatus = translate("正在重新处理 {pluginId}…", { pluginId });
    this.selectionStatusFailed = false;
    new Notice(this.selectionStatus);
    try {
      const result = await this.plugin.processSinglePlugin(pluginId);
      this.selectionStatus = describePluginSelectionProcessing(result);
      new Notice(this.selectionStatus);
    } catch (error) {
      this.selectionStatus = translate("处理失败：{message}", { message: errorMessage(error) });
      this.selectionStatusFailed = true;
      new Notice(this.selectionStatus, 10_000);
    } finally { this.refreshSettings(); }
  }

  private queueSelectionProcessing(status: HTMLElement): void {
    this.selectionRevision += 1;
    this.setSelectionStatus(status, translate("正在扫描所选插件…"));
    if (this.selectionProcessing !== null) return;
    this.selectionProcessing = this.processLatestSelection(status).finally(() => {
      this.selectionProcessing = null;
    });
  }

  private async processLatestSelection(status: HTMLElement): Promise<void> {
    let processedRevision = 0;
    while (processedRevision !== this.selectionRevision) {
      processedRevision = this.selectionRevision;
      try {
        const result = await this.plugin.processSelectedPlugins();
        if (processedRevision === this.selectionRevision) {
          this.setSelectionStatus(status, describePluginSelectionProcessing(result));
        }
      } catch (error) {
        if (processedRevision === this.selectionRevision) {
          const message = translate("处理失败：{message}", { message: errorMessage(error) });
          this.setSelectionStatus(status, message, true);
          new Notice(message, 10_000);
        }
      }
    }
  }

  private setSelectionStatus(status: HTMLElement, message: string, failed = false): void {
    this.selectionStatus = message;
    this.selectionStatusFailed = failed;
    status.setText(message);
    status.toggleClass("mod-warning", failed);
  }

  private refreshSettings(): void {
    const update = (this as { update?: () => void }).update;
    if (typeof update === "function") {
      update.call(this);
      return;
    }
    this.renderSettings(this.containerEl);
  }

  private renderRecovery(container: HTMLElement): void {
    const details = container.createEl("details", { cls: "trans-hub-settings__recovery" });
    details.createEl("summary", { text: translate("遇到问题") });
    const content = details.createDiv({ cls: "trans-hub-settings__recovery-content" });

    new Setting(content)
      .setName(translate("重新处理所选插件"))
      .setDesc(translate("重新扫描所选插件并尝试同步译文。通常不需要手动执行。"))
      .addButton((button) => button.setButtonText(translate("重新处理")).onClick(async () => {
        this.selectionStatus = translate("正在重新处理所选插件…");
        this.selectionStatusFailed = false;
        this.refreshSettings();
        try {
          const result = await this.plugin.processSelectedPlugins();
          this.selectionStatus = describePluginSelectionProcessing(result);
          this.selectionStatusFailed = false;
          new Notice(this.selectionStatus);
        } catch (error) {
          this.selectionStatus = translate("处理失败：{message}", { message: errorMessage(error) });
          this.selectionStatusFailed = true;
          new Notice(this.selectionStatus, 10_000);
        }
        this.refreshSettings();
      }));
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

class UntranslatedFeedbackModal extends Modal {
  private issueKind: "missing" | "inaccurate" = "missing";
  private sourceText = "";
  private currentTargetText = "";
  private suggestedTargetText = "";

  constructor(
    app: App,
    private readonly plugin: TransHubObsidianPlugin,
    private readonly catalog: ReturnType<TransHubObsidianPlugin["getPluginState"]>["pluginCatalogs"][string],
  ) { super(app); }

  override onOpen(): void {
    this.contentEl.createEl("h2", { text: translate("报告本地化问题") });
    this.contentEl.createEl("p", {
      text: translate("可报告 {pluginName} 的漏译或不准确译文。只会提交你确认的这一条内容，不会读取或上传笔记、文件路径或插件文件。", { pluginName: this.catalog.pluginName }),
      cls: "setting-item-description",
    });
    let targetTextFields: HTMLDivElement | null = null;
    new Setting(this.contentEl)
      .setName(translate("问题类型"))
      .addDropdown((dropdown) => dropdown
        .addOptions({ missing: translate("缺少译文"), inaccurate: translate("译文不准确") })
        .setValue(this.issueKind)
        .onChange((value) => {
          this.issueKind = value === "inaccurate" ? "inaccurate" : "missing";
          targetTextFields?.toggle(this.issueKind === "inaccurate");
        }));
    new Setting(this.contentEl)
      .setName(translate("对应的源文"))
      .setDesc(translate("用于定位具体界面条目；链接、路径和非界面内容会被拒绝。"))
      .addTextArea((text) => text
        .setPlaceholder(translate("例如：Settings"))
        .onChange((value) => { this.sourceText = value; }));
    targetTextFields = this.contentEl.createDiv();
    new Setting(targetTextFields)
      .setName(translate("当前显示的译文"))
      .addTextArea((text) => text.onChange((value) => { this.currentTargetText = value; }));
    new Setting(targetTextFields)
      .setName(translate("建议译文（可选）"))
      .addTextArea((text) => text.onChange((value) => { this.suggestedTargetText = value; }));
    targetTextFields.toggle(false);
    new Setting(this.contentEl).addButton((button) => button.setButtonText(translate("提交报告")).setCta().onClick(async () => {
      const draft = prepareUntranslatedFeedback({
        catalog: this.catalog,
        targetLocale: this.plugin.settings.targetLocale,
        untranslatedSources: [this.sourceText],
      });
      const item = draft.items[0];
      if (item === undefined) {
        new Notice(translate("请输入一条安全的短插件界面原文。"), 8_000);
        return;
      }
      try {
        await this.plugin.reportPluginLocalizationIssue({
          issueKind: this.issueKind,
          pluginId: draft.pluginId,
          pluginVersion: draft.pluginVersion,
          sourceText: item.source,
          currentTargetText: this.currentTargetText,
          suggestedTargetText: this.suggestedTargetText,
        });
        new Notice(translate("本地化问题已提交，感谢反馈。"));
        this.close();
      } catch (error) { new Notice(translate("提交失败：{message}", { message: errorMessage(error) }), 10_000); }
    }));
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
  if (source.kind === "supported") return null;
  return source.kind === "unsupported"
    ? { kind: "unsupported", label: translate("暂不支持：未找到可信 GitHub 来源") }
    : { kind: "source-pending", label: translate("来源待验证：暂时无法读取 Obsidian 官方目录") };
}
