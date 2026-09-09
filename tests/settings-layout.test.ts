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

  it("keeps primary controls ahead of folded advanced settings", () => {
    expect(settingsSource.indexOf("this.renderConnection(containerEl)")).toBeLessThan(settingsSource.indexOf('translate("译文语言")', settingsSource.indexOf("private renderSettings")));
    expect(settingsSource.indexOf('translate("打开插件管理器")')).toBeLessThan(settingsSource.indexOf('translate("高级选项")'));
    expect(settingsSource).toContain('createEl("details", { cls: "trans-hub-settings__advanced" })');
  });

  it("states default file safety and the verifiable community source boundary", () => {
    expect(settingsSource).toContain("默认不修改插件文件，始终不修改笔记正文");
    expect(settingsSource).toContain("仅支持官方社区目录中来源可验证的插件");
  });

  it("keeps recovery actions inside the plugin manager instead of the settings page", () => {
    expect(settingsSource).not.toContain("renderRecovery");
    expect(settingsSource).not.toContain("refreshSelectedPluginStatus");
    expect(settingsSource).toContain("retryRecoverablePlugins");
    expect(settingsSource).not.toContain("syncInstalledPluginTranslations(");
    expect(settingsSource).toContain("processSelectedPlugins()");
    expect(settingsSource).not.toContain("processSelectedPlugins(true)");
  });

  it("keeps file recovery visible outside the folded compatibility switch", () => {
    expect(settingsSource.indexOf("this.renderFileRecovery(containerEl)")).toBeLessThan(settingsSource.indexOf('translate("高级选项")'));
    expect(settingsSource).toContain('translate("恢复所有兼容补丁")');
    expect(settingsSource).toContain("renderPluginPatchControls(row");
  });
});
