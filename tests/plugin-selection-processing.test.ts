import { describe, expect, it, vi } from "vitest";

import {
  describePluginSelectionProcessing,
  pendingTranslationPluginIds,
  pendingTranslationRetryDelay,
  processPluginSelection,
} from "../src/plugin-selection-processing";

const scanResult = {
  discoveredCount: 23,
  scannedCount: 2,
  changedCount: 1,
  stringCount: 80,
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
    expect(describePluginSelectionProcessing(result)).toContain("1 个正在由服务器处理或等待审查");
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
  });
});
