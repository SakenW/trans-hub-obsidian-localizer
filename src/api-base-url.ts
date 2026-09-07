declare const __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__: "development" | "production";

const ALLOW_LOOPBACK_HTTP = __TRANS_HUB_OBSIDIAN_BUILD_CHANNEL__ === "development";

export function normalizeHttpBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function assertSafeApiBaseUrl(value: string): string {
  const normalized = normalizeHttpBaseUrl(value);
  if (normalized === null) throw new Error("TH API 基址无效。");
  const url = new URL(normalized);
  if (url.protocol === "http:" && (!ALLOW_LOOPBACK_HTTP || !isLoopbackHost(url.hostname))) {
    throw new Error("非本地 TH API 必须使用 HTTPS。");
  }
  return normalized;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}
