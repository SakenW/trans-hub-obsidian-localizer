import {
  CURRENT_PROTOCOL_VERSION,
  buildProtocolSignatureFrame,
  computeProtocolDigest,
  parseBootstrapLinkBinding,
  parseBootstrapResponse,
  parsePublicCredentialRenewalResponse,
  type BootstrapLinkBinding,
  type BootstrapResponse,
} from "@trans-hub/client-protocol";
import {
  PublicClient,
  type ClockPort,
  type DigestPort,
  type Ed25519InstallationSignerPort,
  type InstallationRecord,
  type InstallationStoragePort,
  type RandomNoncePort,
} from "@trans-hub/public-client";
import type { App } from "obsidian";

import { ObsidianHttpTransport } from "./http-transport";
import { base64ToBytes, bytesToBase64, sha256Hex } from "./identity";
import { OBSIDIAN_CLIENT_VERSION } from "./product-config";

const INSTALLATION_SECRET_ID = "trans-hub-obsidian-public-installation-v1";
const SIGNING_KEY_SECRET_ID = "trans-hub-obsidian-public-installation-key-v1";
const PENDING_AUTHORIZATION_SECRET_ID = "trans-hub-obsidian-public-authorization-v1";
const PENDING_RENEWAL_SECRET_ID = "trans-hub-obsidian-public-renewal-v1";
const PREPARE_ONLY_TRANSPORT_ORIGIN = "https://bootstrap.invalid";

interface StoredSigningKey {
  readonly version: 1;
  readonly keyId: string;
  readonly publicKeyBase64Url: string;
  readonly privateKeyPkcs8Base64: string;
}

interface PendingAuthorization {
  readonly version: 1;
  readonly state: string;
  readonly prepared: BootstrapLinkBinding;
  readonly createdAtEpochMs: number;
}

interface PendingCredentialRenewal {
  readonly version: 1;
  readonly installationId: string;
  readonly priorSessionId: string;
  readonly priorCredentialEpoch: number;
  readonly idempotencyKey: string;
  readonly tokenPrefix: string;
  readonly secret: string;
  readonly nonce: string;
}

interface StoredInstallation {
  readonly authorityWorkspaceId: string;
  readonly bootstrap: BootstrapResponse;
}

export class ActivationStore {
  constructor(private readonly app: App) {}

  async client(input: {
    readonly apiBaseUrl: string;
  }): Promise<{ readonly client: PublicClient; readonly bootstrap: BootstrapResponse; readonly authorityWorkspaceId: string }> {
    const signer = await this.signer();
    const stored = readStoredInstallation(this.app);
    if (stored === null) throw new Error("请先连接语枢。");
    const storage = this.storage(stored.authorityWorkspaceId);
    const client = new PublicClient({
      transport: new ObsidianHttpTransport(input.apiBaseUrl),
      signer,
      digest: webCryptoDigest(),
      clock: systemClock(),
      random: systemRandom(),
      installationStorage: storage,
    });
    const existing = await storage.load();
    const reusable = reusableInstallation(existing, signer);
    if (reusable !== null) {
      return { client, bootstrap: reusable, authorityWorkspaceId: stored.authorityWorkspaceId };
    }
    if (existing === null || Date.parse(stored.bootstrap.challengeExpiresAt) <= Date.now()) {
      throw new Error("此设备的语枢授权已过期，请重新连接。");
    }
    const bootstrap = await this.renewCredential({
      apiBaseUrl: input.apiBaseUrl,
      storage,
      signer,
      bootstrap: stored.bootstrap,
    });
    return { client, bootstrap, authorityWorkspaceId: stored.authorityWorkspaceId };
  }

