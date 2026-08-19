import {
  parseSourceCatalogIdentity,
  type SourceCatalogIdentity,
} from "@trans-hub/client-protocol";

import type { TransportClient } from "./http-transport";

export interface PublishedPluginSource {
  readonly sourceVersionId: string;
  readonly objectVersionId: string;
  readonly artifactDigest: string;
  readonly repository?: string;
  readonly sourceSnapshotDigest?: string;
  readonly catalogIdentity?: SourceCatalogIdentity;
  readonly catalogIdentityExact: boolean;
  readonly sourceUnitCount: number;
  readonly upstreamNativeCount: number;
  readonly upstreamScopedNativeCount?: number;
  readonly upstreamScopeCoverage?: Readonly<Record<string, number>>;
  readonly publishedUnitCount: number;
  readonly missingUnitCount: number;
}

export interface PublishedEcosystemCatalog {
  readonly objects: readonly Record<string, unknown>[];
}

export interface PublishedCatalogCoordinate {
  readonly pluginId: string;
  readonly pluginVersion: string;
}

export function resolvePublishedPluginArtifactDigestFromCatalog(
  catalog: PublishedEcosystemCatalog,
  input: Readonly<{
    pluginId: string;
    pluginVersion: string;
    targetLocale?: string;
  }>,
): string | undefined {
  const pluginObjects = catalog.objects.filter(
    (item): item is Record<string, unknown> => isRecord(item) && item.slug === input.pluginId,
  );
  if (pluginObjects.length === 0) return undefined;
  if (pluginObjects.length !== 1) {
    throw new Error(`Obsidian 插件目录存在重复对象：${input.pluginId}`);
  }
  const plugin = pluginObjects[0];
  if (!Array.isArray(plugin.versions)) {
    throw new Error("Obsidian 插件目录版本响应格式无效。");
  }
  const versions = plugin.versions.filter(
    (item): item is Record<string, unknown> => isRecord(item) && item.version_key === input.pluginVersion,
  );
  if (versions.length === 0) return undefined;
  if (versions.length !== 1) {
    throw new Error(`Obsidian 插件目录存在重复版本：${input.pluginId}@${input.pluginVersion}`);
  }
  const objectVersionDigest = requiredSha256(versions[0].content_digest, "插件版本制品摘要无效");
  // The immutable object-version digest is reused across same-version adapter
  // rescans (migration 185), so it may predate the current authoritative
  // catalog.  When a locale coverage row carries a catalog identity, its
  // artifactDigest is the current authoritative scan digest and must win.
  const objectVersionId = requiredString(versions[0].object_version_id, "插件版本缺少对象版本 ID");
  const coverage = Array.isArray(plugin.coverage) ? plugin.coverage : [];
  const authoritative = coverage.find((item): item is Record<string, unknown> => (
    isRecord(item)
    && item.object_version_id === objectVersionId
    && (input.targetLocale === undefined || item.target_locale === input.targetLocale)
    && isRecord(item.catalog_identity)
    && typeof item.catalog_identity.artifactDigest === "string"
  ));
  const identityDigest = (
    authoritative !== undefined
    && isRecord(authoritative.catalog_identity)
    && typeof authoritative.catalog_identity.artifactDigest === "string"
  )
    ? authoritative.catalog_identity.artifactDigest
    : undefined;
  return identityDigest ?? objectVersionDigest;
}

export async function loadPublishedEcosystemCatalog(
  transport: TransportClient,
  coordinates?: readonly PublishedCatalogCoordinate[],
  targetLocale?: string,
): Promise<PublishedEcosystemCatalog | undefined> {
  if (coordinates === undefined) {
    return loadPublishedEcosystemCatalogPage(transport, undefined, targetLocale);
  }
  if (coordinates.length === 0 || targetLocale === undefined) {
    throw new Error("Obsidian 公共目录坐标无效。");
  }
  const objects: Record<string, unknown>[] = [];
  for (let index = 0; index < coordinates.length; index += 100) {
    const page = await loadPublishedEcosystemCatalogPage(
      transport,
      coordinates.slice(index, index + 100),
      targetLocale,
    );
    if (page === undefined) return undefined;
    objects.push(...page.objects);
  }
  return { objects };
}

