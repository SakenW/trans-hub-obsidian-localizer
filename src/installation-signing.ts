import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";

import { buildProtocolSignatureFrame } from "@trans-hub/client-protocol";
import type { Ed25519InstallationSignerPort } from "@trans-hub/public-client";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_SPKI_LENGTH = ED25519_SPKI_PREFIX.length + 32;

export const INSTALLATION_SIGNING_UNAVAILABLE_MESSAGE =
  "设备签名不可用，请更新 Obsidian 桌面安装器，并完全退出 Obsidian 后重新启动。";
export const STORED_SIGNING_KEY_CORRUPTED_MESSAGE =
  "设备签名密钥已损坏，请重新连接语枢。";

export interface StoredSigningKey {
  readonly version: 1;
  readonly keyId: string;
  readonly publicKeyBase64Url: string;
  readonly privateKeyPkcs8Base64: string;
}

export interface InstallationSigningProvider {
  createSigningKey(): StoredSigningKey;
  createSigner(key: StoredSigningKey): Ed25519InstallationSignerPort;
}

export const nodeInstallationSigningProvider: InstallationSigningProvider = {
  createSigningKey,
  createSigner,
};

export function createSigningKey(): StoredSigningKey {
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeySpki = publicKey.export({ format: "der", type: "spki" });
    const publicKeyRaw = extractEd25519RawPublicKey(publicKeySpki);
    const privateKeyPkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
    return {
      version: 1,
      keyId: `obsidian-${createHash("sha256").update(publicKeyRaw).digest("hex").slice(0, 32)}`,
      publicKeyBase64Url: publicKeyRaw.toString("base64url"),
      privateKeyPkcs8Base64: privateKeyPkcs8.toString("base64"),
    };
  } catch (error) {
    throw installationSigningUnavailable(error);
  }
}

export function createSigner(key: StoredSigningKey): Ed25519InstallationSignerPort {
  let privateKey: KeyObject;
  try {
    privateKey = importPrivateKey(key.privateKeyPkcs8Base64);
    const derivedPublicKeySpki = createPublicKey(privateKey).export({
      format: "der",
      type: "spki",
    });
    const derivedPublicKeyRaw = extractEd25519RawPublicKey(derivedPublicKeySpki);
    const storedPublicKeyRaw = Buffer.from(key.publicKeyBase64Url, "base64url");
    if (
      storedPublicKeyRaw.length !== 32 ||
      !timingSafeEqual(derivedPublicKeyRaw, storedPublicKeyRaw)
    ) {
      throw new Error("Stored installation public key does not match its private key");
    }
  } catch (error) {
    throw storedSigningKeyCorrupted(error);
  }
  return {
    keyId: key.keyId,
    publicKey: key.publicKeyBase64Url,
    signProof(input) {
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
        return Promise.resolve({
          signedAt,
          signature: sign(null, frame, privateKey).toString("base64url"),
        });
      } catch (error) {
        return Promise.reject(storedSigningKeyCorrupted(error));
      }
    },
  };
}

function importPrivateKey(privateKeyPkcs8Base64: string): KeyObject {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyPkcs8Base64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Stored installation key is not Ed25519");
  }
  return privateKey;
}

function extractEd25519RawPublicKey(publicKeySpki: Buffer): Buffer {
  if (
    publicKeySpki.length !== ED25519_SPKI_LENGTH ||
    !publicKeySpki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    throw new Error("Invalid RFC 8410 Ed25519 SPKI key");
  }
  return publicKeySpki.subarray(ED25519_SPKI_PREFIX.length);
}

function installationSigningUnavailable(cause: unknown): Error {
  return new Error(INSTALLATION_SIGNING_UNAVAILABLE_MESSAGE, { cause });
}

function storedSigningKeyCorrupted(cause: unknown): Error {
  return new Error(STORED_SIGNING_KEY_CORRUPTED_MESSAGE, { cause });
}
