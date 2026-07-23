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
const ADVANCED_TABLES_FALSE_POSITIVES = [
  "Attribute", "AttributeValue", "Attributes", "CharClass", "CharCode", "CharCodeRange",
  "CharRange", "Comment", "Link", "PrimaryPreDecoration", "RULE_Char", "Url", "wrapper",
] as const;

const PYTHON_SNAPSHOT = String.raw`
import importlib.util, json, pathlib, sys
adapter_path, manifest_path, bundle_path = map(pathlib.Path, sys.argv[1:])
spec = importlib.util.spec_from_file_location("trans_hub_obsidian_adapter", adapter_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
sys.stdout.buffer.write(module.build_snapshot(manifest_path.read_bytes(), bundle_path.read_bytes()))
`;

describe.skipIf(!existsSync(ADAPTER_PATH))(
  "Obsidian client and authority adapter scanner parity",
  () => {
  it("keeps both scanners aligned on UI registration context", async () => {
    const root = await mkdtemp(join(tmpdir(), "trans-hub-obsidian-parity-"));
    try {
      const manifestPath = join(root, "manifest.json");
      const bundlePath = join(root, "main.js");
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

      const client = await scanFixture(manifestPath, bundlePath);
      const authority = scanAuthority(manifestPath, bundlePath);
      expect(normalizeClient(client)).toEqual(normalizeAuthority(authority));
      expect(client.strings.map((item) => item.source)).not.toContain("Attribute");
      expect(client.strings.map((item) => item.source)).not.toContain("Anthropic Claude Opus 4.6");
      expect(client.strings.map((item) => item.source)).not.toContain("Internal model metadata");
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
      const [manifestBytes, bundleBytes] = await Promise.all([
        readFile(manifestPath),
        readFile(bundlePath),
      ]);
      expect(sha256(manifestBytes)).toBe(ADVANCED_TABLES_MANIFEST_DIGEST);
      expect(sha256(bundleBytes)).toBe(ADVANCED_TABLES_BUNDLE_DIGEST);

      const client = await scanFixture(manifestPath, bundlePath);
      const authority = scanAuthority(manifestPath, bundlePath);
      expect(client.pluginId).toBe("table-editor-obsidian");
      expect(client.pluginVersion).toBe("0.23.2");
      expect(normalizeClient(client)).toEqual(normalizeAuthority(authority));
      const sources = new Set(client.strings.map((item) => item.source));
      for (const falsePositive of ADVANCED_TABLES_FALSE_POSITIVES) {
        expect(sources.has(falsePositive), falsePositive).toBe(false);
      }
    },
  );
  },
);

async function scanFixture(manifestPath: string, bundlePath: string): Promise<PluginUiCatalog> {
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
    sourceLocale: "en",
    now: () => new Date("2026-07-23T00:00:00.000Z"),
  });
}

function scanAuthority(manifestPath: string, bundlePath: string): AuthoritySnapshot {
  const result = spawnSync("python3", ["-c", PYTHON_SNAPSHOT, ADAPTER_PATH, manifestPath, bundlePath], {
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
