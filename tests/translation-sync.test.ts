import { describe, expect, it } from "vitest";

import {
  parseObsidianTranslationPack,
  parsePluginTranslationPack,
  type TranslationExportManifest,
  type TranslationPackRef,
} from "../src/translation-sync";

describe("parseObsidianTranslationPack", () => {
  it("accepts exact Obsidian occurrence scope", () => {
    const manifest = manifestFixture();
    const pack = manifest.packs[0];
    const payload = new TextEncoder().encode(JSON.stringify({
      schema: "trans-hub.translation-pack",
      version: 1,
      source_version_id: manifest.sourceVersionId,
      target_locale: manifest.targetLocale,
      target_variant: manifest.targetVariant,
      pack_index: 0,
      items: [{ occurrence_key: "obsidian:block:note:block", target_text: "译文", payload_digest: `sha256:${"a".repeat(64)}`, structured_content: {} }],
    }));
    expect(parseObsidianTranslationPack(payload, manifest, pack)).toEqual([{ noteId: "note", blockId: "block", translatedText: "译文", translationDigest: `sha256:${"a".repeat(64)}` }]);
  });

  it("rejects non-Obsidian rows", () => {
    const manifest = manifestFixture();
    const pack = manifest.packs[0];
    const payload = new TextEncoder().encode(JSON.stringify({
      schema: "trans-hub.translation-pack", version: 1,
      source_version_id: manifest.sourceVersionId, target_locale: manifest.targetLocale,
      target_variant: manifest.targetVariant, pack_index: 0,
      items: [{ occurrence_key: "usage:file:key", target_text: "x", payload_digest: "sha256:x", structured_content: {} }],
    }));
    expect(() => parseObsidianTranslationPack(payload, manifest, pack)).toThrow("不属于 Obsidian");
  });
});

describe("parsePluginTranslationPack", () => {
  it("accepts exact plugin UI occurrence scope", () => {
    const manifest = manifestFixture();
    const pack = manifest.packs[0];
    const key = "a".repeat(32);
    const payload = new TextEncoder().encode(JSON.stringify({
      schema: "trans-hub.translation-pack",
      version: 1,
      source_version_id: manifest.sourceVersionId,
      target_locale: manifest.targetLocale,
      target_variant: manifest.targetVariant,
      pack_index: 0,
      items: [{
        occurrence_key: `obsidian:plugin-ui:sample-plugin:${key}`,
        target_text: "设置",
        payload_digest: `sha256:${"b".repeat(64)}`,
        structured_content: {
          delivery_provenance: {
            kind: "th-reviewed-correction",
            application: "correction",
            native_target: "设定",
          },
        },
      }],
    }));
    expect(parsePluginTranslationPack(payload, manifest, pack)).toEqual([{
      pluginId: "sample-plugin",
      stringKey: key,
      translatedText: "设置",
      translationDigest: `sha256:${"b".repeat(64)}`,
      provenanceKind: "th-reviewed-correction",
      application: "correction",
      nativeTarget: "设定",
    }]);
  });

  it("rejects a correction without exact reviewed native text", () => {
    const manifest = manifestFixture();
    const pack = manifest.packs[0];
    const payload = new TextEncoder().encode(JSON.stringify({
      schema: "trans-hub.translation-pack", version: 1,
      source_version_id: manifest.sourceVersionId, target_locale: manifest.targetLocale,
      target_variant: manifest.targetVariant, pack_index: 0,
      items: [{
        occurrence_key: `obsidian:plugin-ui:sample-plugin:${"a".repeat(32)}`,
        target_text: "设置", payload_digest: `sha256:${"b".repeat(64)}`,
        structured_content: { delivery_provenance: { kind: "th-reviewed-correction", application: "correction" } },
      }],
    }));
    expect(() => parsePluginTranslationPack(payload, manifest, pack)).toThrow("correction_invalid");

    const mislabeled = new TextEncoder().encode(JSON.stringify({
      schema: "trans-hub.translation-pack", version: 1,
      source_version_id: manifest.sourceVersionId, target_locale: manifest.targetLocale,
      target_variant: manifest.targetVariant, pack_index: 0,
      items: [{
        occurrence_key: `obsidian:plugin-ui:sample-plugin:${"a".repeat(32)}`,
        target_text: "设置", payload_digest: `sha256:${"b".repeat(64)}`,
        structured_content: {
          delivery_provenance: { kind: "th-reviewed-correction", application: "fill" },
        },
      }],
    }));
    expect(() => parsePluginTranslationPack(mislabeled, manifest, pack)).toThrow("correction_invalid");
  });
});

function manifestFixture(): TranslationExportManifest {
  const pack: TranslationPackRef = {
    packId: "pack", packIndex: 0, itemCount: 1, compressedBytes: 1, uncompressedBytes: 1,
    objectVersion: "v1", transportDigest: "sha256:a",
    canonicalPayloadDigest: "sha256:b", logicalObjectDigest: "sha256:c",
  };
  return {
    manifestId: "manifest", sourceVersionId: "version", targetLocale: "zh-CN",
    targetVariant: "default", scope: { kind: "public", publicScopeId: "scope" },
    packs: [pack],
  };
}
