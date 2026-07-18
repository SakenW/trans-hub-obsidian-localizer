import { assertComponentClosure, parseComponent } from "./acquisition-parser.js";
import type {
  NativeTransferAuthorizationWire,
  NativeTransferCapabilityWire,
  ProviderUploadGrantWire,
  PublicArtifactManifest,
  PublicDownloadTicket,
  PublicUploadGrant,
  PublicUploadGrantRequest,
  ServerEnvelopeDomain,
  ServerSignatureEnvelope,
} from "./contracts.js";
import { parseInstallationProof } from "./contribution-parser.js";
import { protocolError } from "./errors.js";
import { LOCALE_NORMALIZATION_REVISION } from "./locale.js";
import { parseCanonicalLocale, parseCanonicalVariant, parseNullable } from "./parser-primitives.js";
import {
  exactObject,
  expectArray,
  expectHttpsUrl,
  expectIdentifier,
  expectInteger,
  expectLiteral,
  expectMediaType,
  expectNonce,
  expectSignature,
  expectString,
  expectTimestamp,
  expectUida,
  expectUuid,
  parseDigest,
  parseProtocolVersion,
} from "./schema.js";

export function parseServerProof<Domain extends ServerEnvelopeDomain>(
  value: unknown,
  expectedDomain: Domain,
  path: string
): ServerSignatureEnvelope<Domain> {
  const record = exactObject(value, path, [
    "domain",
    "algorithm",
    "keyId",
    "keyVersion",
    "payloadDigest",
    "signedAt",
    "expiresAt",
    "signature",
  ]);
  const signedAt = expectTimestamp(record.signedAt, `${path}.signedAt`);
  const expiresAt = parseNullable(record.expiresAt, (item) =>
    expectTimestamp(item, `${path}.expiresAt`)
  );
  if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(signedAt)) {
    protocolError("CP_INVALID_TIMESTAMP", `${path}.expiresAt`, "proof expiry must follow signing");
  }
  return {
    domain: expectLiteral(record.domain, expectedDomain, `${path}.domain`),
    algorithm: expectLiteral(record.algorithm, "ed25519", `${path}.algorithm`),
    keyId: expectIdentifier(record.keyId, `${path}.keyId`),
    keyVersion: expectInteger(record.keyVersion, `${path}.keyVersion`, { minimum: 1 }),
    payloadDigest: parseDigest(record.payloadDigest, "signed_payload", `${path}.payloadDigest`),
    signedAt,
    expiresAt,
    signature: expectSignature(record.signature, `${path}.signature`),
  };
}

function parseProviderUploadGrant(value: unknown, path: string): ProviderUploadGrantWire {
  const record = exactObject(value, path, [
    "provider",
    "upload_session_id",
    "bucket",
    "staging_key",
    "token",
    "expires_at_epoch_ms",
    "upload_origins",
  ]);
  const origins = expectArray(
    record.upload_origins,
    `${path}.upload_origins`,
    (item, itemPath) => {
      const origin = expectString(item, itemPath, { max: 2048 });
      expectHttpsUrl(origin, itemPath);
      const parsed = new URL(origin);
      if (parsed.pathname !== "/") {
        protocolError("CP_UNSAFE_LOCATOR", itemPath, "upload origin must not contain a path");
      }
      return origin;
    },
    { minimum: 1, maximum: 8 }
  );
  if (new Set(origins).size !== origins.length) {
    protocolError("CP_INVALID_VALUE", `${path}.upload_origins`, "upload origins must be unique");
  }
  return {
    provider: expectIdentifier(record.provider, `${path}.provider`),
    upload_session_id: expectUuid(record.upload_session_id, `${path}.upload_session_id`),
    bucket: expectProviderBucket(record.bucket, `${path}.bucket`),
    staging_key: expectString(record.staging_key, `${path}.staging_key`, { max: 1024 }),
    token: expectString(record.token, `${path}.token`, { max: 8192 }),
    expires_at_epoch_ms: expectInteger(record.expires_at_epoch_ms, `${path}.expires_at_epoch_ms`, {
      minimum: 1,
    }),
    upload_origins: origins,
  };
}

