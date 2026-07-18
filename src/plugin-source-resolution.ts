import type { TransportClient } from "./http-transport";

export interface PublishedPluginSource {
  readonly sourceVersionId: string;
  readonly objectVersionId: string;
}

export async function resolvePublishedPluginSource(input: {
  readonly transport: TransportClient;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly targetLocale: string;
}): Promise<PublishedPluginSource | undefined> {
  const response = await input.transport.send<unknown>({
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
  const pluginObjects = response.body.objects.filter(
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
  const published = plugin.coverage.filter((item): item is Record<string, unknown> => (
    isRecord(item)
    && item.object_version_id === objectVersionId
    && item.target_locale === input.targetLocale
    && item.target_variant === "default"
    && typeof item.published_unit_count === "number"
    && item.published_unit_count > 0
  ));
  if (published.length === 0) return undefined;
  const highestPublishedUnitCount = Math.max(...published.map(
    (item) => requiredPositiveNumber(item.published_unit_count, "译文覆盖数量无效"),
  ));
  const sourceVersionIds = [...new Set(published
    .filter((item) => item.published_unit_count === highestPublishedUnitCount)
    .map((item) => requiredString(item.source_version_id, "译文覆盖缺少源版本 ID")))];
  if (sourceVersionIds.length !== 1) {
    throw new Error(`Obsidian 插件发布源版本不唯一：${input.pluginId}@${input.pluginVersion}`);
  }
  return {
    sourceVersionId: requiredString(sourceVersionIds[0], "译文覆盖缺少源版本 ID"),
    objectVersionId,
  };
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || value === "") throw new Error(message);
  return value;
}

function requiredPositiveNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
