import { buildProtocolSignatureFrame } from "@trans-hub/client-protocol";
import type { Ed25519InstallationSignerPort } from "@trans-hub/public-client";

const ED25519_PUBLIC_KEY_BYTES = 32;
const PAIR_CHECK_FRAME = new TextEncoder().encode("trans-hub/obsidian/installation-key-pair/v1");

export const INSTALLATION_SIGNING_UNAVAILABLE_MESSAGE =
  "此设备不支持安全签名，请将 Obsidian 更新到支持 WebCrypto Ed25519 的版本后重试。";
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

/** WebCrypto is available in supported Obsidian desktop and mobile WebViews. */
export const webCryptoInstallationSigningProvider: InstallationSigningProvider = {
  createSigningKey,
  createSigner,
};

export async function createSigningKey(): Promise<StoredSigningKey> {
  try {
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    if (publicKey.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
      throw new Error("Unexpected Ed25519 public key length");
    }
    const digest = await sha256Hex(publicKey);
    return {
      version: 1,
      keyId: `obsidian-${digest.slice(0, 32)}`,
      publicKeyBase64Url: bytesToBase64Url(publicKey),
      privateKeyPkcs8Base64: bytesToBase64(privateKey),
    };
  } catch (error) {
    throw installationSigningUnavailable(error);
  }
}

export async function createSigner(key: StoredSigningKey): Promise<Ed25519InstallationSignerPort> {
  let privateKey: CryptoKey;
  try {
    const publicKeyRaw = base64UrlToBytes(key.publicKeyBase64Url);
    if (publicKeyRaw === undefined || publicKeyRaw.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
      throw new Error("Stored installation public key is invalid");
    }
    privateKey = await crypto.subtle.importKey("pkcs8", arrayBuffer(base64ToBytes(key.privateKeyPkcs8Base64)), "Ed25519", false, ["sign"]);
    const publicKey = await crypto.subtle.importKey("raw", arrayBuffer(publicKeyRaw), "Ed25519", false, ["verify"]);
    const signature = await crypto.subtle.sign("Ed25519", privateKey, arrayBuffer(PAIR_CHECK_FRAME));
    if (!await crypto.subtle.verify("Ed25519", publicKey, signature, arrayBuffer(PAIR_CHECK_FRAME))) {
      throw new Error("Stored installation public key does not match its private key");
    }
  } catch (error) {
    if (webCryptoUnavailable(error)) throw installationSigningUnavailable(error);
    throw storedSigningKeyCorrupted(error);
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
          signature: bytesToBase64Url(new Uint8Array(
            await crypto.subtle.sign("Ed25519", privateKey, arrayBuffer(frame)),
          )),
        };
      } catch (error) {
        throw webCryptoUnavailable(error)
          ? installationSigningUnavailable(error)
          : storedSigningKeyCorrupted(error);
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

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function webCryptoUnavailable(error: unknown): boolean {
  return error instanceof ReferenceError
    || (typeof error === "object" && error !== null && "name" in error
      && (error as { readonly name?: unknown }).name === "NotSupportedError");
}

function installationSigningUnavailable(cause: unknown): Error {
  return new Error(INSTALLATION_SIGNING_UNAVAILABLE_MESSAGE, { cause });
}

function storedSigningKeyCorrupted(cause: unknown): Error {
  return new Error(STORED_SIGNING_KEY_CORRUPTED_MESSAGE, { cause });
}
