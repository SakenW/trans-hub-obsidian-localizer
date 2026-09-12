import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const pluginRoot = resolve(import.meta.dirname, "..");
const publicRoot = existsSync(resolve(pluginRoot, "public-repository-template/README.md"))
  ? resolve(pluginRoot, "public-repository-template") : pluginRoot;
const read = (path) => readFileSync(path, "utf8");
const fail = (message) => { throw new Error(message); };
const manifest = JSON.parse(read(resolve(pluginRoot, "manifest.json")));
const packageJson = JSON.parse(read(resolve(pluginRoot, "package.json")));
const versions = JSON.parse(read(resolve(pluginRoot, "versions.json")));
if (packageJson.version !== manifest.version || versions[manifest.version] !== manifest.minAppVersion) {
  fail("Public version metadata is inconsistent.");
}
const translations = JSON.parse(read(resolve(publicRoot, "readme/translations.json")));
if (translations.source !== "readme/README.zh-CN.md" || translations.defaultLocale !== "en") {
  fail("README must use a Chinese source and English default entry.");
}
const withinPublicRoot = (relative) => {
  const path = resolve(publicRoot, relative);
  if (!path.startsWith(publicRoot + sep)) fail(`README path outside public root: ${relative}`);
  return path;
};
const source = read(withinPublicRoot(translations.source));
const sourceHash = createHash("sha256").update(source).digest("hex");
const sections = (text) => [...text.matchAll(/<!-- section: ([a-z-]+) -->/gu)].map((match) => match[1]);
const fences = (text) => [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gmu)].map((match) => match[1]);
const requiredSections = ["getting-started", "use-cases", "capabilities", "languages", "quality", "privacy", "faq", "contribute", "build"];
if (JSON.stringify(sections(source)) !== JSON.stringify(requiredSections)) fail("Chinese README sections are incomplete.");
const editions = translations.editions;
if (!Array.isArray(editions) || editions[0]?.locale !== "en" || editions[0]?.path !== "README.md"
  || new Set(editions.map((edition) => edition.locale)).size !== editions.length
  || new Set(editions.map((edition) => edition.path)).size !== editions.length
  || !editions.some((edition) => edition.locale === "zh-CN" && edition.path === translations.source)) {
  fail("README language navigation must start with English and include the Chinese source.");
}
const requiredLocales = ["en", "zh-CN", "zh-TW", "ja", "ko", "de", "fr", "es", "pt-BR", "ru"];
if (requiredLocales.some((locale) => !editions.some((edition) => edition.locale === locale))) fail("A required README edition is missing.");
const documents = editions.map((edition) => {
  const path = withinPublicRoot(edition.path);
  const content = read(path);
  if (edition.sourceSha256 !== sourceHash) fail(`Stale README translation: ${edition.path}`);
  if (JSON.stringify(sections(content)) !== JSON.stringify(requiredSections)) fail(`Missing README sections: ${edition.path}`);
  if (JSON.stringify(fences(content)) !== JSON.stringify(fences(source))) fail(`README commands differ: ${edition.path}`);
  if (!content.includes(manifest.minAppVersion)) fail(`README minimum app version is stale: ${edition.path}`);
  const pnpmVersion = packageJson.packageManager.split("@").at(-1);
  if (!content.includes(pnpmVersion)) fail(`README pnpm version is stale: ${edition.path}`);
  const navigation = content.split("\n").find((line) => line.includes("English") && line.includes(" · ")) ?? "";
  const labels = editions.map((item) => navigation.indexOf(item.label));
  if (labels.some((index) => index < 0) || labels.some((index, i) => i > 0 && index <= labels[i - 1])
    || !navigation.includes(`**${edition.label}**`)) fail(`README navigation order/current language is wrong: ${edition.path}`);
  for (const other of editions) {
    if (other.locale === edition.locale) continue;
    const link = [...navigation.matchAll(/\[([^\]]+)\]\(([^)]+)\)/gu)].find((match) => match[1] === other.label);
    if (!link || resolve(dirname(path), link[2]) !== withinPublicRoot(other.path)) fail(`README language link is wrong: ${edition.path} -> ${other.locale}`);
  }
  return { path, content };
});
// Structural checks flag drift; they cannot certify translation fidelity or runtime behavior.
if (manifest.isDesktopOnly !== false || !source.includes("高级兼容模式仅限桌面端，默认关闭")) {
  fail("Reconcile README platform claims with the manifest and patch restrictions.");
}
const english = documents[0].content;
if (!english.startsWith("# Trans-Hub Localizer") || !english.includes("API Key") && !english.includes("API key")) fail("English README introduction is incomplete.");
const publicFiles = [
  ...documents,
  ...[resolve(publicRoot, "CONTRIBUTING.md"), resolve(publicRoot, "esbuild.config.mjs"),
    resolve(publicRoot, "readme/translations.json"), resolve(pluginRoot, "SECURITY.md"),
    resolve(pluginRoot, "manifest.json"), resolve(pluginRoot, "package.json")].map((path) => ({ path, content: read(path) })),
];
const forbidden = [
  { label: "loopback host", pattern: /(?:127\.0\.0\.1|localhost|\[::1\])/iu },
  { label: "development endpoint override", pattern: /TRANS_HUB_OBSIDIAN_DEV_[A-Z0-9_]+/u },
  { label: "local absolute path", pattern: /(?:\/Users\/|\/Volumes\/|[A-Z]:\\Users\\)/u },
  { label: "database connection configuration", pattern: /(?:DATABASE_URL|postgres(?:ql)?:\/\/)/iu },
];
for (const { path, content } of publicFiles) {
  for (const rule of forbidden) if (rule.pattern.test(content)) fail(`Public-facing content: ${path}: ${rule.label}`);
  if (!path.endsWith(".md")) continue;
  for (const match of content.matchAll(/\]\(([^)\s]+)\)/gu)) {
    const href = match[1];
    if (/^[a-z][a-z\d+.-]*:/iu.test(href) || href.startsWith("#")) continue;
    const target = resolve(dirname(path), decodeURIComponent(href.split("#")[0]));
    // LICENSE is copied from the shared package when exporting the public repository.
    if (target === resolve(publicRoot, "LICENSE") && publicRoot !== pluginRoot) continue;
    if (!target.startsWith(publicRoot + sep) || !existsSync(target)) fail(`Broken public Markdown link: ${path}: ${href}`);
  }
}
const build = read(resolve(publicRoot, "esbuild.config.mjs"));
for (const required of ["https://api.trans-hub.net", "https://trans-hub.net", 'JSON.stringify("production")']) {
  if (!build.includes(required)) fail(`Missing production build marker: ${required}`);
}
process.stdout.write(`Public-facing content check passed (${editions.length} README languages).\n`);
