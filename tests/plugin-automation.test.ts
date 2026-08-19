import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  canReuseScannedPluginCatalog,
  PluginAutomationController,
  selectApplicablePluginTranslations,
} from "../src/plugin-automation";
import { EMPTY_PLUGIN_STATE, type PluginState } from "../src/plugin-state";

const CONTROLLER_SETTINGS = {
  targetLocale: "zh-CN" as const,
  pluginTranslationEnabled: true,
  pluginMetadataTranslationEnabled: true,
  excludedPluginIds: [],
};

function automationController(
  app: App,
  state: PluginState,
  settings: typeof CONTROLLER_SETTINGS = CONTROLLER_SETTINGS,
): PluginAutomationController {
  return new PluginAutomationController({
    app,
    ownPluginId: "trans-hub-plugin-localizer",
    settings: () => settings,
    state: () => state,
    replaceState: () => {},
    save: async () => {},
    synchronize: () => Promise.resolve({
      processedPluginIds: [],
      failures: [],
      submittedCount: 0,
      requestedCount: 0,
      pulledCount: 0,
      waitingCount: 0,
      translationCount: 0,
    }),
  });
}

function displayNameState(pluginId: string, officialName: string, localizedName: string): PluginState {
  return {
    ...EMPTY_PLUGIN_STATE,
    enabledPluginIds: [pluginId],
    pluginCatalogs: {
      [pluginId]: {
        pluginId,
        pluginName: officialName,
        pluginVersion: "1.0.0",
        sourceLocale: "en",
        digest: "d",
        artifactDigest: "a".repeat(64),
        scannedAt: "now",
        strings: [{
          key: "name",
          source: officialName,
          origins: ["manifest.name"],
          placeholderSignature: "",
        }],
      },
    },
    pluginTranslations: {
      [pluginId]: {
        "zh-CN": {
          pluginId,
          pluginVersion: "1.0.0",
          sourceVersionId: "v",
          targetLocale: "zh-CN",
          entries: [{
            pluginId,
            source: officialName,
            target: localizedName,
          }],
          pulledAt: "now",
        },
      },
    },
  };
}

class FakeTitle {
  textContent = "";
  private readonly attributes = new Map<string, string>();

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
}

class FakeNavItem {
  readonly title = new FakeTitle();

  constructor(
    private readonly pluginId: string,
    title: string,
  ) { this.title.textContent = title; }

  getAttribute(name: string): string | null {
    return name === "data-setting-id" ? this.pluginId : null;
  }

  querySelector(selector: string): FakeTitle | null {
    return selector === ".vertical-tab-nav-item-title" ? this.title : null;
  }
}

function settingsDocument(items: readonly FakeNavItem[]): Document {
  const titles = items.map((item) => item.title);
  return {
    querySelectorAll(selector: string): FakeTitle[] | FakeNavItem[] {
      if (selector === ".vertical-tab-nav-item[data-setting-id]") return [...items];
      if (selector.startsWith("[")) {
        return titles.filter((title) => title.getAttribute(selector.slice(1, -1)) !== null);
      }
      return [];
    },
  } as unknown as Document;
}

