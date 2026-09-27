import { pluginCatalogMatchFailure, unmatchedPluginInterfaceStrings, type PluginCatalogMatchFailure } from "./plugin-catalog-diff";
import { translate } from "./client-localization";
import type { PluginTranslationState } from "./plugin-state";
import type { PluginUiCatalog } from "./plugin-string-scanner";

const MATCH_FAILURE_LABELS: Readonly<Record<PluginCatalogMatchFailure, string>> = {
  "ambiguous-source": "同一原文对应多个界面位置，无法安全匹配",
  placeholder: "占位符不一致，保留原文",
  "missing-compatibility": "跨版本译文缺少兼容证明，保留原文",
  "semantic-role": "界面语义不一致，保留原文",
  "content-scopes": "内容范围不一致，保留原文",
  format: "文本格式不一致，保留原文",
};

export function describeMissingTranslations(catalog: PluginUiCatalog, translation: PluginTranslationState): readonly {
  source: string; reason: string;
}[] {
  const entries = new Map(translation.entries.map((entry) => [entry.source, entry]));
  const candidates = new Map<string, PluginUiCatalog["strings"]>();
  for (const item of catalog.strings) {
    candidates.set(item.source, [...(candidates.get(item.source) ?? []), item]);
  }
  const crossVersion = (translation.authorityPluginVersion ?? translation.pluginVersion) !== catalog.pluginVersion;
  return unmatchedPluginInterfaceStrings(catalog, translation).map((source) => {
    const entry = entries.get(source);
    let reason: string;
    if (/^zh(?:-|$)/u.test(translation.targetLocale) && /\p{Script=Han}/u.test(source) && !/[A-Za-z]/u.test(source)) reason = translate("原文含中文，保留原文");
    else if (entry === undefined) reason = translate("当前译文包无此文案；来源与发布状态待核验");
    else {
      const failure = pluginCatalogMatchFailure(entry, candidates.get(source), crossVersion);
      reason = translate(failure === null ? "未通过安全匹配，保留原文" : MATCH_FAILURE_LABELS[failure]);
    }
    return { source, reason };
  });
}
