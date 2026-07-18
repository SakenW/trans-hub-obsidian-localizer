import type {
  AcquisitionComponent,
  SourceAcquisitionManifest,
  UpstreamSignature,
} from "./contracts.js";
import type { DigestDomain, ProtocolDigest } from "./digest.js";
import { protocolError } from "./errors.js";
import { parseAcquisitionKind, parseNullable } from "./parser-primitives.js";
import {
  exactObject,
  expectArray,
  expectEnum,
  expectHttpsUrl,
  expectIdentifier,
  expectImmutableHttpsUrl,
  expectInteger,
  expectLiteral,
  expectMediaType,
  expectSignature,
  expectString,
  parseDigest,
  parseProtocolVersion,
  type UnknownRecord,
} from "./schema.js";

function parseUpstreamSignature(value: unknown, path: string): UpstreamSignature {
  const record = exactObject(value, path, ["algorithm", "keyId", "signature"]);
  return {
    algorithm: expectEnum(record.algorithm, ["ed25519", "minisign", "pgp"], `${path}.algorithm`),
    keyId: expectIdentifier(record.keyId, `${path}.keyId`),
    signature: expectSignature(record.signature, `${path}.signature`),
  };
}

export function parseComponent(value: unknown, path: string): AcquisitionComponent {
  const record = exactObject(value, path, [
    "name",
    "role",
    "canonicalLocator",
    "mediaType",
    "size",
    "transportDigest",
    "upstreamSignature",
  ]);
  return {
    name: expectIdentifier(record.name, `${path}.name`),
    role: expectIdentifier(record.role, `${path}.role`),
    canonicalLocator: expectImmutableHttpsUrl(record.canonicalLocator, `${path}.canonicalLocator`),
    mediaType: expectMediaType(record.mediaType, `${path}.mediaType`),
    size: expectInteger(record.size, `${path}.size`, {
      minimum: 1,
      maximum: 8_589_934_592,
    }),
    transportDigest: parseDigest(record.transportDigest, "transport", `${path}.transportDigest`),
    upstreamSignature: parseNullable(record.upstreamSignature, (item) =>
      parseUpstreamSignature(item, `${path}.upstreamSignature`)
    ),
  };
}

export function assertComponentClosure(
  components: readonly AcquisitionComponent[],
  path: string
): void {
  const names = components.map((component) => component.name);
  if (new Set(names).size !== names.length) {
    protocolError("CP_INVALID_MANIFEST_CLOSURE", path, "component names must be unique");
  }
}

function equalDigest(
  left: ProtocolDigest<DigestDomain>,
  right: ProtocolDigest<DigestDomain>
): boolean {
  return left.domain === right.domain && left.hex === right.hex;
}

