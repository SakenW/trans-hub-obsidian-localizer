import { describe, expect, it } from "vitest";

import { extractPluginReadmeStrings, renderPluginReadmeSource } from "../src/plugin-readme";

describe("plugin README extraction", () => {
  it("extracts prose while protecting links and inline code and skipping code fences", () => {
    const markdown = [
      "# Obsidian Dataview",
      "",
      "Treat your [Obsidian Vault](https://obsidian.md/) as a database and use `TABLE` queries.",
      "",
      "## Examples",
      "",
      "```dataview",
      "table rating",
      "```",
      "",
      "![Example](assets/example.png)",
    ].join("\n");

    expect(extractPluginReadmeStrings(markdown)).toEqual([
      "Examples",
      "Obsidian Dataview",
      "Obsidian Vault",
      "Treat your {{th:expr:0}} as a database and use {{th:expr:1}} queries.",
    ]);
  });

  it("normalizes list markers and formatting without exposing link URLs", () => {
    expect(renderPluginReadmeSource("- Use **Markdown** with [reference][docs]."))
      .toBe("Use Markdown with {{th:expr:0}}.");
  });
});
