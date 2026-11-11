import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async () => import("./settings-host-mock"));
import { App, openedModals, Platform, renderedSettings, TestElement, type TestControl } from "./settings-host-mock";
import * as discovery from "../src/plugin-discovery";
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
    changeTargetLocale: vi.fn((targetLocale: string) => {
      plugin.settings.targetLocale = targetLocale;
      return Promise.resolve({ kind: "login-required", scan: { scannedCount: 0 } });
    }),
    connect: vi.fn(async () => {}),
    openRegistration: vi.fn(async () => {}),
    openPluginManager: vi.fn(async () => {}),
  };
  const tab = new TransHubSettingTab(new App() as never, plugin as unknown as TransHubObsidianPlugin);
  const internal = tab as unknown as {
    renderPluginPickerContents: (el: HTMLElement, plugins: readonly InstalledPluginWithSource[]) => void;
    renderSettings: (el: HTMLElement) => void;
    refreshSettings: () => void;
    mountPluginManager: (container: HTMLElement) => void;
    refreshPluginPatchStates: () => Promise<void>;
    refreshObsidianPluginNavigationNames: () => Promise<void>;
    selectionProcessing: Promise<void> | null;
  };
  internal.mountPluginManager = vi.fn();
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

afterEach(() => { vi.restoreAllMocks(); });
beforeEach(() => { openedModals.length = 0; renderedSettings.length = 0; setClientLocale("zh-CN"); });
describe("settings user interactions", () => {
  it("详情按钮和主行位置不随展开改变，重绘保留展开状态", () => {
    const { plugin, internal, container } = fixture();
    internal.renderPluginPickerContents(container as unknown as HTMLElement, [plugins[0]]);
    const detail = container.descendants().find((element) => element.classes.has("trans-hub-plugin-picker__details"))!;
    const trigger = container.descendants().find((element) => element.classes.has("trans-hub-plugin-picker__details-trigger"))!;
    const row = renderedSettings.find((setting) => setting.settingEl.children.includes(detail))!;
    const originalChildren = [...row.settingEl.children];
    const status = row.settingEl.children.find((element) => element.classes.has("trans-hub-plugin-picker__provenance"));
    expect(status).toBeDefined();
    expect(row.descEl.descendants()).not.toContain(status);
    expect(trigger.attrs.get("aria-controls")).toBe(detail.attrs.get("id"));
    expect(detail.attrs.get("aria-labelledby")).toBe(trigger.attrs.get("id"));
    expect(detail.hidden).toBe(true);
    expect(trigger.attrs.get("aria-expanded")).toBe("false");
    trigger.click();
    expect(detail.hidden).toBe(false);
    expect(trigger.attrs.get("aria-expanded")).toBe("true");
    expect(row.settingEl.children).toEqual(originalChildren);
    trigger.click();
    expect(detail.hidden).toBe(true);
    expect(trigger.attrs.get("aria-expanded")).toBe("false");
    expect(row.settingEl.children).toEqual(originalChildren);
    trigger.click();
    internal.renderPluginPickerContents(container as unknown as HTMLElement, [plugins[0]]);
    const remounted = container.descendants().find((element) => element.classes.has("trans-hub-plugin-picker__details"))!;
    const remountedTrigger = container.descendants().find((element) => element.classes.has("trans-hub-plugin-picker__details-trigger"))!;
    expect(remounted.hidden).toBe(false);
    expect(remountedTrigger.attrs.get("aria-expanded")).toBe("true");
    expect(plugin.processPluginIds).not.toHaveBeenCalled();
  });

  it("普通界面且匹配完整的插件不推荐兼容模式", () => {
    const { plugin, internal, container } = fixture();
    plugin.settings.excludedPluginIds = [];
    const state = plugin.getPluginState();
    Object.assign(state.pluginCatalogs, { dataview: { pluginId: "dataview", pluginName: "Dataview", pluginVersion: "1.0.0", sourceLocale: "en", digest: "catalog", artifactDigest: "a", scannedAt: "now", strings: [{ key: "name", source: "Settings", origins: ["ui-call"], placeholderSignature: "" }] } });
    Object.assign(state.pluginTranslations, { dataview: { "zh-CN": { pluginId: "dataview", pluginVersion: "1.0.0", sourceVersionId: "source", targetLocale: "zh-CN", pulledAt: "now", entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }] } } });
    internal.renderPluginPickerContents(container as unknown as HTMLElement, [plugins[0]]);
    const text = container.allText();
    expect(text).toContain("已获取 1/1 条匹配界面译文");
    expect(text).not.toContain("不代表全部界面都已替换");
    const controls = renderedSettings.flatMap((row) => row.controls);
    expect(controls.some((item) => item.text === "检查兼容方式")).toBe(false);
    expect(controls.some((item) => item.text === "界面仍有原文？")).toBe(false);
    expect(renderedSettings.some((row) => row.name === "兼容模式（可选）")).toBe(false);
  });

  it("部分译文插件展开详情后只读检查，并在原位显示禁用原因", async () => {
    const { plugin, internal, container } = fixture();
    plugin.settings.excludedPluginIds = [];
    const state = plugin.getPluginState();
    Object.assign(state.pluginCatalogs, { dataview: { pluginId: "dataview", pluginName: "Dataview", pluginVersion: "1.0.0", sourceLocale: "en", digest: "catalog", artifactDigest: "a", scannedAt: "now", strings: ["Settings", "Second setting"].map((source, key) => ({ key: String(key), source, origins: ["ui-call"], placeholderSignature: "" })) } });
    Object.assign(state.pluginTranslations, { dataview: { "zh-CN": { pluginId: "dataview", pluginVersion: "1.0.0", sourceVersionId: "source", targetLocale: "zh-CN", pulledAt: "now", entries: [{ pluginId: "dataview", source: "Settings", target: "设置" }] } } });
    const check = vi.fn(() => Promise.resolve({ kind: "checked", preview: { kind: "skipped", reason: "cross-version", patchCount: 0 } }));
    Object.assign(plugin, { checkThirdPartyPluginFilePatch: check });
    internal.renderPluginPickerContents(container as unknown as HTMLElement, [plugins[0]]);
    expect(check).not.toHaveBeenCalled();
    const trigger = container.descendants().find((item) => item.classes.has("trans-hub-plugin-picker__details-trigger"))!;
    trigger.click();
    await Promise.resolve();
    expect(check).toHaveBeenCalledExactlyOnceWith("dataview");
    const compatibility = renderedSettings.find((row) => row.name === "兼容模式（可选）")!;
    expect(compatibility.controls[0].disabled).toBe(true);
    expect(compatibility.descEl.text).toContain("插件与译文版本不一致");
  });
  it("未连接时仅提供连接和网站注册入口", async () => {
    const { plugin, internal, container } = fixture();
    plugin.hasUserSession = () => false;
    internal.renderSettings(container as unknown as HTMLElement);
    const connection = renderedSettings.find((setting) => setting.name === "连接语枢");
    expect(connection?.descEl.text).toContain("系统默认浏览器");
    expect(connection?.descEl.text).not.toContain("邀请码");
    expect(connection?.controls.map((item) => item.text)).toEqual(["在浏览器中连接", "注册"]);
    await control("注册").click();
    expect(plugin.openRegistration).toHaveBeenCalledOnce();
  });
  it("其他语言需要明确应用，且无效输入不改变当前语言", async () => {
    const { plugin, internal, container } = fixture();
    internal.renderSettings(container as unknown as HTMLElement);
    expect(renderedSettings.some((setting) => setting.name === "其他语言")).toBe(false);
    const dropdown = renderedSettings.find((setting) => setting.name === "译文语言")!.controls[0];
    await dropdown.change("other" as never);
    expect(plugin.changeTargetLocale).not.toHaveBeenCalled();
    renderedSettings.length = 0;
    internal.renderSettings(container as unknown as HTMLElement);
    const languageSetting = renderedSettings.find((setting) => setting.name === "其他语言");
    const input = languageSetting!.controls.find((item) => item.kind === "text")!;
    expect(input.value).toBe("");
    await input.change("not-a-locale!" as never);
    await control("应用").click();
    expect(plugin.changeTargetLocale).not.toHaveBeenCalled();
    renderedSettings.length = 0;
    internal.renderSettings(container as unknown as HTMLElement);
    const persistedInput = renderedSettings.find((setting) => setting.name === "其他语言")!.controls[0];
    expect(persistedInput.value).toBe("not-a-locale!");
    await persistedInput.change("sr_latn_rs" as never);
    await control("应用").click();
    expect(plugin.changeTargetLocale).toHaveBeenCalledWith("sr-Latn-RS");
    expect(plugin.settings.targetLocale).toBe("sr-Latn-RS");

    renderedSettings.length = 0;
    internal.renderSettings(container as unknown as HTMLElement);
    expect(renderedSettings.some((setting) => setting.name === "其他语言")).toBe(false);
    expect(renderedSettings.find((setting) => setting.name === "译文语言")!.controls[0].value).toBe("sr-Latn-RS");
    expect(plugin.changeTargetLocale).toHaveBeenCalledTimes(1);
    expect(plugin.settings.targetLocale).toBe("sr-Latn-RS");
  });
  it("取消自定义输入保留当前语言和草稿，常用语言仍直接切换", async () => {
    const { plugin, internal, container } = fixture();
    const render = () => { renderedSettings.length = 0; internal.renderSettings(container as unknown as HTMLElement); };
    const dropdown = () => renderedSettings.find((setting) => setting.name === "译文语言")!.controls[0];
    render();
    await dropdown().change("other" as never);
    render();
    await renderedSettings.find((setting) => setting.name === "其他语言")!.controls[0].change("ar" as never);
    await control("取消").click();
    render();
    expect(dropdown().value).toBe("zh-CN");
    expect(plugin.changeTargetLocale).not.toHaveBeenCalled();
    await dropdown().change("other" as never);
    render();
    expect(renderedSettings.find((setting) => setting.name === "其他语言")!.controls[0].value).toBe("ar");
    await dropdown().change("ja" as never);
    expect(plugin.changeTargetLocale).toHaveBeenCalledExactlyOnceWith("ja");
    render();
    expect(renderedSettings.some((setting) => setting.name === "其他语言")).toBe(false);
  });
  it("全部开启将新增插件一次性送入与逐个开启相同的处理队列", async () => {
    const { plugin, internal, container } = fixture();
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    await control("全部开启").click();
    await internal.selectionProcessing;
    expect(plugin.settings.excludedPluginIds).toEqual([]);
    expect(plugin.processPluginIds).toHaveBeenCalledExactlyOnceWith(["dataview", "tables"]);
  });
  it("开关周围触控区域只转发空白点击，不重复处理开关本身的点击", () => {
    const { internal, container } = fixture();
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    const hit = container.descendants().find((element) => element.classes.has("trans-hub-plugin-picker__toggle-hit"))!;
    const toggle = hit.children[0];
    const clicked = vi.spyOn(toggle, "click");
    const click = hit.listeners.get("click")! as unknown as (event: { target: TestElement }) => void;
    click({ target: hit });
    expect(clicked).toHaveBeenCalledOnce();
    click({ target: toggle });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("关闭全部先确认，取消和关闭弹窗都不写入；确认不受搜索影响", async () => {
    const { plugin, internal, container } = fixture();
    plugin.settings.excludedPluginIds = ["unrelated"];
    internal.renderPluginPickerContents(container as unknown as HTMLElement, plugins);
    const search = renderedSettings.flatMap((row) => row.controls).find((item) => item.kind === "text")!;
    await search.change("Dataview" as never);
    const start = control("全部关闭").click();
    expect(openedModals).toHaveLength(1);
    expect(openedModals[0].contentEl.allText()).toContain("不受搜索和筛选限制");
    expect(plugin.savePluginData).not.toHaveBeenCalled();
    await control("取消").click();
    await start;
    expect(plugin.settings.excludedPluginIds).toEqual(["unrelated"]);
    expect(plugin.restoreThirdPartyPluginFiles).not.toHaveBeenCalled();
    const dismissed = control("全部关闭").click();
    openedModals[1].close();
    await dismissed;
    expect(plugin.savePluginData).not.toHaveBeenCalled();
    const confirmed = control("全部关闭").click();
    // Controls from closed modals are retained by the mock, so use the latest modal's buttons.
    await renderedSettings.at(-1)!.controls.find((item) => item.text === "确认关闭全部")!.click();
    await confirmed;
    expect(plugin.savePluginData).toHaveBeenCalledOnce();
    expect(plugin.restoreThirdPartyPluginFiles).toHaveBeenCalledExactlyOnceWith(["dataview", "tables"]);
    expect(plugin.settings.excludedPluginIds).toEqual(expect.arrayContaining(["unrelated", "dataview", "tables"]));
    expect(plugin.processPluginIds).not.toHaveBeenCalled();
  });

  it.each(["none", "active", "conflict", "failure"])("恢复按钮只在异步检查确认已有补丁时启用（%s）", async (state) => {
    const { plugin, tab, internal, container } = fixture();
    vi.spyOn(discovery, "discoverInstalledPlugins").mockResolvedValue([{ ...plugins[0], enabled: false }]);
    let resolve!: (value: Map<string, string>) => void;
    let reject!: (error: Error) => void;
    const read = vi.fn(() => new Promise<Map<string, string>>((yes, no) => { resolve = yes; reject = no; }));
    Object.assign(plugin, { pluginFilePatchStates: read });
    tab.selectSection("compatibility");
    internal.renderSettings(container as unknown as HTMLElement);
    const restore = control("恢复原始文件");
    expect(restore.disabled).toBe(true);
    await vi.waitFor(() => expect(read).toHaveBeenCalledExactlyOnceWith(["dataview"]));
    if (state === "failure") reject(new Error("fixture inventory failed"));
    else resolve(new Map([["dataview", state]]));
    await vi.waitFor(() => {
      expect(restore.disabled).toBe(state === "none" || state === "failure");
      if (state === "none") expect(container.allText()).toContain("没有已应用的兼容补丁");
      if (state === "failure") expect(container.allText()).toContain("fixture inventory failed");
    });
    expect(plugin.savePluginData).not.toHaveBeenCalled();
    expect(plugin.restoreThirdPartyPluginFiles).not.toHaveBeenCalled();
    expect(plugin.connect).not.toHaveBeenCalled();
  });

  it("移动端打开兼容页时只显示移动端说明", async () => {
    const { plugin, internal, container } = fixture();
    const readPatchStates = vi.fn();
    Object.assign(plugin, { pluginFilePatchStates: readPatchStates });
    const wasDesktop = Platform.isDesktopApp;
    Platform.isDesktopApp = false;
    try {
      internal.renderSettings(container as unknown as HTMLElement);
      await control("兼容与恢复").click();
      const panel = container.children
        .filter((element) => element.classes.has("trans-hub-settings__panel"))[2];
      expect(panel.allText()).toContain("移动端本地化");
      expect(panel.allText()).toContain("文件兼容处理需要桌面端");
      expect(panel.allText()).not.toMatch(/兼容模式|已应用的兼容补丁|恢复原始文件|重新加载目标插件/);
      expect(readPatchStates).not.toHaveBeenCalled();
    } finally {
      Platform.isDesktopApp = wasDesktop;
    }
  });

  it("帮助使用原生折叠FAQ，连接操作只在基本设置末尾", () => {
    const { internal, container } = fixture();
    internal.renderSettings(container as unknown as HTMLElement);
    const panels = container.children.filter((element) => element.classes.has("trans-hub-settings__panel"));
    const faqs = panels[3].descendants().filter((element) => element.classes.has("trans-hub-settings__help"));
    expect(faqs).toHaveLength(4);
    expect(faqs.every((element) => element.attrs.get("tag") === "details" && !element.open)).toBe(true);
    expect(faqs.every((element) => element.children[0].attrs.get("tag") === "summary")).toBe(true);
    expect(panels[1].children.at(-1)!.allText()).toContain("语枢已连接");
    expect(panels[3].allText()).not.toContain("断开此设备连接");
  });

  it.each([true, false])("缓存按既有跨版本匹配合同展示并筛选（可匹配=%s）", async (compatible) => {
    const { plugin, internal, container } = fixture();
    plugin.settings.excludedPluginIds = [];
    const state = plugin.getPluginState();
    Object.assign(state.pluginCatalogs, { dataview: {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "1.0.0", sourceLocale: "en",
      digest: "current", artifactDigest: "a", scannedAt: "now",
      strings: [{ key: "one", source: "Settings", origins: ["ui-call"], placeholderSignature: "" }],
    } });
    Object.assign(state.pluginTranslations, { dataview: { "zh-CN": {
      pluginId: "dataview", pluginVersion: "0.9.0", sourceVersionId: "cached-source", targetLocale: "zh-CN",
      pulledAt: "now", entries: [{ pluginId: "dataview", source: "Settings", target: "设置",
        ...(compatible ? { sourceCompatibility: {
          semanticRole: "runtime-ui", contentScopes: ["runtime-ui"], placeholderSignature: "",
          formatSignature: "plain-text-v1", sourceContentDigest: `sha256:${"a".repeat(64)}`,
        } } : {}),
      }],
    } } });
    Object.assign(state.publicPluginDiscoveries, { dataview: {
      statusRevision: 2, discoveryId: "d", receiptId: "r", targetLocales: ["zh-CN"],
      classification: "eligible_for_processing", taskState: "result_verified", retryAllowed: false,
      retryAfterSeconds: 0, installationId: "i", submittedAt: "now",
      localizationProjection: {
        kind: "public_localization_status_projection", protocol: { protocol: "trans-hub.client-protocol", revision: 1, schemaRevision: 1 },
        projectionRevision: 1, discoveryId: "d", registryKey: "directory", externalObjectId: "dataview",
        targetLocale: "zh-CN", catalogIdentityDigest: null, sourceVersionId: "new-source", stage: "translating", updatedAt: "now",
      },
    } });
    internal.renderPluginPickerContents(container as unknown as HTMLElement, [plugins[0]]);
    if (!compatible) {
      expect(container.allText()).not.toContain("现有缓存可用");
      expect(plugin.processPluginIds).not.toHaveBeenCalled();
      return;
    }
    expect(container.allText()).toContain("现有缓存可用，新来源仍在处理");
    const details = container.descendants().find((element) => element.classes.has("trans-hub-plugin-picker__details"))!;
    expect(details.hidden).toBe(true);
    expect(details.allText()).toContain("本机插件 1.0.0，译文来源 0.9.0");
    expect(details.allText()).toContain("已获取 1/1 条匹配界面译文");
    const filter = renderedSettings.flatMap((row) => row.controls).find((item) => item.kind === "dropdown")!;
    for (const value of ["localized", "processing"]) {
      await filter.change(value as never);
      expect(container.allText()).toContain("现有缓存可用，新来源仍在处理");
      expect(container.allText()).not.toContain("没有匹配的插件");
    }
    expect(plugin.processPluginIds).not.toHaveBeenCalled();
    expect(plugin.processSelectedPlugins).not.toHaveBeenCalled();
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
    expect(control("重试可恢复项（0）").disabled).toBe(true);
  });

  it("主开关关闭时管理器显示插件官方名称和原始说明", () => {
    const { plugin, internal, container } = fixture();
    const state = plugin.getPluginState();
    Object.assign(state.pluginCatalogs, { dataview: {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "1.0.0",
      sourceLocale: "en", digest: "catalog", artifactDigest: "a".repeat(64), scannedAt: "now",
      strings: [
        { key: "name", source: "Dataview", origins: ["manifest.name"], semanticRole: "official-name", placeholderSignature: "" },
        { key: "desc", source: "Data views", origins: ["manifest.description"], semanticRole: "description", placeholderSignature: "" },
      ],
    } });
    Object.assign(state.pluginTranslations, { dataview: { "zh-CN": {
      pluginId: "dataview", pluginVersion: "1.0.0", sourceVersionId: "source",
      targetLocale: "zh-CN", pulledAt: "now", entries: [
        { pluginId: "dataview", source: "Dataview", target: "数据视图", provenanceKind: "th-reviewed-fill" },
        { pluginId: "dataview", source: "Data views", target: "数据展示" },
      ],
    } } });
    const installed = [{ ...plugins[0], description: "Data views" }];

    internal.renderPluginPickerContents(container as unknown as HTMLElement, installed);
    expect(renderedSettings.some((setting) => setting.name === "数据视图")).toBe(true);
    expect(container.allText()).toContain("数据展示");

    plugin.settings.pluginTranslationEnabled = false;
    container.empty();
    renderedSettings.length = 0;
    internal.renderPluginPickerContents(container as unknown as HTMLElement, installed);
    expect(renderedSettings.some((setting) => setting.name === "Dataview")).toBe(true);
    expect(container.allText()).toContain("Data views");
    expect(container.allText()).not.toContain("数据展示");
  });

  it("更新插件后先隐藏旧目录覆盖率，并只自动重扫变化的插件", async () => {
    const { plugin, internal, container } = fixture();
    plugin.settings.excludedPluginIds = [];
    Object.assign(plugin.getPluginState().pluginCatalogs, { dataview: {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "1.0.0",
      sourceLocale: "en", digest: "old", artifactDigest: "a".repeat(64), scannedAt: "now",
      strings: [{ key: "old", source: "Old setting", origins: ["ui-call"], placeholderSignature: "" }],
    } });
    const updated = [{ ...plugins[0], version: "2.0.0" }];
    internal.renderPluginPickerContents(container as unknown as HTMLElement, updated);
    expect(container.allText()).toContain("检测到插件版本变化，正在重新检查译文");
    expect(container.allText()).not.toContain("Old setting");
    expect(plugin.processPluginIds).toHaveBeenCalledExactlyOnceWith(["dataview"]);
    container.empty();
    internal.renderPluginPickerContents(container as unknown as HTMLElement, updated);
    expect(plugin.processPluginIds).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });

  it("更新后的自动检查失败时保留可手动重试的状态，不恢复旧覆盖率", async () => {
    const { plugin, internal, container } = fixture();
    plugin.settings.excludedPluginIds = [];
    Object.assign(plugin.getPluginState().pluginCatalogs, { dataview: {
      pluginId: "dataview", pluginName: "Dataview", pluginVersion: "1.0.0",
      sourceLocale: "en", digest: "old", artifactDigest: "a".repeat(64), scannedAt: "now",
      strings: [],
    } });
    plugin.processPluginIds.mockRejectedValueOnce(new Error("fixture scan failed"));
    const updated = [{ ...plugins[0], version: "2.0.0" }];
    internal.renderPluginPickerContents(container as unknown as HTMLElement, updated);
    await Promise.resolve();
    await Promise.resolve();
    container.empty();
    internal.renderPluginPickerContents(container as unknown as HTMLElement, updated);
    expect(container.allText()).toContain("插件更新后检查失败；点击“同步译文”重试");
    expect(container.allText()).not.toContain("1.0.0 的本地化译文");
    expect(plugin.processPluginIds).toHaveBeenCalledTimes(1);
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
    expect(control("重试可恢复项（1）")).toBeDefined();
    await control("重试可恢复项（1）").click();
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
    await control("重试可恢复项（0）").click();
    expect(plugin.processSelectedPlugins).toHaveBeenCalledTimes(1);
    expect(plugin.retryPluginIds).not.toHaveBeenCalled();
    finish();
    await first;
  });

  it("仅通过Tab切换插件管理，不保留重复入口", async () => {
    const { plugin, tab, internal, container } = fixture();
    const close = vi.fn();
    Object.assign(tab.app, { setting: { close } });
    internal.renderSettings(container as unknown as HTMLElement);
    await control("基本设置").click();
    expect(renderedSettings.flatMap((row) => row.controls).some((item) => item.text === "查看插件")).toBe(false);
    await control("插件管理").click();
    expect(close).not.toHaveBeenCalled();
    expect(plugin.openPluginManager).not.toHaveBeenCalled();
    expect(internal.mountPluginManager).toHaveBeenCalled();
  });

  it("主操作在基本设置中，恢复冲突在设置页可见且可处理", () => {
    const { internal, container, setRestoreResult } = fixture();
    setRestoreResult({ ...emptyRestore, conflicts: 1, conflictPluginIds: ["dataview"] });
    internal.renderSettings(container as unknown as HTMLElement);
    const text = container.allText();
    const panels = container.children.filter((element) => element.classes.has("trans-hub-settings__panel"));
    expect(panels[1].allText().indexOf("语枢已连接")).toBeGreaterThan(panels[1].allText().indexOf("译文语言"));
    expect(panels[3].allText()).not.toContain("断开此设备连接");
    expect(text).not.toContain("高级选项");
    expect(control("兼容与恢复")).toBeDefined();
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
