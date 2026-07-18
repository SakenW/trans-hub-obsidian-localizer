import { Readable } from "node:stream";
import { createZstdDecompress } from "node:zlib";

import { canonicalizeProtocolJson } from "@trans-hub/client-protocol";

import type { TransportClient } from "./http-transport";
import { sha256Hex } from "./identity";
import { ObsidianPackDownloader } from "./obsidian-pack-downloader";
import type {
  PluginTranslationApplication,
  PluginTranslationProvenanceKind,
} from "./plugin-ui-runtime";

export interface TranslationPackRef {
  readonly packId: string;
  readonly packIndex: number;
  readonly itemCount: number;
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly objectVersion: string;
  readonly transportDigest: string;
  readonly canonicalPayloadDigest: string;
  readonly logicalObjectDigest: string;
}

export interface TranslationExportManifest {
  readonly manifestId: string;
  readonly sourceVersionId: string;
  readonly targetLocale: string;
  readonly targetVariant: string;
  readonly scope: { readonly kind: "public"; readonly publicScopeId: string } |
    { readonly kind: "private"; readonly workspaceId: string };
  readonly packs: readonly TranslationPackRef[];
}

export interface TranslationRow {
  readonly noteId: string;
  readonly blockId: string;
  readonly translatedText: string;
  readonly translationDigest: string;
}

export interface PluginTranslationRow {
  readonly pluginId: string;
  readonly stringKey: string;
  readonly translatedText: string;
  readonly translationDigest: string;
  readonly provenanceKind?: PluginTranslationProvenanceKind;
  readonly application?: PluginTranslationApplication;
  readonly nativeTarget?: string;
}

export interface TranslationSyncOutput<Row> {
  readonly manifest: TranslationExportManifest;
  readonly rows: readonly Row[];
  readonly etag: string;
}

interface TranslationOccurrence {
  readonly occurrenceKey: string;
  readonly translatedText: string;
  readonly translationDigest: string;
  readonly structuredContent: Readonly<Record<string, unknown>>;
}

interface DownloadInput {
  readonly transport: TransportClient;
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly sourceVersionId: string;
  readonly targetLocale: string;
  readonly developmentDownloadOrigin?: string;
}

export async function downloadTranslations(input: DownloadInput & {
  readonly expectedNoteId: string;
}): Promise<TranslationSyncOutput<TranslationRow>> {
  const result = await downloadTranslationOccurrences(input);
  const rows = result.rows.map((row): TranslationRow => {
    const match = /^obsidian:block:([^:]+):([^:]+)$/u.exec(row.occurrenceKey);
    if (match === null) throw new Error(`译文 occurrence 不属于 Obsidian 笔记：${row.occurrenceKey}`);
    if (match[1] !== input.expectedNoteId) throw new Error(`译文 occurrence 与当前笔记不匹配：${match[1]}`);
    return { noteId: match[1], blockId: match[2], translatedText: row.translatedText, translationDigest: row.translationDigest };
  });
  assertUnique(rows.map((row) => `${row.noteId}\u0000${row.blockId}`), "译文 occurrence 重复");
  return { manifest: result.manifest, rows, etag: result.etag };
}

