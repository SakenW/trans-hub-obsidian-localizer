/** Extract only static HTML text nodes from a Svelte compiler template.
 * A dynamic `<!>` anchor and every element boundary split the text; the
 * complete HTML literal is never a text-replacement target. */
export function staticSvelteTemplateTextNodes(template: string): readonly string[] {
  if (template.length > 100_000 || !template.includes("<!>")) return [];
  const nodes: string[] = [];
  let text = "";
  let skippedTag: string | null = null;
  const flush = (): void => {
    if (text === "") return;
    const normalized = decodeHtmlText(text);
    if (normalized !== null && normalized !== "") nodes.push(normalized);
    text = "";
  };
  for (let index = 0; index < template.length;) {
    if (template[index] !== "<") {
      if (skippedTag === null) text += template[index];
      index += 1;
      continue;
    }
    if (template.startsWith("<!--", index)) {
      flush();
      const end = template.indexOf("-->", index + 4);
      if (end < 0) return [];
      index = end + 3;
      continue;
    }
    const end = findTagEnd(template, index + 1);
    if (end < 0) return [];
    const body = template.slice(index + 1, end).trim();
    index = end + 1;
    if (body === "!") {
      flush();
      continue;
    }
    const match = /^(\/)?([A-Za-z][A-Za-z0-9:-]*)(?:\s|\/|$)/u.exec(body);
    if (match === null) return [];
    const tag = match[2]?.toLowerCase() ?? "";
    const closing = match[1] === "/";
    if (skippedTag !== null) {
      if (closing && tag === skippedTag) skippedTag = null;
      continue;
    }
    flush();
    if (!closing && !/\/\s*$/u.test(body)
      && ["script", "style", "code", "pre", "textarea"].includes(tag)) skippedTag = tag;
  }
  if (skippedTag !== null) return [];
  flush();
  return nodes;
}

function findTagEnd(template: string, start: number): number {
  let quote: "'" | '"' | null = null;
  for (let index = start; index < template.length; index += 1) {
    const char = template[index];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
}

function decodeHtmlText(raw: string): string | null {
  const named = new Map([
    ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'],
    ["apos", "'"], ["nbsp", " "],
  ]);
  let valid = true;
  const decoded = raw.replace(/&(#(?:[xX][0-9A-Fa-f]+|[0-9]+)|[A-Za-z][A-Za-z0-9]+);/gu, (match, entity: string) => {
    const replacement = named.get(entity);
    if (replacement !== undefined) return replacement;
    if (!entity.startsWith("#")) {
      valid = false;
      return match;
    }
    const hex = entity[1]?.toLowerCase() === "x";
    const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (point < 1 || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff) {
      valid = false;
      return match;
    }
    return String.fromCodePoint(point);
  });
  return valid ? decoded.replace(/\s+/gu, " ").trim() : null;
}
