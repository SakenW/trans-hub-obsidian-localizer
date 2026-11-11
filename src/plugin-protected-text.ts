import type { PluginUiTranslation } from "./plugin-ui-runtime";

const CALLOUT_MARKER = /\[![A-Za-z][A-Za-z0-9_-]*\][+-]?/gu;

export function isStandaloneCalloutMarker(source: string): boolean {
  const text = source.trim();
  return [...text.matchAll(CALLOUT_MARKER)].some((match) => match[0] === text);
}

/** Host syntax is data, even when a plugin passes it through a text UI sink. */
export function preservesCalloutMarkers(source: string, target: string): boolean {
  const markers = (value: string): string[] => [...value.matchAll(CALLOUT_MARKER)]
    .map((match) => match[0]);
  const expected = markers(source);
  const actual = markers(target);
  return expected.length === actual.length
    && expected.every((marker, index) => marker === actual[index]);
}

/** A published machine result is not evidence that a product name was reviewed. */
export function allowsOfficialNameTranslation(
  entry: Pick<PluginUiTranslation, "source" | "target" | "provenanceKind">,
): boolean {
  return entry.source.normalize("NFC").trim() === entry.target.normalize("NFC").trim()
    || entry.provenanceKind === "upstream-native"
    || entry.provenanceKind === "th-reviewed-fill"
    || entry.provenanceKind === "th-reviewed-correction";
}

export function isProtectedPluginTextSafe(
  entry: Pick<PluginUiTranslation, "source" | "target" | "provenanceKind" | "sourceCompatibility">,
  semanticRole = entry.sourceCompatibility?.semanticRole,
): boolean {
  return preservesCalloutMarkers(entry.source, entry.target)
    && (semanticRole !== "official-name" || allowsOfficialNameTranslation(entry));
}
