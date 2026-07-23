import { Readable } from "node:stream";
import { constants, createZstdDecompress } from "node:zlib";

import { canonicalJson } from "./canonical-json";
import type {
  PackVerificationPort,
  Sha256Digest,
  TranslationPackRef,
} from "./contracts";

const DEFAULT_MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_WINDOW_LOG = 23;

export type NodeZstdPackVerifierOptions = Readonly<{
  maxUncompressedBytes?: number;
  maxWindowLog?: number;
}>;

export class NodeZstdPackVerifier implements PackVerificationPort {
  readonly #maxUncompressedBytes: number;
  readonly #maxWindowLog: number;

  constructor(options: NodeZstdPackVerifierOptions = {}) {
    this.#maxUncompressedBytes = positiveInteger(
      options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES,
      "translation_pack_uncompressed_limit_invalid",
    );
    this.#maxWindowLog = positiveInteger(
      options.maxWindowLog ?? DEFAULT_MAX_WINDOW_LOG,
      "translation_pack_window_limit_invalid",
    );
  }

  async verify(
    input: Readonly<{ bytes: Uint8Array; pack: TranslationPackRef }>,
  ): Promise<Uint8Array> {
    if (input.bytes.byteLength !== input.pack.compressedBytes) {
      throw packError("translation_pack_size_mismatch", input.pack);
    }
    if ((await sha256(input.bytes)) !== input.pack.transportDigest) {
      throw packError("translation_pack_transport_digest_mismatch", input.pack);
    }
    const canonicalBytes = await this.#decompress(input.bytes, input.pack);
    if (canonicalBytes.byteLength !== input.pack.uncompressedBytes) {
      throw packError(
        "translation_pack_uncompressed_size_mismatch",
        input.pack,
      );
    }
    if ((await sha256(canonicalBytes)) !== input.pack.canonicalPayloadDigest) {
      throw packError("translation_pack_canonical_digest_mismatch", input.pack);
    }
    assertCanonicalJson(canonicalBytes, input.pack);
    return canonicalBytes;
  }

  async #decompress(
    transportBytes: Uint8Array,
    pack: TranslationPackRef,
  ): Promise<Uint8Array> {
    const decompressor = createZstdDecompress({
      params: { [constants.ZSTD_d_windowLogMax]: this.#maxWindowLog },
    });
    const chunks: Uint8Array[] = [];
    let outputBytes = 0;
    try {
      for await (const chunk of Readable.from([transportBytes]).pipe(
        decompressor,
      )) {
        if (!(chunk instanceof Uint8Array))
          throw new TypeError("translation_pack_zstd_chunk_invalid");
        const bytes = new Uint8Array(
          chunk.buffer,
          chunk.byteOffset,
          chunk.byteLength,
        );
        outputBytes += bytes.byteLength;
        if (outputBytes > this.#maxUncompressedBytes) {
          decompressor.destroy();
          throw packError("translation_pack_uncompressed_limit_exceeded", pack);
        }
        chunks.push(bytes);
      }
    } catch (error) {
      if (isPackVerificationError(error)) throw error;
      throw packError("translation_pack_zstd_invalid", pack);
    }
    const output = new Uint8Array(outputBytes);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}

function assertCanonicalJson(
  bytes: Uint8Array,
  pack: TranslationPackRef,
): void {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
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

async function sha256(bytes: Uint8Array): Promise<Sha256Digest> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", buffer),
  );
  const hex = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
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

function packError(code: string, pack: TranslationPackRef): Error {
  return new Error(`${code}:${pack.packId}`);
}

function isPackVerificationError(error: unknown): error is Error {
  return (
    error instanceof Error && error.message.startsWith("translation_pack_")
  );
}
