import builtins from "builtin-modules";
import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  minify: true,
  sourcemap: false,
  treeShaking: true,
  outfile: "main.js",
  define: {
    __TRANS_HUB_OBSIDIAN_API_BASE_URL__: JSON.stringify("https://api.trans-hub.net"),
    __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__: JSON.stringify("production"),
    __TRANS_HUB_OBSIDIAN_REGISTRATION_URL__: JSON.stringify("https://trans-hub.net/register"),
    __TRANS_HUB_OBSIDIAN_WEB_BASE_URL__: JSON.stringify("https://trans-hub.net"),
  },
  alias: {
    "@trans-hub/client-protocol": "./packages/client-protocol/src/index.ts",
    "@trans-hub/public-client": "./packages/public-client/src/index.ts",
    "@trans-hub/uida": "./packages/uida/src/index.ts",
    "@trans-hub/language-tags": "./packages/language-tags/src/index.ts",
  },
});
