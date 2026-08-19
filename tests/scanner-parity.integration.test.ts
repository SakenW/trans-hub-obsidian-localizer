import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  resolvePluginStringScopes,
  scanPluginUiStrings,
  type PluginUiCatalog,
} from "../src/plugin-string-scanner";

const ADAPTER_PATH = fileURLToPath(new URL("../adapter/adapter_worker.py", import.meta.url));
const ADVANCED_TABLES_FIXTURE = process.env.OBSIDIAN_ADVANCED_TABLES_FIXTURE;
const ADVANCED_TABLES_BUNDLE_DIGEST = "fbbbfb8c70f57d5c7fc8535c8b01c896389b54ebedab636cf6f6acf1554f471c";
const ADVANCED_TABLES_MANIFEST_DIGEST = "698b4f77445e07d887f33450eaf533a28e099b7b483f642fa883362ffbd8ffe9";
const ADVANCED_TABLES_README_DIGEST = "326c3d027d2f36639fd4f675a66f22e57bc55f7ebadbdfe7f9561d3f7a5bb09a";
const ADVANCED_URI_FIXTURE = process.env.OBSIDIAN_ADVANCED_URI_FIXTURE;
const ADVANCED_URI_BUNDLE_DIGEST = "4281675a5c562362d827bf330f7af7d928276151714ae9ede18cf12d70556faf";
const ADVANCED_URI_MANIFEST_DIGEST = "0f3d3bbffac719288ceb446e0e40b9e0ecf3859b9a4a96106d72ef6ed86acc6f";
const ADVANCED_URI_REGISTRY_DESCRIPTION = "Control everything with URI.";
const BETTER_MANAGER_FIXTURE = process.env.OBSIDIAN_BETTER_MANAGER_FIXTURE;
const BETTER_MANAGER_BUNDLE_DIGEST = "84c74dca1c8bafa0459186ebead3618ddd63a2aa7d6669f514aa000036d67888";
const BETTER_MANAGER_MANIFEST_DIGEST = "05a3b2d2ea90a8b64fc729dae09fea5d2dd4092593c81affadbee6cab8e391e3";
const BETTER_MANAGER_README_DIGEST = "634dd277c5ca7adf2a92177e791f052329ed9cf519ee86000048c1b9d0a3f13d";
const BETTER_MANAGER_ENGLISH_LOCALE_DIGEST = "bf5430df677c3fc9c5a927ea32fd23c1e3fd3fa6f21e3aafa41834f587c72eee";
const BETTER_MANAGER_SPANISH_LOCALE_DIGEST = "390b954acce97fd163f3dfe4e1939921b7a0a200579b0834d966caf961438a5e";
const BETTER_MANAGER_FRENCH_LOCALE_DIGEST = "db661ad0f6e4151b4d4a2992df0f820a605623cb363cadff98f656310ee1969c";
const BETTER_MANAGER_JAPANESE_LOCALE_DIGEST = "43ac97dedc745fe71f833113b40000593c782e4f323f688da339cc26b9087695";
const BETTER_MANAGER_KOREAN_LOCALE_DIGEST = "688f2f536d43fc8e4162a6a0777a53bb58b143606b573009e1b45e2b248eb144";
const BETTER_MANAGER_RUSSIAN_LOCALE_DIGEST = "74a2f829b53bd6a1c1bdc6d320627e44533a16a10fc458e0b7cc040b19dadb4b";
const BETTER_MANAGER_CHINESE_LOCALE_DIGEST = "943bcc371155b971b93e22fa5dcd7b60545b18d831aa2b9b8ba525255fecc561";
const ADVANCED_TABLES_FALSE_POSITIVES = [
  "Attribute", "AttributeValue", "Attributes", "CharClass", "CharCode", "CharCodeRange",
  "CharRange", "Comment", "Link", "PrimaryPreDecoration", "RULE_Char", "Url", "wrapper",
] as const;

function nestedReactTree(depth: number): string {
  let expression = '"Deep leaf text"';
  for (let current = depth; current >= 1; current -= 1) {
    expression = `React.createElement("div",{title:"Depth ${current}"},${expression})`;
  }
  return expression;
}