  async beginBrowserAuthorization(input: {
    readonly webBaseUrl: string;
    readonly ecosystemSlug: string;
    readonly callbackAction: string;
  }): Promise<string> {
    // Browser authorization is an explicit device re-enrollment. Reusing one
    // signing key for another installation is correctly contained as cloning.
    const freshKey = await createSigningKey();
    this.app.secretStorage.setSecret(SIGNING_KEY_SECRET_ID, JSON.stringify(freshKey));
    this.app.secretStorage.setSecret(INSTALLATION_SECRET_ID, "");
    this.app.secretStorage.setSecret(PENDING_RENEWAL_SECRET_ID, "");
    const signer = await this.signer();
    const client = new PublicClient({
      transport: new ObsidianHttpTransport(PREPARE_ONLY_TRANSPORT_ORIGIN),
      signer,
      digest: webCryptoDigest(),
      clock: systemClock(),
      random: systemRandom(),
      installationStorage: this.storage("pending"),
    });
    const prepared = client.prepareBootstrap({
      client: { type: "public_plugin", version: OBSIDIAN_CLIENT_VERSION, platform: "obsidian-desktop" },
      requestedCapabilities: ["contribution:submit", "contribution:read_receipt", "translation:read"],
    });
    const pending: PendingAuthorization = {
      version: 1,
      state: randomHex(32),
      prepared,
      createdAtEpochMs: Date.now(),
    };
    this.app.secretStorage.setSecret(PENDING_AUTHORIZATION_SECRET_ID, JSON.stringify(pending));
    const url = new URL(`${input.webBaseUrl}/connect/client`);
    url.searchParams.set("ecosystem", input.ecosystemSlug);
    url.searchParams.set("callback", `obsidian://${input.callbackAction}`);
    url.searchParams.set("state", pending.state);
    url.searchParams.set("binding", bytesToBase64Url(new TextEncoder().encode(JSON.stringify(prepared))));
    return url.toString();
  }

  async completeBrowserAuthorization(input: {
    readonly apiBaseUrl: string;
    readonly state: string;
    readonly authorityWorkspaceId: string;
    readonly linkingCode: string;
    readonly bindingDigest: string;
  }): Promise<BootstrapResponse> {
    const pending = parsePendingAuthorization(
      this.app.secretStorage.getSecret(PENDING_AUTHORIZATION_SECRET_ID),
    );
    if (pending === null || pending.state !== input.state || Date.now() - pending.createdAtEpochMs > 10 * 60_000) {
      throw new Error("连接请求已过期，请重新点击连接。");
    }
    const expectedDigest = await computeProtocolDigest("request", pending.prepared, webCryptoDigest());
    if (input.bindingDigest !== expectedDigest.hex) {
      throw new Error("浏览器授权与本机安装身份不匹配。");
    }
    const signer = await this.signer();
    const storage = this.storage(input.authorityWorkspaceId);
    const client = new PublicClient({
      transport: new ObsidianHttpTransport(input.apiBaseUrl),
      signer,
      digest: webCryptoDigest(),
      clock: systemClock(),
      random: systemRandom(),
      installationStorage: storage,
    });
    const bootstrap = await client.bootstrap({
      linkingCode: input.linkingCode,
      prepared: pending.prepared,
    });
    this.app.secretStorage.setSecret(PENDING_AUTHORIZATION_SECRET_ID, "");
    return bootstrap;
  }

  isConfigured(): boolean {
    const stored = readStoredInstallation(this.app);
    return stored !== null &&
      stored.bootstrap.intakeCredential.capabilities.includes("translation:read") &&
      Date.parse(stored.bootstrap.challengeExpiresAt) > Date.now();
  }

  clear(): void {
    this.app.secretStorage.setSecret(INSTALLATION_SECRET_ID, "");
    this.app.secretStorage.setSecret(SIGNING_KEY_SECRET_ID, "");
    this.app.secretStorage.setSecret(PENDING_AUTHORIZATION_SECRET_ID, "");
    this.app.secretStorage.setSecret(PENDING_RENEWAL_SECRET_ID, "");
  }

  private storage(authorityWorkspaceId: string): SecretInstallationStorage {
    return new SecretInstallationStorage(this.app, authorityWorkspaceId);
  }

  private async signer(): Promise<Ed25519InstallationSignerPort> {
    const stored = parseSigningKey(this.app.secretStorage.getSecret(SIGNING_KEY_SECRET_ID));
    const key = stored ?? await createSigningKey();
    if (stored === null) {
      this.app.secretStorage.setSecret(SIGNING_KEY_SECRET_ID, JSON.stringify(key));
    }
    let privateKey: CryptoKey | null = null;
    return {
      keyId: key.keyId,
      publicKey: key.publicKeyBase64Url,
      async signProof(input) {
        privateKey ??= await crypto.subtle.importKey(
          "pkcs8",
          arrayBuffer(base64ToBytes(key.privateKeyPkcs8Base64)),
          { name: "Ed25519" },
          false,
          ["sign"],
        );
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
        const signature = await crypto.subtle.sign(
          { name: "Ed25519" },
          privateKey,
          arrayBuffer(frame),
        );
        return { signedAt, signature: bytesToBase64Url(new Uint8Array(signature)) };
      },
    };
  }

