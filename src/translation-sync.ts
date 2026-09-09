import {
  publicClientTranslationExportEndpoint,
  TranslationExportClient,
  type CanonicalJsonTranslationExportManifest,
  type CanonicalJsonTranslationPackRef,
  type AnyTranslationExportManifest,
  type ScopeAwarePackStore,
  type TranslationManifestVerificationPort,
  type TranslationSyncState,
} from "@trans-hub/translation-export-client";
import {
  NodeCanonicalJsonPackVerifier,
  NodeEd25519ManifestVerifier,
} from "@trans-hub/translation-export-client/node";

import type { TransportClient } from "./http-transport";
import { ObsidianPackDownloader } from "./obsidian-pack-downloader";
import { TRANS_HUB_TRANSLATION_EXPORT_TRUST_ROOTS } from "./product-config";
import type {
  PluginTranslationApplication,
  PluginTranslationProvenanceKind,
  PluginSourceCompatibility,
} from "./plugin-ui-runtime";

export type TranslationExportManifest = CanonicalJsonTranslationExportManifest;
export type TranslationPackRef = CanonicalJsonTranslationPackRef;

/** Adapter-owned renderer identity; the shared export client only verifies bytes. */
export const CANONICAL_OCCURRENCE_JSON_RENDERER_PROFILE = Object.freeze({
  key: "canonical-occurrence-json",
  revision: 1,
});

export interface TranslationRow {
  readonly noteId: string;
  readonly blockId: string;
  readonly translatedText: string;
}

export interface PluginTranslationRow {
  readonly pluginId: string;
  readonly stringKey: string;
  readonly translatedText: string;
  readonly provenanceKind?: PluginTranslationProvenanceKind;
  readonly application?: PluginTranslationApplication;
  readonly nativeTarget?: string;
  readonly sourceCompatibility?: PluginSourceCompatibility;
}

export interface TranslationSyncOutput<Row> {
  readonly manifest: TranslationExportManifest;
  readonly rows: readonly Row[];
  readonly etag: string;
}

interface TranslationOccurrence {
  readonly occurrenceKey: string;
  readonly translatedText: string;
  readonly structuredContent: Readonly<Record<string, unknown>>;
}

interface DownloadInput {
  readonly transport: TransportClient;
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly sourceVersionId: string;
  readonly targetLocale: string;
  readonly packStore: ScopeAwarePackStore;
  readonly previous?: TranslationSyncState<AnyTranslationExportManifest>;
  readonly developmentDownloadOrigin?: string;
  readonly manifestVerifier?: TranslationManifestVerificationPort<CanonicalJsonTranslationExportManifest>;
}

export async function downloadTranslations(input: DownloadInput & {
  readonly expectedNoteId: string;
}): Promise<TranslationSyncOutput<TranslationRow>> {
  const result = await downloadTranslationOccurrences(input);
  const rows = result.rows.map((row): TranslationRow => {
    const match = /^obsidian:block:([^:]+):([^:]+)$/u.exec(row.occurrenceKey);
    if (match === null) throw new Error(`译文 occurrence 不属于 Obsidian 笔记：${row.occurrenceKey}`);
    if (match[1] !== input.expectedNoteId) throw new Error(`译文 occurrence 与当前笔记不匹配：${match[1]}`);
    return { noteId: match[1], blockId: match[2], translatedText: row.translatedText };
  });
  assertUnique(rows.map((row) => `${row.noteId}\u0000${row.blockId}`), "译文 occurrence 重复");
  return { manifest: result.manifest, rows, etag: result.etag };
}

export async function downloadPluginTranslations(input: DownloadInput & {
  readonly expectedPluginId: string;
}): Promise<TranslationSyncOutput<PluginTranslationRow>> {
  const result = await downloadTranslationOccurrences(input);
  const rows = result.rows.map((row): PluginTranslationRow => {
    const stringKey = parsePluginOccurrenceKey(row.occurrenceKey, input.expectedPluginId);
    return {
      pluginId: input.expectedPluginId,
      stringKey,
      translatedText: row.translatedText,
      ...parseDeliveryProvenance(row.structuredContent),
      ...parseSourceCompatibility(row.structuredContent),
    };
  });
  assertUnique(rows.map((row) => row.stringKey), "插件译文 occurrence 重复");
  return { manifest: result.manifest, rows, etag: result.etag };
}

