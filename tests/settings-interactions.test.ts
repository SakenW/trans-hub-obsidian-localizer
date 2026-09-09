import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async () => import("./settings-host-mock"));
import { App, renderedSettings, TestElement, type TestControl } from "./settings-host-mock";
import { TransHubSettingTab } from "../src/settings";
import { EMPTY_PLUGIN_STATE } from "../src/plugin-state";
import type TransHubObsidianPlugin from "../src/main";
import type { InstalledPluginWithSource } from "../src/plugin-picker-source";
import type { PluginSelectionProcessingResult } from "../src/plugin-selection-processing";
import { setClientLocale } from "../src/client-localization";
import type { PluginFileRestoreSummary } from "../src/plugin-automation";

const plugins: InstalledPluginWithSource[] = ["dataview", "tables"].map((id) => ({
  id, name: id === "dataview" ? "Dataview" : "Tables", description: "", dir: id,
  version: "1.0.0", enabled: true, source: { kind: "supported", repository: `example/${id}` },
}));
const emptyRestore: PluginFileRestoreSummary = { restored: 0, conflicts: 0, restoredPluginIds: [], conflictPluginIds: [] };
function fixture() {
  const state = structuredClone(EMPTY_PLUGIN_STATE);
  let restoreResult: PluginFileRestoreSummary | undefined;
  const plugin = {
    manifest: { id: "trans-hub-plugin-localizer" },
    settings: { targetLocale: "zh-CN", pluginTranslationEnabled: true, pluginMetadataTranslationEnabled: true, thirdPartyFilePatchingEnabled: false, excludedPluginIds: ["dataview", "tables"] },
    getPluginState: () => state, hasUserSession: () => true, requiresReconnect: () => false,
    getFileRestoreResult: () => restoreResult,
    savePluginData: vi.fn(async () => {}), refreshPluginTranslationRuntime: vi.fn(async () => {}),
    restoreThirdPartyPluginFiles: vi.fn((_ids?: readonly string[]) => Promise.resolve(emptyRestore)),
    processPluginIds: vi.fn((_ids: readonly string[]) => Promise.resolve({ kind: "login-required", scan: { scannedCount: 2 } })),
    processSelectedPlugins: vi.fn(() => Promise.resolve({ kind: "login-required", scan: { scannedCount: 1 } })),
    retryPluginIds: vi.fn((_ids: readonly string[]) => Promise.resolve({ kind: "login-required", scan: { scannedCount: 1 } })),
    connect: vi.fn(async () => {}),
    openPluginManager: vi.fn(async () => {}),
  };
  const tab = new TransHubSettingTab(new App() as never, plugin as unknown as TransHubObsidianPlugin);
  const internal = tab as unknown as {
    renderPluginPickerContents: (el: HTMLElement, plugins: readonly InstalledPluginWithSource[]) => void;
    renderSettings: (el: HTMLElement) => void;
    refreshSettings: () => void;
    refreshPluginPatchStates: () => Promise<void>;
    refreshObsidianPluginNavigationNames: () => Promise<void>;
    selectionProcessing: Promise<void> | null;
  };
  internal.refreshPluginPatchStates = vi.fn(async () => {});
  internal.refreshObsidianPluginNavigationNames = vi.fn(async () => {});
  internal.refreshSettings = vi.fn();
  const container = new TestElement();
  return { plugin, tab, internal, container, setRestoreResult: (value: PluginFileRestoreSummary) => { restoreResult = value; } };
}
function control(text: string): TestControl {
  const result = renderedSettings.flatMap((setting) => setting.controls).find((item) => item.text === text);
  if (result === undefined) throw new Error(`Control not found: ${text}`);
  return result;
}