function expectProviderBucket(value: unknown, path: string): string {
  const bucket = expectString(value, path, { max: 63 });
  if (!/^[A-Za-z0-9_-]+$/u.test(bucket)) {
    protocolError("CP_INVALID_VALUE", path, "invalid provider bucket");
  }
  return bucket;
}

function parseNativeAuthorization(value: unknown, path: string): NativeTransferAuthorizationWire {
  const record = exactObject(value, path, [
    "contract_revision",
    "server_contract",
    "lane",
    "direction",
    "workspace_id",
    "session_id",
    "authority_scope",
    "object_digest",
    "object_bytes",
    "part_bytes",
    "expires_at_epoch_ms",
    "source_head",
    "export_revision",
  ]);
  const objectDigest = expectString(record.object_digest, `${path}.object_digest`, {
    min: 71,
    max: 71,
  });
  if (!/^sha256:[0-9a-f]{64}$/u.test(objectDigest)) {
    protocolError("CP_INVALID_DIGEST", `${path}.object_digest`, "invalid native object digest");
  }
  if (record.source_head !== null || record.export_revision !== null) {
    protocolError("CP_INVALID_VALUE", path, "upload authorization cannot carry export authority");
  }
  return {
    contract_revision: expectLiteral(
      record.contract_revision,
      "private-native-core.transfer.v3",
      `${path}.contract_revision`
    ),
    server_contract: expectLiteral(
      record.server_contract,
      "trans_hub_api_v1",
      `${path}.server_contract`
    ),
    lane: expectLiteral(record.lane, "public", `${path}.lane`),
    direction: expectLiteral(record.direction, "upload", `${path}.direction`),
    workspace_id: expectUuid(record.workspace_id, `${path}.workspace_id`),
    session_id: expectUuid(record.session_id, `${path}.session_id`),
    authority_scope: expectString(record.authority_scope, `${path}.authority_scope`, {
      max: 1024,
    }),
    object_digest: objectDigest,
    object_bytes: expectInteger(record.object_bytes, `${path}.object_bytes`, { minimum: 1 }),
    part_bytes: expectInteger(record.part_bytes, `${path}.part_bytes`, {
      minimum: 1024 * 1024,
      maximum: 16 * 1024 * 1024,
    }),
    expires_at_epoch_ms: expectInteger(record.expires_at_epoch_ms, `${path}.expires_at_epoch_ms`, {
      minimum: 1,
    }),
    source_head: null,
    export_revision: null,
  };
}

function parseNativeCapability(value: unknown, path: string): NativeTransferCapabilityWire {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "capability_id",
    "capability_epoch",
    "nonce",
    "authorization",
    "provider_grant_digest",
    "issued_at",
    "expires_at",
    "server_proof",
  ]);
  const issuedAt = expectTimestamp(record.issued_at, `${path}.issued_at`);
  const expiresAt = expectTimestamp(record.expires_at, `${path}.expires_at`);
  const serverProof = parseServerProof(
    record.server_proof,
    "native_transfer_capability",
    `${path}.server_proof`
  );
  if (serverProof.expiresAt !== expiresAt) {
    protocolError(
      "CP_INVALID_TIMESTAMP",
      `${path}.server_proof.expiresAt`,
      "native capability and proof expiry must match exactly"
    );
  }
  if (serverProof.signedAt !== issuedAt || Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    protocolError(
      "CP_INVALID_TIMESTAMP",
      path,
      "native capability proof time must exactly bind the capability lifetime"
    );
  }
  return {
    kind: expectLiteral(record.kind, "native_transfer_capability", `${path}.kind`),
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    capability_id: expectUuid(record.capability_id, `${path}.capability_id`),
    capability_epoch: expectInteger(record.capability_epoch, `${path}.capability_epoch`, {
      minimum: 1,
    }),
    nonce: expectNonce(record.nonce, `${path}.nonce`),
    authorization: parseNativeAuthorization(record.authorization, `${path}.authorization`),
    provider_grant_digest: parseDigest(
      record.provider_grant_digest,
      "provider_upload_grant",
      `${path}.provider_grant_digest`
    ),
    issued_at: issuedAt,
    expires_at: expiresAt,
    server_proof: serverProof,
  };
}

