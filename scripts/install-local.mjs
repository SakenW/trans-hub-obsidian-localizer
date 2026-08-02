import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const arguments_ = process.argv.slice(2);
const vaultPath = resolveVaultPath(arguments_);
const allowDirty = arguments_.includes("--allow-dirty");
assertDirectoryWithoutSymlink(vaultPath, "Vault");
const obsidianRoot = resolve(vaultPath, ".obsidian");
assertDirectoryWithoutSymlink(obsidianRoot, "Obsidian 配置目录");

const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const pluginsRoot = resolve(obsidianRoot, "plugins");
mkdirSync(pluginsRoot, { recursive: true });
assertDirectoryWithoutSymlink(pluginsRoot, "插件目录");
const pluginRoot = resolve(pluginsRoot, manifest.id);
mkdirSync(pluginRoot, { recursive: true });
assertDirectoryWithoutSymlink(pluginRoot, "插件安装目录");

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const gitStatus = execFileSync("git", ["status", "--porcelain", "--", "."], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
const sourceDirty = gitStatus !== "";
if (sourceDirty && !allowDirty) {
  throw new Error("工作区包含未提交的 Obsidian 插件改动；拒绝生成错误归因的本地安装回执。");
}

execFileSync(process.execPath, [resolve(root, "esbuild.config.mjs"), "production"], {
  cwd: root,
  stdio: "inherit",
});
const bundle = readFileSync(resolve(root, "main.js"), "utf8");
verifyProductionBundle(bundle);

const dataPath = resolve(pluginRoot, "data.json");
const dataDigestBefore = existsSync(dataPath) ? sha256(readFileSync(dataPath)) : null;
const installedFiles = {};
const transactionId = `${process.pid}-${Date.now()}`;
const stagedFiles = [];
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  const source = resolve(root, file);
  if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink()) {
    throw new Error(`安装源文件无效：${file}`);
  }
  const destination = resolve(pluginRoot, basename(file));
  assertReplaceableFile(destination, file);
  const temporary = `${destination}.install-${transactionId}`;
  copyFileSync(source, temporary);
  const sourceDigest = sha256(readFileSync(source));
  if (sourceDigest !== sha256(readFileSync(temporary))) {
    throw new Error(`安装暂存哈希不一致：${file}`);
  }
  installedFiles[file] = sourceDigest;
  stagedFiles.push({ destination, temporary });
}

const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
const receipt = {
  schema: "trans-hub.obsidian-local-install-receipt",
  version: 1,
  pluginVersion: manifest.version,
  sourceCommit,
  sourceDirty,
  installedFiles,
};
const receiptPath = resolve(pluginRoot, "install-receipt.json");
assertReplaceableFile(receiptPath, "install-receipt.json");
const temporaryReceipt = `${receiptPath}.install-${transactionId}`;
writeFileSync(temporaryReceipt, `${JSON.stringify(receipt, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
stagedFiles.push({ destination: receiptPath, temporary: temporaryReceipt });
replaceTransaction(stagedFiles, transactionId, () => {
  const dataDigestAfter = existsSync(dataPath) ? sha256(readFileSync(dataPath)) : null;
  if (dataDigestAfter !== dataDigestBefore) {
    throw new Error("本地安装意外修改了 data.json。");
  }
  for (const [file, expectedDigest] of Object.entries(installedFiles)) {
    if (sha256(readFileSync(resolve(pluginRoot, file))) !== expectedDigest) {
      throw new Error(`安装后哈希不一致：${file}`);
    }
  }
});
process.stdout.write(`${JSON.stringify({ pluginRoot, ...receipt })}\n`);

function resolveVaultPath(args) {
  const flagIndex = args.indexOf("--vault");
  const fromArgument = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
  const value = fromArgument ?? process.env.OBSIDIAN_VAULT_PATH;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("请通过 --vault 或 OBSIDIAN_VAULT_PATH 指定 Obsidian Vault。");
  }
  return resolve(value.trim());
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertDirectoryWithoutSymlink(path, label) {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new Error(`${label}不存在或不是目录：${path}`);
  }
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`拒绝通过符号链接${label}安装 Obsidian 插件。`);
  }
}

function assertReplaceableFile(path, label) {
  if (!existsSync(path)) return;
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`拒绝覆盖非普通文件：${label}`);
  }
}

function replaceTransaction(entries, transactionId, verifyInstalled) {
  const prepared = entries.map(({ destination, temporary }) => ({
    backup: `${destination}.backup-${transactionId}`,
    destination,
    hadOriginal: existsSync(destination),
    temporary,
  }));
  const installed = [];
  let committed = false;
  try {
    for (const entry of prepared) {
      if (entry.hadOriginal) renameSync(entry.destination, entry.backup);
      renameSync(entry.temporary, entry.destination);
      installed.push(entry);
    }
    verifyInstalled();
    committed = true;
  } catch (error) {
    for (const entry of [...installed].reverse()) {
      rmSync(entry.destination, { force: true });
      if (entry.hadOriginal && existsSync(entry.backup)) {
        renameSync(entry.backup, entry.destination);
      }
    }
    for (const entry of prepared) {
      if (entry.hadOriginal && existsSync(entry.backup) && !existsSync(entry.destination)) {
        renameSync(entry.backup, entry.destination);
      }
    }
    throw error;
  } finally {
    for (const entry of prepared) {
      rmSync(entry.temporary, { force: true });
      if (committed) rmSync(entry.backup, { force: true });
    }
  }
}

function verifyProductionBundle(value) {
  const required = ["https://api.trans-hub.net", "https://trans-hub.net/register"];
  const forbidden = [
    "http://127.0.0.1",
    "https://127.0.0.1",
    "http://localhost",
    "https://localhost",
  ];
  for (const marker of required) {
    if (!value.includes(marker)) throw new Error(`正式制品缺少固定标记：${marker}`);
  }
  for (const marker of forbidden) {
    if (value.includes(marker)) throw new Error(`正式制品包含开发环境标记：${marker}`);
  }
}
