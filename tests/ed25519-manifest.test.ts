import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, parseTranslationExportManifest } from "@trans-hub/translation-export-client";
import { WebCryptoEd25519ManifestVerifier } from "@trans-hub/translation-export-client/web";
import { createEd25519Runtime } from "../src/ed25519-runtime";
import { loadWasmEd25519 } from "../src/ed25519-wasm";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const pair = generateKeyPairSync("ed25519");
const root = { keyId: "test-root", keyVersion: 1, publicKeyBase64Url: pair.publicKey.export({ format: "jwk" }).x! };

function fixture() {
  const unsigned = {
    schema: "trans-hub.translation-export", revision: 3,
    manifest_id: "manifest-1", generation_id: "generation-1", generation_number: 1,
    source_stream_id: "stream-1", source_version_id: "version-1", target_locale: "zh-CN", target_variant: "default",
    scope: { kind: "public", public_scope_id: "scope-1" }, manifest_digest: `sha256:${"11".repeat(32)}`,
    cdn_origin: "https://cdn.example", packs: [{ pack_id: "pack-1", pack_index: 0, item_count: 1,
      content_size_bytes: 2, object_version: "object-1", content_sha256: `sha256:${"22".repeat(32)}`,
      logical_object_digest: `sha256:${"44".repeat(32)}` }],
  };
  const proof = {
    domain: "translation_export_manifest", algorithm: "ed25519", keyId: root.keyId, keyVersion: root.keyVersion,
    payloadDigest: { algorithm: "sha256", domain: "signed_payload", hex: createHash("sha256").update(
      "trans-hub.client-protocol/v1/signed_payload\0" + canonicalJson(unsigned),
    ).digest("hex") },
    signedAt: "2026-10-18T00:00:00Z", expiresAt: "2026-10-19T00:00:00Z",
  };
  const frame = Buffer.from("trans-hub.client-protocol/v1/signature/translation_export_manifest\0" + canonicalJson(proof));
  return parseTranslationExportManifest({ ...unsigned, server_proof: {
    ...proof, signature: sign(null, frame, pair.privateKey).toString("base64url"),
  } }, 3);
}

afterEach(() => vi.restoreAllMocks());

describe("manifest verification with the plugin native-first runtime", () => {
  it("verifies through WASM after an explicit native capability rejection", async () => {
    vi.spyOn(crypto.subtle, "generateKey").mockRejectedValue(new DOMException("Unavailable", "NotSupportedError"));
    const load = vi.fn(loadWasmEd25519);
    const runtime = createEd25519Runtime(load);
    const verifier = new WebCryptoEd25519ManifestVerifier({ roots: [root], now: () => NOW, ed25519Verifier: runtime });
    await verifier.verify(fixture());
    expect(load).toHaveBeenCalledTimes(1);
    const nativeImport = vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(new Error("Native Ed25519 forbidden"));
    await verifier.verify(fixture());
    expect(nativeImport).not.toHaveBeenCalled();
  });

  it("preserves trust, digest, time and historical checks before selecting any backend", async () => {
    const load = vi.fn(loadWasmEd25519);
    const runtime = createEd25519Runtime(load);
    const select = vi.spyOn(runtime, "verify");
    const verifier = new WebCryptoEd25519ManifestVerifier({ roots: [root], now: () => NOW, ed25519Verifier: runtime });
    const manifest = fixture();
    await expect(verifier.verify({ ...manifest, targetLocale: "de" })).rejects.toThrow("payload_digest_mismatch");
    await expect(verifier.verify({ ...manifest, generationNumber: 2 })).rejects.toThrow("payload_digest_mismatch");
    await expect(verifier.verify({ ...manifest, packs: [{ ...manifest.packs[0], objectVersion: "other" }] }))
      .rejects.toThrow("payload_digest_mismatch");
    await expect(verifier.verify({ ...manifest, serverProof: { ...manifest.serverProof, keyVersion: 2 } }))
      .rejects.toThrow("untrusted_key");
    await expect(verifier.verify({ ...manifest, serverProof: { ...manifest.serverProof, signature: "AA" } }))
      .rejects.toThrow("signature_invalid");
    const expired = new WebCryptoEd25519ManifestVerifier({ roots: [root], now: () => NOW + 172_800_000, ed25519Verifier: runtime });
    await expect(expired.verify(manifest)).rejects.toThrow("expired_or_future");
    expect(select).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    await expired.verifyHistorical(manifest);
    expect(select).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
  });

  it("does not retry invalid native signatures via WASM", async () => {
    const load = vi.fn(loadWasmEd25519);
    const runtime = createEd25519Runtime(load);
    await runtime.backend();
    const verifier = new WebCryptoEd25519ManifestVerifier({ roots: [root], now: () => NOW, ed25519Verifier: runtime });
    const manifest = fixture();
    await expect(verifier.verify({ ...manifest, serverProof: { ...manifest.serverProof, signature: "A".repeat(86) } }))
      .rejects.toThrow("signature_invalid");
    expect(load).not.toHaveBeenCalled();
    const cause = new DOMException("Runtime failure", "OperationError");
    vi.spyOn(crypto.subtle, "verify").mockRejectedValue(cause);
    await expect(verifier.verify(manifest)).rejects.toBe(cause);
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps rejecting forged signatures on the selected WASM backend", async () => {
    vi.spyOn(crypto.subtle, "generateKey").mockRejectedValue(new DOMException("Unavailable", "NotSupportedError"));
    const load = vi.fn(loadWasmEd25519);
    const runtime = createEd25519Runtime(load);
    const verifier = new WebCryptoEd25519ManifestVerifier({ roots: [root], now: () => NOW, ed25519Verifier: runtime });
    const manifest = fixture();
    await verifier.verify(manifest);
    await expect(verifier.verify({ ...manifest, serverProof: { ...manifest.serverProof, signature: "A".repeat(86) } }))
      .rejects.toThrow("signature_invalid");
    expect(load).toHaveBeenCalledTimes(1);
  });
});
