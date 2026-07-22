export const TRANSLATION_EXPORT_SCHEMA =
  "trans-hub.translation-export" as const;
export const TRANSLATION_EXPORT_LEGACY_REVISION = 1 as const;
export const TRANSLATION_EXPORT_REVISION = 2 as const;

/** Wire digests are validated as lowercase sha256 values at every parser boundary. */
export type Sha256Digest = string;

export type ExportScope =
  | Readonly<{ kind: "public"; publicScopeId: string }>
  | Readonly<{
      kind: "private";
      tenantId: string;
      workspaceId: string;
      encryptionDomainId: string;
    }>;

export type DownloadAccessMode =
  | "public_immutable"
  | "authenticated_public"
  | "private_authorized";

export type TranslationPackRef = Readonly<{
  packId: string;
  packIndex: number;
  itemCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  objectVersion: string;
  transportDigest: Sha256Digest;
  canonicalPayloadDigest: Sha256Digest;
  logicalObjectDigest: Sha256Digest;
}>;

export type TranslationExportServerProof = Readonly<{
  domain: "translation_export_manifest";
  algorithm: "ed25519";
  keyId: string;
  keyVersion: number;
  payloadDigest: Readonly<{
    algorithm: "sha256";
    domain: "signed_payload";
    hex: string;
  }>;
  signedAt: string;
  expiresAt: string;
  signature: string;
}>;

type TranslationExportManifestBase = Readonly<{
  schema: typeof TRANSLATION_EXPORT_SCHEMA;
  manifestId: string;
  generationId: string;
  generationNumber: number;
  sourceStreamId: string;
  sourceVersionId: string;
  targetLocale: string;
  targetVariant: string;
  scope: ExportScope;
  manifestDigest: Sha256Digest;
  packs: readonly TranslationPackRef[];
}>;

export type TranslationExportManifest = TranslationExportManifestBase &
  (
    | Readonly<{
        revision: typeof TRANSLATION_EXPORT_LEGACY_REVISION;
        serverProof?: never;
      }>
    | Readonly<{
        revision: typeof TRANSLATION_EXPORT_REVISION;
        serverProof: TranslationExportServerProof;
      }>
  );

export type DownloadTicket = Readonly<{
  packId: string;
  objectVersion: string;
  url: string;
  expiresAtEpochMs: number | null;
  accessMode: DownloadAccessMode;
}>;

export type LocalPackKey = Readonly<{
  scopeKey: string;
  logicalObjectDigest: Sha256Digest;
  objectVersion: string;
}>;

export interface ScopeAwarePackStore {
  getVerified(key: LocalPackKey): Promise<Uint8Array | undefined>;
  putVerified(key: LocalPackKey, bytes: Uint8Array): Promise<void>;
  removeVerified?(key: LocalPackKey): Promise<void>;
}

export interface PackDownloadPort {
  download(
    input: Readonly<{
      url: string;
      objectVersion: string;
      expectedBytes: number;
    }>,
  ): Promise<Uint8Array>;
}

export interface PackVerificationPort {
  verify(
    input: Readonly<{ bytes: Uint8Array; pack: TranslationPackRef }>,
  ): Promise<Uint8Array>;
}

export interface TranslationManifestVerificationPort {
  verify(
    manifest: TranslationExportManifest & Readonly<{ revision: 2 }>,
  ): Promise<void>;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HttpRequest<TBody = unknown> = Readonly<{
  method: HttpMethod;
  path: string;
  body?: TBody;
  headers?: Readonly<Record<string, string>>;
}>;

export type HttpResponse<TBody = unknown> = Readonly<{
  status: number;
  body: TBody;
  headers: Readonly<Record<string, string>>;
}>;

export interface TranslationExportTransportPort {
  send<TResponse = unknown, TBody = unknown>(
    request: HttpRequest<TBody>,
  ): Promise<HttpResponse<TResponse>>;
}

export interface TranslationExportEndpoint {
  manifestPath(request: TranslationSyncRequest): string;
  downloadTicketsPath(request: TranslationSyncRequest): string;
  authorizationHeaders(): Readonly<Record<string, string>>;
  readonly manifestRevision: 1 | 2;
}

export type TranslationSyncState = Readonly<{
  etag: string;
  manifest: TranslationExportManifest;
}>;

export type TranslationSyncRequest = Readonly<{
  authorityScopeId: string;
  sourceVersionId: string;
  targetLocale: string;
  targetVariant?: string;
  previous?: TranslationSyncState;
}>;

export type VerifiedTranslationPack = Readonly<{
  packId: string;
  bytes: Uint8Array;
}>;

export type TranslationSyncResult = Readonly<{
  status: "not_modified" | "updated";
  etag: string;
  manifest: TranslationExportManifest;
  reusedPackIds: readonly string[];
  downloadedPackIds: readonly string[];
  packs: readonly VerifiedTranslationPack[];
}>;

export type TranslationExportClientOptions = Readonly<{
  transport: TranslationExportTransportPort;
  endpoint: TranslationExportEndpoint;
  store: ScopeAwarePackStore;
  downloader: PackDownloadPort;
  verifier: PackVerificationPort;
  manifestVerifier?: TranslationManifestVerificationPort;
  developmentDownloadOrigin?: string;
  maxCompressedPackBytes?: number;
  now?: () => number;
}>;
