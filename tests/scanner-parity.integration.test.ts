import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const ADVANCED_TABLES_FALSE_POSITIVES = [
  "Attribute", "AttributeValue", "Attributes", "CharClass", "CharCode", "CharCodeRange",
  "CharRange", "Comment", "Link", "PrimaryPreDecoration", "RULE_Char", "Url", "wrapper",
] as const;

const PYTHON_SNAPSHOT = String.raw`
import importlib.util, json, pathlib, sys
adapter_path, manifest_path, bundle_path, readme_path = map(pathlib.Path, sys.argv[1:])
spec = importlib.util.spec_from_file_location("trans_hub_obsidian_adapter", adapter_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
readme = readme_path.read_bytes() if readme_path.is_file() else None
sys.stdout.buffer.write(module.build_snapshot(manifest_path.read_bytes(), bundle_path.read_bytes(), readme_content=readme))
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
        'const grammar={name:"Attribute",bnf:[]};',
        'const model={name:"Anthropic Claude Opus 4.6",description:"Internal model metadata"};',
        'plugin.addCommand({id:"transpose",name:"Transpose",editorCheckCallback:run});',
      ].join("\n"));
      await writeFile(readmePath, [
        "For more information, visit the [Help Docs](https://example.com/help).",
        "",
        "Support via [![Sponsor](badge.svg)](https://example.com) today.",
        "",
        "[<img src=\"coffee.png\">](https://example.com/coffee)",
      ].join("\n"));

      const client = await scanFixture(manifestPath, bundlePath);
      const authority = scanAuthority(manifestPath, bundlePath);
      expect(normalizeClient(client)).toEqual(normalizeAuthority(authority));
      expect(client.strings.map((item) => item.source)).not.toContain("Attribute");
      expect(client.strings.map((item) => item.source)).not.toContain("Anthropic Claude Opus 4.6");
      expect(client.strings.map((item) => item.source)).not.toContain("Internal model metadata");
      expect(client.strings.map((item) => item.source)).toContain(
        "For more information, visit the {{th:expr:0}}.",
      );
      expect(client.strings.map((item) => item.source)).toContain("Support via today.");
      expect(client.strings.map((item) => item.source)).not.toContain("{{th:expr:0}}");
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
  },
);

async function scanFixture(
  manifestPath: string,
  bundlePath: string,
  registryMetadata?: { readonly name: string; readonly description: string },
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
    bundle: await readFile(bundlePath, "utf8"),
    ...(registryMetadata === undefined ? {} : { registryMetadata }),
    ...(existsSync(join(dirname(manifestPath), "README.md"))
      ? { readmeMarkdown: await readFile(join(dirname(manifestPath), "README.md"), "utf8") }
      : {}),
    sourceLocale: "en",
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

function scanAuthority(manifestPath: string, bundlePath: string): AuthoritySnapshot {
  const result = spawnSync("python3", [
    "-c",
    PYTHON_SNAPSHOT,
    ADAPTER_PATH,
    manifestPath,
    bundlePath,
    join(dirname(manifestPath), "README.md"),
  ], {
    encoding: "utf8",
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
}
