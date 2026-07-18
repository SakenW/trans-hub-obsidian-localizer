import type { RegistryResolution } from "./contracts.js";
import { protocolError } from "./errors.js";
import { parseAcquisitionKind, parseNullable, uniqueValues } from "./parser-primitives.js";
import {
  exactObject,
  expectArray,
  expectEnum,
  expectHttpsUrl,
  expectIdentifier,
  expectLiteral,
  expectString,
  expectTimestamp,
  parseDigest,
  parseProtocolVersion,
} from "./schema.js";

export function parseRegistryResolution(value: unknown, path = "$"): RegistryResolution {
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "resolutionId",
    "resolvedAt",
    "registry",
    "externalIdentity",
    "upstream",
    "acquisition",
    "license",
    "lifecycle",
    "adapter",
  ]);
  expectLiteral(record.kind, "registry_resolution", `${path}.kind`);
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
  ]);
  const upstream = exactObject(record.upstream, `${path}.upstream`, [
    "identityKind",
    "immutableIdentity",
    "versionLabel",
  ]);
  const immutableIdentity = expectString(
    upstream.immutableIdentity,
    `${path}.upstream.immutableIdentity`,
    { max: 512 }
  );
  if (/^(?:latest|main|master|head)$/iu.test(immutableIdentity)) {
    protocolError(
      "CP_INVALID_VALUE",
      `${path}.upstream.immutableIdentity`,
      "upstream identity must be immutable"
    );
  }
  const acquisition = exactObject(record.acquisition, `${path}.acquisition`, [
    "kind",
    "allowedOrigins",
    "redirectPolicy",
    "authenticationPolicy",
  ]);
  const license = exactObject(record.license, `${path}.license`, ["spdx", "evidenceDigest"]);
  const adapter = exactObject(record.adapter, `${path}.adapter`, [
    "definitionId",
    "version",
    "buildDigest",
    "compatibilityRevision",
  ]);
  return {
    kind: "registry_resolution",
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    resolutionId: expectIdentifier(record.resolutionId, `${path}.resolutionId`),
    resolvedAt: expectTimestamp(record.resolvedAt, `${path}.resolvedAt`),
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
    },
    upstream: {
      identityKind: expectEnum(
        upstream.identityKind,
        ["release", "commit", "revision"],
        `${path}.upstream.identityKind`
      ),
      immutableIdentity,
      versionLabel: parseNullable(upstream.versionLabel, (item) =>
        expectString(item, `${path}.upstream.versionLabel`, { max: 256 })
      ),
    },
    acquisition: {
      kind: parseAcquisitionKind(acquisition.kind, `${path}.acquisition.kind`),
      allowedOrigins: uniqueValues(
        expectArray(
          acquisition.allowedOrigins,
          `${path}.acquisition.allowedOrigins`,
          (item, itemPath) => {
            const url = new URL(expectHttpsUrl(item, itemPath));
            return url.origin;
          },
          { minimum: 1, maximum: 32 }
        ),
        `${path}.acquisition.allowedOrigins`
      ),
      redirectPolicy: expectEnum(
        acquisition.redirectPolicy,
        ["none", "same_origin", "registry_rules"],
        `${path}.acquisition.redirectPolicy`
      ),
      authenticationPolicy: expectEnum(
        acquisition.authenticationPolicy,
        ["none", "public_platform_credential"],
        `${path}.acquisition.authenticationPolicy`
      ),
    },
    license: {
      spdx: expectString(license.spdx, `${path}.license.spdx`, { max: 128 }),
      evidenceDigest: parseDigest(
        license.evidenceDigest,
        "request",
        `${path}.license.evidenceDigest`
      ),
    },
    lifecycle: expectEnum(
      record.lifecycle,
      ["active", "yanked", "tombstoned"],
      `${path}.lifecycle`
    ),
    adapter: {
      definitionId: expectIdentifier(adapter.definitionId, `${path}.adapter.definitionId`),
      version: expectString(adapter.version, `${path}.adapter.version`, {
        max: 64,
      }),
      buildDigest: parseDigest(adapter.buildDigest, "adapter_build", `${path}.adapter.buildDigest`),
      compatibilityRevision: expectIdentifier(
        adapter.compatibilityRevision,
        `${path}.adapter.compatibilityRevision`
      ),
    },
  };
}
