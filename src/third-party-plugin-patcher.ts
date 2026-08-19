import { normalizePath, type Vault } from "obsidian";

import { applyCompatibilityStructurePatches } from "./compatibility-patch";
import { comparePluginCatalogIdentity, selectCurrentCatalogTranslations } from "./plugin-catalog-diff";
import { sha256Hex } from "./identity";
import type { InstalledObsidianPlugin } from "./plugin-discovery";
import type { PluginTranslationState } from "./plugin-state";
import {
  normalizePluginBundleWithScheme,
  type PluginBundleDigestScheme,
  type PluginUiCatalog,
} from "./plugin-string-scanner";

const PATCH_DIR = ".trans-hub-localizer";
const RECEIPT = "patch-receipt.json";

interface PatchReceipt {
  readonly version: 1 | 2;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly originalDigest: string;
  readonly patchedDigest: string;
  /**
   * Digest scheme used to compute the two digests above.  Version-1 receipts
   * (written before the normalization change on 2026-08-05) omit the field and
   * default to `bundle-v1`; new receipts pin `bundle-v2` so a later
   * normalization change cannot invalidate them.
   */
  readonly digestScheme?: PluginBundleDigestScheme;
  /** Backup file name; resolved against the plugin directory at read time. */
  readonly backupName: string;
  /** Legacy receipts stored a full path; superseded by backupName. */
  readonly backupPath?: string;
}

export interface FilePatchResult { readonly applied: number; readonly skipped: number; readonly conflicts: number; }

const CURRENT_DIGEST_SCHEME: PluginBundleDigestScheme = "bundle-v2";

function receiptDigestScheme(receipt: PatchReceipt): PluginBundleDigestScheme {
  return receipt.digestScheme ?? "bundle-v1";
}

async function digestBundle(bundle: string, scheme: PluginBundleDigestScheme): Promise<string> {
  return sha256Hex(normalizePluginBundleWithScheme(scheme, bundle));
}

/** Whether the plugin file currently carries an active patch receipt. */
export async function hasActivePluginFilePatch(
  vault: Vault,
  plugin: InstalledObsidianPlugin,
): Promise<boolean> {
  const receipt = await readReceipt(vault, plugin);
  return receipt !== undefined
    && receipt.pluginId === plugin.id
    && receipt.pluginVersion === plugin.version;
}

/**
 * Scanner support: while a plugin file carries an active patch receipt, its
 * logical bundle is the verified original backup.  The scanner then keeps the
 * catalog identity stable instead of reporting the patched bytes as an
 * artifact mismatch.
 */
export async function logicalPluginBundle(
  vault: Vault,
  plugin: InstalledObsidianPlugin,
): Promise<{ readonly content: string; readonly patched: boolean }> {
  const receipt = await readReceipt(vault, plugin);
  if (receipt === undefined) {
    return { content: await vault.adapter.read(normalizePath(`${plugin.dir}/main.js`)), patched: false };
  }
  const backupPath = await resolveBackupPath(vault, plugin, receipt);
  if (backupPath === undefined) {
    return { content: await vault.adapter.read(normalizePath(`${plugin.dir}/main.js`)), patched: false };
  }
  const backup = await vault.adapter.read(backupPath);
  if (await digestBundle(backup, receiptDigestScheme(receipt)) !== receipt.originalDigest) {
    return { content: await vault.adapter.read(normalizePath(`${plugin.dir}/main.js`)), patched: false };
  }
  return { content: backup, patched: true };
}

