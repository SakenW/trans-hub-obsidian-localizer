import { describe, expect, it } from "vitest";

import { placeholderSignature, scanPluginUiStrings } from "../src/plugin-string-scanner";

const plugin = {
  id: "sample-plugin",
  name: "Sample Plugin",
  version: "2.1.0",
  description: "Makes sample workflows easier.",
  dir: ".obsidian/plugins/sample-plugin",
  enabled: true,
} as const;

describe("scanPluginUiStrings", () => {
  it("extracts conservative static UI literals and deduplicates them", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'setting.setName("Open settings");',
        "setting.setDesc('Open settings');",
        'button.setButtonText("Run translation");',
        'setting.setName("设置");',
        'setting.setName("日本語");',
        'setting.setName("Настройки");',
        "new Notice(`Finished successfully`);",
        "const dynamic = `Hello ${name}`;",
        'const config = { placeholder: "Search commands", endpoint: "https://example.com/api" };',
        'const css = { class: ".workspace-leaf" };',
        'const grammar = { name: "%_Choice_1" };',
      ].join("\n"),
      now: () => new Date("2026-07-15T00:00:00.000Z"),
    });

    expect(catalog.strings.map((item) => item.source)).toEqual(expect.arrayContaining([
      "Sample Plugin",
      "Makes sample workflows easier.",
      "Open settings",
      "Run translation",
      "Finished successfully",
      "Search commands",
    ]));
    expect(catalog.strings.filter((item) => item.source === "Open settings")).toHaveLength(1);
    expect(catalog.strings.find((item) => item.source === "Sample Plugin")?.semanticRole)
      .toBe("official-name");
    expect(catalog.strings.find((item) => item.source === "Makes sample workflows easier.")?.semanticRole)
      .toBe("description");
    expect(catalog.strings.find((item) => item.source === "Open settings")?.semanticRole)
      .toBe("runtime-ui");
    expect(catalog.strings.map((item) => item.source)).not.toContain("https://example.com/api");
    expect(catalog.strings.map((item) => item.source)).not.toContain("%_Choice_1");
    expect(catalog.strings.map((item) => item.source)).not.toContain("Hello ${name}");
    expect(catalog.strings.map((item) => item.source)).not.toContain("设置");
    expect(catalog.strings.map((item) => item.source)).not.toContain("日本語");
    expect(catalog.strings.map((item) => item.source)).not.toContain("Настройки");
    expect(catalog.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(catalog.scannedAt).toBe("2026-07-15T00:00:00.000Z");
  });

  it("把官方社区目录说明与安装包说明同时纳入可翻译目录", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: "",
      registryMetadata: {
        name: "Sample Plugin",
        description: "Discover and run sample workflows.",
      },
    });

    expect(catalog.strings.find((item) => item.source === "Sample Plugin")?.origins)
      .toEqual(["manifest.name", "registry.name"]);
    expect(catalog.strings.find((item) => item.source === "Discover and run sample workflows."))
      .toEqual(expect.objectContaining({
        origins: ["registry.description"],
        semanticRole: "description",
        evidence: [expect.objectContaining({ strategy: "registry" })],
      }));
  });

  it("把官方版本 README 的可见正文纳入独立语义角色", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      bundle: "",
      sourceLocale: "en",
      readmeMarkdown: [
        "# Sample plugin",
        "",
        "Read the [documentation](https://example.com) before using `query`.",
        "",
        "```js",
        "const hidden = true;",
        "```",
      ].join("\n"),
    });

    expect(catalog.strings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "Sample plugin",
        origins: ["readme"],
        semanticRole: "readme",
      }),
      expect.objectContaining({
        source: "Read the {{th:expr:0}} before using {{th:expr:1}}.",
        origins: ["readme"],
        semanticRole: "readme",
        placeholderSignature: "{{th:expr:0}}\u0000{{th:expr:1}}",
      }),
    ]));
    expect(catalog.strings.some((item) => item.source.includes("hidden"))).toBe(false);
  });

  it("folds static concatenation and preserves dynamic setDesc expressions as stable placeholders", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'setting.setName("Open " + "Dataview settings");',
        'setting.setDesc("Rows: " + pageCount + " · fields: " + fieldCount);',
        'setting.setDesc(`Indexed ${pageCount} pages`);',
        'const worker = { name: "Dataview Indexer " + (index + 1) };',
        'const cache = { name: "dataview/cache/" + appId };',
        'setting.setDesc(description);',
      ].join("\n"),
    });

    expect(catalog.strings.map((item) => item.source)).toEqual(expect.arrayContaining([
      "Open Dataview settings",
      "Rows: {{th:expr:0}} · fields: {{th:expr:1}}",
      "Indexed {{th:expr:0}} pages",
      "Dataview Indexer {{th:expr:0}}",
    ]));
    expect(catalog.strings.map((item) => item.source)).not.toContain("{{th:expr:0}}");
    expect(catalog.strings.map((item) => item.source)).not.toContain("dataview/cache/{{th:expr:0}}");

    const dynamic = catalog.strings.find((item) => item.source.startsWith("Rows:"));
    expect(dynamic?.placeholderSignature).toBe("{{th:expr:0}}\u0000{{th:expr:1}}");
    expect(dynamic?.evidence).toEqual([expect.objectContaining({
      origin: "ui-call",
      strategy: "structured",
      symbol: "setDesc",
      line: 2,
    })]);
  });

  it("falls back to conservative literal regexes when structured tokenization fails", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: 'setting.setDesc("Fallback description"); /* damaged trailing comment',
    });

    const fallback = catalog.strings.find((item) => item.source === "Fallback description");
    expect(fallback?.evidence).toEqual([expect.objectContaining({
      origin: "ui-call",
      strategy: "regex-fallback",
    })]);
  });

  it("does not mistake pseudo-widget diagnostics for HTML placeholders", () => {
    expect(placeholderSignature("<unknown widget '{{th:expr:0}}>'"))
      .toBe("{{th:expr:0}}");
    expect(placeholderSignature('<strong class="name">Value</strong>'))
      .toBe('<strong class="name">\u0000</strong>');
  });
});
