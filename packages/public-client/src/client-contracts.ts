import type {
  BootstrapLinkBinding,
  BootstrapResponse,
  ClientType,
  ContributionSigningPayload,
  ContributionStateReceipt,
  PublicCapability,
  PublicUploadGrant,
} from "@trans-hub/client-protocol";

import type {
  ClockPort,
  DigestPort,
  Ed25519InstallationSignerPort,
  InstallationStoragePort,
  PublicHttpTransportPort,
  RandomNoncePort,
  ServerKeyVerifierPort,
} from "./ports.js";
import type { RetryPolicy } from "./retry.js";

export interface PublicClientPorts {
  readonly transport: PublicHttpTransportPort;
  readonly signer: Ed25519InstallationSignerPort;
  readonly digest: DigestPort;
  readonly clock: ClockPort;
  readonly random: RandomNoncePort;
  readonly installationStorage: InstallationStoragePort;
  readonly serverVerifier?: ServerKeyVerifierPort;
}

export interface PublicClientOptions {
  readonly retry?: RetryPolicy;
  readonly maximumClockSkewMs?: number;
}

export interface PrepareBootstrapInput {
  readonly client: {
    readonly type: ClientType;
    readonly version: string;
    readonly platform: string;
  };
  readonly requestedCapabilities: readonly PublicCapability[];
}

export type PreparedBootstrap = BootstrapLinkBinding;

export interface BootstrapInput {
  readonly linkingCode: string;
  readonly prepared: PreparedBootstrap;
  readonly signal?: AbortSignal;
}

export interface PublicClientControl {
  prepareBootstrap(input: PrepareBootstrapInput): PreparedBootstrap;
  bootstrap(input: BootstrapInput): Promise<BootstrapResponse>;
  submitContribution(
    payload: ContributionSigningPayload,
    signal?: AbortSignal
  ): Promise<ContributionStateReceipt>;
  getContributionStatus(
    contributionId: string,
    signal?: AbortSignal
  ): Promise<ContributionStateReceipt>;
  createUploadGrant(input: CreateUploadGrantInput): Promise<PublicUploadGrant>;
}

export interface CreateUploadGrantInput {
  readonly contributionId: string;
  readonly idempotencyKey: string;
  readonly componentRole: string;
  readonly componentName: string;
  readonly signal?: AbortSignal;
}