export function parsePublicUploadGrantRequest(
  value: unknown,
  path = "$"
): PublicUploadGrantRequest {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "idempotencyKey",
    "installationId",
    "componentRole",
    "componentName",
    "installationProof",
  ]);
  return {
    kind: expectLiteral(record.kind, "public_upload_grant_request", `${path}.kind`),
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    idempotencyKey: expectString(record.idempotencyKey, `${path}.idempotencyKey`, {
      min: 16,
      max: 128,
    }),
    installationId: expectUuid(record.installationId, `${path}.installationId`),
    componentRole: expectIdentifier(record.componentRole, `${path}.componentRole`),
    componentName: expectIdentifier(record.componentName, `${path}.componentName`),
    installationProof: parseInstallationProof(
      record.installationProof,
      `${path}.installationProof`
    ),
  };
}

function parseRequiredHeaders(value: unknown, path: string): Readonly<Record<string, string>> {
  const record = exactObject(
    value,
    path,
    [],
    ["content-type", "content-length", "content-digest", "x-trans-hub-grant-id"]
  );
  const parsed: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(record)) {
    if (name !== name.toLowerCase()) {
      protocolError(
        "CP_INVALID_VALUE",
        `${path}.${name}`,
        "required header names must be lowercase"
      );
    }
    parsed[name] = expectString(headerValue, `${path}.${name}`, { max: 2048 });
  }
  return Object.freeze(parsed);
}

