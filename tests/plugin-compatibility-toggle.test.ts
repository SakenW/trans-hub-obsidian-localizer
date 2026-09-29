import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async () => import("./settings-host-mock"));
import { Setting, TestElement } from "./settings-host-mock";
import { renderCompatibilityToggle } from "../src/plugin-compatibility-toggle";
import { setClientLocale } from "../src/client-localization";
import { describeFileRestore } from "../src/plugin-patch-controls";

const approval = { pluginId: "demo", pluginVersion: "1", targetLocale: "zh-CN", fingerprint: "hash" };
const restored = { restored: 1, conflicts: 0, restoredPluginIds: ["demo"], conflictPluginIds: [] };
const candidate = () => Promise.resolve({ kind: "checked" as const, approval, preview: { kind: "candidate" as const, reason: "candidate" as const, patchCount: 2 } });
beforeEach(() => { setClientLocale("zh-CN"); });

describe("inline compatibility switch", () => {
  it("checks without writing, then applies once on explicit switch-on and safely restores on switch-off", async () => {
    const row = new Setting(new TestElement());
    const apply = vi.fn(() => Promise.resolve({ applied: 2, conflicts: 0, skipped: 0 }));
    const restore = vi.fn(() => Promise.resolve(restored));
    const completed = vi.fn();
    renderCompatibilityToggle(row as never, { active: false, check: candidate, apply, restore, onComplete: completed });
    const toggle = row.controls[0];
    expect(toggle.disabled).toBe(true);
    await Promise.resolve();
    expect(toggle.disabled).toBe(false);
    expect(row.descEl.text).toContain("开启会备份并修改插件文件");
    expect(apply).not.toHaveBeenCalled();
    await Promise.all([toggle.change(true as never), toggle.change(true as never)]);
    expect(apply).toHaveBeenCalledExactlyOnceWith(approval);
    expect(toggle.value).toBe(true);
    expect(completed).toHaveBeenLastCalledWith(expect.stringContaining("待重新加载"), false);
    await toggle.change(false as never);
    expect(restore).toHaveBeenCalledExactlyOnceWith();
    expect(toggle.value).toBe(false);
    expect(completed).toHaveBeenLastCalledWith(expect.stringContaining("原始文件已恢复"), false);
  });

  it("shows version mismatch inline and refuses switch-on", async () => {
    const row = new Setting(new TestElement());
    const apply = vi.fn();
    renderCompatibilityToggle(row as never, { active: false, apply, restore: vi.fn(), onComplete: vi.fn(),
      check: () => Promise.resolve({ kind: "checked", preview: { kind: "skipped", reason: "cross-version", patchCount: 0 } }),
    });
    await Promise.resolve();
    expect(row.descEl.text).toContain("插件与译文版本不一致");
    expect(row.controls[0].disabled).toBe(true);
    await row.controls[0].change(true as never);
    expect(apply).not.toHaveBeenCalled();
    expect(row.controls[0].value).toBe(false);
  });

  it("never force-restores after a switch-off conflict, and preserves the active state", async () => {
    const row = new Setting(new TestElement());
    const restore = vi.fn(() => Promise.resolve({ restored: 0, conflicts: 1, restoredPluginIds: [], conflictPluginIds: ["demo"] }));
    const completed = vi.fn();
    renderCompatibilityToggle(row as never, { active: true, apply: vi.fn(), restore, onComplete: completed });
    await row.controls[0].change(false as never);
    expect(restore).toHaveBeenCalledExactlyOnceWith();
    expect(row.controls[0].value).toBe(true);
    expect(completed).toHaveBeenCalledWith(expect.stringContaining("已保留当前文件"), true);
  });

  it("does not show enabled when a previously checked candidate is refused at write time", async () => {
    const row = new Setting(new TestElement()); const completed = vi.fn();
    renderCompatibilityToggle(row as never, { active: false, check: candidate,
      apply: () => Promise.resolve({ applied: 0, skipped: 1, conflicts: 0 }), restore: vi.fn(), onComplete: completed });
    await Promise.resolve(); await row.controls[0].change(true as never);
    expect(row.controls[0].value).toBe(false);
    expect(row.controls[0].disabled).toBe(true);
    expect(completed).toHaveBeenCalledWith(expect.stringContaining("未写入补丁"), true);
  });

  it("does not require reload for a no-op restore", () => {
    expect(describeFileRestore({ restored: 0, conflicts: 0, restoredPluginIds: [], conflictPluginIds: [] })).toBe("没有需要恢复的兼容补丁。");
  });
});
