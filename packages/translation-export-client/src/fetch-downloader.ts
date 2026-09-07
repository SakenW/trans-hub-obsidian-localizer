import type { PackDownloadPort } from "./contracts";

export type FetchPackDownloaderOptions = Readonly<{
  fetch: typeof fetch;
  developmentOrigin?: string;
}>;

export class FetchPackDownloader implements PackDownloadPort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: FetchPackDownloaderOptions) {
    this.fetchImpl = options.fetch;
    if (options.developmentOrigin !== undefined)
      validateDevelopmentOrigin(options.developmentOrigin);
  }

  async download(
    input: Readonly<{
      url: string;
      objectVersion: string;
      expectedBytes: number;
      allowedOrigin: string;
    }>,
  ): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(input.expectedBytes) ||
      input.expectedBytes <= 0
    ) {
      throw new Error("translation_pack_expected_size_invalid");
    }
    assertSafeDownloadUrl(
      input.url,
      input.allowedOrigin,
      this.options.developmentOrigin,
    );
    const response = await this.fetchImpl(input.url, {
      method: "GET",
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`translation_pack_download_failed:${response.status}`);
    // Fetch exposes decoded response bytes when HTTP Content-Encoding is used.
    // Content-Length may therefore describe transfer bytes, not the canonical
    // JSON object. The business contract is enforced against the decoded body.
    if (response.body === null) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== input.expectedBytes) {
        throw new Error("translation_pack_download_size_mismatch");
      }
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > input.expectedBytes) {
          await reader.cancel("translation pack exceeded declared size");
          throw new Error("translation_pack_download_size_mismatch");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (received !== input.expectedBytes) {
      throw new Error("translation_pack_download_size_mismatch");
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
}

export function assertSafeDownloadUrl(
  url: string,
  allowedOrigin: string,
  developmentOrigin?: string,
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("translation_ticket_url_invalid");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error("translation_ticket_url_invalid");
  }
  const allowed = parseOrigin(allowedOrigin, "translation_cdn_origin_invalid");
  if (parsed.origin !== allowed.origin) {
    throw new Error("translation_ticket_url_invalid");
  }
  if (parsed.protocol === "https:") return;
  if (developmentOrigin === undefined)
    throw new Error("translation_ticket_url_invalid");
  const expected = validateDevelopmentOrigin(developmentOrigin);
  if (parsed.protocol !== "http:" || parsed.origin !== expected.origin) {
    throw new Error("translation_ticket_url_invalid");
  }
}

function parseOrigin(value: string, code: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(code);
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== value
  ) {
    throw new Error(code);
  }
  return parsed;
}

function validateDevelopmentOrigin(origin: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("translation_development_download_origin_invalid");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("translation_development_download_origin_invalid");
  }
  return parsed;
}
