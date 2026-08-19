import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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

  it("pins the audited public translation-export root for clean production builds", async () => {
    const source = await readFile(`${ROOT}/esbuild.config.mjs`, "utf8");
    expect(source).not.toContain("obsidian-store-build-verification-placeholder");
    const pinsPublicRoot = source.includes('keyId: "client-transfer-root-1"')
      && source.includes('publicKeyBase64Url: "jaDlCqNcXw6UBT8A2oXvfF0pyz1j94Yrdqyr1YDgCh4"');
    expect(pinsPublicRoot).toBe(true);
    expect(source).toContain('resolveTrustRoot("TRANS_HUB_TRANSFER_ROOT", DEFAULT_TRANSFER_ROOT)');
    expect(source).toContain('if (values.some((value) => value === ""))');
  });

  it("pins the exact public observation adapter descriptor", async () => {
    const [artifact, releaseProfile] = await Promise.all([
      readFile(`${ROOT}/adapter/obsidian-plugin-ui-v20.json`),
      readFile(`${ROOT}/adapter/release-profile.json`, "utf8"),
    ]);
    expect(createHash("sha256").update(artifact).digest("hex"))
      .toBe(OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex);
    const descriptor = JSON.parse(artifact.toString("utf8")) as {
      readonly version?: unknown;
    };
    const release = JSON.parse(releaseProfile) as { readonly semanticVersion?: unknown };
    expect(descriptor.version).toBe(OBSIDIAN_PUBLIC_PROFILE.adapterVersion);
    expect(release.semanticVersion).toBe(OBSIDIAN_PUBLIC_PROFILE.adapterVersion);
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
