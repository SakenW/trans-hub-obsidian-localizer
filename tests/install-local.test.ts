import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { expect, it } from "vitest";

it("builds and installs each exact bundle file without changing data", () => {
  const pluginRoot = resolve(import.meta.dirname, "..");
  const vault = mkdtempSync(resolve(tmpdir(), "transhub-obsidian-install-"));
  const installedRoot = resolve(
    vault,
    ".obsidian",
    "plugins",
    "trans-hub-plugin-localizer",
  );
  mkdirSync(installedRoot, { recursive: true });
  const dataPath = resolve(installedRoot, "data.json");
  const originalData = '{"session":"preserved"}\n';
  writeFileSync(dataPath, originalData, "utf8");

  try {
    execFileSync(
      process.execPath,
      [
        resolve(pluginRoot, "scripts", "install-local.mjs"),
        "--vault", vault,
        "--allow-dirty",
      ],
      { cwd: pluginRoot, stdio: "pipe" },
    );
    const receipt = JSON.parse(
      readFileSync(resolve(installedRoot, "install-receipt.json"), "utf8"),
    ) as {
      schema: string;
      sourceCommit: string;
      sourceDirty: boolean;
      installedFiles: Record<string, string>;
    };

    expect(receipt.schema).toBe("trans-hub.obsidian-local-install-receipt");
    expect(receipt.sourceCommit).toMatch(/^[0-9a-f]{40}$/u);
    expect(typeof receipt.sourceDirty).toBe("boolean");
    for (const file of ["main.js", "manifest.json", "styles.css"]) {
      const digest = createHash("sha256")
        .update(readFileSync(resolve(installedRoot, file)))
        .digest("hex");
      expect(receipt.installedFiles[file]).toBe(digest);
    }
    expect(readFileSync(dataPath, "utf8")).toBe(originalData);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

it("rejects a symlinked intermediate plugins directory", () => {
  const pluginRoot = resolve(import.meta.dirname, "..");
  const vault = mkdtempSync(resolve(tmpdir(), "transhub-obsidian-install-link-"));
  const external = mkdtempSync(resolve(tmpdir(), "transhub-obsidian-external-"));
  mkdirSync(resolve(vault, ".obsidian"), { recursive: true });
  symlinkSync(external, resolve(vault, ".obsidian", "plugins"), "dir");

  try {
    expect(() => execFileSync(
      process.execPath,
      [
        resolve(pluginRoot, "scripts", "install-local.mjs"),
        "--vault", vault,
        "--allow-dirty",
      ],
      { cwd: pluginRoot, stdio: "pipe" },
    )).toThrow();
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
