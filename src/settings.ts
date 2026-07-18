import { App, type ButtonComponent, Modal, Notice, PluginSettingTab, Setting } from "obsidian";

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
  parseTargetLocale,
} from "./product-config";
import { prepareUntranslatedFeedback } from "./untranslated-feedback";

const ORIGINAL_PLUGIN_NAME_ATTRIBUTE = "data-trans-hub-official-plugin-name";

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
    this.display();
  }

  override display(): void {
    const renderVersion = ++this.renderVersion;
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("trans-hub-settings");
    const intro = containerEl.createEl("p", {
      cls: "trans-hub-settings__intro setting-item-description",
    });
    intro.createSpan({
      text: translate("选择插件和目标语言，语枢会在译文发布后自动应用。第三方插件文件和笔记正文不会被修改。"),
    });
    intro.appendText(" ");
    intro.createEl("a", {
      text: translate("查看 Obsidian 本地化生态"),
      cls: "trans-hub-settings__ecosystem-link",
      href: TRANS_HUB_OBSIDIAN_ECOSYSTEM_URL,
      attr: {
        target: "_blank",
        rel: "noopener noreferrer",
      },
    });

    this.renderConnection(containerEl);

    addToggleSetting(
      containerEl,
      translate("自动翻译"),
      translate("关闭后立即恢复被运行时替换的原文；重新开启后继续应用所选插件的已发布译文。"),
      this.plugin.settings.pluginTranslationEnabled,
      async (value) => {
        this.plugin.settings.pluginTranslationEnabled = value;
        await this.plugin.savePluginData();
        this.plugin.refreshPluginTranslationRuntime();
        this.display();
      },
    );

    addToggleSetting(
      containerEl,
      translate("翻译插件名称和说明"),
      translate("默认开启。开启时显示译名和译文说明；关闭时显示官方名称和原始说明。尚无名称译文的插件会保留官方名称。"),
      this.plugin.settings.pluginMetadataTranslationEnabled,
      async (value) => {
        this.plugin.settings.pluginMetadataTranslationEnabled = value;
        await this.plugin.savePluginData();
        this.plugin.refreshPluginTranslationRuntime();
        this.display();
      },
    );

    const localeSetting = new Setting(containerEl)
      .setName(translate("翻译为"))
      .setDesc(translate("插件自带的目标语言会优先保留，语枢只补齐仍显示原文的界面。插件自身界面也使用这里选择的语言。"))
      .addDropdown((dropdown) => {
        dropdown.addOptions(Object.fromEntries(TARGET_LOCALE_OPTIONS.map((option) => [option.value, option.label])));
        dropdown.setValue(this.plugin.settings.targetLocale).onChange(async (value) => {
          this.plugin.settings.targetLocale = parseTargetLocale(value);
          this.plugin.applyClientLocale(this.plugin.settings.targetLocale);
          this.selectionStatus = translate("选择变化后会自动扫描并同步。");
          this.selectionStatusFailed = false;
          await this.plugin.savePluginData();
          this.plugin.refreshPluginTranslationRuntime();
          this.display();
        });
      });
    localeSetting.settingEl.addClass("trans-hub-settings__card");

    const pluginHeading = new Setting(containerEl).setName(translate("选择插件")).setHeading();
    pluginHeading.settingEl.addClass("trans-hub-settings__section-heading");
    containerEl.createEl("p", {
      text: translate("只显示当前已启用的第三方插件。有名称译文时显示译名，尚未发布时保留官方名称。默认全选，也可以搜索后逐项多选。"),
      cls: "setting-item-description",
    });
    const pluginPicker = containerEl.createDiv({ cls: "trans-hub-plugin-picker" });
    pluginPicker.createDiv({
      text: translate("正在读取已启用插件…"),
      cls: "trans-hub-plugin-picker__empty setting-item-description",
    });
    void this.renderPluginPicker(pluginPicker, renderVersion);

    this.renderRecovery(containerEl);
  }

  private renderConnection(container: HTMLElement): void {
    const connected = this.plugin.hasUserSession();
    const connection = new Setting(container)
      .setName(connected ? translate("语枢已连接") : translate("连接语枢"))
      .setDesc(connected
        ? translate("此设备会在重启 Obsidian 后自动恢复连接；离线时继续使用已缓存的已发布译文。")
        : translate("将在系统浏览器中登录并授权此设备；注册目前为邀请制。插件不会接触或保存账号密码。"));
    connection.settingEl.addClass("trans-hub-settings__card", "trans-hub-settings__connection");
    if (connected) {
      connection
        .addButton((button) => button.setButtonText(translate("清除本机连接")).onClick(() => {
          this.plugin.disconnect();
          new Notice(translate("已清除本机连接信息；服务器上的短期凭据会自动过期。"));
          this.display();
        }));
      return;
    }
    connection
      .addButton((button) => button.setButtonText(translate("在浏览器中连接")).setCta().onClick(async () => {
        try {
          await this.plugin.connect();
          this.selectionStatus = translate("请在浏览器中完成登录和设备授权。");
          this.selectionStatusFailed = false;
          this.display();
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
      this.updateObsidianPluginNavigationNames(plugins);
      this.renderPluginPickerContents(container, plugins);
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

  private renderPluginPickerContents(container: HTMLElement, plugins: readonly InstalledObsidianPlugin[]): void {
    const pluginIds = plugins.map((plugin) => plugin.id);
    let query = "";
    let statusFilter: PluginLocalizationStatusKind | "all" = "all";
    let selectAllButton: ButtonComponent;
    let clearButton: ButtonComponent;

    const summary = container.createDiv({ cls: "trans-hub-plugin-picker__summary" });
    const summaryText = summary.createSpan();
    summary.createSpan({ text: translate("{count} 个已启用插件", { count: plugins.length }), cls: "trans-hub-plugin-picker__total" });
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
          PLUGIN_LOCALIZATION_STATUS_FILTERS.map((option) => [option.value, translate(option.label)]),
        ));
        dropdown.setValue(statusFilter).onChange((value) => {
          statusFilter = value as PluginLocalizationStatusKind | "all";
          renderRows();
        });
      })
      .addButton((button) => {
        selectAllButton = button.setButtonText(translate("全选")).onClick(async () => {
          await persistSelection(setAllPluginsSelected(this.plugin.settings.excludedPluginIds, pluginIds, true));
          renderRows();
        });
      })
      .addButton((button) => {
        clearButton = button.setButtonText(translate("清空")).onClick(async () => {
          await persistSelection(setAllPluginsSelected(this.plugin.settings.excludedPluginIds, pluginIds, false));
          renderRows();
        });
      });
    actionsSetting.settingEl.addClass("trans-hub-plugin-picker__actions");

    const list = container.createDiv({ cls: "trans-hub-plugin-picker__list" });
    list.setAttr("role", "list");

    const updateSummary = (): void => {
      const selected = selectedPluginCount(pluginIds, this.plugin.settings.excludedPluginIds);
      summaryText.setText(translate("已选择 {selected} / {total}", { selected, total: plugins.length }));
      selectAllButton.setDisabled(selected === plugins.length);
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
        const metadata = `${plugin.id} · v${plugin.version} · ${localizationStatus.label}`;
        const row = new Setting(list)
          .setName(displayName)
          .setDesc(displayDescription === "" ? metadata : `${displayDescription} · ${metadata}`)
          .addToggle((toggle) => toggle
            .setValue(!excluded.has(plugin.id))
            .onChange(async (selected) => {
              await persistSelection(setPluginSelected(
                this.plugin.settings.excludedPluginIds,
                plugin.id,
                selected,
              ));
            }));
        row.settingEl.addClass(`trans-hub-plugin-picker__item--${localizationStatus.kind}`);
        if (localizationStatus.kind === "failed") {
          row.addButton((button) => button.setButtonText(translate("重新处理")).setTooltip(translate("仅重新处理此插件")).onClick(async () => {
            await this.retrySinglePlugin(plugin.id);
          }));
        }
        const catalog = pluginState.pluginCatalogs[plugin.id];
        if (!excluded.has(plugin.id) && catalog !== undefined) {
          row.addButton((button) => button.setButtonText(translate("报告漏译")).setTooltip(translate("报告仍显示原文的插件界面")).onClick(() => {
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
    } finally { this.display(); }
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
        this.display();
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
        this.display();
      }));
  }
}

class UntranslatedFeedbackModal extends Modal {
  private sourceText = "";

  constructor(
    app: App,
    private readonly plugin: TransHubObsidianPlugin,
    private readonly catalog: ReturnType<TransHubObsidianPlugin["getPluginState"]>["pluginCatalogs"][string],
  ) { super(app); }

  override onOpen(): void {
    this.contentEl.createEl("h2", { text: translate("报告漏译内容") });
    this.contentEl.createEl("p", {
      text: translate("请填写 {pluginName} 仍显示的原文。只会提交你确认的这一条短界面文案，不会读取或上传笔记内容、文件路径或插件文件。", { pluginName: this.catalog.pluginName }),
      cls: "setting-item-description",
    });
    new Setting(this.contentEl)
      .setName(translate("仍显示的原文"))
      .setDesc(translate("可填写扫描遗漏的短 UI 文案；链接、路径和非界面内容会被拒绝。"))
      .addTextArea((text) => text
        .setPlaceholder(translate("例如：Settings"))
        .onChange((value) => { this.sourceText = value; }));
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
        await this.plugin.reportMissingPluginTranslation({
          pluginId: draft.pluginId,
          pluginVersion: draft.pluginVersion,
          sourceText: item.source,
        });
        new Notice(translate("漏译报告已提交，感谢反馈。"));
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
): void {
  const setting = new Setting(container)
    .setName(name)
    .setDesc(description)
    .addToggle((toggle) => toggle.setValue(value).onChange(onChange));
  setting.settingEl.addClass("trans-hub-settings__card");
}
