import { describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "@trans-hub/client-protocol";

import { ActivationStore } from "../src/activation";
import { OBSIDIAN_AUTH_CALLBACK_ACTION } from "../src/product-config";

const INSTALLATION_SECRET_ID = "trans-hub-obsidian-public-installation-v1";
const SIGNING_KEY_SECRET_ID = "trans-hub-obsidian-public-installation-key-v1";

describe("ActivationStore browser enrollment", () => {
  it("rotates the device signing key for every explicit browser connection", async () => {
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
