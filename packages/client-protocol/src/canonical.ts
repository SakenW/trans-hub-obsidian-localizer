import type { DigestPort } from "@trans-hub/uida";

import type {
  ContributionIntent,
  InstallationLifecycleReceipt,
  InstallationLifecycleRecoveryRequest,
  InstallationLifecycleRotationRequest,
  PublicArtifactManifest,
  PublicDownloadTicket,
  PublicInstallationLifecycleCommand,
  PublicInstallationRecoveryCommand,
  PublicUploadGrant,
  PublicUploadGrantRequest,
  PublicUploadGrantSigningPayload,
  SourceAcquisitionManifest,
  SourceAttestation,
} from "./contracts.js";
import {
  createDigest,
  type DigestDomain,
  digestDomainSeparator,
  type ProtocolDigest,
} from "./digest.js";
import { protocolError } from "./errors.js";
import {
  DEFAULT_STRICT_JSON_LIMITS,
  type StrictJsonLimits,
} from "./strict-json.js";

export type ProtocolJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ProtocolJsonValue[]
  | { readonly [key: string]: ProtocolJsonValue };

export type ContributionSigningPayload = ContributionIntent extends infer Intent
  ? Intent extends ContributionIntent
    ? Omit<Intent, "installationProof">
    : never
  : never;

export type InstallationLifecycleRotationSigningPayload = Omit<
  InstallationLifecycleRotationRequest,
  "currentInstallationProof" | "replacementInstallationProof"
>;

export type InstallationLifecycleRecoverySigningPayload = Omit<
  InstallationLifecycleRecoveryRequest,
  "replacementInstallationProof"
>;

export type ProtocolDigestPort = DigestPort;

function assertPairedSurrogates(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        protocolError(
          "CP_UNPAIRED_SURROGATE",
          path,
          "canonical JSON must not contain unpaired UTF-16 surrogates",
        );
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      protocolError(
        "CP_UNPAIRED_SURROGATE",
        path,
        "canonical JSON must not contain unpaired UTF-16 surrogates",
      );
    }
  }
}

class CanonicalJsonEncoder {
  private nodes = 0;
  private readonly ancestors = new WeakSet<object>();

  constructor(private readonly limits: StrictJsonLimits) {}

  encode(value: unknown): Uint8Array {
    const text = this.encodeValue(value, "$", 0);
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > this.limits.maxBytes) {
      protocolError(
        "CP_JSON_LIMIT_EXCEEDED",
        "$",
        `canonical JSON exceeds ${this.limits.maxBytes} bytes`,
      );
    }
    return bytes;
  }

  private encodeValue(value: unknown, path: string, depth: number): string {
    if (depth > this.limits.maxDepth) {
      protocolError(
        "CP_JSON_LIMIT_EXCEEDED",
        path,
        `canonical JSON nesting exceeds ${this.limits.maxDepth}`,
      );
    }
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) {
      protocolError(
        "CP_JSON_LIMIT_EXCEEDED",
        path,
        `canonical JSON node count exceeds ${this.limits.maxNodes}`,
      );
    }
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string") {
      assertPairedSurrogates(value, path);
      if (value.length > this.limits.maxStringLength) {
        protocolError(
          "CP_JSON_LIMIT_EXCEEDED",
          path,
          `string length exceeds ${this.limits.maxStringLength}`,
        );
      }
      return JSON.stringify(value);
    }
    if (typeof value === "number") {
      if (!Number.isInteger(value)) {
        protocolError(
          "CP_FLOAT_FORBIDDEN",
          path,
          "floating-point numbers are forbidden in canonical protocol JSON",
        );
      }
      if (!Number.isSafeInteger(value)) {
        protocolError(
          "CP_INTEGER_OUT_OF_RANGE",
          path,
          "canonical protocol integers must be within the safe integer range",
        );
      }
      return Object.is(value, -0) ? "0" : String(value);
    }
    if (typeof value !== "object") {
      protocolError(
        "CP_INVALID_TYPE",
        path,
        "canonical protocol JSON supports only JSON values",
      );
    }
    if (this.ancestors.has(value)) {
      protocolError(
        "CP_INVALID_VALUE",
        path,
        "circular protocol JSON is forbidden",
      );
    }
    this.ancestors.add(value);
    try {
      if (Array.isArray(value)) return this.encodeArray(value, path, depth + 1);
      return this.encodeObject(value, path, depth + 1);
    } finally {
      this.ancestors.delete(value);
    }
  }

  private encodeArray(
    value: readonly unknown[],
    path: string,
    depth: number,
  ): string {
    if (value.length > this.limits.maxArrayLength) {
      protocolError(
        "CP_JSON_LIMIT_EXCEEDED",
        path,
        `array length exceeds ${this.limits.maxArrayLength}`,
      );
    }
    return `[${value
      .map((item, index) => this.encodeValue(item, `${path}[${index}]`, depth))
      .join(",")}]`;
  }

  private encodeObject(value: object, path: string, depth: number): string {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      protocolError(
        "CP_INVALID_TYPE",
        path,
        "canonical JSON object must be plain",
      );
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      protocolError(
        "CP_INVALID_TYPE",
        path,
        "symbol keys are forbidden in protocol JSON",
      );
    }
    if (ownKeys.length > this.limits.maxObjectKeys) {
      protocolError(
        "CP_JSON_LIMIT_EXCEEDED",
        path,
        `object key count exceeds ${this.limits.maxObjectKeys}`,
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = ownKeys as string[];
    for (const key of keys) {
      assertPairedSurrogates(key, `${path}.${key}`);
      if (key.length > this.limits.maxStringLength) {
        protocolError(
          "CP_JSON_LIMIT_EXCEEDED",
          `${path}.${key}`,
          `object key length exceeds ${this.limits.maxStringLength}`,
        );
      }
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      ) {
        protocolError(
          "CP_INVALID_TYPE",
          `${path}.${key}`,
          "accessor and non-enumerable properties are forbidden in protocol JSON",
        );
      }
    }
    keys.sort();
    return `{${keys
      .map((key) => {
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor)) {
          protocolError(
            "CP_INVALID_TYPE",
            `${path}.${key}`,
            "invalid JSON property",
          );
        }
        return `${JSON.stringify(key)}:${this.encodeValue(
          descriptor.value,
          `${path}.${key}`,
          depth,
        )}`;
      })
      .join(",")}}`;
  }
}

