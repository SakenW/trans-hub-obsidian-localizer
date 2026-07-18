import { LanguageTagError, normalizeLanguageTag } from "@trans-hub/language-tags";

import { protocolError } from "./errors.js";

declare const platformLocaleBrand: unique symbol;
declare const platformVariantBrand: unique symbol;

export type PlatformLocale = string & {
  readonly [platformLocaleBrand]: "PlatformLocale";
};

export type PlatformVariant = string & {
  readonly [platformVariantBrand]: "PlatformVariant";
};

export const LOCALE_NORMALIZATION_REVISION = 1 as const;

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  in: "id",
  iw: "he",
  ji: "yi",
});

const VARIANT_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;

export interface LocaleIdentity {
  readonly normalizationRevision: typeof LOCALE_NORMALIZATION_REVISION;
  readonly locale: PlatformLocale;
  readonly variant: PlatformVariant | null;
  readonly rawLocale: string;
  readonly rawVariant: string | null;
}

export function normalizePlatformLocale(value: unknown, path = "$.locale"): PlatformLocale {
  try {
    const structural = normalizeLanguageTag(value, { field: path });
    const [language, ...rest] = structural.split("-");
    const aliased = LANGUAGE_ALIASES[language ?? ""] ?? language;
    return [aliased, ...rest].join("-") as PlatformLocale;
  } catch (error) {
    if (error instanceof LanguageTagError) {
      protocolError("CP_INVALID_LOCALE", path, error.message);
    }
    throw error;
  }
}

export function normalizePlatformVariant(
  value: unknown,
  path = "$.variant"
): PlatformVariant | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    protocolError("CP_INVALID_VARIANT", path, "variant must be a string or null");
  }
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  if (
    normalized.length === 0 ||
    normalized === "default" ||
    !VARIANT_PATTERN.test(normalized) ||
    normalized.includes("..") ||
    normalized.includes("--")
  ) {
    protocolError(
      "CP_INVALID_VARIANT",
      path,
      "variant must be an explicit normalized platform variant"
    );
  }
  return normalized as PlatformVariant;
}

export function normalizeLocaleIdentity(input: {
  readonly locale: unknown;
  readonly variant: unknown;
}): LocaleIdentity {
  if (typeof input.locale !== "string") {
    protocolError("CP_INVALID_LOCALE", "$.locale", "locale must be a string");
  }
  if (input.variant !== null && typeof input.variant !== "string") {
    protocolError("CP_INVALID_VARIANT", "$.variant", "variant must be a string or null");
  }
  return Object.freeze({
    normalizationRevision: LOCALE_NORMALIZATION_REVISION,
    locale: normalizePlatformLocale(input.locale),
    variant: normalizePlatformVariant(input.variant),
    rawLocale: input.locale,
    rawVariant: input.variant,
  });
}
