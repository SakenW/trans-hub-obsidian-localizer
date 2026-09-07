export const TRANSLATION_EXPORT_SCHEMA =
  "trans-hub.translation-export" as const;
export const TRANSLATION_EXPORT_LEGACY_REVISION = 1 as const;
export const TRANSLATION_EXPORT_REVISION = 2 as const;
export const TRANSLATION_EXPORT_CANONICAL_JSON_REVISION = 3 as const;

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

/** Revision 3 pack objects are persisted and verified as canonical JSON bytes. */
export type CanonicalJsonTranslationPackRef = Readonly<{
  packId: string;
  packIndex: number;
  itemCount: number;
  contentSizeBytes: number;
  objectVersion: string;
  contentSha256: Sha256Digest;
  logicalObjectDigest: Sha256Digest;
}>;

export type AnyTranslationPackRef =
  | TranslationPackRef
  | CanonicalJsonTranslationPackRef;

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

type TranslationExportManifestBase<TPack extends AnyTranslationPackRef> = Readonly<{
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
  packs: readonly TPack[];
}>;

/** Revision 1/2 compatibility manifest for the historical Zstd object contract. */
export type TranslationExportManifest = TranslationExportManifestBase<TranslationPackRef> &
  (
    | Readonly<{
        revision: typeof TRANSLATION_EXPORT_LEGACY_REVISION;
        serverProof?: never;
      }>
    | Readonly<{
        revision: typeof TRANSLATION_EXPORT_REVISION;
        /** Signed, exact CDN origin permitted for every data-byte request. */
        cdnOrigin: string;
        serverProof: TranslationExportServerProof;
      }>
  );

export type CanonicalJsonTranslationExportManifest =
  TranslationExportManifestBase<CanonicalJsonTranslationPackRef> &
    Readonly<{
      revision: typeof TRANSLATION_EXPORT_CANONICAL_JSON_REVISION;
      /** Signed, exact CDN origin permitted for every data-byte request. */
      cdnOrigin: string;
      serverProof: TranslationExportServerProof;
    }>;

export type AnyTranslationExportManifest =
  | TranslationExportManifest
  | CanonicalJsonTranslationExportManifest;

export type TranslationExportRevision = 1 | 2 | 3;

export type ManifestForRevision<TRevision extends TranslationExportRevision> =
  TRevision extends 3
    ? CanonicalJsonTranslationExportManifest
    : TranslationExportManifest;

export type PackForRevision<TRevision extends TranslationExportRevision> =
  TRevision extends 3
    ? CanonicalJsonTranslationPackRef
    : TranslationPackRef;

export type DownloadTicket = Readonly<{
  packId: string;
  objectVersion: string;
  url: string;
  issuedAtEpochMs: number | null;
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
  putVerifiedBatch?(entries: readonly Readonly<{
    key: LocalPackKey;
    bytes: Uint8Array;
  }>[]): Promise<void>;
  removeVerified?(key: LocalPackKey): Promise<void>;
}

export interface PackDownloadPort {
  download(
    input: Readonly<{
      url: string;
      objectVersion: string;
      expectedBytes: number;
      allowedOrigin: string;
    }>,
  ): Promise<Uint8Array>;
}

export interface PackVerificationPort<
  TPack extends AnyTranslationPackRef = TranslationPackRef,
> {
  verify(
    input: Readonly<{ bytes: Uint8Array; pack: TPack }>,
  ): Promise<Uint8Array>;
}

export interface TranslationManifestVerificationPort<
  TManifest extends
    | (TranslationExportManifest & Readonly<{ revision: 2 }>)
    | CanonicalJsonTranslationExportManifest = TranslationExportManifest &
    Readonly<{ revision: 2 }>,
> {
  verify(
    manifest: TManifest,
  ): Promise<void>;
  /** Verify signed identity while deliberately ignoring proof freshness. */
  verifyHistorical?(manifest: TManifest): Promise<void>;
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

export interface TranslationExportEndpoint<
  TRevision extends TranslationExportRevision = 1 | 2,
> {
  manifestPath(request: TranslationSyncRequest<ManifestForRevision<TRevision>>): string;
  downloadTicketsPath(request: TranslationSyncRequest<ManifestForRevision<TRevision>>): string;
  authorizationHeaders(): Readonly<Record<string, string>>;
  readonly manifestRevision: TRevision;
}

export type TranslationSyncState<
  TManifest extends AnyTranslationExportManifest = TranslationExportManifest,
> = Readonly<{
  etag: string;
  manifest: TManifest;
}>;

export type TranslationSyncRequest<
  TManifest extends AnyTranslationExportManifest = TranslationExportManifest,
> = Readonly<{
  authorityScopeId: string;
  sourceVersionId: string;
  targetLocale: string;
  targetVariant?: string;
  previous?: TranslationSyncState<TManifest>;
}>;

export type VerifiedTranslationPack = Readonly<{
  packId: string;
  bytes: Uint8Array;
}>;

export type TranslationSyncResult<
  TManifest extends AnyTranslationExportManifest = TranslationExportManifest,
> = Readonly<{
  status: "not_modified" | "updated";
  etag: string;
  manifest: TManifest;
  reusedPackIds: readonly string[];
  downloadedPackIds: readonly string[];
  packs: readonly VerifiedTranslationPack[];
}>;

export type TranslationExportClientOptions<
  TRevision extends TranslationExportRevision = 1 | 2,
> = Readonly<{
  transport: TranslationExportTransportPort;
  endpoint: TranslationExportEndpoint<TRevision>;
  store: ScopeAwarePackStore;
  downloader: PackDownloadPort;
  verifier: PackVerificationPort<PackForRevision<TRevision>>;
  manifestVerifier?: TranslationManifestVerificationPort<
    Extract<ManifestForRevision<TRevision>, { revision: 2 | 3 }>
  >;
  developmentDownloadOrigin?: string;
  maxCompressedPackBytes?: number;
  maxContentBytes?: number;
  /** Upper bound for all decoded pack bytes in one manifest application. */
  maxTotalContentBytes?: number;
  /** Bound one authenticated ticket request without changing pack authority. */
  maxTicketBatchSize?: number;
  now?: () => number;
}>;
