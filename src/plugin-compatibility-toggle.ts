import { Setting, type ToggleComponent } from "obsidian";
import { translate } from "./client-localization";
import { errorMessage } from "./error-message";
import { describePatchPreview, type PluginCompatibilityCheck, type PluginPatchApproval } from "./plugin-compatibility";
import type { PluginFileRestoreSummary } from "./plugin-automation";
import type { FilePatchResult } from "./third-party-plugin-patcher";

export function renderCompatibilityToggle(row: Setting, input: {
  readonly active: boolean;
  readonly label?: string;
  readonly check?: () => Promise<PluginCompatibilityCheck>;
  readonly apply: (approval?: PluginPatchApproval) => Promise<FilePatchResult>;
  readonly restore: () => Promise<PluginFileRestoreSummary>;
  readonly onComplete: (message: string, failed: boolean) => void;
}): void {
  let active = input.active;
  let busy = false;
  let approval: PluginPatchApproval | undefined;
  let toggle: ToggleComponent;
  row.settingEl.removeClass("setting-item");
  row.settingEl.addClass("trans-hub-plugin-picker__compatibility-switch");
  row.setName(input.label ?? translate("兼容模式（可选）"));
  row.setDesc(active
    ? translate("已写入兼容补丁。关闭会恢复原始文件；操作后需重新加载此插件。")
    : translate("正在检查版本、文件和可用译文…"));
  row.descEl.setAttrs({ role: "status", "aria-live": "polite" });

  const check = async (): Promise<void> => {
    approval = undefined;
    toggle.setDisabled(true).setValue(false);
    try {
      const result = await input.check?.();
      if (!row.settingEl.isConnected) return;
      if (result?.kind === "checked" && result.preview.kind === "candidate" && result.approval !== undefined) {
        approval = result.approval;
        row.setDesc(translate("可尝试补充 {count} 处静态文案。开启会备份并修改插件文件，关闭会恢复；操作后需重新加载插件。", { count: result.preview.patchCount }));
        toggle.setDisabled(false);
      } else {
        row.setDesc(result?.kind === "checked" ? describePatchPreview(result.preview)
          : result?.message ?? translate("当前没有可用的兼容补丁。"));
      }
    } catch (error) {
      if (row.settingEl.isConnected) row.setDesc(translate("检查失败：{message}。重新展开详情后可重试，未修改文件。", { message: errorMessage(error) }));
    }
  };

  row.addToggle((control) => {
    toggle = control.setValue(active).setDisabled(!active);
    toggle.toggleEl.setAttr("aria-label", input.label ?? translate("兼容模式（可选）"));
    toggle.onChange(async (value) => {
      if (busy || value === active || (value && approval === undefined)) { toggle.setValue(active); return; }
      busy = true;
      // Keep the switch on the verified file state until the operation succeeds.
      toggle.setValue(active).setDisabled(true);
      const currentApproval = approval;
      approval = undefined;
      row.setDesc(translate(value ? "正在备份并应用…" : "正在恢复原始文件…"));
      try {
        if (value) {
          const result = await input.apply(currentApproval);
          const failed = result.applied === 0 || result.conflicts > 0;
          active = result.applied > 0;
          const message = active
            ? translate("已写入 {applied} 处静态文本，待重新加载目标插件。请检查原先未翻译的位置。", { applied: result.applied })
            : result.conflicts > 0
              ? translate("插件文件已变化，未写入补丁。请检查此插件的安装状态。")
              : translate("检查结果已变化，未写入补丁。请重新展开详情后再试。");
          row.setDesc(message);
          input.onComplete(message, failed);
        } else {
          // Ordinary switch-off never grants permission to overwrite external edits.
          const result = await input.restore();
          active = result.conflicts > 0;
          const message = active
            ? translate("恢复遇到文件冲突，已保留当前文件。请使用“处理补丁冲突”查看处理方式。")
            : result.restored > 0 ? translate("原始文件已恢复，重新加载目标插件后生效。")
              : translate("没有需要恢复的兼容补丁。");
          row.setDesc(message);
          input.onComplete(message, active);
        }
      } catch (error) {
        const message = translate("处理失败：{message}", { message: errorMessage(error) });
        row.setDesc(message);
        input.onComplete(message, true);
      } finally {
        busy = false;
        toggle.setValue(active).setDisabled(!active);
      }
    });
  });
  if (!active) void check();
}
