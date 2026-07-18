import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const releaseRoot = resolve(root, "release");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const pluginRoot = resolve(releaseRoot, manifest.id);
const archive = resolve(releaseRoot, `${manifest.id}-${manifest.version}.zip`);

execFileSync(process.execPath, [resolve(root, "esbuild.config.mjs"), "production"], {
  cwd: root,
  stdio: "inherit",
});
verifyProductionBundle(readFileSync(resolve(root, "main.js"), "utf8"));
rmSync(pluginRoot, { recursive: true, force: true });
rmSync(archive, { force: true });
mkdirSync(pluginRoot, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  cpSync(resolve(root, file), resolve(pluginRoot, file));
}
execFileSync("zip", ["-q", "-r", archive, manifest.id], {
  cwd: releaseRoot,
  stdio: "inherit",
});
process.stdout.write(`${archive}\n`);

function verifyProductionBundle(bundle) {
  const required = ["https://api.trans-hub.net", "https://trans-hub.net/register"];
  const forbidden = ["http://127.0.0.1", "https://127.0.0.1", "http://localhost", "https://localhost"];
  for (const marker of required) {
    if (!bundle.includes(marker)) throw new Error(`正式制品缺少固定标记：${marker}`);
  }
  for (const marker of forbidden) {
    if (bundle.includes(marker)) throw new Error(`正式制品包含开发环境标记：${marker}`);
  }
}
