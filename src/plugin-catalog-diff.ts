import type { PluginUiCatalog } from "./plugin-string-scanner";
import { placeholderSignature, resolvePluginStringSemanticRole } from "./plugin-string-scanner";
import type { PluginTranslationState } from "./plugin-state";
import type { PluginUiTranslation } from "./plugin-ui-runtime";

export interface PluginTranslationCoverage {
  readonly totalCount: number;
  readonly translatedCount: number;
  readonly missingCount: number;
  readonly staleCount: number;
  readonly percent: number;
  readonly exactPluginVersion: boolean;
}

export function calculatePluginTranslationCoverage(
  catalog: PluginUiCatalog | undefined,
  translation: PluginTranslationState | undefined,
  targetLocale: string,
): PluginTranslationCoverage | undefined {
  if (catalog === undefined || translation?.targetLocale !== targetLocale) return undefined;
  const currentSources = new Map(catalog.strings.map((item) => [item.source, item.placeholderSignature]));
  const translatedSources = new Set(translation.entries
    .filter((entry) => isCompatibleEntry(entry, currentSources))
    .map((entry) => entry.source));
  const staleCount = new Set(translation.entries
    .map((entry) => entry.source)
    .filter((source) => !currentSources.has(source))).size;
  const translatedCount = translatedSources.size;
  const totalCount = currentSources.size;
  return {
    totalCount,
    translatedCount,
    missingCount: Math.max(totalCount - translatedCount, 0),
    staleCount,
    percent: totalCount === 0 ? 100 : Math.round((translatedCount / totalCount) * 100),
    exactPluginVersion: translation.pluginVersion === catalog.pluginVersion,
  };
}

export function mergePublishedPluginTranslation(
  catalog: PluginUiCatalog,
  incoming: PluginTranslationState,
  previous: PluginTranslationState | undefined,
): PluginTranslationState {
  if (previous?.targetLocale !== incoming.targetLocale) return incoming;
  const currentSources = new Map(catalog.strings.map((item) => [item.source, item.placeholderSignature]));
  const entries = new Map<string, PluginUiTranslation>();
  for (const entry of previous.entries) {
    if (isCompatibleEntry(entry, currentSources)) entries.set(entry.source, entry);
  }
  for (const entry of incoming.entries) entries.set(entry.source, entry);
  return {
    ...incoming,
    pluginVersion: catalog.pluginVersion,
    entries: [...entries.values()].sort((left, right) => left.source.localeCompare(right.source)),
  };
}

export function selectCurrentCatalogTranslations(
  catalog: PluginUiCatalog | undefined,
  translation: PluginTranslationState,
  includeMetadata = true,
): readonly PluginUiTranslation[] {
  if (catalog === undefined) return [];
  const currentSources = new Map(catalog.strings
    .filter((item) => {
      const role = item.semanticRole ?? resolvePluginStringSemanticRole(item.origins);
      return includeMetadata || role === "runtime-ui";
    })
    .map((item) => [item.source, item.placeholderSignature]));
  return translation.entries.filter((entry) => isCompatibleEntry(entry, currentSources));
}

export function localizedPluginDisplayName(
  officialName: string,
  catalog: PluginUiCatalog | undefined,
  translation: PluginTranslationState | undefined,
  targetLocale: string,
): string {
  if (catalog === undefined || translation?.targetLocale !== targetLocale) return officialName;
  const nameString = findMetadataString(catalog, "official-name", officialName);
  if (nameString === undefined) return officialName;
  const translated = translation.entries.find((entry) =>
    entry.source === nameString.source
    && isCompatibleEntry(entry, new Map([[nameString.source, nameString.placeholderSignature]])));
  const localizedName = translated?.target.normalize("NFC").trim();
  return localizedName === undefined || localizedName === ""
    ? officialName
    : localizedName;
}

export function localizedPluginDescription(
  officialDescription: string,
  catalog: PluginUiCatalog | undefined,
  translation: PluginTranslationState | undefined,
  targetLocale: string,
): string {
  if (catalog === undefined || translation?.targetLocale !== targetLocale) return officialDescription;
  const descriptionString = findMetadataString(catalog, "description", officialDescription);
  if (descriptionString === undefined) return officialDescription;
  const translated = translation.entries.find((entry) =>
    entry.source === descriptionString.source
    && isCompatibleEntry(entry, new Map([[descriptionString.source, descriptionString.placeholderSignature]])));
  const localizedDescription = translated?.target.normalize("NFC").trim();
  return localizedDescription === undefined || localizedDescription === ""
    ? officialDescription
    : localizedDescription;
}

function findMetadataString(
  catalog: PluginUiCatalog,
  role: "official-name" | "description",
  officialText: string,
): PluginUiCatalog["strings"][number] | undefined {
  const candidates = catalog.strings.filter(
    (item) => (item.semanticRole ?? resolvePluginStringSemanticRole(item.origins)) === role,
  );
  return candidates.find((item) => item.source === officialText) ?? candidates[0];
}

function isCompatibleEntry(
  entry: PluginUiTranslation,
  currentSources: ReadonlyMap<string, string>,
): boolean {
  const expectedSignature = currentSources.get(entry.source);
  return expectedSignature !== undefined
    && placeholderSignature(entry.source) === expectedSignature
    && placeholderSignature(entry.target) === expectedSignature;
}
