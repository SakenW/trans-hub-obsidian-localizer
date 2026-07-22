import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";

import { canonicalJson } from "./canonical-json";
import type {
  TranslationExportManifest,
  TranslationManifestVerificationPort,
} from "./contracts";
import { translationManifestSignedPayload } from "./manifest";

const SIGNED_PAYLOAD_PREFIX = new TextEncoder().encode(
  "trans-hub.client-protocol/v1/signed_payload\u0000",
);
const PROOF_PREFIX = new TextEncoder().encode(
  "trans-hub.client-protocol/v1/signature/translation_export_manifest\u0000",
);
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type TranslationExportTrustRoot = Readonly<{
  keyId: string;
  keyVersion: number;
  publicKeyBase64Url: string;
}>;

export class NodeEd25519ManifestVerifier
  implements TranslationManifestVerificationPort
{
  readonly #roots: ReadonlyMap<string, TranslationExportTrustRoot>;
  readonly #now: () => number;
  readonly #maximumClockSkewMs: number;

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
    manifest: TranslationExportManifest & Readonly<{ revision: 2 }>,
  ): Promise<void> {
    const proof = manifest.serverProof;
    const root = this.#roots.get(rootIdentity(proof.keyId, proof.keyVersion));
    if (root === undefined)
      throw new Error("translation_manifest_untrusted_key");
    const now = this.#now();
    if (
      Date.parse(proof.signedAt) > now + this.#maximumClockSkewMs ||
      Date.parse(proof.expiresAt) <= now - this.#maximumClockSkewMs
    ) {
      throw new Error("translation_manifest_proof_expired_or_future");
    }
    const payloadBytes = encodeCanonical(
      translationManifestSignedPayload(manifest),
    );
    const digest = createHash("sha256")
      .update(SIGNED_PAYLOAD_PREFIX)
      .update(payloadBytes)
      .digest();
    const claimedDigest = Buffer.from(proof.payloadDigest.hex, "hex");
    if (
      claimedDigest.length !== digest.length ||
      !timingSafeEqual(digest, claimedDigest)
    ) {
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
    const frame = Buffer.concat([
      Buffer.from(PROOF_PREFIX),
      Buffer.from(encodeCanonical(unsignedProof)),
    ]);
    const rawPublicKey = Buffer.from(root.publicKeyBase64Url, "base64url");
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
      format: "der",
      type: "spki",
    });
    const signature = Buffer.from(proof.signature, "base64url");
    if (
      signature.length !== 64 ||
      !verifySignature(null, frame, publicKey, signature)
    ) {
      throw new Error("translation_manifest_signature_invalid");
    }
  }
}

function rootIdentity(keyId: string, keyVersion: number): string {
  return `${keyId}\u0000${keyVersion}`;
}

function encodeCanonical(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}
