import type {
  BootstrapLinkBinding,
  BootstrapResponse,
  ClientType,
  ContributionSigningPayload,
  ContributionStateReceipt,
  LocalizationDemandStatus,
  LocalizationDemandStatusBatch,
  PublicCapability,
  PublicDiscoveryIntent,
  PublicDiscoveryReceipt,
  PublicDiscoveryStatus,
  PublicLocalizationStatusBatch,
  PublicLocalizationStatusQuery,
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

/** Product adapters accept locale strings at their own boundary. The public
 * client validates them with the protocol parser before sending the request. */
export type PublicDiscoverySubmission = Omit<
  PublicDiscoveryIntent,
  "installationProof" | "targetLocales"
> & {
  readonly targetLocales: readonly string[];
};

export interface PublicClientControl {
  prepareBootstrap(input: PrepareBootstrapInput): PreparedBootstrap;
  bootstrap(input: BootstrapInput): Promise<BootstrapResponse>;
  submitContribution(
    payload: ContributionSigningPayload,
    signal?: AbortSignal,
  ): Promise<ContributionStateReceipt>;
  submitPublicDiscovery(
    payload: PublicDiscoverySubmission,
    signal?: AbortSignal,
  ): Promise<PublicDiscoveryReceipt>;
  getPublicDiscoveryStatus(
    discoveryId: string,
    signal?: AbortSignal,
  ): Promise<PublicDiscoveryStatus>;
  getPublicLocalizationStatusBatch(
    input: GetPublicLocalizationStatusBatchInput,
  ): Promise<PublicLocalizationStatusBatch>;
  getContributionStatus(
    contributionId: string,
    signal?: AbortSignal,
  ): Promise<ContributionStateReceipt>;
  getLocalizationDemandStatus(
    contributionId: string,
    signal?: AbortSignal,
  ): Promise<LocalizationDemandStatus>;
  getLocalizationDemandStatusBatch(
    input: GetLocalizationDemandStatusBatchInput,
  ): Promise<LocalizationDemandStatusBatch>;
}

export interface GetLocalizationDemandStatusBatchInput {
  readonly contributionIds: readonly string[];
  readonly signal?: AbortSignal;
}

export interface GetPublicLocalizationStatusBatchInput {
  readonly queries: readonly PublicLocalizationStatusQuery[];
  readonly signal?: AbortSignal;
}
