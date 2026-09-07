import { canonicalizeProtocolJson } from "./canonical.js";
import type {
  InstallationLifecycleKeyProof,
  InstallationProof,
  ServerSignatureEnvelope,
  SourceAttestation,
} from "./contracts.js";

export type InstallationProofSigningPayload = Omit<InstallationProof, "signature">;
export type InstallationLifecycleProofSigningPayload = Omit<
  InstallationLifecycleKeyProof,
  "signature"
>;

export type ServerProofSigningPayload = Omit<
  ServerSignatureEnvelope<ServerSignatureEnvelopeDomain>,
  "signature"
>;

export type SourceAttestationProofSigningPayload = Omit<SourceAttestation["verifier"], "signature">;

type ServerSignatureEnvelopeDomain =
  | "public_upload_grant"
  | "public_download_ticket"
  | "public_artifact_manifest"
  | "public_installation_lifecycle_command"
  | "public_installation_recovery_command"
  | "public_installation_lifecycle_receipt";

export type ProtocolSignatureDomain =
  | "public_contribution_intake"
  | "public_installation_lifecycle"
  | ServerSignatureEnvelopeDomain
  | "source_attestation"
  | "translation_export_manifest";

function signatureDomainSeparator(domain: ProtocolSignatureDomain): string {
  return `trans-hub.client-protocol/v1/signature/${domain}\u0000`;
}

export function buildProtocolSignatureFrame(
  domain: ProtocolSignatureDomain,
  payload: unknown
): Uint8Array {
  const canonicalPayload = canonicalizeProtocolJson(payload);
  return buildProtocolSignatureFrameFromCanonicalBytes(domain, canonicalPayload);
}

/**
 * Frame already-canonical bytes for a protocol signature.
 *
 * Some versioned wire contracts have their own documented canonical JSON profile.
 * Callers must validate and canonicalize those bytes with that contract before using
 * this framing primitive; this function owns only the shared domain separator.
 */
export function buildProtocolSignatureFrameFromCanonicalBytes(
  domain: ProtocolSignatureDomain,
  canonicalPayload: Uint8Array,
): Uint8Array {
  const prefix = new TextEncoder().encode(signatureDomainSeparator(domain));
  const frame = new Uint8Array(prefix.byteLength + canonicalPayload.byteLength);
  frame.set(prefix, 0);
  frame.set(canonicalPayload, prefix.byteLength);
  return frame;
}

export function installationProofSigningPayload(
  proof: InstallationProof
): InstallationProofSigningPayload {
  const { signature: _signature, ...payload } = proof;
  return payload;
}

export function installationProofSignatureFrame(proof: InstallationProof): Uint8Array {
  return buildProtocolSignatureFrame(
    "public_contribution_intake",
    installationProofSigningPayload(proof)
  );
}

export function installationLifecycleProofSigningPayload(
  proof: InstallationLifecycleKeyProof
): InstallationLifecycleProofSigningPayload {
  const { signature: _signature, ...payload } = proof;
  return payload;
}

export function installationLifecycleProofSignatureFrame(
  proof: InstallationLifecycleKeyProof
): Uint8Array {
  return buildProtocolSignatureFrame(
    "public_installation_lifecycle",
    installationLifecycleProofSigningPayload(proof)
  );
}

export function serverProofSigningPayload(
  proof: ServerSignatureEnvelope<ServerSignatureEnvelopeDomain>
): ServerProofSigningPayload {
  const { signature: _signature, ...payload } = proof;
  return payload;
}

export function serverProofSignatureFrame(
  proof: ServerSignatureEnvelope<ServerSignatureEnvelopeDomain>
): Uint8Array {
  return buildProtocolSignatureFrame(proof.domain, serverProofSigningPayload(proof));
}

export function sourceAttestationProofSigningPayload(
  attestation: SourceAttestation
): SourceAttestationProofSigningPayload {
  const { signature: _signature, ...payload } = attestation.verifier;
  return payload;
}

export function sourceAttestationProofSignatureFrame(attestation: SourceAttestation): Uint8Array {
  return buildProtocolSignatureFrame(
    "source_attestation",
    sourceAttestationProofSigningPayload(attestation)
  );
}
