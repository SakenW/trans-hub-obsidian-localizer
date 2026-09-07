import { createHash, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "./canonical-json";
import type {
  CanonicalJsonTranslationPackRef,
  PackVerificationPort,
} from "./contracts";

const DEFAULT_MAX_CONTENT_BYTES = 16 * 1024 * 1024;

export type NodeCanonicalJsonPackVerifierOptions = Readonly<{
  maxContentBytes?: number;
}>;

/** Verify revision 3 objects exactly as the canonical JSON bytes persisted by clients. */
export class NodeCanonicalJsonPackVerifier
  implements PackVerificationPort<CanonicalJsonTranslationPackRef>
{
  readonly #maxContentBytes: number;

  constructor(options: NodeCanonicalJsonPackVerifierOptions = {}) {
    this.#maxContentBytes = positiveInteger(
      options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES,
      "translation_pack_content_limit_invalid",
    );
  }

  async verify(
    input: Readonly<{
      bytes: Uint8Array;
      pack: CanonicalJsonTranslationPackRef;
    }>,
  ): Promise<Uint8Array> {
    if (input.pack.contentSizeBytes > this.#maxContentBytes) {
      throw packError("translation_pack_content_limit_exceeded", input.pack);
    }
    if (input.bytes.byteLength !== input.pack.contentSizeBytes) {
      throw packError("translation_pack_content_size_mismatch", input.pack);
    }
    const claimed = digestBytes(input.pack.contentSha256);
    const actual = createHash("sha256").update(input.bytes).digest();
    if (!timingSafeEqual(actual, claimed)) {
      throw packError("translation_pack_content_digest_mismatch", input.pack);
    }
    assertCanonicalJson(input.bytes, input.pack);
    return input.bytes;
  }
}

function assertCanonicalJson(
  bytes: Uint8Array,
  pack: CanonicalJsonTranslationPackRef,
): void {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw packError("translation_pack_canonical_payload_invalid", pack);
  }
  let expected: Uint8Array;
  try {
    expected = new TextEncoder().encode(canonicalJson(value));
  } catch {
    throw packError("translation_pack_canonical_payload_invalid", pack);
  }
  if (!bytesEqual(bytes, expected)) {
    throw packError("translation_pack_canonical_bytes_mismatch", pack);
  }
}

function digestBytes(value: string): Buffer {
  const match = /^sha256:([0-9a-f]{64})$/u.exec(value);
  if (match === null) {
    throw new TypeError("translation_pack_content_digest_invalid");
  }
  return Buffer.from(match[1], "hex");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function positiveInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(code);
  return value;
}

function packError(
  code: string,
  pack: CanonicalJsonTranslationPackRef,
): Error {
  return new Error(`${code}:${pack.packId}`);
}
