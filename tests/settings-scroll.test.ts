import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  capturePluginListScrollTop,
  restorePluginListScrollTop,
} from "../src/plugin-picker-scroll";
import { TransHubSettingTab } from "../src/settings";

describe("plugin picker scroll state", () => {
  it("preserves the nested plugin list position across a settings refresh", () => {
    const list = { scrollTop: 376 } as HTMLElement;
    const container = {
      querySelector: (selector: string) => selector === ".trans-hub-plugin-picker__list" ? list : null,
    } as unknown as HTMLElement;

    const captured = capturePluginListScrollTop(container, 0);
    list.scrollTop = 0;
    restorePluginListScrollTop(list, captured);

    expect(list.scrollTop).toBe(376);
  });

  it("keeps the previous position when the list is temporarily absent", () => {
    const container = { querySelector: () => null } as unknown as HTMLElement;

    expect(capturePluginListScrollTop(container, 128)).toBe(128);
  });

  it("restores the currently mounted list after Obsidian replaces the original node", () => {
    const frames: FrameRequestCallback[] = [];
    const remountedList = { scrollTop: 0 } as HTMLElement;
    const document = {
      querySelector: () => remountedList,
      defaultView: {
        requestAnimationFrame: (callback: FrameRequestCallback) => {
          frames.push(callback);
          return frames.length;
        },
      },
    } as unknown as Document;
    const originalList = { scrollTop: 0, ownerDocument: document } as HTMLElement;

    restorePluginListScrollTop(originalList, 316);
    frames.shift()?.(0);
    frames.shift()?.(0);

    expect(remountedList.scrollTop).toBe(316);
  });

  it("captures the active 1.13 render container and falls back to the 1.12 tab container", () => {
    const activeList = { scrollTop: 420 } as HTMLElement;
    const legacyList = { scrollTop: 180 } as HTMLElement;
    const activeContainer = {
      querySelector: () => activeList,
    } as unknown as HTMLElement;
    const legacyContainer = {
      querySelector: () => legacyList,
    } as unknown as HTMLElement;
    const tab = new TransHubSettingTab(new App(), {} as never);
    const state = tab as unknown as {
      containerEl: HTMLElement;
      renderedContainerEl: HTMLElement | null;
      pluginListScrollTop: number;
      pluginSearchQuery: string;
      pluginStatusFilter: string;
      update: () => void;
      refreshSettings: () => void;
    };
    state.containerEl = legacyContainer;
    state.renderedContainerEl = activeContainer;
    state.pluginSearchQuery = "table";
    state.pluginStatusFilter = "localized";
    state.update = vi.fn();

    state.refreshSettings();

    expect(state.pluginListScrollTop).toBe(420);
    expect(state.pluginSearchQuery).toBe("table");
    expect(state.pluginStatusFilter).toBe("localized");
    expect(state.update).toHaveBeenCalledOnce();

    state.renderedContainerEl = null;
    state.refreshSettings();
    expect(state.pluginListScrollTop).toBe(180);
  });

  it("uses the action list as the scroll source before a synchronous settings rebuild", () => {
    const staleList = { scrollTop: 0 } as HTMLElement;
    const actionList = { scrollTop: 516, isConnected: true } as HTMLElement;
    const container = {
      querySelector: () => staleList,
    } as unknown as HTMLElement;
    const tab = new TransHubSettingTab(new App(), {} as never);
    const state = tab as unknown as {
      containerEl: HTMLElement;
      renderedContainerEl: HTMLElement | null;
      pluginListScrollTop: number;
      update: () => void;
      refreshSettings: (scrollSource?: HTMLElement) => void;
    };
    state.containerEl = container;
    state.renderedContainerEl = container;
    state.update = vi.fn();

    state.refreshSettings(actionList);

    expect(state.pluginListScrollTop).toBe(516);
    expect(state.update).toHaveBeenCalledOnce();
  });
});
