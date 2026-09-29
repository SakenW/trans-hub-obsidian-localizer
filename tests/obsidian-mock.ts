type RequestUrlHandler = (input: unknown) => Promise<unknown>;

export class App {}

export const Platform = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
};

export class PluginSettingTab {
  containerEl = { querySelector: () => null } as unknown as HTMLElement;

  constructor(_app: App, _plugin: unknown) {}

  getSettingDefinitions(): unknown[] {
    return [];
  }

  display(): void {}
}

export class Setting {}
export class Modal {}

export class MenuItem {
  title: string | DocumentFragment = "";
  setTitle(title: string | DocumentFragment): this { this.title = title; return this; }
}

let requestUrlHandler: RequestUrlHandler = () =>
  Promise.reject(new Error("requestUrl is not available in unit tests"));

export function requestUrl(input: unknown): Promise<unknown> {
  return requestUrlHandler(input);
}

export function setRequestUrlHandler(handler: RequestUrlHandler): void {
  requestUrlHandler = handler;
}

export function resetRequestUrlHandler(): void {
  requestUrlHandler = () =>
    Promise.reject(new Error("requestUrl is not available in unit tests"));
}

export function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/\/{2,}/gu, "/");
}

export class Notice {
  constructor(message: string, timeout?: number) {
    void message;
    void timeout;
  }
}
