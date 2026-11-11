import { buildProtocolSignatureFrame } from "@trans-hub/client-protocol";
import type { Ed25519InstallationSignerPort } from "@trans-hub/public-client";

import { arrayBuffer, nativeEd25519Backend, type Ed25519Backend, type Ed25519Signer } from "./ed25519-native";
import { ed25519Runtime, type Ed25519Runtime } from "./ed25519-runtime";

const ED25519_PUBLIC_KEY_BYTES = 32;
const PAIR_CHECK_FRAME = new TextEncoder().encode("trans-hub/obsidian/installation-key-pair/v1");

export const INSTALLATION_SIGNING_UNAVAILABLE_MESSAGE =
  "当前系统或运行环境不支持 WebCrypto Ed25519 安全签名。仅更新 Obsidian 可能无法解决，请反馈设备型号、系统、Obsidian 和插件版本。";
export const INSTALLATION_SIGNING_FAILED_MESSAGE =
  "设备安全签名操作失败，请重试；若仍失败，请反馈设备型号、系统、Obsidian 和插件版本。";
export const STORED_SIGNING_KEY_CORRUPTED_MESSAGE =
  "设备签名密钥已损坏，请重新连接语枢。";

export interface StoredSigningKey {
  readonly version: 1;
  readonly keyId: string;
  readonly publicKeyBase64Url: string;
  readonly privateKeyPkcs8Base64: string;
}

export interface InstallationSigningProvider {
  createSigningKey(): Promise<StoredSigningKey>;
  createSigner(key: StoredSigningKey): Promise<Ed25519InstallationSignerPort>;
}

/** Native-first selection is shared with translation manifest verification. */
export function createInstallationSigningProvider(runtime: Ed25519Runtime): InstallationSigningProvider {
  async function backend(): Promise<Ed25519Backend> {
    try { return await runtime.backend(); }
    catch (error) { throw signingOperationError(error); }
  }
  return {
    async createSigningKey() { return createSigningKey(await backend()); },
    async createSigner(key) { return createSigner(key, await backend()); },
  };
}

export const installationSigningProvider = createInstallationSigningProvider(ed25519Runtime);

// Native defaults remain available for direct capability tests and cross-implementation checks.
export async function createSigningKey(backend: Ed25519Backend = nativeEd25519Backend): Promise<StoredSigningKey> {
  requireWebCrypto();
  try {
    const pair = await backend.generateKey();
    try {
      const { publicKey, privateKeyPkcs8 } = pair;
      if (publicKey.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
        throw new Error("Unexpected Ed25519 public key length");
      }
      const digest = await sha256Hex(publicKey);
      return {
        version: 1,
        keyId: `obsidian-${digest.slice(0, 32)}`,
        publicKeyBase64Url: bytesToBase64Url(publicKey),
        privateKeyPkcs8Base64: bytesToBase64(privateKeyPkcs8),
      };
    } finally { pair.privateKeyPkcs8.fill(0); }
  } catch (error) {
    throw signingOperationError(error);
  }
}

export async function createSigner(key: StoredSigningKey, backend: Ed25519Backend = nativeEd25519Backend): Promise<Ed25519InstallationSignerPort> {
  requireWebCrypto();
  let publicKeyRaw: Uint8Array;
  let privateKeyRaw: Uint8Array;
  try {
    const decodedPublicKey = base64UrlToBytes(key.publicKeyBase64Url);
    if (decodedPublicKey === undefined || decodedPublicKey.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
      throw new Error("Stored installation public key is invalid");
    }
    publicKeyRaw = decodedPublicKey;
    privateKeyRaw = base64ToBytes(key.privateKeyPkcs8Base64);
  } catch (error) {
    throw storedSigningKeyCorrupted(error);
  }
  let signer: Ed25519Signer;
  try {
    signer = await backend.importPrivateKey(privateKeyRaw);
  } catch (error) {
    if (errorName(error) === "DataError") throw storedSigningKeyCorrupted(error);
    throw signingOperationError(error);
  } finally { privateKeyRaw.fill(0); }
  let matches: boolean;
  try {
    const signature = await signer.sign(PAIR_CHECK_FRAME);
    matches = await backend.verify(publicKeyRaw, signature, PAIR_CHECK_FRAME);
  } catch (error) {
    if (errorName(error) === "DataError") throw storedSigningKeyCorrupted(error);
    throw signingOperationError(error);
  }
  if (!matches) {
    throw storedSigningKeyCorrupted(new Error("Stored installation public key does not match its private key"));
  }
  return {
    keyId: key.keyId,
    publicKey: key.publicKeyBase64Url,
    async signProof(input) {
      try {
        const signedAt = new Date().toISOString();
        const frame = buildProtocolSignatureFrame("public_contribution_intake", {
          domain: "public_contribution_intake",
          algorithm: "ed25519",
          keyId: key.keyId,
          requestDigest: input.requestDigest,
          challenge: input.challenge,
          nonce: input.nonce,
          credentialEpoch: input.credentialEpoch,
          signedAt,
        });
        return {
          signedAt,
          signature: bytesToBase64Url(await signer.sign(frame)),
        };
      } catch (error) {
        throw signingOperationError(error);
      }
    },
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", arrayBuffer(bytes))),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64UrlToBytes(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return undefined;
  return base64ToBytes(value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(44, "="));
}

function requireWebCrypto(): void {
  if (typeof crypto === "undefined" || !crypto?.subtle) {
    throw installationSigningUnavailable(new Error("WebCrypto SubtleCrypto is unavailable"));
  }
}

function errorName(error: unknown): unknown {
  return typeof error === "object" && error !== null && "name" in error ? error.name : undefined;
}

function signingOperationError(cause: unknown): Error {
  return errorName(cause) === "NotSupportedError"
    ? installationSigningUnavailable(cause)
    : new Error(INSTALLATION_SIGNING_FAILED_MESSAGE, { cause });
}

function installationSigningUnavailable(cause: unknown): Error {
  return new Error(INSTALLATION_SIGNING_UNAVAILABLE_MESSAGE, { cause });
}

function storedSigningKeyCorrupted(cause: unknown): Error {
  return new Error(STORED_SIGNING_KEY_CORRUPTED_MESSAGE, { cause });
}
