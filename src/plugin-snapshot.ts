import { computeUida } from "@trans-hub/uida";

import { sha256Hex, utf8Hex } from "./identity";
import { resolvePluginStringSemanticRole, type PluginUiCatalog } from "./plugin-string-scanner";
import { postgresJsonbText, type CanonicalSourceSnapshot, type NamespaceContractEvidence } from "./source-snapshot-contracts";

export const OBSIDIAN_PLUGIN_UI_NAMESPACE = "obsidian.plugin.ui-string.v1";

export async function buildPluginCanonicalSnapshot(input: {
  readonly catalog: PluginUiCatalog;
  readonly namespaceContracts: readonly NamespaceContractEvidence[];
}): Promise<CanonicalSourceSnapshot> {
  if (input.catalog.strings.length === 0) throw new Error("插件没有可提交的界面文案。");
  const contract = input.namespaceContracts.find(
    (item) => item.namespaceKey === OBSIDIAN_PLUGIN_UI_NAMESPACE,
  );
  if (contract === undefined) {
    throw new Error(`激活包缺少 namespace contract：${OBSIDIAN_PLUGIN_UI_NAMESPACE}`);
  }
  const sourceKey = pluginSourceKey(input.catalog.pluginId, input.catalog.pluginVersion);
  const provenance = {
    adapter: "obsidian",
    asset_kind: "plugin_ui",
    plugin_id: input.catalog.pluginId,
    plugin_name: input.catalog.pluginName,
    plugin_version: input.catalog.pluginVersion,
    catalog_digest: input.catalog.digest,
  };
  const sourceDigest = await sha256Hex(postgresJsonbText({
    source_key: sourceKey,
    source_locale: input.catalog.sourceLocale,
    provenance,
  }));
  const rows = await Promise.all(input.catalog.strings.map(async (item, index) => {
    const identity = { pluginId: input.catalog.pluginId, stringKey: item.key } as const;
    const uida = await computeUida({ namespace: contract.namespaceKey, identity });
    const content = item.source.normalize("NFC");
    const contentDigest = await sha256Hex(content);
    const occurrenceKey = pluginOccurrenceKey(input.catalog.pluginId, item.key);
    const context = {
      adapter: "obsidian",
      asset_kind: "plugin_ui",
      plugin_id: input.catalog.pluginId,
      plugin_name: input.catalog.pluginName,
      plugin_version: input.catalog.pluginVersion,
      string_key: item.key,
      origins: [...item.origins],
      semantic_role: item.semanticRole ?? resolvePluginStringSemanticRole(item.origins),
      placeholder_signature: item.placeholderSignature,
    };
    const occurrenceDigest = await sha256Hex(postgresJsonbText({
      unit_namespace_id: contract.namespaceId,
      unit_uida_hash: uida.hashHex,
      atom_source_locale: input.catalog.sourceLocale,
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
      placeholderSignature: item.placeholderSignature,
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
  }));
  const atomOrdinals = new Map<string, number>();
  const atoms: CanonicalSourceSnapshot["atoms"][number][] = [];
  for (const row of rows) {
    const key = `${input.catalog.sourceLocale}\u0000${row.contentDigest}`;
    let atomOrdinal = atomOrdinals.get(key);
    if (atomOrdinal === undefined) {
      atomOrdinal = atoms.length;
      atomOrdinals.set(key, atomOrdinal);
      atoms.push({
        rowOrdinal: atomOrdinal,
        sourceLocale: input.catalog.sourceLocale,
        canonicalContentHex: utf8Hex(row.content),
        contentDigestHex: row.contentDigest,
        placeholderSignature: row.placeholderSignature === "" ? null : row.placeholderSignature,
        formatSignature: "plain-text:v1",
      });
    }
    row.occurrence.stagedAtomOrdinal = atomOrdinal;
  }
  return {
    namespaceRevisions: [{
      rowOrdinal: 0,
      namespaceContractId: contract.namespaceContractId,
      namespaceId: contract.namespaceId,
      namespaceSchemaRevisionId: contract.namespaceSchemaRevisionId,
      namespaceSchemaRevision: contract.namespaceSchemaRevision,
      contractDigestHex: contract.contractDigest.replace(/^sha256:/u, ""),
      evidenceDigestHex: await sha256Hex(postgresJsonbText({
        namespace_contract_id: contract.namespaceContractId,
        namespace_id: contract.namespaceId,
        namespace_schema_revision_id: contract.namespaceSchemaRevisionId,
        namespace_schema_revision: contract.namespaceSchemaRevision,
        contract_digest: contract.contractDigest.replace(/^sha256:/u, ""),
      })),
    }],
    contentSources: [{
      rowOrdinal: 0,
      sourceKey,
      sourceLocale: input.catalog.sourceLocale,
      sourceDigestHex: sourceDigest,
      provenance,
    }],
    atoms,
    units: rows.map((row) => row.unit),
    occurrences: rows.map((row) => row.occurrence),
  };
}

export function pluginSourceKey(pluginId: string, pluginVersion: string): string {
  return `obsidian-plugin:${pluginId}:${pluginVersion}`;
}

export function pluginOccurrenceKey(pluginId: string, stringKey: string): string {
  return `obsidian:plugin-ui:${pluginId}:${stringKey}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
