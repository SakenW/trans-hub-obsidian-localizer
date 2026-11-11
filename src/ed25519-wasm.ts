import type { Ed25519Backend } from "./ed25519-native";

// Exact RFC 8410 private key encoding emitted by our existing WebCrypto client.
const PKCS8_PREFIX = new Uint8Array([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]);

export async function loadWasmEd25519(): Promise<Ed25519Backend> {
  if (typeof WebAssembly !== "object" || typeof WebAssembly.instantiate !== "function") {
    throw new Error("设备不支持 WASM 安全签名兼容组件。");
  }
  try {
    // esbuild bundles this pinned ESM dependency into main.js; no remote code or Node adapter is loaded.
    const { default: sodium } = await import("libsodium-wrappers");
    await sodium.ready;
    const testSeed = sodium.from_hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
    try {
      const testPair = sodium.crypto_sign_seed_keypair(testSeed);
      try {
        const signature = sodium.crypto_sign_detached(new Uint8Array(), testPair.privateKey);
        if (sodium.to_hex(testPair.publicKey) !== "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
          || sodium.to_hex(signature) !== "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
          || !sodium.crypto_sign_verify_detached(signature, new Uint8Array(), testPair.publicKey)) {
          throw new Error("wasm_ed25519_self_test_failed");
        }
      } finally { sodium.memzero(testPair.privateKey); }
    } finally { sodium.memzero(testSeed); }
    return {
      kind: "wasm",
      generateKey() {
        const seed = crypto.getRandomValues(new Uint8Array(32));
        try {
          const pair = sodium.crypto_sign_seed_keypair(seed);
          try {
            const privateKeyPkcs8 = new Uint8Array(48);
            privateKeyPkcs8.set(PKCS8_PREFIX);
            privateKeyPkcs8.set(seed, 16);
            return Promise.resolve({ publicKey: pair.publicKey, privateKeyPkcs8 });
          } finally { sodium.memzero(pair.privateKey); }
        } finally { sodium.memzero(seed); }
      },
      importPrivateKey(pkcs8) {
        if (pkcs8.length !== 48 || !PKCS8_PREFIX.every((byte, index) => pkcs8[index] === byte)) {
          throw new DOMException("Unsupported or damaged installation key encoding", "DataError");
        }
        // Retain only the seed, not sodium's expanded 64-byte private key.
        const seed = pkcs8.slice(16);
        return Promise.resolve({
          sign(message: Uint8Array) {
            const pair = sodium.crypto_sign_seed_keypair(seed);
            try { return Promise.resolve(sodium.crypto_sign_detached(message, pair.privateKey)); }
            finally { sodium.memzero(pair.privateKey); }
          },
        });
      },
      verify(publicKey, signature, message) {
        if (publicKey.length !== 32 || signature.length !== 64) return Promise.resolve(false);
        return Promise.resolve(sodium.crypto_sign_verify_detached(signature, message, publicKey));
      },
    };
  } catch (cause) {
    throw new Error("WASM 安全签名兼容组件初始化失败，请重试并反馈设备与插件版本。", { cause });
  }
}
