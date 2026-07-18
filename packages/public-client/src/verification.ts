import {
  assertServerEnvelopePayloadDigest,
  type PublicArtifactManifest,
  type PublicDownloadTicket,
  type PublicUploadGrant,
  serverProofSignatureFrame,
} from "@trans-hub/client-protocol";

import { normalizeError, publicClientError } from "./errors.js";
import type { ClockPort, DigestPort, ServerKeyVerifierPort } from "./ports.js";

export type ServerDocument = PublicUploadGrant | PublicDownloadTicket | PublicArtifactManifest;

function equalDigest(left: { readonly hex: string }, right: { readonly hex: string }): boolean {
  if (left.hex.length !== right.hex.length) return false;
  let difference = 0;
  for (let index = 0; index < left.hex.length; index += 1) {
    difference |= left.hex.charCodeAt(index) ^ right.hex.charCodeAt(index);
  }
  return difference === 0;
}

export function assertDigestScope(
  actual: { readonly hex: string },
  expected: { readonly hex: string },
  operation: string
): void {
  if (!equalDigest(actual, expected)) {
    throw publicClientError("PC_DIGEST_MISMATCH", "Digest scope does not match", { operation });
  }
}

export function assertNotExpired(
  expiresAt: string,
  clock: ClockPort,
  maximumClockSkewMs: number,
  operation: string
): void {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || clock.now().getTime() - maximumClockSkewMs >= expiry) {
    throw publicClientError("PC_EXPIRED", "The public capability has expired", { operation });
  }
}

export async function verifyServerDocument(
  document: ServerDocument,
  ports: {
    readonly digest: DigestPort;
    readonly verifier: ServerKeyVerifierPort;
    readonly clock: ClockPort;
    readonly maximumClockSkewMs: number;
    readonly signal?: AbortSignal;
  }
): Promise<void> {
  const operation = document.kind;
  try {
    await assertServerEnvelopePayloadDigest(document, ports.digest);
  } catch (error) {
    throw normalizeError(error, operation);
  }
  let valid: boolean;
  try {
    valid = await ports.verifier.verify({
      algorithm: document.serverProof.algorithm,
      keyId: document.serverProof.keyId,
      keyVersion: document.serverProof.keyVersion,
      message: serverProofSignatureFrame(document.serverProof),
      signature: document.serverProof.signature,
      ...(ports.signal === undefined ? {} : { signal: ports.signal }),
    });
  } catch (error) {
    throw normalizeError(error, operation);
  }
  if (!valid) {
    throw publicClientError("PC_SIGNATURE_INVALID", "The server proof signature is invalid", {
      operation,
    });
  }
  const signedAt = Date.parse(document.serverProof.signedAt);
  if (signedAt > ports.clock.now().getTime() + ports.maximumClockSkewMs) {
    throw publicClientError("PC_CLOCK_SKEW", "The server proof is signed in the future", {
      operation,
    });
  }
  if (document.serverProof.expiresAt !== null) {
    assertNotExpired(
      document.serverProof.expiresAt,
      ports.clock,
      ports.maximumClockSkewMs,
      operation
    );
  }
}

export function assertManifestTicketScope(
  manifest: PublicArtifactManifest,
  ticket: PublicDownloadTicket,
  componentName: string
): void {
  const component = manifest.components.find((item) => item.name === componentName);
  if (
    component === undefined ||
    ticket.manifestId !== manifest.manifestId ||
    ticket.componentName !== componentName ||
    ticket.contentLength !== component.size
  ) {
    throw publicClientError("PC_SCOPE_MISMATCH", "Download ticket scope does not match manifest", {
      operation: "download-scope",
    });
  }
  assertDigestScope(ticket.manifestDigest, manifest.manifestDigest, "download-manifest-digest");
  assertDigestScope(ticket.transportDigest, component.transportDigest, "download-component-digest");
}