describe("selectApplicablePluginTranslations", () => {
  it("reuses an unchanged exact catalog instead of rescanning its bundle", () => {
    const catalog = {
      pluginId: "large-plugin",
      pluginName: "Large Plugin",
      pluginVersion: "1.0.0",
      artifactDigest: "a".repeat(64),
      patchEvidenceRevision: 10,
      catalogIdentity: {},
    } as Parameters<typeof canReuseScannedPluginCatalog>[0];

    expect(canReuseScannedPluginCatalog(catalog, {
      name: "Large Plugin", version: "1.0.0",
    }, "a".repeat(64))).toBe(true);
    expect(canReuseScannedPluginCatalog(catalog, {
      name: "Renamed Plugin", version: "1.0.0",
    }, "a".repeat(64))).toBe(false);
    expect(canReuseScannedPluginCatalog(catalog, {
      name: "Large Plugin", version: "1.0.0",
    }, "b".repeat(64))).toBe(false);
  });

  it("forces a rescan when a persisted catalog predates patch-safe literal evidence", () => {
    const legacyCatalog = {
      pluginId: "large-plugin",
      pluginName: "Large Plugin",
      pluginVersion: "1.0.0",
      artifactDigest: "a".repeat(64),
      catalogIdentity: {},
    } as Parameters<typeof canReuseScannedPluginCatalog>[0];

    expect(canReuseScannedPluginCatalog(legacyCatalog, {
      name: "Large Plugin", version: "1.0.0",
    }, "a".repeat(64))).toBe(false);
  });

  it("attaches popout translation observers and releases them on close", () => {
    class MockMutationObserver {
      static instances: MockMutationObserver[] = [];
      disconnected = false;

      constructor(_callback: MutationCallback) { MockMutationObserver.instances.push(this); }
      observe(_target: Node, _options: MutationObserverInit): void {}
      disconnect(): void { this.disconnected = true; }
      takeRecords(): MutationRecord[] { return []; }
    }
    const createRoot = (): HTMLElement => ({
      nodeType: 1,
      childNodes: [],
      closest: () => null,
      contains: () => true,
      getAttribute: () => null,
      matches: () => false,
      ownerDocument: {
        defaultView: { MutationObserver: MockMutationObserver },
        createTreeWalker: () => ({ nextNode: () => null }),
      },
    } as unknown as HTMLElement);
    const handlers = new Map<string, unknown>();
    const removed: string[] = [];
    const app = {
      workspace: {
        on(name: string, callback: unknown) {
          handlers.set(name, callback);
          return { name };
        },
        offref(ref: { readonly name: string }) { removed.push(ref.name); },
      },
    } as unknown as App;
    const mainRoot = createRoot();
    const popoutRoot = createRoot();
    vi.stubGlobal("document", { body: mainRoot });
    vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4, SHOW_ELEMENT: 1 });
    try {
      const controller = new PluginAutomationController({
        app,
        ownPluginId: "trans-hub-plugin-localizer",
        settings: () => ({
          targetLocale: "zh-CN",
          pluginTranslationEnabled: true,
          pluginMetadataTranslationEnabled: true,
          excludedPluginIds: [],
        }),
        state: () => EMPTY_PLUGIN_STATE,
        replaceState: () => {},
        save: async () => {},
        synchronize: () => Promise.resolve({
          processedPluginIds: [],
          failures: [],
          submittedCount: 0,
          requestedCount: 0,
          pulledCount: 0,
          waitingCount: 0,
          translationCount: 0,
        }),
      });

      controller.start();
      const open = handlers.get("window-open") as ((workspaceWindow: unknown, window: Window) => void) | undefined;
      const close = handlers.get("window-close") as ((workspaceWindow: unknown, window: Window) => void) | undefined;
      expect(open).toBeTypeOf("function");
      expect(close).toBeTypeOf("function");
      const popoutWindow = { document: { body: popoutRoot } } as unknown as Window;
      open?.({}, popoutWindow);
      close?.({}, popoutWindow);
      expect(MockMutationObserver.instances[1]?.disconnected).toBe(true);

      controller.stop();
      expect(removed).toEqual(["window-open", "window-close"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("removes window listeners when the runtime is refreshed while disabled", () => {
    class MockMutationObserver {
      constructor(_callback: MutationCallback) {}
      observe(_target: Node, _options: MutationObserverInit): void {}
      disconnect(): void {}
      takeRecords(): MutationRecord[] { return []; }
    }
    const root = {
      nodeType: 1,
      childNodes: [],
      closest: () => null,
      contains: () => true,
      getAttribute: () => null,
      matches: () => false,
      ownerDocument: {
        defaultView: { MutationObserver: MockMutationObserver },
        createTreeWalker: () => ({ nextNode: () => null }),
      },
    } as unknown as HTMLElement;
    const handlers = new Map<string, unknown>();
    const removed: string[] = [];
    let enabled = true;
    const app = {
      workspace: {
        on(name: string, callback: unknown) {
          const ref = { name, callback };
          handlers.set(name, ref);
          return ref;
        },
        offref(ref: { readonly name: string; readonly callback?: unknown }) {
          removed.push(ref.name);
          if (handlers.get(ref.name) === ref) handlers.delete(ref.name);
        },
      },
    } as unknown as App;
    vi.stubGlobal("document", { body: root });
    vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4, SHOW_ELEMENT: 1 });
    try {
      const controller = new PluginAutomationController({
        app,
        ownPluginId: "trans-hub-plugin-localizer",
        settings: () => ({
          targetLocale: "zh-CN",
          pluginTranslationEnabled: enabled,
          pluginMetadataTranslationEnabled: true,
          excludedPluginIds: [],
        }),
        state: () => EMPTY_PLUGIN_STATE,
        replaceState: () => {},
        save: async () => {},
        synchronize: () => Promise.resolve({
          processedPluginIds: [], failures: [], submittedCount: 0, requestedCount: 0,
          pulledCount: 0, waitingCount: 0, translationCount: 0,
        }),
      });

      controller.start();
      enabled = false;
      controller.refreshRuntime();

      expect(removed).toEqual(["window-open", "window-close"]);
      expect(handlers.get("window-open")).toBeUndefined();
      expect(handlers.get("window-close")).toBeUndefined();
      controller.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("attaches the runtime observer to the standalone 1.13 settings window", () => {
    class MockMutationObserver {
      static instances: MockMutationObserver[] = [];
      disconnected = false;

      constructor(_callback: MutationCallback) { MockMutationObserver.instances.push(this); }
      observe(_target: Node, _options: MutationObserverInit): void {}
      disconnect(): void { this.disconnected = true; }
      takeRecords(): MutationRecord[] { return []; }
    }
    const createRoot = (): HTMLElement => ({
      nodeType: 1,
      childNodes: [],
      closest: () => null,
      contains: () => true,
      getAttribute: () => null,
      matches: () => false,
      ownerDocument: {
        defaultView: { MutationObserver: MockMutationObserver },
        createTreeWalker: () => ({ nextNode: () => null }),
      },
    } as unknown as HTMLElement);
    const mainRoot = createRoot();
    const settingsBody = createRoot();
    const app = {
      workspace: {
        on() { return { name: "window-open" }; },
        offref() {},
      },
      setting: { win: { document: { body: settingsBody } } },
    } as unknown as App;
    vi.stubGlobal("document", { body: mainRoot });
    vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4, SHOW_ELEMENT: 1 });
    try {
      const controller = automationController(app, EMPTY_PLUGIN_STATE);
      controller.start();
      // One observer for the main window body and one for the settings window body.
      expect(MockMutationObserver.instances).toHaveLength(2);
      controller.stop();
      expect(MockMutationObserver.instances.every((observer) => observer.disconnected)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("applies cached translations only for currently enabled and non-excluded plugins", () => {
    const entry = (pluginId: string) => ({ pluginId, source: `Source ${pluginId}`, target: `Target ${pluginId}` });
    const state = {
      ...EMPTY_PLUGIN_STATE,
      enabledPluginIds: ["enabled", "excluded"],
      pluginCatalogs: Object.fromEntries(["enabled", "excluded"].map((pluginId) => [pluginId, {
        pluginId,
        pluginName: pluginId,
        pluginVersion: "1",
        sourceLocale: "en",
        digest: "digest",
        artifactDigest: "artifact",
        scannedAt: "now",
        strings: [{
          key: pluginId,
          source: `Source ${pluginId}`,
          origins: ["ui-call" as const],
          semanticRole: "runtime-ui" as const,
          placeholderSignature: "",
        }],
      }])),
      pluginTranslations: {
        enabled: { "zh-CN": { pluginId: "enabled", pluginVersion: "1", sourceVersionId: "v", targetLocale: "zh-CN", entries: [entry("enabled")], pulledAt: "now" } },
        disabled: { "zh-CN": { pluginId: "disabled", pluginVersion: "1", sourceVersionId: "v", targetLocale: "zh-CN", entries: [entry("disabled")], pulledAt: "now" } },
        excluded: { "zh-CN": { pluginId: "excluded", pluginVersion: "1", sourceVersionId: "v", targetLocale: "zh-CN", entries: [entry("excluded")], pulledAt: "now" } },
      },
    };

    expect(selectApplicablePluginTranslations(state, {
      excludedPluginIds: ["excluded"],
      pluginMetadataTranslationEnabled: true,
      targetLocale: "zh-CN",
    })).toEqual([{ ...entry("enabled"), scopes: ["runtime-ui"] }]);
  });

  it("selects the current locale while preserving another cached locale", () => {
    const state = {
      ...EMPTY_PLUGIN_STATE,
      enabledPluginIds: ["enabled"],
      pluginCatalogs: {
        enabled: {
          pluginId: "enabled", pluginName: "Enabled", pluginVersion: "1",
          sourceLocale: "en", digest: "digest", artifactDigest: "artifact", scannedAt: "now",
          strings: [{
            key: "settings", source: "Settings", origins: ["ui-call" as const],
            semanticRole: "runtime-ui" as const, placeholderSignature: "",
          }],
        },
      },
      pluginTranslations: {
        enabled: {
          "zh-CN": {
            pluginId: "enabled", pluginVersion: "1", sourceVersionId: "v-zh",
            targetLocale: "zh-CN", entries: [{ pluginId: "enabled", source: "Settings", target: "设置" }],
            pulledAt: "now",
          },
          ja: {
            pluginId: "enabled", pluginVersion: "1", sourceVersionId: "v-ja",
            targetLocale: "ja", entries: [{ pluginId: "enabled", source: "Settings", target: "設定" }],
            pulledAt: "now",
          },
        },
      },
    };

    expect(selectApplicablePluginTranslations(state, {
      excludedPluginIds: [],
      pluginMetadataTranslationEnabled: true,
      targetLocale: "ja",
    })).toEqual([{
      pluginId: "enabled", source: "Settings", target: "設定", scopes: ["runtime-ui"],
    }]);
  });

  it("applies composite plugin names only while metadata translation is enabled", () => {
    const state = {
      ...EMPTY_PLUGIN_STATE,
      enabledPluginIds: ["sample"],
      pluginCatalogs: {
        sample: {
          pluginId: "sample",
          pluginName: "Sample",
          pluginVersion: "1",
          sourceLocale: "en",
          digest: "digest",
          artifactDigest: "artifact",
          scannedAt: "now",
          strings: [
            {
              key: "name",
              source: "Sample",
              origins: ["manifest.name" as const],
              semanticRole: "official-name" as const,
              placeholderSignature: "",
            },
            {
              key: "description",
              source: "Sample description",
              origins: ["manifest.description" as const],
              semanticRole: "description" as const,
              placeholderSignature: "",
            },
          ],
        },
      },
      pluginTranslations: {
        sample: { "zh-CN": {
          pluginId: "sample",
          pluginVersion: "1",
          sourceVersionId: "v",
          targetLocale: "zh-CN",
          entries: [
            { pluginId: "sample", source: "Sample", target: "示例插件" },
            { pluginId: "sample", source: "Sample description", target: "示例说明" },
          ],
          pulledAt: "now",
        } },
      },
    };

    expect(selectApplicablePluginTranslations(state, {
      excludedPluginIds: [],
      pluginMetadataTranslationEnabled: true,
      targetLocale: "zh-CN",
    })).toEqual([
      { pluginId: "sample", source: "Sample", target: "示例插件", scopes: ["metadata"] },
      { pluginId: "sample", source: "Sample description", target: "示例说明", scopes: ["metadata"] },
    ]);
    expect(selectApplicablePluginTranslations(state, {
      excludedPluginIds: [],
      pluginMetadataTranslationEnabled: false,
      targetLocale: "zh-CN",
    })).toEqual([]);
  });

  it("localizes registry display names as manifests register and restores them on disable", () => {
    const manifests: Record<string, { name: string }> = {
      "obsidian-advanced-uri": { name: "Advanced URI" },
      "trans-hub-plugin-localizer": { name: "Trans-Hub Localizer" },
    };
    // Persisted state already carries both dictionaries even though the
    // late-registered manifest only appears on the next pass.
    const state: PluginState = {
      ...displayNameState("obsidian-advanced-uri", "Advanced URI", "高级 URI"),
      pluginCatalogs: {
        ...displayNameState("obsidian-advanced-uri", "Advanced URI", "高级 URI").pluginCatalogs,
        ...displayNameState("better-plugins-manager", "Better Manager", "更好的经理").pluginCatalogs,
      },
      pluginTranslations: {
        ...displayNameState("obsidian-advanced-uri", "Advanced URI", "高级 URI").pluginTranslations,
        ...displayNameState("better-plugins-manager", "Better Manager", "更好的经理").pluginTranslations,
      },
    };
    const app = { plugins: { manifests } } as unknown as App;
    const settings = { ...CONTROLLER_SETTINGS };
    const controller = automationController(app, state, settings);

    controller.applyPluginDisplayNames();
    expect(manifests["obsidian-advanced-uri"]?.name).toBe("高级 URI");
    // The plugin's own manifest name is never rewritten by the controller.
    expect(manifests["trans-hub-plugin-localizer"]?.name).toBe("Trans-Hub Localizer");

    // A community plugin registered after ours is localized on the next pass.
    manifests["better-plugins-manager"] = { name: "Better Manager" };
    controller.applyPluginDisplayNames();
    expect(manifests["better-plugins-manager"]?.name).toBe("更好的经理");

    // Disabling metadata localization restores every official name.
    settings.pluginMetadataTranslationEnabled = false;
    controller.applyPluginDisplayNames();
    expect(manifests["obsidian-advanced-uri"]?.name).toBe("Advanced URI");
    expect(manifests["better-plugins-manager"]?.name).toBe("Better Manager");
  });

  it("rewrites the 1.13 settings window nav titles by plugin id and restores them", () => {
    const manifests: Record<string, { name: string }> = {
      "obsidian-advanced-uri": { name: "Advanced URI" },
      "better-plugins-manager": { name: "Better Manager" },
      "trans-hub-plugin-localizer": { name: "语枢 · 插件本地化" },
    };
    const items = [
      new FakeNavItem("about", "关于"),
      new FakeNavItem("obsidian-advanced-uri", "Advanced URI"),
      new FakeNavItem("better-plugins-manager", "Better Manager"),
      new FakeNavItem("trans-hub-plugin-localizer", "Trans-Hub Localizer"),
    ];
    const app = {
      plugins: { manifests },
      setting: { win: { document: settingsDocument(items) } },
    } as unknown as App;
    let state = displayNameState("obsidian-advanced-uri", "Advanced URI", "高级 URI");
    state = {
      ...state,
      pluginCatalogs: {
        ...state.pluginCatalogs,
        ...displayNameState("better-plugins-manager", "Better Manager", "更好的经理").pluginCatalogs,
      },
      pluginTranslations: {
        ...state.pluginTranslations,
        ...displayNameState("better-plugins-manager", "Better Manager", "更好的经理").pluginTranslations,
      },
    };

    const controller = automationController(app, state);
    controller.localizeSettingsWindowNavigation();
    expect(items[1]?.title.textContent).toBe("高级 URI");
    expect(items[2]?.title.textContent).toBe("更好的经理");
    // The plugin's own nav item follows its (already localized) manifest name.
    expect(items[3]?.title.textContent).toBe("语枢 · 插件本地化");
    // Core settings ids without a manifest entry are untouched.
    expect(items[0]?.title.textContent).toBe("关于");

    // A second pass is idempotent.
    controller.localizeSettingsWindowNavigation();
    expect(items[1]?.title.textContent).toBe("高级 URI");

    // Disabling metadata localization restores the official titles.
    const restoreSettings = { ...CONTROLLER_SETTINGS, pluginMetadataTranslationEnabled: false as const };
    automationController(app, state, restoreSettings).localizeSettingsWindowNavigation();
    expect(items[1]?.title.textContent).toBe("Advanced URI");
    expect(items[2]?.title.textContent).toBe("Better Manager");
    expect(items[3]?.title.textContent).toBe("Trans-Hub Localizer");
  });

  it("restores nav titles that Obsidian rendered from the localized manifest", () => {
    const manifests: Record<string, { name: string }> = {
      "obsidian-advanced-uri": { name: "Advanced URI" },
      "better-plugins-manager": { name: "Better Manager" },
    };
    // Obsidian renders the sidebar after the registry was localized, so the
    // nav items already carry the translated titles and the localize pass
    // must still record the official names for a reversible restore.
    const items = [
      new FakeNavItem("obsidian-advanced-uri", "高级 URI"),
      new FakeNavItem("better-plugins-manager", "更好的经理"),
    ];
    const app = {
      plugins: { manifests },
      setting: { win: { document: settingsDocument(items) } },
    } as unknown as App;
    let state = displayNameState("obsidian-advanced-uri", "Advanced URI", "高级 URI");
    state = {
      ...state,
      pluginCatalogs: {
        ...state.pluginCatalogs,
        ...displayNameState("better-plugins-manager", "Better Manager", "更好的经理").pluginCatalogs,
      },
      pluginTranslations: {
        ...state.pluginTranslations,
        ...displayNameState("better-plugins-manager", "Better Manager", "更好的经理").pluginTranslations,
      },
    };
    const settings = { ...CONTROLLER_SETTINGS };
    const controller = automationController(app, state, settings);

    // Registry manifests are localized first, then the sidebar renders from them.
    controller.applyPluginDisplayNames();
    controller.localizeSettingsWindowNavigation();
    expect(items[0]?.title.textContent).toBe("高级 URI");
    expect(items[0]?.title.getAttribute("data-th-nav-original")).toBe("Advanced URI");

    // Disabling metadata localization restores every official title, even
    // though the nav item never displayed the English title in the DOM.
    settings.pluginMetadataTranslationEnabled = false;
    controller.applyPluginDisplayNames();
    controller.localizeSettingsWindowNavigation();
    expect(items[0]?.title.textContent).toBe("Advanced URI");
    expect(items[1]?.title.textContent).toBe("Better Manager");
    expect(items[0]?.title.getAttribute("data-th-nav-original")).toBeNull();
    expect(manifests["obsidian-advanced-uri"]?.name).toBe("Advanced URI");
  });
});
