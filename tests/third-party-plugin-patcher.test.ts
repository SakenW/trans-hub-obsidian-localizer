import type { Vault } from "obsidian";
import { describe, expect, it } from "vitest";

import {
  applyCompatibilityStructurePatches,
  COMPATIBILITY_DICTIONARY_ZH_CN,
} from "../src/compatibility-patch";
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
  // 生产环境中这些静态界面字符串的已发布译文与兼容字典一致；mock 以字典
  // 优先，避免目录补丁先把字面量译成占位文本而让断言失真。
  return COMPATIBILITY_DICTIONARY_ZH_CN[source]
    ?? table[source]
    ?? `译文：${source}`;
}

class MemoryVault {
  readonly files = new Map<string, string>();

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
  it("translates the same structural shapes in any plugin without per-plugin configuration", () => {
    const bundle = [
      "const tabs = [\"basic\",\"model\",\"advanced\"];",
      "const items = tabs.map(t => ({ id: t, label: t.charAt(0).toUpperCase()+t.slice(1) }));",
      "React.createElement(\"button\", { \"aria-label\": busy ? \"Hide password\" : \"Show password\" }, busy ? \"Apply\" : \"Join Now \");",
      "React.createElement(\"div\", null, \"Set Keys\");",
      "React.createElement(\"select\", { options: [{ label: \"Sidebar View\", value: \"view\" }] });",
    ].join("\n");

    const patched = applyCompatibilityStructurePatches(bundle, "zh-CN");
    expect(patched).not.toBe(bundle);
    expect(patched).toContain("\"basic\":\"基础\",\"model\":\"模型\",\"advanced\":\"高级\"})[t]??t.charAt(0).toUpperCase()+t.slice(1)");
    expect(patched).toContain("busy ? \"隐藏密码\" : \"显示密码\"");
    expect(patched).toContain("busy ? \"应用\" : \"立即加入\"");
    expect(patched).toContain("\"设置密钥\"");
    expect(patched).toContain("label: \"侧边栏视图\"");

    // Unknown strings and other locales stay untouched.
    expect(applyCompatibilityStructurePatches(bundle, "en")).toBe(bundle);
    const withUnknown = "React.createElement(\"span\", null, busy ? \"Zork\" : \"Frob\");";
    expect(applyCompatibilityStructurePatches(withUnknown, "zh-CN")).toBe(withUnknown);
  });

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
    const result = await applyPublishedPluginFilePatch({ vault: vaultLike, plugin, catalog, translation });
    expect(result.conflicts).toBe(0);
    expect(result.applied).toBeGreaterThanOrEqual(10);

    const patched = vault.files.get(`${plugin.dir}/main.js`) ?? "";
    expect(patched).toContain("副驾驶设置");
    expect(patched).toContain("重置设置");
    expect(patched).toContain('busy ? "隐藏密码" : "显示密码"');
    expect(patched).toContain('busy ? "应用" : "立即加入"');
    expect(patched).toContain("\"设置密钥\"");
    expect(patched).toContain("\"立即加入\"");
    expect(patched).toContain("译文：Include chat context, PDF and image support");
    expect(patched).toContain("译文：Choose Plugin to open");
    expect(patched).toContain("侧边栏视图");
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
    vault.files.set(
      "Saken/.obsidian/plugins/copilot/.trans-hub-localizer/patch-receipt.json",
      JSON.stringify({
        version: 1,
        pluginId: "copilot",
        pluginVersion: "2.0.0",
        originalDigest: "a".repeat(64),
        patchedDigest: "b".repeat(64),
        backupName: "a".repeat(64) + ".main.js",
      }),
    );
    // A receipt for another plugin version is stale and must not count.
    expect(await hasActivePluginFilePatch(vault as unknown as Vault, plugin)).toBe(false);
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
