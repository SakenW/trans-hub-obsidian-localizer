import { createPublicKey, verify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProtocolSignatureFrame, createDigest } from "@trans-hub/client-protocol";

import { createEd25519Runtime } from "../src/ed25519-runtime";
import { nativeEd25519Backend } from "../src/ed25519-native";
import { loadWasmEd25519 } from "../src/ed25519-wasm";
import { createInstallationSigningProvider, createSigningKey, STORED_SIGNING_KEY_CORRUPTED_MESSAGE } from "../src/installation-signing";

const proofInput = {
  requestDigest: createDigest("request", "a".repeat(64)),
  challenge: "challenge", nonce: "nonce", credentialEpoch: 7,
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("native-first Ed25519 runtime", () => {
  it("shares concurrent selection and never loads WASM on native hosts", async () => {
    const load = vi.fn(loadWasmEd25519);
    const runtime = createEd25519Runtime(load);
    const backends = await Promise.all([runtime.backend(), runtime.backend(), runtime.backend()]);
    expect(backends.every((backend) => backend === nativeEd25519Backend)).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it.each(["generateKey", "exportKey", "importKey", "sign", "verify"] as const)(
    "uses WASM only when disposable native probe reports unsupported %s",
    async (operation) => {
      const load = vi.fn(loadWasmEd25519);
      vi.spyOn(crypto.subtle, operation).mockRejectedValue(new DOMException("Unavailable", "NotSupportedError"));
      const runtime = createEd25519Runtime(load);
      const backends = await Promise.all([runtime.backend(), runtime.backend()]);
      expect(backends[0].kind).toBe("wasm");
      expect(backends[0]).toBe(backends[1]);
      expect(load).toHaveBeenCalledTimes(1);
      const provider = createInstallationSigningProvider(runtime);
      const key = await provider.createSigningKey();
      const signer = await provider.createSigner(key);
      const signed = await signer.signProof(proofInput);
      const frame = buildProtocolSignatureFrame("public_contribution_intake", {
        domain: "public_contribution_intake", algorithm: "ed25519", keyId: key.keyId,
        ...proofInput, signedAt: signed.signedAt,
      });
      const pub = createPublicKey({ key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(key.publicKeyBase64Url, "base64url"),
      ]), format: "der", type: "spki" });
      expect(verify(null, frame, pub, Buffer.from(signed.signature, "base64url"))).toBe(true);
    },
  );

  it.each(["generateKey", "exportKey", "importKey", "sign", "verify"] as const)(
    "does not downgrade on native %s operation failures",
    async (operation) => {
      for (const name of ["OperationError", "DataError", "SecurityError", "ReferenceError"]) {
        const cause = new DOMException("Injected failure", name);
        const load = vi.fn(loadWasmEd25519);
        const spy = vi.spyOn(crypto.subtle, operation).mockRejectedValue(cause);
        await expect(createEd25519Runtime(load).backend()).rejects.toBe(cause);
        expect(load).not.toHaveBeenCalled();
        spy.mockRestore();
      }
    },
  );

  it("rejects native false verification without downgrading", async () => {
    const load = vi.fn(loadWasmEd25519);
    vi.spyOn(crypto.subtle, "verify").mockResolvedValue(false);
    await expect(createEd25519Runtime(load).backend()).rejects.toThrow("probe signature mismatch");
    expect(load).not.toHaveBeenCalled();
  });

  it("does not downgrade when SHA-256 is unsupported", async () => {
    const load = vi.fn(loadWasmEd25519);
    const cause = new DOMException("SHA-256 unavailable", "NotSupportedError");
    vi.spyOn(crypto.subtle, "digest").mockRejectedValue(cause);
    await expect(createEd25519Runtime(load).backend()).rejects.toBe(cause);
    expect(load).not.toHaveBeenCalled();
  });

  it.each([undefined, { subtle: crypto.subtle }])("requires the baseline crypto and secure RNG (%j)", async (value) => {
    const load = vi.fn(loadWasmEd25519);
    vi.stubGlobal("crypto", value);
    await expect(createEd25519Runtime(load).backend()).rejects.toThrow("安全随机数或 SHA-256 不可用");
    expect(load).not.toHaveBeenCalled();
  });

  it("propagates WASM initialization failure and only retries after another call", async () => {
    vi.spyOn(crypto.subtle, "generateKey").mockRejectedValue(new DOMException("Unavailable", "NotSupportedError"));
    const cause = new Error("WASM initialization failed");
    const load = vi.fn().mockRejectedValue(cause);
    const runtime = createEd25519Runtime(load);
    await expect(runtime.backend()).rejects.toBe(cause);
    expect(load).toHaveBeenCalledTimes(1);
    await expect(runtime.backend()).rejects.toBe(cause);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps the selected native backend on later user-key errors, including NotSupportedError", async () => {
    const record = await createSigningKey();
    const load = vi.fn(loadWasmEd25519);
    const runtime = createEd25519Runtime(load);
    await runtime.backend();
    const provider = createInstallationSigningProvider(runtime);
    for (const name of ["DataError", "OperationError", "NotSupportedError"]) {
      const spy = vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(new DOMException("Bad user key", name));
      await expect(provider.createSigner(record)).rejects.toThrow();
      expect(load).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it("preserves native identity across WASM import; corruption and mismatched pairs never reset the key", async () => {
    const record = await createSigningKey();
    const other = await createSigningKey();
    vi.spyOn(crypto.subtle, "generateKey").mockRejectedValue(new DOMException("Unavailable", "NotSupportedError"));
    const provider = createInstallationSigningProvider(createEd25519Runtime());
    const original = JSON.stringify(record);
    await expect(provider.createSigner(record)).resolves.toMatchObject({ keyId: record.keyId, publicKey: record.publicKeyBase64Url });
    expect(JSON.stringify(record)).toBe(original);
    await expect(provider.createSigner({ ...record, publicKeyBase64Url: other.publicKeyBase64Url }))
      .rejects.toThrow(STORED_SIGNING_KEY_CORRUPTED_MESSAGE);
    await expect(provider.createSigner({ ...record, privateKeyPkcs8Base64: "%%%" }))
      .rejects.toThrow(STORED_SIGNING_KEY_CORRUPTED_MESSAGE);
    const der = Buffer.from(record.privateKeyPkcs8Base64, "base64");
    for (const corrupted of [der.subarray(0, 47), Buffer.concat([der, Buffer.from([0])])]) {
      await expect(provider.createSigner({ ...record, privateKeyPkcs8Base64: corrupted.toString("base64") }))
        .rejects.toThrow(STORED_SIGNING_KEY_CORRUPTED_MESSAGE);
    }
    expect(JSON.stringify(record)).toBe(original);
  });
});
