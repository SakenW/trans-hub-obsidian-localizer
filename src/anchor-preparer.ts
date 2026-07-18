import { extractMarkdownBlocks } from "./markdown-extractor";

export interface PreparedAnchors {
  readonly markdown: string;
  readonly addedCount: number;
  readonly replacedDuplicateCount: number;
}

export function prepareMarkdownAnchors(
  markdown: string,
  createBlockId: () => string = defaultBlockId,
): PreparedAnchors {
  const result = extractMarkdownBlocks(markdown);
  const lines = markdown.replace(/\r\n|\r/g, "\n").split("\n");
  let addedCount = 0;
  let replacedDuplicateCount = 0;

  for (const block of [...result.blocks].reverse()) {
    if (block.submissionState === "ready") continue;
    const id = createBlockId();
    const start = block.provenance.startLine - 1;
    const end = block.provenance.endLine - 1;
    if (block.blockId !== null) {
      for (let index = end; index >= start; index -= 1) {
        const line = lines[index] ?? "";
        const trailing = new RegExp(`\\s+\\^${escapeRegex(block.blockId)}\\s*$`, "u");
        if (trailing.test(line)) {
          lines[index] = line.replace(trailing, "");
          break;
        }
        if (new RegExp(`^\\s*\\^${escapeRegex(block.blockId)}\\s*$`, "u").test(line)) {
          lines.splice(index, 1);
          break;
        }
      }
      replacedDuplicateCount += 1;
    }
    const insertionIndex = Math.min(block.provenance.endLine, lines.length);
    lines.splice(insertionIndex, 0, `^${id}`);
    addedCount += 1;
  }

  return { markdown: lines.join("\n"), addedCount, replacedDuplicateCount };
}

function defaultBlockId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `th-${Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("")}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
