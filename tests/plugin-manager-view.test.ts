import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async () => import("./settings-host-mock"));
import { createSettingsSections } from "../src/settings-sections";
import TransHubObsidianPlugin from "../src/main";
import { TestElement, renderedSettings } from "./settings-host-mock";
import { setClientLocale } from "../src/client-localization";

beforeEach(() => { renderedSettings.length = 0; setClientLocale("zh-CN"); });
describe("unified plugin settings", () => {
  it("switches four sections in place without losing the plugin list DOM or scroll", () => {
    const root = new TestElement();
    const onChange = vi.fn();
    const sections = createSettingsSections(root as unknown as HTMLElement, "plugins", onChange);
    const list = new TestElement({ text: "search and expanded plugin content" });
    (sections.plugins as unknown as TestElement).children.push(list);
    sections.plugins.scrollTop = 325;
    expect(sections.plugins.hidden).toBe(false);
    expect(sections.basic.hidden).toBe(true);
    sections.select("compatibility");
    expect(sections.plugins.hidden).toBe(true);
    expect(sections.compatibility.hidden).toBe(false);
    sections.select("plugins");
    expect(sections.plugins.scrollTop).toBe(325);
    expect((sections.plugins as unknown as TestElement).children[0]).toBe(list);
    expect(onChange.mock.calls).toEqual([["compatibility"], ["plugins"]]);
    expect(renderedSettings.flatMap((row) => row.controls).map((button) => button.text)).toEqual(["插件管理", "基本设置", "兼容与恢复", "使用帮助"]);
  });

  it("routes the command to the existing settings host without closing it or opening a workspace window", async () => {
    const plugin = new TransHubObsidianPlugin({} as never, {} as never);
    const selectSection = vi.fn(); const open = vi.fn(); const openTabById = vi.fn(); const close = vi.fn();
    const openPopoutLeaf = vi.fn();
    Object.assign(plugin, { app: { setting: { open, openTabById, close }, workspace: { openPopoutLeaf } }, manifest: { id: "trans-hub-plugin-localizer" }, settingTab: { selectSection } });
    await plugin.openPluginManager();
    expect(selectSection).toHaveBeenCalledWith("plugins");
    expect(open).toHaveBeenCalledOnce();
    expect(openTabById).toHaveBeenCalledWith("trans-hub-plugin-localizer");
    expect(close).not.toHaveBeenCalled();
    expect(openPopoutLeaf).not.toHaveBeenCalled();
  });
});
