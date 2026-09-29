import { type App, Platform } from "obsidian";
import { afterEach, describe, expect, it } from "vitest";
import { PluginAutomationController } from "../src/plugin-automation";
import { EMPTY_PLUGIN_STATE } from "../src/plugin-state";
import { scanPluginUiStrings } from "../src/plugin-string-scanner";
import type { PluginPatchApproval } from "../src/plugin-compatibility";

async function fixture() {
  const dir = ".obsidian/plugins/demo";
  const original = 'setting.setName("Settings");';
  const plugin = { id: "demo", name: "Demo", version: "1.0.0", description: "", dir, enabled: true };
  const catalog = await scanPluginUiStrings({ plugin, bundle: original, sourceLocale: "en" });
  const state = structuredClone(EMPTY_PLUGIN_STATE);
  Object.assign(state.pluginCatalogs, { demo: catalog });
  Object.assign(state.pluginTranslations, { demo: { "zh-CN": { pluginId: "demo", pluginVersion: "1.0.0", sourceVersionId: "source", targetLocale: "zh-CN", pulledAt: "now", catalogIdentity: catalog.catalogIdentity, artifactDigest: catalog.artifactDigest,
    entries: [{ pluginId: "demo", source: "Settings", target: "设置", scopes: ["runtime-ui"] }] } } });
  const files = new Map([[`${dir}/manifest.json`, JSON.stringify(plugin)], [`${dir}/main.js`, original]]);
  const adapter = {
    exists: (path: string) => Promise.resolve(path === ".obsidian/plugins" || files.has(path)),
    list: () => Promise.resolve({ files: [], folders: [dir] }),
    read: (path: string) => Promise.resolve(files.get(path) ?? ""),
    write: (path: string, content: string) => { files.set(path, content); return Promise.resolve(); },
    mkdir: () => Promise.resolve(),
    remove: (path: string) => { files.delete(path); return Promise.resolve(); },
    rename: (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); return Promise.resolve(); },
  };
  const settings = { targetLocale: "zh-CN", pluginTranslationEnabled: true, pluginMetadataTranslationEnabled: true, thirdPartyFilePatchingEnabled: true, excludedPluginIds: [] as string[] };
  const controller = new PluginAutomationController({ app: { vault: { configDir: ".obsidian", adapter }, plugins: { enabledPlugins: new Set(["demo"]) } } as unknown as App,
    ownPluginId: "localizer", settings: () => settings, state: () => state, replaceState: () => {}, save: async () => {}, synchronize: () => Promise.reject(new Error("network not allowed")) });
  const approval = async (): Promise<PluginPatchApproval> => {
    const result = await controller.checkThirdPartyFilePatch("demo");
    expect(result.kind).toBe("checked");
    if (result.kind !== "checked" || result.approval === undefined) throw new Error(JSON.stringify(result));
    return result.approval;
  };
  return { controller, files, original, dir, settings, state, approval };
}

afterEach(() => { Platform.isDesktopApp = true; });
describe("per-plugin compatibility approval", () => {
  it("does not write during preview or with the legacy global opt-in; consumes confirmed approval once", async () => {
    const f = await fixture();
    expect((await f.controller.applyThirdPartyFilePatches(["demo"])).applied).toBe(0);
    const approval = await f.approval();
    expect(f.files.size).toBe(2);
    expect(f.files.get(`${f.dir}/main.js`)).toBe(f.original);
    expect((await f.controller.applyThirdPartyFilePatches(["demo"], { ...approval })).applied).toBe(0);
    expect((await f.controller.applyThirdPartyFilePatches(["demo"], approval)).applied).toBe(1);
    expect(f.files.get(`${f.dir}/main.js`)).toContain("设置");
    expect((await f.controller.applyThirdPartyFilePatches(["demo"], approval)).applied).toBe(0);
    expect((await f.controller.restoreThirdPartyFilePatches(["demo"])).restored).toBe(1);
    expect(f.files.get(`${f.dir}/main.js`)).toBe(f.original);
  });

  it.each(["language", "version", "translation", "selection", "disabled", "mobile", "bytes"])("rejects changed %s after confirmation without overwriting files", async (change) => {
    const f = await fixture(); const approval = await f.approval();
    if (change === "language") f.settings.targetLocale = "ja";
    if (change === "version") f.files.set(`${f.dir}/manifest.json`, JSON.stringify({ id: "demo", name: "Demo", version: "2.0.0", description: "" }));
    if (change === "translation") Object.assign(f.state.pluginTranslations.demo, { "zh-CN": { ...f.state.pluginTranslations.demo["zh-CN"], entries: [] } });
    if (change === "selection") f.settings.excludedPluginIds = ["demo"];
    if (change === "disabled") f.settings.pluginTranslationEnabled = false;
    if (change === "mobile") Platform.isDesktopApp = false;
    if (change === "bytes") f.files.set(`${f.dir}/main.js`, f.original + "// externally changed");
    const before = new Map(f.files);
    expect((await f.controller.applyThirdPartyFilePatches(["demo"], approval)).applied).toBe(0);
    expect(f.files).toEqual(before);
  });
});
