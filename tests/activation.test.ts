import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "@trans-hub/client-protocol";

import { ActivationStore } from "../src/activation";
import {
  INSTALLATION_SIGNING_UNAVAILABLE_MESSAGE,
  STORED_SIGNING_KEY_CORRUPTED_MESSAGE,
  type InstallationSigningProvider,
} from "../src/installation-signing";
import { OBSIDIAN_AUTH_CALLBACK_ACTION } from "../src/product-config";

const INSTALLATION_SECRET_ID = "trans-hub-obsidian-public-installation-v1";
const SIGNING_KEY_SECRET_ID = "trans-hub-obsidian-public-installation-key-v1";
const PENDING_AUTHORIZATION_SECRET_ID = "trans-hub-obsidian-public-authorization-v1";
const PENDING_RENEWAL_SECRET_ID = "trans-hub-obsidian-public-renewal-v1";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ActivationStore browser enrollment", () => {
  it("rotates the device signing key for every explicit browser connection", async () => {
    const unsupported = new DOMException("Unrecognized name", "NotSupportedError");
    vi.spyOn(crypto.subtle, "generateKey").mockRejectedValue(unsupported);
    vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(unsupported);
    vi.spyOn(crypto.subtle, "sign").mockRejectedValue(unsupported);
    const secrets = new Map<string, string>();
    secrets.set(INSTALLATION_SECRET_ID, JSON.stringify({ stale: true }));
    const app = {
      secretStorage: {
        getSecret: (id: string) => secrets.get(id) ?? null,
        setSecret: (id: string, value: string) => { secrets.set(id, value); },
      },
    };
    const activation = new ActivationStore(app as never);

    const first = await activation.beginBrowserAuthorization({
      webBaseUrl: "http://127.0.0.1:3000",
      ecosystemSlug: "obsidian",
      callbackAction: OBSIDIAN_AUTH_CALLBACK_ACTION,
    });
    const second = await activation.beginBrowserAuthorization({
      webBaseUrl: "http://127.0.0.1:3000",
      ecosystemSlug: "obsidian",
      callbackAction: OBSIDIAN_AUTH_CALLBACK_ACTION,
    });

    expect(new URL(first).searchParams.get("callback"))
      .toBe(`obsidian://${OBSIDIAN_AUTH_CALLBACK_ACTION}`);
    expect(bindingKeyId(first)).not.toBe(bindingKeyId(second));
    expect(secrets.get(INSTALLATION_SECRET_ID)).toBe("");
  });

  it("invalidates expired device authorization while preserving a reconnect action", async () => {
    const secrets = new Map<string, string>();
    const app = {
      secretStorage: {
        getSecret: (id: string) => secrets.get(id) ?? null,
        setSecret: (id: string, value: string) => { secrets.set(id, value); },
      },
    };
    const activation = new ActivationStore(app as never);
    const authorizationUrl = await activation.beginBrowserAuthorization({
      webBaseUrl: "http://127.0.0.1:3000",
      ecosystemSlug: "obsidian",
      callbackAction: OBSIDIAN_AUTH_CALLBACK_ACTION,
    });
    const installationKeyId = bindingKeyId(authorizationUrl);
    const installationId = "11111111-1111-4111-8111-111111111111";
    secrets.set(INSTALLATION_SECRET_ID, JSON.stringify({
      authorityWorkspaceId: "22222222-2222-4222-8222-222222222222",
      bootstrap: {
        kind: "bootstrap_response",
        protocol: CURRENT_PROTOCOL_VERSION,
        installationId,
        installationState: "active",
        trust: "untrusted_client",
        clientNonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        installationKeyId,
        serverChallenge: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        challengeExpiresAt: "2020-01-01T01:00:00.000Z",
        availableCapabilities: ["contribution:submit", "contribution:read_receipt", "translation:read"],
        intakeCredential: {
          audience: "public-contribution-intake",
          plane: "public",
          sessionId: "33333333-3333-4333-8333-333333333333",
          installationId,
          credentialEpoch: 1,
          capabilities: ["contribution:submit", "contribution:read_receipt", "translation:read"],
          issuedAt: "2020-01-01T00:00:00.000Z",
          expiresAt: "2020-01-01T00:30:00.000Z",
          value: "public-intake-token-value-0123456789",
        },
      },
    }));

    await expect(activation.client({ apiBaseUrl: "http://127.0.0.1:8000" }))
      .rejects.toThrow("设备授权已失效，需要重新连接。");
    expect(activation.requiresReconnect()).toBe(true);
    expect(secrets.get(INSTALLATION_SECRET_ID)).toBe("");
    expect(secrets.get(SIGNING_KEY_SECRET_ID)).toBe("");
  });

  it("preserves every old secret when Node key generation fails", async () => {
    const secrets = new Map<string, string>([
      [INSTALLATION_SECRET_ID, "old-installation"],
      [SIGNING_KEY_SECRET_ID, "old-signing-key"],
      [PENDING_AUTHORIZATION_SECRET_ID, "old-authorization"],
      [PENDING_RENEWAL_SECRET_ID, "old-renewal"],
    ]);
    const app = {
      secretStorage: {
        getSecret: (id: string) => secrets.get(id) ?? null,
        setSecret: (id: string, value: string) => { secrets.set(id, value); },
      },
    };
    const unavailableSigning: InstallationSigningProvider = {
      createSigningKey() {
        throw new Error(INSTALLATION_SIGNING_UNAVAILABLE_MESSAGE);
      },
      createSigner() {
        throw new Error("unexpected signer creation");
      },
    };
    const activation = new ActivationStore(app as never, unavailableSigning);

    await expect(activation.beginBrowserAuthorization({
      webBaseUrl: "http://127.0.0.1:3000",
      ecosystemSlug: "obsidian",
      callbackAction: OBSIDIAN_AUTH_CALLBACK_ACTION,
    })).rejects.toThrow(INSTALLATION_SIGNING_UNAVAILABLE_MESSAGE);

    expect(Object.fromEntries(secrets)).toEqual({
      [INSTALLATION_SECRET_ID]: "old-installation",
      [SIGNING_KEY_SECRET_ID]: "old-signing-key",
      [PENDING_AUTHORIZATION_SECRET_ID]: "old-authorization",
      [PENDING_RENEWAL_SECRET_ID]: "old-renewal",
    });
  });

  it("fails closed instead of rotating a malformed stored signing key", async () => {
    const secrets = new Map<string, string>([
      [INSTALLATION_SECRET_ID, "old-installation"],
      [SIGNING_KEY_SECRET_ID, "{\"version\":1,\"privateKeyPkcs8Base64\":\"broken\"}"],
    ]);
    let generated = false;
    const signing: InstallationSigningProvider = {
      createSigningKey() {
        generated = true;
        throw new Error("must not rotate");
      },
      createSigner() {
        throw new Error("must not create signer");
      },
    };
    const app = {
      secretStorage: {
        getSecret: (id: string) => secrets.get(id) ?? null,
        setSecret: (id: string, value: string) => { secrets.set(id, value); },
      },
    };

    await expect(new ActivationStore(app as never, signing).client({
      apiBaseUrl: "http://127.0.0.1:8000",
    })).rejects.toThrow(STORED_SIGNING_KEY_CORRUPTED_MESSAGE);
    expect(generated).toBe(false);
    expect(secrets.get(INSTALLATION_SECRET_ID)).toBe("old-installation");
    expect(secrets.get(SIGNING_KEY_SECRET_ID))
      .toBe("{\"version\":1,\"privateKeyPkcs8Base64\":\"broken\"}");
  });
});

function bindingKeyId(value: string): string {
  const encoded = new URL(value).searchParams.get("binding");
  if (encoded === null) throw new Error("missing browser binding");
  const padded = encoded.replace(/-/gu, "+").replace(/_/gu, "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binding = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
    readonly installationPublicKey: { readonly keyId: string };
  };
  return binding.installationPublicKey.keyId;
}
