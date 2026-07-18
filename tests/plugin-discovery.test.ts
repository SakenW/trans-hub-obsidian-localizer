import type { App, Vault } from "obsidian";
import { describe, expect, it } from "vitest";

import { discoverInstalledPlugins } from "../src/plugin-discovery";

describe("discoverInstalledPlugins", () => {
  it("uses the vault adapter, marks enabled plugins, and excludes itself", async () => {
    const files = new Map<string, string>([
      [".obsidian/community-plugins.json", JSON.stringify(["enabled-plugin", "self-plugin"])],
      [".obsidian/plugins/enabled-plugin/manifest.json", JSON.stringify({ id: "enabled-plugin", name: "Enabled", version: "1.0.0", description: "Enabled plugin" })],
      [".obsidian/plugins/disabled-plugin/manifest.json", JSON.stringify({ id: "disabled-plugin", name: "Disabled", version: "2.0.0" })],
      [".obsidian/plugins/self-plugin/manifest.json", JSON.stringify({ id: "self-plugin", name: "Self", version: "1.0.0" })],
    ]);
    const vault = {
      configDir: ".obsidian",
      adapter: {
        exists: (path: string) => Promise.resolve(path === ".obsidian/plugins" || files.has(path)),
        list: () => Promise.resolve({
          files: [],
          folders: [
            ".obsidian/plugins/enabled-plugin",
            ".obsidian/plugins/disabled-plugin",
            ".obsidian/plugins/self-plugin",
          ],
        }),
        read: (path: string) => Promise.resolve(files.get(path) ?? ""),
      },
    } as unknown as Vault;

    const app = { vault } as unknown as App;

    expect(await discoverInstalledPlugins(app, "self-plugin")).toEqual([
      {
        id: "disabled-plugin", name: "Disabled", version: "2.0.0", description: "",
        dir: ".obsidian/plugins/disabled-plugin", enabled: false,
      },
      {
        id: "enabled-plugin", name: "Enabled", version: "1.0.0", description: "Enabled plugin",
        dir: ".obsidian/plugins/enabled-plugin", enabled: true,
      },
    ]);
  });

  it("prefers the live plugin manager when takeover plugins leave the persisted list stale", async () => {
    const files = new Map<string, string>([
      [".obsidian/community-plugins.json", JSON.stringify(["manager-plugin"])],
      [".obsidian/plugins/manager-plugin/manifest.json", JSON.stringify({ id: "manager-plugin", name: "Manager", version: "1.0.0" })],
      [".obsidian/plugins/dataview/manifest.json", JSON.stringify({ id: "dataview", name: "Dataview", version: "0.5.68" })],
    ]);
    const vault = {
      configDir: ".obsidian",
      adapter: {
        exists: (path: string) => Promise.resolve(path === ".obsidian/plugins" || files.has(path)),
        list: () => Promise.resolve({
          files: [],
          folders: [
            ".obsidian/plugins/manager-plugin",
            ".obsidian/plugins/dataview",
          ],
        }),
        read: (path: string) => Promise.resolve(files.get(path) ?? ""),
      },
    } as unknown as Vault;
    const app = {
      vault,
      plugins: {
        enabledPlugins: new Set(["manager-plugin", "dataview"]),
        plugins: { "manager-plugin": {}, dataview: {} },
      },
    } as unknown as App;

    expect((await discoverInstalledPlugins(app, "self-plugin")).filter((plugin) => plugin.enabled).map((plugin) => plugin.id)).toEqual([
      "dataview",
      "manager-plugin",
    ]);
  });
});
