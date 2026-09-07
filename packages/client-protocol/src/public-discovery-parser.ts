import type {
  PublicDiscoveryIntent,
  PublicDiscoveryReceipt,
  PublicDiscoveryStatus,
  PublicLocalizationStatusBatch,
  PublicLocalizationStatusProjection,
  RegistryVerificationProjection,
} from "./contracts.js";
import { parseInstallationProof } from "./contribution-parser.js";
import { protocolError } from "./errors.js";
import { parseCanonicalLocale, uniqueValues } from "./parser-primitives.js";
import {
  exactObject,
  expectArray,
  expectIdentifier,
  expectInteger,
  expectLiteral,
  expectString,
  expectTimestamp,
  expectUuid,
  parseDigest,
  parseProtocolVersion,
} from "./schema.js";

function discoveryEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  const parsed = expectString(value, path);
  if (!allowed.includes(parsed as T)) {
    protocolError("CP_INVALID_VALUE", path, "unsupported public discovery value");
  }
  return parsed as T;
}

export function parsePublicDiscoveryIntent(
  value: unknown,
  path = "$",
): PublicDiscoveryIntent {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "idempotencyKey",
    "installationId",
    "submittedAt",
    "installationProof",
    "target",
    "targetLocales",
  ]);
  const target = exactObject(record.target, `${path}.target`, [
    "registryKey",
    "externalObjectId",
  ]);
  return {
    kind: expectLiteral(record.kind, "public_discovery_intent", `${path}.kind`),
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    idempotencyKey: expectString(record.idempotencyKey, `${path}.idempotencyKey`, {
      min: 16,
      max: 128,
    }),
    installationId: expectUuid(record.installationId, `${path}.installationId`),
    submittedAt: expectTimestamp(record.submittedAt, `${path}.submittedAt`),
    installationProof: parseInstallationProof(
      record.installationProof,
      `${path}.installationProof`,
    ),
    target: {
      registryKey: expectIdentifier(target.registryKey, `${path}.target.registryKey`),
      externalObjectId: expectString(target.externalObjectId, `${path}.target.externalObjectId`, {
        max: 512,
      }),
    },
    targetLocales: uniqueValues(
      expectArray(
        record.targetLocales,
        `${path}.targetLocales`,
        (item, itemPath) => parseCanonicalLocale(item, itemPath),
        { minimum: 1, maximum: 32 },
      ),
      `${path}.targetLocales`,
    ),
  };
}

export function parsePublicDiscoveryReceipt(
  value: unknown,
  path = "$",
): PublicDiscoveryReceipt {
  const record = exactObject(value, path, [
    "kind", "protocol", "receiptId", "discoveryId", "taskId", "classification",
    "taskState", "outcome", "commandDigest", "credentialEpoch", "recordedAt",
  ]);
  const classification = discoveryEnum(record.classification, `${path}.classification`, [
    "pending_registry_verification", "known_current", "eligible_for_processing", "blocked",
  ] as const);
  const taskState = discoveryEnum(record.taskState, `${path}.taskState`, [
    "discovered", "verifying_registry", "materialization_pending",
    "result_verified", "queued_for_parsing", "blocked",
  ] as const);
  const outcome = discoveryEnum(record.outcome, `${path}.outcome`, [
    "created", "joined", "idempotent_replay", "negative_cached",
  ] as const);
  const taskId = record.taskId === null ? null : expectUuid(record.taskId, `${path}.taskId`);
  if ((classification === "blocked") !== (taskState === "blocked")) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      "blocked classification and task state must agree",
    );
  }
  if (outcome === "negative_cached" && classification !== "blocked") {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      "negative cache outcome must be blocked",
    );
  }
  if (classification === "blocked" && !["negative_cached", "idempotent_replay"].includes(outcome)) {
    protocolError("CP_INVALID_VALUE", path, "blocked receipt must be cached or replayed");
  }
  return {
    kind: expectLiteral(record.kind, "public_discovery_receipt", `${path}.kind`),
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    receiptId: expectUuid(record.receiptId, `${path}.receiptId`),
    discoveryId: expectUuid(record.discoveryId, `${path}.discoveryId`),
    taskId,
    classification,
    taskState,
    outcome,
    commandDigest: parseDigest(record.commandDigest, "request", `${path}.commandDigest`),
    credentialEpoch: expectInteger(record.credentialEpoch, `${path}.credentialEpoch`, { minimum: 1 }),
    recordedAt: expectTimestamp(record.recordedAt, `${path}.recordedAt`),
  };
}

