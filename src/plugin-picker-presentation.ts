import { translate } from "./client-localization";
import type { PluginLocalizationStatus } from "./plugin-localization-status";
import type { PluginSourceState } from "./plugin-picker-source";

export type PluginPickerDisplayKind = "localized" | "partial" | "processing" | "attention"
  | "off" | "paused" | "unsupported" | "source-pending" | "login-required" | "preserved-source";

export const PLUGIN_PICKER_FILTERS: readonly { value: PluginPickerDisplayKind | "all"; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "localized", label: "译文可用" },
  { value: "partial", label: "部分译文可用" },
  { value: "processing", label: "正在准备翻译" },
  { value: "attention", label: "需要处理" },
  { value: "off", label: "已关闭" },
  { value: "paused", label: "已暂停" },
  { value: "login-required", label: "需要连接" },
  { value: "unsupported", label: "暂不支持" },
  { value: "source-pending", label: "暂无法确认来源" },
  { value: "preserved-source", label: "保留原文" },
];

export function presentPluginLocalization(input: {
  readonly source: PluginSourceState;
  readonly selected: boolean;
  readonly enabled: boolean;
  readonly localization: PluginLocalizationStatus;
  readonly processing?: boolean;
}): { readonly kind: PluginPickerDisplayKind; readonly label: string } {
  let kind: PluginPickerDisplayKind;
  if (input.source.kind === "pending") kind = "source-pending";
  else if (input.source.kind === "unsupported") kind = "unsupported";
  else if (!input.selected) kind = "off";
  else if (!input.enabled) kind = "paused";
  else if (input.localization.kind === "login-required") kind = "login-required";
  else if (input.processing) kind = "processing";
  else switch (input.localization.kind) {
    case "localized": kind = input.localization.coverage?.complete === false ? "partial" : "localized"; break;
    case "waiting": case "unrecorded": case "catalog-mismatch": kind = "processing"; break;
    case "blocked": case "failed": kind = "attention"; break;
    case "preserved-source": kind = "preserved-source"; break;
  }
  return {
    kind,
    label: input.localization.label === translate("源语言，无需翻译") && kind === "localized"
      ? input.localization.label
      : translate(PLUGIN_PICKER_FILTERS.find((item) => item.value === kind)?.label ?? "需要处理"),
  };
}
