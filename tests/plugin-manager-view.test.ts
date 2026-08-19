import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viewSource = readFileSync(new URL("../src/plugin-manager-view.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("plugin localization manager view", () => {
  it("uses a dedicated workspace ItemView instead of embedding the list in settings", () => {
    expect(viewSource).toContain("extends ItemView");
    expect(viewSource).toContain('PLUGIN_MANAGER_VIEW_TYPE = "trans-hub-plugin-manager"');
    expect(viewSource).toContain("override async setState");
    expect(viewSource).toContain("this.settingsTab.mountPluginManager(this.contentEl)");
    expect(viewSource).toContain('override getIcon(): IconName { return "languages"; }');
    expect(settingsSource).toContain("mountPluginManager(containerEl: HTMLElement)");
    expect(settingsSource).toContain('setButtonText(translate("打开插件管理器"))');
    expect(settingsSource).not.toContain("void this.renderPluginPicker(pluginPicker");
  });

  it("opens the reusable view in a resizable window and keeps a safe workspace fallback", () => {
    expect(mainSource).toContain("this.registerView(");
    expect(mainSource).toContain("open-plugin-localization-manager");
    expect(mainSource).toContain("getLeavesOfType(PLUGIN_MANAGER_VIEW_TYPE)");
    expect(mainSource).toContain("openPopoutLeaf");
    expect(mainSource).toContain("size: { width: 960, height: 760 }");
    expect(mainSource).toContain('getLeaf("tab")');
  });

  it("lets the workspace pane own the list height instead of a fixed settings viewport", () => {
    expect(settingsSource).toContain('"trans-hub-plugin-picker__overview"');
    expect(settingsSource).toContain('status.setAttr("aria-live", "polite")');
    expect(styles).toMatch(/\.trans-hub-plugin-picker__overview\s*\{[^}]*display:\s*flex;/su);
    expect(styles).toMatch(/\.trans-hub-plugin-manager__content\s*\{[^}]*height:\s*100%;/su);
    expect(styles).toMatch(/\.trans-hub-plugin-manager__content\s+\.trans-hub-plugin-picker__list\s*\{[^}]*flex:\s*1\s+1\s+auto;/su);
    expect(styles).toMatch(/\.trans-hub-plugin-manager__content\s+\.trans-hub-plugin-picker__list\s*\{[^}]*max-height:\s*none;/su);
  });
});
