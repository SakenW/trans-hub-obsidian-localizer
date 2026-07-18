import {
  isPlausibleSourceLocaleText,
  isTranslatableUiText,
  type PluginStringOrigin,
  type PluginUiCatalog,
} from "./plugin-string-scanner";

const MAX_FEEDBACK_ITEMS = 100;

export interface UntranslatedFeedbackDraft {
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly targetLocale: string;
  readonly items: readonly {
    readonly stringKey?: string;
    readonly source: string;
    readonly origins: readonly PluginStringOrigin[];
  }[];
}

/**
 * Prepares an intentionally narrow report without reading files or performing
 * network I/O. The caller delivers the confirmed item through the generic
 * contribution contract.
 */
export function prepareUntranslatedFeedback(input: {
  readonly catalog: PluginUiCatalog;
  readonly targetLocale: string;
  readonly untranslatedSources: readonly string[];
}): UntranslatedFeedbackDraft {
  const catalogBySource = new Map(input.catalog.strings.map((item) => [item.source, item]));
  const items = [...new Set(input.untranslatedSources.map(normalizeSource))]
    .filter((source) => isTranslatableUiText(source)
      && isPlausibleSourceLocaleText(source, input.catalog.sourceLocale))
    .slice(0, MAX_FEEDBACK_ITEMS)
    .map((source) => {
      const known = catalogBySource.get(source);
      return {
        ...(known === undefined ? {} : { stringKey: known.key }),
        source,
        origins: known?.origins ?? [],
      };
    });
  return {
    pluginId: input.catalog.pluginId,
    pluginVersion: input.catalog.pluginVersion,
    targetLocale: input.targetLocale,
    items,
  };
}

function normalizeSource(value: string): string {
  return value.normalize("NFC").trim();
}
