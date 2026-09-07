import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async () => import("./settings-host-mock"));
vi.mock("../src/plugin-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/plugin-sync")>();
  return { ...actual, synchronizeConfiguredPluginTranslations: vi.fn() };
});
import { synchronizeConfiguredPluginTranslations } from "../src/plugin-sync";
import { EMPTY_PLUGIN_STATE } from "../src/plugin-state";
import TransHubObsidianPlugin from "../src/main";
import type { TargetLocale } from "../src/product-config";
import type { PluginSelectionProcessingResult } from "../src/plugin-selection-processing";

import { setClientLocale } from "../src/client-localization";
beforeEach(() => setClientLocale("zh-CN"));

const result: PluginSelectionProcessingResult = {
  kind: "login-required", scan: { discoveredCount: 1, scannedCount: 1, changedCount: 0, stringCount: 1, selectablePluginIds: ["demo"] },
};
function fixture() {
  const plugin = new TransHubObsidianPlugin({} as never, {} as never);
  const internals = plugin as unknown as {
    activation: { isConfigured: () => boolean };
    savePluginDataForLifecycle: () => Promise<void>;
    processPluginsNow: (_ids: unknown, locale: TargetLocale) => Promise<PluginSelectionProcessingResult>;
  };
  internals.activation = { isConfigured: () => true };
  internals.savePluginDataForLifecycle = vi.fn(async () => {});
  internals.processPluginsNow = vi.fn(() => Promise.resolve(result));
  const restore = vi.spyOn(plugin, "restoreThirdPartyPluginFiles").mockResolvedValue({ restored: 1, conflicts: 0, restoredPluginIds: ["demo"], conflictPluginIds: [] });
  const refresh = vi.spyOn(plugin, "refreshPluginTranslationRuntime").mockResolvedValue();
  return { plugin, restore, refresh, internals };
}

describe("plugin locale transitions", () => {
  it("切换语言先恢复文件补丁再更新运行时，相同语言不恢复", async () => {
    const { plugin, restore, refresh } = fixture();
    await plugin.changeTargetLocale("en");
    expect(restore).toHaveBeenCalledOnce();
    expect(restore.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0] ?? 0);
    await plugin.changeTargetLocale("en");
    expect(restore).toHaveBeenCalledOnce();
  });
  it("快速切换只处理最后目标语言，不执行过时选择", async () => {
    const { plugin, restore, internals } = fixture();
    const first = plugin.changeTargetLocale("en");
    const last = plugin.changeTargetLocale("ja");
    expect(await first).toBeNull();
    expect(await last).toBe(result);
    expect(restore).toHaveBeenCalledOnce();
    expect(internals.processPluginsNow).toHaveBeenCalledExactlyOnceWith(undefined, "ja", undefined, 0);
  });
});

describe("disconnect and withdrawal recovery", () => {
  it.each(["restore", "save"])("断连时%s失败仍清空状态并停止运行时", async (failure) => {
    const plugin = new TransHubObsidianPlugin({} as never, {} as never);
    const stop = vi.fn();
    const clear = vi.fn();
    const save = vi.fn(() => failure === "save" ? Promise.reject(new Error("disk full")) : Promise.resolve());
    Object.assign(plugin, {
      activation: { clear }, pluginAutomation: { stop },
      state: { ...EMPTY_PLUGIN_STATE, enabledPluginIds: ["demo"] },
      savePluginDataForLifecycle: save,
      restoreThirdPartyPluginFiles: vi.fn(() => failure === "restore"
        ? Promise.reject(new Error("list failed"))
        : Promise.resolve({ restored: 0, conflicts: 0, restoredPluginIds: [], conflictPluginIds: [] })),
    });
    await expect(plugin.disconnect()).rejects.toThrow("已断开授权");
    expect(clear).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(plugin.getPluginState()).toEqual(EMPTY_PLUGIN_STATE);
  });

  it("后续撤回枚举失败保留所有尚未解决的恢复冲突", async () => {
    const plugin = new TransHubObsidianPlugin({} as never, {} as never);
    Object.assign(plugin, {
      lastFileRestore: { restored: 0, conflicts: 1, restoredPluginIds: [], conflictPluginIds: ["existing"] },
      pluginAutomation: { restoreThirdPartyFilePatches: () => Promise.reject(new Error("list failed")), applyCachedTranslations: vi.fn() },
    });
    vi.mocked(synchronizeConfiguredPluginTranslations).mockResolvedValue({ submittedCount: 0, requestedCount: 0, pulledCount: 0, waitingCount: 0, translationCount: 0, withdrawnExportPluginIds: ["new"] });
    const internal = plugin as unknown as { synchronizePluginTranslationsNow: (ids: undefined, locale: string, manual: undefined, selected: string[], revision: number) => Promise<unknown> };
    await internal.synchronizePluginTranslationsNow(undefined, "zh-CN", undefined, ["new"], 0);
    expect(plugin.getFileRestoreResult()?.conflictPluginIds).toEqual(["existing", "new"]);
  });

  it("撤回恢复排在已开始的补丁应用之后，不留下撤回译文", async () => {
    const plugin = new TransHubObsidianPlugin({} as never, {} as never);
    let releaseApply: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseApply = resolve; });
    let patched = false;
    const apply = vi.fn(async () => { await gate; patched = true; return { applied: 1, skipped: 0, conflicts: 0 }; });
    const restore = vi.fn(() => {
      const restored = patched ? 1 : 0;
      patched = false;
      return Promise.resolve({ restored, conflicts: 0, restoredPluginIds: restored ? ["demo"] : [], conflictPluginIds: [] });
    });
    Object.assign(plugin, { pluginAutomation: { applyThirdPartyFilePatches: apply, restoreThirdPartyFilePatches: restore, applyCachedTranslations: vi.fn() } });
    vi.mocked(synchronizeConfiguredPluginTranslations).mockResolvedValue({ submittedCount: 0, requestedCount: 0, pulledCount: 0, waitingCount: 0, translationCount: 0, withdrawnExportPluginIds: ["demo"] });
    const applying = plugin.applyThirdPartyPluginFileTranslations(["demo"]);
    const internal = plugin as unknown as { synchronizePluginTranslationsNow: (ids: undefined, locale: string, manual: undefined, selected: string[], revision: number) => Promise<unknown> };
    const withdrawing = internal.synchronizePluginTranslationsNow(undefined, "zh-CN", undefined, ["demo"], 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(restore).not.toHaveBeenCalled();
    releaseApply();
    await Promise.all([applying, withdrawing]);
    expect(restore).toHaveBeenCalledExactlyOnceWith(["demo"], false);
    expect(patched).toBe(false);
    expect(plugin.getFileRestoreResult()?.restoredPluginIds).toEqual(["demo"]);
  });
});
