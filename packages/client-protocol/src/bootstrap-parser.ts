import type {
  BootstrapLinkBinding,
  BootstrapRequest,
  BootstrapResponse,
  PublicCredentialRenewalResponse,
} from "./contracts.js";
import { protocolError } from "./errors.js";
import {
  PUBLIC_CAPABILITIES,
  parseCapability,
  parseClientType,
  uniqueValues,
} from "./parser-primitives.js";
import {
  exactObject,
  expectArray,
  expectEnum,
  expectIdentifier,
  expectInteger,
  expectLiteral,
  expectNonce,
  expectString,
  expectTimestamp,
  expectUuid,
  parseProtocolVersion,
} from "./schema.js";

export function parseIntakeCredential(value: unknown, path: string) {
  const record = exactObject(value, path, [
    "audience",
    "plane",
    "sessionId",
    "installationId",
    "credentialEpoch",
    "capabilities",
    "issuedAt",
    "expiresAt",
    "value",
  ]);
  const capabilities = uniqueValues(
    expectArray(record.capabilities, `${path}.capabilities`, parseCapability, {
      maximum: PUBLIC_CAPABILITIES.length,
    }),
    `${path}.capabilities`
  );
  const issuedAt = expectTimestamp(record.issuedAt, `${path}.issuedAt`);
  const expiresAt = expectTimestamp(record.expiresAt, `${path}.expiresAt`);
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    protocolError(
      "CP_INVALID_TIMESTAMP",
      `${path}.expiresAt`,
      "credential must expire after issue"
    );
  }
  const token = expectString(record.value, `${path}.value`, { min: 32, max: 2048 });
  if (!/^[A-Za-z0-9._~-]+$/u.test(token)) {
    protocolError("CP_INVALID_VALUE", `${path}.value`, "credential encoding is invalid");
  }
  return {
    audience: expectLiteral(record.audience, "public-contribution-intake", `${path}.audience`),
    plane: expectLiteral(record.plane, "public", `${path}.plane`),
    sessionId: expectUuid(record.sessionId, `${path}.sessionId`),
    installationId: expectUuid(record.installationId, `${path}.installationId`),
    credentialEpoch: expectInteger(record.credentialEpoch, `${path}.credentialEpoch`, {
      minimum: 1,
    }),
    capabilities,
    issuedAt,
    expiresAt,
    value: token,
  } as const;
}

export function parseInstallationPublicKey(value: unknown, path: string) {
  const record = exactObject(value, path, ["algorithm", "keyId", "publicKey"]);
  return {
    algorithm: expectLiteral(record.algorithm, "ed25519", `${path}.algorithm`),
    keyId: expectIdentifier(record.keyId, `${path}.keyId`),
    publicKey: expectString(record.publicKey, `${path}.publicKey`, {
      min: 43,
      max: 43,
    }),
  } as const;
}

export function parseBootstrapRequest(value: unknown, path = "$"): BootstrapRequest {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "linkingCode",
    "clientNonce",
    "installationPublicKey",
    "client",
    "requestedCapabilities",
  ]);
  expectLiteral(record.kind, "bootstrap_request", `${path}.kind`);
  const binding = parseBootstrapBindingRecord(record, path);
  return {
    kind: "bootstrap_request",
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    linkingCode: expectString(record.linkingCode, `${path}.linkingCode`, {
      min: 32,
      max: 512,
    }),
    ...binding,
  };
}

function parseBootstrapBindingRecord(
  record: Record<string, unknown>,
  path: string
): BootstrapLinkBinding {
  const client = exactObject(record.client, `${path}.client`, ["type", "version", "platform"]);
  const requestedCapabilities = uniqueValues(
    expectArray(record.requestedCapabilities, `${path}.requestedCapabilities`, parseCapability, {
      maximum: PUBLIC_CAPABILITIES.length,
    }),
    `${path}.requestedCapabilities`
  );
  return {
    clientNonce: expectNonce(record.clientNonce, `${path}.clientNonce`),
    installationPublicKey: parseInstallationPublicKey(
      record.installationPublicKey,
      `${path}.installationPublicKey`
    ),
    client: {
      type: parseClientType(client.type, `${path}.client.type`),
      version: expectString(client.version, `${path}.client.version`, {
        max: 64,
      }),
      platform: expectIdentifier(client.platform, `${path}.client.platform`),
    },
    requestedCapabilities,
  };
}

