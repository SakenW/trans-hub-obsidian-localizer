import type { Uida } from "@trans-hub/uida";

import { createDigest, DIGEST_DOMAINS, type DigestDomain, type ProtocolDigest } from "./digest.js";
import { protocolError } from "./errors.js";
import {
  CLIENT_PROTOCOL_ID,
  CLIENT_PROTOCOL_REVISION,
  CLIENT_SCHEMA_REVISION,
  type ProtocolVersion,
} from "./version.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;
const UIDA_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const TIMESTAMP_PATTERN =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{3})?Z$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type UnknownRecord = Record<string, unknown>;

export function exactObject(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = []
): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    protocolError("CP_INVALID_TYPE", path, "expected an object");
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    protocolError("CP_INVALID_TYPE", path, "expected a plain protocol object");
  }
  const record = value as UnknownRecord;
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.some((key) => typeof key !== "string")) {
    protocolError("CP_UNKNOWN_FIELD", path, "symbol fields are forbidden");
  }
  const descriptors = Object.getOwnPropertyDescriptors(record);
  for (const key of ownKeys as string[]) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
      protocolError(
        "CP_INVALID_TYPE",
        `${path}.${key}`,
        "protocol fields must be enumerable data properties"
      );
    }
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      protocolError("CP_UNKNOWN_FIELD", `${path}.${key}`, `unknown field ${JSON.stringify(key)}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      protocolError(
        "CP_MISSING_FIELD",
        `${path}.${key}`,
        `missing required field ${JSON.stringify(key)}`
      );
    }
  }
  return record;
}

export function expectString(
  value: unknown,
  path: string,
  options: { readonly min?: number; readonly max?: number } = {}
): string {
  if (typeof value !== "string") {
    protocolError("CP_INVALID_TYPE", path, "expected a string");
  }
  const minimum = options.min ?? 1;
  const maximum = options.max ?? 4096;
  if (value.length < minimum || value.length > maximum) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      `string length must be between ${minimum} and ${maximum}`
    );
  }
  return value;
}

export function expectIdentifier(value: unknown, path: string): string {
  const result = expectString(value, path, { max: 256 });
  if (!IDENTIFIER_PATTERN.test(result)) {
    protocolError("CP_INVALID_VALUE", path, "invalid protocol identifier");
  }
  return result;
}

export function expectUuid(value: unknown, path: string): string {
  const result = expectString(value, path, { min: 36, max: 36 });
  if (!UUID_PATTERN.test(result)) {
    protocolError("CP_INVALID_VALUE", path, "expected a canonical UUID");
  }
  return result;
}

export function expectInteger(
  value: unknown,
  path: string,
  options: { readonly minimum?: number; readonly maximum?: number } = {}
): number {
  if (!Number.isSafeInteger(value)) {
    protocolError("CP_INVALID_TYPE", path, "expected a safe integer");
  }
  const result = value as number;
  if (result < (options.minimum ?? 0) || result > (options.maximum ?? Number.MAX_SAFE_INTEGER)) {
    protocolError("CP_INVALID_VALUE", path, "integer is outside the allowed range");
  }
  return result;
}

export function expectEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    protocolError("CP_INVALID_VALUE", path, `expected one of: ${values.join(", ")}`);
  }
  return value;
}

export function expectLiteral<const Value extends string | number>(
  value: unknown,
  expected: Value,
  path: string
): Value {
  if (value !== expected) {
    protocolError("CP_INVALID_VALUE", path, `expected ${JSON.stringify(expected)}`);
  }
  return expected;
}

export function expectArray<T>(
  value: unknown,
  path: string,
  parser: (item: unknown, path: string) => T,
  options: { readonly minimum?: number; readonly maximum?: number } = {}
): readonly T[] {
  if (!Array.isArray(value)) {
    protocolError("CP_INVALID_TYPE", path, "expected an array");
  }
  const minimum = options.minimum ?? 0;
  const maximum = options.maximum ?? 1024;
  if (value.length < minimum || value.length > maximum) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      `array length must be between ${minimum} and ${maximum}`
    );
  }
  return value.map((item, index) => parser(item, `${path}[${index}]`));
}

export function expectTimestamp(value: unknown, path: string): string {
  const timestamp = expectString(value, path, { max: 24 });
  const parsed = Date.parse(timestamp);
  const canonical = Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
  const comparable = timestamp.length === 20 ? timestamp.replace("Z", ".000Z") : timestamp;
  if (!TIMESTAMP_PATTERN.test(timestamp) || canonical !== comparable) {
    protocolError(
      "CP_INVALID_TIMESTAMP",
      path,
      "timestamp must be a valid UTC RFC 3339 instant with second or millisecond precision"
    );
  }
  return timestamp;
}

export function expectNonce(value: unknown, path: string): string {
  const nonce = expectString(value, path, { min: 22, max: 128 });
  if (!BASE64URL_PATTERN.test(nonce)) {
    protocolError("CP_INVALID_NONCE", path, "nonce must use unpadded base64url");
  }
  return nonce;
}

export function expectSignature(value: unknown, path: string): string {
  const signature = expectString(value, path, { min: 32, max: 8192 });
  if (!BASE64URL_PATTERN.test(signature)) {
    protocolError("CP_INVALID_VALUE", path, "signature must use unpadded base64url");
  }
  return signature;
}

export function expectEd25519Signature(value: unknown, path: string): string {
  const signature = expectString(value, path, { min: 86, max: 86 });
  if (!BASE64URL_PATTERN.test(signature)) {
    protocolError("CP_INVALID_VALUE", path, "Ed25519 signature must use unpadded base64url");
  }
  return signature;
}

export function expectHttpsUrl(
  value: unknown,
  path: string,
  options: { readonly allowQuery?: boolean } = {}
): string {
  const text = expectString(value, path, { max: 2048 });
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    protocolError("CP_UNSAFE_LOCATOR", path, "locator must be an absolute URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    (!options.allowQuery && url.search !== "") ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    /^\[.*\]$/u.test(url.hostname) ||
    /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u.test(url.hostname)
  ) {
    protocolError(
      "CP_UNSAFE_LOCATOR",
      path,
      "locator must be credential-free HTTPS without fragments or mutable query state"
    );
  }
  return url.href;
}

export function expectImmutableHttpsUrl(value: unknown, path: string): string {
  const locator = expectHttpsUrl(value, path, { allowQuery: true });
  const url = new URL(locator);
  const mutableTokens = [...url.pathname.split("/"), ...Array.from(url.searchParams.values())];
  if (mutableTokens.some((token) => /^(?:latest|current|head|main|master)$/iu.test(token))) {
    protocolError(
      "CP_UNSAFE_LOCATOR",
      path,
      "source-proof locator must not contain a mutable branch or latest alias"
    );
  }
  return locator;
}

export function expectMediaType(value: unknown, path: string): string {
  const mediaType = expectString(value, path, { max: 127 }).toLowerCase();
  if (!MEDIA_TYPE_PATTERN.test(mediaType)) {
    protocolError("CP_INVALID_VALUE", path, "invalid media type");
  }
  return mediaType;
}

export function expectUida(value: unknown, path: string): Uida {
  const text = expectString(value, path, { min: 43, max: 43 });
  if (!UIDA_PATTERN.test(text)) {
    protocolError("CP_INVALID_VALUE", path, "invalid UIDA encoding");
  }
  return text as Uida;
}

export function parseProtocolVersion(value: unknown, path = "$.protocol"): ProtocolVersion {
  const record = exactObject(value, path, ["protocol", "revision", "schemaRevision"]);
  expectLiteral(record.protocol, CLIENT_PROTOCOL_ID, `${path}.protocol`);
  const revision = expectInteger(record.revision, `${path}.revision`, {
    minimum: 1,
  });
  if (revision !== CLIENT_PROTOCOL_REVISION) {
    protocolError(
      "CP_UNSUPPORTED_PROTOCOL_REVISION",
      `${path}.revision`,
      `unsupported protocol revision ${revision}`
    );
  }
  const schemaRevision = expectInteger(record.schemaRevision, `${path}.schemaRevision`, {
    minimum: 1,
  });
  if (schemaRevision !== CLIENT_SCHEMA_REVISION) {
    protocolError(
      "CP_UNSUPPORTED_SCHEMA_REVISION",
      `${path}.schemaRevision`,
      `unsupported schema revision ${schemaRevision}`
    );
  }
  return {
    protocol: CLIENT_PROTOCOL_ID,
    revision: CLIENT_PROTOCOL_REVISION,
    schemaRevision: CLIENT_SCHEMA_REVISION,
  };
}

export function parseDigest<Domain extends DigestDomain>(
  value: unknown,
  expectedDomain: Domain,
  path: string
): ProtocolDigest<Domain> {
  const record = exactObject(value, path, ["algorithm", "domain", "hex"]);
  expectLiteral(record.algorithm, "sha256", `${path}.algorithm`);
  const domain = expectEnum(record.domain, DIGEST_DOMAINS, `${path}.domain`);
  if (domain !== expectedDomain) {
    protocolError(
      "CP_DIGEST_DOMAIN_MISMATCH",
      `${path}.domain`,
      `expected digest domain ${expectedDomain}, received ${domain}`
    );
  }
  const hex = expectString(record.hex, `${path}.hex`, { min: 64, max: 64 });
  try {
    return createDigest(expectedDomain, hex);
  } catch {
    protocolError("CP_INVALID_DIGEST", path, "invalid SHA-256 protocol digest");
  }
}
