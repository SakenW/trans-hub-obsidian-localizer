import type {
  DownloadAccessMode,
  DownloadTicket,
  ExportScope,
  HttpResponse,
  LocalPackKey,
  TranslationExportClientOptions,
  TranslationExportManifest,
  TranslationPackRef,
  TranslationSyncRequest,
  TranslationSyncResult,
  TranslationSyncState,
  VerifiedTranslationPack,
} from "./contracts";
import { parseTranslationExportManifest } from "./manifest";
import { assertSafeDownloadUrl } from "./fetch-downloader";

type ManifestWireResponse = Record<string, unknown>;
type TicketWire = Readonly<{
  pack_id: unknown;
  object_version: unknown;
  url: unknown;
  expires_at_epoch_ms: unknown;
  access_mode?: unknown;
  cache_mode?: unknown;
}>;

export class TranslationExportClient {
  private readonly now: () => number;
  private readonly maxCompressedPackBytes: number;

  constructor(private readonly options: TranslationExportClientOptions) {
    this.now = options.now ?? Date.now;
    this.maxCompressedPackBytes =
      options.maxCompressedPackBytes ?? 16 * 1024 * 1024;
    if (
      !Number.isSafeInteger(this.maxCompressedPackBytes) ||
      this.maxCompressedPackBytes <= 0
    ) {
      throw new TypeError("translation_pack_compressed_limit_invalid");
    }
    if (
      options.endpoint.manifestRevision === 2 &&
      options.manifestVerifier === undefined
    ) {
      throw new TypeError("translation_manifest_verifier_required");
    }
  }

