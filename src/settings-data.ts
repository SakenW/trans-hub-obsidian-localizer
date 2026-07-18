import { parseTargetLocale, type TargetLocale } from "./product-config";

export interface TransHubPluginSettings {
  targetLocale: TargetLocale;
  pluginTranslationEnabled: boolean;
  pluginMetadataTranslationEnabled: boolean;
  excludedPluginIds: string[];
}

export const DEFAULT_SETTINGS: Readonly<TransHubPluginSettings> = {
  targetLocale: "zh-CN",
  pluginTranslationEnabled: true,
  pluginMetadataTranslationEnabled: true,
  excludedPluginIds: [],
};

export function loadSettings(
  data: unknown,
  defaultTargetLocale: TargetLocale = DEFAULT_SETTINGS.targetLocale,
): TransHubPluginSettings {
  if (!isRecord(data)) return { ...DEFAULT_SETTINGS, targetLocale: defaultTargetLocale };
  return {
    targetLocale: parseTargetLocale(data.targetLocale, defaultTargetLocale),
    pluginTranslationEnabled: booleanOr(data.pluginTranslationEnabled, DEFAULT_SETTINGS.pluginTranslationEnabled),
    pluginMetadataTranslationEnabled: booleanOr(
      data.pluginMetadataTranslationEnabled,
      DEFAULT_SETTINGS.pluginMetadataTranslationEnabled,
    ),
    excludedPluginIds: stringArrayOr(data.excludedPluginIds, DEFAULT_SETTINGS.excludedPluginIds),
  };
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArrayOr(value: unknown, fallback: readonly string[]): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [...fallback];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
