import type { InstalledObsidianPlugin } from "./plugin-discovery";
import type { PluginState } from "./plugin-state";
import {
  resolveCommunityPluginSourceEligibility,
  type CommunityPluginSourceEligibility,
} from "./plugin-registry";

export type PluginSourceState = CommunityPluginSourceEligibility
  | { readonly kind: "published" }
  | { readonly kind: "pending" };
export type InstalledPluginWithSource = InstalledObsidianPlugin & { readonly source: PluginSourceState };
export type PluginSourceSnapshot = ReadonlyMap<string, {
  readonly pluginVersion: string;
  readonly source: PluginSourceState;
}>;

export async function resolveInstalledPluginSources(
  plugins: readonly InstalledObsidianPlugin[],
  resolveEligibility: typeof resolveCommunityPluginSourceEligibility = resolveCommunityPluginSourceEligibility,
  trustedPublishedVersions: ReadonlySet<string> = new Set(),
  sourceSnapshot: PluginSourceSnapshot = new Map(),
): Promise<InstalledPluginWithSource[]> {
  const snapshotSources = plugins.map((plugin) => {
    const snapshot = sourceSnapshot.get(plugin.id);
    return snapshot?.pluginVersion === plugin.version ? snapshot.source : undefined;
  });
  if (snapshotSources.every((source) => source !== undefined)) {
    return plugins.map((plugin, index) => ({
      ...plugin,
      source: snapshotSources[index],
    }));
  }
  const unresolvedPlugins = plugins.filter((_, index) => snapshotSources[index] === undefined);
  try {
    const eligibility = await resolveEligibility(unresolvedPlugins.map((plugin) => plugin.id));
    return plugins.map((plugin) => {
      const snapshot = sourceSnapshot.get(plugin.id);
      if (snapshot?.pluginVersion === plugin.version) return { ...plugin, source: snapshot.source };
      const source = eligibility.get(plugin.id) ?? { kind: "unsupported" as const };
      return {
        ...plugin,
        source: source.kind === "unsupported"
          && trustedPublishedVersions.has(pluginVersionKey(plugin.id, plugin.version))
          ? { kind: "published" as const }
          : source,
      };
    });
  } catch {
    return plugins.map((plugin) => {
      const snapshot = sourceSnapshot.get(plugin.id);
      return snapshot?.pluginVersion === plugin.version
        ? { ...plugin, source: snapshot.source }
        : { ...plugin, source: { kind: "pending" } };
    });
  }
}

export function trustedPublishedPluginVersions(
  state: PluginState,
): ReadonlySet<string> {
  const trusted = new Set<string>();
  for (const [pluginId, translations] of Object.entries(state.pluginTranslations)) {
    for (const translation of Object.values(translations)) {
      if (
        translation?.artifactDigest !== undefined
        && translation.catalogIdentity !== undefined
        && translation.sourceVersionId !== "manual-import"
      ) {
        trusted.add(pluginVersionKey(pluginId, translation.pluginVersion));
      }
    }
  }
  return trusted;
}

export function isPluginSourceSelectable(source: PluginSourceState): boolean {
  return source.kind === "supported" || source.kind === "published";
}

export function hasTrustedPublishedPluginVersion(
  trustedPublishedVersions: ReadonlySet<string>,
  pluginId: string,
  pluginVersion: string,
): boolean {
  return trustedPublishedVersions.has(pluginVersionKey(pluginId, pluginVersion));
}

function pluginVersionKey(pluginId: string, pluginVersion: string): string {
  return `${pluginId}\u0000${pluginVersion}`;
}
