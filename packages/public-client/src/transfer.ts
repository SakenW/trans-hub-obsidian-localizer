import {
  computeTransportDigest,
  type PublicArtifactManifest,
  type PublicDownloadTicket,
  type PublicUploadGrant,
  type PublicUploadProviderGrant,
  parsePublicArtifactManifest,
  parsePublicDownloadTicket,
  parsePublicUploadGrant,
} from "@trans-hub/client-protocol";

import { normalizeError, protocolBoundary, publicClientError } from "./errors.js";
import { transferRequest } from "./http.js";
import type {
  ClockPort,
  DigestPort,
  DownloadTransaction,
  PublicHttpTransportPort,
  PublicProviderUploadPort,
  RandomNoncePort,
  ReopenableByteSource,
  ServerKeyVerifierPort,
  StreamingDigestPort,
  TransactionalDownloadSink,
} from "./ports.js";
import { DEFAULT_RETRY_POLICY, type RetryPolicy, validateRetryPolicy, withRetry } from "./retry.js";
import {
  assertDigestScope,
  assertManifestTicketScope,
  assertNotExpired,
  verifyServerDocument,
} from "./verification.js";

export interface PublicTransferPorts {
  readonly transport: PublicHttpTransportPort;
  readonly serverVerifier: ServerKeyVerifierPort;
  readonly digest: DigestPort;
  readonly streamingDigest: StreamingDigestPort;
  readonly clock: ClockPort;
  readonly random: RandomNoncePort;
  readonly providerUpload?: PublicProviderUploadPort;
}

export interface PublicTransferOptions {
  readonly retry?: RetryPolicy;
  readonly maximumClockSkewMs?: number;
}

export interface UploadComponentInput {
  readonly grant: PublicUploadGrant;
  readonly source: ReopenableByteSource;
  readonly expected: {
    readonly installationId: string;
    readonly contributionId: string;
    readonly credentialEpoch: number;
    readonly manifestRootDigest: PublicUploadGrant["scope"]["manifestRootDigest"];
    readonly componentRole: string;
    readonly componentName: string;
    readonly transportDigest: PublicUploadGrant["scope"]["transportDigest"];
    readonly contentLength: number;
    readonly mediaType: string;
  };
  readonly signal?: AbortSignal;
}

export interface DownloadComponentInput {
  readonly manifest: PublicArtifactManifest;
  readonly ticket: PublicDownloadTicket;
  readonly componentName: string;
  readonly expectedCredentialEpoch: number;
  readonly sink: TransactionalDownloadSink;
  readonly signal?: AbortSignal;
}

export class PublicTransferClient {
  private readonly retry: RetryPolicy;
  private readonly maximumClockSkewMs: number;

  constructor(
    private readonly ports: PublicTransferPorts,
    options: PublicTransferOptions = {}
  ) {
    this.retry = validateRetryPolicy(options.retry ?? DEFAULT_RETRY_POLICY);
    this.maximumClockSkewMs = options.maximumClockSkewMs ?? 30_000;
    if (
      !Number.isFinite(this.maximumClockSkewMs) ||
      this.maximumClockSkewMs < 0 ||
      this.maximumClockSkewMs > 300_000
    ) {
      throw publicClientError("PC_CONFIGURATION", "Clock skew is outside the supported bounds", {
        operation: "configure",
      });
    }
  }

