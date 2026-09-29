import { translate } from "./client-localization";
import type { PluginFilePatchPreview } from "./third-party-plugin-patcher";

/** A one-operation approval, issued by a read-only check and consumed on apply. */
export interface PluginPatchApproval {
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly targetLocale: string;
  readonly fingerprint: string;
}

export type PluginCompatibilityCheck =
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "checked"; readonly preview: PluginFilePatchPreview; readonly approval?: PluginPatchApproval };

export function describePatchPreview(preview: PluginFilePatchPreview): string {
  switch (preview.reason) {
    case "candidate": return translate("可写入 {count} 处静态文本。这不代表所有未翻译界面都能补齐。", { count: preview.patchCount });
    case "no-catalog": return translate("尚未取得当前插件的文案目录，请先检查译文进度。");
    case "no-pack": return translate("尚无可用译文。兼容处理不能生成缺失的翻译。");
    case "cross-version": return translate("插件与译文版本不一致，不能写入文件补丁。可继续使用普通方式的匹配译文。");
    case "catalog-mismatch": return translate("当前目录与译文不匹配，请先检查更新。未通过核验前不会修改文件。");
    case "artifact-mismatch": return translate("插件文件与已验证来源不一致，未修改文件。请检查插件更新或外部修改。");
    case "no-exact-literal": return translate("没有可安全写入的静态文本。请继续使用普通本地化；仍有原文时提供具体位置以便核查。");
    case "overlapping-literals": return translate("静态文本位置存在冲突，无法安全应用。已保留原始文件。");
  }
}