export function parseBootstrapLinkBinding(value: unknown, path = "$"): BootstrapLinkBinding {
  const record = exactObject(value, path, [
    "clientNonce",
    "installationPublicKey",
    "client",
    "requestedCapabilities",
  ]);
  return parseBootstrapBindingRecord(record, path);
}

export function parseBootstrapResponse(value: unknown, path = "$"): BootstrapResponse {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "installationId",
    "installationState",
    "trust",
    "clientNonce",
    "installationKeyId",
    "serverChallenge",
    "challengeExpiresAt",
    "availableCapabilities",
    "intakeCredential",
  ]);
  expectLiteral(record.kind, "bootstrap_response", `${path}.kind`);
  const installationId = expectUuid(record.installationId, `${path}.installationId`);
  const availableCapabilities = uniqueValues(
    expectArray(record.availableCapabilities, `${path}.availableCapabilities`, parseCapability, {
      maximum: PUBLIC_CAPABILITIES.length,
    }),
    `${path}.availableCapabilities`
  );
  const intakeCredential = parseIntakeCredential(
    record.intakeCredential,
    `${path}.intakeCredential`
  );
  if (intakeCredential.installationId !== installationId) {
    protocolError(
      "CP_INVALID_VALUE",
      `${path}.intakeCredential.installationId`,
      "credential installation does not match bootstrap response"
    );
  }
  if (intakeCredential.capabilities.some((item) => !availableCapabilities.includes(item))) {
    protocolError(
      "CP_INVALID_VALUE",
      `${path}.intakeCredential.capabilities`,
      "credential capabilities exceed the bootstrap capability set"
    );
  }
  return {
    kind: "bootstrap_response",
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    installationId,
    installationState: expectEnum(
      record.installationState,
      ["pending", "active", "rotation_required", "logged_out", "lost", "revoked", "unlinked"],
      `${path}.installationState`
    ),
    trust: expectLiteral(record.trust, "untrusted_client", `${path}.trust`),
    clientNonce: expectNonce(record.clientNonce, `${path}.clientNonce`),
    installationKeyId: expectIdentifier(record.installationKeyId, `${path}.installationKeyId`),
    serverChallenge: expectNonce(record.serverChallenge, `${path}.serverChallenge`),
    challengeExpiresAt: expectTimestamp(record.challengeExpiresAt, `${path}.challengeExpiresAt`),
    availableCapabilities,
    intakeCredential,
  };
}

export function parsePublicCredentialRenewalResponse(
  value: unknown,
  path = "$",
): PublicCredentialRenewalResponse {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "installationId",
    "installationKeyId",
    "serverChallenge",
    "challengeExpiresAt",
    "intakeCredential",
  ]);
  const installationId = expectUuid(record.installationId, `${path}.installationId`);
  const intakeCredential = parseIntakeCredential(
    record.intakeCredential,
    `${path}.intakeCredential`,
  );
  if (intakeCredential.installationId !== installationId) {
    protocolError(
      "CP_INVALID_VALUE",
      `${path}.intakeCredential.installationId`,
      "credential installation does not match renewal response",
    );
  }
  return {
    kind: expectLiteral(
      record.kind,
      "public_credential_renewal_response",
      `${path}.kind`,
    ),
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    installationId,
    installationKeyId: expectIdentifier(
      record.installationKeyId,
      `${path}.installationKeyId`,
    ),
    serverChallenge: expectNonce(record.serverChallenge, `${path}.serverChallenge`),
    challengeExpiresAt: expectTimestamp(
      record.challengeExpiresAt,
      `${path}.challengeExpiresAt`,
    ),
    intakeCredential,
  };
}
