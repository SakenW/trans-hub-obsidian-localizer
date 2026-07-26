import { describe, expect, it } from "vitest";

import type { TransportClient } from "../src/http-transport";
import { resolvePublishedPluginSource } from "../src/plugin-source-resolution";

const SOURCE_VERSION_ID = "019f0000-0000-7000-8000-000000000001";
const OBJECT_VERSION_ID = "019f0000-0000-7000-8000-000000000002";
const ARTIFACT_DIGEST = "ab".repeat(32);
const SNAPSHOT_DIGEST = "cd".repeat(32);
const CATALOG_IDENTITY = {
  protocol: "trans-hub.source-catalog-identity",
  revision: 1,
  resourceKey: "dataview",
  resourceVersion: "0.5.68",
  sourceLocale: "en",
  artifactDigest: ARTIFACT_DIGEST,
  unitCount: 77,
  digest: "ef".repeat(32),
  scopes: [{ scope: "runtime-ui", unitCount: 77, digest: "12".repeat(32) }],
} as const;

describe("resolvePublishedPluginSource", () => {
  it("resolves an exact published Obsidian plugin version and locale", async () => {
    const result = await resolvePublishedPluginSource({
      transport: transport(200, catalog()),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    });
    expect(result).toEqual({
      sourceVersionId: SOURCE_VERSION_ID,
      objectVersionId: OBJECT_VERSION_ID,
      artifactDigest: ARTIFACT_DIGEST,
      sourceSnapshotDigest: SNAPSHOT_DIGEST,
      catalogIdentity: CATALOG_IDENTITY,
      sourceUnitCount: 77,
      upstreamNativeCount: 0,
      publishedUnitCount: 77,
      missingUnitCount: 0,
    });
  });

  it("waits when the exact version has neither published nor upstream coverage", async () => {
    const body = catalog();
    body.objects[0].coverage[0].published_unit_count = 0;
    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).resolves.toBeUndefined();
  });

  it("resolves native-only coverage without pretending a TH pack exists", async () => {
    const body = catalog();
    body.objects[0].coverage[0].published_unit_count = 0;
    body.objects[0].coverage[0].upstream_unit_count = 65;
    body.objects[0].coverage[0].missing_unit_count = 12;
    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).resolves.toEqual({
      sourceVersionId: SOURCE_VERSION_ID,
      objectVersionId: OBJECT_VERSION_ID,
      artifactDigest: ARTIFACT_DIGEST,
      sourceSnapshotDigest: SNAPSHOT_DIGEST,
      catalogIdentity: CATALOG_IDENTITY,
      sourceUnitCount: 77,
      upstreamNativeCount: 65,
      publishedUnitCount: 0,
      missingUnitCount: 12,
    });
  });

  it("fails closed when one plugin version resolves to multiple source versions", async () => {
    const body = catalog();
    body.objects[0].coverage.push({
      ...body.objects[0].coverage[0],
      source_version_id: "019f0000-0000-7000-8000-000000000003",
      published_unit_count: 999,
    });
    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).rejects.toThrow("不唯一");
  });

  it("fails closed when the authority repeats the same exact coverage coordinate", async () => {
    const body = catalog();
    body.objects[0].coverage.push({ ...body.objects[0].coverage[0] });
    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).rejects.toThrow("覆盖行不唯一");
  });

  it("ignores higher-coverage candidates whose catalog identity does not match", async () => {
    const body = catalog();
    body.objects[0].coverage[0].published_unit_count = 70;
    body.objects[0].coverage[0].missing_unit_count = 7;
    body.objects[0].coverage.push({
      ...body.objects[0].coverage[0],
      source_version_id: "019f0000-0000-7000-8000-000000000003",
      published_unit_count: 77,
      catalog_identity: { ...CATALOG_IDENTITY, digest: "99".repeat(32) },
    });
    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).resolves.toEqual({
      sourceVersionId: SOURCE_VERSION_ID,
      objectVersionId: OBJECT_VERSION_ID,
      artifactDigest: ARTIFACT_DIGEST,
      sourceSnapshotDigest: SNAPSHOT_DIGEST,
      catalogIdentity: CATALOG_IDENTITY,
      sourceUnitCount: 77,
      upstreamNativeCount: 0,
      publishedUnitCount: 70,
      missingUnitCount: 7,
    });
  });

  it("does not select legacy authority catalogs", async () => {
    const legacy = catalog();
    delete (legacy.objects[0].coverage[0] as Record<string, unknown>).catalog_identity;
    await expect(resolvePublishedPluginSource({
      transport: transport(200, legacy),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).resolves.toBeUndefined();
  });

  it("downloads one mismatched authority catalog for safe per-string intersection", async () => {
    const mismatch = catalog();
    mismatch.objects[0].coverage[0].catalog_identity = {
      ...CATALOG_IDENTITY,
      digest: "99".repeat(32),
    };
    await expect(resolvePublishedPluginSource({
      transport: transport(200, mismatch),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).resolves.toEqual(expect.objectContaining({
      sourceVersionId: SOURCE_VERSION_ID,
      catalogIdentity: mismatch.objects[0].coverage[0].catalog_identity,
    }));

    const scopeMismatch = catalog();
    scopeMismatch.objects[0].coverage[0].catalog_identity = {
      ...CATALOG_IDENTITY,
      scopes: [{ ...CATALOG_IDENTITY.scopes[0], digest: "98".repeat(32) }],
    };
    await expect(resolvePublishedPluginSource({
      transport: transport(200, scopeMismatch),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).resolves.toEqual(expect.objectContaining({
      sourceVersionId: SOURCE_VERSION_ID,
      catalogIdentity: scopeMismatch.objects[0].coverage[0].catalog_identity,
    }));

    const artifactMismatch = catalog();
    const authorityIdentity = {
      ...CATALOG_IDENTITY,
      artifactDigest: "34".repeat(32),
      digest: "56".repeat(32),
    };
    artifactMismatch.objects[0].versions[0].content_digest = authorityIdentity.artifactDigest;
    artifactMismatch.objects[0].coverage[0].catalog_identity = authorityIdentity;
    await expect(resolvePublishedPluginSource({
      transport: transport(200, artifactMismatch),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).resolves.toEqual(expect.objectContaining({
      sourceVersionId: SOURCE_VERSION_ID,
      artifactDigest: authorityIdentity.artifactDigest,
      catalogIdentity: authorityIdentity,
    }));
  });

  it("fails closed when mismatched authority catalogs are ambiguous", async () => {
    const body = catalog();
    body.objects[0].coverage[0].catalog_identity = {
      ...CATALOG_IDENTITY,
      digest: "99".repeat(32),
    };
    body.objects[0].coverage.push({
      ...body.objects[0].coverage[0],
      source_version_id: "019f0000-0000-7000-8000-000000000003",
      catalog_identity: { ...CATALOG_IDENTITY, digest: "98".repeat(32) },
    });
    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).rejects.toThrow("不唯一");
  });
});

function transport(status: number, body: unknown): TransportClient {
  return {
    send: <TResponse>() => Promise.resolve({ status, body: body as TResponse, headers: {} }),
  };
}

function catalog() {
  return {
    ecosystem: { slug: "obsidian" },
    objects: [{
      slug: "dataview",
      versions: [{
        object_version_id: OBJECT_VERSION_ID,
        version_key: "0.5.68",
        content_digest: ARTIFACT_DIGEST,
      }],
      coverage: [{
        object_version_id: OBJECT_VERSION_ID,
        source_version_id: SOURCE_VERSION_ID,
        target_locale: "zh-CN",
        target_variant: "default",
        published_unit_count: 77,
        upstream_unit_count: 0,
        total_unit_count: 77,
        missing_unit_count: 0,
        source_snapshot_digest: SNAPSHOT_DIGEST,
        catalog_identity: CATALOG_IDENTITY,
      }],
    }],
  };
}
