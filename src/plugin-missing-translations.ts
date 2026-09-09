import { unmatchedPluginInterfaceStrings } from "./plugin-catalog-diff";
import { translate } from "./client-localization";
import type { PluginTranslationState } from "./plugin-state";
import { hasCompatiblePlaceholderSignature, type PluginUiCatalog } from "./plugin-string-scanner";

export function describeMissingTranslations(catalog: PluginUiCatalog, translation: PluginTranslationState): readonly {
  source: string; reason: string;
}[] {
  const entries = new Map(translation.entries.map((entry) => [entry.source, entry]));
  const crossVersion = (translation.authorityPluginVersion ?? translation.pluginVersion) !== catalog.pluginVersion;
  return unmatchedPluginInterfaceStrings(catalog, translation).map((source) => {
    const entry = entries.get(source);
    let reason: string;
    if (/^zh(?:-|$)/u.test(translation.targetLocale) && /\p{Script=Han}/u.test(source) && !/[A-Za-z]/u.test(source)) reason = translate("原文含中文，保留原文");
    else if (entry !== undefined && !hasCompatiblePlaceholderSignature(source, entry.target)) reason = translate("占位符不一致，保留原文");
    else if (crossVersion) reason = translate("未找到安全匹配；当前译文来自其他版本");
    else if (entry !== undefined) reason = translate("未通过安全匹配，保留原文");
    else reason = translate("尚无匹配译文");
    return { source, reason };
  });
}