export function parsePublicUploadGrant(value: unknown, path = "$"): PublicUploadGrant {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "grantId",
    "audience",
    "plane",
    "installationId",
    "contributionId",
    "scope",
    "upload",
    "nonce",
    "credentialEpoch",
    "expiresAt",
    "serverProof",
  ]);
  expectLiteral(record.kind, "public_upload_grant", `${path}.kind`);
  const scope = exactObject(record.scope, `${path}.scope`, [
    "manifestRootDigest",
    "componentRole",
    "componentName",
    "transportDigest",
    "contentLength",
    "mediaType",
  ]);
  const uploadBase = exactObject(
    record.upload,
    `${path}.upload`,
    ["kind"],
    ["method", "url", "requiredHeaders", "providerGrant", "nativeCapability"]
  );
  const upload = (() => {
    if (uploadBase.kind === "https_put") {
      const value = exactObject(record.upload, `${path}.upload`, [
        "kind",
        "method",
        "url",
        "requiredHeaders",
      ]);
      return {
        kind: expectLiteral(value.kind, "https_put", `${path}.upload.kind`),
        method: expectLiteral(value.method, "PUT", `${path}.upload.method`),
        url: expectHttpsUrl(value.url, `${path}.upload.url`, { allowQuery: true }),
        requiredHeaders: parseRequiredHeaders(
          value.requiredHeaders,
          `${path}.upload.requiredHeaders`
        ),
      } as const;
    }
    if (uploadBase.kind === "provider_grant") {
      const value = exactObject(record.upload, `${path}.upload`, [
        "kind",
        "providerGrant",
        "nativeCapability",
      ]);
      return {
        kind: expectLiteral(value.kind, "provider_grant", `${path}.upload.kind`),
        providerGrant: parseProviderUploadGrant(
          value.providerGrant,
          `${path}.upload.providerGrant`
        ),
        nativeCapability: parseNativeCapability(
          value.nativeCapability,
          `${path}.upload.nativeCapability`
        ),
      } as const;
    }
    protocolError("CP_INVALID_VALUE", `${path}.upload.kind`, "unsupported public upload transport");
  })();
  const expiresAt = expectTimestamp(record.expiresAt, `${path}.expiresAt`);
  const serverProof = parseServerProof(
    record.serverProof,
    "public_upload_grant",
    `${path}.serverProof`
  );
  if (serverProof.expiresAt !== expiresAt) {
    protocolError(
      "CP_INVALID_TIMESTAMP",
      `${path}.serverProof.expiresAt`,
      "grant and proof expiry must match exactly"
    );
  }
  const contributionId = expectUuid(record.contributionId, `${path}.contributionId`);
  const parsedScope = {
    manifestRootDigest: parseDigest(
      scope.manifestRootDigest,
      "manifest_root",
      `${path}.scope.manifestRootDigest`
    ),
    componentRole: expectIdentifier(scope.componentRole, `${path}.scope.componentRole`),
    componentName: expectIdentifier(scope.componentName, `${path}.scope.componentName`),
    transportDigest: parseDigest(
      scope.transportDigest,
      "transport",
      `${path}.scope.transportDigest`
    ),
    contentLength: expectInteger(scope.contentLength, `${path}.scope.contentLength`, {
      minimum: 1,
      maximum: 8_589_934_592,
    }),
    mediaType: expectMediaType(scope.mediaType, `${path}.scope.mediaType`),
  } as const;
  if (upload.kind === "provider_grant") {
    const authorization = upload.nativeCapability.authorization;
    const authorityParts = authorization.authority_scope.split(":");
    if (
      upload.providerGrant.upload_session_id !== authorization.session_id ||
      upload.providerGrant.upload_session_id !== upload.nativeCapability.capability_id ||
      upload.providerGrant.expires_at_epoch_ms !== authorization.expires_at_epoch_ms ||
      upload.providerGrant.expires_at_epoch_ms !== Date.parse(upload.nativeCapability.expires_at) ||
      upload.nativeCapability.expires_at !== expiresAt ||
      authorization.object_digest !== `sha256:${parsedScope.transportDigest.hex}` ||
      authorization.object_bytes !== parsedScope.contentLength ||
      authorityParts.length !== 4 ||
      authorityParts[0] !== "public_source" ||
      authorityParts[1] !== contributionId ||
      authorityParts[3] !== parsedScope.manifestRootDigest.hex
    ) {
      protocolError(
        "CP_INVALID_VALUE",
        `${path}.upload`,
        "provider upload authority is not closed over the outer grant scope"
      );
    }
    expectUuid(authorityParts[2], `${path}.upload.nativeCapability.authorization.authority_scope`);
  }
  return {
    kind: "public_upload_grant",
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    grantId: expectUuid(record.grantId, `${path}.grantId`),
    audience: expectLiteral(record.audience, "public-upload", `${path}.audience`),
    plane: expectLiteral(record.plane, "public", `${path}.plane`),
    installationId: expectUuid(record.installationId, `${path}.installationId`),
    contributionId,
    scope: parsedScope,
    upload,
    nonce: expectNonce(record.nonce, `${path}.nonce`),
    credentialEpoch: expectInteger(record.credentialEpoch, `${path}.credentialEpoch`, {
      minimum: 1,
    }),
    expiresAt,
    serverProof,
  };
}

