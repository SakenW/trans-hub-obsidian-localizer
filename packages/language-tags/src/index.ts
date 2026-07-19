export type LanguageTagErrorCode =
  | "invalid_type"
  | "invalid_format"
  | "same_as_source"
  | "empty"
  | "contains_source_language";

export interface LanguageTagErrorDetail {
  readonly field: string;
  readonly code: LanguageTagErrorCode;
  readonly message: string;
  readonly input: unknown;
}

export interface LanguageTagErrorOptions {
  readonly field: string;
  readonly code: LanguageTagErrorCode;
  readonly message: string;
  readonly inputValue: unknown;
}

export interface LanguageTagFieldOptions {
  readonly field?: string;
}

export interface RequiredLanguageTagFieldOptions {
  readonly field: string;
}

export class LanguageTagError extends Error {
  readonly field: string;
  readonly code: LanguageTagErrorCode;
  readonly inputValue: unknown;

  constructor(options: LanguageTagErrorOptions) {
    super(options.message);
    this.name = "LanguageTagError";
    this.field = options.field;
    this.code = options.code;
    this.inputValue = options.inputValue;
  }

  asDetail(): LanguageTagErrorDetail {
    return {
      field: this.field,
      code: this.code,
      message: this.message,
      input: this.inputValue,
    };
  }

  override toString(): string {
    return this.message;
  }
}

const GRANDFATHERED_LANGUAGE_TAGS: ReadonlySet<string> = new Set([
  "art-lojban",
  "cel-gaulish",
  "en-gb-oed",
  "i-ami",
  "i-bnn",
  "i-default",
  "i-enochian",
  "i-hak",
  "i-klingon",
  "i-lux",
  "i-mingo",
  "i-navajo",
  "i-pwn",
  "i-tao",
  "i-tay",
  "i-tsu",
  "no-bok",
  "no-nyn",
  "sgn-be-fr",
  "sgn-be-nl",
  "sgn-ch-de",
  "zh-guoyu",
  "zh-hakka",
  "zh-min",
  "zh-min-nan",
  "zh-xiang",
]);

const ALNUM_PATTERN = /^[A-Za-z0-9]+$/;
const ALPHA_PATTERN = /^[A-Za-z]+$/;
const DIGIT_PATTERN = /^[0-9]+$/;

function createInvalidFormatError(
  field: string,
  inputValue: unknown,
): LanguageTagError {
  return new LanguageTagError({
    field,
    code: "invalid_format",
    message: `${field} must be a structurally well-formed BCP 47 tag`,
    inputValue,
  });
}

function isAlpha(value: string): boolean {
  return ALPHA_PATTERN.test(value);
}

function isAlnum(value: string): boolean {
  return ALNUM_PATTERN.test(value);
}

