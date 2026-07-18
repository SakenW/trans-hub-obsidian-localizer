import type { Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { registerPluginTranslationCommands } from "../src/plugin-actions";

describe("registerPluginTranslationCommands", () => {
  it("exposes only plugin-localization commands", () => {
    const ids: string[] = [];
    const host = {
      addCommand(command: { id: string }) { ids.push(command.id); },
    } as unknown as Plugin;
    registerPluginTranslationCommands(host, {
      scan: vi.fn(),
      synchronize: vi.fn(),
      apply: vi.fn(),
    });

    expect(ids).toEqual([
      "scan-installed-plugin-ui",
      "sync-installed-plugin-translations",
      "apply-cached-plugin-translations",
    ]);
    expect(ids.every((id) => !id.includes("note"))).toBe(true);
  });

  it("同步完成后把最新状态回传给设置页", async () => {
    let synchronize: (() => void) | undefined;
    const host = {
      addCommand(command: { id: string; callback?: () => void }) {
        if (command.id === "sync-installed-plugin-translations") synchronize = command.callback;
      },
    } as unknown as Plugin;
    const reportStatus = vi.fn();
    registerPluginTranslationCommands(host, {
      scan: vi.fn(),
      synchronize: vi.fn().mockResolvedValue({
        submittedCount: 0,
        requestedCount: 1,
        pulledCount: 0,
        waitingCount: 1,
        translationCount: 0,
      }),
      apply: vi.fn(),
      reportStatus,
    });

    expect(synchronize).toBeTypeOf("function");
    synchronize?.();
    await vi.waitFor(() => {
      expect(reportStatus).toHaveBeenCalledWith(
        "同步完成：新增需求 1，拉取 0，处理中或待审查 1。",
        false,
      );
    });
  });
});
