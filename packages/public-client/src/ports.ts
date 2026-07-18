import type {
  BootstrapResponse,
  NativeTransferCapabilityWire,
  ProtocolDigestPort,
  ProtocolStreamingDigestPort,
  ProviderUploadGrantWire,
  PublicIntakeSessionCredential,
  RequestDigest,
  TransportDigest,
} from "@trans-hub/client-protocol";

export type PublicControlCredential = PublicIntakeSessionCredential;

export interface ControlHttpRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown | null;
  readonly credential: PublicControlCredential | null;
  readonly signal?: AbortSignal;
}

export interface ControlHttpResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface TransferHttpRequest {
  readonly method: "GET" | "PUT";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array> | null;
  readonly signal?: AbortSignal;
}

export interface TransferHttpResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array> | null;
}

export interface PublicHttpTransportPort {
  control(request: ControlHttpRequest): Promise<ControlHttpResponse>;
  transfer(request: TransferHttpRequest): Promise<TransferHttpResponse>;
}

export interface Ed25519InstallationSignerPort {
  readonly keyId: string;
  readonly publicKey: string;
  signProof(
    proof: PublicContributionProofSigningInput,
    signal?: AbortSignal
  ): Promise<PublicContributionProofSignature>;
}

export interface PublicContributionProofSigningInput {
  readonly requestDigest: RequestDigest;
  readonly challenge: string;
  readonly nonce: string;
  readonly credentialEpoch: number;
}

export interface PublicContributionProofSignature {
  readonly signedAt: string;
  readonly signature: string;
}

export interface ServerKeyVerifierPort {
  verify(input: {
    readonly algorithm: "ed25519";
    readonly keyId: string;
    readonly keyVersion: number;
    readonly message: Uint8Array;
    readonly signature: string;
    readonly signal?: AbortSignal;
  }): Promise<boolean>;
}

export interface ClockPort {
  now(): Date;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export interface RandomNoncePort {
  nonce(): string;
  unitInterval(): number;
}

export interface InstallationRecord {
  readonly bootstrap: BootstrapResponse;
}

export interface InstallationStoragePort {
  load(): Promise<InstallationRecord | null>;
  save(record: InstallationRecord): Promise<void>;
  clear(): Promise<void>;
}

export interface ReopenableByteSource {
  open(): AsyncIterable<Uint8Array>;
}

/**
 * Source bytes already admitted into the encrypted Public CAS by Private Native Core.
 *
 * The marker is only a product-shell routing aid. Private Native Core remains the
 * authority: it reopens the opaque handle and binds the stored digest and length to
 * the server-signed capability before any provider request is made.
 */
export interface NativePreparedPublicByteSource extends ReopenableByteSource {
  readonly kind: "native_prepared_public_source";
  readonly payloadHandle: string;
  readonly transportDigest: TransportDigest;
  readonly contentLength: number;
}

export interface PublicProviderUploadPort {
  upload(input: {
    readonly providerGrant: ProviderUploadGrantWire;
    readonly nativeCapability: NativeTransferCapabilityWire;
    readonly source: ReopenableByteSource;
    readonly expected: {
      readonly transportDigest: TransportDigest;
      readonly contentLength: number;
      readonly mediaType: string;
    };
    readonly signal?: AbortSignal;
  }): Promise<void>;
}

export interface DownloadTransaction {
  write(chunk: Uint8Array): Promise<void>;
  commit(): Promise<void>;
  rollback(cause: unknown): Promise<void>;
}

export interface TransactionalDownloadSink {
  begin(): Promise<DownloadTransaction>;
}

export type DigestPort = ProtocolDigestPort;
export type StreamingDigestPort = ProtocolStreamingDigestPort;
