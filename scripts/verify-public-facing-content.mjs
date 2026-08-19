import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const pluginRoot = resolve(import.meta.dirname, "..");
const publicTemplateRoot = existsSync(resolve(pluginRoot, "public-repository-template/README.md"))
  ? resolve(pluginRoot, "public-repository-template")
  : pluginRoot;
const publicReadme = resolve(publicTemplateRoot, "README.md");
const publicEsbuild = existsSync(resolve(pluginRoot, "public-repository-template/esbuild.config.mjs"))
  ? resolve(pluginRoot, "public-repository-template/esbuild.config.mjs")
  : resolve(pluginRoot, "esbuild.config.mjs");

const publicFiles = [
  publicReadme,
  publicEsbuild,
  resolve(pluginRoot, "SECURITY.md"),
  resolve(pluginRoot, "manifest.json"),
  resolve(pluginRoot, "package.json"),
];

const primaryReadmeContent = readFileSync(publicReadme, "utf8");
if (
  !primaryReadmeContent.includes("简体中文见下方")
  || !primaryReadmeContent.includes("# 语枢 · 插件本地化")
  || primaryReadmeContent.includes('href="readme/README.zh-CN.md"')
) {
  throw new Error("Primary public README must contain inline Simplified Chinese content.");
}
for (const required of [
  "Runtime **i18n** and localization",
  "Server-authoritative, version-aware translations",
  "Safe runtime i18n, not file rewriting",
  "运行时 **I18n** 与本地化",
  "服务端权威、版本精确",
  "安全的运行时 I18n，而不是改写文件",
]) {
  if (!primaryReadmeContent.includes(required)) {
    throw new Error("Primary public README is missing its public trust contract: " + required);
  }
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
