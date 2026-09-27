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

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("plugin locale transitions", () => {
  it("等待旧同步收尾后才使新语言生效，旧扫描期间设置语言不变", async () => {
    const { plugin, internals } = fixture();
    plugin.settings.targetLocale = "zh-CN";
    const first = deferred();
    const run = vi.mocked(internals.processPluginsNow)
      .mockImplementationOnce(async () => { await first.promise; return result; })
      .mockResolvedValueOnce(result);

    const oldRound = plugin.processSelectedPlugins();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const switchLocale = plugin.changeTargetLocale("ja");
    expect(plugin.settings.targetLocale).toBe("zh-CN");
    expect(run).toHaveBeenCalledTimes(1);

    first.resolve();
    await oldRound;
    await expect(switchLocale).resolves.toBe(result);
    expect(plugin.settings.targetLocale).toBe("ja");
    expect(run).toHaveBeenNthCalledWith(2, undefined, "ja", undefined, 0);
  });

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

describe("automatic plugin translation", () => {
  it("切语言请求后旧轮不播报结果或重提旧语言恢复任务", async () => {
    const { plugin, internals } = fixture();
    plugin.settings.targetLocale = "zh-CN";
    const first = deferred();
    const run = vi.mocked(internals.processPluginsNow)
      .mockImplementationOnce(async () => { await first.promise; return result; })
      .mockResolvedValueOnce(result);
    const reportCommandStatus = vi.fn();
    const refreshPluginCards = vi.fn();
    Object.assign(plugin, { settingTab: { reportCommandStatus, refreshPluginCards } });
    const internal = plugin as unknown as { runAutomaticPluginTranslationNow: (announce: boolean) => Promise<void> };

    const automatic = internal.runAutomaticPluginTranslationNow(true);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const switching = plugin.changeTargetLocale("ja");
    first.resolve();
    await automatic;
    await switching;

    expect(reportCommandStatus).not.toHaveBeenCalled();
    expect(refreshPluginCards).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("切语言请求后旧轮的手动进度回调不写新语言界面", async () => {
    const { plugin, internals } = fixture();
    plugin.settings.targetLocale = "zh-CN";
    const first = deferred();
    vi.mocked(internals.processPluginsNow)
      .mockImplementationOnce(async (...args: unknown[]) => {
        await first.promise;
        const progress = args[4] as ((value: { checkedCount: number; totalCount: number; availableCount: number }) => void) | undefined;
        progress?.({ checkedCount: 1, totalCount: 2, availableCount: 1 });
        return result;
      })
      .mockResolvedValueOnce(result);
    const onProgress = vi.fn();

    const oldRound = plugin.processSelectedPlugins(false, onProgress);
    await vi.waitFor(() => expect(internals.processPluginsNow).toHaveBeenCalledTimes(1));
    const switching = plugin.changeTargetLocale("ja");
    first.resolve();
    await oldRound;
    await switching;
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("仅完整成功检查持久化当前语言的最近成功时间", async () => {
    const plugin = new TransHubObsidianPlugin({} as never, {} as never);
    const save = vi.fn(async () => {});
    Object.assign(plugin, {
      settings: { ...plugin.settings, targetLocale: "zh-CN" },
      pluginAutomation: { applyCachedTranslations: vi.fn() },
      savePluginDataForLifecycle: save,
    });
    const internal = plugin as unknown as {
      synchronizePluginTranslationsNow: (
        ids: readonly string[] | undefined, locale: TargetLocale, manual: undefined,
        selected: readonly string[], revision: number,
      ) => Promise<unknown>;
    };
    const summary = { submittedCount: 0, requestedCount: 0, pulledCount: 0,
      waitingCount: 0, translationCount: 0, checkSucceeded: true };
    vi.mocked(synchronizeConfiguredPluginTranslations).mockResolvedValue(summary);

    await internal.synchronizePluginTranslationsNow(undefined, "zh-CN", undefined, [], 0);
    const successfulAt = plugin.getPluginState().lastSuccessfulPluginCheckAt?.["zh-CN"];
    expect(successfulAt).toBeDefined();
    expect(save).toHaveBeenCalledOnce();

    vi.mocked(synchronizeConfiguredPluginTranslations).mockResolvedValue({ ...summary, checkSucceeded: false });
    await internal.synchronizePluginTranslationsNow(undefined, "zh-CN", undefined, [], 0);
    vi.mocked(synchronizeConfiguredPluginTranslations).mockResolvedValue(summary);
    await internal.synchronizePluginTranslationsNow(["demo"], "zh-CN", undefined, ["demo"], 0);
    expect(plugin.getPluginState().lastSuccessfulPluginCheckAt?.["zh-CN"]).toBe(successfulAt);
    expect(save).toHaveBeenCalledOnce();
  });

  it("最近成功检查时间写盘失败时保留此前的成功事实", async () => {
    const plugin = new TransHubObsidianPlugin({} as never, {} as never);
    const earlier = "2026-09-23T00:00:00.000Z";
    Object.assign(plugin, {
      settings: { ...plugin.settings, targetLocale: "zh-CN" },
      state: { ...EMPTY_PLUGIN_STATE, lastSuccessfulPluginCheckAt: { "zh-CN": earlier } },
      pluginAutomation: { applyCachedTranslations: vi.fn() },
      savePluginDataForLifecycle: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    vi.mocked(synchronizeConfiguredPluginTranslations).mockResolvedValue({
      submittedCount: 0, requestedCount: 0, pulledCount: 0,
      waitingCount: 0, translationCount: 0, checkSucceeded: true,
    });
    const internal = plugin as unknown as {
      synchronizePluginTranslationsNow: (
        ids: undefined, locale: TargetLocale, manual: undefined,
        selected: readonly string[], revision: number,
      ) => Promise<unknown>;
    };
    await expect(internal.synchronizePluginTranslationsNow(undefined, "zh-CN", undefined, [], 0))
      .rejects.toThrow("disk full");
    expect(plugin.getPluginState().lastSuccessfulPluginCheckAt?.["zh-CN"]).toBe(earlier);
  });

  it("自动检查期间的手动同步排队后重新读取发布版本", async () => {
    const { plugin, internals } = fixture();
    const first = deferred();
    const observedGenerations: string[] = [];
    let publishedGeneration = "old";
    vi.mocked(internals.processPluginsNow).mockImplementation(async () => {
      observedGenerations.push(publishedGeneration);
      if (observedGenerations.length === 1) await first.promise;
      return result;
    });

    // Both the startup check and the manager button enter processSelectedPlugins.
    const automatic = plugin.processSelectedPlugins();
    await vi.waitFor(() => expect(observedGenerations).toEqual(["old"]));
    publishedGeneration = "new";
    const manual = plugin.processSelectedPlugins();
    expect(observedGenerations).toEqual(["old"]);

    first.resolve();
    await Promise.all([automatic, manual]);
    expect(observedGenerations).toEqual(["old", "new"]);
  });

  it("自动检查失败不阻止排队的手动同步重新检查", async () => {
    const { plugin, internals } = fixture();
    const first = deferred();
    const run = vi.mocked(internals.processPluginsNow)
      .mockImplementationOnce(async () => { await first.promise; throw new Error("offline"); })
      .mockResolvedValueOnce(result);

    const automatic = plugin.processSelectedPlugins();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const manual = plugin.processSelectedPlugins();
    first.resolve();

    await expect(automatic).rejects.toThrow("offline");
    await expect(manual).resolves.toEqual(result);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("在重叠的启动检查完成后补查一次晚注册插件", async () => {
    const plugin = new TransHubObsidianPlugin({} as never, {} as never);
    const first = deferred();
    const internal = plugin as unknown as {
      runAutomaticPluginTranslation: () => Promise<void>;
      runAutomaticPluginTranslationNow: () => Promise<void>;
    };
    const run = vi.spyOn(internal, "runAutomaticPluginTranslationNow")
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce();

    const onloadCheck = internal.runAutomaticPluginTranslation();
    const layoutReadyCheck = internal.runAutomaticPluginTranslation();
    expect(run).toHaveBeenCalledTimes(1);

    first.resolve();
    await Promise.all([onloadCheck, layoutReadyCheck]);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it("合并逐插件持久化后的运行时刷新并可在退出时取消", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
    try {
      const plugin = new TransHubObsidianPlugin({} as never, {} as never);
      const apply = vi.fn();
      Object.assign(plugin, { pluginAutomation: { applyCachedTranslations: apply } });
      const internal = plugin as unknown as {
        scheduleProgressiveRuntimeRefresh: (revision: number) => void;
        clearProgressiveRuntimeRefresh: () => void;
      };

      internal.scheduleProgressiveRuntimeRefresh(0);
      internal.scheduleProgressiveRuntimeRefresh(0);
      vi.advanceTimersByTime(149);
      expect(apply).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(apply).toHaveBeenCalledOnce();

      internal.scheduleProgressiveRuntimeRefresh(0);
      internal.clearProgressiveRuntimeRefresh();
      vi.advanceTimersByTime(150);
      expect(apply).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
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
