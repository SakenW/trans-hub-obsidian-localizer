import {
  ItemView,
  type IconName,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";

import { translate } from "./client-localization";
import type { TransHubSettingTab } from "./settings";

export const PLUGIN_MANAGER_VIEW_TYPE = "trans-hub-plugin-manager";

/**
 * The plugin manager is a normal workspace view rather than a child of the
 * settings tab. This gives long plugin lists the full pane height and lets
 * users resize or split the view with Obsidian's native workspace controls.
 */
export class PluginManagerView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly settingsTab: TransHubSettingTab,
  ) {
    super(leaf);
  }

  override getViewType(): string { return PLUGIN_MANAGER_VIEW_TYPE; }
  override getDisplayText(): string { return translate("插件本地化"); }
  override getIcon(): IconName { return "languages"; }

  override onOpen(): Promise<void> {
    // Obsidian invokes setState() immediately after onOpen(). Rendering here
    // would be cleared by that lifecycle step, leaving a blank popout window.
    return Promise.resolve();
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.contentEl.addClass("trans-hub-plugin-manager");
    this.settingsTab.mountPluginManager(this.contentEl);
    await super.setState(state, result);
  }

  override onClose(): Promise<void> {
    this.settingsTab.unmountPluginManager(this.contentEl);
    this.contentEl.empty();
    return Promise.resolve();
  }

  refresh(): void {
    this.settingsTab.refreshPluginManager();
  }
}
