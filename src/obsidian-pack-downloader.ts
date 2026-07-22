import { requestUrl, type RequestUrlResponse } from "obsidian";

export interface PackDownloadPort {
  download(input: Readonly<{
    url: string;
    objectVersion: string;
    expectedBytes: number;
  }>): Promise<Uint8Array>;
}

type ObsidianRequest = (request: {
  readonly url: string;
  readonly method: string;
  readonly throw: boolean;
}) => Promise<RequestUrlResponse>;

export class ObsidianPackDownloader implements PackDownloadPort {
  private readonly request: ObsidianRequest;

  constructor(private readonly options: {
    readonly developmentOrigin?: string;
    readonly request?: ObsidianRequest;
  } = {}) {
    this.request = options.request ?? requestUrl;
  }

  async download(input: Readonly<{
    url: string;
    objectVersion: string;
    expectedBytes: number;
  }>): Promise<Uint8Array> {
    assertSafeDownloadUrl(input.url, this.options.developmentOrigin);
    const response = await this.request({
      url: input.url,
      method: "GET",
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`translation_pack_download_failed:${response.status}`);
    }
    const bytes = new Uint8Array(response.arrayBuffer);
    if (bytes.byteLength !== input.expectedBytes) {
      throw new Error("translation_pack_download_size_mismatch");
    }
    return bytes;
  }
}

function assertSafeDownloadUrl(value: string, developmentOrigin?: string): void {
  const url = new URL(value);
  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new Error("translation_ticket_url_invalid");
  }
  if (url.protocol === "https:") return;
  if (developmentOrigin !== undefined && url.origin === new URL(developmentOrigin).origin) return;
  throw new Error("translation_ticket_url_invalid");
}
