import { createPrivateKey, createPublicKey, verify } from "node:crypto";

import {
  buildProtocolSignatureFrame,
  createDigest,
} from "@trans-hub/client-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STORED_SIGNING_KEY_CORRUPTED_MESSAGE,
  createSigner,
  createSigningKey,
} from "../src/installation-signing";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Node Ed25519 installation signing", () => {
  it("exports a raw public key and importable PKCS#8 private key", () => {
    const key = createSigningKey();
    const publicKey = Buffer.from(key.publicKeyBase64Url, "base64url");
    const privateKey = createPrivateKey({
      key: Buffer.from(key.privateKeyPkcs8Base64, "base64"),
      format: "der",
      type: "pkcs8",
    });

    expect(publicKey).toHaveLength(32);
    expect(key.publicKeyBase64Url).toHaveLength(43);
    expect(privateKey.asymmetricKeyType).toBe("ed25519");
  });

  it("signs the exact protocol frame with a 64-byte Ed25519 signature", async () => {
    const key = createSigningKey();
    const signer = createSigner(key);
    const input = {
      requestDigest: createDigest("request", "a".repeat(64)),
      challenge: "challenge-value",
      nonce: "nonce-value",
      credentialEpoch: 7,
    };
    const signed = await signer.signProof(input);
    const frame = buildProtocolSignatureFrame("public_contribution_intake", {
      domain: "public_contribution_intake",
      algorithm: "ed25519",
      keyId: key.keyId,
      ...input,
      signedAt: signed.signedAt,
    });
    const signature = Buffer.from(signed.signature, "base64url");
    const publicKey = createPublicKey({
      key: Buffer.concat([
        ED25519_SPKI_PREFIX,
        Buffer.from(key.publicKeyBase64Url, "base64url"),
      ]),
      format: "der",
      type: "spki",
    });

    expect(signature).toHaveLength(64);
    expect(signed.signature).toHaveLength(86);
    expect(verify(null, frame, publicKey, signature)).toBe(true);
  });

  it("does not depend on WebCrypto Ed25519 generate, import, or sign", async () => {
    const unsupported = new DOMException("Unrecognized name", "NotSupportedError");
    vi.spyOn(crypto.subtle, "generateKey").mockRejectedValue(unsupported);
    vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(unsupported);
    vi.spyOn(crypto.subtle, "sign").mockRejectedValue(unsupported);

    const key = createSigningKey();
    const signed = await createSigner(key).signProof({
      requestDigest: createDigest("request", "b".repeat(64)),
      challenge: "challenge-value",
      nonce: "nonce-value",
      credentialEpoch: 1,
    });

    expect(key.publicKeyBase64Url).toHaveLength(43);
    expect(signed.signature).toHaveLength(86);
  });

  it("fails closed for damaged PKCS#8 material", () => {
    const key = createSigningKey();
    expect(() => createSigner({
      ...key,
      privateKeyPkcs8Base64: Buffer.from("damaged").toString("base64"),
    })).toThrow(STORED_SIGNING_KEY_CORRUPTED_MESSAGE);
  });

  it("fails closed when the stored public key does not match the private key", () => {
    const key = createSigningKey();
    const otherKey = createSigningKey();

    expect(() => createSigner({
      ...key,
      publicKeyBase64Url: otherKey.publicKeyBase64Url,
    })).toThrow(STORED_SIGNING_KEY_CORRUPTED_MESSAGE);
  });
});
