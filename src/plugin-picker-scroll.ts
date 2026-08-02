const PLUGIN_LIST_SELECTOR = ".trans-hub-plugin-picker__list";

export function capturePluginListScrollTop(container: HTMLElement, fallback: number): number {
  return container.querySelector<HTMLElement>(PLUGIN_LIST_SELECTOR)?.scrollTop ?? fallback;
}

export function restorePluginListScrollTop(list: HTMLElement, scrollTop: number): void {
  const restoredScrollTop = Math.max(0, scrollTop);
  list.scrollTop = restoredScrollTop;

  // Obsidian 1.13 may rebuild custom settings once when an action starts and
  // again after its Notice is mounted.  The original list can be disconnected
  // before the latter render, so restore against whichever picker is currently
  // mounted for two bounded layout frames.
  const document = list.ownerDocument;
  const restoreMountedList = (): void => {
    const mountedList = document?.querySelector<HTMLElement>(PLUGIN_LIST_SELECTOR);
    if (mountedList !== null && mountedList !== undefined) {
      mountedList.scrollTop = restoredScrollTop;
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
