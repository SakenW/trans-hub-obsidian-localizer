import type {
  AnyTranslationExportManifest,
  AnyTranslationPackRef,
  DownloadAccessMode,
  DownloadTicket,
  ExportScope,
  HttpResponse,
  LocalPackKey,
  ManifestForRevision,
  PackForRevision,
  PackVerificationPort,
  TranslationExportClientOptions,
  TranslationExportManifest,
  TranslationExportRevision,
  TranslationManifestVerificationPort,
  TranslationSyncRequest,
  TranslationSyncResult,
  TranslationSyncState,
  VerifiedTranslationPack,
} from "./contracts";
import {
  parseStoredTranslationExportManifest,
  parseTranslationExportManifest,
} from "./manifest";
import { assertSafeDownloadUrl } from "./fetch-downloader";

type ManifestWireResponse = Record<string, unknown>;
type TicketWire = Readonly<{
  pack_id: unknown;
  object_version: unknown;
  url: unknown;
  issued_at_epoch_ms?: unknown;
  expires_at_epoch_ms: unknown;
  access_mode?: unknown;
  cache_mode?: unknown;
}>;

export class TranslationExportClient<
  TRevision extends TranslationExportRevision = 1 | 2,
> {
  private readonly now: () => number;
  private readonly maxCompressedPackBytes: number;
  private readonly maxContentBytes: number;
  private readonly maxTotalContentBytes: number;
  private readonly maxTicketBatchSize: number;

  constructor(
    private readonly options: TranslationExportClientOptions<TRevision>,
  ) {
    this.now = options.now ?? Date.now;
    this.maxCompressedPackBytes =
      options.maxCompressedPackBytes ?? 16 * 1024 * 1024;
    if (
      !Number.isSafeInteger(this.maxCompressedPackBytes) ||
      this.maxCompressedPackBytes <= 0
    ) {
      throw new TypeError("translation_pack_compressed_limit_invalid");
    }
    this.maxContentBytes = options.maxContentBytes ?? 16 * 1024 * 1024;
    if (
      !Number.isSafeInteger(this.maxContentBytes) ||
      this.maxContentBytes <= 0
    ) {
      throw new TypeError("translation_pack_content_limit_invalid");
    }
    this.maxTotalContentBytes = options.maxTotalContentBytes ?? 64 * 1024 * 1024;
    if (
      !Number.isSafeInteger(this.maxTotalContentBytes) ||
      this.maxTotalContentBytes <= 0
    ) {
      throw new TypeError("translation_pack_total_content_limit_invalid");
    }
    this.maxTicketBatchSize = options.maxTicketBatchSize ?? 32;
    if (
      !Number.isSafeInteger(this.maxTicketBatchSize) ||
      this.maxTicketBatchSize <= 0
    ) {
      throw new TypeError("translation_ticket_batch_size_invalid");
    }
    if (
      options.endpoint.manifestRevision !== 1 &&
      options.manifestVerifier === undefined
    ) {
      throw new TypeError("translation_manifest_verifier_required");
    }
  }

  async sync(
    request: TranslationSyncRequest<ManifestForRevision<TRevision>>,
  ): Promise<TranslationSyncResult<ManifestForRevision<TRevision>>> {
    assertRequest(request);
    const previous = await this.validPrevious(request.previous);
    const normalizedRequest =
      previous.cache === undefined
        ? { ...request, previous: undefined }
        : { ...request, previous: previous.cache };
    const response = await this.fetchManifest(normalizedRequest);
    if (response.status === 404 || response.status === 410) {
      await this.removeUnavailablePacks(previous.history?.manifest);
      throw new Error(`translation_manifest_unavailable:${response.status}`);
    }
    const resolved = await this.resolveManifest(
      response,
      previous.cache,
      previous.history,
    );
    this.assertManifestRequest(resolved.manifest, normalizedRequest);

    const scopeKey = scopeCacheKey(resolved.manifest.scope);
    const reusedPackIds: string[] = [];
    const missing: PackForRevision<TRevision>[] = [];
    const packBytes = new Map<string, Uint8Array>();
    for (const pack of resolved.manifest.packs as readonly PackForRevision<TRevision>[]) {
      const key = packKey(scopeKey, pack);
      const bytes = await this.options.store.getVerified(key);
      if (bytes === undefined) {
        missing.push(pack);
        continue;
      }
      try {
        const canonicalBytes = await this.verifyPack(bytes, pack);
        reusedPackIds.push(pack.packId);
        packBytes.set(pack.packId, canonicalBytes);
      } catch {
        await this.options.store.removeVerified?.(key);
        missing.push(pack);
      }
    }

    const tickets = await this.fetchTickets(
      request,
      resolved.manifest,
      missing,
    );
    const downloadedPackIds: string[] = [];
    for (const pack of missing) {
      const ticket = tickets.get(pack.packId);
      if (ticket === undefined)
        throw new Error(`translation_ticket_missing:${pack.packId}`);
      const allowedOrigin = this.allowedDownloadOrigin(resolved.manifest);
      this.assertTicket(ticket, pack, resolved.manifest);
      assertSafeDownloadUrl(
        ticket.url,
        allowedOrigin,
        this.options.developmentDownloadOrigin,
      );
      const bytes = await this.options.downloader.download({
        url: ticket.url,
        objectVersion: ticket.objectVersion,
        expectedBytes: packSizeBytes(pack),
        allowedOrigin,
      });
      if (bytes.byteLength !== packSizeBytes(pack)) {
        throw new Error(
          `translation_pack_download_size_mismatch:${pack.packId}`,
        );
      }
      const canonicalBytes = await this.verifyPack(bytes, pack);
      // A verified pack is immutable cache evidence, not the active
      // translation state. Persist it immediately so a later pack's failure
      // only retries that later pack; callers still receive no new manifest
      // state until every pack has been verified.
      await this.options.store.putVerified(packKey(scopeKey, pack), bytes);
      packBytes.set(pack.packId, canonicalBytes);
      downloadedPackIds.push(pack.packId);
    }

    const packs: VerifiedTranslationPack[] = (
      resolved.manifest.packs as readonly PackForRevision<TRevision>[]
    ).map(
      (pack) => {
        const bytes = packBytes.get(pack.packId);
        if (bytes === undefined)
          throw new Error(`translation_verified_pack_missing:${pack.packId}`);
        return { packId: pack.packId, bytes };
      },
    );
    return {
      status: resolved.status,
      etag: resolved.etag,
      manifest: resolved.manifest,
      reusedPackIds,
      downloadedPackIds,
      packs,
    };
  }

  private async validPrevious(
    previous: TranslationSyncRequest<ManifestForRevision<TRevision>>["previous"],
  ): Promise<Readonly<{
    cache?: TranslationSyncState<ManifestForRevision<TRevision>>;
    history?: TranslationSyncState<ManifestForRevision<TRevision>>;
  }>> {
    if (previous === undefined) return {};
    try {
      const etag = requiredString(
        previous.etag,
        "translation_manifest_etag_invalid",
      );
      const manifest = parseStoredForRevision(
        previous.manifest,
        this.options.endpoint.manifestRevision,
      );
      if (etag !== manifestEtag(manifest)) return {};
      const state = { etag, manifest };
      try {
        await this.verifyManifest(manifest);
        return { cache: state, history: state };
      } catch {
        await this.verifyHistoricalManifest(manifest);
        return { history: state };
      }
    } catch {
      // Corrupt or unauthenticated persisted state is neither a cache hint nor
      // a rollback floor. An expired but authentic proof is retained above as
      // history while still being excluded from HTTP/cache reuse.
      return {};
    }
  }

  private async removeUnavailablePacks(
    manifest: ManifestForRevision<TRevision> | undefined,
  ): Promise<void> {
    if (
      manifest === undefined ||
      this.options.store.removeVerified === undefined
    )
      return;
    const scopeKey = scopeCacheKey(manifest.scope);
    await Promise.all(
      manifest.packs.map(async (pack) =>
        this.options.store.removeVerified?.(packKey(scopeKey, pack)),
      ),
    );
  }

  private fetchManifest(
    request: TranslationSyncRequest<ManifestForRevision<TRevision>>,
  ): Promise<HttpResponse<ManifestWireResponse>> {
    const previous = request.previous;
    return this.options.transport.send<ManifestWireResponse>({
      method: "GET",
      path: this.options.endpoint.manifestPath(request),
      headers: {
        ...this.options.endpoint.authorizationHeaders(),
        // Embedded HTTP caches can replay a wire response after the server-side
        // signing representation changes while the immutable translation
        // generation (and therefore its ETag) stays the same. Force a
        // revalidation so signed manifests always come from current authority.
        "Cache-Control": "no-cache",
        ...(this.canRevalidate(previous)
          ? { "If-None-Match": previous.etag }
          : {}),
      },
    });
  }

  private async resolveManifest(
    response: HttpResponse<ManifestWireResponse>,
    previous: TranslationSyncRequest<ManifestForRevision<TRevision>>["previous"],
    history: TranslationSyncRequest<ManifestForRevision<TRevision>>["previous"],
  ): Promise<
    Readonly<{
      status: TranslationSyncResult<ManifestForRevision<TRevision>>["status"];
      etag: string;
      manifest: ManifestForRevision<TRevision>;
    }>
  > {
    if (response.status === 304) {
      if (previous === undefined)
        throw new Error("translation_manifest_304_without_local_state");
      const responseEtag = header(response.headers, "etag");
      if (responseEtag !== previous.etag) {
        throw new Error("translation_manifest_304_etag_mismatch");
      }
      await this.verifyManifest(previous.manifest);
      return {
        status: "not_modified",
        etag: previous.etag,
        manifest: previous.manifest,
      };
    }
    if (response.status !== 200)
      throw new Error(`translation_manifest_failed:${response.status}`);
    const etag = header(response.headers, "etag");
    if (etag === undefined || etag === "")
      throw new Error("translation_manifest_missing_etag");
    if (response.body.revision !== this.options.endpoint.manifestRevision) {
      throw new Error("translation_manifest_revision_downgrade");
    }
    const manifest = parseForRevision(
      response.body,
      this.options.endpoint.manifestRevision,
    );
    if (etag !== manifestEtag(manifest)) {
      throw new Error("translation_manifest_etag_mismatch");
    }
    await this.verifyManifest(manifest);
    assertGenerationTransition(history?.manifest, manifest);
    return { status: "updated", etag, manifest };
  }

  private canRevalidate(
    previous: TranslationSyncRequest<ManifestForRevision<TRevision>>["previous"],
  ): previous is TranslationSyncState<ManifestForRevision<TRevision>> {
    if (previous === undefined) return false;
    if (previous.manifest.revision === 1) return true;
    return Date.parse(previous.manifest.serverProof.expiresAt) > this.now();
  }

  private async verifyManifest(
    manifest: ManifestForRevision<TRevision>,
  ): Promise<void> {
    if (manifest.revision === 1) return;
    const verifier = this.options.manifestVerifier;
    if (verifier === undefined)
      throw new Error("translation_manifest_verifier_required");
    await (
      verifier as TranslationManifestVerificationPort<
        | (TranslationExportManifest & Readonly<{ revision: 2 }>)
        | import("./contracts").CanonicalJsonTranslationExportManifest
      >
    ).verify(manifest);
  }

  private async verifyHistoricalManifest(
    manifest: ManifestForRevision<TRevision>,
  ): Promise<void> {
    if (manifest.revision === 1) return;
    const verifier = this.options.manifestVerifier;
    if (verifier?.verifyHistorical === undefined) {
      throw new Error("translation_manifest_historical_verifier_required");
    }
    await (verifier as TranslationManifestVerificationPort<
      | (TranslationExportManifest & Readonly<{ revision: 2 }>)
      | import("./contracts").CanonicalJsonTranslationExportManifest
    >).verifyHistorical?.(
      manifest,
    );
  }

  private verifyPack(
    bytes: Uint8Array,
    pack: PackForRevision<TRevision>,
  ): Promise<Uint8Array> {
    return (
      this.options.verifier as PackVerificationPort<AnyTranslationPackRef>
    ).verify({ bytes, pack });
  }

  private allowedDownloadOrigin(
    manifest: ManifestForRevision<TRevision>,
  ): string {
    if (manifest.revision === 1) {
      throw new Error("translation_manifest_cdn_origin_required");
    }
    return manifest.cdnOrigin;
  }

  private async fetchTickets(
    request: TranslationSyncRequest<ManifestForRevision<TRevision>>,
    manifest: ManifestForRevision<TRevision>,
    packs: readonly PackForRevision<TRevision>[],
  ): Promise<Map<string, DownloadTicket>> {
    if (packs.length === 0) return new Map();
    const tickets = new Map<string, DownloadTicket>();
    for (const requestedPacks of chunked(packs, this.maxTicketBatchSize)) {
      const response = await this.options.transport.send<
        { tickets: TicketWire[] },
        { manifest_id: string; pack_ids: string[] }
      >({
        method: "POST",
        path: this.options.endpoint.downloadTicketsPath(request),
        headers: this.options.endpoint.authorizationHeaders(),
        body: {
          manifest_id: manifest.manifestId,
          pack_ids: requestedPacks.map((pack) => pack.packId),
        },
      });
      if (response.status !== 200)
        throw new Error(`translation_ticket_failed:${response.status}`);
      if (!Array.isArray(response.body.tickets)) {
        throw new Error("translation_ticket_response_invalid");
      }
      const requested = new Set(requestedPacks.map((pack) => pack.packId));
      const batchTickets = new Map(
        response.body.tickets.map((wire) => {
          const ticket = ticketFromWire(wire);
          return [ticket.packId, ticket] as const;
        }),
      );
      if (
        batchTickets.size !== requestedPacks.length ||
        response.body.tickets.length !== requestedPacks.length ||
        [...batchTickets.keys()].some((packId) => !requested.has(packId))
      ) {
        throw new Error("translation_ticket_set_mismatch");
      }
      for (const [packId, ticket] of batchTickets) tickets.set(packId, ticket);
    }
    return tickets;
  }

  private assertTicket(
    ticket: DownloadTicket,
    pack: AnyTranslationPackRef,
    manifest: AnyTranslationExportManifest,
  ): void {
    if (ticket.objectVersion !== pack.objectVersion) {
      throw new Error(`translation_ticket_version_mismatch:${pack.packId}`);
    }
    const scope = manifest.scope;
    if (scope.kind === "public") {
      const requiresShortLivedAuthenticatedTicket = manifest.revision === 3;
      const validPublic =
        !requiresShortLivedAuthenticatedTicket &&
        ticket.accessMode === "public_immutable" &&
        ticket.issuedAtEpochMs === null &&
        ticket.expiresAtEpochMs === null;
      const validAuthenticated =
        ticket.accessMode === "authenticated_public" &&
        ticket.expiresAtEpochMs !== null &&
        (!requiresShortLivedAuthenticatedTicket || ticket.issuedAtEpochMs !== null);
      if (!validPublic && !validAuthenticated) {
        throw new Error(`translation_public_ticket_invalid:${pack.packId}`);
      }
    } else if (
      ticket.accessMode !== "private_authorized" ||
      ticket.expiresAtEpochMs === null
    ) {
      throw new Error(`translation_private_ticket_invalid:${pack.packId}`);
    }
    if (
      manifest.revision === 3 &&
      ticket.accessMode === "authenticated_public" &&
      ticket.issuedAtEpochMs !== null &&
      ticket.expiresAtEpochMs !== null &&
      ticket.expiresAtEpochMs - ticket.issuedAtEpochMs !== 300_000
    ) {
      throw new Error(`translation_public_ticket_window_invalid:${pack.packId}`);
    }
    if (
      ticket.issuedAtEpochMs !== null &&
      ticket.issuedAtEpochMs > this.now()
    ) {
      throw new Error(`translation_ticket_not_yet_valid:${pack.packId}`);
    }
    if (
      ticket.expiresAtEpochMs !== null &&
      ticket.expiresAtEpochMs <= this.now()
    ) {
      throw new Error(`translation_ticket_expired:${pack.packId}`);
    }
  }

  private assertManifestRequest(
    manifest: ManifestForRevision<TRevision>,
    request: TranslationSyncRequest<ManifestForRevision<TRevision>>,
  ): void {
    if (
      manifest.sourceVersionId !== request.sourceVersionId ||
      manifest.targetLocale !== request.targetLocale ||
      manifest.targetVariant !== (request.targetVariant ?? "default")
    ) {
      throw new Error("translation_manifest_request_mismatch");
    }
    if (manifest.scope.kind === "public") {
      if (manifest.scope.publicScopeId !== request.authorityScopeId) {
        throw new Error("translation_public_manifest_scope_mismatch");
      }
    } else if (manifest.scope.workspaceId !== request.authorityScopeId) {
      throw new Error("translation_private_manifest_scope_mismatch");
    }
    if (manifest.revision === 3) {
      if (
        manifest.packs.some(
          (pack) => pack.contentSizeBytes > this.maxContentBytes,
        )
      ) {
        throw new Error("translation_pack_content_limit_exceeded");
      }
    } else if (
      manifest.packs.some(
        (pack) => pack.compressedBytes > this.maxCompressedPackBytes,
      )
    ) {
      throw new Error("translation_pack_compressed_limit_exceeded");
    }
    const totalContentBytes = manifest.packs.reduce(
      (total, pack) => total + packSizeBytes(pack),
      0,
    );
    if (!Number.isSafeInteger(totalContentBytes) || totalContentBytes > this.maxTotalContentBytes) {
      throw new Error("translation_pack_total_content_limit_exceeded");
    }
  }
}

