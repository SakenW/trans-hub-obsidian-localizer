import { describe, expect, it } from "vitest";

import { prepareUntranslatedFeedback } from "../src/untranslated-feedback";

const catalog = {
  pluginId: "dataview",
  pluginName: "Dataview",
  pluginVersion: "0.5.68",
  sourceLocale: "en",
  digest: "catalog",
  artifactDigest: "artifact",
  scannedAt: "2026-07-18T00:00:00Z",
  strings: [
    { key: "one", source: "Settings", origins: ["ui-call"], placeholderSignature: "" },
    { key: "two", source: "app://internal", origins: ["ui-property"], placeholderSignature: "" },
  ],
} as const;

describe("prepareUntranslatedFeedback", () => {
  it("只准备已扫描的安全 UI 文案，不携带路径、插件包或网络副作用", () => {
    expect(prepareUntranslatedFeedback({
      catalog,
      targetLocale: "zh-CN",
      untranslatedSources: [" Settings ", "app://internal", "A newly missed label"],
    })).toEqual({
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      items: [
        { stringKey: "one", source: "Settings", origins: ["ui-call"] },
        { source: "A newly missed label", origins: [] },
      ],
    });
  });
});