export function parseObsidianTranslationPack(
  bytes: Uint8Array,
  manifest: TranslationExportManifest,
  pack: TranslationPackRef,
): TranslationRow[] {
  return parseTranslationPack(bytes, manifest, pack).map((row) => {
    const match = /^obsidian:block:([^:]+):([^:]+)$/u.exec(row.occurrenceKey);
    if (match === null) throw new Error(`译文 occurrence 不属于 Obsidian 笔记：${row.occurrenceKey}`);
    return { noteId: match[1], blockId: match[2], translatedText: row.translatedText };
  });
}

export function parsePluginTranslationPack(
  bytes: Uint8Array,
  manifest: TranslationExportManifest,
  pack: TranslationPackRef,
  expectedPluginId: string,
): PluginTranslationRow[] {
  return parseTranslationPack(bytes, manifest, pack).map((row) => {
    const stringKey = parsePluginOccurrenceKey(row.occurrenceKey, expectedPluginId);
    return {
      pluginId: expectedPluginId,
      stringKey,
      translatedText: row.translatedText,
      ...parseDeliveryProvenance(row.structuredContent),
      ...parseSourceCompatibility(row.structuredContent),
    };
  });
}

function parsePluginOccurrenceKey(occurrenceKey: string, expectedPluginId: string): string {
  if (/^[a-f0-9]{32}$/u.test(occurrenceKey)) return occurrenceKey;
  const scoped = /^obsidian:plugin-ui:([^:]+):([a-f0-9]{32})$/u.exec(occurrenceKey);
  if (scoped === null) throw new Error(`译文 occurrence 不属于 Obsidian 插件：${occurrenceKey}`);
  if (scoped[1] !== expectedPluginId) throw new Error(`译文 occurrence 与当前插件不匹配：${scoped[1]}`);
  return scoped[2];
}

async function downloadTranslationOccurrences(
  input: DownloadInput,
): Promise<TranslationSyncOutput<TranslationOccurrence>> {
  const downloader = new ObsidianPackDownloader({
    ...(input.developmentDownloadOrigin === undefined ? {} : { developmentOrigin: input.developmentDownloadOrigin }),
  });
  const previous = input.previous?.manifest.revision === 3
    ? input.previous as TranslationSyncState<CanonicalJsonTranslationExportManifest>
    : undefined;
  const result = await new TranslationExportClient({
    transport: input.transport,
    endpoint: publicClientTranslationExportEndpoint({
      bearerCredential: input.accessToken,
      manifestRevision: 3,
    }),
    store: input.packStore,
    downloader,
    verifier: new NodeCanonicalJsonPackVerifier(),
    manifestVerifier: input.manifestVerifier ?? new NodeEd25519ManifestVerifier({
      roots: TRANS_HUB_TRANSLATION_EXPORT_TRUST_ROOTS,
    }),
    ...(input.developmentDownloadOrigin === undefined
      ? {}
      : { developmentDownloadOrigin: input.developmentDownloadOrigin }),
  }).sync({
    authorityScopeId: input.workspaceId,
    sourceVersionId: input.sourceVersionId,
    targetLocale: input.targetLocale,
    targetVariant: "default",
    ...(previous === undefined ? {} : { previous }),
  });
  const packs = new Map(result.manifest.packs.map((pack) => [pack.packId, pack]));
  const rows = result.packs.flatMap((verified) => {
    const pack = packs.get(verified.packId);
    if (pack === undefined) {
      throw new Error(`translation_pack_manifest_ref_missing:${verified.packId}`);
    }
    return parseTranslationPack(verified.bytes, result.manifest, pack);
  });
  assertUnique(rows.map((row) => row.occurrenceKey), "译文 occurrence 重复");
  return { manifest: result.manifest, rows, etag: result.etag };
}

