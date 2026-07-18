import { parseInstallationPublicKey, parseIntakeCredential } from "./bootstrap-parser.js";
import type {
  InstallationLifecycleKeyProof,
  InstallationLifecycleReceipt,
  InstallationLifecycleRecoveryRequest,
  InstallationLifecycleRotationRequest,
  InstallationLifecycleTerminalRequest,
  PublicInstallationLifecycleCommand,
  PublicInstallationRecoveryCommand,
  PublicLifecycleTrustCapability,
} from "./contracts.js";
import { protocolError } from "./errors.js";
import {
  exactObject,
  expectEnum,
  expectIdentifier,
  expectInteger,
  expectLiteral,
  expectNonce,
  expectSignature,
  expectString,
  expectTimestamp,
  expectUuid,
  parseDigest,
  parseProtocolVersion,
} from "./schema.js";
import { parseServerProof } from "./transfer-parser.js";

function expectLowerHex(value: unknown, length: number, path: string): string {
  const parsed = expectString(value, path, { min: length, max: length });
  if (!new RegExp(`^[0-9a-f]{${length}}$`, "u").test(parsed)) {
    protocolError("CP_INVALID_VALUE", path, "value must be canonical lowercase hexadecimal");
  }
  return parsed;
}

function expectRecoveryGrant(value: unknown, path: string): string {
  const parsed = expectString(value, path, { min: 43, max: 43 });
  if (!/^[A-Za-z0-9_-]{43}$/u.test(parsed)) {
    protocolError("CP_INVALID_VALUE", path, "recovery grant must be 32-byte base64url");
  }
  return parsed;
}

function parseLifecycleProof(
  value: unknown,
  role: "current" | "replacement",
  path: string
): InstallationLifecycleKeyProof {
  const record = exactObject(value, path, [
    "domain",
    "role",
    "algorithm",
    "keyId",
    "requestDigest",
    "nonce",
    "signedAt",
    "credentialEpoch",
    "signature",
  ]);
  return {
    domain: expectLiteral(record.domain, "public_installation_lifecycle", `${path}.domain`),
    role: expectLiteral(record.role, role, `${path}.role`),
    algorithm: expectLiteral(record.algorithm, "ed25519", `${path}.algorithm`),
    keyId: expectIdentifier(record.keyId, `${path}.keyId`),
    requestDigest: parseDigest(record.requestDigest, "request", `${path}.requestDigest`),
    nonce: expectNonce(record.nonce, `${path}.nonce`),
    signedAt: expectTimestamp(record.signedAt, `${path}.signedAt`),
    credentialEpoch: expectInteger(record.credentialEpoch, `${path}.credentialEpoch`, {
      minimum: 1,
    }),
    signature: expectSignature(record.signature, `${path}.signature`),
  };
}

