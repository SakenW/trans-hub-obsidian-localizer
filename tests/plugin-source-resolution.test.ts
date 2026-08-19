import { describe, expect, it } from "vitest";

import type { TransportClient } from "../src/http-transport";
import {
  resolvePublishedPluginArtifactDigestFromCatalog,
  resolvePublishedPluginSource,
} from "../src/plugin-source-resolution";

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
  it("reads the immutable release artifact even before locale coverage exists", () => {
    const body = catalog();
    body.objects[0].coverage = [];

    expect(resolvePublishedPluginArtifactDigestFromCatalog(body, {
      pluginId: "dataview",
      pluginVersion: "0.5.68",
    })).toBe(ARTIFACT_DIGEST);
  });

  it("prefers the coverage catalog identity digest over the reused object-version digest", () => {
    const body = catalog();
    const authorityIdentity = {
      ...CATALOG_IDENTITY,
      artifactDigest: "78".repeat(32),
      digest: "89".repeat(32),
    };
    body.objects[0].versions[0].content_digest = ARTIFACT_DIGEST;
    body.objects[0].coverage[0].catalog_identity = authorityIdentity;

    expect(resolvePublishedPluginArtifactDigestFromCatalog(body, {
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
    })).toBe(authorityIdentity.artifactDigest);
  });

  it("resolves an exact published Obsidian plugin version and locale", async () => {
    const requestPaths: string[] = [];
    const result = await resolvePublishedPluginSource({
      transport: transport(200, catalog(), requestPaths),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    });
    expect(result).toEqual({
      sourceVersionId: SOURCE_VERSION_ID,
      objectVersionId: OBJECT_VERSION_ID,
      artifactDigest: ARTIFACT_DIGEST,
      repository: "blacksmithgu/obsidian-dataview",
      sourceSnapshotDigest: SNAPSHOT_DIGEST,
      catalogIdentity: CATALOG_IDENTITY,
      catalogIdentityExact: true,
      sourceUnitCount: 77,
      upstreamNativeCount: 0,
      publishedUnitCount: 77,
      missingUnitCount: 0,
    });
    expect(requestPaths[0]).toContain("object_slug=dataview");
    expect(requestPaths[0]).toContain("version_key=0.5.68");
    expect(requestPaths[0]).toContain("target_locale=zh-CN");
  });

  it("maps only the verified Obsidian registry owner/repo identity to GitHub", async () => {
    const body = catalog();
    Object.assign(body.objects[0].versions[0], {
      verified_external_registry_key: "obsidian_community_plugins",
      canonical_external_identity: "owner/generic",
    });

    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).resolves.toEqual(expect.objectContaining({ repository: "owner/generic" }));

    Object.assign(body.objects[0].versions[0], {
      canonical_external_identity: "owner/generic/releases/latest",
    });
    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).resolves.not.toHaveProperty("repository");

    for (const identity of [
      "owner//generic",
      "https://github.com/owner/generic",
      "owner/generic?download=1",
      "owner/generic#readme",
    ]) {
      Object.assign(body.objects[0].versions[0], { canonical_external_identity: identity });
      await expect(resolvePublishedPluginSource({
        transport: transport(200, body),
        pluginId: "dataview",
        pluginVersion: "0.5.68",
        targetLocale: "zh-CN",
        localCatalogIdentity: CATALOG_IDENTITY,
      })).resolves.not.toHaveProperty("repository");
    }

    Object.assign(body.objects[0].versions[0], {
      verified_external_registry_key: "generic_registry",
      canonical_external_identity: "owner/generic",
    });
    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).resolves.not.toHaveProperty("repository");
  });

  it("tolerates a reused object-version digest after a same-version adapter rescan", async () => {
    // Migration 185 reuses the immutable object-version row on a same-version
    // adapter rescan, so versions[].content_digest can legitimately differ
    // from the current coverage catalog_identity.artifactDigest.  The client
    // must use the coverage identity as the authoritative digest instead of
    // failing with an "identity conflict".
    const body = catalog();
    const authorityIdentity = {
      ...CATALOG_IDENTITY,
      artifactDigest: "34".repeat(32),
      digest: "56".repeat(32),
    };
    body.objects[0].versions[0].content_digest = ARTIFACT_DIGEST;
    body.objects[0].coverage[0].catalog_identity = authorityIdentity;

    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).resolves.toEqual(expect.objectContaining({
      sourceVersionId: SOURCE_VERSION_ID,
      catalogIdentityExact: false,
      artifactDigest: authorityIdentity.artifactDigest,
      catalogIdentity: authorityIdentity,
    }));
  });

  it("keeps the authoritative source when locale coverage is still zero", async () => {
    const body = catalog();
    body.objects[0].coverage[0].published_unit_count = 0;
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
      repository: "blacksmithgu/obsidian-dataview",
      sourceSnapshotDigest: SNAPSHOT_DIGEST,
      catalogIdentity: CATALOG_IDENTITY,
      catalogIdentityExact: true,
      sourceUnitCount: 77,
      upstreamNativeCount: 0,
      publishedUnitCount: 0,
      missingUnitCount: 0,
    });
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
      repository: "blacksmithgu/obsidian-dataview",
      sourceSnapshotDigest: SNAPSHOT_DIGEST,
      catalogIdentity: CATALOG_IDENTITY,
      catalogIdentityExact: true,
      sourceUnitCount: 77,
      upstreamNativeCount: 65,
      publishedUnitCount: 0,
      missingUnitCount: 12,
    });
  });

  it("preserves generic scope attribution for upstream-native coverage", async () => {
    const body = catalog();
    body.objects[0].coverage[0].upstream_unit_count = 15;
    Object.assign(body.objects[0].coverage[0], {
      upstream_scoped_unit_count: 15,
      upstream_scope_coverage: { "runtime-ui": 15 },
    });
    await expect(resolvePublishedPluginSource({
      transport: transport(200, body),
      pluginId: "dataview",
      pluginVersion: "0.5.68",
      targetLocale: "zh-CN",
      localCatalogIdentity: CATALOG_IDENTITY,
    })).resolves.toEqual(expect.objectContaining({
      upstreamNativeCount: 15,
      upstreamScopedNativeCount: 15,
      upstreamScopeCoverage: { "runtime-ui": 15 },
    }));
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
      repository: "blacksmithgu/obsidian-dataview",
      sourceSnapshotDigest: SNAPSHOT_DIGEST,
      catalogIdentity: CATALOG_IDENTITY,
      catalogIdentityExact: true,
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
      catalogIdentityExact: false,
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
      catalogIdentityExact: false,
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
      catalogIdentityExact: false,
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

function transport(status: number, body: unknown, paths: string[] = []): TransportClient {
  return {
    send: <TResponse>(request: { readonly path: string }) => {
      paths.push(request.path);
      return Promise.resolve({ status, body: body as TResponse, headers: {} });
    },
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
        verified_external_registry_key: "obsidian_community_plugins",
        canonical_external_identity: "blacksmithgu/obsidian-dataview",
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