async function loadPublishedEcosystemCatalogPage(
  transport: TransportClient,
  coordinates: readonly PublishedCatalogCoordinate[] | undefined,
  targetLocale: string | undefined,
): Promise<PublishedEcosystemCatalog | undefined> {
  const query = new URLSearchParams();
  if (coordinates !== undefined) {
    if (coordinates.length === 0 || coordinates.length > 100 || targetLocale === undefined) {
      throw new Error("Obsidian 公共目录坐标无效。");
    }
    for (const coordinate of coordinates) {
      query.append("object_slug", coordinate.pluginId);
      query.append("version_key", coordinate.pluginVersion);
    }
    query.set("target_locale", targetLocale);
  }
  const response = await transport.send<unknown>({
    method: "GET",
    path: `/v1/public/ecosystems/obsidian${query.size === 0 ? "" : `?${query.toString()}`}`,
  });
  if (response.status === 404) return undefined;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`读取 Obsidian 公共目录失败：HTTP ${response.status}`);
  }
  if (!isRecord(response.body) || !isRecord(response.body.ecosystem)) {
    throw new Error("Obsidian 公共目录响应格式无效。");
  }
  if (response.body.ecosystem.slug !== "obsidian" || !Array.isArray(response.body.objects)) {
    throw new Error("Obsidian 公共目录身份不匹配。");
  }
  if (!response.body.objects.every(isRecord)) {
    throw new Error("Obsidian 公共目录对象格式无效。");
  }
  return { objects: response.body.objects };
}

export async function resolvePublishedPluginSource(input: {
  readonly transport: TransportClient;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly targetLocale: string;
  readonly localCatalogIdentity?: SourceCatalogIdentity;
}): Promise<PublishedPluginSource | undefined> {
  const catalog = await loadPublishedEcosystemCatalog(
    input.transport,
    [{ pluginId: input.pluginId, pluginVersion: input.pluginVersion }],
    input.targetLocale,
  );
  if (catalog === undefined) return undefined;
  return resolvePublishedPluginSourceFromCatalog(catalog, input);
}

export function resolvePublishedPluginSourceFromCatalog(
  catalog: PublishedEcosystemCatalog,
  input: Readonly<{
    pluginId: string;
    pluginVersion: string;
    targetLocale: string;
    localCatalogIdentity?: SourceCatalogIdentity;
  }>,
): PublishedPluginSource | undefined {
  const localCatalogIdentity = input.localCatalogIdentity;
  if (localCatalogIdentity === undefined) return undefined;
  const pluginObjects = catalog.objects.filter(
    (item): item is Record<string, unknown> => isRecord(item) && item.slug === input.pluginId,
  );
  if (pluginObjects.length === 0) return undefined;
  if (pluginObjects.length !== 1) throw new Error(`Obsidian 插件目录存在重复对象：${input.pluginId}`);
  const plugin = pluginObjects[0];
  if (!Array.isArray(plugin.versions) || !Array.isArray(plugin.coverage)) {
    throw new Error("Obsidian 插件目录版本响应格式无效。");
  }
  const versions = plugin.versions.filter(
    (item): item is Record<string, unknown> => isRecord(item) && item.version_key === input.pluginVersion,
  );
  if (versions.length === 0) return undefined;
  if (versions.length !== 1) {
    throw new Error(`Obsidian 插件目录存在重复版本：${input.pluginId}@${input.pluginVersion}`);
  }
  const objectVersionId = requiredString(versions[0].object_version_id, "插件版本缺少对象版本 ID");
  const objectVersionDigest = requiredSha256(versions[0].content_digest, "插件版本制品摘要无效");
  const repository = repositoryFromVerifiedExternalIdentity(
    versions[0].verified_external_registry_key,
    versions[0].canonical_external_identity,
  );
  const published = plugin.coverage.filter((item): item is Record<string, unknown> => (
    isRecord(item)
    && item.object_version_id === objectVersionId
    && item.target_locale === input.targetLocale
    && item.target_variant === "default"
    && typeof item.published_unit_count === "number"
    && typeof item.upstream_unit_count === "number"
    && typeof item.total_unit_count === "number"
    && typeof item.missing_unit_count === "number"
  ));
  if (published.length === 0) return undefined;
  const identified = published.flatMap((item) => {
    if (item.catalog_identity === null || item.catalog_identity === undefined) return [];
    const identity = parseSourceCatalogIdentity(item.catalog_identity);
    if (
      identity.resourceKey !== input.pluginId
      || identity.resourceVersion !== input.pluginVersion
    ) {
      throw new Error(`Obsidian 插件权威目录身份冲突：${input.pluginId}@${input.pluginVersion}`);
    }
    return [{ item, identity }];
  });
  const exact = identified.filter(({ identity }) => catalogIdentityEquals(
    identity,
    localCatalogIdentity,
  ));
  // A local installation may differ from the immutable release even though its
  // plugin id and manifest version are unchanged. The signed authority pack stays
  // safe because validation applies only the exact local string intersection.
  const candidates = exact.length > 0 ? exact : identified;
  if (candidates.length === 0) return undefined;
  const sourceVersionIds = [...new Set(candidates.map(
    ({ item }) => requiredString(item.source_version_id, "译文覆盖缺少源版本 ID"),
  ))];
  if (sourceVersionIds.length !== 1) {
    throw new Error(`Obsidian 插件权威目录发布源版本不唯一：${input.pluginId}@${input.pluginVersion}`);
  }
  const selected = candidates.filter(({ item }) => item.source_version_id === sourceVersionIds[0]);
  const selectedEntry = selected[0];
  if (selected.length !== 1 || selectedEntry === undefined) {
    throw new Error(`Obsidian 插件权威目录覆盖行不唯一：${input.pluginId}@${input.pluginVersion}`);
  }
  const sourceSnapshotDigests = [...new Set(selected
    .map(({ item }) => item.source_snapshot_digest)
    .filter((item): item is string => typeof item === "string" && item !== ""))];
  if (sourceSnapshotDigests.length > 1) {
    throw new Error(`Obsidian 插件源快照摘要冲突：${input.pluginId}@${input.pluginVersion}`);
  }
  const upstreamScopedNativeCount = optionalNonNegativeNumber(
    selectedEntry.item.upstream_scoped_unit_count,
  );
  const upstreamScopeCoverage = optionalNonNegativeNumberRecord(
    selectedEntry.item.upstream_scope_coverage,
    "插件自带范围覆盖无效",
  );
  return {
    sourceVersionId: requiredString(sourceVersionIds[0], "译文覆盖缺少源版本 ID"),
    objectVersionId,
    // The coverage catalog identity is the current authoritative scan digest;
    // the object-version digest is only a fallback for coverage without an
    // identity (same-version rescans reuse the immutable object version row).
    artifactDigest: selectedEntry.identity.artifactDigest ?? objectVersionDigest,
    ...(repository === undefined ? {} : { repository }),
    ...(sourceSnapshotDigests[0] === undefined
      ? {}
      : { sourceSnapshotDigest: requiredSha256(sourceSnapshotDigests[0], "源快照摘要无效") }),
    catalogIdentity: selectedEntry.identity,
    catalogIdentityExact: exact.some(({ item }) => item === selectedEntry.item),
    sourceUnitCount: requiredNonNegativeNumber(
      selectedEntry.item.total_unit_count,
      "插件权威源条目数量无效",
    ),
    upstreamNativeCount: requiredNonNegativeNumber(
      selectedEntry.item.upstream_unit_count,
      "插件自带覆盖数量无效",
    ),
    ...(upstreamScopedNativeCount === undefined ? {} : { upstreamScopedNativeCount }),
    ...(upstreamScopeCoverage === undefined ? {} : { upstreamScopeCoverage }),
    publishedUnitCount: requiredNonNegativeNumber(
      selectedEntry.item.published_unit_count,
      "语枢已发布覆盖数量无效",
    ),
    missingUnitCount: requiredNonNegativeNumber(
      selectedEntry.item.missing_unit_count,
      "插件缺失本地化数量无效",
    ),
  };
}