export function parsePublicDiscoveryStatus(
  value: unknown,
  path = "$",
): PublicDiscoveryStatus {
  const record = exactObject(value, path, [
    "kind", "protocol", "statusRevision", "discoveryId", "receiptId", "taskId",
    "classification", "taskState", "taskGeneration", "attemptCount", "outcome",
    "commandDigest", "credentialEpoch", "receiptRecordedAt", "updatedAt",
    "retryAfterSeconds", "retryAllowed", "blockedReasonCode",
  ]);
  const classification = discoveryEnum(record.classification, `${path}.classification`, [
    "pending_registry_verification", "known_current", "eligible_for_processing", "blocked",
  ] as const);
  const taskState = discoveryEnum(record.taskState, `${path}.taskState`, [
    "discovered", "verifying_registry", "materialization_pending",
    "result_verified", "queued_for_parsing", "blocked",
  ] as const);
  const taskId = record.taskId === null ? null : expectUuid(record.taskId, `${path}.taskId`);
  const taskGeneration = record.taskGeneration === null
    ? null
    : expectInteger(record.taskGeneration, `${path}.taskGeneration`, { minimum: 1 });
  const blockedReasonCode = record.blockedReasonCode === null
    ? null
    : discoveryEnum(record.blockedReasonCode, `${path}.blockedReasonCode`, [
      "registry_entry_unknown", "registry_projection_stale", "registry_binding_changed",
      "validator_not_approved", "executor_retry_exhausted",
      "registry_projection_changed", "source_validation_rejected",
      "adapter_validation_rejected", "result_materialization_rejected",
      "legacy_blocked_reason_unavailable",
      "executor_authority_superseded",
    ] as const);
  const retryAllowed = record.retryAllowed;
  if (typeof retryAllowed !== "boolean") {
    protocolError("CP_INVALID_TYPE", `${path}.retryAllowed`, "retryAllowed must be boolean");
  }
  const attemptCount = expectInteger(record.attemptCount, `${path}.attemptCount`, {
    minimum: 0, maximum: 5,
  });
  const retryAfterSeconds = expectInteger(
    record.retryAfterSeconds,
    `${path}.retryAfterSeconds`,
    { minimum: 0, maximum: 3600 },
  );
  if ((classification === "blocked") !== (taskState === "blocked")) {
    protocolError("CP_INVALID_VALUE", path, "blocked classification and task state must agree");
  }
  if ((classification === "blocked") !== (blockedReasonCode !== null)) {
    protocolError("CP_INVALID_VALUE", path, "blocked status must carry one reason");
  }
  if ((taskId === null) !== (taskGeneration === null) || (taskId === null && attemptCount !== 0)) {
    protocolError("CP_INVALID_VALUE", path, "task identity, generation, and attempts disagree");
  }
  if (retryAllowed && (
    classification !== "blocked" || taskId !== null || retryAfterSeconds !== 0
    || !["registry_entry_unknown", "registry_projection_stale", "registry_binding_changed"]
      .includes(blockedReasonCode ?? "")
  )) {
    protocolError("CP_INVALID_VALUE", path, "retry is outside the bounded cache boundary");
  }
  return {
    kind: expectLiteral(record.kind, "public_discovery_status", `${path}.kind`),
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    statusRevision: expectLiteral(record.statusRevision, 2, `${path}.statusRevision`),
    discoveryId: expectUuid(record.discoveryId, `${path}.discoveryId`),
    receiptId: expectUuid(record.receiptId, `${path}.receiptId`), taskId,
    classification, taskState, taskGeneration, attemptCount,
    outcome: discoveryEnum(record.outcome, `${path}.outcome`, [
      "created", "joined", "negative_cached",
    ] as const),
    commandDigest: parseDigest(record.commandDigest, "request", `${path}.commandDigest`),
    credentialEpoch: expectInteger(record.credentialEpoch, `${path}.credentialEpoch`, { minimum: 1 }),
    receiptRecordedAt: expectTimestamp(record.receiptRecordedAt, `${path}.receiptRecordedAt`),
    updatedAt: expectTimestamp(record.updatedAt, `${path}.updatedAt`),
    retryAfterSeconds, retryAllowed, blockedReasonCode,
  };
}

