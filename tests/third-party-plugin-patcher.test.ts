import type { Vault } from "obsidian";
import { describe, expect, it } from "vitest";

import { sha256Hex } from "../src/identity";
import type { InstalledObsidianPlugin } from "../src/plugin-discovery";
import type { PluginTranslationState } from "../src/plugin-state";
import {
  normalizePluginBundle,
  normalizePluginBundleV1,
  scanPluginUiStrings,
} from "../src/plugin-string-scanner";
import {
  applyPublishedPluginFilePatch,
  hasActivePluginFilePatch,
  inspectPluginFilePatch,
  logicalPluginBundle,
  restorePublishedPluginFilePatch,
} from "../src/third-party-plugin-patcher";

function readCopilotTestBundle(): string {
  return [
    'setting.setName("Copilot Settings");',
    'setting.setName("Reset Settings");',
    'setting.setName("Copilot Plus");',
    'setting.setName("Set Keys");',
    'setting.setName("Include chat context, PDF and image support");',
    'setting.setName("Choose Plugin to open");',
    'setting.setName("Sidebar View");',
    'setting.setName("Automatically include current note or Web Viewer");',
    'const password = busy ? "Hide password" : "Show password";',
    'const action = busy ? "Apply" : "Join Now ";',
    'const tabs = ["basic","model","advanced"];',
    'setting.setName("Command"); setting.setName("Advanced");',
  ].join("\n");
}

function translate(source: string): string {
  const table: Readonly<Record<string, string>> = {
    "Copilot Settings": "副驾驶设置",
    "Copilot Plus": "副驾驶 Plus",
    "Reset Settings": "重置设置",
  };
  return table[source] ?? `译文：${source}`;
}

class MemoryVault {
  readonly files = new Map<string, string>();
  failRenameAt: number | undefined;
  #renameCount = 0;

  get adapter() {
    return {
      exists: (path: string) => Promise.resolve(this.files.has(path)),
      read: (path: string) => {
        const value = this.files.get(path);
        if (value === undefined) throw new Error(`missing ${path}`);
        return Promise.resolve(value);
      },
      write: (path: string, content: string) => { this.files.set(path, content); return Promise.resolve(); },
      remove: (path: string) => { this.files.delete(path); return Promise.resolve(); },
      rename: (from: string, to: string) => {
        this.#renameCount += 1;
        if (this.failRenameAt === this.#renameCount) {
          throw new Error("injected rename failure");
        }
        const value = this.files.get(from);
        if (value === undefined) throw new Error(`missing rename source ${from}`);
        this.files.delete(from);
        this.files.set(to, value);
        return Promise.resolve();
      },
      mkdir: () => Promise.resolve(),
      rmdir: () => Promise.resolve(),
    };
  }
}