export function parseInstallationLifecycleRotationRequest(
  value: unknown,
  path = "$"
): InstallationLifecycleRotationRequest {
  const record = exactObject(value, path, [
    "action",
    "idempotencyKey",
    "evidenceDigest",
    "currentInstallationPublicKey",
    "expectedCredentialEpoch",
    "newInstallationPublicKey",
    "newIntakeCredential",
    "currentInstallationProof",
    "replacementInstallationProof",
  ]);
  const currentKey = parseInstallationPublicKey(
    record.currentInstallationPublicKey,
    `${path}.currentInstallationPublicKey`
  );
  const replacementKey = parseInstallationPublicKey(
    record.newInstallationPublicKey,
    `${path}.newInstallationPublicKey`
  );
  if (
    currentKey.keyId === replacementKey.keyId ||
    currentKey.publicKey === replacementKey.publicKey
  ) {
    protocolError(
      "CP_INVALID_VALUE",
      `${path}.newInstallationPublicKey`,
      "rotation must replace both key id and public key"
    );
  }
  const credentialEpoch = expectInteger(
    record.expectedCredentialEpoch,
    `${path}.expectedCredentialEpoch`,
    { minimum: 1 }
  );
  const currentProof = parseLifecycleProof(
    record.currentInstallationProof,
    "current",
    `${path}.currentInstallationProof`
  );
  const replacementProof = parseLifecycleProof(
    record.replacementInstallationProof,
    "replacement",
    `${path}.replacementInstallationProof`
  );
  if (
    currentProof.keyId !== currentKey.keyId ||
    replacementProof.keyId !== replacementKey.keyId ||
    currentProof.credentialEpoch !== credentialEpoch ||
    replacementProof.credentialEpoch !== credentialEpoch + 1 ||
    currentProof.requestDigest.hex !== replacementProof.requestDigest.hex
  ) {
    protocolError(
      "CP_INVALID_VALUE",
      `${path}.currentInstallationProof`,
      "dual lifecycle proofs must bind exact current/replacement keys and adjacent epochs"
    );
  }
  const credential = exactObject(record.newIntakeCredential, `${path}.newIntakeCredential`, [
    "tokenPrefix",
    "secret",
  ]);
  return {
    action: expectLiteral(record.action, "rotate", `${path}.action`),
    idempotencyKey: expectString(record.idempotencyKey, `${path}.idempotencyKey`, {
      min: 16,
      max: 128,
    }),
    evidenceDigest: expectLowerHex(record.evidenceDigest, 64, `${path}.evidenceDigest`),
    currentInstallationPublicKey: currentKey,
    expectedCredentialEpoch: credentialEpoch,
    newInstallationPublicKey: replacementKey,
    newIntakeCredential: {
      tokenPrefix: expectLowerHex(
        credential.tokenPrefix,
        24,
        `${path}.newIntakeCredential.tokenPrefix`
      ),
      secret: expectLowerHex(credential.secret, 64, `${path}.newIntakeCredential.secret`),
    },
    currentInstallationProof: { ...currentProof, role: "current" },
    replacementInstallationProof: { ...replacementProof, role: "replacement" },
  };
}

export function parseInstallationLifecycleRecoveryRequest(
  value: unknown,
  path = "$"
): InstallationLifecycleRecoveryRequest {
  const record = exactObject(value, path, [
    "action",
    "idempotencyKey",
    "evidenceDigest",
    "expectedCredentialEpoch",
    "newInstallationPublicKey",
    "newIntakeCredential",
    "recoveryGrant",
    "replacementInstallationProof",
  ]);
  const replacementKey = parseInstallationPublicKey(
    record.newInstallationPublicKey,
    `${path}.newInstallationPublicKey`
  );
  const credentialEpoch = expectInteger(
    record.expectedCredentialEpoch,
    `${path}.expectedCredentialEpoch`,
    { minimum: 1 }
  );
  const replacementProof = parseLifecycleProof(
    record.replacementInstallationProof,
    "replacement",
    `${path}.replacementInstallationProof`
  );
  if (
    replacementProof.keyId !== replacementKey.keyId ||
    replacementProof.credentialEpoch !== credentialEpoch + 1
  ) {
    protocolError(
      "CP_INVALID_VALUE",
      `${path}.replacementInstallationProof`,
      "recovery proof must bind the replacement key and next credential epoch"
    );
  }
  const credential = exactObject(record.newIntakeCredential, `${path}.newIntakeCredential`, [
    "tokenPrefix",
    "secret",
  ]);
  return {
    action: expectLiteral(record.action, "reinstall", `${path}.action`),
    idempotencyKey: expectString(record.idempotencyKey, `${path}.idempotencyKey`, {
      min: 16,
      max: 128,
    }),
    evidenceDigest: expectLowerHex(record.evidenceDigest, 64, `${path}.evidenceDigest`),
    expectedCredentialEpoch: credentialEpoch,
    newInstallationPublicKey: replacementKey,
    newIntakeCredential: {
      tokenPrefix: expectLowerHex(
        credential.tokenPrefix,
        24,
        `${path}.newIntakeCredential.tokenPrefix`
      ),
      secret: expectLowerHex(credential.secret, 64, `${path}.newIntakeCredential.secret`),
    },
    recoveryGrant: expectRecoveryGrant(record.recoveryGrant, `${path}.recoveryGrant`),
    replacementInstallationProof: { ...replacementProof, role: "replacement" },
  };
}

