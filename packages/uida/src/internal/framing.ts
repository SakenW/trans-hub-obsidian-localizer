import { UidaError } from "../errors.js";

const DOMAIN_SEPARATOR = new TextEncoder().encode("trans-hub-uida\0");
const ALGORITHM_TAG = new TextEncoder().encode("sha256\0");
const UINT32_MAX = 0xffffffff;
const UINT64_MAX = 0xffffffffffffffffn;

export function encodeUint32Be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new UidaError(
      "UIDA_INTERNAL_ERROR",
      "Framing uint32 length is out of range",
    );
  }
  const encoded = new Uint8Array(4);
  new DataView(encoded.buffer).setUint32(0, value, false);
  return encoded;
}

export function encodeUint64Be(value: bigint): Uint8Array {
  if (value < 0n || value > UINT64_MAX) {
    throw new UidaError(
      "UIDA_INTERNAL_ERROR",
      "Framing uint64 length is out of range",
    );
  }
  const encoded = new Uint8Array(8);
  new DataView(encoded.buffer).setBigUint64(0, value, false);
  return encoded;
}

export function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

export function validateNamespace(namespace: string): void {
  const format = /^[a-z0-9](?:[a-z0-9._-]{0,158}[a-z0-9])?$/u;
  if (
    typeof namespace !== "string" ||
    !format.test(namespace) ||
    ["..", ".-", "-.", "._", "_."].some((pattern) =>
      namespace.includes(pattern),
    )
  ) {
    throw new UidaError(
      "UIDA_INVALID_NAMESPACE",
      "Namespace must be a 1-160 character lowercase ASCII slug",
    );
  }
}

export function buildUidaFrame(
  namespace: string,
  canonicalBytes: Uint8Array,
): Uint8Array {
  validateNamespace(namespace);
  const namespaceBytes = new TextEncoder().encode(namespace);
  const namespaceLength = encodeUint32Be(namespaceBytes.byteLength);
  const canonicalLength = encodeUint64Be(BigInt(canonicalBytes.byteLength));
  const frame = new Uint8Array(
    DOMAIN_SEPARATOR.byteLength +
      ALGORITHM_TAG.byteLength +
      namespaceLength.byteLength +
      namespaceBytes.byteLength +
      canonicalLength.byteLength +
      canonicalBytes.byteLength,
  );
  let offset = 0;
  for (const part of [
    DOMAIN_SEPARATOR,
    ALGORITHM_TAG,
    namespaceLength,
    namespaceBytes,
    canonicalLength,
    canonicalBytes,
  ]) {
    frame.set(part, offset);
    offset += part.byteLength;
  }
  return frame;
}