  private async renewCredential(input: {
    readonly apiBaseUrl: string;
    readonly storage: SecretInstallationStorage;
    readonly signer: Ed25519InstallationSignerPort;
    readonly bootstrap: BootstrapResponse;
  }): Promise<BootstrapResponse> {
    const storedPending = parsePendingCredentialRenewal(
      this.app.secretStorage.getSecret(PENDING_RENEWAL_SECRET_ID),
    );
    const pending = storedPending !== null &&
      storedPending.installationId === input.bootstrap.installationId &&
      storedPending.priorSessionId === input.bootstrap.intakeCredential.sessionId &&
      storedPending.priorCredentialEpoch === input.bootstrap.intakeCredential.credentialEpoch
      ? storedPending
      : createPendingCredentialRenewal(input.bootstrap);
    if (pending !== storedPending) {
      this.app.secretStorage.setSecret(PENDING_RENEWAL_SECRET_ID, JSON.stringify(pending));
    }
    const unsigned = {
      kind: "public_credential_renewal_request" as const,
      protocol: CURRENT_PROTOCOL_VERSION,
      installationId: input.bootstrap.installationId,
      idempotencyKey: pending.idempotencyKey,
      newIntakeCredential: { tokenPrefix: pending.tokenPrefix, secret: pending.secret },
    };
    const requestDigest = await computeProtocolDigest("request", unsigned, webCryptoDigest());
    const signed = await input.signer.signProof({
      requestDigest,
      challenge: input.bootstrap.serverChallenge,
      nonce: pending.nonce,
      credentialEpoch: input.bootstrap.intakeCredential.credentialEpoch,
    });
    const response = await new ObsidianHttpTransport(input.apiBaseUrl).send<unknown>({
      method: "POST",
      path: "/v1/public-client/credentials/renew",
      headers: { Authorization: `Bearer ${input.bootstrap.intakeCredential.value}` },
      body: {
        ...unsigned,
        installationProof: {
          domain: "public_contribution_intake",
          algorithm: "ed25519",
          keyId: input.signer.keyId,
          requestDigest,
          challenge: input.bootstrap.serverChallenge,
          nonce: pending.nonce,
          signedAt: signed.signedAt,
          credentialEpoch: input.bootstrap.intakeCredential.credentialEpoch,
          signature: signed.signature,
        },
      },
    });
    if (response.status !== 200) throw new Error(`设备授权续期失败：HTTP ${response.status}`);
    const renewal = parsePublicCredentialRenewalResponse(response.body);
    if (renewal.installationId !== input.bootstrap.installationId ||
      renewal.intakeCredential.value !== `${pending.tokenPrefix}.${pending.secret}`) {
      throw new Error("设备授权续期凭据不匹配。");
    }
    const bootstrap = parseBootstrapResponse({
      ...input.bootstrap,
      installationKeyId: renewal.installationKeyId,
      serverChallenge: renewal.serverChallenge,
      challengeExpiresAt: renewal.challengeExpiresAt,
      intakeCredential: renewal.intakeCredential,
    });
    await input.storage.save({ bootstrap });
    this.app.secretStorage.setSecret(PENDING_RENEWAL_SECRET_ID, "");
    return bootstrap;
  }
}

class SecretInstallationStorage implements InstallationStoragePort {
  constructor(
    private readonly app: App,
    private readonly authorityWorkspaceId: string,
  ) {}

  loadSync(): InstallationRecord | null {
    const raw = this.app.secretStorage.getSecret(INSTALLATION_SECRET_ID);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as { readonly authorityWorkspaceId?: unknown; readonly bootstrap?: unknown };
      if (value.authorityWorkspaceId !== this.authorityWorkspaceId) return null;
      return { bootstrap: parseBootstrapResponse(value.bootstrap) };
    } catch {
      return null;
    }
  }

  load(): Promise<InstallationRecord | null> {
    return Promise.resolve(this.loadSync());
  }

  save(record: InstallationRecord): Promise<void> {
    this.app.secretStorage.setSecret(INSTALLATION_SECRET_ID, JSON.stringify({
      authorityWorkspaceId: this.authorityWorkspaceId,
      ...record,
    }));
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.app.secretStorage.setSecret(INSTALLATION_SECRET_ID, "");
    return Promise.resolve();
  }
}

