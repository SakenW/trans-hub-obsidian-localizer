export type MarkdownBlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "blockquote";

export type SubmissionState = "ready" | "unstable";

export interface BlockProvenance {
  readonly filePath: string | null;
  readonly startLine: number;
  readonly endLine: number;
  readonly occurrence: number;
}

export interface SemanticIdentity {
  readonly kind: "obsidian-block-id";
  readonly value: string;
}

export interface ExtractedMarkdownBlock {
  readonly kind: MarkdownBlockKind;
  readonly text: string;
  readonly sourceMarkdown: string;
  readonly blockId: string | null;
  readonly submissionState: SubmissionState;
  readonly semanticIdentity: SemanticIdentity | null;
  readonly provenance: BlockProvenance;
}

export interface MarkdownExtractionResult {
  readonly blocks: readonly ExtractedMarkdownBlock[];
  readonly readyCount: number;
  readonly unstableCount: number;
}

interface MutableBlock {
  kind: MarkdownBlockKind;
  text: string;
  sourceMarkdown: string;
  blockId: string | null;
  startLine: number;
  endLine: number;
}

interface BlockIdMatch {
  readonly content: string;
  readonly blockId: string | null;
}

const STANDALONE_BLOCK_ID = /^\s*\^([A-Za-z0-9-]+)\s*$/;
const TRAILING_BLOCK_ID = /^(.*?)(?:\s+)\^([A-Za-z0-9-]+)\s*$/s;
const HEADING = /^\s{0,3}#{1,6}(?:\s+|$)/;
const LIST_ITEM = /^\s{0,3}(?:[-+*]|\d+[.)])\s+/;
const BLOCKQUOTE = /^\s{0,3}>/;
const FENCE_START = /^\s{0,3}(`{3,}|~{3,})/;

function splitLines(markdown: string): string[] {
  return markdown.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
}

function frontmatterEndIndex(lines: readonly string[]): number {
  if (lines[0]?.trim() !== "---") {
    return -1;
  }

  for (let index = 1; index < lines.length; index += 1) {
    const delimiter = lines[index]?.trim();
    if (delimiter === "---" || delimiter === "...") {
      return index;
    }
  }

  return -1;
}

function stripTrailingBlockId(value: string): BlockIdMatch {
  const match = value.match(TRAILING_BLOCK_ID);
  if (match === null) {
    return { content: value.trimEnd(), blockId: null };
  }

  return {
    content: (match[1] ?? "").trimEnd(),
    blockId: match[2] ?? null,
  };
}

function isPureCommentStart(line: string): boolean {
  return line.trimStart().startsWith("<!--");
}

function consumeComment(lines: readonly string[], startIndex: number): number {
  let index = startIndex;
  while (index < lines.length) {
    if ((lines[index] ?? "").includes("-->")) {
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function consumeFence(lines: readonly string[], startIndex: number): number {
  const opening = (lines[startIndex] ?? "").match(FENCE_START)?.[1];
  if (opening === undefined) {
    return startIndex + 1;
  }

  const marker = opening[0];
  if (marker === undefined) {
    return startIndex + 1;
  }

  const closing = new RegExp(`^\\s{0,3}${marker}{${opening.length},}\\s*$`);
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (closing.test(lines[index] ?? "")) {
      return index + 1;
    }
  }

  return lines.length;
}

function isBlockBoundary(line: string): boolean {
  return (
    line.trim() === "" ||
    STANDALONE_BLOCK_ID.test(line) ||
    HEADING.test(line) ||
    LIST_ITEM.test(line) ||
    BLOCKQUOTE.test(line) ||
    FENCE_START.test(line) ||
    isPureCommentStart(line)
  );
}

function cleanHeading(markdown: string): string {
  return markdown.replace(HEADING, "").replace(/\s+#+\s*$/, "").trim();
}

function cleanList(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.replace(LIST_ITEM, "").trim())
    .filter((line) => line !== "")
    .join("\n");
}

function cleanBlockquote(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.replace(/^\s{0,3}>\s?/, "").trim())
    .filter((line) => line !== "")
    .join("\n");
}

function buildBlock(
  kind: MarkdownBlockKind,
  rawLines: readonly string[],
  startIndex: number,
  endIndex: number,
): MutableBlock {
  const rawMarkdown = rawLines.join("\n");
  const stripped = stripTrailingBlockId(rawMarkdown);
  const text =
    kind === "heading"
      ? cleanHeading(stripped.content)
      : kind === "list"
        ? cleanList(stripped.content)
        : kind === "blockquote"
          ? cleanBlockquote(stripped.content)
          : stripped.content.trim();

  return {
    kind,
    text,
    sourceMarkdown: stripped.content,
    blockId: stripped.blockId,
    startLine: startIndex + 1,
    endLine: endIndex,
  };
}

function attachStandaloneBlockId(
  blocks: MutableBlock[],
  blockId: string,
  lineNumber: number,
): void {
  const previous = blocks.at(-1);
  if (previous === undefined || previous.blockId !== null) {
    return;
  }

  previous.blockId = blockId;
  previous.endLine = lineNumber;
}

function countBlockIds(blocks: readonly MutableBlock[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    if (block.blockId !== null) {
      counts.set(block.blockId, (counts.get(block.blockId) ?? 0) + 1);
    }
  }
  return counts;
}

export function extractMarkdownBlocks(
  markdown: string,
  filePath: string | null = null,
): MarkdownExtractionResult {
  const lines = splitLines(markdown);
  const mutableBlocks: MutableBlock[] = [];
  const frontmatterEnd = frontmatterEndIndex(lines);
  let index = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const standaloneBlockId = line.match(STANDALONE_BLOCK_ID)?.[1];
    if (standaloneBlockId !== undefined) {
      attachStandaloneBlockId(mutableBlocks, standaloneBlockId, index + 1);
      index += 1;
      continue;
    }

    if (isPureCommentStart(line)) {
      index = consumeComment(lines, index);
      continue;
    }

    if (FENCE_START.test(line)) {
      index = consumeFence(lines, index);
      continue;
    }

    if (HEADING.test(line)) {
      mutableBlocks.push(buildBlock("heading", [line], index, index + 1));
      index += 1;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const startIndex = index;
      const blockLines: string[] = [];
      while (index < lines.length) {
        const candidate = lines[index] ?? "";
        if (candidate.trim() === "" || STANDALONE_BLOCK_ID.test(candidate)) {
          break;
        }
        if (blockLines.length > 0 && (HEADING.test(candidate) || BLOCKQUOTE.test(candidate) || FENCE_START.test(candidate) || isPureCommentStart(candidate))) {
          break;
        }
        blockLines.push(candidate);
        index += 1;
      }
      mutableBlocks.push(buildBlock("list", blockLines, startIndex, index));
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const startIndex = index;
      const blockLines: string[] = [];
      while (index < lines.length && BLOCKQUOTE.test(lines[index] ?? "")) {
        blockLines.push(lines[index] ?? "");
        index += 1;
      }
      mutableBlocks.push(buildBlock("blockquote", blockLines, startIndex, index));
      continue;
    }

    const startIndex = index;
    const blockLines: string[] = [];
    while (index < lines.length && !isBlockBoundary(lines[index] ?? "")) {
      blockLines.push(lines[index] ?? "");
      index += 1;
    }
    if (blockLines.length > 0) {
      mutableBlocks.push(buildBlock("paragraph", blockLines, startIndex, index));
      continue;
    }

    index += 1;
  }

  const blockIdCounts = countBlockIds(mutableBlocks);
  const blocks = mutableBlocks
    .filter((block) => block.text !== "")
    .map((block, occurrence): ExtractedMarkdownBlock => {
      const uniqueBlockId =
        block.blockId !== null && blockIdCounts.get(block.blockId) === 1
          ? block.blockId
          : null;
      return {
        kind: block.kind,
        text: block.text,
        sourceMarkdown: block.sourceMarkdown,
        blockId: block.blockId,
        submissionState: uniqueBlockId === null ? "unstable" : "ready",
        semanticIdentity: uniqueBlockId === null
          ? null
          : { kind: "obsidian-block-id", value: uniqueBlockId },
        provenance: {
          filePath,
          startLine: block.startLine,
          endLine: block.endLine,
          occurrence,
        },
      };
    });

  const readyCount = blocks.filter(
    (block) => block.submissionState === "ready",
  ).length;

  return {
    blocks,
    readyCount,
    unstableCount: blocks.length - readyCount,
  };
}
