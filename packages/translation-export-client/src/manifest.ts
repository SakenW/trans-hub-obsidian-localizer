import {
  TRANSLATION_EXPORT_LEGACY_REVISION,
  TRANSLATION_EXPORT_REVISION,
  TRANSLATION_EXPORT_SCHEMA,
  type ExportScope,
  type Sha256Digest,
  type TranslationExportManifest,
  type TranslationExportServerProof,
  type TranslationPackRef,
} from "./contracts";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export function parseTranslationExportManifest(
  input: unknown,
): TranslationExportManifest {
  const value = record(input, "translation_manifest_invalid");
  if (
    value.schema !== TRANSLATION_EXPORT_SCHEMA ||
    (value.revision !== TRANSLATION_EXPORT_LEGACY_REVISION &&
      value.revision !== TRANSLATION_EXPORT_REVISION)
  ) {
    throw new TypeError("translation_manifest_revision_unsupported");
  }
  if (!Array.isArray(value.packs))
    throw new TypeError("translation_manifest_invalid");
  const packs = value.packs.map(parsePack);
  packs.forEach((pack, index) => {
    if (pack.packIndex !== index)
      throw new TypeError("translation_pack_index_invalid");
  });
  const common = {
    schema: TRANSLATION_EXPORT_SCHEMA,
    manifestId: string(value.manifest_id, "translation_manifest_id_invalid"),
    generationId: string(
      value.generation_id,
      "translation_generation_id_invalid",
    ),
    generationNumber: integer(
      value.generation_number,
      "translation_generation_invalid",
    ),
    sourceStreamId: string(
      value.source_stream_id,
      "translation_source_stream_invalid",
    ),
    sourceVersionId: string(
      value.source_version_id,
      "translation_source_version_invalid",
    ),
    targetLocale: string(value.target_locale, "translation_locale_invalid"),
    targetVariant: string(value.target_variant, "translation_variant_invalid"),
    scope: parseScope(value.scope),
    manifestDigest: digest(
      value.manifest_digest,
      "translation_manifest_digest_invalid",
    ),
    packs,
  };
  return value.revision === TRANSLATION_EXPORT_LEGACY_REVISION
    ? { ...common, revision: TRANSLATION_EXPORT_LEGACY_REVISION }
    : {
        ...common,
        revision: TRANSLATION_EXPORT_REVISION,
        serverProof: parseServerProof(value.server_proof),
      };
}

/** Validate the camelCase form persisted by clients after parsing the wire response. */
export function parseStoredTranslationExportManifest(
  input: unknown,
): TranslationExportManifest {
  const value = record(input, "translation_manifest_invalid");
  const scope = record(value.scope, "translation_scope_invalid");
  const storedProof =
    value.revision === TRANSLATION_EXPORT_REVISION
      ? record(value.serverProof, "translation_manifest_proof_invalid")
      : undefined;
  if (!Array.isArray(value.packs))
    throw new TypeError("translation_manifest_invalid");
  return parseTranslationExportManifest({
    schema: value.schema,
    revision: value.revision,
    manifest_id: value.manifestId,
    generation_id: value.generationId,
    generation_number: value.generationNumber,
    source_stream_id: value.sourceStreamId,
    source_version_id: value.sourceVersionId,
    target_locale: value.targetLocale,
    target_variant: value.targetVariant,
    scope:
      scope.kind === "public"
        ? { kind: "public", public_scope_id: scope.publicScopeId }
        : {
            kind: scope.kind,
            tenant_id: scope.tenantId,
            workspace_id: scope.workspaceId,
            encryption_domain_id: scope.encryptionDomainId,
          },
    manifest_digest: value.manifestDigest,
    ...(value.revision === TRANSLATION_EXPORT_REVISION
      ? {
          server_proof: {
            domain: storedProof?.domain,
            algorithm: storedProof?.algorithm,
            keyId: storedProof?.keyId,
            keyVersion: storedProof?.keyVersion,
            payloadDigest: storedProof?.payloadDigest,
            signedAt: storedProof?.signedAt,
            expiresAt: storedProof?.expiresAt,
            signature: storedProof?.signature,
          },
        }
      : {}),
    packs: value.packs.map((item) => {
      const pack = record(item, "translation_pack_invalid");
      return {
        pack_id: pack.packId,
        pack_index: pack.packIndex,
        item_count: pack.itemCount,
        compressed_bytes: pack.compressedBytes,
        uncompressed_bytes: pack.uncompressedBytes,
        object_version: pack.objectVersion,
        transport_digest: pack.transportDigest,
        canonical_payload_digest: pack.canonicalPayloadDigest,
        logical_object_digest: pack.logicalObjectDigest,
      };
    }),
  });
}