function chunked<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function manifestEtag(manifest: AnyTranslationExportManifest): string {
  return `"${manifest.manifestDigest}"`;
}

function ticketFromWire(wire: TicketWire): DownloadTicket {
  const issued = wire.issued_at_epoch_ms ?? null;
  const expires = wire.expires_at_epoch_ms;
  if (
    issued !== null &&
    (!Number.isSafeInteger(issued) || Number(issued) <= 0)
  ) {
    throw new Error("translation_ticket_issued_at_invalid");
  }
  if (
    expires !== null &&
    (!Number.isSafeInteger(expires) || Number(expires) <= 0)
  ) {
    throw new Error("translation_ticket_expiry_invalid");
  }
  const accessMode = wire.access_mode ?? wire.cache_mode;
  if (!isAccessMode(accessMode))
    throw new Error("translation_ticket_access_mode_invalid");
  return {
    packId: requiredString(wire.pack_id, "translation_ticket_pack_invalid"),
    objectVersion: requiredString(
      wire.object_version,
      "translation_ticket_version_invalid",
    ),
    url: requiredString(wire.url, "translation_ticket_url_invalid"),
    issuedAtEpochMs: issued === null ? null : Number(issued),
    expiresAtEpochMs: expires === null ? null : Number(expires),
    accessMode,
  };
}

