import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRequestUrlHandler, setRequestUrlHandler } from "./obsidian-mock";

import {
  classifyCommunityPluginSources,
  parseCommunityRegistry,
  resolveCommunityPluginIdentity,
  resolveCommunityPluginSourceEligibility,
} from "../src/plugin-registry";

afterEach(() => {
  resetRequestUrlHandler();
});

describe("parseCommunityRegistry", () => {
  it("保留官方社区目录中的名称、说明和仓库身份", () => {
    const registry = parseCommunityRegistry([{
      id: "dataview",
      name: "Dataview",
      author: "blacksmithgu",
      description: "Run advanced queries over your vault.",
      repo: "blacksmithgu/obsidian-dataview",
    }]);

    expect(registry.get("dataview")).toEqual({
      repository: "blacksmithgu/obsidian-dataview",
      officialName: "Dataview",
      officialDescription: "Run advanced queries over your vault.",
    });
  });

  it("only marks plugins from the official registry as trusted GitHub sources", () => {
    const registry = parseCommunityRegistry([{
      id: "dataview",
      name: "Dataview",
      author: "blacksmithgu",
      description: "Run advanced queries over your vault.",
      repo: "blacksmithgu/obsidian-dataview",
    }]);

    expect([...classifyCommunityPluginSources(["dataview", "local-plugin"], registry)]).toEqual([
      ["dataview", { kind: "supported", repository: "blacksmithgu/obsidian-dataview" }],
      ["local-plugin", { kind: "unsupported" }],
    ]);
  });

  it("falls back to the same official GitHub registry when the raw host disconnects", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("net::ERR_CONNECTION_CLOSED"))
      .mockResolvedValueOnce({
        status: 200,
        text: JSON.stringify([{
          id: "notebook-navigator",
          name: "Notebook Navigator",
          author: "Johan Sanneblad",
          description: "A better file browser.",
          repo: "johansan/notebook-navigator",
        }]),
      });
    setRequestUrlHandler(request);

    await expect(resolveCommunityPluginSourceEligibility(["notebook-navigator"])).resolves.toEqual(new Map([
      ["notebook-navigator", { kind: "supported", repository: "johansan/notebook-navigator" }],
    ]));
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json",
    }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: "https://github.com/obsidianmd/obsidian-releases/raw/refs/heads/master/community-plugins.json",
    }));
  });

  it("解析同步身份时不下载版本 README", async () => {
    const requestedUrls: string[] = [];
    const request = vi.fn((input: unknown) => {
      if (typeof input === "object" && input !== null
        && "url" in input && typeof input.url === "string") {
        requestedUrls.push(input.url);
      }
      return Promise.resolve({
        status: 200,
        text: JSON.stringify([{
          id: "notebook-navigator",
          name: "Notebook Navigator",
          author: "Johan Sanneblad",
          description: "A better file browser.",
          repo: "johansan/notebook-navigator",
        }]),
      });
    });
    setRequestUrlHandler(request);

    await expect(resolveCommunityPluginIdentity("notebook-navigator", "1.0.0"))
      .resolves.toMatchObject({
        repository: "johansan/notebook-navigator",
        officialName: "Notebook Navigator",
      });
    expect(requestedUrls.some((url) => url.includes("/README.md"))).toBe(false);
  });

  it("合并重叠的官方目录请求并在失败后允许重试", async () => {
    vi.resetModules();
    const registry = await import("../src/plugin-registry");
    const freshObsidianMock = await import("./obsidian-mock");
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ status: 200, text: JSON.stringify([{
        id: "sample", name: "Sample", description: "A sample plugin.", repo: "owner/sample",
      }]) });
    freshObsidianMock.setRequestUrlHandler(request);

    const first = Promise.allSettled([
      registry.resolveCommunityPluginSourceEligibility(["sample"]),
      registry.resolveCommunityPluginIdentity("sample", "1.0.0"),
    ]);
    expect((await first).every((result) => result.status === "rejected")).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);

    await expect(registry.resolveCommunityPluginIdentity("sample", "1.0.0"))
      .resolves.toMatchObject({ repository: "owner/sample" });
    expect(request).toHaveBeenCalledTimes(3);
  });
});
