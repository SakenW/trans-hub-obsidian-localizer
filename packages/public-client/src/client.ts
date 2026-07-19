import {
  type BootstrapRequest,
  type BootstrapResponse,
  type ContributionSigningPayload,
  type ContributionStateReceipt,
  CURRENT_PROTOCOL_VERSION,
  computeProtocolDigest,
  contributionSigningPayload,
  type InstallationProof,
  type PublicCapability,
  type PublicUploadGrant,
  type PublicUploadGrantRequest,
  type PublicUploadGrantSigningPayload,
  parseBootstrapLinkBinding,
  parseBootstrapRequest,
  parseBootstrapResponse,
  parseContributionIntent,
  parseContributionStateReceipt,
  parsePublicUploadGrant,
  parsePublicUploadGrantRequest,
  publicUploadGrantSigningPayload,
} from "@trans-hub/client-protocol";
import type {
  BootstrapInput,
  CreateUploadGrantInput,
  PrepareBootstrapInput,
  PreparedBootstrap,
  PublicClientControl,
  PublicClientOptions,
  PublicClientPorts,
} from "./client-contracts.js";
import { normalizeError, protocolBoundary, publicClientError } from "./errors.js";
import { assertPublicCredential, CONTROL_PATHS, controlRequest } from "./http.js";
import type { InstallationRecord, PublicControlCredential } from "./ports.js";
import { DEFAULT_RETRY_POLICY, type RetryPolicy, validateRetryPolicy, withRetry } from "./retry.js";
import { assertDigestScope, assertNotExpired, verifyServerDocument } from "./verification.js";

export class PublicClient implements PublicClientControl {
  readonly ports: PublicClientPorts;
  readonly retryPolicy: RetryPolicy;
  readonly maximumClockSkewMs: number;