function isAccessMode(value: unknown): value is DownloadAccessMode {
  return (
    value === "public_immutable" ||
    value === "authenticated_public" ||
    value === "private_authorized"
  );
}

function requiredString(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    value === "" ||
    value !== value.normalize("NFC")
  ) {
    throw new Error(code);
  }
  return value;
}

function assertRequest(
  request: TranslationSyncRequest<AnyTranslationExportManifest>,
): void {
  for (const [value, code] of [
    [request.authorityScopeId, "translation_authority_scope_invalid"],
    [request.sourceVersionId, "translation_source_version_invalid"],
    [request.targetLocale, "translation_locale_invalid"],
    [request.targetVariant ?? "default", "translation_variant_invalid"],
  ] as const) {
    requiredString(value, code);
  }
}

function assertGenerationTransition(
  previous: AnyTranslationExportManifest | undefined,
  current: AnyTranslationExportManifest,
): void {
  if (previous === undefined) return;
  if (current.generationNumber < previous.generationNumber) {
    throw new Error("translation_manifest_generation_rollback");
  }
  if (
    current.generationNumber === previous.generationNumber &&
    (current.generationId !== previous.generationId ||
      current.manifestDigest !== previous.manifestDigest)
  ) {
    throw new Error("translation_manifest_generation_conflict");
  }
}

