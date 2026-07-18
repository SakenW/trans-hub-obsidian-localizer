import { requestUrl } from "obsidian";

const OBSIDIAN_COMMUNITY_REGISTRY =
  "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";

export interface CommunityPluginIdentity {
  readonly repository: string;
  readonly officialName: string;
  readonly officialDescription: string;
  readonly candidateLocators: readonly string[];
}

interface CommunityPluginRegistryEntry {
  readonly repository: string;
  readonly officialName: string;
  readonly officialDescription: string;
}

let cachedRegistry: ReadonlyMap<string, CommunityPluginRegistryEntry> | null = null;

export async function resolveCommunityPluginIdentity(
  pluginId: string,
  pluginVersion: string,
): Promise<CommunityPluginIdentity> {
  const registry = cachedRegistry ?? await loadCommunityRegistry();
  cachedRegistry = registry;
  const entry = registry.get(pluginId);
  if (entry === undefined) {
    throw new Error(`Obsidian 官方社区目录中找不到插件：${pluginId}`);
  }
  const { repository } = entry;
  const root = `https://github.com/${repository}`;
  return {
    repository,
    officialName: entry.officialName,
    officialDescription: entry.officialDescription,
    candidateLocators: [
      root,
      `${root}/releases/tag/${encodeURIComponent(pluginVersion)}`,
      `${root}/releases/tag/v${encodeURIComponent(pluginVersion)}`,
    ],
  };
}

async function loadCommunityRegistry(): Promise<ReadonlyMap<string, CommunityPluginRegistryEntry>> {
  const response = await requestUrl({
    url: OBSIDIAN_COMMUNITY_REGISTRY,
    method: "GET",
    throw: false,
  });
  if (response.status !== 200) {
    throw new Error(`读取 Obsidian 官方社区目录失败：HTTP ${response.status}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(response.text) as unknown;
  } catch {
    throw new Error("Obsidian 官方社区目录不是有效 JSON。");
  }
  return parseCommunityRegistry(value);
}

export function parseCommunityRegistry(
  value: unknown,
): ReadonlyMap<string, CommunityPluginRegistryEntry> {
  if (!Array.isArray(value)) throw new Error("Obsidian 官方社区目录格式无效。");
  const entries = value.map((item): readonly [string, CommunityPluginRegistryEntry] => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.repo !== "string"
      || typeof item.name !== "string" || typeof item.description !== "string") {
      throw new Error("Obsidian 官方社区目录条目格式无效。");
    }
    if (!/^[^/\s]+\/[^/\s]+$/u.test(item.repo)) {
      throw new Error(`Obsidian 官方社区目录 repo 无效：${item.id}`);
    }
    const officialName = item.name.normalize("NFC").trim();
    const officialDescription = item.description.normalize("NFC").trim();
    if (officialName === "" || officialDescription === "") {
      throw new Error(`Obsidian 官方社区目录元数据为空：${item.id}`);
    }
    return [item.id, { repository: item.repo, officialName, officialDescription }];
  });
  return new Map(entries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