function parseTranslationPack(
  bytes: Uint8Array,
  manifest: TranslationExportManifest,
  pack: TranslationPackRef,
): TranslationOccurrence[] {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new Error(`译文包 JSON 无效：${pack.packId}`); }
  if (!isRecord(value) || value.schema !== "trans-hub.translation-pack" || value.version !== 1 || !Array.isArray(value.items)) {
    throw new Error(`译文包 schema 无效：${pack.packId}`);
  }
  if (value.source_version_id !== manifest.sourceVersionId || value.target_locale !== manifest.targetLocale || value.target_variant !== manifest.targetVariant || value.pack_index !== pack.packIndex || value.items.length !== pack.itemCount) {
    throw new Error(`译文包作用域不匹配：${pack.packId}`);
  }
  return value.items.map((item, index) => {
    if (!isRecord(item)) throw new Error(`译文行无效：${pack.packId}:${index}`);
    return {
      occurrenceKey: requiredString(item.occurrence_key),
      translatedText: typeof item.target_text === "string" ? item.target_text : (() => { throw new Error("译文文本无效。"); })(),
      structuredContent: record(item.structured_content, "translation_structured_content_invalid"),
    };
  });
}

function parseDeliveryProvenance(
  structuredContent: Readonly<Record<string, unknown>>,
): Pick<PluginTranslationRow, "provenanceKind" | "application" | "nativeTarget"> {
  const raw = structuredContent.delivery_provenance;
  if (raw === undefined) return {};
  const value = record(raw, "translation_delivery_provenance_invalid");
  const provenanceKind = value.kind;
  const application = value.application;
  if (!isPluginTranslationProvenanceKind(provenanceKind) || !isPluginTranslationApplication(application)) {
    throw new Error("translation_delivery_provenance_invalid");
  }
  const nativeTarget = value.native_target;
  if (provenanceKind === "th-reviewed-correction" && application !== "correction") {
    throw new Error("translation_delivery_correction_invalid");
  }
  if (application === "correction") {
    if (provenanceKind !== "th-reviewed-correction" || typeof nativeTarget !== "string" || nativeTarget.trim() === "") {
      throw new Error("translation_delivery_correction_invalid");
    }
    return { provenanceKind, application, nativeTarget: nativeTarget.normalize("NFC").trim() };
  }
  if (nativeTarget !== undefined) throw new Error("translation_delivery_native_target_unexpected");
  return { provenanceKind, application };
}

function parseSourceCompatibility(
  structuredContent: Readonly<Record<string, unknown>>,
): Pick<PluginTranslationRow, "sourceCompatibility"> {
  const raw = structuredContent.source_compatibility;
  if (!isRecord(raw)
    || raw.schema !== "trans-hub.source-compatibility"
    || raw.version !== 1
    || typeof raw.semantic_role !== "string"
    || raw.semantic_role === ""
    || !Array.isArray(raw.content_scopes)
    || raw.content_scopes.length === 0
    || typeof raw.placeholder_signature !== "string"
    || typeof raw.format_signature !== "string"
    || raw.format_signature === ""
    || typeof raw.source_content_digest !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(raw.source_content_digest)) {
    // Exact-version packs predate this additive field. Cross-version
    // validation treats absence or malformed evidence as an inapplicable row.
    return {};
  }
  const contentScopes = raw.content_scopes;
  if (!contentScopes.every((scope): scope is string => typeof scope === "string" && scope !== "")
    || [...new Set(contentScopes)].length !== contentScopes.length
    || [...contentScopes].sort().some((scope, index) => scope !== contentScopes[index])) return {};
  return {
    sourceCompatibility: {
      semanticRole: raw.semantic_role,
      contentScopes,
      placeholderSignature: raw.placeholder_signature,
      formatSignature: raw.format_signature,
      sourceContentDigest: raw.source_content_digest,
    },
  };
}

function isPluginTranslationProvenanceKind(
  value: unknown,
): value is PluginTranslationProvenanceKind {
  return value === "upstream-native" || value === "th-reviewed-fill"
    || value === "th-reviewed-correction" || value === "th-automatic"
    || value === "th-published";
}

function isPluginTranslationApplication(value: unknown): value is PluginTranslationApplication {
  return value === "fill" || value === "correction";
}

function assertUnique(values: readonly string[], prefix: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${prefix}：${value}`);
    seen.add(value);
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value === "") throw new Error("translation_field_missing");
  return value;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(code);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
