import type { ExtractedMarkdownBlock } from "./markdown-extractor";
import type { TranslationRow } from "./translation-sync";

export function renderTranslatedMarkdown(input: {
  readonly sourceMarkdown: string;
  readonly blocks: readonly ExtractedMarkdownBlock[];
  readonly translations: readonly TranslationRow[];
  readonly noteId: string;
}): string {
  const translations = new Map(
    input.translations
      .filter((row) => row.noteId === input.noteId)
      .map((row) => [row.blockId, row.translatedText]),
  );
  const lines = input.sourceMarkdown.replace(/\r\n|\r/g, "\n").split("\n");
  for (const block of [...input.blocks].reverse()) {
    const blockId = block.semanticIdentity?.value;
    if (blockId === undefined) continue;
    const translated = translations.get(blockId);
    if (translated === undefined) continue;
    const start = block.provenance.startLine - 1;
    const count = block.provenance.endLine - block.provenance.startLine + 1;
    lines.splice(start, count, ...formatBlock(block, translated, blockId));
  }
  return lines.join("\n");
}

export function targetPathFor(sourcePath: string, targetLocale: string): string {
  const suffix = `.${targetLocale}.md`;
  return sourcePath.toLowerCase().endsWith(".md")
    ? `${sourcePath.slice(0, -3)}${suffix}`
    : `${sourcePath}${suffix}`;
}

export function conflictTargetPath(targetPath: string, timestamp = new Date()): string {
  const stamp = timestamp.toISOString().replace(/[:.]/g, "-");
  return targetPath.toLowerCase().endsWith(".md")
    ? `${targetPath.slice(0, -3)}.conflict-${stamp}.md`
    : `${targetPath}.conflict-${stamp}.md`;
}

function formatBlock(
  block: ExtractedMarkdownBlock,
  translated: string,
  blockId: string,
): string[] {
  const normalized = translated.replace(/\r\n|\r/g, "\n").split("\n");
  if (block.kind === "heading") {
    const marker = /^\s{0,3}(#{1,6})/u.exec(block.sourceMarkdown)?.[1] ?? "#";
    return [`${marker} ${normalized.join(" ")}`, `^${blockId}`];
  }
  if (block.kind === "blockquote") {
    return [...renderWithSourcePrefixes(block.sourceMarkdown, normalized, /^\s*>\s?/u, "> ", "引用"), `^${blockId}`];
  }
  if (block.kind === "list") {
    return [...renderWithSourcePrefixes(
      block.sourceMarkdown,
      normalized,
      /^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/u,
      "- ",
      "列表",
    ), `^${blockId}`];
  }
  return [...normalized, `^${blockId}`];
}

function renderWithSourcePrefixes(
  sourceMarkdown: string,
  translatedLines: readonly string[],
  prefixPattern: RegExp,
  fallbackPrefix: string,
  label: string,
): string[] {
  const sourceLines = sourceMarkdown.split("\n");
  if (sourceLines.length !== translatedLines.length) {
    throw new Error(`${label}译文行数与源结构不匹配，已拒绝破坏性回写。`);
  }
  return translatedLines.map((line, index) => {
    const sourceLine = sourceLines[index] ?? "";
    const prefix = sourceLine.match(prefixPattern)?.[0] ?? fallbackPrefix;
    return `${prefix}${line}`;
  });
}
