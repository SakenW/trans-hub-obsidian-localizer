import type { Ed25519VerificationPort } from "@trans-hub/translation-export-client/web";
import { arrayBuffer, nativeEd25519Backend, type Ed25519Backend } from "./ed25519-native";
import { loadWasmEd25519 } from "./ed25519-wasm";

export interface Ed25519Runtime extends Ed25519VerificationPort {
  backend(): Promise<Ed25519Backend>;
}

/** Probe only disposable keys. User data errors must never select another backend. */
export function createEd25519Runtime(
  loadWasm: () => Promise<Ed25519Backend> = loadWasmEd25519,
): Ed25519Runtime {
  let selected: Promise<Ed25519Backend> | undefined;
  async function select(): Promise<Ed25519Backend> {
    if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function" || !crypto.subtle?.digest) {
      throw new Error("安全随机数或 SHA-256 不可用，无法安全连接语枢。");
    }
    // Baseline failures, including NotSupportedError for SHA-256, never enable WASM.
    const probe = crypto.getRandomValues(new Uint8Array(32));
    await crypto.subtle.digest("SHA-256", arrayBuffer(probe));
    try {
      const pair = await nativeEd25519Backend.generateKey();
      if (pair.publicKey.length !== 32) throw new Error("Ed25519 capability probe returned an invalid key");
      try {
        const signer = await nativeEd25519Backend.importPrivateKey(pair.privateKeyPkcs8);
        const signature = await signer.sign(probe);
        if (signature.length !== 64 || !await nativeEd25519Backend.verify(pair.publicKey, signature, probe)) {
          throw new Error("Ed25519 capability probe signature mismatch");
        }
        return nativeEd25519Backend;
      } finally {
        pair.privateKeyPkcs8.fill(0);
      }
    } catch (error) {
      if (typeof error !== "object" || error === null || !("name" in error) || error.name !== "NotSupportedError") throw error;
    }
    // This loader is outside the native probe catch. Its failures cannot recurse or retry via another implementation.
    return loadWasm();
  }
  function backend(): Promise<Ed25519Backend> {
    selected ??= select().catch((error: unknown) => {
      selected = undefined; // A later call may retry native; no error-triggered fallback.
      throw error;
    });
    return selected;
  }
  return {
    backend,
    async verify(publicKey, signature, message) {
      return (await backend()).verify(publicKey, signature, message);
    },
  };
}

export const ed25519Runtime = createEd25519Runtime();