export function translationManifestSignedPayload(
  manifest: TranslationExportManifest & Readonly<{ revision: 2 }>,
): Readonly<Record<string, unknown>> {
  return {
    schema: manifest.schema,
    revision: manifest.revision,
    manifest_id: manifest.manifestId,
    generation_id: manifest.generationId,
    generation_number: manifest.generationNumber,
    source_stream_id: manifest.sourceStreamId,
    source_version_id: manifest.sourceVersionId,
    target_locale: manifest.targetLocale,
    target_variant: manifest.targetVariant,
    scope:
      manifest.scope.kind === "public"
        ? { kind: "public", public_scope_id: manifest.scope.publicScopeId }
        : {
            kind: "private",
            tenant_id: manifest.scope.tenantId,
            workspace_id: manifest.scope.workspaceId,
            encryption_domain_id: manifest.scope.encryptionDomainId,
          },
    manifest_digest: manifest.manifestDigest,
    packs: manifest.packs.map((pack) => ({
      pack_id: pack.packId,
      pack_index: pack.packIndex,
      item_count: pack.itemCount,
      compressed_bytes: pack.compressedBytes,
      uncompressed_bytes: pack.uncompressedBytes,
      object_version: pack.objectVersion,
      transport_digest: pack.transportDigest,
      canonical_payload_digest: pack.canonicalPayloadDigest,
      logical_object_digest: pack.logicalObjectDigest,
    })),
  };
}

function parseServerProof(input: unknown): TranslationExportServerProof {
  const value = record(input, "translation_manifest_proof_invalid");
  if (
    value.domain !== "translation_export_manifest" ||
    value.algorithm !== "ed25519"
  ) {
    throw new TypeError("translation_manifest_proof_invalid");
  }
  const signedAt = timestamp(
    value.signedAt,
    "translation_manifest_signed_at_invalid",
  );
  const expiresAt = timestamp(
    value.expiresAt,
    "translation_manifest_expires_at_invalid",
  );
  if (Date.parse(expiresAt) <= Date.parse(signedAt)) {
    throw new TypeError("translation_manifest_proof_lifetime_invalid");
  }
  return {
    domain: "translation_export_manifest",
    algorithm: "ed25519",
    keyId: string(value.keyId, "translation_manifest_key_invalid"),
    keyVersion: positiveInteger(
      value.keyVersion,
      "translation_manifest_key_version_invalid",
    ),
    payloadDigest: parseSignedPayloadDigest(value.payloadDigest),
    signedAt,
    expiresAt,
    signature: signature(value.signature),
  };
}

function parseSignedPayloadDigest(
  input: unknown,
): TranslationExportServerProof["payloadDigest"] {
  const value = record(input, "translation_manifest_payload_digest_invalid");
  if (
    value.algorithm !== "sha256" ||
    value.domain !== "signed_payload" ||
    typeof value.hex !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.hex)
  ) {
    throw new TypeError("translation_manifest_payload_digest_invalid");
  }
  return { algorithm: "sha256", domain: "signed_payload", hex: value.hex };
}

function timestamp(input: unknown, code: string): string {
  const value = string(input, code);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError(code);
  }
  return value;
}

function signature(input: unknown): string {
  const value = string(input, "translation_manifest_signature_invalid");
  if (!/^[A-Za-z0-9_-]{86}$/u.test(value)) {
    throw new TypeError("translation_manifest_signature_invalid");
  }
  return value;
}

function parsePack(input: unknown): TranslationPackRef {
  const value = record(input, "translation_pack_invalid");
  return {
    packId: string(value.pack_id, "translation_pack_id_invalid"),
    packIndex: integer(value.pack_index, "translation_pack_index_invalid"),
    itemCount: integer(value.item_count, "translation_pack_count_invalid"),
    compressedBytes: positiveInteger(
      value.compressed_bytes,
      "translation_pack_size_invalid",
    ),
    uncompressedBytes: positiveInteger(
      value.uncompressed_bytes,
      "translation_pack_uncompressed_size_invalid",
    ),
    objectVersion: string(
      value.object_version,
      "translation_object_version_invalid",
    ),
    transportDigest: digest(
      value.transport_digest,
      "translation_transport_digest_invalid",
    ),
    canonicalPayloadDigest: digest(
      value.canonical_payload_digest,
      "translation_payload_digest_invalid",
    ),
    logicalObjectDigest: digest(
      value.logical_object_digest,
      "translation_logical_digest_invalid",
    ),
  };
}

function parseScope(input: unknown): ExportScope {
  const value = record(input, "translation_scope_invalid");
  if (value.kind === "public") {
    return {
      kind: "public",
      publicScopeId: string(
        value.public_scope_id,
        "translation_public_scope_invalid",
      ),
    };
  }
  if (value.kind === "private") {
    return {
      kind: "private",
      tenantId: string(value.tenant_id, "translation_tenant_invalid"),
      workspaceId: string(value.workspace_id, "translation_workspace_invalid"),
      encryptionDomainId: string(
        value.encryption_domain_id,
        "translation_encryption_domain_invalid",
      ),
    };
  }
  throw new TypeError("translation_scope_invalid");
}

function record(input: unknown, code: string): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(code);
  }
  return input as Record<string, unknown>;
}

function string(input: unknown, code: string): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input !== input.normalize("NFC")
  ) {
    throw new TypeError(code);
  }
  return input;
}

function digest(input: unknown, code: string): Sha256Digest {
  const value = string(input, code);
  if (!SHA256.test(value)) throw new TypeError(code);
  return value;
}

function integer(input: unknown, code: string): number {
  if (!Number.isSafeInteger(input) || (input as number) < 0)
    throw new TypeError(code);
  return input as number;
}

function positiveInteger(input: unknown, code: string): number {
  const value = integer(input, code);
  if (value === 0) throw new TypeError(code);
  return value;
}
