import { extractMarkdownBlocks } from "./markdown-extractor";

const INLINE_CODE = /(`+)([^`]*?)\1/gu;
const INLINE_LINK = /(!?)\[([^\]]*)\]\((?:\\.|[^)])*\)/gu;
const REFERENCE_LINK = /(!?)\[([^\]]*)\]\[[^\]]*\]/gu;
const AUTOLINK = /<https?:\/\/[^>]+>/gu;
const HTML_TAG = /<\/?[A-Za-z][^>]*>/gu;
const TABLE_ROW = /^\s*\|?.*\|.*\|?\s*$/u;
const HORIZONTAL_RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/u;

export function extractPluginReadmeStrings(markdown: string): readonly string[] {
  const values: string[] = [];
  for (const block of extractMarkdownBlocks(markdown, "README.md").blocks) {
    if (HORIZONTAL_RULE.test(block.sourceMarkdown)) continue;
    if (block.kind === "list") {
      for (const line of block.sourceMarkdown.split("\n")) addRendered(values, line);
      continue;
    }
    if (block.sourceMarkdown.split("\n").some((line) => TABLE_ROW.test(line))) continue;
    addRendered(values, block.text);
  }
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function renderPluginReadmeSource(value: string): string | undefined {
  const protect = (label: string): string => label.trim() === "" ? "" : "\uE000";
  let tokenIndex = 0;
  const rendered = value
    .replace(INLINE_CODE, (_match, _ticks: string, code: string) => protect(code))
    .replace(INLINE_LINK, (_match, image: string, label: string) => image === "!" ? "" : protect(label))
    .replace(REFERENCE_LINK, (_match, image: string, label: string) => image === "!" ? "" : protect(label))
    .replace(AUTOLINK, (url) => protect(url.slice(1, -1)))
    .replace(HTML_TAG, "")
    .replace(/\uE000/gu, () => {
      const token = `{{th:expr:${tokenIndex}}}`;
      tokenIndex += 1;
      return token;
    })
    .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/u, "")
    .replace(/[*_~]+/gu, "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
  return rendered === "" || !/[A-Za-z\p{L}]/u.test(rendered) ? undefined : rendered;
}

function addRendered(target: string[], value: string): void {
  for (const pattern of [INLINE_LINK, REFERENCE_LINK]) {
    for (const match of value.matchAll(pattern)) {
      if (match[1] === "!") continue;
      const label = renderPluginReadmeSource(match[2] ?? "");
      if (label !== undefined) target.push(label);
    }
  }
  const rendered = renderPluginReadmeSource(value);
  if (rendered !== undefined) target.push(rendered);
}
