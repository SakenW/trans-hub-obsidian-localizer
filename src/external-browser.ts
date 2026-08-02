export type ExternalUrlOpener = (url: string) => Promise<void>;

export async function openSystemBrowser(
  rawUrl: string,
  opener: ExternalUrlOpener = electronExternalUrlOpener,
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

function isAllowedExternalProtocol(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
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