export function parseSourceAcquisitionManifest(
  value: unknown,
  path = "$"
): SourceAcquisitionManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    protocolError("CP_INVALID_TYPE", path, "expected an acquisition manifest object");
  }
  const initial = value as UnknownRecord;
  const acquisitionKind = parseAcquisitionKind(initial.acquisitionKind, `${path}.acquisitionKind`);
  const variantFields =
    acquisitionKind === "single_blob"
      ? ["blob"]
      : acquisitionKind === "signed_components"
        ? ["componentSemantics", "upstreamManifest"]
        : acquisitionKind === "fixed_git_tree"
          ? ["repository"]
          : ["apiSnapshot"];
  const record = exactObject(value, path, [
    "kind",
    "protocol",
    "acquisitionKind",
    "manifestId",
    "resolutionId",
    "acquisitionPolicyRevision",
    "rootDigest",
    "components",
    ...variantFields,
  ]);
  expectLiteral(record.kind, "source_acquisition_manifest", `${path}.kind`);
  const components = expectArray(record.components, `${path}.components`, parseComponent, {
    minimum: 1,
    maximum: 4096,
  });
  assertComponentClosure(components, `${path}.components`);
  const base = {
    kind: "source_acquisition_manifest" as const,
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    manifestId: expectIdentifier(record.manifestId, `${path}.manifestId`),
    resolutionId: expectIdentifier(record.resolutionId, `${path}.resolutionId`),
    acquisitionPolicyRevision: expectIdentifier(
      record.acquisitionPolicyRevision,
      `${path}.acquisitionPolicyRevision`
    ),
    rootDigest: parseDigest(record.rootDigest, "manifest_root", `${path}.rootDigest`),
    components,
  };

  if (acquisitionKind === "single_blob") {
    const blob = exactObject(record.blob, `${path}.blob`, ["componentName"]);
    const componentName = expectIdentifier(blob.componentName, `${path}.blob.componentName`);
    if (components.length !== 1 || components[0]?.name !== componentName) {
      protocolError(
        "CP_INVALID_MANIFEST_CLOSURE",
        `${path}.components`,
        "single blob manifest must contain exactly its named component"
      );
    }
    return { ...base, acquisitionKind, blob: { componentName } };
  }

  if (acquisitionKind === "signed_components") {
    if (components.length < 2) {
      protocolError(
        "CP_INVALID_MANIFEST_CLOSURE",
        `${path}.components`,
        "signed component manifest requires at least two components"
      );
    }
    const componentSemantics = expectEnum(
      record.componentSemantics,
      ["ordered", "named"],
      `${path}.componentSemantics`
    );
    if (
      componentSemantics === "named" &&
      components.some(
        (component, index) => index > 0 && (components[index - 1]?.name ?? "") >= component.name
      )
    ) {
      protocolError(
        "CP_INVALID_MANIFEST_CLOSURE",
        `${path}.components`,
        "named components must be strictly sorted by name"
      );
    }
    const upstreamManifest = exactObject(record.upstreamManifest, `${path}.upstreamManifest`, [
      "componentName",
      "signedDigest",
      "signature",
    ]);
    const componentName = expectIdentifier(
      upstreamManifest.componentName,
      `${path}.upstreamManifest.componentName`
    );
    const signedDigest = parseDigest(
      upstreamManifest.signedDigest,
      "transport",
      `${path}.upstreamManifest.signedDigest`
    );
    const manifestComponent = components.find((component) => component.name === componentName);
    if (
      manifestComponent === undefined ||
      !equalDigest(manifestComponent.transportDigest, signedDigest)
    ) {
      protocolError(
        "CP_INVALID_MANIFEST_CLOSURE",
        `${path}.upstreamManifest`,
        "upstream manifest must name a component with the same transport digest"
      );
    }
    return {
      ...base,
      acquisitionKind,
      componentSemantics,
      upstreamManifest: {
        componentName,
        signedDigest,
        signature: parseUpstreamSignature(
          upstreamManifest.signature,
          `${path}.upstreamManifest.signature`
        ),
      },
    };
  }

  if (acquisitionKind === "fixed_git_tree") {
    const repository = exactObject(record.repository, `${path}.repository`, [
      "canonicalUrl",
      "commit",
      "tree",
    ]);
    const commit = expectString(repository.commit, `${path}.repository.commit`, {
      min: 40,
      max: 64,
    });
    const tree = expectString(repository.tree, `${path}.repository.tree`, {
      min: 40,
      max: 64,
    });
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commit)) {
      protocolError(
        "CP_INVALID_VALUE",
        `${path}.repository.commit`,
        "git commit must be a full lowercase object ID"
      );
    }
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(tree)) {
      protocolError(
        "CP_INVALID_VALUE",
        `${path}.repository.tree`,
        "git tree must be a full lowercase object ID"
      );
    }
    return {
      ...base,
      acquisitionKind,
      repository: {
        canonicalUrl: expectHttpsUrl(repository.canonicalUrl, `${path}.repository.canonicalUrl`),
        commit,
        tree,
      },
    };
  }

  const apiSnapshot = exactObject(record.apiSnapshot, `${path}.apiSnapshot`, [
    "endpoint",
    "immutableRevision",
    "pageCount",
    "paginationClosureDigest",
  ]);
  const immutableRevision = expectString(
    apiSnapshot.immutableRevision,
    `${path}.apiSnapshot.immutableRevision`,
    { max: 256 }
  );
  if (/^(?:latest|current|head)$/iu.test(immutableRevision)) {
    protocolError(
      "CP_INVALID_MANIFEST_CLOSURE",
      `${path}.apiSnapshot.immutableRevision`,
      "API snapshot revision must be immutable"
    );
  }
  const pageCount = expectInteger(apiSnapshot.pageCount, `${path}.apiSnapshot.pageCount`, {
    minimum: 1,
    maximum: 4096,
  });
  if (components.filter((component) => component.role === "page").length !== pageCount) {
    protocolError(
      "CP_INVALID_MANIFEST_CLOSURE",
      `${path}.components`,
      "API snapshot pageCount must exactly match page components"
    );
  }
  return {
    ...base,
    acquisitionKind,
    apiSnapshot: {
      endpoint: expectHttpsUrl(apiSnapshot.endpoint, `${path}.apiSnapshot.endpoint`),
      immutableRevision,
      pageCount,
      paginationClosureDigest: parseDigest(
        apiSnapshot.paginationClosureDigest,
        "logical_object",
        `${path}.apiSnapshot.paginationClosureDigest`
      ),
    },
  };
}
