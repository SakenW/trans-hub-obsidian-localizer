import type {
  LocalizationDemandCoordinateStatus,
  LocalizationDemandState,
  LocalizationDemandStatus,
} from "./contracts.js";
import { protocolError } from "./errors.js";
import { parseNullable } from "./parser-primitives.js";
import {
  exactObject,
  expectArray,
  expectEnum,
  expectInteger,
  expectLiteral,
  expectString,
  expectTimestamp,
  expectUuid,
  parseProtocolVersion,
} from "./schema.js";

const LOCALIZATION_DEMAND_STATES = [
  "awaiting_source",
  "rejected",
  "reconciled",
  "mt_queued",
  "mt_running",
  "mt_failed",
  "export_pending",
  "export_ready",
  "native_complete",
] as const satisfies readonly LocalizationDemandState[];

function parseCoordinate(
  value: unknown,
  path: string,
): LocalizationDemandCoordinateStatus {
  const record = exactObject(value, path, [
    "state",
    "sourceVersionId",
    "targetLocale",
    "targetVariant",
    "totalUnitCount",
    "workItemCount",
    "nativeUnitCount",
    "queuedCount",
    "runningCount",
    "succeededCount",
    "failedCount",
    "reviewedUnitCount",
    "publishedUnitCount",
    "manifestId",
    "generationNumber",
    "updatedAt",
    "retryAfterSeconds",
    "failureCode",
    "failureRetryable",
    "failureAttemptNumber",
  ]);
  const state = expectEnum(
    record.state,
    LOCALIZATION_DEMAND_STATES,
    `${path}.state`,
  );
  const sourceVersionId = parseNullable(record.sourceVersionId, (item) =>
    expectUuid(item, `${path}.sourceVersionId`),
  );
  const targetLocale = parseNullable(record.targetLocale, (item) =>
    expectString(item, `${path}.targetLocale`, { max: 64 }),
  );
  const targetVariant = parseNullable(record.targetVariant, (item) =>
    expectString(item, `${path}.targetVariant`, { max: 80 }),
  );
  const totalUnitCount = expectInteger(
    record.totalUnitCount,
    `${path}.totalUnitCount`,
  );
  const workItemCount = expectInteger(
    record.workItemCount,
    `${path}.workItemCount`,
  );
  const nativeUnitCount = expectInteger(
    record.nativeUnitCount,
    `${path}.nativeUnitCount`,
  );
  const queuedCount = expectInteger(record.queuedCount, `${path}.queuedCount`);
  const runningCount = expectInteger(
    record.runningCount,
    `${path}.runningCount`,
  );
  const succeededCount = expectInteger(
    record.succeededCount,
    `${path}.succeededCount`,
  );
  const failedCount = expectInteger(record.failedCount, `${path}.failedCount`);
  const reviewedUnitCount = expectInteger(
    record.reviewedUnitCount,
    `${path}.reviewedUnitCount`,
  );
  const publishedUnitCount = expectInteger(
    record.publishedUnitCount,
    `${path}.publishedUnitCount`,
  );
  const manifestId = parseNullable(record.manifestId, (item) =>
    expectUuid(item, `${path}.manifestId`),
  );
  const generationNumber = parseNullable(record.generationNumber, (item) =>
    expectInteger(item, `${path}.generationNumber`, { minimum: 1 }),
  );
  const retryAfterSeconds = expectInteger(
    record.retryAfterSeconds,
    `${path}.retryAfterSeconds`,
    { maximum: 3600 },
  );
  const failureCode = parseNullable(record.failureCode, (item) =>
    expectString(item, `${path}.failureCode`, { max: 160 }),
  );
  if (typeof record.failureRetryable !== "boolean") {
    protocolError(
      "CP_INVALID_TYPE",
      `${path}.failureRetryable`,
      "expected a boolean",
    );
  }
  const failureRetryable = record.failureRetryable as boolean;
  const failureAttemptNumber = parseNullable(
    record.failureAttemptNumber,
    (item) =>
      expectInteger(item, `${path}.failureAttemptNumber`, {
        minimum: 1,
        maximum: 5,
      }),
  );

  if (workItemCount > totalUnitCount || nativeUnitCount > totalUnitCount) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      "localization unit counts exceed source scope",
    );
  }
  for (const [name, count] of [
    ["queuedCount", queuedCount],
    ["runningCount", runningCount],
    ["succeededCount", succeededCount],
    ["failedCount", failedCount],
    ["reviewedUnitCount", reviewedUnitCount],
    ["publishedUnitCount", publishedUnitCount],
  ] as const) {
    if (count > workItemCount) {
      protocolError(
        "CP_INVALID_VALUE",
        `${path}.${name}`,
        "count exceeds work item scope",
      );
    }
  }
  const unresolved = state === "awaiting_source" || state === "rejected";
  if (
    unresolved !==
    (sourceVersionId === null &&
      targetLocale === null &&
      targetVariant === null)
  ) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      "demand coordinate scope is inconsistent",
    );
  }
  if ((manifestId === null) !== (generationNumber === null)) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      "manifest generation identity is incomplete",
    );
  }
  if (state === "export_ready" && manifestId === null) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      "ready export requires a manifest identity",
    );
  }
  if (state === "native_complete" && workItemCount !== 0) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      "native completion cannot retain work items",
    );
  }
  if (state === "mt_failed" && failedCount === 0) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      "failed state requires a failed work item",
    );
  }
  if (
    failureRetryable &&
    (state !== "mt_failed" || failureAttemptNumber === null)
  ) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      "retryable failure requires an attempted failure",
    );
  }

  return {
    state,
    sourceVersionId,
    targetLocale,
    targetVariant,
    totalUnitCount,
    workItemCount,
    nativeUnitCount,
    queuedCount,
    runningCount,
    succeededCount,
    failedCount,
    reviewedUnitCount,
    publishedUnitCount,
    manifestId,
    generationNumber,
    updatedAt: expectTimestamp(record.updatedAt, `${path}.updatedAt`),
    retryAfterSeconds,
    failureCode,
    failureRetryable,
    failureAttemptNumber,
  };
}

export function parseLocalizationDemandStatus(
  value: unknown,
  path = "$",
): LocalizationDemandStatus {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "contributionId",
    "state",
    "coordinates",
    "retryAfterSeconds",
    "updatedAt",
  ]);
  expectLiteral(record.kind, "localization_demand_status", `${path}.kind`);
  const coordinates = expectArray(
    record.coordinates,
    `${path}.coordinates`,
    parseCoordinate,
    {
      minimum: 1,
      maximum: 128,
    },
  );
  const state = expectEnum(
    record.state,
    LOCALIZATION_DEMAND_STATES,
    `${path}.state`,
  );
  if (!coordinates.some((coordinate) => coordinate.state === state)) {
    protocolError(
      "CP_INVALID_VALUE",
      `${path}.state`,
      "summary state is absent from coordinates",
    );
  }
  return {
    kind: "localization_demand_status",
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    contributionId: expectUuid(record.contributionId, `${path}.contributionId`),
    state,
    coordinates,
    retryAfterSeconds: expectInteger(
      record.retryAfterSeconds,
      `${path}.retryAfterSeconds`,
      {
        maximum: 3600,
      },
    ),
    updatedAt: expectTimestamp(record.updatedAt, `${path}.updatedAt`),
  };
}