export function scopeCacheKey(scope: ExportScope): string {
  return scope.kind === "public"
    ? `public:${scope.publicScopeId}`
    : `private:${scope.tenantId}:${scope.workspaceId}:${scope.encryptionDomainId}`;
}

export function packKey(scopeKey: string, pack: AnyTranslationPackRef): LocalPackKey {
  return {
    scopeKey,
    logicalObjectDigest: pack.logicalObjectDigest,
    objectVersion: pack.objectVersion,
  };
}

export function packKeysForManifest(
  manifest: AnyTranslationExportManifest,
): readonly LocalPackKey[] {
  const scopeKey = scopeCacheKey(manifest.scope);
  return manifest.packs.map((pack) => packKey(scopeKey, pack));
}

function packSizeBytes(pack: AnyTranslationPackRef): number {
  return "contentSizeBytes" in pack
    ? pack.contentSizeBytes
    : pack.compressedBytes;
}

function parseForRevision<TRevision extends TranslationExportRevision>(
  input: unknown,
  revision: TRevision,
): ManifestForRevision<TRevision> {
  if (revision === 3) {
    return parseTranslationExportManifest(
      input,
      3,
    ) as ManifestForRevision<TRevision>;
  }
  return parseTranslationExportManifest(
    input,
    revision,
  ) as ManifestForRevision<TRevision>;
}

function parseStoredForRevision<TRevision extends TranslationExportRevision>(
  input: unknown,
  revision: TRevision,
): ManifestForRevision<TRevision> {
  if (revision === 3) {
    return parseStoredTranslationExportManifest(
      input,
      3,
    ) as ManifestForRevision<TRevision>;
  }
  return parseStoredTranslationExportManifest(
    input,
    revision,
  ) as ManifestForRevision<TRevision>;
}

function header(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  const expected = name.toLowerCase();
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === expected,
  );
  return entry?.[1];
}
