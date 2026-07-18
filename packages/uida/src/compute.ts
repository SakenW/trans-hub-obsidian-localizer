import { canonicalizeUidaIdentity } from "./canonicalization.js";
import { createWebCryptoDigestPort } from "./digest.js";
import { throwIfAborted, UidaError } from "./errors.js";
import { buildUidaFrame, bytesToHex } from "./internal/framing.js";
import type {
  ComputeUidaOptions,
  Uida,
  UidaInput,
  UidaResult,
} from "./types.js";

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeBase64Url(bytes: Uint8Array): Uida {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const chunk = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += BASE64URL_ALPHABET[(chunk >>> 18) & 0x3f];
    encoded += BASE64URL_ALPHABET[(chunk >>> 12) & 0x3f];
    if (second !== undefined)
      encoded += BASE64URL_ALPHABET[(chunk >>> 6) & 0x3f];
    if (third !== undefined) encoded += BASE64URL_ALPHABET[chunk & 0x3f];
  }
  return encoded as Uida;
}

function decodeUida(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return undefined;
  const output = new Uint8Array(32);
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const character of value) {
    const digit = BASE64URL_ALPHABET.indexOf(character);
    if (digit < 0) return undefined;
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (offset < output.length) output[offset] = (buffer >>> bits) & 0xff;
      offset += 1;
      buffer &= (1 << bits) - 1;
    }
  }
  return offset === 32 && bits === 2 && buffer === 0 ? output : undefined;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function computeUida(
  input: UidaInput,
  options: ComputeUidaOptions = {},
): Promise<UidaResult> {
  throwIfAborted(options.signal);
  const canonicalBytes = canonicalizeUidaIdentity(input.identity);
  const frame = buildUidaFrame(input.namespace, canonicalBytes);
  throwIfAborted(options.signal);
  let hashBytes: Uint8Array;
  try {
    hashBytes = await (
      options.digestPort ?? createWebCryptoDigestPort()
    ).digest(frame);
  } catch (error) {
    throwIfAborted(options.signal);
    if (error instanceof UidaError) throw error;
    throw new UidaError(
      "UIDA_DIGEST_FAILED",
      "SHA-256 digest failed",
      undefined,
      {
        cause: error,
      },
    );
  }
  throwIfAborted(options.signal);
  if (hashBytes.byteLength !== 32) {
    throw new UidaError(
      "UIDA_INVALID_DIGEST",
      "DigestPort must return exactly 32 bytes",
    );
  }
  const stableHashBytes = new Uint8Array(hashBytes);
  return {
    uida: encodeBase64Url(stableHashBytes),
    canonicalBytes,
    hashBytes: stableHashBytes,
    hashHex: bytesToHex(stableHashBytes),
  };
}

export async function verifyUida(
  input: UidaInput,
  expected: string,
  options: ComputeUidaOptions = {},
): Promise<boolean> {
  const expectedBytes = decodeUida(expected);
  if (!expectedBytes) return false;
  try {
    const actual = await computeUida(input, options);
    return equalBytes(actual.hashBytes, expectedBytes);
  } catch (error) {
    if (error instanceof UidaError && error.code === "UIDA_ABORTED")
      throw error;
    return false;
  }
}