export function parsePublicArtifactManifest(value: unknown, path = "$"): PublicArtifactManifest {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "manifestId",
    "audience",
    "plane",
    "publicationId",
    "objectUida",
    "monotonicRevision",
    "source",
    "localization",
    "logicalObjectDigest",
    "components",
    "manifestDigest",
    "publishedAt",
    "serverProof",
  ]);
  expectLiteral(record.kind, "public_artifact_manifest", `${path}.kind`);
  const source = exactObject(record.source, `${path}.source`, [
    "headId",
    "versionId",
    "digest",
    "locale",
  ]);
  const localization = exactObject(record.localization, `${path}.localization`, [
    "targetLocale",
    "variant",
    "localeNormalizationRevision",
  ]);
  const sourceLocale = parseCanonicalLocale(source.locale, `${path}.source.locale`);
  const targetLocale = parseCanonicalLocale(
    localization.targetLocale,
    `${path}.localization.targetLocale`
  );
  if (sourceLocale === targetLocale) {
    protocolError(
      "CP_INVALID_LOCALE",
      `${path}.localization.targetLocale`,
      "source and target locale must differ"
    );
  }
  const components = expectArray(record.components, `${path}.components`, parseComponent, {
    minimum: 1,
    maximum: 4096,
  });
  assertComponentClosure(components, `${path}.components`);
  return {
    kind: "public_artifact_manifest",
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    manifestId: expectIdentifier(record.manifestId, `${path}.manifestId`),
    audience: expectLiteral(record.audience, "public-download", `${path}.audience`),
    plane: expectLiteral(record.plane, "public", `${path}.plane`),
    publicationId: expectIdentifier(record.publicationId, `${path}.publicationId`),
    objectUida: expectUida(record.objectUida, `${path}.objectUida`),
    monotonicRevision: expectInteger(record.monotonicRevision, `${path}.monotonicRevision`, {
      minimum: 1,
    }),
    source: {
      headId: expectIdentifier(source.headId, `${path}.source.headId`),
      versionId: expectIdentifier(source.versionId, `${path}.source.versionId`),
      digest: parseDigest(source.digest, "source", `${path}.source.digest`),
      locale: sourceLocale,
    },
    localization: {
      targetLocale,
      variant: parseCanonicalVariant(localization.variant, `${path}.localization.variant`),
      localeNormalizationRevision: expectLiteral(
        localization.localeNormalizationRevision,
        LOCALE_NORMALIZATION_REVISION,
        `${path}.localization.localeNormalizationRevision`
      ),
    },
    logicalObjectDigest: parseDigest(
      record.logicalObjectDigest,
      "logical_object",
      `${path}.logicalObjectDigest`
    ),
    components,
    manifestDigest: parseDigest(record.manifestDigest, "manifest_root", `${path}.manifestDigest`),
    publishedAt: expectTimestamp(record.publishedAt, `${path}.publishedAt`),
    serverProof: parseServerProof(
      record.serverProof,
      "public_artifact_manifest",
      `${path}.serverProof`
    ),
  };
}

export function parsePublicDownloadTicket(value: unknown, path = "$"): PublicDownloadTicket {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "ticketId",
    "audience",
    "plane",
    "manifestId",
    "manifestDigest",
    "componentName",
    "transportDigest",
    "contentLength",
    "downloadUrl",
    "nonce",
    "credentialEpoch",
    "expiresAt",
    "serverProof",
  ]);
  expectLiteral(record.kind, "public_download_ticket", `${path}.kind`);
  const expiresAt = expectTimestamp(record.expiresAt, `${path}.expiresAt`);
  const serverProof = parseServerProof(
    record.serverProof,
    "public_download_ticket",
    `${path}.serverProof`
  );
  if (serverProof.expiresAt !== expiresAt) {
    protocolError(
      "CP_INVALID_TIMESTAMP",
      `${path}.serverProof.expiresAt`,
      "ticket and proof expiry must match exactly"
    );
  }
  return {
    kind: "public_download_ticket",
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    ticketId: expectIdentifier(record.ticketId, `${path}.ticketId`),
    audience: expectLiteral(record.audience, "public-download", `${path}.audience`),
    plane: expectLiteral(record.plane, "public", `${path}.plane`),
    manifestId: expectIdentifier(record.manifestId, `${path}.manifestId`),
    manifestDigest: parseDigest(record.manifestDigest, "manifest_root", `${path}.manifestDigest`),
    componentName: expectIdentifier(record.componentName, `${path}.componentName`),
    transportDigest: parseDigest(record.transportDigest, "transport", `${path}.transportDigest`),
    contentLength: expectInteger(record.contentLength, `${path}.contentLength`, {
      minimum: 1,
      maximum: 8_589_934_592,
    }),
    downloadUrl: expectHttpsUrl(record.downloadUrl, `${path}.downloadUrl`, { allowQuery: true }),
    nonce: expectNonce(record.nonce, `${path}.nonce`),
    credentialEpoch: expectInteger(record.credentialEpoch, `${path}.credentialEpoch`, {
      minimum: 1,
    }),
    expiresAt,
    serverProof,
  };
}