export function parseInstallationLifecycleTerminalRequest(
  value: unknown,
  path = "$"
): InstallationLifecycleTerminalRequest {
  const record = exactObject(value, path, ["action", "idempotencyKey", "evidenceDigest"]);
  return {
    action: expectEnum(
      record.action,
      ["logout", "lost_device", "unlink", "revoke"],
      `${path}.action`
    ),
    idempotencyKey: expectString(record.idempotencyKey, `${path}.idempotencyKey`, {
      min: 16,
      max: 128,
    }),
    evidenceDigest: expectLowerHex(record.evidenceDigest, 64, `${path}.evidenceDigest`),
  };
}

export function parsePublicInstallationLifecycleCommand(
  value: unknown,
  path = "$"
): PublicInstallationLifecycleCommand {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "action",
    "commandId",
    "installationId",
    "authorityWorkspaceId",
    "principalId",
    "currentInstallationPublicKey",
    "currentKeyEpoch",
    "expectedCredentialEpoch",
    "nextKeyEpoch",
    "issuedAt",
    "expiresAt",
    "nonce",
    "serverProof",
  ]);
  const currentKeyEpoch = expectInteger(record.currentKeyEpoch, `${path}.currentKeyEpoch`, {
    minimum: 1,
  });
  const nextKeyEpoch = expectInteger(record.nextKeyEpoch, `${path}.nextKeyEpoch`, {
    minimum: 2,
  });
  if (nextKeyEpoch !== currentKeyEpoch + 1) {
    protocolError(
      "CP_INVALID_VALUE",
      `${path}.nextKeyEpoch`,
      "lifecycle command must advance the Core key epoch exactly once"
    );
  }
  const issuedAt = expectTimestamp(record.issuedAt, `${path}.issuedAt`);
  const expiresAt = expectTimestamp(record.expiresAt, `${path}.expiresAt`);
  const lifetimeMs = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (lifetimeMs <= 0 || lifetimeMs > 10 * 60 * 1000) {
    protocolError(
      "CP_INVALID_TIMESTAMP",
      `${path}.expiresAt`,
      "lifecycle command lifetime must be positive and at most ten minutes"
    );
  }
  const serverProof = parseServerProof(
    record.serverProof,
    "public_installation_lifecycle_command",
    `${path}.serverProof`
  );
  if (serverProof.signedAt !== issuedAt || serverProof.expiresAt !== expiresAt) {
    protocolError(
      "CP_INVALID_TIMESTAMP",
      `${path}.serverProof`,
      "lifecycle command and proof timestamps must match exactly"
    );
  }
  return {
    kind: expectLiteral(record.kind, "public_installation_lifecycle_command", `${path}.kind`),
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    action: expectLiteral(record.action, "rotate", `${path}.action`),
    commandId: expectUuid(record.commandId, `${path}.commandId`),
    installationId: expectUuid(record.installationId, `${path}.installationId`),
    authorityWorkspaceId: expectUuid(record.authorityWorkspaceId, `${path}.authorityWorkspaceId`),
    principalId: expectUuid(record.principalId, `${path}.principalId`),
    currentInstallationPublicKey: parseInstallationPublicKey(
      record.currentInstallationPublicKey,
      `${path}.currentInstallationPublicKey`
    ),
    currentKeyEpoch,
    expectedCredentialEpoch: expectInteger(
      record.expectedCredentialEpoch,
      `${path}.expectedCredentialEpoch`,
      { minimum: 1 }
    ),
    nextKeyEpoch,
    issuedAt,
    expiresAt,
    nonce: expectNonce(record.nonce, `${path}.nonce`),
    serverProof,
  };
}