const PYTHON_SNAPSHOT = String.raw`
import importlib.util, json, pathlib, sys
adapter_path, manifest_path, bundle_path, readme_path = map(pathlib.Path, sys.argv[1:5])
spec = importlib.util.spec_from_file_location("trans_hub_obsidian_adapter", adapter_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
readme = readme_path.read_bytes() if readme_path.is_file() else None
locale_components = None
if len(sys.argv) == 6:
    locale_root = pathlib.Path(sys.argv[5])
    locale_components = {
        locale: [("official", filename, (locale_root / filename).read_bytes())]
        for locale, filename in {
            "en": "en.ts", "es": "es.ts", "fr": "fr.ts", "ja": "ja.ts",
            "ko": "ko.ts", "ru": "ru.ts", "zh": "zh_cn.ts",
        }.items()
        if (locale_root / filename).is_file()
    }
sys.stdout.buffer.write(module.build_snapshot(
    manifest_path.read_bytes(), bundle_path.read_bytes(), readme_content=readme,
    native_locale_components=locale_components,
))
`;

describe.skipIf(!existsSync(ADAPTER_PATH))(
  "Obsidian client and authority adapter scanner parity",
  () => {
  it("keeps both scanners aligned on UI registration context", async () => {
    const root = await mkdtemp(join(tmpdir(), "trans-hub-obsidian-parity-"));
    try {
      const manifestPath = join(root, "manifest.json");
      const bundlePath = join(root, "main.js");
      const readmePath = join(root, "README.md");
      await writeFile(manifestPath, JSON.stringify({
        id: "sample-plugin",
        name: "Sample Plugin",
        version: "1.0.0",
        description: "Makes sample workflows easier.",
      }));
      await writeFile(bundlePath, [
        'setting.setName("Open settings");',
        'setting.setDesc(`Rows: ${pageCount}`);',
        'setting.setDesc(\'{"kind":"panel","actions":["open","sync"]}\');',
        'setting.setDesc(\'{"title":"Sync your vault","actions":["open","sync"]}\');',
        'setting.setDesc(\'{"title":"Settings"}\');',
        'setting.setDesc(\'{"summary":"Settings"}\');',
        'React.createElement("span", null, "Copilot Settings");',
        'React.createElement("input", {placeholder: "Enter your license key"});',
        'React.createElement("span", null, user.name);',
        'React.createElement("input", {title: model.name});',
        'React.createElement(SettingsPanel, {title: "Component title"}, "Component child");',
        'Sr.default.createElement("span", null, "Aliased React label");',
        'Ns.default.createElement(ActionButton, {placeholder: "Aliased component placeholder"}, "Aliased component child");',
        'setting.setDesc(Yt("Wrapped setting description"));',
        'const grammar={name:"Attribute",bnf:[]};',
        'const model={name:"Anthropic Claude Opus 4.6",description:"Internal model metadata"};',
        'plugin.addCommand({id:"transpose",name:"Transpose",editorCheckCallback:run});',
        'React.createElement("div",{title:"Outer title"},React.createElement("span",{title:"Nested title"},"Nested text"));',
        `${nestedReactTree(10)};`,
        'React.createElement("span",null,"After deep tree");',
        " ".repeat(1_048_577),
      ].join("\n"));
      await writeFile(readmePath, [
        "For more information, visit the [Help Docs](https://example.com/help).",
        "",
        "Support via [![Sponsor](badge.svg)](https://example.com) today.",
        "",
        "[<img src=\"coffee.png\">](https://example.com/coffee)",
      ].join("\n"));

      const localeRoot = join(root, "locale");
      await mkdir(localeRoot);
      await writeFile(join(localeRoot, "en.ts"), "export default {settings: {title: 'Open settings'}};");
      await writeFile(join(localeRoot, "es.ts"), "export default {settings: {title: 'Abrir ajustes'}};");
      await writeFile(join(localeRoot, "fr.ts"), "export default {settings: {title: 'Ouvrir les reglages'}};");
      await writeFile(join(localeRoot, "ja.ts"), "export default {settings: {title: '設定を開く'}};");
      await writeFile(join(localeRoot, "ko.ts"), "export default {settings: {title: '설정 열기'}};");
      await writeFile(join(localeRoot, "ru.ts"), "export default {settings: {title: 'Открыть настройки'}};");
      await writeFile(join(localeRoot, "zh_cn.ts"), "export default {settings: {title: '打开设置'}};");

      const client = await scanFixture(manifestPath, bundlePath);
      const installedClient = await scanFixture(
        manifestPath,
        bundlePath,
        undefined,
        "\n/* nosourcemap */",
      );
      const authority = scanAuthority(manifestPath, bundlePath, localeRoot);
      expect(normalizeClient(client)).toEqual(normalizeAuthority(authority));
      expect(client.artifactDigest).toBe(authority.artifact_digest);
      expect(installedClient.artifactDigest).toBe(authority.artifact_digest);
      expect(client.catalogIdentity?.scopes.some((scope) => scope.scope === "readme")).toBe(true);
      expect(client.strings.map((item) => item.source)).not.toContain("Attribute");
      expect(client.strings.map((item) => item.source)).not.toContain("Anthropic Claude Opus 4.6");
      expect(client.strings.map((item) => item.source)).not.toContain("Internal model metadata");
      expect(client.strings.map((item) => item.source)).toContain(
        "For more information, visit the {{th:expr:0}}.",
      );
      expect(client.strings.map((item) => item.source)).not.toContain(
        '{"kind":"panel","actions":["open","sync"]}',
      );
      expect(client.strings.map((item) => item.source)).toContain(
        '{"title":"Sync your vault","actions":["open","sync"]}',
      );
      expect(client.strings.map((item) => item.source)).toContain('{"title":"Settings"}');
      expect(client.strings.map((item) => item.source)).toContain('{"summary":"Settings"}');
      expect(client.strings.map((item) => item.source)).toContain("Copilot Settings");
      expect(client.strings.map((item) => item.source)).toContain("Enter your license key");
      expect(client.strings.map((item) => item.source)).not.toContain("{{th:expr:0}}");
      expect(client.strings.map((item) => item.source)).toEqual(expect.arrayContaining([
        "Component title", "Component child", "Aliased React label",
        "Aliased component placeholder", "Aliased component child", "Wrapped setting description",
      ]));
      expect(client.strings.map((item) => item.source)).toEqual(expect.arrayContaining([
        "Depth 1", "Depth 2", "Depth 3", "Depth 4",
        "Depth 5", "Depth 6", "Depth 7", "Depth 8",
        "After deep tree",
      ]));
      expect(client.strings.map((item) => item.source)).not.toContain("Depth 9");
      expect(client.strings.map((item) => item.source)).not.toContain("Depth 10");
      expect(client.strings.map((item) => item.source)).not.toContain("Deep leaf text");
      expect(authority.native_locale_coverage.map((item) => item.locale)).toEqual([
        "es", "fr", "ja", "ko", "ru", "zh-CN",
      ]);
      expect(JSON.stringify(authority.native_locale_coverage)).not.toContain("打开设置");
      expect(client.strings.map((item) => item.source)).toContain("Support via today.");
      expect(client.strings.map((item) => item.source)).not.toContain("{{th:expr:0}}");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps both scanners aligned on grouped UI copy dictionaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "trans-hub-obsidian-dict-parity-"));
    try {
      const manifestPath = join(root, "manifest.json");
      const bundlePath = join(root, "main.js");
      await writeFile(manifestPath, JSON.stringify({
        id: "dict-sample",
        name: "Dict Sample",
        version: "1.0.0",
        description: "Ships grouped UI copy.",
      }));
      await writeFile(bundlePath, [
        'var wfe={hintText:{fileName:"Enter File Name",alias:"Enter Display Name"},',
        'timeUnits:{hour:"Hour",day:"Day",week:"Week",month:"Month"},',
        'aggregates:{values:"Values",sum:"Sum",average:"Average",median:"Median"},',
        'fieldTypes:{object:"Object",text:"Text",file:"File",date:"Date"},',
        'commands:{open:"Open",close:"Close",save:"Save",run:"Run",export:"Export",move:"Move",delete:"Delete",edit:"Edit",copy:"Copy",paste:"Paste"},',
        'views:{table:"Table",card:"Card",board:"Board",list:"List",flow:"Flow",gallery:"Gallery",calendar:"Calendar",catalog:"Catalog",details:"Details",grid:"Grid"}};',
        'var keyCodes={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt"};',
        'var emoji={a:"grinning face",b:"smiling face with open mouth",c:"winking face",d:"heart eyes",e:"star struck",f:"face with tears of joy",g:"thinking face",h:"zipper mouth face",i:"money mouth face",j:"hugging face",k:"smirking face",l:"unamused face"};',
        'var easing={a:"easeInQuad",b:"easeOutQuad",c:"easeInOutQuad",d:"easeInCubic",e:"easeOutCubic",f:"easeInOutCubic",g:"easeInQuart",h:"easeOutQuart",i:"easeInOutQuart",j:"easeInSine",k:"easeOutSine",l:"easeInOutSine"};',
      ].join("\n"));

      const client = await scanFixture(manifestPath, bundlePath);
      const authority = scanAuthority(manifestPath, bundlePath);
      expect(normalizeClient(client)).toEqual(normalizeAuthority(authority));
      const sources = client.strings.map((item) => item.source);
      expect(sources).toContain("Enter File Name");
      expect(sources).toContain("Values");
      expect(sources).toContain("Gallery");
      expect(sources).not.toContain("Backspace");
      expect(sources).not.toContain("grinning face");
      expect(sources).not.toContain("easeInQuad");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps both scanners aligned on per-language settings schemas", async () => {
    const root = await mkdtemp(join(tmpdir(), "trans-hub-obsidian-schema-parity-"));
    try {
      const manifestPath = join(root, "manifest.json");
      const bundlePath = join(root, "main.js");
      await writeFile(manifestPath, JSON.stringify({
        id: "schema-sample",
        name: "Schema Sample",
        version: "1.0.0",
        description: "Ships one settings schema per language.",
      }));
      await writeFile(bundlePath, [
        "const en = { items: {",
        'listPaneTitle:{name:"List pane title",desc:"Choose where the list pane title is shown."},',
        'defaultSort:{name:"Default sort order",desc:"Choose the default sort order for notes."},',
        'grouping:{name:"Grouping properties",desc:"Comma-separated properties that group the list."},',
        'icons:{name:"Icons",desc:"Show file icons next to note titles."},',
        'preview:{name:"Preview text",desc:"Render preview text for each note."},',
        "}};",
        "const de = { items: {",
        'listPaneTitle:{name:"Titel des Listenbereichs",desc:"Wählen Sie aus, wo der Titel des Listenbereichs angezeigt wird."},',
        'defaultSort:{name:"Standard-Sortierreihenfolge",desc:"Wählen Sie die Standardsortierung für Notizen aus."},',
        'grouping:{name:"Gruppierungseigenschaften",desc:"Durch Kommas getrennte Eigenschaften zum Gruppieren."},',
        'icons:{name:"Symbole",desc:"Dateisymbole neben Notiztiteln anzeigen."},',
        'preview:{name:"Vorschautext",desc:"Vorschautext für jede Notiz rendern."},',
        "}};",
      ].join("\n"));

      const client = await scanFixture(manifestPath, bundlePath);
      const authority = scanAuthority(manifestPath, bundlePath);
      expect(normalizeClient(client)).toEqual(normalizeAuthority(authority));
      const sources = client.strings.map((item) => item.source);
      expect(sources).toContain("List pane title");
      expect(sources).not.toContain("Titel des Listenbereichs");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps frozen Advanced URI notice calls in parity while registry metadata stays observational", async () => {
    const root = await mkdtemp(join(tmpdir(), "trans-hub-advanced-uri-parity-"));
    try {
      const manifestPath = join(root, "manifest.json");
      const bundlePath = join(root, "main.js");
      await writeFile(manifestPath, JSON.stringify({
        id: "obsidian-advanced-uri",
        name: "Advanced URI",
        version: "2.0.0",
        description: "Control various aspects through URIs.",
      }));
      await writeFile(bundlePath, [
        'new Notice("Active view is not a canvas");',
        'new Notice("Cannot find file");',
        'new Notice("Cannot find hover editor plugin. Please file an issue.");',
        'new Notice("Daily notes plugin is not loaded");',
        'new Notice("File already exists");',
        'new Notice("Workspaces plugin is not enabled");',
      ].join("\n"));

      const client = await scanFixture(manifestPath, bundlePath, {
        name: "Advanced URI",
        description: ADVANCED_URI_REGISTRY_DESCRIPTION,
      });
      const clientWithoutRegistry = await scanFixture(manifestPath, bundlePath);
      const authority = scanAuthority(manifestPath, bundlePath);

      expect(normalizeCanonicalClient(client)).toEqual(normalizeAuthority(authority));
      expect(client.strings.find((item) => item.source === ADVANCED_URI_REGISTRY_DESCRIPTION))
        .toEqual(expect.objectContaining({ origins: ["registry.description"] }));
      expect(client.catalogIdentity).toEqual(clientWithoutRegistry.catalogIdentity);
      expect(client.digest).toBe(clientWithoutRegistry.digest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps compiled STRINGS_EN catalogs in parity for bundles above the regex threshold", async () => {
    const root = await mkdtemp(join(tmpdir(), "trans-hub-obsidian-exported-locale-"));
    try {
      const manifestPath = join(root, "manifest.json");
      const bundlePath = join(root, "main.js");
      await writeFile(manifestPath, JSON.stringify({
        id: "exported-locale-plugin",
        name: "Exported locale plugin",
        version: "1.0.0",
        description: "Uses compiled locale exports.",
      }));
      await writeFile(bundlePath, [
        "var localeExports={};register(localeExports,{STRINGS_EN:()=>english,STRINGS_ZH:()=>chinese});",
        "var english,chinese;boot(()=>{english={common:{title:'Settings',description:'Open settings'}};chinese={common:{title:'设置',description:'打开设置'}};});",
        "/* padding to exercise the large-bundle path */".repeat(25_000),
      ].join("\n"));

      const client = await scanFixture(manifestPath, bundlePath, undefined, "", "zh");
      const authority = scanAuthority(manifestPath, bundlePath);

      expect(normalizeClient(client)).toEqual(normalizeAuthority(authority));
      expect(client.catalogIdentity?.unitCount).toBe(authority.source_catalog.units.length);
      expect(client.strings.find((item) => item.source === "Settings")).toEqual(
        expect.objectContaining({ nativeTarget: "设置", nativeTargetLocale: "zh-CN" }),
      );
      expect(authority.native_locale_coverage.map((item) => item.locale)).toEqual(["zh-CN"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed by source for conflicting and untranslated native paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "trans-hub-obsidian-native-conflict-"));
    try {
      const manifestPath = join(root, "manifest.json");
      const bundlePath = join(root, "main.js");
      await writeFile(manifestPath, JSON.stringify({
        id: "native-conflict-plugin",
        name: "Native conflict plugin",
        version: "1.0.0",
        description: "Exercises native locale conflicts.",
      }));
      await writeFile(bundlePath, [
        'var en={actions:{savePrimary:"Save",saveSecondary:"Save",openPrimary:"Open",openSecondary:"Open",rowsPrimary:"Rows: "+count,rowsSecondary:"Rows: "+total,cancel:"Cancel"}};',
        'var zh={actions:{savePrimary:"保存",saveSecondary:"储存",openPrimary:"打开",openSecondary:"Open",rowsPrimary:"行数: "+count,rowsSecondary:"行数",cancel:"取消"}};',
        'var de={actions:{savePrimary:"Speichern",saveSecondary:"Speichern",openPrimary:"Öffnen",openSecondary:"Öffnen",rowsPrimary:"Zeilen: "+count,rowsSecondary:"Zeilen: "+total,cancel:"Abbrechen"}};',
        "var locales={de:de,en:en,'zh-CN':zh};",
      ].join(""));

      const client = await scanFixture(manifestPath, bundlePath, undefined, "", "zh-CN");
      const authority = scanAuthority(manifestPath, bundlePath);
      const chineseCoverage = authority.native_locale_coverage.find(
        (row) => row.locale === "zh-CN",
      );
      const cancel = client.strings.find((item) => item.source === "Cancel");

      expect(client.strings.find((item) => item.source === "Save"))
        .not.toHaveProperty("nativeTarget");
      expect(client.strings.find((item) => item.source === "Open"))
        .not.toHaveProperty("nativeTarget");
      expect(client.strings.find((item) => item.source === "Rows: {{th:expr:0}}"))
        .not.toHaveProperty("nativeTarget");
      expect(cancel).toEqual(expect.objectContaining({
        nativeTarget: "取消",
        nativeTargetLocale: "zh-CN",
      }));
      expect(chineseCoverage?.covered_entries.map((entry) => entry.string_key))
        .toEqual([cancel?.key]);
      expect(new Set(chineseCoverage?.covered_entries.map((entry) => entry.string_key)).size)
        .toBe(chineseCoverage?.covered_entries.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(ADVANCED_TABLES_FIXTURE === undefined)(
    "matches the frozen official Advanced Tables 0.23.2 artifact and excludes all confirmed parser identifiers",
    async () => {
      const fixtureRoot = ADVANCED_TABLES_FIXTURE ?? "";
      const manifestPath = join(fixtureRoot, "manifest.json");
      const bundlePath = join(fixtureRoot, "main.js");
      const readmePath = join(fixtureRoot, "README.md");
      const [manifestBytes, bundleBytes, readmeBytes] = await Promise.all([
        readFile(manifestPath),
        readFile(bundlePath),
        readFile(readmePath),
      ]);
      expect(sha256(manifestBytes)).toBe(ADVANCED_TABLES_MANIFEST_DIGEST);
      expect(sha256(bundleBytes)).toBe(ADVANCED_TABLES_BUNDLE_DIGEST);
      expect(sha256(readmeBytes)).toBe(ADVANCED_TABLES_README_DIGEST);

      const client = await scanFixture(manifestPath, bundlePath);
      const authority = scanAuthority(manifestPath, bundlePath);
      expect(client.pluginId).toBe("table-editor-obsidian");
      expect(client.pluginVersion).toBe("0.23.2");
      const clientReadme = normalizeClient(client).filter((row) => row.origins.includes("readme"));
      const authorityReadme = normalizeAuthority(authority).filter((row) => row.origins.includes("readme"));
      expect(clientReadme).toEqual(authorityReadme);
      const sources = new Set(client.strings.map((item) => item.source));
      for (const falsePositive of ADVANCED_TABLES_FALSE_POSITIVES) {
        expect(sources.has(falsePositive), falsePositive).toBe(false);
      }
      expect(sources).toContain(
        "For more information on using formulas, visit the {{th:expr:0}}.",
      );
      expect(sources).not.toContain("{{th:expr:0}}");
      expect([...sources].some((source) => source.includes("](https://"))).toBe(false);
      expect(sources).not.toContain("GitHub Sponsors");
      expect(sources).not.toContain("Paypal");
    },
  );

  it.skipIf(ADVANCED_URI_FIXTURE === undefined)(
    "matches the frozen official Advanced URI 2.0.0 runtime and manifest catalog without promoting registry observations",
    async () => {
      const fixtureRoot = ADVANCED_URI_FIXTURE ?? "";
      const manifestPath = join(fixtureRoot, "manifest.json");
      const bundlePath = join(fixtureRoot, "main.js");
      const [manifestBytes, bundleBytes] = await Promise.all([
        readFile(manifestPath),
        readFile(bundlePath),
      ]);
      expect(sha256(manifestBytes)).toBe(ADVANCED_URI_MANIFEST_DIGEST);
      expect(sha256(bundleBytes)).toBe(ADVANCED_URI_BUNDLE_DIGEST);

      const client = await scanFixture(manifestPath, bundlePath, {
        name: "Advanced URI",
        description: ADVANCED_URI_REGISTRY_DESCRIPTION,
      });
      const clientWithoutRegistry = await scanFixture(manifestPath, bundlePath);
      const authority = scanAuthority(manifestPath, bundlePath);

      expect(client.pluginId).toBe("obsidian-advanced-uri");
      expect(client.pluginVersion).toBe("2.0.0");
      expect(authority.strings).toHaveLength(73);
      expect(client.strings).toHaveLength(74);
      expect(client.catalogIdentity?.unitCount).toBe(73);
      expect(normalizeCanonicalClient(client)).toEqual(normalizeAuthority(authority));
      expect(client.strings.find((item) => item.source === ADVANCED_URI_REGISTRY_DESCRIPTION))
        .toEqual(expect.objectContaining({
          origins: ["registry.description"],
          semanticRole: "description",
        }));
      expect(client.catalogIdentity).toEqual(clientWithoutRegistry.catalogIdentity);
      expect(client.digest).toBe(clientWithoutRegistry.digest);
    },
  );

  it.skipIf(BETTER_MANAGER_FIXTURE === undefined)(
    "keeps Better Plugins Manager 1.0.14 locale files as coverage-only evidence",
    async () => {
      const fixtureRoot = BETTER_MANAGER_FIXTURE ?? "";
      const manifestPath = join(fixtureRoot, "manifest.json");
      const bundlePath = join(fixtureRoot, "main.js");
      const readmePath = join(fixtureRoot, "README.md");
      const localeRoot = join(fixtureRoot, "locale");
      const [manifestBytes, bundleBytes, readmeBytes, ...localeBytes] = await Promise.all([
        readFile(manifestPath),
        readFile(bundlePath),
        readFile(readmePath),
        readFile(join(localeRoot, "en.ts")),
        readFile(join(localeRoot, "es.ts")),
        readFile(join(localeRoot, "fr.ts")),
        readFile(join(localeRoot, "ja.ts")),
        readFile(join(localeRoot, "ko.ts")),
        readFile(join(localeRoot, "ru.ts")),
        readFile(join(localeRoot, "zh_cn.ts")),
      ]);
      expect(sha256(manifestBytes)).toBe(BETTER_MANAGER_MANIFEST_DIGEST);
      expect(sha256(bundleBytes)).toBe(BETTER_MANAGER_BUNDLE_DIGEST);
      expect(sha256(readmeBytes)).toBe(BETTER_MANAGER_README_DIGEST);
      expect(localeBytes.map(sha256)).toEqual([
        BETTER_MANAGER_ENGLISH_LOCALE_DIGEST,
        BETTER_MANAGER_SPANISH_LOCALE_DIGEST,
        BETTER_MANAGER_FRENCH_LOCALE_DIGEST,
        BETTER_MANAGER_JAPANESE_LOCALE_DIGEST,
        BETTER_MANAGER_KOREAN_LOCALE_DIGEST,
        BETTER_MANAGER_RUSSIAN_LOCALE_DIGEST,
        BETTER_MANAGER_CHINESE_LOCALE_DIGEST,
      ]);

      const client = await scanFixture(manifestPath, bundlePath);
      const authority = scanAuthority(manifestPath, bundlePath, localeRoot);
      expect(client.catalogIdentity?.unitCount).toBe(130);
      expect(authority.source_catalog.units).toHaveLength(130);
      expect(authority.native_locale_coverage.map((row) => row.locale)).toEqual([
        "es", "fr", "ja", "ko", "ru", "zh-CN",
      ]);
      const chineseCoverage = authority.native_locale_coverage.find(
        (row) => row.locale === "zh-CN",
      );
      expect(chineseCoverage?.covered_entries).toHaveLength(45);
      const rolesByKey = new Map(authority.strings.map((row) => [row.key, row.semantic_role]));
      expect(chineseCoverage?.covered_entries.every(
        (entry) => rolesByKey.get(entry.string_key) === "runtime-ui",
      )).toBe(true);
      expect(normalizeCanonicalClient(client)).toEqual(normalizeAuthority(authority));
    },
  );
  },
);

async function scanFixture(
  manifestPath: string,
  bundlePath: string,
  registryMetadata?: { readonly name: string; readonly description: string },
  bundleSuffix = "",
  targetLocale?: string,
): Promise<PluginUiCatalog> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    id: string;
    name: string;
    version: string;
    description: string;
  };
  return scanPluginUiStrings({
    plugin: {
      ...manifest,
      dir: dirname(manifestPath),
      enabled: true,
    },
    bundle: `${await readFile(bundlePath, "utf8")}${bundleSuffix}`,
    ...(registryMetadata === undefined ? {} : { registryMetadata }),
    ...(existsSync(join(dirname(manifestPath), "README.md"))
      ? { readmeMarkdown: await readFile(join(dirname(manifestPath), "README.md"), "utf8") }
      : {}),
    sourceLocale: "en",
    ...(targetLocale === undefined ? {} : { targetLocale }),
    now: () => new Date("2026-07-23T00:00:00.000Z"),
  });
}

function normalizeCanonicalClient(catalog: PluginUiCatalog): readonly NormalizedRow[] {
  return catalog.strings.flatMap((item) => {
    const origins = item.origins.filter((origin) => !origin.startsWith("registry."));
    if (origins.length === 0) return [];
    return [{
      key: item.key,
      source: item.source,
      placeholderSignature: item.placeholderSignature,
      semanticRole: item.semanticRole ?? "runtime-ui",
      origins,
      scopes: [...resolvePluginStringScopes(origins)].sort(),
    }];
  });
}

function scanAuthority(
  manifestPath: string,
  bundlePath: string,
  localeRoot?: string,
): AuthoritySnapshot {
  const args = [
    "-c",
    PYTHON_SNAPSHOT,
    ADAPTER_PATH,
    manifestPath,
    bundlePath,
    join(dirname(manifestPath), "README.md"),
    ...(localeRoot === undefined ? [] : [localeRoot]),
  ];
  const result = spawnSync("python3", args, {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (result.status !== 0) throw new Error(result.stderr || "authority_adapter_scan_failed");
  return JSON.parse(result.stdout) as AuthoritySnapshot;
}

function normalizeClient(catalog: PluginUiCatalog): readonly NormalizedRow[] {
  return catalog.strings.map((item) => ({
    key: item.key,
    source: item.source,
    placeholderSignature: item.placeholderSignature,
    semanticRole: item.semanticRole ?? "runtime-ui",
    origins: item.origins,
    scopes: [...resolvePluginStringScopes(item.origins)].sort(),
  }));
}

function normalizeAuthority(snapshot: AuthoritySnapshot): readonly NormalizedRow[] {
  const scopes = new Map(snapshot.source_catalog.units.map((unit) => [
    unit.key,
    unit.context.content_scopes,
  ]));
  return snapshot.strings.map((item) => ({
    key: item.key,
    source: item.source,
    placeholderSignature: item.placeholder_signature,
    semanticRole: item.semantic_role,
    origins: item.origins,
    scopes: [...(scopes.get(item.key) ?? [])].sort(),
  }));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface NormalizedRow {
  readonly key: string;
  readonly source: string;
  readonly placeholderSignature: string;
  readonly semanticRole: string;
  readonly origins: readonly string[];
  readonly scopes: readonly string[];
}

interface AuthoritySnapshot {
  readonly artifact_digest: string;
  readonly strings: readonly {
    readonly key: string;
    readonly source: string;
    readonly placeholder_signature: string;
    readonly semantic_role: string;
    readonly origins: readonly string[];
  }[];
  readonly source_catalog: {
    readonly units: readonly {
      readonly key: string;
      readonly context: { readonly content_scopes: readonly string[] };
    }[];
  };
  readonly native_locale_coverage: readonly {
    readonly locale: string;
    readonly covered_entries: readonly { readonly string_key: string }[];
  }[];
}
