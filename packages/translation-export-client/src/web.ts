import {
  canonicalJson,
  type CanonicalJsonTranslationExportManifest,
  type CanonicalJsonTranslationPackRef,
  type PackVerificationPort,
  type TranslationManifestVerificationPort,
  translationManifestSignedPayload,
} from "./index";

import {
  buildProtocolDigestFrame,
  buildProtocolSignatureFrameFromCanonicalBytes,
} from "@trans-hub/client-protocol";

export type TranslationExportTrustRoot = Readonly<{
  keyId: string;
  keyVersion: number;
  publicKeyBase64Url: string;
}>;

const ED25519_RAW_KEY_BYTES = 32;

/**
 * Web Crypto port of the translation export manifest verifier. Verifies the
 * canonical JSON revision 3 proof: payload digest frame first, then the
 * Ed25519 signature over the framed unsigned proof. Trust roots are public
 * verification material injected at build time.
 */
export class WebCryptoEd25519ManifestVerifier
  implements TranslationManifestVerificationPort<CanonicalJsonTranslationExportManifest>
{
  readonly #roots: ReadonlyMap<string, TranslationExportTrustRoot>;
  readonly #now: () => number;
  readonly #maximumClockSkewMs: number;
  readonly #keyCache = new Map<string, CryptoKey>();

  constructor(
    input: Readonly<{
      roots: readonly TranslationExportTrustRoot[];
      now?: () => number;
      maximumClockSkewMs?: number;
    }>,
  ) {
    if (input.roots.length < 1 || input.roots.length > 4) {
      throw new TypeError("translation_manifest_trust_bundle_invalid");
    }
    const roots = new Map<string, TranslationExportTrustRoot>();
    for (const root of input.roots) {
      if (
        root.keyId.trim() === "" ||
        !Number.isSafeInteger(root.keyVersion) ||
        root.keyVersion < 1 ||
        !/^[A-Za-z0-9_-]{43}$/u.test(root.publicKeyBase64Url)
      ) {
        throw new TypeError("translation_manifest_trust_root_invalid");
      }
      const identity = rootIdentity(root.keyId, root.keyVersion);
      if (roots.has(identity))
        throw new TypeError("translation_manifest_trust_root_duplicate");
      roots.set(identity, Object.freeze({ ...root }));
    }
    this.#roots = roots;
    this.#now = input.now ?? Date.now;
    this.#maximumClockSkewMs = input.maximumClockSkewMs ?? 60_000;
  }

  async verify(
    manifest: CanonicalJsonTranslationExportManifest,
  ): Promise<void> {
    const proof = manifest.serverProof;
    const now = this.#now();
    if (
      Date.parse(proof.signedAt) > now + this.#maximumClockSkewMs ||
      Date.parse(proof.expiresAt) <= now - this.#maximumClockSkewMs
    ) {
      throw new Error("translation_manifest_proof_expired_or_future");
    }
    await this.verifyAuthenticity(manifest);
  }

  async verifyHistorical(
    manifest: CanonicalJsonTranslationExportManifest,
  ): Promise<void> {
    await this.verifyAuthenticity(manifest);
  }

  private async verifyAuthenticity(
    manifest: CanonicalJsonTranslationExportManifest,
  ): Promise<void> {
    const proof = manifest.serverProof;
    const root = this.#roots.get(rootIdentity(proof.keyId, proof.keyVersion));
    if (root === undefined)
      throw new Error("translation_manifest_untrusted_key");
    const payloadBytes = new TextEncoder().encode(
      canonicalJson(translationManifestSignedPayload(manifest)),
    );
    const digestFrame = buildProtocolDigestFrame("signed_payload", payloadBytes);
    const digest = await crypto.subtle.digest("SHA-256", digestFrame.slice().buffer);
    const claimedDigest = hexToBytes(proof.payloadDigest.hex);
    if (claimedDigest === undefined || claimedDigest.byteLength !== digest.byteLength || !bytesEqual(new Uint8Array(digest), claimedDigest)) {
      throw new Error("translation_manifest_payload_digest_mismatch");
    }
    const unsignedProof = {
      domain: proof.domain,
      algorithm: proof.algorithm,
      keyId: proof.keyId,
      keyVersion: proof.keyVersion,
      payloadDigest: proof.payloadDigest,
      signedAt: proof.signedAt,
      expiresAt: proof.expiresAt,
    };
    const frame = buildProtocolSignatureFrameFromCanonicalBytes(
      "translation_export_manifest",
      new TextEncoder().encode(canonicalJson(unsignedProof)),
    );
    const signature = base64UrlToBytes(proof.signature);
    if (signature === undefined || signature.byteLength !== 64) {
      throw new Error("translation_manifest_signature_invalid");
    }
    const key = await this.importRootKey(root);
    const verified = await crypto.subtle.verify(
      "Ed25519",
      key,
      signature.slice().buffer,
      frame.slice().buffer,
    );
    if (!verified) throw new Error("translation_manifest_signature_invalid");
  }

  private async importRootKey(root: TranslationExportTrustRoot): Promise<CryptoKey> {
    const identity = rootIdentity(root.keyId, root.keyVersion);
    const cached = this.#keyCache.get(identity);
    if (cached !== undefined) return cached;
    const raw = base64UrlToBytes(root.publicKeyBase64Url);
    if (raw === undefined || raw.byteLength !== ED25519_RAW_KEY_BYTES) {
      throw new TypeError("translation_manifest_trust_root_invalid");
    }
    const key = await crypto.subtle.importKey(
      "raw",
      raw.slice().buffer,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    this.#keyCache.set(identity, key);
    return key;
  }
}

/**
 * Verify revision 3 pack objects exactly as the canonical JSON bytes
 * persisted by clients: size bound, exact canonical bytes, digest match.
 */
export class WebCanonicalJsonPackVerifier
  implements PackVerificationPort<CanonicalJsonTranslationPackRef>
{
  readonly #maxContentBytes: number;

  constructor(options: { maxContentBytes?: number } = {}) {
    this.#maxContentBytes = options.maxContentBytes ?? 16 * 1024 * 1024;
  }

  async verify(
    input: Readonly<{ bytes: Uint8Array; pack: CanonicalJsonTranslationPackRef }>,
  ): Promise<Uint8Array> {
    if (input.pack.contentSizeBytes > this.#maxContentBytes) {
      throw packError("translation_pack_content_limit_exceeded", input.pack);
    }
    if (input.bytes.byteLength !== input.pack.contentSizeBytes) {
      throw packError("translation_pack_content_size_mismatch", input.pack);
    }
    const digest = await crypto.subtle.digest("SHA-256", input.bytes.slice().buffer);
    const claimed = prefixedSha256ToBytes(input.pack.contentSha256);
    if (claimed === undefined || !bytesEqual(new Uint8Array(digest), claimed)) {
      throw packError("translation_pack_content_digest_mismatch", input.pack);
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
    } catch {
      throw packError("translation_pack_content_utf8_invalid", input.pack);
    }
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw packError("translation_pack_canonical_payload_invalid", input.pack);
    }
    const expected = new TextEncoder().encode(canonicalJson(value));
    if (!bytesEqual(input.bytes, expected)) {
      throw packError("translation_pack_canonical_bytes_mismatch", input.pack);
    }
    return input.bytes;
  }
}

function packError(code: string, pack: CanonicalJsonTranslationPackRef): Error {
  return new Error(`${code}:${pack.packId}`);
}

function rootIdentity(keyId: string, keyVersion: number): string {
  return `${keyId}\u0000${keyVersion}`;
}

function prefixedSha256ToBytes(value: string): Uint8Array | undefined {
  if (!value.startsWith("sha256:")) return undefined;
  return hexToBytes(value.slice("sha256:".length));
}

function hexToBytes(hex: string): Uint8Array | undefined {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/u.test(hex)) return undefined;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function base64UrlToBytes(value: string): Uint8Array | undefined {
  if (value === "") return undefined;
  if (!/^[A-Za-z0-9_-]+={0,2}$/u.test(value)) return undefined;
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}