export function parsePublicInstallationRecoveryCommand(
  value: unknown,
  path = "$"
): PublicInstallationRecoveryCommand {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "action",
    "commandId",
    "installationId",
    "authorityWorkspaceId",
    "principalId",
    "expectedCredentialEpoch",
    "nextCredentialEpoch",
    "nextKeyEpoch",
    "issuedAt",
    "expiresAt",
    "nonce",
    "recoveryGrant",
    "serverProof",
  ]);
  const expectedCredentialEpoch = expectInteger(
    record.expectedCredentialEpoch,
    `${path}.expectedCredentialEpoch`,
    { minimum: 1 }
  );
  const nextCredentialEpoch = expectInteger(
    record.nextCredentialEpoch,
    `${path}.nextCredentialEpoch`,
    { minimum: 2 }
  );
  if (nextCredentialEpoch !== expectedCredentialEpoch + 1) {
    protocolError(
      "CP_INVALID_VALUE",
      `${path}.nextCredentialEpoch`,
      "recovery command must advance credential epoch exactly once"
    );
  }
  const issuedAt = expectTimestamp(record.issuedAt, `${path}.issuedAt`);
  const expiresAt = expectTimestamp(record.expiresAt, `${path}.expiresAt`);
  const lifetimeMs = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (lifetimeMs <= 0 || lifetimeMs > 10 * 60 * 1000) {
    protocolError(
      "CP_INVALID_TIMESTAMP",
      `${path}.expiresAt`,
      "recovery command lifetime must be positive and at most ten minutes"
    );
  }
  const serverProof = parseServerProof(
    record.serverProof,
    "public_installation_recovery_command",
    `${path}.serverProof`
  );
  if (serverProof.signedAt !== issuedAt || serverProof.expiresAt !== expiresAt) {
    protocolError(
      "CP_INVALID_TIMESTAMP",
      `${path}.serverProof`,
      "recovery command and proof timestamps must match exactly"
    );
  }
  return {
    kind: expectLiteral(record.kind, "public_installation_recovery_command", `${path}.kind`),
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    action: expectLiteral(record.action, "reinstall", `${path}.action`),
    commandId: expectUuid(record.commandId, `${path}.commandId`),
    installationId: expectUuid(record.installationId, `${path}.installationId`),
    authorityWorkspaceId: expectUuid(record.authorityWorkspaceId, `${path}.authorityWorkspaceId`),
    principalId: expectUuid(record.principalId, `${path}.principalId`),
    expectedCredentialEpoch,
    nextCredentialEpoch,
    nextKeyEpoch: expectInteger(record.nextKeyEpoch, `${path}.nextKeyEpoch`, { minimum: 2 }),
    issuedAt,
    expiresAt,
    nonce: expectNonce(record.nonce, `${path}.nonce`),
    recoveryGrant: expectRecoveryGrant(record.recoveryGrant, `${path}.recoveryGrant`),
    serverProof,
  };
}

export function parsePublicLifecycleTrustCapability(
  value: unknown,
  path = "$"
): PublicLifecycleTrustCapability {
  const record = exactObject(value, path, [
    "domain",
    "installationId",
    "authorityWorkspaceId",
    "principalId",
    "installationKeyId",
    "trustBundleRevision",
    "acceptedRoots",
    "nonce",
    "signedAt",
    "signature",
  ]);
  if (
    !Array.isArray(record.acceptedRoots) ||
    record.acceptedRoots.length < 1 ||
    record.acceptedRoots.length > 2
  ) {
    protocolError("CP_INVALID_VALUE", `${path}.acceptedRoots`, "one or two trust roots required");
  }
  const acceptedRoots = record.acceptedRoots.map((value, index) => {
    const root = exactObject(value, `${path}.acceptedRoots[${index}]`, [
      "keyId",
      "keyVersion",
      "publicKeyDigest",
    ]);
    return {
      keyId: expectIdentifier(root.keyId, `${path}.acceptedRoots[${index}].keyId`),
      keyVersion: expectInteger(root.keyVersion, `${path}.acceptedRoots[${index}].keyVersion`, {
        minimum: 1,
      }),
      publicKeyDigest: parseDigest(
        root.publicKeyDigest,
        "lifecycle_root_public_key",
        `${path}.acceptedRoots[${index}].publicKeyDigest`
      ),
    };
  });
  const identities = new Set(acceptedRoots.map((root) => `${root.keyId}:${root.keyVersion}`));
  if (identities.size !== acceptedRoots.length) {
    protocolError("CP_INVALID_VALUE", `${path}.acceptedRoots`, "trust roots must be distinct");
  }
  return {
    domain: expectLiteral(record.domain, "public_lifecycle_trust_capability", `${path}.domain`),
    installationId: expectUuid(record.installationId, `${path}.installationId`),
    authorityWorkspaceId: expectUuid(record.authorityWorkspaceId, `${path}.authorityWorkspaceId`),
    principalId: expectUuid(record.principalId, `${path}.principalId`),
    installationKeyId: expectIdentifier(record.installationKeyId, `${path}.installationKeyId`),
    trustBundleRevision: expectInteger(record.trustBundleRevision, `${path}.trustBundleRevision`, {
      minimum: 1,
    }),
    acceptedRoots,
    nonce: expectNonce(record.nonce, `${path}.nonce`),
    signedAt: expectTimestamp(record.signedAt, `${path}.signedAt`),
    signature: expectSignature(record.signature, `${path}.signature`),
  };
}

