import { renderCompatibilityToggle } from "./plugin-compatibility-toggle";
import type { PluginCompatibilityCheck, PluginPatchApproval } from "./plugin-compatibility";
import { type App, Modal, Notice, Setting } from "obsidian";
import { translate } from "./client-localization";
import { errorMessage } from "./error-message";
import type { PluginFileRestoreSummary } from "./plugin-automation";
import type { FilePatchResult, PluginFilePatchState } from "./third-party-plugin-patcher";

export function describeFileRestore(result: PluginFileRestoreSummary): string {
  if (result.restored === 0 && result.conflicts === 0) return translate("没有需要恢复的兼容补丁。");
  const summary = translate("已恢复 {restored} 个插件文件；{conflicts} 个需处理。重新加载目标插件后生效。", {
    restored: result.restored, conflicts: result.conflicts,
  });
  return result.conflictPluginIds.length === 0 ? summary : `${summary} ${result.conflictPluginIds.join("、")}`;
}

export function renderPluginPatchControls(row: Setting, input: {
  readonly app: App;
  readonly pluginName: string;
  readonly state: PluginFilePatchState;
  readonly canApply: boolean;
  readonly check?: () => Promise<PluginCompatibilityCheck>;
  readonly apply: (approval?: PluginPatchApproval) => Promise<FilePatchResult>;
  readonly restore: (force?: boolean) => Promise<PluginFileRestoreSummary>;
  readonly onComplete: (message: string, failed: boolean) => void;
}): void {
  if (input.state !== "conflict") {
    if (input.state === "active" || input.check !== undefined) renderCompatibilityToggle(row, {
      active: input.state === "active", label: input.check === undefined ? input.pluginName : undefined, check: input.check, apply: input.apply,
      restore: () => input.restore(), onComplete: input.onComplete,
    });
    return;
  }
  row.setDesc(translate("恢复遇到文件冲突，已保留当前文件。请使用“处理补丁冲突”查看处理方式。"));
  row.addButton((button) => {
    button.setButtonText(translate("处理补丁冲突"));
    button.onClick(async () => {
      button.setDisabled(true);
      let message: string;
      let failed = false;
      try {
        let result = await input.restore();
        if (result.conflicts > 0 && result.restored === 0
          && await confirmForceRestore(input.app, input.pluginName)) result = await input.restore(true);
        message = describeFileRestore(result);
        failed = result.conflicts > 0;
      } catch (error) {
        message = translate("处理失败：{message}", { message: errorMessage(error) });
        failed = true;
      }
      new Notice(message, failed ? 10_000 : 0);
      input.onComplete(message, failed);
      button.setDisabled(false);
    });
  });
}

function confirmForceRestore(app: App, pluginName: string): Promise<boolean> {
  return new Promise((resolve) => {
    class ForceRestoreModal extends Modal {
      private settled = false;
      override onOpen(): void {
        this.contentEl.empty();
        this.contentEl.createEl("h2", { text: translate("确认强制恢复") });
        this.contentEl.createEl("p", { text: pluginName });
        this.contentEl.createEl("p", {
          text: translate("该插件文件在补丁后被外部修改，无法安全恢复。是否强制用备份覆盖当前文件？"),
        });
        this.contentEl.createEl("p", {
          text: translate("此操作会覆盖该插件当前的 main.js；仅当备份摘要仍与原始文件一致时才会继续。"),
        });
        new Setting(this.contentEl)
          .addButton((button) => button.setButtonText(translate("保留当前文件")).onClick(() => this.finish(false)))
          .addButton((button) => {
            button.setButtonText(translate("强制恢复")).onClick(() => this.finish(true));
            button.buttonEl.addClass("mod-warning");
          });
      }
      override onClose(): void { this.contentEl.empty(); this.finish(false); }
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