export function canonicalizeProtocolJson(value: unknown): Uint8Array {
  return new CanonicalJsonEncoder(DEFAULT_STRICT_JSON_LIMITS).encode(value);
}

/** Internal bounded variant for protocol contracts whose documented payload ceiling exceeds 1 MiB. */
export function canonicalizeProtocolJsonWithLimits(
  value: unknown,
  limits: StrictJsonLimits,
): Uint8Array {
  return new CanonicalJsonEncoder(limits).encode(value);
}

export function buildProtocolDigestFrame(
  domain: DigestDomain,
  canonicalBytes: Uint8Array,
): Uint8Array {
  const prefix = new TextEncoder().encode(digestDomainSeparator(domain));
  const frame = new Uint8Array(prefix.byteLength + canonicalBytes.byteLength);
  frame.set(prefix, 0);
  frame.set(canonicalBytes, prefix.byteLength);
  return frame;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function computeProtocolDigest<Domain extends DigestDomain>(
  domain: Domain,
  value: unknown,
  digestPort: ProtocolDigestPort,
): Promise<ProtocolDigest<Domain>> {
  const canonicalBytes = canonicalizeProtocolJson(value);
  const digestBytes = await digestPort.digest(
    buildProtocolDigestFrame(domain, canonicalBytes),
  );
  if (digestBytes.byteLength !== 32) {
    protocolError(
      "CP_INVALID_DIGEST",
      "$.digest",
      "DigestPort must return exactly 32 bytes",
    );
  }
  return createDigest(domain, bytesToHex(digestBytes));
}

export function contributionSigningPayload(
  intent: ContributionIntent,
): ContributionSigningPayload {
  const { installationProof: _installationProof, ...payload } = intent;
  return payload;
}

export function publicUploadGrantSigningPayload(
  request: PublicUploadGrantRequest,
): PublicUploadGrantSigningPayload {
  const { installationProof: _installationProof, ...payload } = request;
  return payload;
}

export function installationLifecycleRotationSigningPayload(
  request: InstallationLifecycleRotationRequest,
): InstallationLifecycleRotationSigningPayload {
  const {
    currentInstallationProof: _currentInstallationProof,
    replacementInstallationProof: _replacementInstallationProof,
    ...payload
  } = request;
  return payload;
}

export function installationLifecycleRecoverySigningPayload(
  request: InstallationLifecycleRecoveryRequest,
): InstallationLifecycleRecoverySigningPayload {
  const {
    replacementInstallationProof: _replacementInstallationProof,
    ...payload
  } = request;
  return payload;
}

export function sourceAcquisitionManifestDigestPayload(
  manifest: SourceAcquisitionManifest,
): Omit<SourceAcquisitionManifest, "rootDigest"> {
  const { rootDigest: _rootDigest, ...payload } = manifest;
  return payload;
}

export function sourceAttestationSigningPayload(
  attestation: SourceAttestation,
): Omit<SourceAttestation, "verifier"> {
  const { verifier: _verifier, ...payload } = attestation;
  return payload;
}

export function serverEnvelopeSigningPayload(
  document:
    | PublicUploadGrant
    | PublicDownloadTicket
    | PublicArtifactManifest
    | PublicInstallationLifecycleCommand
    | PublicInstallationRecoveryCommand
    | InstallationLifecycleReceipt,
): Omit<typeof document, "serverProof"> {
  const { serverProof: _serverProof, ...payload } = document;
  return payload;
}

export async function assertInstallationLifecycleRequestDigest(
  request:
    | InstallationLifecycleRotationRequest
    | InstallationLifecycleRecoveryRequest,
  digestPort: ProtocolDigestPort,
): Promise<void> {
  const payload =
    request.action === "rotate"
      ? installationLifecycleRotationSigningPayload(request)
      : installationLifecycleRecoverySigningPayload(request);
  const actual = await computeProtocolDigest("request", payload, digestPort);
  const currentMatches =
    request.action === "reinstall" ||
    equalDigestHex(
      actual.hex,
      request.currentInstallationProof.requestDigest.hex,
    );
  if (
    !currentMatches ||
    !equalDigestHex(
      actual.hex,
      request.replacementInstallationProof.requestDigest.hex,
    )
  ) {
    protocolError(
      "CP_REQUEST_DIGEST_MISMATCH",
      "$.currentInstallationProof.requestDigest",
      "lifecycle request digest does not match both key proofs",
    );
  }
}

function equalDigestHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function assertContributionRequestDigest(
  intent: ContributionIntent,
  digestPort: ProtocolDigestPort,
): Promise<void> {
  const actual = await computeProtocolDigest(
    "request",
    contributionSigningPayload(intent),
    digestPort,
  );
  if (!equalDigestHex(actual.hex, intent.installationProof.requestDigest.hex)) {
    protocolError(
      "CP_REQUEST_DIGEST_MISMATCH",
      "$.installationProof.requestDigest",
      "contribution request digest does not match its signing payload",
    );
  }
}

export async function assertSourceAcquisitionManifestRoot(
  manifest: SourceAcquisitionManifest,
  digestPort: ProtocolDigestPort,
): Promise<void> {
  const actual = await computeProtocolDigest(
    "manifest_root",
    sourceAcquisitionManifestDigestPayload(manifest),
    digestPort,
  );
  if (!equalDigestHex(actual.hex, manifest.rootDigest.hex)) {
    protocolError(
      "CP_INVALID_MANIFEST_CLOSURE",
      "$.rootDigest",
      "manifest root digest does not match the complete acquisition closure",
    );
  }
}

export async function assertSourceAttestationPayloadDigest(
  attestation: SourceAttestation,
  digestPort: ProtocolDigestPort,
): Promise<void> {
  const actual = await computeProtocolDigest(
    "attestation_payload",
    sourceAttestationSigningPayload(attestation),
    digestPort,
  );
  if (!equalDigestHex(actual.hex, attestation.verifier.payloadDigest.hex)) {
    protocolError(
      "CP_ATTESTATION_PAYLOAD_MISMATCH",
      "$.verifier.payloadDigest",
      "attestation digest does not match its signed payload",
    );
  }
}

export async function assertServerEnvelopePayloadDigest(
  document:
    | PublicUploadGrant
    | PublicDownloadTicket
    | PublicArtifactManifest
    | PublicInstallationLifecycleCommand
    | PublicInstallationRecoveryCommand
    | InstallationLifecycleReceipt,
  digestPort: ProtocolDigestPort,
): Promise<void> {
  const actual = await computeProtocolDigest(
    "signed_payload",
    serverEnvelopeSigningPayload(document),
    digestPort,
  );
  if (!equalDigestHex(actual.hex, document.serverProof.payloadDigest.hex)) {
    protocolError(
      "CP_SIGNED_PAYLOAD_MISMATCH",
      "$.serverProof.payloadDigest",
      "server proof digest does not match its payload",
    );
  }
}