  constructor(ports: PublicClientPorts, options: PublicClientOptions = {}) {
    this.ports = ports;
    this.retryPolicy = validateRetryPolicy(options.retry ?? DEFAULT_RETRY_POLICY);
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

  prepareBootstrap(input: PrepareBootstrapInput): PreparedBootstrap {
    return protocolBoundary("prepare-bootstrap", () =>
      parseBootstrapLinkBinding({
        clientNonce: this.ports.random.nonce(),
        installationPublicKey: {
          algorithm: "ed25519",
          keyId: this.ports.signer.keyId,
          publicKey: this.ports.signer.publicKey,
        },
        client: input.client,
        requestedCapabilities: input.requestedCapabilities,
      })
    );
  }

  async bootstrap(input: BootstrapInput): Promise<BootstrapResponse> {
    const prepared = protocolBoundary("bootstrap", () => parseBootstrapLinkBinding(input.prepared));
    if (
      prepared.installationPublicKey.keyId !== this.ports.signer.keyId ||
      prepared.installationPublicKey.publicKey !== this.ports.signer.publicKey
    ) {
      throw publicClientError(
        "PC_SCOPE_MISMATCH",
        "Prepared Bootstrap does not match the installation signer",
        { operation: "bootstrap" }
      );
    }
    const request = protocolBoundary("bootstrap", () =>
      parseBootstrapRequest({
        kind: "bootstrap_request",
        protocol: CURRENT_PROTOCOL_VERSION,
        linkingCode: input.linkingCode,
        ...prepared,
      } satisfies BootstrapRequest)
    );
    const response = await controlRequest(
      this.ports.transport,
      {
        method: "POST",
        path: CONTROL_PATHS.bootstrap,
        headers: { "content-type": "application/json" },
        body: request,
        credential: null,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      "bootstrap"
    );
    const parsed = protocolBoundary("bootstrap", () => parseBootstrapResponse(response.body));
    if (
      parsed.clientNonce !== prepared.clientNonce ||
      parsed.installationKeyId !== this.ports.signer.keyId
    ) {
      throw publicClientError(
        "PC_SCOPE_MISMATCH",
        "Bootstrap response does not match this client",
        {
          operation: "bootstrap",
        }
      );
    }
    if (
      parsed.availableCapabilities.some(
        (capability) => !prepared.requestedCapabilities.includes(capability)
      ) ||
      parsed.intakeCredential.capabilities.some(
        (capability) => !prepared.requestedCapabilities.includes(capability)
      )
    ) {
      throw publicClientError(
        "PC_SCOPE_MISMATCH",
        "Bootstrap response exceeds requested capabilities",
        { operation: "bootstrap" }
      );
    }
    assertNotExpired(
      parsed.challengeExpiresAt,
      this.ports.clock,
      this.maximumClockSkewMs,
      "bootstrap"
    );
    this.assertCredential(parsed.intakeCredential, parsed, undefined, "bootstrap");
    await this.saveInstallation({
      bootstrap: parsed,
    });
    return parsed;
  }

  async submitContribution(
    payload: ContributionSigningPayload,
    signal?: AbortSignal
  ): Promise<ContributionStateReceipt> {
    const installation = await this.requireInstallation(
      "submit-contribution",
      "contribution:submit"
    );
    if (payload.installationId !== installation.bootstrap.installationId) {
      throw publicClientError("PC_SCOPE_MISMATCH", "Contribution installation does not match", {
        operation: "submit-contribution",
      });
    }
    assertNotExpired(
      installation.bootstrap.challengeExpiresAt,
      this.ports.clock,
      this.maximumClockSkewMs,
      "submit-contribution"
    );
    const requestDigest = await computeProtocolDigest("request", payload, this.ports.digest);
    const signingInput = {
      requestDigest,
      challenge: installation.bootstrap.serverChallenge,
      nonce: this.ports.random.nonce(),
      credentialEpoch: installation.bootstrap.intakeCredential.credentialEpoch,
    };
    let signed: { readonly signedAt: string; readonly signature: string };
    try {
      signed = await this.ports.signer.signProof(signingInput, signal);
    } catch (error) {
      const normalized = normalizeError(error, "submit-contribution");
      if (normalized.code === "PC_ABORTED") throw normalized;
      throw publicClientError(
        "PC_SIGNING_FAILED",
        "The installation signer could not sign the contribution",
        { operation: "submit-contribution" },
        { cause: error }
      );
    }
    const installationProof: InstallationProof = {
      domain: "public_contribution_intake",
      algorithm: "ed25519",
      keyId: this.ports.signer.keyId,
      ...signingInput,
      signedAt: signed.signedAt,
      signature: signed.signature,
    };
    const intent = protocolBoundary("submit-contribution", () =>
      parseContributionIntent({ ...payload, installationProof })
    );
    const response = await this.controlWithRetry({
      operation: "submit-contribution",
      path: CONTROL_PATHS.contributions,
      method: "POST",
      body: intent,
      credential: installation.bootstrap.intakeCredential,
      retryableOperation: true,
      signal,
    });
    const receipt = protocolBoundary("submit-contribution", () =>
      parseContributionStateReceipt(response.body)
    );
    if (receipt.contributionType !== intent.contributionType) {
      throw publicClientError("PC_SCOPE_MISMATCH", "Receipt contribution type does not match", {
        operation: "submit-contribution",
      });
    }
    this.assertReceiptEpoch(receipt, installation, "submit-contribution");
    const expectedDigest = await computeProtocolDigest(
      "request",
      contributionSigningPayload(intent),
      this.ports.digest
    );
    assertDigestScope(receipt.commandDigest, expectedDigest, "submit-contribution");
    return receipt;
  }

  async getContributionStatus(
    contributionId: string,
    signal?: AbortSignal
  ): Promise<ContributionStateReceipt> {
    const installation = await this.requireInstallation(
      "contribution-status",
      "contribution:read_receipt"
    );
    const response = await this.controlWithRetry({
      operation: "contribution-status",
      path: CONTROL_PATHS.contributionStatus(contributionId),
      method: "GET",
      body: null,
      credential: installation.bootstrap.intakeCredential,
      retryableOperation: true,
      signal,
    });
    const receipt = protocolBoundary("contribution-status", () =>
      parseContributionStateReceipt(response.body)
    );
    if (receipt.contributionId !== contributionId) {
      throw publicClientError("PC_SCOPE_MISMATCH", "Receipt contribution does not match", {
        operation: "contribution-status",
      });
    }
    this.assertReceiptEpoch(receipt, installation, "contribution-status");
    return receipt;
  }

  async createUploadGrant(input: CreateUploadGrantInput): Promise<PublicUploadGrant> {
    if (this.ports.serverVerifier === undefined) {
      throw publicClientError(
        "PC_CONFIGURATION",
        "Upload grant creation requires a server key verifier",
        { operation: "create-upload-grant" }
      );
    }
    const installation = await this.requireInstallation(
      "create-upload-grant",
      "public_upload:write_quarantine"
    );
    assertNotExpired(
      installation.bootstrap.challengeExpiresAt,
      this.ports.clock,
      this.maximumClockSkewMs,
      "create-upload-grant"
    );
    const unsignedRequest: PublicUploadGrantSigningPayload = {
      kind: "public_upload_grant_request",
      protocol: CURRENT_PROTOCOL_VERSION,
      idempotencyKey: input.idempotencyKey,
      installationId: installation.bootstrap.installationId,
      componentRole: input.componentRole,
      componentName: input.componentName,
    };
    const requestDigest = await computeProtocolDigest(
      "request",
      unsignedRequest,
      this.ports.digest
    );
    const signingInput = {
      requestDigest,
      challenge: installation.bootstrap.serverChallenge,
      nonce: this.ports.random.nonce(),
      credentialEpoch: installation.bootstrap.intakeCredential.credentialEpoch,
    };
    let signed: { readonly signedAt: string; readonly signature: string };
    try {
      signed = await this.ports.signer.signProof(signingInput, input.signal);
    } catch (error) {
      const normalized = normalizeError(error, "create-upload-grant");
      if (normalized.code === "PC_ABORTED") throw normalized;
      throw publicClientError(
        "PC_SIGNING_FAILED",
        "The installation signer could not sign the upload grant request",
        { operation: "create-upload-grant" },
        { cause: error }
      );
    }
    const request = protocolBoundary("create-upload-grant", () =>
      parsePublicUploadGrantRequest({
        ...unsignedRequest,
        installationProof: {
          domain: "public_contribution_intake",
          algorithm: "ed25519",
          keyId: this.ports.signer.keyId,
          ...signingInput,
          signedAt: signed.signedAt,
          signature: signed.signature,
        },
      } satisfies PublicUploadGrantRequest)
    );
    const expectedSigningPayload = publicUploadGrantSigningPayload(request);
    const expectedRequestDigest = await computeProtocolDigest(
      "request",
      expectedSigningPayload,
      this.ports.digest
    );
    assertDigestScope(expectedRequestDigest, requestDigest, "create-upload-grant");
    const response = await this.controlWithRetry({
      operation: "create-upload-grant",
      path: CONTROL_PATHS.createUploadGrant(input.contributionId),
      method: "POST",
      body: request,
      credential: installation.bootstrap.intakeCredential,
      retryableOperation: true,
      signal: input.signal,
    });
    const grant = protocolBoundary("create-upload-grant", () =>
      parsePublicUploadGrant(response.body)
    );
    await verifyServerDocument(grant, {
      digest: this.ports.digest,
      verifier: this.ports.serverVerifier,
      clock: this.ports.clock,
      maximumClockSkewMs: this.maximumClockSkewMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (
      grant.installationId !== installation.bootstrap.installationId ||
      grant.contributionId !== input.contributionId ||
      grant.credentialEpoch !== installation.bootstrap.intakeCredential.credentialEpoch ||
      grant.scope.componentRole !== input.componentRole ||
      grant.scope.componentName !== input.componentName
    ) {
      throw publicClientError("PC_SCOPE_MISMATCH", "Upload grant response scope does not match", {
        operation: "create-upload-grant",
      });
    }
    return grant;
  }

  private assertReceiptEpoch(
    receipt: ContributionStateReceipt,
    installation: InstallationRecord,
    operation: string
  ): void {
    if (receipt.credentialEpoch !== installation.bootstrap.intakeCredential.credentialEpoch) {
      throw publicClientError("PC_SCOPE_MISMATCH", "Receipt credential epoch does not match", {
        operation,
      });
    }
  }

  private async requireInstallation(
    operation: string,
    capability: PublicCapability
  ): Promise<InstallationRecord> {
    try {
      const record = await this.ports.installationStorage.load();
      if (record === null) {
        throw publicClientError("PC_STORAGE", "No public installation is available", { operation });
      }
      const bootstrap = protocolBoundary("load-installation", () =>
        parseBootstrapResponse(record.bootstrap)
      );
      if (bootstrap.installationState !== "active") {
        throw publicClientError("PC_CREDENTIAL_AUDIENCE", "Public installation is not active", {
          operation,
        });
      }
      this.assertCredential(bootstrap.intakeCredential, bootstrap, capability, operation);
      return { bootstrap };
    } catch (error) {
      if (error instanceof Error && error.name === "PublicClientError") throw error;
      throw publicClientError(
        "PC_STORAGE",
        "Public installation storage failed",
        { operation },
        { cause: error }
      );
    }
  }

  private assertCredential(
    credential: PublicControlCredential,
    bootstrap: BootstrapResponse,
    capability: PublicCapability | undefined,
    operation: string
  ): void {
    assertPublicCredential(credential);
    assertNotExpired(credential.expiresAt, this.ports.clock, this.maximumClockSkewMs, operation);
    const issuedAt = Date.parse(credential.issuedAt);
    if (
      !Number.isFinite(issuedAt) ||
      issuedAt > this.ports.clock.now().getTime() + this.maximumClockSkewMs
    ) {
      throw publicClientError("PC_CLOCK_SKEW", "Public credential is issued in the future", {
        operation,
      });
    }
    if (credential.capabilities.some((item) => !bootstrap.availableCapabilities.includes(item))) {
      throw publicClientError("PC_SCOPE_MISMATCH", "Public credential scope does not match", {
        operation,
      });
    }
    if (capability !== undefined && !credential.capabilities.includes(capability)) {
      throw publicClientError("PC_CREDENTIAL_AUDIENCE", "Public credential lacks capability", {
        operation,
      });
    }
  }

  private async saveInstallation(record: InstallationRecord): Promise<void> {
    try {
      await this.ports.installationStorage.save(record);
    } catch (error) {
      throw publicClientError(
        "PC_STORAGE",
        "Public installation storage failed",
        { operation: "bootstrap" },
        { cause: error }
      );
    }
  }

  private async controlWithRetry(input: {
    readonly operation: string;
    readonly path: string;
    readonly method: "GET" | "POST";
    readonly body: unknown;
    readonly credential: PublicControlCredential | null;
    readonly retryableOperation: boolean;
    readonly signal: AbortSignal | undefined;
  }) {
    return withRetry({
      operation: input.operation,
      retryableOperation: input.retryableOperation,
      policy: this.retryPolicy,
      clock: this.ports.clock,
      random: this.ports.random,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      run: () =>
        controlRequest(
          this.ports.transport,
          {
            method: input.method,
            path: input.path,
            headers: { "content-type": "application/json" },
            body: input.body,
            credential: input.credential,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
          input.operation
        ),
    });
  }
}
