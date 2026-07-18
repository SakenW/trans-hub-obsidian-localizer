export interface SelectablePlugin {
  readonly id: string;
  readonly name: string;
}

export function selectedPluginCount(
  pluginIds: readonly string[],
  excludedPluginIds: readonly string[],
): number {
  const excluded = new Set(excludedPluginIds);
  return pluginIds.filter((pluginId) => !excluded.has(pluginId)).length;
}

export function setPluginSelected(
  excludedPluginIds: readonly string[],
  pluginId: string,
  selected: boolean,
): string[] {
  const excluded = new Set(excludedPluginIds);
  if (selected) excluded.delete(pluginId);
  else excluded.add(pluginId);
  return [...excluded].sort();
}

export function setAllPluginsSelected(
  excludedPluginIds: readonly string[],
  pluginIds: readonly string[],
  selected: boolean,
): string[] {
  const excluded = new Set(excludedPluginIds);
  for (const pluginId of pluginIds) {
    if (selected) excluded.delete(pluginId);
    else excluded.add(pluginId);
  }
  return [...excluded].sort();
}

export function filterSelectablePlugins<T extends SelectablePlugin>(
  plugins: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = query.normalize("NFC").trim().toLocaleLowerCase();
  if (normalizedQuery === "") return [...plugins];
  return plugins.filter((plugin) =>
    `${plugin.name}\n${plugin.id}`.normalize("NFC").toLocaleLowerCase().includes(normalizedQuery),
  );
}