export async function downloadPluginTranslations(input: DownloadInput & {
  readonly expectedPluginId: string;
}): Promise<TranslationSyncOutput<PluginTranslationRow>> {
  const result = await downloadTranslationOccurrences(input);
  const rows = result.rows.map((row): PluginTranslationRow => {
    const match = /^obsidian:plugin-ui:([^:]+):([a-f0-9]{32})$/u.exec(row.occurrenceKey);
    if (match === null) throw new Error(`译文 occurrence 不属于 Obsidian 插件：${row.occurrenceKey}`);
    if (match[1] !== input.expectedPluginId) throw new Error(`译文 occurrence 与当前插件不匹配：${match[1]}`);
    return {
      pluginId: match[1],
      stringKey: match[2],
      translatedText: row.translatedText,
      translationDigest: row.translationDigest,
      ...parseDeliveryProvenance(row.structuredContent),
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
    return { noteId: match[1], blockId: match[2], translatedText: row.translatedText, translationDigest: row.translationDigest };
  });
}

export function parsePluginTranslationPack(
  bytes: Uint8Array,
  manifest: TranslationExportManifest,
  pack: TranslationPackRef,
): PluginTranslationRow[] {
  return parseTranslationPack(bytes, manifest, pack).map((row) => {
    const match = /^obsidian:plugin-ui:([^:]+):([a-f0-9]{32})$/u.exec(row.occurrenceKey);
    if (match === null) throw new Error(`译文 occurrence 不属于 Obsidian 插件：${row.occurrenceKey}`);
    return {
      pluginId: match[1],
      stringKey: match[2],
      translatedText: row.translatedText,
      translationDigest: row.translationDigest,
      ...parseDeliveryProvenance(row.structuredContent),
    };
  });
}

async function downloadTranslationOccurrences(
  input: DownloadInput,
): Promise<TranslationSyncOutput<TranslationOccurrence>> {
  const query = new URLSearchParams({
    source_version_id: input.sourceVersionId,
    target_locale: input.targetLocale,
    target_variant: "default",
  });
  const manifestResponse = await input.transport.send({
    method: "GET",
    path: `/v1/public-client/translation-exports/current?${query.toString()}`,
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  if (manifestResponse.status !== 200) {
    throw new Error(`Published export not found：HTTP ${manifestResponse.status}`);
  }
  const manifest = parseManifest(manifestResponse.body);
  if (
    manifest.sourceVersionId !== input.sourceVersionId ||
    manifest.targetLocale !== input.targetLocale ||
    manifest.targetVariant !== "default" ||
    (manifest.scope.kind === "public"
      ? manifest.scope.publicScopeId !== input.workspaceId
      : manifest.scope.workspaceId !== input.workspaceId)
  ) {
    throw new Error("translation_manifest_scope_mismatch");
  }
  const ticketResponse = await input.transport.send<{ readonly tickets?: unknown }>({
    method: "POST",
    path: "/v1/public-client/translation-exports/download-tickets",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    body: { manifest_id: manifest.manifestId, pack_ids: manifest.packs.map((pack) => pack.packId) },
  });
  if (ticketResponse.status !== 200 || !Array.isArray(ticketResponse.body.tickets)) {
    throw new Error(`translation_ticket_failed:${ticketResponse.status}`);
  }
  const tickets = new Map(ticketResponse.body.tickets.map((value) => {
    const ticket = record(value, "translation_ticket_invalid");
    return [requiredString(ticket.pack_id), ticket] as const;
  }));
  if (tickets.size !== manifest.packs.length) throw new Error("translation_ticket_set_mismatch");
  const downloader = new ObsidianPackDownloader({
    ...(input.developmentDownloadOrigin === undefined ? {} : { developmentOrigin: input.developmentDownloadOrigin }),
  });
  const rows: TranslationOccurrence[] = [];
  for (const pack of manifest.packs) {
    const ticket = tickets.get(pack.packId);
    if (ticket === undefined || requiredString(ticket.object_version) !== pack.objectVersion) {
      throw new Error(`translation_ticket_version_mismatch:${pack.packId}`);
    }
    const bytes = await downloader.download({ url: requiredString(ticket.url), objectVersion: pack.objectVersion });
    const canonicalBytes = await verifyPack(bytes, pack);
    rows.push(...parseTranslationPack(canonicalBytes, manifest, pack));
  }
  assertUnique(rows.map((row) => row.occurrenceKey), "译文 occurrence 重复");
  return { manifest, rows, etag: manifestResponse.headers.etag ?? "" };
}

async function verifyPack(bytes: Uint8Array, pack: TranslationPackRef): Promise<Uint8Array> {
  if (bytes.byteLength !== pack.compressedBytes || `sha256:${await sha256Hex(bytes)}` !== pack.transportDigest) {
    throw new Error(`translation_pack_transport_mismatch:${pack.packId}`);
  }
  const canonicalBytes = await decompressZstd(bytes, pack.packId);
  if (
    canonicalBytes.byteLength !== pack.uncompressedBytes ||
    `sha256:${await sha256Hex(canonicalBytes)}` !== pack.canonicalPayloadDigest
  ) {
    throw new Error(`translation_pack_canonical_mismatch:${pack.packId}`);
  }
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(canonicalBytes)) as unknown;
  const expected = canonicalizeProtocolJson(value);
  if (!bytesEqual(canonicalBytes, expected)) throw new Error(`translation_pack_not_canonical:${pack.packId}`);
  return canonicalBytes;
}

async function decompressZstd(bytes: Uint8Array, packId: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of Readable.from([bytes]).pipe(createZstdDecompress())) {
      if (!(chunk instanceof Uint8Array)) throw new Error("invalid chunk");
      total += chunk.byteLength;
      if (total > 16 * 1024 * 1024) throw new Error("limit exceeded");
      chunks.push(chunk);
    }
  } catch {
    throw new Error(`translation_pack_zstd_invalid:${packId}`);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseManifest(value: unknown): TranslationExportManifest {
  const wire = record(value, "translation_manifest_invalid");
  if (!Array.isArray(wire.packs)) throw new Error("translation_manifest_invalid");
  const scopeWire = record(wire.scope, "translation_scope_invalid");
  const scope = scopeWire.kind === "public"
    ? { kind: "public" as const, publicScopeId: requiredString(scopeWire.public_scope_id) }
    : scopeWire.kind === "private"
      ? { kind: "private" as const, workspaceId: requiredString(scopeWire.workspace_id) }
      : (() => { throw new Error("translation_scope_invalid"); })();
  return {
    manifestId: requiredString(wire.manifest_id),
    sourceVersionId: requiredString(wire.source_version_id),
    targetLocale: requiredString(wire.target_locale),
    targetVariant: requiredString(wire.target_variant),
    scope,
    packs: wire.packs.map((item, index) => {
      const pack = record(item, "translation_pack_invalid");
      if (pack.pack_index !== index) throw new Error("translation_pack_index_invalid");
      return {
        packId: requiredString(pack.pack_id),
        packIndex: requiredInteger(pack.pack_index),
        itemCount: requiredInteger(pack.item_count),
        compressedBytes: requiredInteger(pack.compressed_bytes),
        uncompressedBytes: requiredInteger(pack.uncompressed_bytes),
        objectVersion: requiredString(pack.object_version),
        transportDigest: requiredDigest(pack.transport_digest),
        canonicalPayloadDigest: requiredDigest(pack.canonical_payload_digest),
        logicalObjectDigest: requiredDigest(pack.logical_object_digest),
      };
    }),
  };
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
      translationDigest: requiredString(item.payload_digest),
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

function requiredDigest(value: unknown): string {
  const result = requiredString(value);
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) throw new Error("translation_digest_invalid");
  return result;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value === "") throw new Error("translation_field_missing");
  return value;
}

function requiredInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("translation_integer_invalid");
  return Number(value);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(code);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}
