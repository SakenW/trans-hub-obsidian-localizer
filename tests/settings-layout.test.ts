import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settingsSource = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("Obsidian settings page layout", () => {
  it("isolates the 1.13 custom definition from the native setting-item flex row", () => {
    expect(settingsSource).toContain('setting.settingEl.addClass("trans-hub-settings-host")');
    expect(settingsSource).toContain("this.renderSettings(setting.settingEl.createDiv())");
  });

  it("keeps the page wrapper full-width even when its host is a flex item", () => {
    expect(styles).toMatch(/\.trans-hub-settings-host\s*\{[^}]*display:\s*block;/su);
    expect(styles).toMatch(/\.trans-hub-settings-host\s*\{[^}]*flex:\s*1\s+1\s+100%;/su);
    expect(styles).toMatch(/\.trans-hub-settings-host\s*\{[^}]*width:\s*100%;/su);
    expect(styles).toMatch(/\.trans-hub-settings\s*\{[^}]*display:\s*block;/su);
    expect(styles).toMatch(/\.trans-hub-settings\s*\{[^}]*min-width:\s*0;/su);
    expect(styles).toMatch(/\.trans-hub-settings\s*\{[^}]*width:\s*100%;/su);
  });

  it("keeps initial localization in a processing state instead of showing a false unrecorded warning", () => {
    expect(settingsSource).toContain('setButtonText(translate("刷新状态"))');
    expect(settingsSource).toContain('setButtonText(translate("重新同步"))');
    expect(settingsSource).toContain('translate("未启用本地化")');
    expect(settingsSource).toContain('translate("正在首次自动收录…")');
    expect(settingsSource).toContain("const initialSubmission = localizationStatus.initialSubmission === true;");
    expect(settingsSource).not.toContain('translate("立即刷新")');
    expect(settingsSource).not.toContain('translate("遇到问题")');
    expect(settingsSource).not.toContain('translate("重新处理所选插件")');
    expect(settingsSource).not.toContain('translate("首次自动收录未完成；点击“立即刷新”重新检查")');
    expect(settingsSource).toMatch(
      /if \(selected === true && pluginId !== undefined\) \{\s*this\.queueSelectionProcessing\(status, pluginId\);/su,
    );
  });

  it("states the supported plugin boundary before users reach the controls", () => {
    expect(settingsSource).toContain('translate("仅支持官方社区插件")');
    expect(settingsSource).toContain(
      'translate("非社区插件缺少可验证的官方目录和版本来源。为避免对未知版本错误应用译文，语枢不会自动处理它们。")',
    );
    expect(styles).toContain(".trans-hub-settings__scope");
    expect(styles).toContain(".trans-hub-settings__scope-label");
  });

  it("keeps recovery actions inside the plugin manager instead of the settings page", () => {
    expect(settingsSource).not.toContain("renderRecovery");
    expect(settingsSource).toContain("refreshSelectedPluginStatus");
    expect(settingsSource).toContain("refreshPluginStatusBatch(");
    expect(settingsSource).not.toContain("syncInstalledPluginTranslations(");
    expect(settingsSource).toContain("processSelectedPlugins()");
    expect(settingsSource).not.toContain("processSelectedPlugins(true)");
  });

  it("reflects the compatibility patch state with apply and remove actions", () => {
    expect(settingsSource).toContain('translate("高级兼容模式（会修改插件文件）")');
    expect(settingsSource).toContain(
      'translate("默认关闭。大多数界面文案可在运行时直接显示译文，不需要修改插件文件。少数插件把设置页单独渲染，运行时无法触及，才需要开启此模式。开启后，请在插件管理器中为符合条件的插件单独使用兼容补丁。系统只写入已发布、与当前版本完全匹配且位置可确认的静态文案，并先保存可恢复备份。动态文案、带变量的模板、未收录版本或无法确认写入位置的插件不会提供补丁，以免改坏插件。关闭后会恢复原文件；更改后请重启 Obsidian 或重新加载目标插件。")',
    );
    expect(settingsSource).toContain('translate("使用兼容补丁")');
    expect(settingsSource).toContain(
      'translate("此插件的设置页无法由运行时本地化覆盖。仅写入已发布、与当前版本完全匹配且位置可确认的静态文案，并先保存备份；动态文案、带变量的模板和不匹配版本不会修改。")',
    );
    expect(settingsSource).toContain('translate("取消兼容补丁")');
    expect(settingsSource).toContain("refreshPluginPatchStates");
    expect(settingsSource).toContain("restoreThirdPartyPluginFiles([plugin.id])");
    expect(settingsSource).toContain("patchStateByPluginId.set(plugin.id");
    // One button switches between the two states; no separate applied badge.
    expect(settingsSource).not.toContain('translate("已应用兼容补丁")');
  });
});
