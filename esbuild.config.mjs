import process from "node:process";

import builtins from "builtin-modules";
import esbuild from "esbuild";

const channel = process.argv[2] ?? "development";
if (channel !== "development" && channel !== "production") {
  throw new Error(`未知 Obsidian 构建通道：${channel}`);
}
const production = channel === "production";
const apiBaseUrl = production
  ? "https://api.trans-hub.net"
  : normalizeDevelopmentBaseUrl(
    process.env.TRANS_HUB_OBSIDIAN_DEV_API_BASE_URL ?? "http://127.0.0.1:8000",
    "开发 API",
  );
const webBaseUrl = production
  ? "https://trans-hub.net"
  : normalizeDevelopmentBaseUrl(
    process.env.TRANS_HUB_OBSIDIAN_DEV_WEB_BASE_URL ?? "http://127.0.0.1:3000",
    "开发 Web",
  );

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  minify: production,
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  define: {
    __TRANS_HUB_OBSIDIAN_API_BASE_URL__: JSON.stringify(apiBaseUrl),
    __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__: JSON.stringify(channel),
    __TRANS_HUB_OBSIDIAN_REGISTRATION_URL__: JSON.stringify(`${webBaseUrl}/register`),
    __TRANS_HUB_OBSIDIAN_WEB_BASE_URL__: JSON.stringify(webBaseUrl),
  },
  alias: {
    "@trans-hub/client-protocol": "./packages/client-protocol/src/index.ts",
    "@trans-hub/public-client": "./packages/public-client/src/index.ts",
    "@trans-hub/uida": "./packages/uida/src/index.ts",
    "@trans-hub/language-tags": "./packages/language-tags/src/index.ts",
  },
});

function normalizeDevelopmentBaseUrl(value, label) {
  const parsed = new URL(value.trim());
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${label} 必须是无内嵌凭据的 HTTP(S) 地址。`);
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "[::1]") {
    throw new Error(`${label} 只允许本机回环地址；正式服务地址由 production 构建固定注入。`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
  const normalized = parsed.toString().replace(/\/$/u, "");
  return normalized;
}