describe("third-party plugin file patching", () => {
  it("applies, exposes the logical bundle, and restores the real Copilot bundle", async () => {
    const bundle = readCopilotTestBundle();
    const plugin: InstalledObsidianPlugin = {
      id: "copilot",
      name: "Copilot",
      version: "3.3.3",
      description: "",
      dir: "Saken/.obsidian/plugins/copilot",
      enabled: true,
    };
    const catalog = await scanPluginUiStrings({
      plugin,
      bundle,
      sourceLocale: "en",
    });
    const runtimeEntries = catalog.strings
      .filter((item) => item.evidence?.some((entry) => entry.literalStart !== undefined))
      .map((item) => ({
        pluginId: plugin.id,
        source: item.source,
        target: translate(item.source),
        provenanceKind: "th-automatic" as const,
        scopes: ["runtime-ui"] as const,
      }));
    const translation: PluginTranslationState = {
      pluginId: plugin.id,
      pluginVersion: plugin.version,
      sourceVersionId: "test-source-version",
      targetLocale: "zh-CN",
      artifactDigest: catalog.artifactDigest,
      catalogIdentity: catalog.catalogIdentity,
      entries: runtimeEntries,
      pulledAt: new Date().toISOString(),
    };
    const vault = new MemoryVault();
    vault.files.set(`${plugin.dir}/main.js`, bundle);

    const vaultLike = vault as unknown as Vault;
    const crossVersion = await applyPublishedPluginFilePatch({
      vault: vaultLike,
      plugin,
      catalog,
      translation: { ...translation, authorityPluginVersion: "1.1.0" },
    });
    expect(crossVersion).toEqual({ applied: 0, skipped: 1, conflicts: 0 });
    expect(vault.files.get(`${plugin.dir}/main.js`)).toBe(bundle);

    const result = await applyPublishedPluginFilePatch({ vault: vaultLike, plugin, catalog, translation });
    expect(result.conflicts).toBe(0);
    expect(result.applied).toBeGreaterThanOrEqual(3);

    const patched = vault.files.get(`${plugin.dir}/main.js`) ?? "";
    expect(patched).toContain("副驾驶设置");
    expect(patched).toContain("重置设置");
    expect(patched).toContain('busy ? "Hide password" : "Show password"');
    expect(patched).toContain('busy ? "Apply" : "Join Now "');
    expect(patched).toContain("\"译文：Set Keys\"");
    expect(patched).toContain("\"Join Now \"");
    expect(patched).toContain("译文：Include chat context, PDF and image support");
    expect(patched).toContain("译文：Choose Plugin to open");
    expect(patched).toContain("\"译文：Sidebar View\"");
    expect(patched).toContain("译文：Automatically include current note or Web Viewer");
    expect(vault.files.has("Saken/.obsidian/plugins/copilot/.trans-hub-localizer/patch-receipt.json")).toBe(true);

    const logical = await logicalPluginBundle(vaultLike, plugin);
    expect(logical.patched).toBe(true);
    expect(logical.content).toBe(bundle);
    expect(await hasActivePluginFilePatch(vaultLike, plugin)).toBe(true);

    const restore = await restorePublishedPluginFilePatch(vaultLike, plugin);
    expect(restore).toBe("restored");
    expect(vault.files.get(`${plugin.dir}/main.js`)).toBe(bundle);
    const afterRestore = await logicalPluginBundle(vaultLike, plugin);
    expect(afterRestore.patched).toBe(false);
    expect(await hasActivePluginFilePatch(vaultLike, plugin)).toBe(false);
  }, 120_000);

  it("clears the receipt when the original file was already restored", async () => {
    const plugin: InstalledObsidianPlugin = {
      id: "example", name: "Example", version: "1.0.0", description: "",
      dir: "Saken/.obsidian/plugins/example", enabled: true,
    };
    const original = "const original = true;\n";
    const patched = "const patched = true;\n";
    const originalDigest = await sha256Hex(normalizePluginBundle(original));
    const vault = new MemoryVault();
    const directory = `${plugin.dir}/.trans-hub-localizer`;
    vault.files.set(`${plugin.dir}/main.js`, original);
    vault.files.set(`${directory}/${originalDigest}.main.js`, original);
    vault.files.set(`${directory}/patch-receipt.json`, JSON.stringify({
      version: 2, pluginId: plugin.id, pluginVersion: plugin.version,
      originalDigest, patchedDigest: await sha256Hex(normalizePluginBundle(patched)),
      digestScheme: "bundle-v2", backupName: `${originalDigest}.main.js`,
    }));

    const vaultLike = vault as unknown as Vault;
    expect(await restorePublishedPluginFilePatch(vaultLike, plugin)).toBe("restored");
    expect(vault.files.get(`${plugin.dir}/main.js`)).toBe(original);
    expect(vault.files.has(`${directory}/patch-receipt.json`)).toBe(false);
    expect(await hasActivePluginFilePatch(vaultLike, plugin)).toBe(false);
  });

  it("recovers a missing target from its verified backup", async () => {
    const plugin: InstalledObsidianPlugin = {
      id: "example", name: "Example", version: "1.0.0", description: "",
      dir: "Saken/.obsidian/plugins/example", enabled: true,
    };
    const original = "const original = true;\n";
    const patched = "const patched = true;\n";
    const originalDigest = await sha256Hex(normalizePluginBundle(original));
    const vault = new MemoryVault();
    const directory = `${plugin.dir}/.trans-hub-localizer`;
    vault.files.set(`${directory}/${originalDigest}.main.js`, original);
    vault.files.set(`${directory}/patch-receipt.json`, JSON.stringify({
      version: 2, pluginId: plugin.id, pluginVersion: plugin.version,
      originalDigest, patchedDigest: await sha256Hex(normalizePluginBundle(patched)),
      digestScheme: "bundle-v2", backupName: `${originalDigest}.main.js`,
    }));

    const vaultLike = vault as unknown as Vault;
    expect(await restorePublishedPluginFilePatch(vaultLike, plugin)).toBe("restored");
    expect(vault.files.get(`${plugin.dir}/main.js`)).toBe(original);
    expect(vault.files.has(`${directory}/patch-receipt.json`)).toBe(false);
  });

  it("restores the verified original when installing a patch fails after target removal", async () => {
    const plugin: InstalledObsidianPlugin = {
      id: "example", name: "Example", version: "1.0.0", description: "",
      dir: "Saken/.obsidian/plugins/example", enabled: true,
    };
    const original = 'setting.setName("Original");\n';
    const catalog = await scanPluginUiStrings({ plugin, bundle: original, sourceLocale: "en" });
    const translation: PluginTranslationState = {
      pluginId: plugin.id, pluginVersion: plugin.version,
      sourceVersionId: "source", targetLocale: "zh-CN",
      artifactDigest: catalog.artifactDigest, catalogIdentity: catalog.catalogIdentity,
      entries: [{
        pluginId: plugin.id, source: "Original", target: "原文",
        provenanceKind: "th-automatic", scopes: ["runtime-ui"],
      }],
      pulledAt: new Date().toISOString(),
    };
    const vault = new MemoryVault();
    vault.files.set(`${plugin.dir}/main.js`, original);
    // backup, receipt, then main replacement
    vault.failRenameAt = 3;
    const vaultLike = vault as unknown as Vault;

    await expect(applyPublishedPluginFilePatch({ vault: vaultLike, plugin, catalog, translation }))
      .rejects.toThrow("injected rename failure");
    expect(vault.files.get(`${plugin.dir}/main.js`)).toBe(original);
    expect(await restorePublishedPluginFilePatch(vaultLike, plugin)).toBe("restored");
    expect(await hasActivePluginFilePatch(vaultLike, plugin)).toBe(false);
  });

  it("reports an inactive or stale patch receipt as not applied", async () => {
    const plugin: InstalledObsidianPlugin = {
      id: "copilot",
      name: "Copilot",
      version: "3.3.3",
      description: "",
      dir: "Saken/.obsidian/plugins/copilot",
      enabled: true,
    };
    const vault = new MemoryVault();
    const original = "const original = true;\n";
    const patched = "const patched = true;\n";
    const originalDigest = await sha256Hex(normalizePluginBundle(original));
    vault.files.set(`${plugin.dir}/main.js`, patched);
    vault.files.set(`${plugin.dir}/.trans-hub-localizer/${originalDigest}.main.js`, original);
    vault.files.set(
      "Saken/.obsidian/plugins/copilot/.trans-hub-localizer/patch-receipt.json",
      JSON.stringify({
        version: 1,
        pluginId: "copilot",
        pluginVersion: "2.0.0",
        originalDigest,
        patchedDigest: await sha256Hex(normalizePluginBundle(patched)),
        backupName: `${originalDigest}.main.js`,
      }),
    );
    // A receipt for another plugin version is stale and must not count.
    const vaultLike = vault as unknown as Vault;
    expect(await hasActivePluginFilePatch(vaultLike, plugin)).toBe(false);
    await expect(logicalPluginBundle(vaultLike, plugin)).resolves.toEqual({
      content: patched,
      patched: false,
    });
  });

  it("does not inherit a patch receipt after the plugin directory changes", async () => {
    const plugin: InstalledObsidianPlugin = {
      id: "copilot",
      name: "Copilot",
      version: "3.3.3",
      description: "",
      dir: "Saken/.obsidian/plugins/copilot-renamed",
      enabled: true,
    };
    const vault = new MemoryVault();
    const oldDirectory = "Saken/.obsidian/plugins/copilot";
    const original = "const original = true;\n";
    const patched = "const patched = true;\n";
    const originalDigest = await sha256Hex(normalizePluginBundle(original));
    vault.files.set(`${plugin.dir}/main.js`, patched);
    vault.files.set(`${oldDirectory}/.trans-hub-localizer/${originalDigest}.main.js`, original);
    vault.files.set(
      `${oldDirectory}/.trans-hub-localizer/patch-receipt.json`,
      JSON.stringify({
        version: 2,
        pluginId: plugin.id,
        pluginVersion: plugin.version,
        originalDigest,
        patchedDigest: await sha256Hex(normalizePluginBundle(patched)),
        digestScheme: "bundle-v2",
        backupName: `${originalDigest}.main.js`,
      }),
    );

    const vaultLike = vault as unknown as Vault;
    expect(await hasActivePluginFilePatch(vaultLike, plugin)).toBe(false);
    await expect(logicalPluginBundle(vaultLike, plugin)).resolves.toEqual({
      content: patched,
      patched: false,
    });
    expect(await restorePublishedPluginFilePatch(vaultLike, plugin)).toBe("absent");
    expect(vault.files.get(`${plugin.dir}/main.js`)).toBe(patched);
  });

  it("restores a legacy version-1 receipt written with the old digest normalization", async () => {
    const bundle = readCopilotTestBundle();
    const plugin: InstalledObsidianPlugin = {
      id: "copilot",
      name: "Copilot",
      version: "3.3.3",
      description: "",
      dir: "Saken/.obsidian/plugins/copilot",
      enabled: true,
    };
    const vault = new MemoryVault();
    vault.files.set(`${plugin.dir}/main.js`, bundle);
    const vaultLike = vault as unknown as Vault;

    // Simulate the pre-2026-08-05 state: a version-1 receipt whose digests
    // were computed with the legacy bundle-v1 normalization while the current
    // code (bundle-v2) is running.  Before the scheme fix this was misread as
    // a conflict and the cancel button could never restore the file.
    const backupName = "legacy-original.main.js";
    const patched = `${bundle}\n// patched by legacy build`;
    vault.files.set(`${plugin.dir}/.trans-hub-localizer/${backupName}`, bundle);
    vault.files.set(`${plugin.dir}/main.js`, patched);
    vault.files.set(
      `${plugin.dir}/.trans-hub-localizer/patch-receipt.json`,
      JSON.stringify({
        version: 1,
        pluginId: "copilot",
        pluginVersion: "3.3.3",
        originalDigest: await sha256Hex(normalizePluginBundleV1(bundle)),
        patchedDigest: await sha256Hex(normalizePluginBundleV1(patched)),
        backupName,
      }),
    );

    expect(await hasActivePluginFilePatch(vaultLike, plugin)).toBe(true);
    const logical = await logicalPluginBundle(vaultLike, plugin);
    expect(logical.patched).toBe(true);
    expect(logical.content).toBe(bundle);

    expect(await restorePublishedPluginFilePatch(vaultLike, plugin)).toBe("restored");
    expect(vault.files.get(`${plugin.dir}/main.js`)).toBe(bundle);
    expect(await hasActivePluginFilePatch(vaultLike, plugin)).toBe(false);
  });

  it("re-applying heals a stuck legacy patch by restoring it first", async () => {
    const bundle = readCopilotTestBundle();
    const plugin: InstalledObsidianPlugin = {
      id: "copilot",
      name: "Copilot",
      version: "3.3.3",
      description: "",
      dir: "Saken/.obsidian/plugins/copilot",
      enabled: true,
    };
    const catalog = await scanPluginUiStrings({
      plugin,
      bundle,
      sourceLocale: "en",
    });
    const runtimeEntries = catalog.strings
      .filter((item) => item.evidence?.some((entry) => entry.literalStart !== undefined))
      .map((item) => ({
        pluginId: plugin.id,
        source: item.source,
        target: translate(item.source),
        provenanceKind: "th-automatic" as const,
        scopes: ["runtime-ui"] as const,
      }));
    const translation: PluginTranslationState = {
      pluginId: plugin.id,
      pluginVersion: plugin.version,
      sourceVersionId: "test-source-version",
      targetLocale: "zh-CN",
      artifactDigest: catalog.artifactDigest,
      catalogIdentity: catalog.catalogIdentity,
      entries: runtimeEntries,
      pulledAt: new Date().toISOString(),
    };
    const vault = new MemoryVault();
    vault.files.set(`${plugin.dir}/main.js`, bundle);
    const vaultLike = vault as unknown as Vault;

    // First apply normally, then downgrade the receipt to the legacy v1
    // format the way it would look after the normalization change shipped.
    const applied = await applyPublishedPluginFilePatch({ vault: vaultLike, plugin, catalog, translation });
    expect(applied.conflicts).toBe(0);
    const patched = vault.files.get(`${plugin.dir}/main.js`) ?? "";
    const backupName = `${applied.applied}.legacy.main.js`;
    vault.files.set(`${plugin.dir}/.trans-hub-localizer/${backupName}`, bundle);
    vault.files.set(
      `${plugin.dir}/.trans-hub-localizer/patch-receipt.json`,
      JSON.stringify({
        version: 1,
        pluginId: "copilot",
        pluginVersion: "3.3.3",
        originalDigest: await sha256Hex(normalizePluginBundleV1(bundle)),
        patchedDigest: await sha256Hex(normalizePluginBundleV1(patched)),
        backupName,
      }),
    );

    // Re-applying must self-heal: restore the legacy patch first, then write a
    // fresh bundle-v2 receipt, instead of reporting a permanent conflict.
    const healed = await applyPublishedPluginFilePatch({ vault: vaultLike, plugin, catalog, translation });
    expect(healed.conflicts).toBe(0);
    expect(healed.applied).toBeGreaterThan(0);
    const receipt = JSON.parse(
      vault.files.get(`${plugin.dir}/.trans-hub-localizer/patch-receipt.json`) ?? "{}",
    ) as { readonly version?: number; readonly digestScheme?: string };
    expect(receipt.version).toBe(2);
    expect(receipt.digestScheme).toBe("bundle-v2");
    expect(await restorePublishedPluginFilePatch(vaultLike, plugin)).toBe("restored");
    expect(vault.files.get(`${plugin.dir}/main.js`)).toBe(bundle);
  }, 120_000);

  it("requires an explicit force restore for externally modified plugin bytes", async () => {
    const plugin: InstalledObsidianPlugin = {
      id: "example",
      name: "Example",
      version: "1.0.0",
      description: "",
      dir: "Saken/.obsidian/plugins/example",
      enabled: true,
    };
    const original = "const source = 'original';\n";
    const patched = "const source = 'patched';\n";
    const vault = new MemoryVault();
    const originalDigest = await sha256Hex(normalizePluginBundle(original));
    const patchedDigest = await sha256Hex(normalizePluginBundle(patched));
    const patchDirectory = `${plugin.dir}/.trans-hub-localizer`;
    vault.files.set(`${plugin.dir}/main.js`, "const source = 'user-edit';\n");
    vault.files.set(`${patchDirectory}/${originalDigest}.main.js`, original);
    vault.files.set(`${patchDirectory}/patch-receipt.json`, JSON.stringify({
      version: 2,
      pluginId: plugin.id,
      pluginVersion: plugin.version,
      originalDigest,
      patchedDigest,
      digestScheme: "bundle-v2",
      backupName: `${originalDigest}.main.js`,
    }));

    const vaultLike = vault as unknown as Vault;
    expect(await restorePublishedPluginFilePatch(vaultLike, plugin)).toBe("conflict");
    expect(await restorePublishedPluginFilePatch(vaultLike, plugin, true)).toBe("restored");
    expect(vault.files.get(`${plugin.dir}/main.js`)).toBe(original);
  });
});


