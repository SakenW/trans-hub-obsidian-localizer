import { computeUida } from "@trans-hub/uida";

import type { MarkdownExtractionResult } from "./markdown-extractor";
import { sha256Hex, utf8Hex } from "./identity";
import { postgresJsonbText, type CanonicalSourceSnapshot, type NamespaceContractEvidence } from "./source-snapshot-contracts";

export const OBSIDIAN_BLOCK_NAMESPACE = "obsidian.markdown.block.v1";

export async function buildCanonicalSnapshot(input: {
  readonly noteId: string;
  readonly filePath: string;
  readonly sourceLocale: string;
  readonly markdown: string;
  readonly extraction: MarkdownExtractionResult;
  readonly namespaceContracts: readonly NamespaceContractEvidence[];
}): Promise<CanonicalSourceSnapshot> {
  if (input.extraction.unstableCount !== 0 || input.extraction.blocks.length === 0) {
    throw new Error("笔记必须包含至少一个块，并先完成稳定锚点准备。");
  }
  const contract = input.namespaceContracts.find(
    (item) => item.namespaceKey === OBSIDIAN_BLOCK_NAMESPACE,
  );
  if (contract === undefined) {
    throw new Error(`激活包缺少 namespace contract：${OBSIDIAN_BLOCK_NAMESPACE}`);
  }
  const sourceKey = `obsidian-note:${input.noteId}`;
  const provenance = { adapter: "obsidian", note_id: input.noteId, file_path: input.filePath };
  const sourceDigest = await sha256Hex(postgresJsonbText({
    source_key: sourceKey,
    source_locale: input.sourceLocale,
    provenance,
  }));
  const blocks = await Promise.all(
    input.extraction.blocks.map(async (block, index) => {
      const blockId = block.semanticIdentity?.value;
      if (blockId === undefined) throw new Error("笔记块缺少稳定身份。");
      const identity = { noteId: input.noteId, blockId } as const;
      const uida = await computeUida({ namespace: contract.namespaceKey, identity });
      const content = block.text.normalize("NFC");
      const occurrenceKey = occurrenceKeyFor(input.noteId, blockId);
      const context = {
        adapter: "obsidian",
        note_id: input.noteId,
        block_id: blockId,
        block_kind: block.kind,
        file_path: input.filePath,
        start_line: block.provenance.startLine,
        end_line: block.provenance.endLine,
      };
      const contentDigest = await sha256Hex(content);
      const occurrenceDigest = await sha256Hex(postgresJsonbText({
        unit_namespace_id: contract.namespaceId,
        unit_uida_hash: uida.hashHex,
        atom_source_locale: input.sourceLocale,
        atom_content_digest: contentDigest,
        content_source_key: sourceKey,
        content_source_digest: sourceDigest,
        occurrence_key: occurrenceKey,
        order_index: index,
        context,
      }));
      return {
        content,
        contentDigest,
        unit: {
          rowOrdinal: index,
          namespaceContractId: contract.namespaceContractId,
          namespaceId: contract.namespaceId,
          namespaceSchemaRevisionId: contract.namespaceSchemaRevisionId,
          canonicalIdentityHex: bytesToHex(uida.canonicalBytes),
          uidaHashHex: uida.hashHex,
        },
        occurrence: {
          rowOrdinal: index,
          occurrenceKey,
          occurrenceDigestHex: occurrenceDigest,
          stagedContentSourceOrdinal: 0,
          stagedAtomOrdinal: -1,
          stagedUnitOrdinal: index,
          orderIndex: index,
          context,
        },
      };
    }),
  );
  const atomOrdinals = new Map<string, number>();
  const atoms: CanonicalSourceSnapshot["atoms"][number][] = [];
  for (const block of blocks) {
    const key = `${input.sourceLocale}\u0000${block.contentDigest}`;
    let atomOrdinal = atomOrdinals.get(key);
    if (atomOrdinal === undefined) {
      atomOrdinal = atoms.length;
      atomOrdinals.set(key, atomOrdinal);
      atoms.push({
        rowOrdinal: atomOrdinal,
        sourceLocale: input.sourceLocale,
        canonicalContentHex: utf8Hex(block.content),
        contentDigestHex: block.contentDigest,
        placeholderSignature: null,
        formatSignature: "markdown-inline:v1",
      });
    }
    block.occurrence.stagedAtomOrdinal = atomOrdinal;
  }
  return {
    namespaceRevisions: [{
      rowOrdinal: 0,
      namespaceContractId: contract.namespaceContractId,
      namespaceId: contract.namespaceId,
      namespaceSchemaRevisionId: contract.namespaceSchemaRevisionId,
      namespaceSchemaRevision: contract.namespaceSchemaRevision,
      contractDigestHex: contract.contractDigest.replace(/^sha256:/, ""),
      evidenceDigestHex: await sha256Hex(postgresJsonbText({
        namespace_contract_id: contract.namespaceContractId,
        namespace_id: contract.namespaceId,
        namespace_schema_revision_id: contract.namespaceSchemaRevisionId,
        namespace_schema_revision: contract.namespaceSchemaRevision,
        contract_digest: contract.contractDigest.replace(/^sha256:/, ""),
      })),
    }],
    contentSources: [{
      rowOrdinal: 0,
      sourceKey,
      sourceLocale: input.sourceLocale,
      sourceDigestHex: sourceDigest,
      provenance,
    }],
    atoms,
    units: blocks.map((item) => item.unit),
    occurrences: blocks.map((item) => item.occurrence),
  };
}

export function occurrenceKeyFor(noteId: string, blockId: string): string {
  return `obsidian:block:${noteId}:${blockId}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
