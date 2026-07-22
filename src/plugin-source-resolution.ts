import {
  parseSourceCatalogIdentity,
  type SourceCatalogIdentity,
} from "@trans-hub/client-protocol";

import type { TransportClient } from "./http-transport";

export interface PublishedPluginSource {
  readonly sourceVersionId: string;
  readonly objectVersionId: string;
  readonly artifactDigest: string;
  readonly sourceSnapshotDigest?: string;
  readonly catalogIdentity?: SourceCatalogIdentity;
  readonly upstreamNativeCount: number;
}

export interface PublishedEcosystemCatalog {
  readonly objects: readonly Record<string, unknown>[];
}

export async function loadPublishedEcosystemCatalog(
  transport: TransportClient,
): Promise<PublishedEcosystemCatalog | undefined> {
  const response = await transport.send<unknown>({
    method: "GET",
    path: "/v1/public/ecosystems/obsidian",
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
  const catalog = await loadPublishedEcosystemCatalog(input.transport);
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
  const artifactDigest = requiredSha256(versions[0].content_digest, "插件版本制品摘要无效");
  if (artifactDigest !== localCatalogIdentity.artifactDigest) return undefined;
  const published = plugin.coverage.filter((item): item is Record<string, unknown> => (
    isRecord(item)
    && item.object_version_id === objectVersionId
    && item.target_locale === input.targetLocale
    && item.target_variant === "default"
    && typeof item.published_unit_count === "number"
    && typeof item.upstream_unit_count === "number"
    && (item.published_unit_count > 0 || item.upstream_unit_count > 0)
  ));
  if (published.length === 0) return undefined;
  const identified = published.flatMap((item) => {
    if (item.catalog_identity === null || item.catalog_identity === undefined) return [];
    const identity = parseSourceCatalogIdentity(item.catalog_identity);
    if (
      identity.resourceKey !== input.pluginId
      || identity.resourceVersion !== input.pluginVersion
      || identity.artifactDigest !== artifactDigest
    ) {
      throw new Error(`Obsidian 插件权威目录身份冲突：${input.pluginId}@${input.pluginVersion}`);
    }
    return [{ item, identity }];
  });
  const exact = identified.filter(({ identity }) => catalogIdentityEquals(
    identity,
    localCatalogIdentity,
  ));
  if (exact.length === 0) return undefined;
  const sourceVersionIds = [...new Set(exact.map(
    ({ item }) => requiredString(item.source_version_id, "译文覆盖缺少源版本 ID"),
  ))];
  if (sourceVersionIds.length !== 1) {
    throw new Error(`Obsidian 插件精确目录发布源版本不唯一：${input.pluginId}@${input.pluginVersion}`);
  }
  const selected = exact.filter(({ item }) => item.source_version_id === sourceVersionIds[0]);
  const selectedEntry = selected[0];
  if (selected.length !== 1 || selectedEntry === undefined) {
    throw new Error(`Obsidian 插件精确目录覆盖行不唯一：${input.pluginId}@${input.pluginVersion}`);
  }
  const sourceSnapshotDigests = [...new Set(selected
    .map(({ item }) => item.source_snapshot_digest)
    .filter((item): item is string => typeof item === "string" && item !== ""))];
  if (sourceSnapshotDigests.length > 1) {
    throw new Error(`Obsidian 插件源快照摘要冲突：${input.pluginId}@${input.pluginVersion}`);
  }
  return {
    sourceVersionId: requiredString(sourceVersionIds[0], "译文覆盖缺少源版本 ID"),
    objectVersionId,
    artifactDigest,
    ...(sourceSnapshotDigests[0] === undefined
      ? {}
      : { sourceSnapshotDigest: requiredSha256(sourceSnapshotDigests[0], "源快照摘要无效") }),
    catalogIdentity: selectedEntry.identity,
    upstreamNativeCount: requiredNonNegativeNumber(
      selectedEntry.item.upstream_unit_count,
      "插件自带覆盖数量无效",
    ),
  };
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