export async function applyPublishedPluginFilePatch(input: {
  readonly vault: Vault;
  readonly plugin: InstalledObsidianPlugin;
  readonly catalog: PluginUiCatalog | undefined;
  readonly translation: PluginTranslationState | undefined;
}): Promise<FilePatchResult> {
  const { vault, plugin, catalog, translation } = input;
  if (catalog === undefined || translation === undefined || catalog.pluginVersion !== plugin.version
    || translation.pluginVersion !== plugin.version || !comparePluginCatalogIdentity(catalog, translation).exact) {
    return { applied: 0, skipped: 1, conflicts: 0 };
  }
  // A receipt for this exact plugin version may carry digests from an older
  // normalization scheme, or a previous cancel may have failed halfway.
  // Restore first so `original` below is always the true installed artifact;
  // otherwise a stale patched file is misread as a conflict forever.  Receipts
  // for other versions are stale (the plugin was updated since) and are simply
  // overwritten by the fresh patch below.
  const existingReceipt = await readReceipt(vault, plugin);
  if (existingReceipt !== undefined
    && existingReceipt.pluginId === plugin.id
    && existingReceipt.pluginVersion === plugin.version) {
    const restoreBeforeApply = await restorePublishedPluginFilePatch(vault, plugin);
    if (restoreBeforeApply === "conflict") {
      return { applied: 0, skipped: 0, conflicts: 1 };
    }
  }
  const main = normalizePath(`${plugin.dir}/main.js`);
  const original = await vault.adapter.read(main);
  const originalDigest = await digestBundle(original, CURRENT_DIGEST_SCHEME);
  if (originalDigest !== catalog.artifactDigest) {
    return { applied: 0, skipped: 0, conflicts: 1 };
  }
  const replacements = new Map(selectCurrentCatalogTranslations(catalog, translation, false)
    .filter((entry) => entry.scopes?.includes("runtime-ui")
      && !entry.source.includes("{{th:expr:")
      && typeof entry.target === "string")
    .map((entry) => [entry.source, entry.target]));
  const patches = catalog.strings.flatMap((item) => {
    const target = replacements.get(item.source);
    if (target === undefined || item.placeholderSignature !== "") return [];
    return (item.evidence ?? []).flatMap((evidence) =>
      evidence.literalStart !== undefined && evidence.literalEnd !== undefined
        && (evidence.strategy === "structured"
          || evidence.strategy === "regex-fallback" && evidence.symbol === "createElement")
        && decodeStaticLiteral(original.slice(evidence.literalStart, evidence.literalEnd)) === item.source
        ? [{
            start: evidence.literalStart,
            end: evidence.literalEnd,
            source: item.source,
            target,
          }]
        : []);
  }).sort((left, right) => right.start - left.start);
  if (patches.length === 0 || patches.some((patch, index) => index > 0 && patch.end > (patches[index - 1]?.start ?? 0))) {
    return { applied: 0, skipped: 1, conflicts: 0 };
  }
  let patched = original;
  for (const patch of patches) {
    const raw = patched.slice(patch.start, patch.end);
    if (decodeStaticLiteral(raw) !== patch.source) {
      return { applied: 0, skipped: 0, conflicts: 1 };
    }
    patched = `${patched.slice(0, patch.start)}${encodeLiteral(raw, patch.target)}${patched.slice(patch.end)}`;
  }
  patched = applyCompatibilityStructurePatches(patched, translation.targetLocale);
  const patchedDigest = await digestBundle(patched, CURRENT_DIGEST_SCHEME);
  const directory = normalizePath(`${plugin.dir}/${PATCH_DIR}`);
  // Vault adapters address files with vault-relative paths.  Persisting an
  // absolute filesystem path would make later receipt lookups fail whenever
  // discovery returns a different path shape, silently falling back to the
  // patched bundle.  Store only the file name and resolve it against the
  // plugin directory at read time, so writer and reader always agree.
  const backupName = `${originalDigest}.main.js`;
  const backupPath = normalizePath(`${plugin.dir}/${PATCH_DIR}/${backupName}`);
  await ensureDirectory(vault, directory);
  await writeAtomically(vault, backupPath, original);
  const receipt: PatchReceipt = {
    version: 2,
    pluginId: plugin.id,
    pluginVersion: plugin.version,
    originalDigest,
    patchedDigest,
    digestScheme: CURRENT_DIGEST_SCHEME,
    backupName,
  };
  await writeAtomically(vault, normalizePath(`${directory}/${RECEIPT}`), JSON.stringify(receipt));
  await writeAtomically(vault, main, patched);
  if (await digestBundle(await vault.adapter.read(main), CURRENT_DIGEST_SCHEME) !== patchedDigest) {
    throw new Error(`第三方插件补丁写入校验失败：${plugin.id}`);
  }
  return { applied: patches.length, skipped: 0, conflicts: 0 };
}

