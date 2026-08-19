import { describe, expect, it } from "vitest";

import {
  digestPluginBundle,
  normalizePluginBundle,
  normalizePluginBundleV1,
  normalizePluginBundleWithScheme,
  placeholderSignature,
  scanPluginUiStrings,
} from "../src/plugin-string-scanner";

const plugin = {
  id: "sample-plugin",
  name: "Sample Plugin",
  version: "2.1.0",
  description: "Makes sample workflows easier.",
  dir: ".obsidian/plugins/sample-plugin",
  enabled: true,
} as const;

describe("scanPluginUiStrings", () => {
  it("将社区安装器附加的 nosourcemap 尾注排除在制品身份之外", async () => {
    const officialBundle = 'setting.setName("Open settings");';
    const [official, installed] = await Promise.all([
      scanPluginUiStrings({ plugin, sourceLocale: "en", bundle: officialBundle }),
      scanPluginUiStrings({
        plugin,
        sourceLocale: "en",
        bundle: `${officialBundle}\n/* nosourcemap */`,
      }),
    ]);

    expect(installed.artifactDigest).toBe(official.artifactDigest);
    expect(installed.catalogIdentity?.artifactDigest).toBe(official.catalogIdentity?.artifactDigest);
  });

  it("keeps predominantly English metadata containing a non-Latin brand name", async () => {
    const catalog = await scanPluginUiStrings({
      plugin: {
        ...plugin,
        description: "Sync your vault with Nutstore/坚果云 using WebDAV protocol.",
      },
      sourceLocale: "en",
      bundle: 'setting.setName("设置");',
    });

    expect(catalog.strings.map((item) => item.source)).toContain(
      "Sync your vault with Nutstore/坚果云 using WebDAV protocol.",
    );
    expect(catalog.strings.map((item) => item.source)).not.toContain("设置");
  });

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
        'const config = { placeholder: "Search commands", onClick: run, endpoint: "https://example.com/api" };',
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

  it("extracts textContent and innerText DOM text sinks from Svelte-style bundles", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'p1.textContent = "This file will be used as a template when creating new scenes\\n              via the New Scene… field.";',
        'this.stepsSummary.innerText = "No steps loaded.";',
        'refs.tab.innerText = `Loaded ${count} steps`;',
        'config.textContent = "Not a DOM sink" === "no" ? "skipped" : "also skipped";',
        'plainFunction(textContent = "not a member assignment");',
      ].join("\n"),
      now: () => new Date("2026-07-15T00:00:00.000Z"),
    });

    const template = catalog.strings.find((item) =>
      item.source.startsWith("This file will be used as a template"));
    expect(template?.source).toBe(
      "This file will be used as a template when creating new scenes\n              via the New Scene… field.",
    );
    expect(template?.evidence).toEqual([expect.objectContaining({
      origin: "ui-property",
      strategy: "structured",
      symbol: "textContent",
    })]);
    const noSteps = catalog.strings.find((item) => item.source === "No steps loaded.");
    expect(noSteps?.evidence).toEqual([expect.objectContaining({
      origin: "ui-property",
      strategy: "structured",
      symbol: "innerText",
    })]);
    // Dynamic single-line templates keep the stable placeholder like every
    // other proven UI sink; the runtime fills it back with template rules.
    expect(catalog.strings.map((item) => item.source))
      .toContain("Loaded {{th:expr:0}} steps");
    expect(catalog.strings.map((item) => item.source)).not.toContain("skipped");
  });

  it("fails closed for multi-line innerText but keeps multi-line textContent", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'this.area.innerText = "line one\\nline two";',
        'p1.textContent = "line one\\nline two";',
      ].join("\n"),
    });

    const sources = catalog.strings.map((item) => item.source);
    expect(sources).toContain("line one\nline two");
    const innerTextHits = catalog.strings.filter((item) =>
      item.evidence?.some((evidence) => evidence.symbol === "innerText"));
    expect(innerTextHits).toHaveLength(0);
  });

  it("falls back to regexes for textContent and innerText assignments when tokenization fails", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'el.textContent = "Fallback text content";',
        'p1.textContent = "Multi-line description\\n              with indentation.";',
        'el.innerText = "Fallback inner text";',
        'el.innerText = "multi\\nline";',
        "/* damaged trailing comment",
      ].join("\n"),
    });

    const textContent = catalog.strings.find((item) => item.source === "Fallback text content");
    expect(textContent?.evidence).toEqual([expect.objectContaining({
      origin: "ui-property",
      strategy: "regex-fallback",
      symbol: "textContent",
    })]);
    // textContent keeps a single DOM text node, so multi-line values stay
    // eligible even on the regex path; only innerText fails closed on breaks.
    const multiLine = catalog.strings.find((item) =>
      item.source === "Multi-line description\n              with indentation.");
    expect(multiLine?.evidence).toEqual([expect.objectContaining({
      origin: "ui-property",
      strategy: "regex-fallback",
      symbol: "textContent",
    })]);
    const innerText = catalog.strings.find((item) => item.source === "Fallback inner text");
    expect(innerText?.evidence).toEqual([expect.objectContaining({
      origin: "ui-property",
      strategy: "regex-fallback",
      symbol: "innerText",
    })]);
    expect(catalog.strings.map((item) => item.source)).not.toContain("multi\nline");
  });

  it("bumps the patch evidence revision so persisted catalogs rescan with new sinks", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: 'el.textContent = "Fresh sink";',
    });
    expect(catalog.patchEvidenceRevision).toBe(10);
  });

  it("merges a partial embedded locale pack with the hardcoded UI scan", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      targetLocale: "zh-CN",
      bundle: [
        'var en={modalTitle:"Embedded modal"};',
        'var zh={modalTitle:"内嵌模态"};',
        'var de={modalTitle:"Eingebetteter Modus"};',
        "var locales={de:de,en:en,zh:zh};",
        'searchEl.setPlaceholder("Search Style Settings...");',
        'button.setButtonText("Import");',
        'setting.setName("Export settings");',
      ].join("\n"),
    });

    const sources = catalog.strings.map((item) => item.source);
    expect(sources).toContain("Embedded modal");
    expect(sources).toContain("Search Style Settings...");
    expect(sources).toContain("Import");
    expect(sources).toContain("Export settings");
    const embedded = catalog.strings.find((item) => item.source === "Embedded modal");
    expect(embedded?.nativeTargetLocale).toBe("zh-CN");
  });

  it("normalizes the community-installed bundle like the server adapter", async () => {
    const body = "module.exports = BetterWordCount;";
    const sourceMap = `${body}\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==`;
    expect(normalizePluginBundle(sourceMap)).toBe(body);
    expect(normalizePluginBundle(`${sourceMap}\n/* nosourcemap */`)).toBe(body);
    expect(normalizePluginBundle(body)).toBe(body);
    expect(await digestPluginBundle(sourceMap)).toBe(await digestPluginBundle(body));
  });

  it("keeps the legacy bundle-v1 normalization stable for old patch receipts", () => {
    const body = "module.exports = Copilot;\n//# sourceMappingURL=main.js.map";
    const installed = `${body}\n/* nosourcemap */`;
    // bundle-v1 (receipts written before 2026-08-05) only strips the
    // no-sourcemap suffix; the inline source map line and trailing whitespace
    // stay part of the digest.
    expect(normalizePluginBundleV1(installed)).toBe(body);
    expect(normalizePluginBundleV1(installed)).not.toBe(normalizePluginBundle(installed));
    expect(normalizePluginBundleWithScheme("bundle-v1", installed)).toBe(body);
    expect(normalizePluginBundleWithScheme("bundle-v2", installed)).toBe(
      normalizePluginBundle(installed),
    );
  });

  it("extracts Obsidian createEl/createSpan/createDiv text options", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'containerEl.createEl("h4", { text: "Advanced Settings" });',
        'containerEl.createSpan({ text: "Span text", cls: "nav-item" });',
        'containerEl.createDiv({ text: `Dynamic ${value}` });',
        'containerEl.createEl("div", { cls: "x" });',
        'containerEl.createEl("p", { text: config.text });',
      ].join("\n"),
    });

    const advanced = catalog.strings.find((item) => item.source === "Advanced Settings");
    expect(advanced?.evidence).toEqual([expect.objectContaining({
      origin: "ui-property",
      strategy: "structured",
      symbol: "createEl",
    })]);
    expect(advanced?.evidence?.[0]?.literalStart).toBeTypeOf("number");
    expect(catalog.strings.map((item) => item.source)).toContain("Span text");
    expect(catalog.strings.map((item) => item.source)).toContain("Dynamic {{th:expr:0}}");
    expect(catalog.strings.map((item) => item.source)).not.toContain("x");
  });

  it("extracts declarative settings schemas with name and desc pairs", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        "const settings = {",
        '  navigatorEnabled: { name: "Navigator", desc: "The navigator lets you create and organize your spaces" },',
        '  spacesStickers: { name: "Stickers", desc: "Use Emojis to make it easier to find your notes" },',
        '  spacesUseAlias: { name: "Alias", desc: "Use the alias metadata to show in Navigator" },',
        '  indexSVG: { name: "Use SVGs as Stickers", desc: "Use any svg file in your vault as a sticker" },',
        "};",
        "const model = { name: \"Anthropic Claude Opus 4.6\", description: \"Internal model metadata\" };",
        "const grammar = [{ name: \"Attribute\", bnf: [] }];",
      ].join("\n"),
    });

    const sources = catalog.strings.map((item) => item.source);
    expect(sources).toContain("Navigator");
    expect(sources).toContain("The navigator lets you create and organize your spaces");
    expect(sources).toContain("Stickers");
    expect(sources).toContain("Use SVGs as Stickers");
    expect(sources).toContain("Alias");
    expect(sources).not.toContain("Anthropic Claude Opus 4.6");
    expect(sources).not.toContain("Attribute");
    const navigator = catalog.strings.find((item) => item.source === "Navigator");
    expect(navigator?.evidence).toEqual([expect.objectContaining({
      origin: "ui-property",
      strategy: "structured",
      symbol: "settingsSchema",
    })]);
    expect(navigator?.evidence?.[0]?.literalStart).toBeTypeOf("number");
  });

  it("extracts DropdownComponent addOptions labels", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        "dropdown.addOptions({",
        '  never: "Never",',
        '  "bullet-only": "Stick cursor out of bullets",',
        '  "bullet-and-checkbox": "Stick cursor out of bullets and checkboxes",',
        "});",
      ].join("\n"),
    });

    for (const source of ["Never", "Stick cursor out of bullets", "Stick cursor out of bullets and checkboxes"]) {
      const hit = catalog.strings.find((item) => item.source === source);
      expect(hit, source).toBeDefined();
      expect(hit?.evidence?.[0]).toMatchObject({ origin: "ui-property", symbol: "addOptions" });
    }
  });

  it("extracts settings group descriptors with heading and item labels", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        "choicePickerGroup() {",
        "  return {",
        '    type: "group",',
        '    heading: "Choice picker",',
        "    items: [",
        '      { name: "Search nested choices", desc: "Also match choices nested inside folders." },',
        '      { name: "New note from template", desc: "Add a row to Run QuickAdd." },',
        "    ],",
        "  };",
        "}",
        'const model = { type: "group", heading: "Internal model metadata" };',
      ].join("\n"),
    });

    const sources = catalog.strings.map((item) => item.source);
    expect(sources).toContain("Choice picker");
    expect(sources).toContain("Search nested choices");
    expect(sources).toContain("Also match choices nested inside folders.");
    expect(sources).toContain("New note from template");
    // A type+heading object without an items array stays configuration.
    expect(sources).not.toContain("Internal model metadata");
  });

  it("extracts grouped UI copy dictionaries while rejecting flat lookup tables", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'var wfe={hintText:{fileName:"Enter File Name",alias:"Enter Display Name"},',
        'timeUnits:{hour:"Hour",day:"Day",week:"Week",month:"Month"},',
        'aggregates:{values:"Values",sum:"Sum",average:"Average",median:"Median"},',
        'fieldTypes:{object:"Object",text:"Text",file:"File",date:"Date"},',
        'commands:{open:"Open",close:"Close",save:"Save",run:"Run",export:"Export",move:"Move",delete:"Delete",edit:"Edit",copy:"Copy",paste:"Paste"},',
        'views:{table:"Table",card:"Card",board:"Board",list:"List",flow:"Flow",gallery:"Gallery",calendar:"Calendar",catalog:"Catalog",details:"Details",grid:"Grid"}};',
        'var keyCodes={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt"};',
        'var emoji={a:"grinning face",b:"smiling face with open mouth",c:"winking face",d:"heart eyes",e:"star struck",f:"face with tears of joy",g:"thinking face",h:"zipper mouth face",i:"money mouth face",j:"hugging face",k:"smirking face",l:"unamused face"};',
        'var easing={a:"easeInQuad",b:"easeOutQuad",c:"easeInOutQuad",d:"easeInCubic",e:"easeOutCubic",f:"easeInOutCubic",g:"easeInQuart",h:"easeOutQuart",i:"easeInOutQuart",j:"easeInSine",k:"easeOutSine",l:"easeInOutSine"};',
      ].join("\n"),
      targetLocale: "zh-CN",
    });
    const sources = new Set(catalog.strings.map((string) => string.source));
    expect(sources).toContain("Enter File Name");
    expect(sources).toContain("Values");
    expect(sources).toContain("Average");
    expect(sources).toContain("Object");
    expect(sources).toContain("Gallery");
    // Flat key-name / emoji-descriptor / easing-function tables are data,
    // not UI copy, and must stay out of the catalog.
    expect(sources).not.toContain("Backspace");
    expect(sources).not.toContain("grinning face");
    expect(sources).not.toContain("easeInQuad");
  });

  it("rejects objects without enough grouped title-case UI text", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        // Fewer than three groups.
        'var a={one:{x:"Alpha",y:"Beta"},two:{x:"Gamma",y:"Delta"}};',
        // Groups exist but most values are lowercase identifiers.
        'var b={g1:{x:"alpha",y:"beta",z:"gamma",w:"delta"},',
        'g2:{x:"epsilon",y:"zeta",z:"eta",w:"theta"},',
        'g3:{x:"iota",y:"kappa",z:"lambda",w:"mu"},',
        'g4:{x:"nu",y:"xi",z:"omicron",w:"pi"}};',
      ].join("\n"),
      targetLocale: "zh-CN",
    });
    const sources = new Set(catalog.strings.map((string) => string.source));
    expect(sources).not.toContain("Alpha");
    expect(sources).not.toContain("epsilon");
  });

  it("keeps only the English settings schema when a plugin ships one per language", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        "const en = { items: {",
        "listPaneTitle:{name:\"List pane title\",desc:\"Choose where the list pane title is shown.\"},",
        "defaultSort:{name:\"Default sort order\",desc:\"Choose the default sort order for notes.\"},",
        "grouping:{name:\"Grouping properties\",desc:\"Comma-separated properties that group the list.\"},",
        "icons:{name:\"Icons\",desc:\"Show file icons next to note titles.\"},",
        "preview:{name:\"Preview text\",desc:\"Render preview text for each note.\"},",
        "}};",
        "const de = { items: {",
        "listPaneTitle:{name:\"Titel des Listenbereichs\",desc:\"Wählen Sie aus, wo der Titel des Listenbereichs angezeigt wird.\"},",
        "defaultSort:{name:\"Standard-Sortierreihenfolge\",desc:\"Wählen Sie die Standardsortierung für Notizen aus.\"},",
        "grouping:{name:\"Gruppierungseigenschaften\",desc:\"Durch Kommas getrennte Eigenschaften zum Gruppieren.\"},",
        "icons:{name:\"Symbole\",desc:\"Dateisymbole neben Notiztiteln anzeigen.\"},",
        "preview:{name:\"Vorschautext\",desc:\"Vorschautext für jede Notiz rendern.\"},",
        "}};",
      ].join("\n"),
      targetLocale: "zh-CN",
    });
    const sources = new Set(catalog.strings.map((string) => string.source));
    expect(sources).toContain("List pane title");
    expect(sources).toContain("Choose where the list pane title is shown.");
    expect(sources).not.toContain("Titel des Listenbereichs");
    expect(sources).not.toContain("Standard-Sortierreihenfolge");
  });

  it("falls back to regexes for addOptions labels when tokenization fails", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'dropdown.addOptions({ never: "Never", light: "Light theme" });',
        "/* damaged trailing comment",
      ].join("\n"),
    });

    const never = catalog.strings.find((item) => item.source === "Never");
    expect(never?.evidence).toEqual([expect.objectContaining({
      origin: "ui-property",
      strategy: "regex-fallback",
      symbol: "addOptions",
    })]);
    expect(catalog.strings.map((item) => item.source)).toContain("Light theme");
  });

  it("keeps structured parsing when identifiers shadow Object.prototype members", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        "const toString = Object.prototype.hasOwnProperty;",
        'const constructor = { valueOf: 1, toString: 2 };',
        'plugin.addCommand({ id: "transpose", name: "Transpose", editorCheckCallback: run });',
        'setting.setName("Open settings");',
      ].join("\n"),
    });

    const transpose = catalog.strings.find((item) => item.source === "Transpose");
    expect(transpose?.evidence).toEqual([expect.objectContaining({
      origin: "ui-property",
      strategy: "structured",
      symbol: "name",
    })]);
    expect(catalog.strings.find((item) => item.source === "Open settings")?.evidence)
      .toEqual([expect.objectContaining({ strategy: "structured" })]);
  });

  it("extracts static innerHTML text without patchable markup spans", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'button0.innerHTML = `<div class="icon">Add Item</div>`;',
        'button1.innerHTML = "<span>Reset</span>";',
        'area.innerHTML = `<div>Hello ${name}</div>`;',
      ].join("\n"),
    });

    const addItem = catalog.strings.find((item) => item.source === "Add Item");
    expect(addItem?.evidence).toEqual([expect.objectContaining({
      origin: "ui-property",
      strategy: "structured",
      symbol: "innerHTML",
    })]);
    expect(addItem?.evidence?.[0]?.literalStart).toBeUndefined();
    expect(catalog.strings.map((item) => item.source)).toContain("Reset");
    expect(catalog.strings.map((item) => item.source))
      .not.toContain("Hello {{th:expr:0}}");
  });

  it("falls back to regexes for createEl text and innerHTML when tokenization fails", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'containerEl.createEl("h4", { text: "Fallback heading" });',
        'button0.innerHTML = `<div>Fallback item</div>`;',
        "/* damaged trailing comment",
      ].join("\n"),
    });

    const heading = catalog.strings.find((item) => item.source === "Fallback heading");
    expect(heading?.evidence).toEqual([expect.objectContaining({
      origin: "ui-property",
      strategy: "regex-fallback",
      symbol: "createEl",
    })]);
    const item = catalog.strings.find((src) => src.source === "Fallback item");
    expect(item?.evidence).toEqual([expect.objectContaining({
      origin: "ui-property",
      strategy: "regex-fallback",
      symbol: "innerHTML",
    })]);
    expect(item?.evidence?.[0]?.literalStart).toBeUndefined();
  });

  it("rejects unproven object properties unless an enclosing UI registration proves presentation", async () => {
    const falsePositives = [
      "Attribute", "AttributeValue", "Attributes", "CharClass", "CharCode", "CharCodeRange",
      "CharRange", "Comment", "Link", "PrimaryPreDecoration", "RULE_Char", "Url", "wrapper",
    ];
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        `const grammar = [${falsePositives.map((value) => `{name:"${value}",bnf:[]}`).join(",")}];`,
        'const wrapper = { name: "wrapper", func: execute };',
        'const model = { name: "Anthropic Claude Opus 4.6", description: "Internal model metadata" };',
        'plugin.addCommand({ id: "transpose", name: "Transpose", editorCheckCallback: run });',
      ].join("\n"),
    });

    const sources = catalog.strings.map((item) => item.source);
    expect(sources).toContain("Transpose");
    expect(sources).not.toContain("Anthropic Claude Opus 4.6");
    expect(sources).not.toContain("Internal model metadata");
    expect(sources).not.toEqual(expect.arrayContaining(falsePositives));
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
        placeholderSignature: '["{{th:expr:0}}","{{th:expr:1}}"]',
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
        'const worker = { name: "Dataview Indexer " + (index + 1), callback: run };',
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
    expect(dynamic?.placeholderSignature).toBe('["{{th:expr:0}}","{{th:expr:1}}"]');
    expect(dynamic?.evidence).toEqual([expect.objectContaining({
      origin: "ui-call",
      strategy: "structured",
      symbol: "setDesc",
      line: 2,
    })]);
  });

  it("extracts visible React createElement text from safe native DOM elements in large bundles", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: `${" ".repeat(1_048_577)}${[
        'React.createElement("span", null, "Copilot Settings");',
        'React.createElement("div", { title: "Open settings", "aria-label": `Model ${model.name}` }, `Copilot Plus for ${planName}`);',
        'React.createElement("input", { placeholder: "Ask " + workspaceName });',
      ].join("\n")}`,
    });

    const sources = catalog.strings.map((item) => item.source);
    expect(sources).toEqual(expect.arrayContaining([
      "Copilot Settings",
      "Open settings",
      "Model {{th:expr:0}}",
      "Copilot Plus for {{th:expr:0}}",
      "Ask {{th:expr:0}}",
    ]));
    const settingsSpan = catalog.strings
      .find((item) => item.source === "Copilot Settings")
      ?.evidence?.[0];
    if (settingsSpan === undefined) throw new Error("missing createElement evidence");
    expect(settingsSpan).toEqual(expect.objectContaining({
      origin: "ui-call",
      strategy: "structured",
      symbol: "createElement",
      line: 1,
    }));
    expect(settingsSpan.literalStart).toBeGreaterThan(1_048_577);
    expect(settingsSpan.literalEnd).toBe((settingsSpan.literalStart ?? 0) + "Copilot Settings".length + 2);
  });

  it("records exact literal spans for default-interop React regex fallback", async () => {
    const bundle = [
      'factory.default.createElement("span", null, "Copilot Settings");',
      'factory.default.createElement("span", null, `Copilot ${mode}`);',
    ].join("\n");
    const catalog = await scanPluginUiStrings({ plugin, sourceLocale: "en", bundle });
    const settings = catalog.strings.find((item) => item.source === "Copilot Settings");
    const settingsEvidence = settings?.evidence?.[0];
    if (settingsEvidence === undefined) throw new Error("missing Copilot Settings evidence");
    expect(settingsEvidence.origin).toBe("ui-call");
    expect(["structured", "regex-fallback"]).toContain(settingsEvidence.strategy);
    expect(settingsEvidence.symbol).toBe("createElement");
    expect(settingsEvidence.literalStart).toBe(bundle.indexOf("Copilot Settings") - 1);
    expect(settingsEvidence.literalEnd).toBe(bundle.indexOf("Copilot Settings") + "Copilot Settings".length + 1);
    const template = catalog.strings.find((item) => item.source.startsWith("Copilot {{th:expr:0}}"));
    expect(template?.evidence?.some((entry) => entry.literalStart !== undefined)).toBe(false);
  });

  it("scans nested arguments beyond the JavaScript spread-argument limit", async () => {
    const denseArgument = `[${"value,".repeat(65_000)}]`;
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        `React.createElement("div", null, ${denseArgument});`,
        'React.createElement("span", null, "After dense argument");',
      ].join("\n"),
    });

    expect(catalog.strings.map((item) => item.source)).toContain("After dense argument");
  });

  it("collects React component children while rejecting unsafe DOM contexts and arbitrary factories", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'React.createElement(SettingsPanel, { title: "Component title", onClick: run }, "Component child");',
        'React.createElement("custom-panel", null, "Custom element child");',
        'React.createElement("script", null, "Executable payload");',
        'React.createElement("style", null, "Stylesheet payload");',
        'React.createElement("span", { title: getTitle(), label: "Non-DOM label", onClick: run, href: "https://example.com" }, `Unsafe ${loadLabel()}`);',
        'React.createElement("span", null, "https://example.com/docs");',
        'factory.createElement("span", {title: "Factory title"}, "Factory child");',
      ].join("\n"),
    });

    const sources = catalog.strings.map((item) => item.source);
    expect(sources).toEqual(expect.arrayContaining(["Component title", "Component child"]));
    for (const rejected of [
      "Custom element child",
      "Executable payload",
      "Stylesheet payload",
      "Non-DOM label",
      "Unsafe {{th:expr:0}}",
      "https://example.com",
      "https://example.com/docs",
      "Factory title",
      "Factory child",
    ]) expect(sources).not.toContain(rejected);
  });

  it("collects default-interop React calls and a transparent setting wrapper", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'setting.setDesc(Yt("Wrapped setting description"));',
        'Sr.default.createElement("span", null, "Aliased React label");',
        'Ns.default.createElement(ActionButton, {placeholder: "Aliased component placeholder"}, "Aliased component child");',
        'factory.createElement("span", null, "Unproven factory child");',
      ].join("\n"),
    });

    expect(catalog.strings.map((item) => item.source)).toEqual(expect.arrayContaining([
      "Wrapped setting description",
      "Aliased React label",
      "Aliased component placeholder",
      "Aliased component child",
    ]));
    expect(catalog.strings.map((item) => item.source)).not.toContain("Unproven factory child");
  });

  it("keeps default-interop React labels when a damaged bundle requires regex fallback", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: '} Sr.default.createElement("span", null, "Fallback React label");',
    });

    expect(catalog.strings.map((item) => item.source)).toContain("Fallback React label");
  });

  it("excludes language-neutral JSON literals but preserves JSON with natural-language values", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'setting.setDesc(\'{"kind":"panel","actions":["open","sync"]}\');',
        'setting.setPlaceholder(`{\\n  "folderSortOrder": "alpha-desc"\\n}`);',
        'setting.setDesc(\'{"title":"Sync your vault","actions":["open","sync"]}\');',
        'setting.setDesc(\'{"title":"Settings"}\');',
        'setting.setDesc(\'{"summary":"Settings"}\');',
      ].join("\n"),
    });

    const sources = catalog.strings.map((item) => item.source);
    expect(sources).not.toContain('{"kind":"panel","actions":["open","sync"]}');
    expect(sources).not.toContain('{\n  "folderSortOrder": "alpha-desc"\n}');
    expect(sources).toContain('{"title":"Sync your vault","actions":["open","sync"]}');
    expect(sources).toContain('{"title":"Settings"}');
    expect(sources).toContain('{"summary":"Settings"}');
  });

  it("uses the English source catalog from a minified locale registry", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        'var en={rules:{name:"Try to escape arrays",description:"Array starts with [ and ends with ]."}};',
        'var es={rules:{name:"Intente escapar matrices",description:"La matriz comienza con [ y termina con ]."}};',
        'var de={rules:{name:"Arrays maskieren",description:"Ein Array beginnt mit [ und endet mit ]."}};',
        'var locales={de:de,en:en,es:es};',
        'const unrelated={name:"Internal worker",description:"Debug only"};',
      ].join(""),
    });

    expect(catalog.strings.map((item) => item.source)).toEqual(expect.arrayContaining([
      "Try to escape arrays",
      "Array starts with [ and ends with ].",
    ]));
    expect(catalog.strings.map((item) => item.source)).not.toEqual(expect.arrayContaining([
      "Intente escapar matrices",
      "Arrays maskieren",
      "Internal worker",
    ]));
  });

  it("prefers the generic locale registry over STRINGS_* export aliases", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      targetLocale: "zh-CN",
      bundle: [
        'var genericEn={title:"Generic source"};',
        'var genericZh={title:"通用译文"};',
        'var genericDe={title:"Generische Quelle"};',
        "var locales={de:genericDe,en:genericEn,'zh-CN':genericZh};",
        'var exportedEn={title:"Fallback source"};',
        'var exportedZh={title:"回退译文"};',
        "var localeExports={};register(localeExports,{STRINGS_EN:()=>exportedEn,STRINGS_ZH_CN:()=>exportedZh});",
      ].join(""),
    });

    expect(catalog.strings.find((item) => item.source === "Generic source")).toMatchObject({
      nativeTarget: "通用译文",
      nativeTargetLocale: "zh-CN",
    });
    expect(catalog.strings.map((item) => item.source)).not.toContain("Fallback source");
  });

  it("fails closed for untranslated and conflicting native targets", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      targetLocale: "zh-CN",
      bundle: [
        'var en={first:"Save",second:"Save",identity:"Open"};',
        'var zh={first:"保存",second:"储存",identity:"Open"};',
        'var de={first:"Speichern",second:"Speichern",identity:"Offnen"};',
        "var locales={de:de,en:en,'zh-CN':zh};",
      ].join(""),
    });

    expect(catalog.strings.find((item) => item.source === "Save")).not.toHaveProperty("nativeTarget");
    expect(catalog.strings.find((item) => item.source === "Open")).not.toHaveProperty("nativeTarget");
  });

  it("rejects an embedded locale catalog above the Adapter 10,000-entry limit", async () => {
    const oversized = Array.from({ length: 10_001 }, (_, index) => `k${index}:"Message ${index}"`).join(",");
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        `var exportedEn={${oversized}};`,
        "var localeExports={};register(localeExports,{STRINGS_EN:()=>exportedEn});",
        'setting.setName("Fallback setting");',
      ].join(""),
    });

    expect(catalog.strings.map((item) => item.source)).toContain("Fallback setting");
    expect(catalog.strings.map((item) => item.source)).not.toContain("Message 0");
  });

  it("maps a compressed embedded zh-CN language pack back to exact English source keys", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      targetLocale: "zh-CN",
      bundle: [
        'var en={toolbar:{save:"Save",dynamic:"Hello "+name}};',
        'var es={toolbar:{save:"Guardar",dynamic:"Hola "+name}};',
        'var de={toolbar:{save:"Speichern",dynamic:"Hallo "+name}};',
        'var PLUGIN_LANGUAGES={"zh-cn":"eJyrsK0uyc/PSUossqouTixLtVJ6sn/u07UzlHRSKvMSczOTgQJ7FzxduldBSRvIT62ttQYAS0MWqA=="};',
      ].join(""),
    });

    expect(catalog.strings.find((item) => item.source === "Save")).toMatchObject({
      nativeTarget: "保存",
      nativeTargetLocale: "zh-CN",
    });
    expect(catalog.strings.find((item) => item.source === "Hello {{th:expr:0}}")).toMatchObject({
      nativeTarget: "你好 {{th:expr:0}}",
      nativeTargetLocale: "zh-CN",
    });
  });

  it("handles regex literals before a minified locale registry", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: [
        "var probe=/['\\\"]/;",
        'var en={title:"English title"};',
        'var es={title:"Titulo espanol"};',
        'var de={title:"Deutscher Titel"};',
        "var locales={de:de,en:en,es:es};",
      ].join(""),
    });

    expect(catalog.strings.map((item) => item.source)).toContain("English title");
    expect(catalog.strings.map((item) => item.source)).not.toContain("Titulo espanol");
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

  it("keeps static text from dynamic templates when regex fallback is required", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: 'setting.setName(`PDFs content indexing ${enabled ? "" : "⚠️ Disabled"}`); /* damaged trailing comment',
    });

    expect(catalog.strings.map((item) => item.source)).toContain(
      "PDFs content indexing {{th:expr:0}}",
    );
  });

  it("scans normal UI calls in bundles larger than the React-only threshold", async () => {
    const catalog = await scanPluginUiStrings({
      plugin,
      sourceLocale: "en",
      bundle: `${" ".repeat(1_048_577)}plugin.addCommand({name:"Transpose",editorCheckCallback:run});`,
    });

    expect(catalog.strings.map((item) => item.source)).toContain("Transpose");
  });

  it("does not mistake pseudo-widget diagnostics for HTML placeholders", () => {
    expect(placeholderSignature("<unknown widget '{{th:expr:0}}>'"))
      .toBe("{{th:expr:0}}");
    expect(placeholderSignature('<strong class="name">Value</strong>'))
      .toBe('["<strong class=\\"name\\">","</strong>"]');
  });
});
