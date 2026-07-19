import eslint from "@eslint/js";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["main.js", "node_modules/**"],
  },
  ...obsidianmd.configs.recommended,
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/plugin-snapshot.ts", "src/snapshot.ts"],
    rules: {
      // These packages are bundled from explicit esbuild aliases, not resolved as installed runtime dependencies.
      "import/no-extraneous-dependencies": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // Test fixtures intentionally model the default .obsidian layout without a live Vault instance.
      "obsidianmd/hardcoded-config-path": "off",
    },
  },
);