export async function restorePublishedPluginFilePatch(
  vault: Vault,
  plugin: InstalledObsidianPlugin,
  force = false,
): Promise<"restored" | "absent" | "conflict"> {
  const directory = normalizePath(`${plugin.dir}/${PATCH_DIR}`);
  const receiptPath = normalizePath(`${directory}/${RECEIPT}`);
  if (!(await vault.adapter.exists(receiptPath))) return "absent";
  const receipt = parseReceipt(await vault.adapter.read(receiptPath));
  if (receipt === undefined || receipt.pluginId !== plugin.id || receipt.pluginVersion !== plugin.version) return "conflict";
  const scheme = receiptDigestScheme(receipt);
  const main = normalizePath(`${plugin.dir}/main.js`);
  const current = await vault.adapter.read(main);
  const currentDigest = await digestBundle(current, scheme);
  if (currentDigest === receipt.originalDigest) return "restored";
  const backupPath = await resolveBackupPath(vault, plugin, receipt);
  if ((currentDigest !== receipt.patchedDigest || backupPath === undefined) && !force) return "conflict";
  if (backupPath === undefined) return "conflict";
  const backup = await vault.adapter.read(backupPath);
  // A forced restore still refuses a corrupted backup, so it never writes
  // unverifiable bytes over main.js.
  if (await digestBundle(backup, scheme) !== receipt.originalDigest) return "conflict";
  await writeAtomically(vault, main, backup);
  if (await digestBundle(await vault.adapter.read(main), scheme) !== receipt.originalDigest) {
    throw new Error(`第三方插件恢复校验失败：${plugin.id}`);
  }
  await vault.adapter.remove(receiptPath);
  return "restored";
}

async function readReceipt(vault: Vault, plugin: InstalledObsidianPlugin): Promise<PatchReceipt | undefined> {
  const receiptPath = normalizePath(`${plugin.dir}/${PATCH_DIR}/${RECEIPT}`);
  if (!(await vault.adapter.exists(receiptPath))) return undefined;
  const receipt = parseReceipt(await vault.adapter.read(receiptPath));
  if (receipt === undefined) return undefined;
  return receipt;
}

async function resolveBackupPath(
  vault: Vault,
  plugin: InstalledObsidianPlugin,
  receipt: PatchReceipt | undefined,
): Promise<string | undefined> {
  if (receipt === undefined) return undefined;
  const name = receipt.backupName ?? receipt.backupPath?.split("/").at(-1);
  if (typeof name !== "string" || name === "") return undefined;
  const candidate = normalizePath(`${plugin.dir}/${PATCH_DIR}/${name}`);
  return (await vault.adapter.exists(candidate)) ? candidate : undefined;
}

function decodeStaticLiteral(raw: string): string | undefined {
  if (raw.length < 2 || !["'", "\"", "`"].includes(raw[0] ?? "") || raw.at(-1) !== raw[0] || raw.includes("${")) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw[0] === "'"
      ? `"${raw.slice(1, -1).replace(/\\'/gu, "'").replace(/"/gu, '\\"')}"`
      : raw);
    return typeof parsed === "string" ? parsed : undefined;
  } catch { return undefined; }
}

function encodeLiteral(raw: string, target: string): string {
  if (typeof target !== "string") return raw;
  const quote = raw[0] ?? "\"";
  const json = JSON.stringify(target).replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
  if (quote === "\"") return json;
  if (quote === "'") return `'${json.slice(1, -1).replace(/'/gu, "\\'")}'`;
  return `\`${json.slice(1, -1).replace(/`/gu, "\\`").replace(/\$/gu, "\\$")}\``;
}

async function ensureDirectory(vault: Vault, directory: string): Promise<void> { if (!(await vault.adapter.exists(directory))) await vault.adapter.mkdir(directory); }
async function writeAtomically(vault: Vault, path: string, text: string): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await vault.adapter.write(temporary, text);
  try { if (await vault.adapter.exists(path)) await vault.adapter.remove(path); await vault.adapter.rename(temporary, path); }
  catch (error) { if (await vault.adapter.exists(temporary)) await vault.adapter.remove(temporary); throw error; }
}
function parseReceipt(raw: string): PatchReceipt | undefined {
  try {
    const value = JSON.parse(raw) as Partial<PatchReceipt> & { readonly backupPath?: unknown };
    if (
      (value.version !== 1 && value.version !== 2)
      || typeof value.pluginId !== "string"
      || typeof value.pluginVersion !== "string"
      || typeof value.originalDigest !== "string"
      || typeof value.patchedDigest !== "string"
    ) return undefined;
    if (value.version === 2
      && (value.digestScheme !== "bundle-v1" && value.digestScheme !== "bundle-v2")) {
      return undefined;
    }
    if (typeof value.backupName === "string" && value.backupName !== "") {
      return value as PatchReceipt;
    }
    if (typeof value.backupPath === "string" && value.backupPath !== "") {
      const name = value.backupPath.split("/").at(-1);
      return name === undefined ? undefined : { ...value, backupName: name } as PatchReceipt;
    }
    return undefined;
  } catch { return undefined; }
}
