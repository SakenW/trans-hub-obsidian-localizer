import { describe, expect, it, vi } from "vitest";

import {
  describePluginSelectionProcessing,
  describePluginStatusRefresh,
  pendingTranslationPluginIds,
  pendingTranslationRetryDelay,
  PluginProcessingQueue,
  processPluginSelection,
} from "../src/plugin-selection-processing";

const scanResult = {
  discoveredCount: 23,
  scannedCount: 2,
  changedCount: 1,
  stringCount: 80,
  selectablePluginIds: ["dataview", "tasks"],
};

describe("processPluginSelection", () => {
  it("选择变化后立即扫描和同步，不依赖定时自动化开关", async () => {
    const calls: string[] = [];
    const result = await processPluginSelection({
      scan: vi.fn(() => { calls.push("scan"); return Promise.resolve(scanResult); }),
      hasSession: () => true,
      synchronize: vi.fn(() => {
        calls.push("synchronize");
        return Promise.resolve({
          submittedCount: 1,
          requestedCount: 1,
          pulledCount: 0,
          waitingCount: 1,
          translationCount: 0,
          waitingPluginIds: ["dataview", "dataview"],
        });
      }),
      applyCached: vi.fn(() => { calls.push("apply"); }),
    });

    expect(calls).toEqual(["scan", "synchronize"]);
    expect(result.kind).toBe("synchronized");
    expect(describePluginSelectionProcessing(result)).toContain("1 个正在处理");
    expect(pendingTranslationPluginIds(result)).toEqual(["dataview"]);
  });

  it("未登录时仍完成本地扫描和缓存应用，并给出下一步", async () => {
    const synchronize = vi.fn();
    const applyCached = vi.fn();
    const result = await processPluginSelection({
      scan: () => Promise.resolve(scanResult),
      hasSession: () => false,
      synchronize,
      applyCached,
    });

    expect(synchronize).not.toHaveBeenCalled();
    expect(applyCached).toHaveBeenCalledOnce();
    expect(describePluginSelectionProcessing(result)).toContain("登录语枢后");
  });

  it("清空选择后立即停用运行时译文且不访问服务器", async () => {
    const synchronize = vi.fn();
    const applyCached = vi.fn();
    const result = await processPluginSelection({
      scan: () => Promise.resolve({ ...scanResult, scannedCount: 0, changedCount: 0, stringCount: 0 }),
      hasSession: () => true,
      synchronize,
      applyCached,
    });

    expect(synchronize).not.toHaveBeenCalled();
    expect(applyCached).toHaveBeenCalledOnce();
    expect(describePluginSelectionProcessing(result)).toBe("已停止所有插件翻译。");
  });

  it("等待译文时使用有上限的指数回拉间隔", () => {
    expect(pendingTranslationRetryDelay(0)).toBe(5_000);
    expect(pendingTranslationRetryDelay(1)).toBe(10_000);
    expect(pendingTranslationRetryDelay(4)).toBe(60_000);
    expect(pendingTranslationRetryDelay(20)).toBe(60_000);
    expect(pendingTranslationRetryDelay(0, 45_000)).toBe(45_000);
    expect(pendingTranslationRetryDelay(0, 30 * 60_000)).toBe(15 * 60_000);
  });

  it("权威刷新不误报为等待翻译", () => {
    const result = {
      kind: "synchronized" as const,
      scan: scanResult,
      sync: {
        submittedCount: 0,
        requestedCount: 0,
        pulledCount: 0,
        waitingCount: 3,
        translationCount: 0,
        waitingPluginIds: ["notebook-navigator", "obsidian-git", "obsidian-excalidraw-plugin"],
        authorityRefreshingCount: 3,
        demandStateCounts: {},
      },
    };

    expect(describePluginSelectionProcessing(result)).toContain("权威校验 3");
    expect(describePluginSelectionProcessing(result)).not.toContain("等待翻译");
  });

  it("局部选择和单插件重试不把批次数量表述为全量检查", () => {
    const result = {
      kind: "synchronized" as const,
      scan: { ...scanResult, scannedCount: 1 },
      sync: {
        submittedCount: 0,
        requestedCount: 0,
        pulledCount: 0,
        waitingCount: 0,
        translationCount: 0,
      },
    };

    expect(describePluginSelectionProcessing(result, "selected")).toContain("已检查所选 1 个插件");
    expect(describePluginSelectionProcessing(result, "single-retry")).toContain("已重试 1 个插件");
    expect(describePluginSelectionProcessing(result)).toContain("已检查 1 个插件");
  });

  it("轻量刷新状态优先提示需要重试的插件", () => {
    expect(describePluginStatusRefresh({
      submittedCount: 0,
      requestedCount: 0,
      pulledCount: 0,
      waitingCount: 3,
      translationCount: 0,
      waitingPluginIds: ["a", "b", "c"],
      failedPluginIds: ["a"],
    }, 3)).toContain("1 个需要重试");
  });

  it("轻量刷新状态区分处理中与无新译文", () => {
    expect(describePluginStatusRefresh({
      submittedCount: 0,
      requestedCount: 0,
      pulledCount: 0,
      waitingCount: 2,
      translationCount: 0,
      waitingPluginIds: ["a", "b"],
    }, 3)).toContain("2 个仍在处理中");

    expect(describePluginStatusRefresh({
      submittedCount: 0,
      requestedCount: 0,
      pulledCount: 0,
      waitingCount: 1,
      exportPendingCount: 2,
      translationCount: 0,
      waitingPluginIds: ["a"],
      exportPendingPluginIds: ["b", "c"],
    }, 3)).toBe("已刷新所选 3 个插件状态；1 个仍在处理，另有 2 个正在自动发布。");

    expect(describePluginStatusRefresh({
      submittedCount: 0,
      requestedCount: 0,
      pulledCount: 0,
      waitingCount: 0,
      exportPendingCount: 2,
      exportPendingPluginIds: ["a", "b"],
      translationCount: 0,
    }, 3)).toBe("已刷新所选 3 个插件状态；2 个译文已生成，服务器正在自动发布。");

    expect(describePluginStatusRefresh({
      submittedCount: 0,
      requestedCount: 0,
      pulledCount: 0,
      waitingCount: 0,
      translationCount: 0,
    }, 3)).toContain("目前没有新译文");

    expect(describePluginStatusRefresh({
      submittedCount: 0,
      requestedCount: 0,
      pulledCount: 2,
      waitingCount: 0,
      translationCount: 7,
    }, 2)).toContain("安全应用 7 条译文");
  });

  it("serializes overlapping plugin scans so older snapshots cannot save last", async () => {
    const queue = new PluginProcessingQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = queue.run(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:save");
    });
    const second = queue.run(() => {
      events.push("second:start");
      events.push("second:save");
      return Promise.resolve();
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "first:start", "first:save", "second:start", "second:save",
    ]);
  });
});
