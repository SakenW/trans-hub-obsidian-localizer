import type { App, PluginManifest, Vault } from "obsidian";
import { normalizePath } from "obsidian";

export interface InstalledObsidianPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly dir: string;
  readonly enabled: boolean;
}

export async function discoverInstalledPlugins(
  app: App,
  ownPluginId: string,
): Promise<InstalledObsidianPlugin[]> {
  const { vault } = app;
  const pluginsDir = normalizePath(`${vault.configDir}/plugins`);
  const enabled = runtimeEnabledPluginIds(app) ?? await readEnabledPluginIds(vault);
  if (!(await vault.adapter.exists(pluginsDir))) return [];
  const listed = await vault.adapter.list(pluginsDir);
  const plugins = await Promise.all(listed.folders.map(async (dir) => {
    const manifestPath = normalizePath(`${dir}/manifest.json`);
    if (!(await vault.adapter.exists(manifestPath))) return null;
    try {
      const manifest = parsePluginManifest(JSON.parse(await vault.adapter.read(manifestPath)) as unknown);
      if (manifest.id === ownPluginId) return null;
      return {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        dir,
        enabled: enabled.has(manifest.id),
      } satisfies InstalledObsidianPlugin;
    } catch {
      return null;
    }
  }));
  return plugins
    .filter((plugin): plugin is InstalledObsidianPlugin => plugin !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

interface RuntimePluginManager {
  readonly enabledPlugins?: unknown;
  readonly plugins?: unknown;
}

function runtimeEnabledPluginIds(app: App): ReadonlySet<string> | null {
  const manager = Reflect.get(app, "plugins") as unknown;
  if (!isRecord(manager)) return null;
  const ids = new Set<string>();
  const enabledPlugins = (manager as RuntimePluginManager).enabledPlugins;
  if (enabledPlugins instanceof Set) {
    for (const value of enabledPlugins) {
      if (typeof value === "string") ids.add(value);
    }
  } else if (Array.isArray(enabledPlugins)) {
    for (const value of enabledPlugins) {
      if (typeof value === "string") ids.add(value);
    }
  }
  const loadedPlugins = (manager as RuntimePluginManager).plugins;
  if (isRecord(loadedPlugins)) {
    for (const pluginId of Object.keys(loadedPlugins)) ids.add(pluginId);
  }
  return ids.size === 0 ? null : ids;
}

export async function readPluginBundle(
  vault: Vault,
  plugin: InstalledObsidianPlugin,
): Promise<string> {
  const path = normalizePath(`${plugin.dir}/main.js`);
  if (!(await vault.adapter.exists(path))) throw new Error(`插件缺少 main.js：${plugin.id}`);
  return vault.adapter.read(path);
}

async function readEnabledPluginIds(vault: Vault): Promise<ReadonlySet<string>> {
  const path = normalizePath(`${vault.configDir}/community-plugins.json`);
  if (!(await vault.adapter.exists(path))) return new Set();
  try {
    const value = JSON.parse(await vault.adapter.read(path)) as unknown;
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function parsePluginManifest(value: unknown): Pick<PluginManifest, "id" | "name" | "version" | "description"> {
  if (!isRecord(value)) throw new Error("manifest_invalid");
  return {
    id: requiredString(value.id),
    name: requiredString(value.name),
    version: requiredString(value.version),
    description: typeof value.description === "string" ? value.description : "",
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error("manifest_field_invalid");
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
