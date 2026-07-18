import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scanPluginUiStrings } from "../src/plugin-string-scanner";
import { OBSIDIAN_PLUGIN_ID } from "../src/product-config";

const vaultRoot = process.env.OBSIDIAN_TEST_VAULT;
const scanAllInstalled = process.env.OBSIDIAN_SCAN_ALL_PLUGINS === "1";
const describeLocal = vaultRoot === undefined ? describe.skip : describe;

describeLocal("local Obsidian vault integration", () => {
  it("scans real enabled plugin bundles without modifying them", async () => {
    const configDir = join(vaultRoot!, ".obsidian");
    const enabled = JSON.parse(await readFile(join(configDir, "community-plugins.json"), "utf8")) as unknown;
    if (!Array.isArray(enabled)) throw new Error("community-plugins.json 格式无效");
    const pluginDirs = await readdir(join(configDir, "plugins"), { withFileTypes: true });
    const enabledIds = new Set(enabled.filter((item): item is string => typeof item === "string"));
    const results: { id: string; count: number }[] = [];
    for (const dir of pluginDirs.filter((item) => item.isDirectory() && (scanAllInstalled || enabledIds.has(item.name)))) {
      const root = join(configDir, "plugins", dir.name);
      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as Record<string, unknown>;
      if (manifest.id === OBSIDIAN_PLUGIN_ID) continue;
      const bundle = await readFile(join(root, "main.js"), "utf8");
      const catalog = await scanPluginUiStrings({
        plugin: {
          id: String(manifest.id),
          name: String(manifest.name),
          version: String(manifest.version),
          description: typeof manifest.description === "string" ? manifest.description : "",
          dir: root,
          enabled: true,
        },
        bundle,
        sourceLocale: "en",
      });
      results.push({ id: catalog.pluginId, count: catalog.strings.length });
    }
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.count > 0)).toBe(true);
  });
});