  async uploadComponent(input: UploadComponentInput): Promise<void> {
    const grant = protocolBoundary("upload-component", () => parsePublicUploadGrant(input.grant));
    const checkedInput: UploadComponentInput = { ...input, grant };
    await this.verify(grant, input.signal);
    this.assertUploadScope(checkedInput);
    if (grant.upload.kind === "provider_grant") {
      await this.providerUpload(checkedInput, grant.upload);
      return;
    }
    const upload = grant.upload;
    await withRetry({
      operation: "upload-component",
      retryableOperation: true,
      policy: this.retry,
      clock: this.ports.clock,
      random: this.ports.random,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      run: async () => {
        assertNotExpired(
          grant.expiresAt,
          this.ports.clock,
          this.maximumClockSkewMs,
          "upload-component"
        );
        let transferred = 0;
        let sourceCompleted = false;
        const digestStream = new RendezvousByteStream();
        const digestPromise = computeTransportDigest(digestStream, this.ports.streamingDigest);
        const body = (async function* () {
          yield* checkedChunks(sourceChunks(input.source), async (length, chunk) => {
            transferred += length;
            if (transferred > grant.scope.contentLength) {
              throw publicClientError("PC_LENGTH_MISMATCH", "Upload source exceeds grant length", {
                operation: "upload-component",
              });
            }
            await digestStream.push(chunk);
          });
          sourceCompleted = true;
        })();
        try {
          await transferRequest(
            this.ports.transport,
            {
              method: "PUT",
              url: upload.url,
              headers: upload.requiredHeaders,
              body,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            },
            "upload-component"
          );
          if (!sourceCompleted) {
            throw publicClientError(
              "PC_TRANSPORT",
              "Upload transport returned before consuming the complete source",
              { operation: "upload-component" }
            );
          }
          digestStream.close();
        } catch (error) {
          digestStream.fail(error);
          await digestPromise.catch(() => undefined);
          throw error;
        }
        const actualDigest = await digestPromise;
        if (transferred !== grant.scope.contentLength) {
          throw publicClientError("PC_LENGTH_MISMATCH", "Uploaded source length changed", {
            operation: "upload-component",
          });
        }
        assertDigestScope(actualDigest, grant.scope.transportDigest, "upload-component");
      },
    });
  }

  private async providerUpload(
    input: UploadComponentInput,
    upload: PublicUploadProviderGrant
  ): Promise<void> {
    const providerUpload = this.ports.providerUpload;
    if (providerUpload === undefined) {
      throw publicClientError(
        "PC_CONFIGURATION",
        "Provider upload grants require an explicit native provider upload port",
        { operation: "upload-component" }
      );
    }
    await withRetry({
      operation: "upload-component",
      retryableOperation: true,
      policy: this.retry,
      clock: this.ports.clock,
      random: this.ports.random,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      run: async () => {
        assertNotExpired(
          input.grant.expiresAt,
          this.ports.clock,
          this.maximumClockSkewMs,
          "upload-component"
        );
        try {
          await providerUpload.upload({
            providerGrant: upload.providerGrant,
            nativeCapability: upload.nativeCapability,
            source: input.source,
            expected: {
              transportDigest: input.grant.scope.transportDigest,
              contentLength: input.grant.scope.contentLength,
              mediaType: input.grant.scope.mediaType,
            },
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          });
        } catch (error) {
          throw normalizeError(error, "upload-component");
        }
      },
    });
  }

  async downloadComponent(input: DownloadComponentInput): Promise<void> {
    const manifest = protocolBoundary("download-component", () =>
      parsePublicArtifactManifest(input.manifest)
    );
    const ticket = protocolBoundary("download-component", () =>
      parsePublicDownloadTicket(input.ticket)
    );
    const checkedInput: DownloadComponentInput = { ...input, manifest, ticket };
    await this.verify(manifest, input.signal);
    await this.verify(ticket, input.signal);
    assertManifestTicketScope(manifest, ticket, input.componentName);
    if (ticket.credentialEpoch !== input.expectedCredentialEpoch) {
      throw publicClientError("PC_SCOPE_MISMATCH", "Download ticket epoch does not match", {
        operation: "download-component",
      });
    }
    await withRetry({
      operation: "download-component",
      retryableOperation: true,
      policy: this.retry,
      clock: this.ports.clock,
      random: this.ports.random,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      run: () => this.downloadAttempt(checkedInput),
    });
  }

