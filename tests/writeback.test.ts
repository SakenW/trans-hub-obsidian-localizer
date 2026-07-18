import { describe, expect, it } from "vitest";

import { extractMarkdownBlocks } from "../src/markdown-extractor";
import { conflictTargetPath, renderTranslatedMarkdown, targetPathFor } from "../src/writeback";

describe("translation writeback", () => {
  it("renders translations into a separate Markdown shape and keeps IDs", () => {
    const source = "# Hello ^title\n\nA paragraph. ^body";
    const blocks = extractMarkdownBlocks(source).blocks;
    const rendered = renderTranslatedMarkdown({
      sourceMarkdown: source,
      blocks,
      noteId: "note-1",
      translations: [
        { noteId: "note-1", blockId: "title", translatedText: "你好", translationDigest: "sha256:x" },
        { noteId: "note-1", blockId: "body", translatedText: "一段正文。", translationDigest: "sha256:y" },
      ],
    });

    expect(rendered).toContain("# 你好\n^title");
    expect(rendered).toContain("一段正文。\n^body");
  });

  it("derives normal and conflict-safe target paths", () => {
    expect(targetPathFor("docs/note.md", "zh-CN")).toBe("docs/note.zh-CN.md");
    expect(conflictTargetPath("docs/note.zh-CN.md", new Date("2026-07-15T00:00:00.000Z"))).toBe(
      "docs/note.zh-CN.conflict-2026-07-15T00-00-00-000Z.md",
    );
  });

  it("preserves ordered and task-list markers", () => {
    const source = "1. First\n2. [ ] Second\n^items";
    const blocks = extractMarkdownBlocks(source).blocks;
    const rendered = renderTranslatedMarkdown({
      sourceMarkdown: source,
      blocks,
      noteId: "note-1",
      translations: [{
        noteId: "note-1",
        blockId: "items",
        translatedText: "第一\n第二",
        translationDigest: "sha256:list",
      }],
    });

    expect(rendered).toContain("1. 第一\n2. [ ] 第二\n^items");
  });

  it("fails closed when a structured translation changes the line count", () => {
    const source = "- First\n- Second\n^items";
    const blocks = extractMarkdownBlocks(source).blocks;
    expect(() => renderTranslatedMarkdown({
      sourceMarkdown: source,
      blocks,
      noteId: "note-1",
      translations: [{
        noteId: "note-1",
        blockId: "items",
        translatedText: "合并成一行",
        translationDigest: "sha256:list",
      }],
    })).toThrow("已拒绝破坏性回写");
  });
});