export function normalizeGitHubRepository(value: string): string | undefined {
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99}))\/([A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99}))$/u
    .exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
  return `${match[1]}/${match[2]}`;
}

function repositoryFromVerifiedExternalIdentity(
  registryKey: unknown,
  canonicalIdentity: unknown,
): string | undefined {
  if (registryKey !== "obsidian_community_plugins") return undefined;
  return typeof canonicalIdentity === "string"
    ? normalizeGitHubRepository(canonicalIdentity)
    : undefined;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return value === undefined || value === null
    ? undefined
    : requiredNonNegativeNumber(value, "插件自带范围数量无效");
}

function optionalNonNegativeNumberRecord(
  value: unknown,
  message: string,
): Readonly<Record<string, number>> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new Error(message);
  const entries = Object.entries(value);
  if (!entries.every(([key, count]) => key.trim() !== ""
    && typeof count === "number" && Number.isInteger(count) && count >= 0)) {
    throw new Error(message);
  }
  return Object.fromEntries(entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => [key, count as number]));
}

function catalogIdentityEquals(
  authority: SourceCatalogIdentity,
  local: SourceCatalogIdentity,
): boolean {
  return authority.protocol === local.protocol
    && authority.revision === local.revision
    && authority.resourceKey === local.resourceKey
    && authority.resourceVersion === local.resourceVersion
    && authority.sourceLocale === local.sourceLocale
    && authority.artifactDigest === local.artifactDigest
    && authority.unitCount === local.unitCount
    && authority.digest === local.digest
    && authority.scopes.length === local.scopes.length
    && authority.scopes.every((scope, index) => {
      const localScope = local.scopes[index];
      return localScope !== undefined
        && scope.scope === localScope.scope
        && scope.unitCount === localScope.unitCount
        && scope.digest === localScope.digest;
    });
}

function requiredSha256(value: unknown, message: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new Error(message);
  return value;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || value === "") throw new Error(message);
  return value;
}

function requiredNonNegativeNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
