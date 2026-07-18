import { describe, expect, it } from "vitest";

import { ActivationStore } from "../src/activation";
import { OBSIDIAN_AUTH_CALLBACK_ACTION } from "../src/product-config";

const INSTALLATION_SECRET_ID = "trans-hub-obsidian-public-installation-v1";

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
