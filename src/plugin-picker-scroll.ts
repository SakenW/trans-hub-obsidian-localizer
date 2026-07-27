const PLUGIN_LIST_SELECTOR = ".trans-hub-plugin-picker__list";

export function capturePluginListScrollTop(container: HTMLElement, fallback: number): number {
  return container.querySelector<HTMLElement>(PLUGIN_LIST_SELECTOR)?.scrollTop ?? fallback;
}

export function restorePluginListScrollTop(list: HTMLElement, scrollTop: number): void {
  list.scrollTop = Math.max(0, scrollTop);
}
