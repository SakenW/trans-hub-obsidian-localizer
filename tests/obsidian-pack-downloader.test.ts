import { describe, expect, it, vi } from "vitest";

import { ObsidianPackDownloader } from "../src/obsidian-pack-downloader";

describe("ObsidianPackDownloader", () => {
  it("downloads a loopback development pack through requestUrl", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      arrayBuffer: new Uint8Array([1, 2, 3]).buffer,
      json: null,
      text: "",
    });
    const downloader = new ObsidianPackDownloader({
      developmentOrigin: "http://127.0.0.1:8000",
      request,
    });

    await expect(downloader.download({
      url: "http://127.0.0.1:8000/v1/dev/object-storage/private/pack.zst",
      objectVersion: "v1",
    })).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(request).toHaveBeenCalledWith({
      url: "http://127.0.0.1:8000/v1/dev/object-storage/private/pack.zst",
      method: "GET",
      throw: false,
    });
  });

  it("rejects an untrusted download URL before requestUrl", async () => {
    const request = vi.fn();
    const downloader = new ObsidianPackDownloader({
      developmentOrigin: "http://127.0.0.1:8000",
      request,
    });

    await expect(downloader.download({
      url: "http://example.test/pack.zst",
      objectVersion: "v1",
    })).rejects.toThrow("translation_ticket_url_invalid");
    expect(request).not.toHaveBeenCalled();
  });
});
