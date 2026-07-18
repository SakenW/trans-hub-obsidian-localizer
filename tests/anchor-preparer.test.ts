import { describe, expect, it } from "vitest";

import { prepareMarkdownAnchors } from "../src/anchor-preparer";
import { extractMarkdownBlocks } from "../src/markdown-extractor";

describe("prepareMarkdownAnchors", () => {
  it("adds stable IDs without changing existing ready IDs", () => {
    const source = "# Title ^ready\n\nParagraph one.\n\nParagraph two.";
    const ids = ["new-a", "new-b"];
    const prepared = prepareMarkdownAnchors(source, () => ids.shift() ?? "unexpected");
    const result = extractMarkdownBlocks(prepared.markdown);

    expect(prepared.addedCount).toBe(2);
    expect(result.unstableCount).toBe(0);
    expect(result.blocks.map((block) => block.blockId)).toEqual(["ready", "new-b", "new-a"]);
  });

  it("replaces duplicate IDs", () => {
    const source = "One ^same\n\nTwo ^same";
    const ids = ["replacement-b", "replacement-a"];
    const prepared = prepareMarkdownAnchors(source, () => ids.shift() ?? "unexpected");
    const result = extractMarkdownBlocks(prepared.markdown);

    expect(prepared.replacedDuplicateCount).toBe(2);
    expect(result.unstableCount).toBe(0);
    expect(new Set(result.blocks.map((block) => block.blockId)).size).toBe(2);
  });
});
