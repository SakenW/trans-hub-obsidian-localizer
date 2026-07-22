import { describe, expect, it } from "vitest";

import {
  classifyCommunityPluginSources,
  parseCommunityRegistry,
} from "../src/plugin-registry";

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
});
