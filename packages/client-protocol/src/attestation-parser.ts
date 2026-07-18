import type { SourceAttestation } from "./contracts.js";
import { protocolError } from "./errors.js";
import { parseNullable } from "./parser-primitives.js";
import {
  exactObject,
  expectArray,
  expectEnum,
  expectIdentifier,
  expectInteger,
  expectLiteral,
  expectSignature,
  expectString,
  expectTimestamp,
  parseDigest,
  parseProtocolVersion,
} from "./schema.js";

function parseAttestationComponent(value: unknown, path: string) {
  const record = exactObject(value, path, ["name", "transportDigest"]);
  return {
    name: expectIdentifier(record.name, `${path}.name`),
    transportDigest: parseDigest(record.transportDigest, "transport", `${path}.transportDigest`),
  } as const;
}

export function parseSourceAttestation(value: unknown, path = "$"): SourceAttestation {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "attestationId",
    "status",
    "issuedAt",
    "expiresAt",
    "resolutionId",
    "registry",
    "externalIdentity",
    "acquisition",
    "adapter",
    "result",
    "verifier",
  ]);
  expectLiteral(record.kind, "source_attestation", `${path}.kind`);
  const registry = exactObject(record.registry, `${path}.registry`, [
    "root",
    "revision",
    "definitionDigest",
    "policyRevision",
  ]);
  const externalIdentity = exactObject(record.externalIdentity, `${path}.externalIdentity`, [
    "objectId",
    "publisher",
    "namespace",
    "upstreamImmutableRevision",
  ]);
  const acquisition = exactObject(record.acquisition, `${path}.acquisition`, [
    "manifestRootDigest",
    "components",
  ]);
  const components = expectArray(
    acquisition.components,
    `${path}.acquisition.components`,
    parseAttestationComponent,
    { minimum: 1, maximum: 4096 }
  );
  if (new Set(components.map((item) => item.name)).size !== components.length) {
    protocolError(
      "CP_INVALID_MANIFEST_CLOSURE",
      `${path}.acquisition.components`,
      "attested component names must be unique"
    );
  }
  const adapter = exactObject(record.adapter, `${path}.adapter`, [
    "definitionId",
    "version",
    "buildDigest",
    "sourceRevision",
    "toolchainDigest",
    "sbomDigest",
    "provenanceDigest",
  ]);
  const result = exactObject(record.result, `${path}.result`, [
    "sourceDigest",
    "logicalObjectDigest",
  ]);
  const verifier = exactObject(record.verifier, `${path}.verifier`, [
    "keyId",
    "keyVersion",
    "algorithm",
    "payloadDigest",
    "signature",
  ]);
  const issuedAt = expectTimestamp(record.issuedAt, `${path}.issuedAt`);
  const expiresAt = parseNullable(record.expiresAt, (item) =>
    expectTimestamp(item, `${path}.expiresAt`)
  );
  if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    protocolError(
      "CP_INVALID_TIMESTAMP",
      `${path}.expiresAt`,
      "attestation expiry must be after issuance"
    );
  }
  return {
    kind: "source_attestation",
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    attestationId: expectIdentifier(record.attestationId, `${path}.attestationId`),
    status: expectEnum(record.status, ["valid", "revoked", "reverify_required"], `${path}.status`),
    issuedAt,
    expiresAt,
    resolutionId: expectIdentifier(record.resolutionId, `${path}.resolutionId`),
    registry: {
      root: expectIdentifier(registry.root, `${path}.registry.root`),
      revision: expectIdentifier(registry.revision, `${path}.registry.revision`),
      definitionDigest: parseDigest(
        registry.definitionDigest,
        "registry_definition",
        `${path}.registry.definitionDigest`
      ),
      policyRevision: expectIdentifier(registry.policyRevision, `${path}.registry.policyRevision`),
    },
    externalIdentity: {
      objectId: expectString(externalIdentity.objectId, `${path}.externalIdentity.objectId`, {
        max: 512,
      }),
      publisher: expectString(externalIdentity.publisher, `${path}.externalIdentity.publisher`, {
        max: 256,
      }),
      namespace: expectString(externalIdentity.namespace, `${path}.externalIdentity.namespace`, {
        max: 256,
      }),
      upstreamImmutableRevision: expectString(
        externalIdentity.upstreamImmutableRevision,
        `${path}.externalIdentity.upstreamImmutableRevision`,
        { max: 512 }
      ),
    },
    acquisition: {
      manifestRootDigest: parseDigest(
        acquisition.manifestRootDigest,
        "manifest_root",
        `${path}.acquisition.manifestRootDigest`
      ),
      components,
    },
    adapter: {
      definitionId: expectIdentifier(adapter.definitionId, `${path}.adapter.definitionId`),
      version: expectString(adapter.version, `${path}.adapter.version`, {
        max: 64,
      }),
      buildDigest: parseDigest(adapter.buildDigest, "adapter_build", `${path}.adapter.buildDigest`),
      sourceRevision: expectIdentifier(adapter.sourceRevision, `${path}.adapter.sourceRevision`),
      toolchainDigest: parseDigest(
        adapter.toolchainDigest,
        "toolchain",
        `${path}.adapter.toolchainDigest`
      ),
      sbomDigest: parseDigest(adapter.sbomDigest, "sbom", `${path}.adapter.sbomDigest`),
      provenanceDigest: parseDigest(
        adapter.provenanceDigest,
        "provenance",
        `${path}.adapter.provenanceDigest`
      ),
    },
    result: {
      sourceDigest: parseDigest(result.sourceDigest, "source", `${path}.result.sourceDigest`),
      logicalObjectDigest: parseDigest(
        result.logicalObjectDigest,
        "logical_object",
        `${path}.result.logicalObjectDigest`
      ),
    },
    verifier: {
      keyId: expectIdentifier(verifier.keyId, `${path}.verifier.keyId`),
      keyVersion: expectInteger(verifier.keyVersion, `${path}.verifier.keyVersion`, { minimum: 1 }),
      algorithm: expectLiteral(verifier.algorithm, "ed25519", `${path}.verifier.algorithm`),
      payloadDigest: parseDigest(
        verifier.payloadDigest,
        "attestation_payload",
        `${path}.verifier.payloadDigest`
      ),
      signature: expectSignature(verifier.signature, `${path}.verifier.signature`),
    },
  };
}