  private async downloadAttempt(input: DownloadComponentInput): Promise<void> {
    assertNotExpired(
      input.ticket.expiresAt,
      this.ports.clock,
      this.maximumClockSkewMs,
      "download-component"
    );
    let transaction: DownloadTransaction;
    try {
      transaction = await input.sink.begin();
    } catch (error) {
      throw publicClientError(
        "PC_SINK",
        "Download transaction could not begin",
        { operation: "download-component" },
        { cause: error }
      );
    }
    try {
      const response = await transferRequest(
        this.ports.transport,
        {
          method: "GET",
          url: input.ticket.downloadUrl,
          headers: {},
          body: null,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        "download-component"
      );
      if (response.body === null) {
        throw publicClientError("PC_TRANSPORT", "Download response has no streaming body", {
          operation: "download-component",
        });
      }
      let received = 0;
      const verifiedStream = checkedChunks(response.body, async (length, chunk) => {
        received += length;
        if (received > input.ticket.contentLength) {
          throw publicClientError("PC_LENGTH_MISMATCH", "Download exceeds the ticket length", {
            operation: "download-component",
          });
        }
        try {
          await transaction.write(chunk);
        } catch (error) {
          throw publicClientError(
            "PC_SINK",
            "Download sink write failed",
            { operation: "download-component" },
            { cause: error }
          );
        }
      });
      const digest = await computeTransportDigest(verifiedStream, this.ports.streamingDigest);
      if (received !== input.ticket.contentLength) {
        throw publicClientError("PC_LENGTH_MISMATCH", "Download length does not match the ticket", {
          operation: "download-component",
        });
      }
      assertDigestScope(digest, input.ticket.transportDigest, "download-component");
      try {
        await transaction.commit();
      } catch (error) {
        throw publicClientError(
          "PC_SINK",
          "Download commit failed",
          { operation: "download-component" },
          { cause: error }
        );
      }
    } catch (error) {
      try {
        await transaction.rollback(error);
      } catch (rollbackError) {
        throw publicClientError(
          "PC_SINK",
          "Download rollback failed",
          { operation: "download-component" },
          { cause: rollbackError }
        );
      }
      throw normalizeError(error, "download-component");
    }
  }

  private assertUploadScope(input: UploadComponentInput): void {
    const { grant, expected } = input;
    if (
      grant.installationId !== expected.installationId ||
      grant.contributionId !== expected.contributionId ||
      grant.credentialEpoch !== expected.credentialEpoch ||
      grant.scope.componentRole !== expected.componentRole ||
      grant.scope.componentName !== expected.componentName ||
      grant.scope.contentLength !== expected.contentLength ||
      grant.scope.mediaType !== expected.mediaType
    ) {
      throw publicClientError("PC_SCOPE_MISMATCH", "Upload grant scope does not match", {
        operation: "upload-component",
      });
    }
    assertDigestScope(
      grant.scope.manifestRootDigest,
      expected.manifestRootDigest,
      "upload-component"
    );
    assertDigestScope(grant.scope.transportDigest, expected.transportDigest, "upload-component");
  }

  private verify(
    document: PublicUploadGrant | PublicDownloadTicket | PublicArtifactManifest,
    signal?: AbortSignal
  ): Promise<void> {
    return verifyServerDocument(document, {
      digest: this.ports.digest,
      verifier: this.ports.serverVerifier,
      clock: this.ports.clock,
      maximumClockSkewMs: this.maximumClockSkewMs,
      ...(signal === undefined ? {} : { signal }),
    });
  }
}

class RendezvousByteStream implements AsyncIterable<Uint8Array> {
  private slot: { readonly chunk: Uint8Array; readonly consumed: () => void } | null = null;
  private waiting: (() => void) | null = null;
  private terminal: { readonly error: unknown } | null = null;

  async push(chunk: Uint8Array): Promise<void> {
    if (this.terminal !== null || this.slot !== null) {
      throw publicClientError("PC_SOURCE", "Upload digest stream is not writable", {
        operation: "upload-component",
      });
    }
    await new Promise<void>((resolve) => {
      this.slot = { chunk, consumed: resolve };
      this.wake();
    });
  }

  close(): void {
    this.terminal = { error: null };
    this.wake();
  }

  fail(error: unknown): void {
    this.terminal = { error };
    this.slot?.consumed();
    this.slot = null;
    this.wake();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    while (true) {
      if (this.slot !== null) {
        const current = this.slot;
        this.slot = null;
        current.consumed();
        yield current.chunk;
        continue;
      }
      if (this.terminal !== null) {
        if (this.terminal.error !== null) {
          throw normalizeError(this.terminal.error, "upload-component");
        }
        return;
      }
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
    }
  }

  private wake(): void {
    this.waiting?.();
    this.waiting = null;
  }
}

async function* sourceChunks(source: ReopenableByteSource): AsyncGenerator<Uint8Array> {
  try {
    yield* source.open();
  } catch (error) {
    throw publicClientError(
      "PC_SOURCE",
      "Upload source could not be read",
      { operation: "upload-component" },
      { cause: error }
    );
  }
}

async function* checkedChunks(
  chunks: AsyncIterable<Uint8Array>,
  inspect: (length: number, chunk: Uint8Array) => void | Promise<void>
): AsyncGenerator<Uint8Array> {
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) {
      throw publicClientError("PC_SOURCE", "Byte stream yielded a non-Uint8Array chunk", {
        operation: "byte-stream",
      });
    }
    await inspect(chunk.byteLength, chunk);
    yield chunk;
  }
}
