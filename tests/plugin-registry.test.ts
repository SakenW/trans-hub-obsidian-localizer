import { describe, expect, it } from "vitest";

import { parseCommunityRegistry } from "../src/plugin-registry";

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
});
