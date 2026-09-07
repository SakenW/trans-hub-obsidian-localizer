import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from "node:timers";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ObsidianPackDownloader } from "../src/obsidian-pack-downloader";

beforeEach(() => {
  const activeWindow = {
    setTimeout: (
      callback: (...args: never[]) => void,
      delay?: number,
    ) => setNodeTimeout(callback, delay),
    clearTimeout: (timer: ReturnType<typeof setNodeTimeout>) => clearNodeTimeout(timer),
  } as unknown as Window;
  vi.stubGlobal("window", { activeWindow });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("ObsidianPackDownloader", () => {
  it("downloads a loopback development pack with redirects disabled", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      redirected: false,
      url: "http://127.0.0.1:8000/v1/dev/object-storage/private/pack.json",
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    });
    const downloader = new ObsidianPackDownloader({
      developmentOrigin: "http://127.0.0.1:8000",
      request,
    });

    await expect(downloader.download({
      url: "http://127.0.0.1:8000/v1/dev/object-storage/private/pack.json",
      objectVersion: "v1",
      expectedBytes: 3,
      allowedOrigin: "http://127.0.0.1:8000",
    })).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(request).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/v1/dev/object-storage/private/pack.json",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      }),
    );
  });

  it("rejects an untrusted download URL before requestUrl", async () => {
    const request = vi.fn();
    const downloader = new ObsidianPackDownloader({
      developmentOrigin: "http://127.0.0.1:8000",
      request,
    });

    await expect(downloader.download({
      url: "http://example.test/pack.json",
      objectVersion: "v1",
      expectedBytes: 3,
      allowedOrigin: "https://cdn.example",
    })).rejects.toThrow("translation_ticket_url_invalid");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects redirects without accepting bytes from a different origin", async () => {
    const request = vi.fn().mockRejectedValue(new TypeError("redirect mode is error"));
    const downloader = new ObsidianPackDownloader({ request });

    await expect(downloader.download({
      url: "https://cdn.example/pack.json",
      objectVersion: "v1",
      expectedBytes: 3,
      allowedOrigin: "https://cdn.example",
    })).rejects.toThrow("translation_pack_redirect_or_network_rejected");
    expect(request).toHaveBeenCalledWith(
      "https://cdn.example/pack.json",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("stops a streamed response as soon as decoded content exceeds its declared size", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const request = vi.fn().mockResolvedValue({
      status: 200,
      redirected: false,
      url: "https://cdn.example/pack.json",
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2]) })
            .mockResolvedValueOnce({ done: false, value: new Uint8Array([3, 4]) }),
          cancel,
          releaseLock,
        }),
      },
    });
    const downloader = new ObsidianPackDownloader({ request });

    await expect(downloader.download({
      url: "https://cdn.example/pack.json",
      objectVersion: "v1",
      expectedBytes: 3,
      allowedOrigin: "https://cdn.example",
    })).rejects.toThrow("translation_pack_download_size_mismatch");
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it("reports a bounded timeout instead of retaining a stalled download", async () => {
    const request = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const downloader = new ObsidianPackDownloader({ request, timeoutMs: 1 });

    await expect(downloader.download({
      url: "https://cdn.example/pack.json",
      objectVersion: "v1",
      expectedBytes: 3,
      allowedOrigin: "https://cdn.example",
    })).rejects.toThrow("translation_pack_download_timeout");
  });
});
