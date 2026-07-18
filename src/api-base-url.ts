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
  if (url.protocol === "http:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]") {
    throw new Error("非本地 TH API 必须使用 HTTPS。");
  }
  return normalized;
}
