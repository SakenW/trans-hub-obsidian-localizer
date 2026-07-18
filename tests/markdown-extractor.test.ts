import { describe, expect, it } from "vitest";

import { extractMarkdownBlocks } from "../src/markdown-extractor";

describe("extractMarkdownBlocks", () => {
  it("跳过 YAML frontmatter 且不把 note id 当作块语义身份", () => {
    const result = extractMarkdownBlocks(
      [
        "---",
        "note_id: durable-note-1",
        "title: 示例",
        "---",
        "正文没有块 ID。",
      ].join("\n"),
      "notes/example.md",
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      text: "正文没有块 ID。",
      submissionState: "unstable",
      semanticIdentity: null,
      provenance: { filePath: "notes/example.md", startLine: 5, endLine: 5 },
    });
  });

  it("跳过围栏代码块和纯 HTML 注释", () => {
    const result = extractMarkdownBlocks(
      [
        "<!-- 纯注释 -->",
        "```ts",
        "const hidden = true; ^not-a-block",
        "```",
        "可翻译正文。 ^visible",
        "<!--",
        "多行注释",
        "-->",
      ].join("\n"),
    );

    expect(result.blocks.map((block) => block.text)).toEqual(["可翻译正文。"]);
    expect(result.blocks[0]?.blockId).toBe("visible");
  });

  it("把唯一的显式 block ID 标记为 ready", () => {
    const result = extractMarkdownBlocks("# 标题 ^stable-heading\n\n段落 ^stable-paragraph");

    expect(result.readyCount).toBe(2);
    expect(result.blocks[0]).toMatchObject({
      kind: "heading",
      text: "标题",
      blockId: "stable-heading",
      submissionState: "ready",
      semanticIdentity: {
        kind: "obsidian-block-id",
        value: "stable-heading",
      },
    });
  });

  it("不使用路径或 occurrence 为无 ID 块制造语义身份", () => {
    const result = extractMarkdownBlocks("第一段。\n\n第二段。", "folder/note.md");

    expect(result.unstableCount).toBe(2);
    expect(result.blocks.map((block) => block.submissionState)).toEqual([
      "unstable",
      "unstable",
    ]);
    expect(result.blocks.map((block) => block.semanticIdentity)).toEqual([
      null,
      null,
    ]);
    expect(result.blocks.map((block) => block.provenance.occurrence)).toEqual([
      0, 1,
    ]);
  });

  it("提取列表与引用，并支持列表后的独立 block ID", () => {
    const result = extractMarkdownBlocks(
      [
        "- 第一项",
        "- 第二项",
        "",
        "^list-anchor",
        "",
        "> 第一行引用",
        "> 第二行引用 ^quote-anchor",
      ].join("\n"),
    );

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]).toMatchObject({
      kind: "list",
      text: "第一项\n第二项",
      blockId: "list-anchor",
      submissionState: "ready",
    });
    expect(result.blocks[1]).toMatchObject({
      kind: "blockquote",
      text: "第一行引用\n第二行引用",
      blockId: "quote-anchor",
      submissionState: "ready",
    });
  });

  it.each([
    ["Windows CRLF", "\r\n"],
    ["macOS legacy CR", "\r"],
    ["Unix LF", "\n"],
  ])("支持 %s 换行", (_name, newline) => {
    const result = extractMarkdownBlocks(
      ["---", "title: 换行", "---", "正文。 ^line-ending"].join(newline),
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      text: "正文。",
      blockId: "line-ending",
      submissionState: "ready",
      provenance: { startLine: 4, endLine: 4 },
    });
  });

  it("重复 block ID fail closed 为 unstable", () => {
    const result = extractMarkdownBlocks("第一段 ^duplicate\n\n第二段 ^duplicate");

    expect(result.readyCount).toBe(0);
    expect(result.blocks.every((block) => block.submissionState === "unstable")).toBe(true);
  });
});