export function parsePublicLocalizationStatusProjection(
  value: unknown,
  path: string,
): PublicLocalizationStatusProjection {
  const record = exactObject(value, path, [
    "kind", "protocol", "projectionRevision", "discoveryId", "registryKey",
    "externalObjectId", "targetLocale", "catalogIdentityDigest",
    "sourceVersionId", "stage", "updatedAt",
  ]);
  const catalogIdentityDigest = record.catalogIdentityDigest === null
    ? null
    : parseDigest(record.catalogIdentityDigest, "logical_object", `${path}.catalogIdentityDigest`);
  const sourceVersionId = record.sourceVersionId === null
    ? null
    : expectUuid(record.sourceVersionId, `${path}.sourceVersionId`);
  const stage = discoveryEnum(record.stage, `${path}.stage`, [
    "discovery", "validating", "parsing", "translating", "publishing",
    "published", "blocked",
  ] as const);
  if ((catalogIdentityDigest === null) !== (sourceVersionId === null)) {
    protocolError("CP_INVALID_VALUE", path, "catalog and source authority must appear together");
  }
  if (["translating", "publishing", "published"].includes(stage) && sourceVersionId === null) {
    protocolError("CP_INVALID_VALUE", path, "localization stage requires source authority");
  }
  return {
    kind: expectLiteral(
      record.kind,
      "public_localization_status_projection",
      `${path}.kind`,
    ),
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    projectionRevision: expectLiteral(
      record.projectionRevision,
      1,
      `${path}.projectionRevision`,
    ),
    discoveryId: expectUuid(record.discoveryId, `${path}.discoveryId`),
    registryKey: expectIdentifier(record.registryKey, `${path}.registryKey`),
    externalObjectId: expectString(record.externalObjectId, `${path}.externalObjectId`, {
      min: 1,
      max: 512,
    }),
    targetLocale: parseCanonicalLocale(record.targetLocale, `${path}.targetLocale`),
    catalogIdentityDigest,
    sourceVersionId,
    stage,
    updatedAt: expectTimestamp(record.updatedAt, `${path}.updatedAt`),
  };
}

export function parsePublicLocalizationStatusBatch(
  value: unknown,
  path = "$",
): PublicLocalizationStatusBatch {
  const record = exactObject(value, path, ["kind", "protocol", "items"]);
  const items = expectArray(
    record.items,
    `${path}.items`,
    (item, itemPath) => {
      const itemRecord = exactObject(item, itemPath, [
        "discoveryId", "targetLocale", "found", "projection",
      ]);
      const discoveryId = expectUuid(itemRecord.discoveryId, `${itemPath}.discoveryId`);
      const targetLocale = parseCanonicalLocale(itemRecord.targetLocale, `${itemPath}.targetLocale`);
      if (typeof itemRecord.found !== "boolean") {
        protocolError("CP_INVALID_TYPE", `${itemPath}.found`, "expected a boolean");
      }
      const projection = itemRecord.projection === null
        ? null
        : parsePublicLocalizationStatusProjection(itemRecord.projection, `${itemPath}.projection`);
      if (itemRecord.found !== (projection !== null)) {
        protocolError("CP_INVALID_VALUE", itemPath, "found must match projection presence");
      }
      if (projection !== null && (
        projection.discoveryId !== discoveryId
        || projection.targetLocale !== targetLocale
      )) {
        protocolError("CP_INVALID_VALUE", itemPath, "projection scope does not match query");
      }
      return { discoveryId, targetLocale, found: itemRecord.found, projection };
    },
    { minimum: 1, maximum: 100 },
  );
  return {
    kind: expectLiteral(
      record.kind,
      "public_localization_status_batch",
      `${path}.kind`,
    ),
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    items,
  };
}

export function parseRegistryVerificationProjection(
  value: unknown,
  path = "$",
): RegistryVerificationProjection {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "registryKey",
    "registryRevision",
    "generation",
    "externalObjectId",
    "officialBindingDigest",
    "validatorAttestationDigest",
  ]);
  return {
    kind: expectLiteral(
      record.kind,
      "registry_verification_projection",
      `${path}.kind`,
    ),
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    registryKey: expectIdentifier(record.registryKey, `${path}.registryKey`),
    registryRevision: expectIdentifier(record.registryRevision, `${path}.registryRevision`),
    generation: expectInteger(record.generation, `${path}.generation`, { minimum: 1 }),
    externalObjectId: expectString(record.externalObjectId, `${path}.externalObjectId`, {
      max: 512,
    }),
    officialBindingDigest: parseDigest(
      record.officialBindingDigest,
      "registry_definition",
      `${path}.officialBindingDigest`,
    ),
    validatorAttestationDigest: parseDigest(
      record.validatorAttestationDigest,
      "attestation_payload",
      `${path}.validatorAttestationDigest`,
    ),
  };
}
