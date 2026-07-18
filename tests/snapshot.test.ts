import { describe, expect, it } from "vitest";

import { extractMarkdownBlocks } from "../src/markdown-extractor";
import { buildCanonicalSnapshot, OBSIDIAN_BLOCK_NAMESPACE } from "../src/snapshot";

describe("buildCanonicalSnapshot", () => {
  it("builds canonical UIDA-backed facts for ready blocks", async () => {
    const markdown = "# Hello ^title\n\nWorld ^body";
    const snapshot = await buildCanonicalSnapshot({
      noteId: "018f0000-0000-7000-8000-000000000001",
      filePath: "notes/example.md",
      sourceLocale: "en",
      markdown,
      extraction: extractMarkdownBlocks(markdown, "notes/example.md"),
      namespaceContracts: [{
        namespaceKey: OBSIDIAN_BLOCK_NAMESPACE,
        namespaceContractId: "018f0000-0000-7000-8000-000000000010",
        namespaceId: "018f0000-0000-7000-8000-000000000011",
        namespaceSchemaRevisionId: "018f0000-0000-7000-8000-000000000012",
        namespaceSchemaRevision: 1,
        contractDigest: "a".repeat(64),
      }],
    });

    expect(snapshot.atoms).toHaveLength(2);
    expect(snapshot.units.every((unit) => /^[0-9a-f]{64}$/u.test(unit.uidaHashHex))).toBe(true);
    expect(snapshot.occurrences.map((item) => item.occurrenceKey)).toEqual([
      "obsidian:block:018f0000-0000-7000-8000-000000000001:title",
      "obsidian:block:018f0000-0000-7000-8000-000000000001:body",
    ]);
    expect(snapshot.namespaceRevisions[0]?.evidenceDigestHex).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("fails closed when a block is unstable", async () => {
    const markdown = "No ID";
    await expect(buildCanonicalSnapshot({
      noteId: "note",
      filePath: "note.md",
      sourceLocale: "en",
      markdown,
      extraction: extractMarkdownBlocks(markdown),
      namespaceContracts: [],
    })).rejects.toThrow("稳定锚点");
  });

  it("deduplicates atoms while preserving distinct units and occurrences", async () => {
    const markdown = "Repeated ^first\n\nRepeated ^second";
    const snapshot = await buildCanonicalSnapshot({
      noteId: "018f0000-0000-7000-8000-000000000001",
      filePath: "notes/repeated.md",
      sourceLocale: "en",
      markdown,
      extraction: extractMarkdownBlocks(markdown, "notes/repeated.md"),
      namespaceContracts: [{
        namespaceKey: OBSIDIAN_BLOCK_NAMESPACE,
        namespaceContractId: "018f0000-0000-7000-8000-000000000010",
        namespaceId: "018f0000-0000-7000-8000-000000000011",
        namespaceSchemaRevisionId: "018f0000-0000-7000-8000-000000000012",
        namespaceSchemaRevision: 1,
        contractDigest: "a".repeat(64),
      }],
    });

    expect(snapshot.atoms).toHaveLength(1);
    expect(snapshot.units).toHaveLength(2);
    expect(snapshot.occurrences.map((item) => item.stagedAtomOrdinal)).toEqual([0, 0]);
  });
});
