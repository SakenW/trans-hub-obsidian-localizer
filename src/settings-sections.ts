import { App, Modal, Setting } from "obsidian";
import { translate } from "./client-localization";

export type SettingsSection = "plugins" | "basic" | "compatibility" | "help";

export function createSettingsSections(container: HTMLElement, selected: SettingsSection, onChange: (section: SettingsSection) => void, beforeChange?: () => void): Record<SettingsSection, HTMLElement> & { select: (section: SettingsSection) => void } {
  const navigation = container.createDiv({ cls: "trans-hub-settings__navigation" });
  navigation.setAttrs({ role: "navigation", "aria-label": translate("语枢设置分类") });
  const panels = {
    plugins: container.createDiv(), basic: container.createDiv(), compatibility: container.createDiv(), help: container.createDiv(),
  };
  const buttons: HTMLButtonElement[] = [];
  const options = [["plugins", "插件管理"], ["basic", "基本设置"], ["compatibility", "兼容与恢复"], ["help", "使用帮助"]] as const;
  const update = (current: SettingsSection): void => {
    for (const [index, [key]] of options.entries()) {
      panels[key].hidden = current !== key;
      panels[key].addClass("trans-hub-settings__panel");
      buttons[index]?.setAttr("aria-pressed", String(current === key));
    }
  };
  const select = (current: SettingsSection): void => { beforeChange?.(); update(current); onChange(current); };
  for (const [key, label] of options) new Setting(navigation).addButton((button) => {
    buttons.push(button.buttonEl);
    button.setButtonText(translate(label)).onClick(() => select(key));
  });
  update(selected);
  return { ...panels, select };
}

export function renderSettingsHelp(container: HTMLElement): void {
  const list = container.createDiv({ cls: "trans-hub-settings__help-list" });
  for (const [title, description] of [
    ["为什么有译文，界面仍显示原文？", "译文数量按已识别的文案统计，不代表全部界面都已替换。可在插件详情中查看缺失文案和版本差异。"],
    ["兼容处理能解决哪些问题？", "桌面端兼容处理仅写入与当前版本精确匹配的静态译文。尚未发布的译文、动态内容和服务端限制不能靠文件补丁解决。"],
    ["译文来自哪里？", "插件自带译文优先。语枢译文在详情中标注来源，多数机器译文未经人工校对。"],
    ["支持范围与离线使用", "仅支持官方社区目录中来源可验证的插件。离线时可继续使用已缓存的译文。"],
  ]) {
    const details = list.createEl("details", { cls: "trans-hub-settings__help" });
    details.createEl("summary", { text: translate(title) });
    details.createEl("p", { text: translate(description) });
  }
}

/** A separate confirmation boundary keeps cancellation free of selection writes. */
export function confirmDisableAllPlugins(app: App): Promise<boolean> {
  return new Promise((resolve) => new DisableAllPluginsModal(app, resolve).open());
}

class DisableAllPluginsModal extends Modal {
  constructor(app: App, private readonly resolve: (confirmed: boolean) => void) { super(app); }

  override onOpen(): void {
    this.contentEl.addClass("trans-hub-settings__confirmation");
    this.contentEl.createEl("h2", { text: translate("关闭全部插件本地化？") });
    this.contentEl.createEl("p", { text: translate("作用于全部可本地化插件，不受搜索和筛选限制。") });
    this.contentEl.createEl("p", { text: translate("关闭后恢复普通方式替换的原文，并尝试恢复兼容补丁；文件恢复后需重新加载目标插件，冲突会单独提示。") });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(translate("取消")).onClick(() => this.close()))
      .addButton((button) => {
        // Use the native warning class; setDestructive requires Obsidian 1.13.
        button.buttonEl.addClass("mod-warning");
        button.setButtonText(translate("确认关闭全部")).onClick(() => {
          this.resolve(true);
          this.close();
        });
      });
  }

  override onClose(): void {
    this.resolve(false);
    this.contentEl.empty();
  }
}
