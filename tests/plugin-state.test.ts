import { describe, expect, it } from "vitest";

import { parsePluginState } from "../src/plugin-state";

describe("parsePluginState", () => {
  it("preserves valid extraction evidence across plugin reloads", () => {
    const state = parsePluginState({
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview",
          pluginName: "Dataview",
          pluginVersion: "0.5.68",
          sourceLocale: "en",
          digest: "catalog",
          artifactDigest: "artifact",
          scannedAt: "2026-07-18T00:00:00.000Z",
          strings: [{
            key: "row-count",
            source: "Rows: {{th:expr:0}}",
            origins: ["ui-call"],
            placeholderSignature: "{{th:expr:0}}",
            evidence: [{
              origin: "ui-call",
              strategy: "structured",
              symbol: "setDesc",
              offset: 24,
              line: 2,
              column: 8,
            }],
          }],
        },
      },
    });

    expect(state.pluginCatalogs.dataview?.strings[0]?.evidence).toEqual([{
      origin: "ui-call",
      strategy: "structured",
      symbol: "setDesc",
      offset: 24,
      line: 2,
      column: 8,
    }]);
  });

  it("rejects a catalog with malformed extraction evidence", () => {
    const state = parsePluginState({
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview",
          pluginName: "Dataview",
          pluginVersion: "0.5.68",
          sourceLocale: "en",
          digest: "catalog",
          artifactDigest: "artifact",
          scannedAt: "2026-07-18T00:00:00.000Z",
          strings: [{
            key: "settings",
            source: "Settings",
            origins: ["ui-call"],
            placeholderSignature: "",
            evidence: [{
              origin: "ui-call",
              strategy: "eval",
              symbol: "setName",
              offset: 1,
              line: 1,
              column: 1,
            }],
          }],
        },
      },
    });

    expect(state.pluginCatalogs).toEqual({});
  });

  it("保留官方社区目录元数据证据", () => {
    const state = parsePluginState({
      pluginCatalogs: {
        dataview: {
          pluginId: "dataview",
          pluginName: "Dataview",
          pluginVersion: "0.5.68",
          sourceLocale: "en",
          digest: "catalog",
          artifactDigest: "artifact",
          scannedAt: "2026-07-19T00:00:00.000Z",
          strings: [{
            key: "registry-description",
            source: "Run advanced queries over your vault.",
            origins: ["registry.description"],
            semanticRole: "description",
            placeholderSignature: "",
            evidence: [{
              origin: "registry.description",
              strategy: "registry",
              symbol: "community-plugins.description",
              offset: null,
              line: null,
              column: null,
            }],
          }],
        },
      },
    });

    expect(state.pluginCatalogs.dataview?.strings[0]?.origins)
      .toEqual(["registry.description"]);
  });
});
