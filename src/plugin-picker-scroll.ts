const PLUGIN_LIST_SELECTOR = ".trans-hub-plugin-picker__list";

/** The settings host owns scrolling; the plugin list has no scroll viewport. */
export function pluginScrollContainer(element: HTMLElement): HTMLElement {
  const view = element.ownerDocument?.defaultView;
  if (typeof view?.getComputedStyle === "function") {
    for (let parent: HTMLElement | null = element; parent !== null; parent = parent.parentElement) {
      if (/^(auto|scroll|overlay)$/u.test(view.getComputedStyle(parent).overflowY)) return parent;
    }
  }
  return element;
}

export function capturePluginListScrollTop(container: HTMLElement, fallback: number): number {
  const list = container.querySelector<HTMLElement>(PLUGIN_LIST_SELECTOR);
  if (list === null || list.closest?.<HTMLElement>(".trans-hub-settings__panel")?.hidden) return fallback;
  return pluginScrollContainer(list).scrollTop;
}

export function restorePluginListScrollTop(list: HTMLElement, scrollTop: number): void {
  const restoredScrollTop = Math.max(0, scrollTop);
  if (list.closest?.<HTMLElement>(".trans-hub-settings__panel")?.hidden) return;
  pluginScrollContainer(list).scrollTop = restoredScrollTop;

  // Obsidian 1.13 may rebuild custom settings once when an action starts and
  // again after its Notice is mounted.  The original list can be disconnected
  // before the latter render, so restore against whichever picker is currently
  // mounted for two bounded layout frames.
  const document = list.ownerDocument;
  const restoreMountedList = (): void => {
    const mountedList = document?.querySelector<HTMLElement>(PLUGIN_LIST_SELECTOR);
    if (mountedList !== null && mountedList !== undefined) {
      if (!mountedList.closest?.<HTMLElement>(".trans-hub-settings__panel")?.hidden) {
        pluginScrollContainer(mountedList).scrollTop = restoredScrollTop;
      }
    }
  };
  const view = document?.defaultView;
  const requestAnimationFrame = view?.requestAnimationFrame;
  if (requestAnimationFrame !== undefined) {
    requestAnimationFrame.call(view, () => {
      restoreMountedList();
      requestAnimationFrame.call(view, restoreMountedList);
    });
  }
}