  async sync(request: TranslationSyncRequest): Promise<TranslationSyncResult> {
    assertRequest(request);
    const response = await this.fetchManifest(request);
    if (response.status === 404 || response.status === 410) {
      await this.removeUnavailablePacks(request.previous?.manifest);
      throw new Error(`translation_manifest_unavailable:${response.status}`);
    }
    const resolved = await this.resolveManifest(response, request.previous);
    this.assertManifestRequest(resolved.manifest, request);

    const scopeKey = scopeCacheKey(resolved.manifest.scope);
    const reusedPackIds: string[] = [];
    const missing: TranslationPackRef[] = [];
    const packBytes = new Map<string, Uint8Array>();
    for (const pack of resolved.manifest.packs) {
      const key = packKey(scopeKey, pack);
      const bytes = await this.options.store.getVerified(key);
      if (bytes === undefined) {
        missing.push(pack);
        continue;
      }
      try {
        const canonicalBytes = await this.options.verifier.verify({
          bytes,
          pack,
        });
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
      this.assertTicket(ticket, pack, resolved.manifest.scope);
      assertSafeDownloadUrl(ticket.url, this.options.developmentDownloadOrigin);
      const bytes = await this.options.downloader.download({
        url: ticket.url,
        objectVersion: ticket.objectVersion,
        expectedBytes: pack.compressedBytes,
      });
      if (bytes.byteLength !== pack.compressedBytes) {
        throw new Error(
          `translation_pack_download_size_mismatch:${pack.packId}`,
        );
      }
      const canonicalBytes = await this.options.verifier.verify({
        bytes,
        pack,
      });
      await this.options.store.putVerified(packKey(scopeKey, pack), bytes);
      packBytes.set(pack.packId, canonicalBytes);
      downloadedPackIds.push(pack.packId);
    }

    const packs: VerifiedTranslationPack[] = resolved.manifest.packs.map(
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

  private async removeUnavailablePacks(
    manifest: TranslationExportManifest | undefined,
  ): Promise<void> {
    if (
      manifest === undefined ||
      this.options.store.removeVerified === undefined
    )
      return;
    const scopeKey = scopeCacheKey(manifest.scope);
    await Promise.all(
      manifest.packs.map((pack) =>
        this.options.store.removeVerified?.(packKey(scopeKey, pack)),
      ),
    );
  }

  private fetchManifest(
    request: TranslationSyncRequest,
  ): Promise<HttpResponse<ManifestWireResponse>> {
    const previous = request.previous;
    return this.options.transport.send<ManifestWireResponse>({
      method: "GET",
      path: this.options.endpoint.manifestPath(request),
      headers: {
        ...this.options.endpoint.authorizationHeaders(),
        ...(this.canRevalidate(previous)
          ? { "If-None-Match": previous.etag }
          : {}),
      },
    });
  }

  private async resolveManifest(
    response: HttpResponse<ManifestWireResponse>,
    previous: TranslationSyncRequest["previous"],
  ): Promise<
    Readonly<{
      status: TranslationSyncResult["status"];
      etag: string;
      manifest: TranslationExportManifest;
    }>
  > {
    if (response.status === 304) {
      if (previous === undefined)
        throw new Error("translation_manifest_304_without_local_state");
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
    const manifest = parseTranslationExportManifest(response.body);
    if (manifest.revision !== this.options.endpoint.manifestRevision) {
      throw new Error("translation_manifest_revision_downgrade");
    }
    await this.verifyManifest(manifest);
    assertGenerationTransition(previous?.manifest, manifest);
    return { status: "updated", etag, manifest };
  }

  private canRevalidate(
    previous: TranslationSyncRequest["previous"],
  ): previous is TranslationSyncState {
    if (previous === undefined) return false;
    if (previous.manifest.revision !== 2) return true;
    return Date.parse(previous.manifest.serverProof.expiresAt) > this.now();
  }

  private async verifyManifest(
    manifest: TranslationExportManifest,
  ): Promise<void> {
    if (manifest.revision === 1) return;
    const verifier = this.options.manifestVerifier;
    if (verifier === undefined)
      throw new Error("translation_manifest_verifier_required");
    await verifier.verify(manifest);
  }

  private async fetchTickets(
    request: TranslationSyncRequest,
    manifest: TranslationExportManifest,
    packs: readonly TranslationPackRef[],
  ): Promise<Map<string, DownloadTicket>> {
    if (packs.length === 0) return new Map();
    const response = await this.options.transport.send<
      { tickets: TicketWire[] },
      { manifest_id: string; pack_ids: string[] }
    >({
      method: "POST",
      path: this.options.endpoint.downloadTicketsPath(request),
      headers: this.options.endpoint.authorizationHeaders(),
      body: {
        manifest_id: manifest.manifestId,
        pack_ids: packs.map((pack) => pack.packId),
      },
    });
    if (response.status !== 200)
      throw new Error(`translation_ticket_failed:${response.status}`);
    if (!Array.isArray(response.body.tickets)) {
      throw new Error("translation_ticket_response_invalid");
    }
    const requested = new Set(packs.map((pack) => pack.packId));
    const tickets = new Map(
      response.body.tickets.map((wire) => {
        const ticket = ticketFromWire(wire);
        return [ticket.packId, ticket] as const;
      }),
    );
    if (
      tickets.size !== packs.length ||
      response.body.tickets.length !== packs.length ||
      [...tickets.keys()].some((packId) => !requested.has(packId))
    ) {
      throw new Error("translation_ticket_set_mismatch");
    }
    return tickets;
  }

  private assertTicket(
    ticket: DownloadTicket,
    pack: TranslationPackRef,
    scope: ExportScope,
  ): void {
    if (ticket.objectVersion !== pack.objectVersion) {
      throw new Error(`translation_ticket_version_mismatch:${pack.packId}`);
    }
    if (scope.kind === "public") {
      const validPublic =
        ticket.accessMode === "public_immutable" &&
        ticket.expiresAtEpochMs === null;
      const validAuthenticated =
        ticket.accessMode === "authenticated_public" &&
        ticket.expiresAtEpochMs !== null;
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
      ticket.expiresAtEpochMs !== null &&
      ticket.expiresAtEpochMs <= this.now()
    ) {
      throw new Error(`translation_ticket_expired:${pack.packId}`);
    }
  }

  private assertManifestRequest(
    manifest: TranslationExportManifest,
    request: TranslationSyncRequest,
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
    if (
      manifest.packs.some(
        (pack) => pack.compressedBytes > this.maxCompressedPackBytes,
      )
    ) {
      throw new Error("translation_pack_compressed_limit_exceeded");
    }
  }
}

function ticketFromWire(wire: TicketWire): DownloadTicket {
  const expires = wire.expires_at_epoch_ms;
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

function assertRequest(request: TranslationSyncRequest): void {
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
  previous: TranslationExportManifest | undefined,
  current: TranslationExportManifest,
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

function scopeCacheKey(scope: ExportScope): string {
  return scope.kind === "public"
    ? `public:${scope.publicScopeId}`
    : `private:${scope.tenantId}:${scope.workspaceId}:${scope.encryptionDomainId}`;
}

function packKey(scopeKey: string, pack: TranslationPackRef): LocalPackKey {
  return {
    scopeKey,
    logicalObjectDigest: pack.logicalObjectDigest,
    objectVersion: pack.objectVersion,
  };
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
