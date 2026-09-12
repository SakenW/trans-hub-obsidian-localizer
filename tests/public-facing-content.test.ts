import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const pluginRoot = fileURLToPath(new URL("..", import.meta.url));
const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(resolve(tmpdir(), "obsidian-public-copy-"));
  roots.push(root);
  mkdirSync(resolve(root, "scripts"));
  // The check is exercised in the exported repository layout as well as locally.
  let publicRoot = resolve(pluginRoot, "public-repository-template");
  try { readFileSync(resolve(publicRoot, "README.md")); } catch { publicRoot = pluginRoot; }
  for (const file of ["README.md", "CONTRIBUTING.md", "readme", "esbuild.config.mjs"]) {
    cpSync(resolve(publicRoot, file), resolve(root, file), { recursive: true });
  }
  for (const file of ["manifest.json", "package.json", "versions.json", "SECURITY.md", "scripts/verify-public-facing-content.mjs"]) {
    cpSync(resolve(pluginRoot, file), resolve(root, file));
  }
  writeFileSync(resolve(root, "LICENSE"), "Apache-2.0\n");
  return root;
}
function verify(root: string): string {
  return execFileSync(process.execPath, [resolve(root, "scripts/verify-public-facing-content.mjs")], { encoding: "utf8", stdio: "pipe" });
}
function edit(root: string, file: string, change: (content: string) => string): void {
  const path = resolve(root, file);
  writeFileSync(path, change(readFileSync(path, "utf8")));
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("public README integrity", () => {
  it("verifies all ten editions in the standalone export layout", () => {
    expect(verify(fixture())).toContain("10 README languages");
  });
  it("detects Chinese source changes before they can silently leave translations stale", () => {
    const root = fixture();
    edit(root, "readme/README.zh-CN.md", (content) => content + "\n母版功能已变化。\n");
    expect(() => verify(root)).toThrow(/Stale README translation/u);
  });
  it("rejects an untranslated command change", () => {
    const root = fixture();
    edit(root, "readme/README.ja.md", (content) => content.replace("pnpm type-check", "pnpm unknown-command"));
    expect(() => verify(root)).toThrow(/README commands differ/u);
  });
  it("rejects a missing privacy section", () => {
    const root = fixture();
    edit(root, "readme/README.fr.md", (content) => content.replace("<!-- section: privacy -->", ""));
    expect(() => verify(root)).toThrow(/Missing README sections/u);
  });
  it("rejects broken language navigation", () => {
    const root = fixture();
    edit(root, "readme/README.de.md", (content) => content.replace("../README.md", "../missing.md"));
    expect(() => verify(root)).toThrow(/README language link is wrong/u);
  });
  it("scans translated editions for internal information too", () => {
    const root = fixture();
    edit(root, "readme/README.ru.md", (content) => content + "\nDATABASE_URL=redacted\n");
    expect(() => verify(root)).toThrow(/database connection configuration/u);
  });
  it("rejects drift between the minimum supported version and release metadata", () => {
    const root = fixture();
    edit(root, "manifest.json", (content) => content.replace('"1.11.4"', '"99.0.0"'));
    expect(() => verify(root)).toThrow(/Public version metadata is inconsistent/u);
  });
});
