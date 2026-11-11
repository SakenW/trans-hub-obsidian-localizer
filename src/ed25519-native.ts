export interface Ed25519Signer {
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export interface Ed25519Backend {
  readonly kind: "native" | "wasm";
  generateKey(): Promise<{ readonly publicKey: Uint8Array; readonly privateKeyPkcs8: Uint8Array }>;
  importPrivateKey(pkcs8: Uint8Array): Promise<Ed25519Signer>;
  verify(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean>;
}

export function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export const nativeEd25519Backend: Ed25519Backend = {
  kind: "native",
  async generateKey() {
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    return {
      publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
      privateKeyPkcs8: new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
    };
  },
  async importPrivateKey(pkcs8) {
    const key = await crypto.subtle.importKey("pkcs8", arrayBuffer(pkcs8), "Ed25519", false, ["sign"]);
    return {
      async sign(message) {
        return new Uint8Array(await crypto.subtle.sign("Ed25519", key, arrayBuffer(message)));
      },
    };
  },
  async verify(publicKey, signature, message) {
    const key = await crypto.subtle.importKey("raw", arrayBuffer(publicKey), "Ed25519", false, ["verify"]);
    return crypto.subtle.verify("Ed25519", key, arrayBuffer(signature), arrayBuffer(message));
  },
};
