export interface PackDownloadPort {
  download(input: Readonly<{
    url: string;
    objectVersion: string;
    expectedBytes: number;
    allowedOrigin: string;
  }>): Promise<Uint8Array>;
}

type StrictFetch = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

export class ObsidianPackDownloader implements PackDownloadPort {
  private readonly request: StrictFetch;

  constructor(private readonly options: {
    readonly developmentOrigin?: string;
    readonly request?: StrictFetch;
    /** Bound a stalled CDN response; decoded JSON still has an exact byte check. */
    readonly timeoutMs?: number;
  } = {}) {
    this.request = options.request ?? ((url, init) => window.fetch(url, init));
    if (
      !Number.isSafeInteger(options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS)
      || (options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS) <= 0
    ) {
      throw new TypeError("translation_pack_download_timeout_invalid");
    }
  }

  async download(input: Readonly<{
    url: string;
    objectVersion: string;
    expectedBytes: number;
    allowedOrigin: string;
  }>): Promise<Uint8Array> {
    if (!Number.isSafeInteger(input.expectedBytes) || input.expectedBytes <= 0) {
      throw new Error("translation_pack_expected_size_invalid");
    }
    assertSafeDownloadUrl(
      input.url,
      input.allowedOrigin,
      this.options.developmentOrigin,
    );
    const controller = new AbortController();
    const timer = window.activeWindow.setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await this.request(input.url, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new Error("translation_pack_download_timeout");
      }
      throw new Error("translation_pack_redirect_or_network_rejected");
    } finally {
      window.activeWindow.clearTimeout(timer);
    }
    if (response.redirected) {
      throw new Error("translation_pack_redirect_rejected");
    }
    assertSafeDownloadUrl(
      response.url,
      input.allowedOrigin,
      this.options.developmentOrigin,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`translation_pack_download_failed:${response.status}`);
    }
    return readBoundedResponse(response, input.expectedBytes);
  }
}

async function readBoundedResponse(response: Response, expectedBytes: number): Promise<Uint8Array> {
  // Electron's current Chromium provides a stream here.  If a future host
  // does not, keep the exact decoded-byte contract instead of trusting the
  // transfer Content-Length (which is smaller under gzip/br).
  if (response.body == null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== expectedBytes) {
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
      if (received > expectedBytes) {
        await reader.cancel("translation pack exceeded declared size");
        throw new Error("translation_pack_download_size_mismatch");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (received !== expectedBytes) {
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

function assertSafeDownloadUrl(
  value: string,
  allowedOrigin: string,
  developmentOrigin?: string,
): void {
  const url = new URL(value);
  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new Error("translation_ticket_url_invalid");
  }
  const allowed = parseOrigin(allowedOrigin, "translation_cdn_origin_invalid");
  if (url.origin !== allowed.origin) {
    throw new Error("translation_ticket_url_invalid");
  }
  if (url.protocol === "https:") return;
  if (
    developmentOrigin !== undefined
    && url.origin === parseDevelopmentOrigin(developmentOrigin).origin
  ) return;
  throw new Error("translation_ticket_url_invalid");
}

function parseOrigin(value: string, code: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(code);
  }
  if (
    !["https:", "http:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || parsed.origin !== value
  ) throw new Error(code);
  return parsed;
}

function parseDevelopmentOrigin(value: string): URL {
  const parsed = parseOrigin(
    value,
    "translation_development_download_origin_invalid",
  );
  if (
    parsed.protocol !== "http:"
    || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
  ) throw new Error("translation_development_download_origin_invalid");
  return parsed;
}
