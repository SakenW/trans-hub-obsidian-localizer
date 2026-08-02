import { describe, expect, it, vi } from "vitest";

import { openSystemBrowser } from "../src/external-browser";

describe("openSystemBrowser", () => {
  it("uses the injected system opener for trusted HTTPS URLs", async () => {
    const opener = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    await openSystemBrowser("https://trans-hub.net/connect/client?state=safe", opener);
    expect(opener).toHaveBeenCalledOnce();
    expect(opener).toHaveBeenCalledWith("https://trans-hub.net/connect/client?state=safe");
  });

  it("allows loopback HTTP for development", async () => {
    const opener = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    await openSystemBrowser("http://127.0.0.1:3000/connect/client", opener);
    expect(opener).toHaveBeenCalledOnce();
  });

  it("rejects untrusted protocols and embedded credentials", async () => {
    const opener = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    await expect(openSystemBrowser("file:///tmp/login", opener)).rejects.toThrow("可信");
    await expect(openSystemBrowser("https://user:secret@trans-hub.net", opener)).rejects.toThrow("可信");
    expect(opener).not.toHaveBeenCalled();
  });
});