describe("read-only plugin patch inspection", () => {
  async function fixture() {
    const vault = new MemoryVault();
    const plugin: InstalledObsidianPlugin = {
      id: "sample", name: "Sample", version: "1.0.0", description: "", dir: ".obsidian/plugins/sample", enabled: true,
    };
    const original = 'setting.setName("Settings");';
    const patched = 'setting.setName("设置");';
    const external = 'setting.setName("Externally changed");';
    const originalDigest = await sha256Hex(normalizePluginBundle(original));
    const receipt = {
      version: 2, pluginId: plugin.id, pluginVersion: plugin.version,
      originalDigest, patchedDigest: await sha256Hex(normalizePluginBundle(patched)),
      digestScheme: "bundle-v2", backupName: `${originalDigest}.main.js`,
    };
    const main = `${plugin.dir}/main.js`;
    const directory = `${plugin.dir}/.trans-hub-localizer`;
    const receiptPath = `${directory}/patch-receipt.json`;
    const backupPath = `${directory}/${receipt.backupName}`;
    vault.files.set(main, patched);
    vault.files.set(receiptPath, JSON.stringify(receipt));
    vault.files.set(backupPath, original);
    return { vault, plugin, original, patched, external, main, receipt, receiptPath, backupPath };
  }

  it.each([
    ["active", "active"], ["no receipt", "none"], ["already restored", "restored"],
    ["external edit", "conflict"], ["missing main", "conflict"],
    ["missing backup", "conflict"], ["corrupt backup", "conflict"],
    ["corrupt receipt", "conflict"], ["wrong version", "conflict"],
    ["wrong plugin", "conflict"], ["bad digest", "conflict"],
    ["bad scheme", "conflict"], ["invalid backup path", "conflict"],
  ] as const)("classifies %s as %s without writing", async (scenario, expected) => {
    const { vault, plugin, original, patched, external, main, receipt, receiptPath, backupPath } = await fixture();
    if (scenario === "no receipt") vault.files.delete(receiptPath);
    if (scenario === "already restored") vault.files.set(main, original);
    if (scenario === "external edit") vault.files.set(main, external);
    if (scenario === "missing main") vault.files.delete(main);
    if (scenario === "missing backup") vault.files.delete(backupPath);
    if (scenario === "corrupt backup") vault.files.set(backupPath, "corrupt");
    if (scenario === "corrupt receipt") vault.files.set(receiptPath, "{");
    if (scenario === "wrong version") vault.files.set(receiptPath, JSON.stringify({ ...receipt, pluginVersion: "2.0.0" }));
    if (scenario === "wrong plugin") vault.files.set(receiptPath, JSON.stringify({ ...receipt, pluginId: "other" }));
    if (scenario === "bad digest") vault.files.set(receiptPath, JSON.stringify({ ...receipt, patchedDigest: "invalid" }));
    if (scenario === "bad scheme") vault.files.set(receiptPath, JSON.stringify({ ...receipt, version: 1, digestScheme: "unknown" }));
    if (scenario === "invalid backup path") vault.files.set(receiptPath, JSON.stringify({ ...receipt, backupName: "../main.js" }));
    const before = [...vault.files];
    const vaultLike = vault as unknown as Vault;
    expect(await inspectPluginFilePatch(vaultLike, plugin)).toBe(expected);
    expect(await hasActivePluginFilePatch(vaultLike, plugin)).toBe(expected === "active");
    if (scenario === "missing main") {
      await expect(logicalPluginBundle(vaultLike, plugin)).rejects.toThrow("missing");
    } else {
      expect(await logicalPluginBundle(vaultLike, plugin)).toEqual({
        content: expected === "active" || expected === "restored" ? original : scenario === "external edit" ? external : patched,
        patched: expected === "active",
      });
    }
    expect([...vault.files]).toEqual(before);
  });

  it("recognizes an already restored file even when only receipt cleanup remains", async () => {
    const { vault, plugin, original, main, backupPath, receiptPath } = await fixture();
    vault.files.set(main, original);
    vault.files.delete(backupPath);
    expect(await inspectPluginFilePatch(vault as unknown as Vault, plugin)).toBe("restored");
    expect(vault.files.has(receiptPath)).toBe(true);
  });

  it("does not hide a host rewrite during asynchronous backup inspection", async () => {
    const { vault, plugin, external, main, backupPath } = await fixture();
    const adapter = vault.adapter;
    const vaultLike = { adapter: { ...adapter, read: async (path: string) => {
      const content = await adapter.read(path);
      if (path === backupPath) vault.files.set(main, external);
      return content;
    } } } as unknown as Vault;
    expect(await logicalPluginBundle(vaultLike, plugin)).toEqual({ content: external, patched: false });
    expect(await inspectPluginFilePatch(vaultLike, plugin)).toBe("conflict");
  });

  it.each(["missing", "corrupt"])("refuses even forced restore with a %s backup", async (scenario) => {
    const { vault, plugin, external, main, backupPath } = await fixture();
    vault.files.set(main, external);
    if (scenario === "missing") vault.files.delete(backupPath);
    else vault.files.set(backupPath, "corrupt");
    const before = [...vault.files];
    expect(await restorePublishedPluginFilePatch(vault as unknown as Vault, plugin, true)).toBe("conflict");
    expect([...vault.files]).toEqual(before);
  });
});
