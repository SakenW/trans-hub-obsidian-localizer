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

  it("keeps linked prose but excludes image-only sponsor badges and pure protected blocks", () => {
    const markdown = [
      "For more information on using formulas, visit the",
      "[Help Docs](https://example.com/help).",
      "",
      "[![GitHub Sponsors](https://img.shields.io/sponsors)](https://github.com/sponsors/example)",
      "[![Paypal](https://img.shields.io/paypal)](https://paypal.me/example)",
      "[<img src=\"https://example.com/coffee.png\" alt=\"Coffee\">](https://example.com/coffee)",
    ].join("\n");

    expect(extractPluginReadmeStrings(markdown)).toEqual([
      "For more information on using formulas, visit the {{th:expr:0}}.",
      "Help Docs",
    ]);
    expect(renderPluginReadmeSource("[<img src=\"badge.png\">](https://example.com)"))
      .toBeUndefined();
    expect(renderPluginReadmeSource(
      "Support via [![Sponsor](badge.svg)](https://example.com) today.",
    )).toBe("Support via today.");
  });
});
