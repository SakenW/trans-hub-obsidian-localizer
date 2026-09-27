import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => import("./settings-host-mock"));

import { TransHubSettingTab } from "../src/settings";
import { EMPTY_PLUGIN_STATE } from "../src/plugin-state";
import { App, TestElement } from "./settings-host-mock";

describe("manager check and active version facts", () => {
  it("shows the saved successful-check time separately from an active pack generation", () => {
    const state = {
      ...EMPTY_PLUGIN_STATE,
      lastSuccessfulPluginCheckAt: { "zh-CN": "2026-09-24T01:02:03.000Z" },
      pluginTranslations: { demo: { "zh-CN": {
        pluginId: "demo", pluginVersion: "1.0.0", sourceVersionId: "source-1",
        targetLocale: "zh-CN", pulledAt: "2026-09-23T00:00:00.000Z",
        entries: [{ pluginId: "demo", source: "Settings", target: "设置" }],
      } } },
      translationExportStates: { "source-1:zh-CN:default": {
        etag: '"generation-3"', manifest: {
          schema: "trans-hub.translation-export", revision: 1,
          manifestId: "manifest-3", generationId: "generation-3", generationNumber: 3,
          sourceStreamId: "stream", sourceVersionId: "source-1", targetLocale: "zh-CN",
          targetVariant: "default", scope: { kind: "public", publicScopeId: "workspace" },
          manifestDigest: `sha256:${"a".repeat(64)}`, packs: [],
        },
      } },
    };
    const plugin = {
      settings: { targetLocale: "zh-CN", pluginTranslationEnabled: true,
        pluginMetadataTranslationEnabled: false, thirdPartyFilePatchingEnabled: false,
        excludedPluginIds: [] },
      getPluginState: () => state,
      getFileRestoreResult: () => undefined,
      hasUserSession: () => true,
      requiresReconnect: () => false,
    };
    const tab = new TransHubSettingTab(new App() as never, plugin as never);
    const container = new TestElement();
    const internal = tab as unknown as {
      renderPluginPickerContents: (container: HTMLElement, plugins: readonly unknown[]) => void;
    };
    internal.renderPluginPickerContents(container as unknown as HTMLElement, [{
      id: "demo", name: "Demo", version: "1.0.0", description: "A demo plugin.",
      dir: ".obsidian/plugins/demo", enabled: true,
      source: { kind: "supported", repository: "owner/demo" },
    }]);

    const text = container.allText();
    expect(text).toContain("最近成功检查");
    expect(text).toContain("当前采用 1.0.0 来源的第 3 代译文");
  });
});