beforeEach(() => { renderedSettings.length = 0; setClientLocale("zh-CN"); });
describe("settings user interactions", () => {
  it("全部开启将新增插件一次性送入与逐个开启相同的处理队列", async () => {
    const { plugin, internal, container } = fixture();
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    await control("全部开启").click();
    await internal.selectionProcessing;
    expect(plugin.settings.excludedPluginIds).toEqual([]);
    expect(plugin.processPluginIds).toHaveBeenCalledExactlyOnceWith(["dataview", "tables"]);
  });
  it.each([true, false])("连续开启时较早操作的状态事实不会丢失（stale=%s）", async (stale) => {
    const { plugin, tab, internal, container } = fixture();
    if (!stale) tab.refreshPluginCards({ kind: "stale", failedPluginIds: ["dataview"], failedSources: ["public-discovery"] }, ["dataview"]);
    const resultFor = (pluginId: string, failed: boolean): PluginSelectionProcessingResult => ({
      kind: "synchronized", scan: { scannedCount: 1, discoveredCount: 2, changedCount: 0, stringCount: 1, selectablePluginIds: [pluginId] },
      sync: { submittedCount: 0, requestedCount: 0, pulledCount: 0, waitingCount: 0, translationCount: 0,
        statusReadPluginIds: [pluginId], statusRead: failed
          ? { kind: "stale", failedPluginIds: [pluginId], failedSources: ["public-discovery"] }
          : { kind: "fresh" },
      },
    });
    let release: (value: PluginSelectionProcessingResult) => void = () => {};
    const first = new Promise<PluginSelectionProcessingResult>((resolve) => { release = resolve; });
    plugin.processPluginIds.mockImplementationOnce(() => first).mockImplementationOnce(() => Promise.resolve(resultFor("tables", false)));
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    const toggle = (name: string) => renderedSettings.find((row) => row.name === name)?.controls.find((item) => item.kind === "toggle");
    await toggle("Dataview")?.change(true as never);
    await toggle("Tables")?.change(true as never);
    release(resultFor("dataview", stale));
    await internal.selectionProcessing;
    container.empty();
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    expect(container.allText().includes("进度可能已过期")).toBe(stale);
    expect(plugin.processPluginIds.mock.calls.map(([ids]) => ids)).toEqual([["dataview"], ["tables"]]);
  });

  it("取消插件先恢复对应补丁，暂停时选择不发出处理请求", async () => {
    const { plugin, internal, container } = fixture();
    plugin.settings.excludedPluginIds = [];
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    const toggle = renderedSettings.find((row) => row.name === "Dataview")?.controls.find((c) => c.kind === "toggle");
    await toggle?.change(false as never);
    expect(plugin.restoreThirdPartyPluginFiles).toHaveBeenCalledExactlyOnceWith(["dataview"]);
    expect(plugin.processPluginIds).not.toHaveBeenCalled();
    plugin.settings.pluginTranslationEnabled = false;
    await control("全部开启").click();
    expect(plugin.processPluginIds).not.toHaveBeenCalled();
  });
  it("关闭的插件显示已关闭，暂停状态禁用网络操作", () => {
    const { plugin, internal, container } = fixture();
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    expect(container.allText()).toContain("已关闭");
    plugin.settings.pluginTranslationEnabled = false;
    plugin.settings.excludedPluginIds = [];
    renderedSettings.length = 0;
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    expect(container.allText()).toContain("本地化已暂停");
    expect(control("同步译文").disabled).toBe(true);
    expect(control("重试失败项（0）").disabled).toBe(true);
  });

  it("批量重试只提交已选择且可恢复的插件", async () => {
    const { plugin, internal, container } = fixture();
    plugin.settings.excludedPluginIds = ["tables"];
    const state = plugin.getPluginState();
    Object.assign(state.publicPluginDiscoveries, { dataview: {
      statusRevision: 2, discoveryId: "discovery", receiptId: "receipt", targetLocales: ["zh-CN"],
      classification: "blocked", taskState: "blocked", retryAllowed: false, retryAfterSeconds: 0,
      blockedReasonCode: "registry_binding_changed", retryGeneration: 0,
      installationId: "installation", submittedAt: "2026-09-09T00:00:00Z",
    } as never });
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    expect(control("重试失败项（1）")).toBeDefined();
    await control("重试失败项（1）").click();
    expect(plugin.retryPluginIds).toHaveBeenCalledExactlyOnceWith(["dataview"]);
  });
  it("不在进度详情中重复卡片已展示的服务端状态", () => {
    const { plugin, internal, container } = fixture();
    plugin.settings.excludedPluginIds = [];
    Object.assign(plugin.getPluginState().pluginCatalogs, {
      tables: {
        pluginId: "tables", pluginName: "Tables", pluginVersion: "1.0.0",
        sourceLocale: "en", digest: "catalog-digest", artifactDigest: "a".repeat(64),
        scannedAt: "2026-09-09T00:00:00Z",
        strings: [{ key: "one", source: "Current source", origins: ["ui-call"], placeholderSignature: "" }],
      },
    });
    Object.assign(plugin.getPluginState().publicPluginDiscoveries, {
      tables: {
        statusRevision: 2, discoveryId: "discovery", receiptId: "receipt", targetLocales: ["zh-CN"],
        classification: "eligible_for_processing", taskState: "result_verified",
        retryAllowed: false, retryAfterSeconds: 0, installationId: "installation",
        submittedAt: "2026-09-09T00:00:00Z",
        localizationProjection: {
          kind: "public_localization_status_projection",
          protocol: { protocol: "trans-hub.client-protocol", revision: 1, schemaRevision: 1 },
          projectionRevision: 1, discoveryId: "discovery", registryKey: "official-directory",
          externalObjectId: "tables", targetLocale: "zh-CN", catalogIdentityDigest: null,
          sourceVersionId: "source", stage: "translating", updatedAt: "2026-09-09T00:00:00Z",
        },
      },
    });

    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);

    expect(container.allText().match(/当前权威版本正在翻译/gu)).toHaveLength(1);
  });
  it("同步期间重复点击与批量重试不会重复提交", async () => {
    const { plugin, internal, container } = fixture();
    plugin.settings.excludedPluginIds = [];
    let finish!: () => void;
    plugin.processSelectedPlugins.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ kind: "login-required", scan: { scannedCount: 1 } });
    }));
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    const first = control("同步译文").click();
    await control("同步译文").click();
    await control("重试失败项（0）").click();
    expect(plugin.processSelectedPlugins).toHaveBeenCalledTimes(1);
    expect(plugin.retryPluginIds).not.toHaveBeenCalled();
    finish();
    await first;
  });

  it("打开管理器前先关闭设置窗口", async () => {
    const { plugin, tab, internal, container } = fixture();
    const events: string[] = [];
    Object.assign(tab.app, { setting: { close: () => events.push("close-settings") } });
    plugin.openPluginManager.mockImplementation(() => { events.push("open-manager"); return Promise.resolve(); });
    internal.renderSettings(container as unknown as HTMLElement);
    await control("打开插件管理器").click();
    expect(events).toEqual(["close-settings", "open-manager"]);
    expect(control("打开插件管理器").disabled).toBe(false);
  });

  it("主操作在高级选项之前，恢复冲突在设置页可见且可处理", () => {
    const { internal, container, setRestoreResult } = fixture();
    setRestoreResult({ ...emptyRestore, conflicts: 1, conflictPluginIds: ["dataview"] });
    internal.renderSettings(container as unknown as HTMLElement);
    const text = container.allText();
    expect(text.indexOf("连接")).toBeLessThan(text.indexOf("译文语言"));
    expect(text.indexOf("管理已安装插件")).toBeLessThan(text.indexOf("高级选项"));
    expect(text).toContain("1 个需处理");
    expect(control("处理补丁冲突")).toBeDefined();
  });
  it("局部成功不会清除其他插件的过期提示", () => {
    const { tab, internal, container } = fixture();
    tab.refreshPluginCards({ kind: "stale", failedPluginIds: ["dataview"], failedSources: ["public-discovery"] }, ["dataview", "tables"]);
    tab.refreshPluginCards({ kind: "fresh" }, ["tables"]);
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    expect(container.allText()).toContain("进度可能已过期");
    expect(container.allText()).toContain("暂时无法更新进度");
    tab.refreshPluginCards({ kind: "fresh" }, ["dataview"]);
    container.empty();
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    expect(container.allText()).not.toContain("进度可能已过期");
  });

  it("未登录管理器提供连接入口，并把授权提示留在设置页", async () => {
    const { plugin, tab, internal, container } = fixture();
    plugin.hasUserSession = () => false;
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    await control("连接语枢").click();
    expect(plugin.connect).toHaveBeenCalledOnce();
    const settingsContainer = new TestElement();
    internal.renderSettings(settingsContainer as unknown as HTMLElement);
    expect(settingsContainer.allText()).toContain("请在浏览器中完成登录和设备授权");
    expect(settingsContainer.allText()).toContain("上次操作");
    expect(tab).toBeDefined();
  });
});