function reusableInstallation(
  record: InstallationRecord | null,
  signer: Ed25519InstallationSignerPort,
): BootstrapResponse | null {
  if (record === null) return null;
  try {
    const bootstrap = parseBootstrapResponse(record.bootstrap);
    const minimumExpiry = Date.now() + 30_000;
    return bootstrap.installationState === "active" &&
      bootstrap.installationKeyId === signer.keyId &&
      Date.parse(bootstrap.challengeExpiresAt) > minimumExpiry &&
      Date.parse(bootstrap.intakeCredential.expiresAt) > minimumExpiry &&
      bootstrap.intakeCredential.capabilities.includes("contribution:submit") &&
      bootstrap.intakeCredential.capabilities.includes("contribution:read_receipt") &&
      bootstrap.intakeCredential.capabilities.includes("translation:read")
      ? bootstrap
      : null;
  } catch {
    return null;
  }
}

function readStoredInstallation(app: App): StoredInstallation | null {
  const raw = app.secretStorage.getSecret(INSTALLATION_SECRET_ID);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { readonly authorityWorkspaceId?: unknown; readonly bootstrap?: unknown };
    return typeof value.authorityWorkspaceId === "string"
      ? { authorityWorkspaceId: value.authorityWorkspaceId, bootstrap: parseBootstrapResponse(value.bootstrap) }
      : null;
  } catch {
    return null;
  }
}

function parsePendingAuthorization(raw: string | null): PendingAuthorization | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingAuthorization>;
    return value.version === 1 && typeof value.state === "string" &&
      typeof value.createdAtEpochMs === "number"
      ? { version: 1, state: value.state, createdAtEpochMs: value.createdAtEpochMs, prepared: parseBootstrapLinkBinding(value.prepared) }
      : null;
  } catch {
    return null;
  }
}

function createPendingCredentialRenewal(bootstrap: BootstrapResponse): PendingCredentialRenewal {
  return {
    version: 1,
    installationId: bootstrap.installationId,
    priorSessionId: bootstrap.intakeCredential.sessionId,
    priorCredentialEpoch: bootstrap.intakeCredential.credentialEpoch,
    idempotencyKey: randomHex(16),
    tokenPrefix: randomHex(12),
    secret: randomHex(32),
    nonce: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32))),
  };
}

function parsePendingCredentialRenewal(raw: string | null): PendingCredentialRenewal | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingCredentialRenewal>;
    return value.version === 1 &&
      typeof value.installationId === "string" &&
      typeof value.priorSessionId === "string" &&
      Number.isInteger(value.priorCredentialEpoch) &&
      typeof value.idempotencyKey === "string" && value.idempotencyKey.length >= 16 &&
      typeof value.tokenPrefix === "string" && /^[0-9a-f]{24}$/u.test(value.tokenPrefix) &&
      typeof value.secret === "string" && /^[0-9a-f]{64}$/u.test(value.secret) &&
      typeof value.nonce === "string" && /^[A-Za-z0-9_-]{22,128}$/u.test(value.nonce)
      ? value as PendingCredentialRenewal
      : null;
  } catch {
    return null;
  }
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function createSigningKey(): Promise<StoredSigningKey> {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  return {
    version: 1,
    keyId: `obsidian-${(await sha256Hex(publicKey)).slice(0, 32)}`,
    publicKeyBase64Url: bytesToBase64Url(publicKey),
    privateKeyPkcs8Base64: bytesToBase64(privateKey),
  };
}

function parseSigningKey(raw: string | null): StoredSigningKey | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredSigningKey>;
    return value.version === 1 &&
      typeof value.keyId === "string" && value.keyId !== "" &&
      typeof value.publicKeyBase64Url === "string" && value.publicKeyBase64Url !== "" &&
      typeof value.privateKeyPkcs8Base64 === "string" && value.privateKeyPkcs8Base64 !== ""
      ? value as StoredSigningKey
      : null;
  } catch {
    return null;
  }
}

function webCryptoDigest(): DigestPort {
  return {
    async digest(bytes) {
      return new Uint8Array(await crypto.subtle.digest("SHA-256", arrayBuffer(bytes)));
    },
  };
}

function systemRandom(): RandomNoncePort {
  return {
    nonce: () => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    unitInterval: () => {
      const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
      return value / 2 ** 32;
    },
  };
}

function systemClock(): ClockPort {
  return {
    now: () => new Date(),
    sleep: (milliseconds, signal) => new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, milliseconds);
      signal?.addEventListener("abort", () => {
        window.clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    }),
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
