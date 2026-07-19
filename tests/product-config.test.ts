import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  OBSIDIAN_AUTH_CALLBACK_ACTION,
  OBSIDIAN_CLIENT_VERSION,
  OBSIDIAN_ECOSYSTEM_SLUG,
  OBSIDIAN_PLUGIN_ID,
  OBSIDIAN_SOURCE_LOCALE,
  TARGET_LOCALE_OPTIONS,
  TRANS_HUB_API_BASE_URL,
  TRANS_HUB_BUILD_CHANNEL,
  TRANS_HUB_OBSIDIAN_ECOSYSTEM_URL,
  TRANS_HUB_REGISTRATION_URL,
  TRANS_HUB_WEB_BASE_URL,
  parseTargetLocale,
  resolveObsidianTargetLocale,
} from "../src/product-config";

describe("Obsidian product configuration", () => {
  it("keeps the release manifest aligned with the public product identity", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.id).toBe(OBSIDIAN_PLUGIN_ID);
    expect(OBSIDIAN_CLIENT_VERSION).toBe(`obsidian-plugin/${String(manifest.version)}`);
    expect(manifest.name).toBe("Trans-Hub Localizer");
    const description = manifest.description;
    expect(typeof description).toBe("string");
    expect((description as string).length).toBeLessThanOrEqual(250);
    expect(description).toMatch(/\.$/u);
    expect(description).toContain("translate");
    expect(description).toContain("localize");
    expect(description).toContain("community plugin");
    expect(description).not.toContain("Obsidian");
  });

  it("publishes searchable GitHub metadata without keyword stuffing the manifest", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    const manifest = JSON.parse(
      await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(packageJson.version).toBe(manifest.version);
    expect(packageJson.description).toContain("Obsidian community plugin");
    expect(packageJson.keywords).toEqual(expect.arrayContaining([
      "obsidian-plugin", "translation", "translator", "localization", "i18n", "trans-hub",
    ]));
  });

  it("fixes the ecosystem and source language", () => {
    expect(OBSIDIAN_ECOSYSTEM_SLUG).toBe("obsidian");
    expect(OBSIDIAN_PLUGIN_ID).toBe("trans-hub-plugin-localizer");
    expect(OBSIDIAN_AUTH_CALLBACK_ACTION).toBe("trans-hub-plugin-localizer-auth");
    expect(OBSIDIAN_SOURCE_LOCALE).toBe("en");
  });

  it("exposes a closed target-language list instead of arbitrary input", () => {
    expect(TARGET_LOCALE_OPTIONS.map((option) => option.value)).toContain("zh-CN");
    expect(parseTargetLocale("ja")).toBe("ja");
    expect(parseTargetLocale("en")).toBe("en");
    expect(parseTargetLocale("not-a-locale")).toBe("zh-CN");
  });

  it("maps the Obsidian app language to the initial target language", () => {
    expect(resolveObsidianTargetLocale("zh-Hant")).toBe("zh-TW");
    expect(resolveObsidianTargetLocale("zh-HK")).toBe("zh-TW");
    expect(resolveObsidianTargetLocale("zh")).toBe("zh-CN");
    expect(resolveObsidianTargetLocale("pt_BR")).toBe("pt-BR");
    expect(resolveObsidianTargetLocale("en-US")).toBe("en");
    expect(resolveObsidianTargetLocale("it-IT")).toBe("en");
  });

  it("uses the deterministic local fallback when tests do not inject build constants", () => {
    expect(TRANS_HUB_BUILD_CHANNEL).toBe("development");
    expect(TRANS_HUB_API_BASE_URL).toBe("http://127.0.0.1:8000");
    expect(TRANS_HUB_WEB_BASE_URL).toBe("http://127.0.0.1:3000");
    expect(TRANS_HUB_REGISTRATION_URL).toBe("http://127.0.0.1:3000/register");
    expect(TRANS_HUB_OBSIDIAN_ECOSYSTEM_URL)
      .toBe("http://127.0.0.1:3000/ecosystems/obsidian");
  });
});
