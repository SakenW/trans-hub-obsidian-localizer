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

  it("gives users a visible refresh action and only shows initial cataloging while it is active", () => {
    expect(settingsSource).toContain('setButtonText(translate("立即刷新"))');
    expect(settingsSource).toContain('translate("未启用本地化")');
    expect(settingsSource).toContain('translate("正在首次自动收录…")');
    expect(settingsSource).not.toContain('translate("首次自动收录未完成；点击“立即刷新”重新检查")');
    expect(settingsSource).toMatch(
      /if \(selected === true && pluginId !== undefined\) \{\s*this\.queueSelectionProcessing\(status, pluginId\);/su,
    );
  });
});
