import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";

import esbuild from "esbuild";

const externalBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];
const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
const transferRootKeyId = required("TRANS_HUB_TRANSFER_ROOT_KEY_ID", /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u);
const transferRootKeyVersion = required("TRANS_HUB_TRANSFER_ROOT_KEY_VERSION", /^[1-9][0-9]*$/u);
const transferRootPublicKey = required("TRANS_HUB_TRANSFER_ROOT_PUBLIC_KEY_B64", /^[A-Za-z0-9_-]{43}$/u);
const transferTrustRoots = [{
  keyId: transferRootKeyId,
  keyVersion: Number(transferRootKeyVersion),
  publicKeyBase64Url: transferRootPublicKey,
}];
const nextRoot = optionalTrustRoot();
if (nextRoot !== undefined) {
  if (nextRoot.keyId === transferRootKeyId && nextRoot.keyVersion === Number(transferRootKeyVersion)) {
    throw new Error("next trust root duplicates the current root");
  }
  transferTrustRoots.push(nextRoot);
}

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...externalBuiltins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  minify: true,
  sourcemap: false,
  treeShaking: true,
  outfile: "main.js",
  define: {
    __TRANS_HUB_OBSIDIAN_CLIENT_VERSION__: JSON.stringify(`obsidian-plugin/${manifest.version}`),
    __TRANS_HUB_OBSIDIAN_API_BASE_URL__: JSON.stringify("https://api.trans-hub.net"),
    __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__: JSON.stringify("production"),
    __TRANS_HUB_OBSIDIAN_REGISTRATION_URL__: JSON.stringify("https://trans-hub.net/register"),
    __TRANS_HUB_OBSIDIAN_TRANSFER_TRUST_ROOTS__: JSON.stringify(transferTrustRoots),
    __TRANS_HUB_OBSIDIAN_WEB_BASE_URL__: JSON.stringify("https://trans-hub.net"),
  },
  alias: {
    "@trans-hub/client-protocol": "./packages/client-protocol/src/index.ts",
    "@trans-hub/public-client": "./packages/public-client/src/index.ts",
    "@trans-hub/translation-export-client/node": "./packages/translation-export-client/src/node.ts",
    "@trans-hub/translation-export-client": "./packages/translation-export-client/src/index.ts",
    "@trans-hub/uida": "./packages/uida/src/index.ts",
    "@trans-hub/language-tags": "./packages/language-tags/src/index.ts",
  },
});

function required(name, pattern) {
  const value = process.env[name]?.trim() ?? "";
  if (!pattern.test(value)) throw new Error(`${name} is missing or invalid`);
  return value;
}

function optionalTrustRoot() {
  const names = [
    "TRANS_HUB_TRANSFER_NEXT_ROOT_KEY_ID",
    "TRANS_HUB_TRANSFER_NEXT_ROOT_KEY_VERSION",
    "TRANS_HUB_TRANSFER_NEXT_ROOT_PUBLIC_KEY_B64",
  ];
  const values = names.map((name) => process.env[name]?.trim() ?? "");
  if (values.every((value) => value === "")) return undefined;
  if (values.some((value) => value === "")) throw new Error("next trust root is incomplete");
  return {
    keyId: required(names[0], /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u),
    keyVersion: Number(required(names[1], /^[1-9][0-9]*$/u)),
    publicKeyBase64Url: required(names[2], /^[A-Za-z0-9_-]{43}$/u),
  };
}