function titleCaseAscii(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1).toLowerCase()}`;
}

export function normalizeLanguageTag(
  value: unknown,
  options: LanguageTagFieldOptions = {},
): string {
  const field = options.field ?? "language";
  if (typeof value !== "string") {
    throw new LanguageTagError({
      field,
      code: "invalid_type",
      message: `${field} must be a string language tag`,
      inputValue: value,
    });
  }

  const raw = value;
  const normalizedInput = raw.trim().replaceAll("_", "-");
  if (
    normalizedInput.length === 0 ||
    normalizedInput.length > 64 ||
    normalizedInput.includes("--")
  ) {
    throw createInvalidFormatError(field, raw);
  }

  const lowered = normalizedInput.toLowerCase();
  if (GRANDFATHERED_LANGUAGE_TAGS.has(lowered)) {
    return lowered;
  }

  const parts = normalizedInput.split("-");
  if (parts[0]?.toLowerCase() === "x") {
    if (
      parts.length < 2 ||
      parts
        .slice(1)
        .some((part) => part.length < 1 || part.length > 8 || !isAlnum(part))
    ) {
      throw createInvalidFormatError(field, raw);
    }
    return parts.map((part) => part.toLowerCase()).join("-");
  }

  const language = parts[0];
  if (
    language === undefined ||
    !isAlpha(language) ||
    language.length < 2 ||
    language.length > 8
  ) {
    throw createInvalidFormatError(field, raw);
  }

  const canonical: string[] = [language.toLowerCase()];
  let index = 1;

  if (language.length <= 3) {
    let extlangCount = 0;
    while (index < parts.length && extlangCount < 3) {
      const part = parts[index];
      if (part === undefined || part.length !== 3 || !isAlpha(part)) {
        break;
      }
      canonical.push(part.toLowerCase());
      index += 1;
      extlangCount += 1;
    }
  }

  const possibleScript = parts[index];
  if (
    possibleScript !== undefined &&
    possibleScript.length === 4 &&
    isAlpha(possibleScript)
  ) {
    canonical.push(titleCaseAscii(possibleScript));
    index += 1;
  }

  const possibleRegion = parts[index];
  if (
    possibleRegion !== undefined &&
    ((possibleRegion.length === 2 && isAlpha(possibleRegion)) ||
      (possibleRegion.length === 3 && DIGIT_PATTERN.test(possibleRegion)))
  ) {
    canonical.push(
      isAlpha(possibleRegion) ? possibleRegion.toUpperCase() : possibleRegion,
    );
    index += 1;
  }

  const variants = new Set<string>();
  while (index < parts.length) {
    const part = parts[index];
    if (part === undefined) {
      break;
    }
    const isVariant =
      (part.length >= 5 && part.length <= 8 && isAlnum(part)) ||
      (part.length === 4 && DIGIT_PATTERN.test(part[0] ?? "") && isAlnum(part));
    if (!isVariant) {
      break;
    }
    const variant = part.toLowerCase();
    if (variants.has(variant)) {
      throw createInvalidFormatError(field, raw);
    }
    variants.add(variant);
    canonical.push(variant);
    index += 1;
  }

  const extensionSingletons = new Set<string>();
  while (index < parts.length) {
    const part = parts[index];
    if (
      part === undefined ||
      part.length !== 1 ||
      part.toLowerCase() === "x" ||
      !isAlnum(part)
    ) {
      break;
    }
    const singleton = part.toLowerCase();
    if (extensionSingletons.has(singleton)) {
      throw createInvalidFormatError(field, raw);
    }
    extensionSingletons.add(singleton);
    canonical.push(singleton);
    index += 1;

    const extensionStart = index;
    while (index < parts.length) {
      const extensionPart = parts[index];
      if (
        extensionPart === undefined ||
        extensionPart.length < 2 ||
        extensionPart.length > 8 ||
        !isAlnum(extensionPart)
      ) {
        break;
      }
      canonical.push(extensionPart.toLowerCase());
      index += 1;
    }
    if (index === extensionStart) {
      throw createInvalidFormatError(field, raw);
    }
  }

  const possiblePrivateUse = parts[index];
  if (possiblePrivateUse?.toLowerCase() === "x") {
    canonical.push("x");
    index += 1;
    const privateStart = index;
    while (index < parts.length) {
      const privatePart = parts[index];
      if (
        privatePart === undefined ||
        privatePart.length < 1 ||
        privatePart.length > 8 ||
        !isAlnum(privatePart)
      ) {
        break;
      }
      canonical.push(privatePart.toLowerCase());
      index += 1;
    }
    if (index === privateStart) {
      throw createInvalidFormatError(field, raw);
    }
  }

  if (index !== parts.length) {
    throw createInvalidFormatError(field, raw);
  }
  return canonical.join("-");
}

export function normalizeLanguageTags(
  values: Iterable<unknown>,
  options: LanguageTagFieldOptions = {},
): string[] {
  const field = options.field ?? "languages";
  const normalized: string[] = [];
  const seen = new Set<string>();
  let index = 0;
  for (const value of values) {
    const tag = normalizeLanguageTag(value, { field: `${field}[${index}]` });
    if (!seen.has(tag)) {
      normalized.push(tag);
      seen.add(tag);
    }
    index += 1;
  }
  return normalized;
}

export function normalizeOptionalLanguageTag(
  value: unknown,
  options: RequiredLanguageTagFieldOptions,
): string | null {
  if (value === null) {
    return null;
  }
  return normalizeLanguageTag(value, options);
}

export function validateLanguagePair(
  sourceLanguage: unknown,
  targetLanguage: unknown,
): [string, string] {
  const source = normalizeLanguageTag(sourceLanguage, {
    field: "source_language",
  });
  const target = normalizeLanguageTag(targetLanguage, {
    field: "target_language",
  });
  if (source === target) {
    throw new LanguageTagError({
      field: "target_language",
      code: "same_as_source",
      message: "target_language must differ from source_language",
      inputValue: targetLanguage,
    });
  }
  return [source, target];
}

export function normalizeProjectLanguages(
  sourceLanguage: unknown,
  targetLanguages: Iterable<unknown>,
): [string, string[]] {
  const source = normalizeLanguageTag(sourceLanguage, {
    field: "source_language",
  });
  const targets = normalizeLanguageTags(targetLanguages, {
    field: "target_languages",
  });
  if (targets.length === 0) {
    throw new LanguageTagError({
      field: "target_languages",
      code: "empty",
      message: "target_languages must include at least one language",
      inputValue: [],
    });
  }
  if (targets.includes(source)) {
    throw new LanguageTagError({
      field: "target_languages",
      code: "contains_source_language",
      message: "target_languages must not contain source_language",
      inputValue: targets,
    });
  }
  return [source, targets];
}
