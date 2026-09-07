import { type App, Modal, Notice, Setting } from "obsidian";
import { translate } from "./client-localization";
import { errorMessage } from "./error-message";
import type { PluginFileRestoreSummary } from "./plugin-automation";
import type { FilePatchResult, PluginFilePatchState } from "./third-party-plugin-patcher";

export function describeFileRestore(result: PluginFileRestoreSummary): string {
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
  readonly apply: () => Promise<FilePatchResult>;
  readonly restore: (force?: boolean) => Promise<PluginFileRestoreSummary>;
  readonly onComplete: (message: string, failed: boolean) => void;
}): void {
  const restore = input.state !== "none";
  if (!restore && !input.canApply) return;
  row.addButton((button) => {
    button.setButtonText(restore
      ? translate(input.state === "conflict" ? "处理补丁冲突" : "取消兼容补丁")
      : translate("使用兼容补丁"));
    button.setTooltip(restore
      ? translate("恢复此插件的原始文件；如有外部修改，将先保留文件并提示。")
      : translate("写入与当前版本匹配的静态译文并保存备份，需要重新加载此插件。"));
    button.onClick(async () => {
      button.setDisabled(true).setButtonText(translate(restore ? "正在取消…" : "正在应用…"));
      let message: string;
      let failed = false;
      try {
        if (restore) {
          let result = await input.restore();
          if (result.conflicts > 0 && result.restored === 0) {
            if (await confirmForceRestore(input.app, input.pluginName)) result = await input.restore(true);
          }
          message = describeFileRestore(result);
          failed = result.conflicts > 0;
        } else {
          const result = await input.apply();
          if (result.applied > 0) {
            message = translate("已写入 {applied} 条静态译文。重新加载目标插件后生效。", { applied: result.applied });
            failed = result.conflicts > 0;
          } else {
            message = result.conflicts > 0
              ? translate("插件文件已变化，未写入补丁。请检查此插件的安装状态。")
              : translate("当前没有可写入的匹配译文。请稍后检查进度。");
            failed = true;
          }
        }
      } catch (error) {
        message = translate("处理失败：{message}", { message: errorMessage(error) });
        failed = true;
      }
      new Notice(message, failed ? 10_000 : 0);
      input.onComplete(message, failed);
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
