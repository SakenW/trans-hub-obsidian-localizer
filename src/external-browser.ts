import { Platform } from "obsidian";

export type ExternalUrlOpener = (url: string) => Promise<void>;

declare const __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__: "development" | "production";

const ALLOW_LOOPBACK_HTTP = __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__ === "development";

export async function openSystemBrowser(
  rawUrl: string,
  opener: ExternalUrlOpener = defaultExternalUrlOpener,
): Promise<void> {
  const url = new URL(rawUrl);
  if (
    url.username !== ""
    || url.password !== ""
    || !isAllowedExternalProtocol(url)
  ) {
    throw new Error("只能在系统浏览器中打开可信的 HTTP(S) 地址。");
  }
  await opener(url.toString());
}

async function defaultExternalUrlOpener(url: string): Promise<void> {
  if (Platform.isDesktopApp) {
    await electronExternalUrlOpener(url);
    return;
  }
  // Mobile runs the plugin in a WebView. Opening a separate browsing context
  // preserves the vault view so the `obsidian://` callback can return here.
  if (window.open(url, "_blank", "noopener") === null) {
    throw new Error("当前 Obsidian 无法打开系统浏览器。");
  }
}

function isAllowedExternalProtocol(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ALLOW_LOOPBACK_HTTP && isLoopbackHost(url.hostname);
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

async function electronExternalUrlOpener(url: string): Promise<void> {
  // Obsidian's desktop renderer exposes Electron at runtime. Keeping this as a
  // lazy external require lets unit tests run without installing Electron.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron is provided only by the Obsidian desktop runtime.
  const runtime = require("electron") as {
    readonly shell?: { readonly openExternal?: (value: string) => Promise<void> };
  };
  if (runtime.shell?.openExternal === undefined) {
    throw new Error("当前 Obsidian 无法调用系统默认浏览器。");
  }
  await runtime.shell.openExternal(url);
}
