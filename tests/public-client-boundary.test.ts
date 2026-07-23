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

  it("pins the exact public observation adapter descriptor", async () => {
    const artifact = await readFile(`${ROOT}/adapter/obsidian-plugin-ui-v13.json`);
    expect(createHash("sha256").update(artifact).digest("hex"))
      .toBe(OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex);
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