export function parseInstallationLifecycleReceipt(
  value: unknown,
  path = "$"
): InstallationLifecycleReceipt {
  const record = exactObject(value, path, [
    "receiptId",
    "action",
    "requestId",
    "requestDigest",
    "installationId",
    "state",
    "credentialEpoch",
    "keyVersion",
    "outcome",
    "recordedAt",
    "serverChallenge",
    "challengeExpiresAt",
    "intakeCredential",
    "serverProof",
  ]);
  const action = expectEnum(
    record.action,
    ["rotate", "reinstall", "logout", "lost_device", "unlink", "revoke"],
    `${path}.action`
  );
  const installationId = expectUuid(record.installationId, `${path}.installationId`);
  const credentialEpoch = expectInteger(record.credentialEpoch, `${path}.credentialEpoch`, {
    minimum: 2,
  });
  const recordedAt = expectTimestamp(record.recordedAt, `${path}.recordedAt`);
  const requestId = expectString(record.requestId, `${path}.requestId`, {
    min: 16,
    max: 128,
  });
  const requestDigest = parseDigest(record.requestDigest, "request", `${path}.requestDigest`);
  const serverProof = parseServerProof(
    record.serverProof,
    "public_installation_lifecycle_receipt",
    `${path}.serverProof`
  );
  if (serverProof.signedAt !== recordedAt || serverProof.expiresAt !== null) {
    protocolError(
      "CP_INVALID_VALUE",
      `${path}.serverProof`,
      "lifecycle receipt proof must bind the recorded timestamp permanently"
    );
  }
  const common = {
    receiptId: expectUuid(record.receiptId, `${path}.receiptId`),
    requestId,
    requestDigest,
    installationId,
    credentialEpoch,
    keyVersion: expectInteger(record.keyVersion, `${path}.keyVersion`, { minimum: 1 }),
    outcome: expectEnum(record.outcome, ["advanced", "idempotent_replay"], `${path}.outcome`),
    recordedAt,
    serverProof,
  };
  if (action === "rotate" || action === "reinstall") {
    if (common.keyVersion < 2) {
      protocolError(
        "CP_INVALID_VALUE",
        `${path}.keyVersion`,
        "replacement lifecycle receipt requires a rotated key version"
      );
    }
    const challengeExpiresAt = expectTimestamp(
      record.challengeExpiresAt,
      `${path}.challengeExpiresAt`
    );
    const intakeCredential = parseIntakeCredential(
      record.intakeCredential,
      `${path}.intakeCredential`
    );
    if (
      intakeCredential.installationId !== installationId ||
      intakeCredential.credentialEpoch !== credentialEpoch ||
      Date.parse(challengeExpiresAt) <= Date.parse(recordedAt)
    ) {
      protocolError(
        "CP_INVALID_VALUE",
        `${path}.intakeCredential`,
        "lifecycle receipt credential must bind the exact installation and epoch"
      );
    }
    return {
      ...common,
      action,
      state: expectLiteral(record.state, "active", `${path}.state`),
      serverChallenge: expectNonce(record.serverChallenge, `${path}.serverChallenge`),
      challengeExpiresAt,
      intakeCredential,
    };
  }
  const expectedState = {
    logout: "logged_out",
    lost_device: "lost",
    unlink: "unlinked",
    revoke: "revoked",
  } as const;
  if (
    record.serverChallenge !== null ||
    record.challengeExpiresAt !== null ||
    record.intakeCredential !== null
  ) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      "terminal lifecycle receipt must not return replacement credential material"
    );
  }
  return {
    ...common,
    action,
    state: expectLiteral(record.state, expectedState[action], `${path}.state`),
    serverChallenge: null,
    challengeExpiresAt: null,
    intakeCredential: null,
  };
}
