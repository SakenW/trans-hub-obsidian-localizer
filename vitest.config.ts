import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

function path(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  define: {
    __TRANS_HUB_OBSIDIAN_CLIENT_VERSION__: JSON.stringify(`obsidian-plugin/${manifest.version}`),
    __TRANS_HUB_OBSIDIAN_API_BASE_URL__: JSON.stringify("http://127.0.0.1:8000"),
    __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__: JSON.stringify("development"),
    __TRANS_HUB_OBSIDIAN_REGISTRATION_URL__: JSON.stringify("http://127.0.0.1:3000/register"),
    __TRANS_HUB_OBSIDIAN_TRANSFER_TRUST_ROOTS__: JSON.stringify([{
      keyId: "client-transfer-root-1",
      keyVersion: 1,
      publicKeyBase64Url: "B".repeat(43),
    }]),
    __TRANS_HUB_OBSIDIAN_WEB_BASE_URL__: JSON.stringify("http://127.0.0.1:3000"),
  },
  resolve: {
    alias: {
      "@trans-hub/client-protocol": path("packages/client-protocol/src/index.ts"),
      "@trans-hub/public-client": path("packages/public-client/src/index.ts"),
      "@trans-hub/translation-export-client/node": path("packages/translation-export-client/src/node.ts"),
      "@trans-hub/translation-export-client": path("packages/translation-export-client/src/index.ts"),
      "@trans-hub/uida": path("packages/uida/src/index.ts"),
      "@trans-hub/language-tags": path("packages/language-tags/src/index.ts"),
      obsidian: path("tests/obsidian-mock.ts"),
    },
  },
});
