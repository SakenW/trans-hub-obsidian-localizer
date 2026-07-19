import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

function path(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

export default defineConfig({
  define: {
    __TRANS_HUB_OBSIDIAN_CLIENT_VERSION__: JSON.stringify("obsidian-plugin/0.1.1"),
    __TRANS_HUB_OBSIDIAN_API_BASE_URL__: JSON.stringify("http://127.0.0.1:8000"),
    __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__: JSON.stringify("development"),
    __TRANS_HUB_OBSIDIAN_REGISTRATION_URL__: JSON.stringify("http://127.0.0.1:3000/register"),
    __TRANS_HUB_OBSIDIAN_WEB_BASE_URL__: JSON.stringify("http://127.0.0.1:3000"),
  },
  resolve: {
    alias: {
      "@trans-hub/client-protocol": path("packages/client-protocol/src/index.ts"),
      "@trans-hub/public-client": path("packages/public-client/src/index.ts"),
      "@trans-hub/uida": path("packages/uida/src/index.ts"),
      "@trans-hub/language-tags": path("packages/language-tags/src/index.ts"),
      obsidian: path("tests/obsidian-mock.ts"),
    },
  },
});
