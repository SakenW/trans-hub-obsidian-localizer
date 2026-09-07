export type Rfc8785CanonicalizationErrorCode =
  | "non_finite_number"
  | "invalid_unicode_scalar"
  | "non_json_value";

export class Rfc8785CanonicalizationError extends Error {
  constructor(readonly code: Rfc8785CanonicalizationErrorCode) {
    super(code);
    this.name = "Rfc8785CanonicalizationError";
  }
}

/**
 * Canonical JSON matching the RFC 8785 number and UTF-16 key ordering profile
 * used by versioned Source Submission wire contracts.
 */
export function canonicalizeRfc8785Json(value: unknown): string {
  if (value === null || typeof value === "boolean") {
    return value === null ? "null" : value ? "true" : "false";
  }
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return jsonString(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Rfc8785CanonicalizationError("non_finite_number");
    return jsonString(value);
  }
  if (Array.isArray(value)) {
    return `[${Array.from(value, canonicalizeRfc8785Json).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      compareUtf16CodeUnits(left, right),
    );
    return `{${entries
      .map(([key, item]) => {
        assertUnicodeScalarString(key);
        return `${jsonString(key)}:${canonicalizeRfc8785Json(item)}`;
      })
      .join(",")}}`;
  }
  throw new Rfc8785CanonicalizationError("non_json_value");
}

function compareUtf16CodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      throw new Rfc8785CanonicalizationError("invalid_unicode_scalar");
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Rfc8785CanonicalizationError("invalid_unicode_scalar");
    }
  }
}

function jsonString(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Rfc8785CanonicalizationError("non_json_value");
  }
  return serialized;
}
