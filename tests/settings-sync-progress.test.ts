import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => import("./settings-host-mock"));

import { TransHubSettingTab } from "../src/settings";
import { App, TestElement } from "./settings-host-mock";

describe("manual translation sync progress", () => {
  it("updates only the active manager status line with published-source progress", () => {
    const tab = new TransHubSettingTab(new App() as never, {} as never);
    const status = new TestElement();
    const internal = tab as unknown as {
      managerActionPending: boolean;
      managerStatusEl: HTMLElement | null;
      selectionStatusAt: Date | null;
      reportManualSyncProgress: (progress: {
        checkedCount: number; totalCount: number; availableCount: number;
      }) => void;
    };
    internal.managerStatusEl = status as unknown as HTMLElement;
    internal.managerActionPending = true;
    const previousActionAt = new Date("2026-09-23T00:00:00Z");
    internal.selectionStatusAt = previousActionAt;

    internal.reportManualSyncProgress({ checkedCount: 1, totalCount: 4, availableCount: 1 });
    expect(status.text).toContain("已核对可用来源 1/4；本轮确认译文可用 1 个插件。");
    expect(status.text).not.toContain("上次操作");
    expect(internal.selectionStatusAt).toBe(previousActionAt);
    expect(status.attrs.get("aria-live")).toBe("polite");

    internal.managerActionPending = false;
    internal.reportManualSyncProgress({ checkedCount: 2, totalCount: 4, availableCount: 2 });
    expect(status.text).toContain("已核对可用来源 1/4；本轮确认译文可用 1 个插件。");
  });

  it("records the last operation time only after the manual check finishes", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => { finish = resolve; });
    const plugin = { processSelectedPlugins: vi.fn(() => pending) };
    const tab = new TransHubSettingTab(new App() as never, plugin as never);
    const status = new TestElement();
    const internal = tab as unknown as {
      managerActionPending: boolean;
      managerStatusEl: HTMLElement | null;
      selectionStatusAt: Date | null;
      refreshSettings: () => void;
      refreshSelectedPlugins: (scrollSource: HTMLElement) => Promise<void>;
    };
    internal.managerStatusEl = status as unknown as HTMLElement;
    internal.refreshSettings = vi.fn();
    const previousActionAt = new Date("2026-09-23T00:00:00Z");
    internal.selectionStatusAt = previousActionAt;

    const operation = internal.refreshSelectedPlugins(new TestElement() as unknown as HTMLElement);
    expect(status.text).toContain("正在同步译文");
    expect(status.text).not.toContain("上次操作");
    expect(internal.selectionStatusAt).toBe(previousActionAt);

    finish({ kind: "empty", scan: { discoveredCount: 0, scannedCount: 0,
      changedCount: 0, stringCount: 0, selectablePluginIds: [] } });
    await operation;
    expect(internal.managerActionPending).toBe(false);
    expect(internal.selectionStatusAt?.getTime()).toBeGreaterThan(previousActionAt.getTime());
  });
});
