import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const pluginRoot = resolve(import.meta.dirname, "..");
const publicTemplateRoot = existsSync(resolve(pluginRoot, "public-repository-template/README.md"))
  ? resolve(pluginRoot, "public-repository-template")
  : pluginRoot;
const publicReadmes = [
  resolve(publicTemplateRoot, "README.md"),
  resolve(publicTemplateRoot, "readme/README.zh-CN.md"),
];
const publicEsbuild = existsSync(resolve(pluginRoot, "public-repository-template/esbuild.config.mjs"))
  ? resolve(pluginRoot, "public-repository-template/esbuild.config.mjs")
  : resolve(pluginRoot, "esbuild.config.mjs");

const publicFiles = [
  ...publicReadmes,
  publicEsbuild,
  resolve(pluginRoot, "SECURITY.md"),
  resolve(pluginRoot, "manifest.json"),
  resolve(pluginRoot, "package.json"),
];

const [englishReadme, chineseReadme] = publicReadmes;
if (
  !readFileSync(englishReadme, "utf8").includes("readme/README.zh-CN.md")
  || !readFileSync(chineseReadme, "utf8").includes("../README.md")
) {
  throw new Error("Public README language navigation is incomplete.");
}

const forbidden = [
  { label: "loopback host", pattern: /(?:127\.0\.0\.1|localhost|\[::1\])/iu },
  { label: "development endpoint override", pattern: /TRANS_HUB_OBSIDIAN_DEV_[A-Z0-9_]+/u },
  { label: "local absolute path", pattern: /(?:\/Users\/|\/Volumes\/|[A-Z]:\\Users\\)/u },
  { label: "database connection configuration", pattern: /(?:DATABASE_URL|postgres(?:ql)?:\/\/)/iu },
];

const failures = [];
for (const path of publicFiles) {
  if (!existsSync(path)) throw new Error(`Public-facing file is missing: ${path}`);
  const content = readFileSync(path, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) failures.push(`${path}: ${rule.label}`);
  }
}

const publicBuildConfig = readFileSync(publicEsbuild, "utf8");
for (const required of [
  "https://api.trans-hub.net",
  "https://trans-hub.net",
  'JSON.stringify("production")',
]) {
  if (!publicBuildConfig.includes(required)) {
    failures.push(`${publicEsbuild}: missing production build marker ${required}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Public-facing content contains internal development details:\n${failures.join("\n")}`);
}

process.stdout.write("Public-facing content check passed.\n");
