import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OBSIDIAN_PUBLIC_PROFILE } from "../src/submission";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("Obsidian public client boundary", () => {
  it("does not alias or import Private Secure Client Core", async () => {
    const files = ["tsconfig.json", "esbuild.config.mjs", "vitest.config.ts"];
    const source = await Promise.all(files.map((file) => readFile(`${ROOT}/${file}`, "utf8")));
    expect(source.join("\n")).not.toContain("secure-client-core");
  });

  it("keeps Connector Host and retired source-submission code out of the public plugin bundle", async () => {
    const sources = await Promise.all([
      readFile(`${ROOT}/package.json`, "utf8"),
      readFile(`${ROOT}/tsconfig.json`, "utf8"),
      readFile(`${ROOT}/vitest.config.ts`, "utf8"),
    ]);
    expect(sources.join("\n")).not.toContain("connector-host-client");
    expect(sources.join("\n")).not.toContain("source-submission-client");
  });

  it("pins the audited public translation-export root for clean production builds", async () => {
    const source = await readFile(`${ROOT}/esbuild.config.mjs`, "utf8");
    expect(source).not.toContain("obsidian-store-build-verification-placeholder");
    const pinsPublicRoot = source.includes('keyId: "client-transfer-root-1"')
      && source.includes('publicKeyBase64Url: "jaDlCqNcXw6UBT8A2oXvfF0pyz1j94Yrdqyr1YDgCh4"');
    expect(pinsPublicRoot).toBe(true);
    expect(source).toContain('resolveTrustRoot("TRANS_HUB_TRANSFER_ROOT", DEFAULT_TRANSFER_ROOT)');
    expect(source).toContain('if (values.some((value) => value === ""))');
  });

  it("keeps executor artifacts out of the public plugin export", async () => {
    const source = await readFile(`${ROOT}/package.json`, "utf8");
    expect(source).not.toContain("adapter/");
    expect(OBSIDIAN_PUBLIC_PROFILE.adapterVersion).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("persists only installation-scoped credentials and renewal recovery state", async () => {
    const source = await readFile(`${ROOT}/src/activation.ts`, "utf8");
    expect(source).toContain("secretStorage.setSecret");
    expect(source).toContain("trans-hub-obsidian-public-installation-v1");
    expect(source).toContain("trans-hub-obsidian-public-renewal-v1");
    expect(source).toContain("priorSessionId");
    expect(source).not.toMatch(/refresh[_A-Z]?token/iu);
    expect(source).not.toMatch(/password/iu);
  });
});
