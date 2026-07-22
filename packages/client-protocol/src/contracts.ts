import type { Uida } from "@trans-hub/uida";

import type {
  AdapterBuildDigest,
  AttestationPayloadDigest,
  LogicalObjectDigest,
  ManifestRootDigest,
  ProtocolDigest,
  RegistryDefinitionDigest,
  RequestDigest,
  SourceDigest,
  TranslationDigest,
  TransportDigest,
} from "./digest.js";
import type { PlatformLocale, PlatformVariant } from "./locale.js";
import type { ProtocolVersion } from "./version.js";

export type ClientType =
  | "public_plugin"
  | "official_desktop"
  | "official_cli"
  | "third_party_client";

export type PublicCapability =
  | "contribution:submit"
  | "contribution:read_receipt"
  | "public_upload:write_quarantine"
  | "translation:read";

export type InstallationState =
  | "pending"
  | "active"
  | "rotation_required"
  | "logged_out"
  | "lost"
  | "revoked"
  | "unlinked";

export interface InstallationPublicKey {
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly publicKey: string;
}

export interface BootstrapLinkBinding {
  readonly clientNonce: string;
  readonly installationPublicKey: InstallationPublicKey;
  readonly client: {
    readonly type: ClientType;
    readonly version: string;
    readonly platform: string;
  };
  readonly requestedCapabilities: readonly PublicCapability[];
}

export interface BootstrapRequest extends BootstrapLinkBinding {
  readonly kind: "bootstrap_request";
  readonly protocol: ProtocolVersion;
  readonly linkingCode: string;
}

/**
 * Short-lived admission credential for the Public Contribution Intake plane.
 *
 * The opaque value is issued by the server and is never supplied by the
 * embedding client. Exact target authority is still resolved and checked by
 * the server for every signed ContributionIntent.
 */
export interface PublicIntakeSessionCredential {
  readonly audience: "public-contribution-intake";
  readonly plane: "public";
  readonly sessionId: string;
  readonly installationId: string;
  readonly credentialEpoch: number;
  readonly capabilities: readonly PublicCapability[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly value: string;
}

export interface BootstrapResponse {
  readonly kind: "bootstrap_response";
  readonly protocol: ProtocolVersion;
  readonly installationId: string;
  readonly installationState: InstallationState;
  readonly trust: "untrusted_client";
  readonly clientNonce: string;
  readonly installationKeyId: string;
  readonly serverChallenge: string;
  readonly challengeExpiresAt: string;
  readonly availableCapabilities: readonly PublicCapability[];
  readonly intakeCredential: PublicIntakeSessionCredential;
}

export interface ProposedPublicIntakeCredential {
  readonly tokenPrefix: string;
  readonly secret: string;
}

export interface PublicCredentialRenewalRequest {
  readonly kind: "public_credential_renewal_request";
  readonly protocol: ProtocolVersion;
  readonly installationId: string;
  readonly idempotencyKey: string;
  readonly newIntakeCredential: ProposedPublicIntakeCredential;
  readonly installationProof: InstallationProof;
}

export interface PublicCredentialRenewalResponse {
  readonly kind: "public_credential_renewal_response";
  readonly protocol: ProtocolVersion;
  readonly installationId: string;
  readonly installationKeyId: string;
  readonly serverChallenge: string;
  readonly challengeExpiresAt: string;
  readonly intakeCredential: PublicIntakeSessionCredential;
}

export type SignatureEnvelopeDomain = "public_contribution_intake";

export interface SignatureEnvelope<Domain extends SignatureEnvelopeDomain> {
  readonly domain: Domain;
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly requestDigest: RequestDigest;
  readonly challenge: string;
  readonly nonce: string;
  readonly signedAt: string;
  readonly credentialEpoch: number;
  readonly signature: string;
}

export type InstallationProof = SignatureEnvelope<"public_contribution_intake">;

export interface InstallationLifecycleKeyProof {
  readonly domain: "public_installation_lifecycle";
  readonly role: "current" | "replacement";
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly requestDigest: RequestDigest;
  readonly nonce: string;
  readonly signedAt: string;
  readonly credentialEpoch: number;
  readonly signature: string;
}

export interface InstallationLifecycleRotationRequest {
  readonly action: "rotate";
  readonly idempotencyKey: string;
  readonly evidenceDigest: string;
  readonly currentInstallationPublicKey: InstallationPublicKey;
  readonly expectedCredentialEpoch: number;
  readonly newInstallationPublicKey: InstallationPublicKey;
  readonly newIntakeCredential: {
    readonly tokenPrefix: string;
    readonly secret: string;
  };
  readonly currentInstallationProof: InstallationLifecycleKeyProof & {
    readonly role: "current";
  };
  readonly replacementInstallationProof: InstallationLifecycleKeyProof & {
    readonly role: "replacement";
  };
}

export interface InstallationLifecycleRecoveryRequest {
  readonly action: "reinstall";
  readonly idempotencyKey: string;
  readonly evidenceDigest: string;
  readonly expectedCredentialEpoch: number;
  readonly newInstallationPublicKey: InstallationPublicKey;
  readonly newIntakeCredential: {
    readonly tokenPrefix: string;
    readonly secret: string;
  };
  readonly recoveryGrant: string;
  readonly replacementInstallationProof: InstallationLifecycleKeyProof & {
    readonly role: "replacement";
  };
}

export interface InstallationLifecycleTerminalRequest {
  readonly action: "logout" | "lost_device" | "unlink" | "revoke";
  readonly idempotencyKey: string;
  readonly evidenceDigest: string;
}

export type ServerEnvelopeDomain =
  | "public_upload_grant"
  | "native_transfer_capability"
  | "public_download_ticket"
  | "public_artifact_manifest"
  | "public_installation_lifecycle_command"
  | "public_installation_recovery_command"
  | "public_installation_lifecycle_receipt";

export interface ServerSignatureEnvelope<Domain extends ServerEnvelopeDomain> {
  readonly domain: Domain;
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly keyVersion: number;
  readonly payloadDigest: ProtocolDigest<"signed_payload">;
  readonly signedAt: string;
  readonly expiresAt: string | null;
  readonly signature: string;
}

export interface PublicInstallationLifecycleCommand {
  readonly kind: "public_installation_lifecycle_command";
  readonly protocol: ProtocolVersion;
  readonly action: "rotate";
  readonly commandId: string;
  readonly installationId: string;
  readonly authorityWorkspaceId: string;
  readonly principalId: string;
  readonly currentInstallationPublicKey: InstallationPublicKey;
  readonly currentKeyEpoch: number;
  readonly expectedCredentialEpoch: number;
  readonly nextKeyEpoch: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly serverProof: ServerSignatureEnvelope<"public_installation_lifecycle_command">;
}

export interface PublicInstallationRecoveryCommand {
  readonly kind: "public_installation_recovery_command";
  readonly protocol: ProtocolVersion;
  readonly action: "reinstall";
  readonly commandId: string;
  readonly installationId: string;
  readonly authorityWorkspaceId: string;
  readonly principalId: string;
  readonly expectedCredentialEpoch: number;
  readonly nextCredentialEpoch: number;
  readonly nextKeyEpoch: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly recoveryGrant: string;
  readonly serverProof: ServerSignatureEnvelope<"public_installation_recovery_command">;
}

export interface PublicLifecycleTrustCapability {
  readonly domain: "public_lifecycle_trust_capability";
  readonly installationId: string;
  readonly authorityWorkspaceId: string;
  readonly principalId: string;
  readonly installationKeyId: string;
  readonly trustBundleRevision: number;
  readonly acceptedRoots: readonly {
    readonly keyId: string;
    readonly keyVersion: number;
    readonly publicKeyDigest: ProtocolDigest<"lifecycle_root_public_key">;
  }[];
  readonly nonce: string;
  readonly signedAt: string;
  readonly signature: string;
}

interface InstallationLifecycleReceiptBase {
  readonly receiptId: string;
  readonly requestId: string;
  readonly requestDigest: RequestDigest;
  readonly installationId: string;
  readonly credentialEpoch: number;
  readonly keyVersion: number;
  readonly outcome: "advanced" | "idempotent_replay";
  readonly recordedAt: string;
  readonly serverProof: ServerSignatureEnvelope<"public_installation_lifecycle_receipt">;
}

export interface InstallationLifecycleReplacementReceipt
  extends InstallationLifecycleReceiptBase {
  readonly action: "rotate" | "reinstall";
  readonly state: "active";
  readonly serverChallenge: string;
  readonly challengeExpiresAt: string;
  readonly intakeCredential: PublicIntakeSessionCredential;
}

export interface InstallationLifecycleTerminalReceipt
  extends InstallationLifecycleReceiptBase {
  readonly action: "logout" | "lost_device" | "unlink" | "revoke";
  readonly state: "logged_out" | "lost" | "unlinked" | "revoked";
  readonly serverChallenge: null;
  readonly challengeExpiresAt: null;
  readonly intakeCredential: null;
}

export type InstallationLifecycleReceipt =
  | InstallationLifecycleReplacementReceipt
  | InstallationLifecycleTerminalReceipt;

export interface ContributionTargetHint {
  readonly externalRegistry: string;
  readonly externalObjectId: string;
  readonly upstreamVersion: string | null;
  readonly officialArtifactLocator: string | null;
}

export interface AdapterHint {
  readonly definitionId: string;
  readonly version: string;
  readonly buildDigest: AdapterBuildDigest;
}

export interface ClientProvenance {
  readonly clientType: ClientType;
  readonly clientVersion: string;
  readonly userAction:
    | "automatic_observation"
    | "explicit_submit"
    | "explicit_edit";
  readonly observationDigest: RequestDigest;
}

interface ContributionIntentBase<Type extends ContributionType> {
  readonly kind: "contribution_intent";
  readonly protocol: ProtocolVersion;
  readonly contributionType: Type;
  readonly idempotencyKey: string;
  readonly installationId: string;
  readonly submittedAt: string;
  readonly targetHint: ContributionTargetHint;
  readonly adapterHint: AdapterHint;
  readonly provenance: ClientProvenance;
  readonly installationProof: InstallationProof;
}

export type ContributionType =
  | "ecosystem_claim"
  | "source_discovery"
  | "localization_observation"
  | "explicit_translation_candidate"
  | "issue";

export interface EcosystemClaimIntent
  extends ContributionIntentBase<"ecosystem_claim"> {
  readonly claim: {
    readonly publisherHint: string;
    readonly namespaceHint: string;
    readonly summary: string;
  };
}

export interface SourceDiscoveryIntent
  extends ContributionIntentBase<"source_discovery"> {
  readonly discovery: {
    readonly candidateLocators: readonly string[];
    readonly localArtifactDigest: TransportDigest | null;
  };
}

export interface LocalizationObservationIntent
  extends ContributionIntentBase<"localization_observation"> {
  readonly observation: {
    readonly sourceLocaleRaw: string;
    readonly targetLocaleRaw: string | null;
    readonly variantRaw: string | null;
    readonly summaryDigest: RequestDigest;
  };
}

export interface ExplicitTranslationCandidateIntent
  extends ContributionIntentBase<"explicit_translation_candidate"> {
  readonly candidate: {
    readonly sourceHeadId: string;
    readonly sourceVersionId: string;
    readonly sourceDigest: SourceDigest;
    readonly sourceLocale: PlatformLocale;
    readonly targetLocale: PlatformLocale;
    readonly variant: PlatformVariant | null;
    readonly localeNormalizationRevision: 1;
    readonly semanticUnitUida: Uida;
    readonly placeholderContractDigest: ProtocolDigest<"placeholder_contract">;
    readonly formatContractDigest: ProtocolDigest<"format_contract">;
    readonly translationDigest: TranslationDigest;
    readonly contentOrigin: "user_edited" | "imported" | "unknown";
  };
}

export interface IssueIntent extends ContributionIntentBase<"issue"> {
  readonly issue: {
    readonly category:
      | "metadata"
      | "source_integrity"
      | "localization_quality"
      | "license"
      | "other";
    readonly severity: "info" | "warning" | "blocking";
    readonly summary: string;
    readonly evidenceDigest: RequestDigest | null;
  };
}

export type ContributionIntent =
  | EcosystemClaimIntent
  | SourceDiscoveryIntent
  | LocalizationObservationIntent
  | ExplicitTranslationCandidateIntent
  | IssueIntent;

export type AcquisitionKind =
  | "single_blob"
  | "signed_components"
  | "fixed_git_tree"
  | "immutable_api_snapshot";

export interface RegistryResolution {
  readonly kind: "registry_resolution";
  readonly protocol: ProtocolVersion;
  readonly resolutionId: string;
  readonly resolvedAt: string;
  readonly registry: {
    readonly root: string;
    readonly revision: string;
    readonly definitionDigest: RegistryDefinitionDigest;
    readonly policyRevision: string;
  };
  readonly externalIdentity: {
    readonly objectId: string;
    readonly publisher: string;
    readonly namespace: string;
  };
  readonly upstream: {
    readonly identityKind: "release" | "commit" | "revision";
    readonly immutableIdentity: string;
    readonly versionLabel: string | null;
  };
  readonly acquisition: {
    readonly kind: AcquisitionKind;
    readonly allowedOrigins: readonly string[];
    readonly redirectPolicy: "none" | "same_origin" | "registry_rules";
    readonly authenticationPolicy: "none" | "public_platform_credential";
  };
  readonly license: {
    readonly spdx: string;
    readonly evidenceDigest: RequestDigest;
  };
  readonly lifecycle: "active" | "yanked" | "tombstoned";
  readonly adapter: {
    readonly definitionId: string;
    readonly version: string;
    readonly buildDigest: AdapterBuildDigest;
    readonly compatibilityRevision: string;
  };
}

export interface UpstreamSignature {
  readonly algorithm: "ed25519" | "minisign" | "pgp";
  readonly keyId: string;
  readonly signature: string;
}

export interface AcquisitionComponent {
  readonly name: string;
  readonly role: string;
  readonly canonicalLocator: string;
  readonly mediaType: string;
  readonly size: number;
  readonly transportDigest: TransportDigest;
  readonly upstreamSignature: UpstreamSignature | null;
}

interface SourceAcquisitionManifestBase<Kind extends AcquisitionKind> {
  readonly kind: "source_acquisition_manifest";
  readonly protocol: ProtocolVersion;
  readonly acquisitionKind: Kind;
  readonly manifestId: string;
  readonly resolutionId: string;
  readonly acquisitionPolicyRevision: string;
  readonly rootDigest: ManifestRootDigest;
  readonly components: readonly AcquisitionComponent[];
}

export interface SingleBlobManifest
  extends SourceAcquisitionManifestBase<"single_blob"> {
  readonly blob: {
    readonly componentName: string;
  };
}

export interface SignedComponentsManifest
  extends SourceAcquisitionManifestBase<"signed_components"> {
  readonly componentSemantics: "ordered" | "named";
  readonly upstreamManifest: {
    readonly componentName: string;
    readonly signedDigest: TransportDigest;
    readonly signature: UpstreamSignature;
  };
}

export interface FixedGitTreeManifest
  extends SourceAcquisitionManifestBase<"fixed_git_tree"> {
  readonly repository: {
    readonly canonicalUrl: string;
    readonly commit: string;
    readonly tree: string;
  };
}

export interface ImmutableApiSnapshotManifest
  extends SourceAcquisitionManifestBase<"immutable_api_snapshot"> {
  readonly apiSnapshot: {
    readonly endpoint: string;
    readonly immutableRevision: string;
    readonly pageCount: number;
    readonly paginationClosureDigest: ProtocolDigest<"logical_object">;
  };
}

export type SourceAcquisitionManifest =
  | SingleBlobManifest
  | SignedComponentsManifest
  | FixedGitTreeManifest
  | ImmutableApiSnapshotManifest;

export const TERMINAL_CONTRIBUTION_STATES = [
  "invalid",
  "out_of_scope",
  "conflict",
  "rejected",
  "expired",
  "revoked",
  "tombstoned",
] as const;

export type TerminalContributionState =
  (typeof TERMINAL_CONTRIBUTION_STATES)[number];

export type SourceContributionState =
  | "received"
  | "target_resolved"
  | "artifact_acquired"
  | "byte_verified"
  | "source_attested"
  | "governance_accepted"
  | "canonical_source_published"
  | TerminalContributionState;

export type TranslationContributionState =
  | "received"
  | "target_resolved"
  | "source_head_pinned"
  | "translation_validated"
  | "governance_accepted"
  | "translation_published"
  | TerminalContributionState;

export type ObservationContributionState =
  | "received"
  | "target_resolved"
  | "triaged"
  | "recorded"
  | TerminalContributionState;

export type ClaimContributionState =
  | "received"
  | "target_resolved"
  | "triaged"
  | "governance_accepted"
  | "recorded"
  | TerminalContributionState;

export type ContributionState =
  | SourceContributionState
  | TranslationContributionState
  | ObservationContributionState
  | ClaimContributionState;

export type ContributionStateFor<Type extends ContributionType> =
  Type extends "source_discovery"
    ? SourceContributionState
    : Type extends "explicit_translation_candidate"
      ? TranslationContributionState
      : Type extends "ecosystem_claim"
        ? ClaimContributionState
        : ObservationContributionState;

export interface ContributionStateReceipt<
  Type extends ContributionType = ContributionType,
> {
  readonly kind: "contribution_state_receipt";
  readonly protocol: ProtocolVersion;
  readonly receiptId: string;
  readonly contributionId: string;
  readonly contributionType: Type;
  readonly state: ContributionStateFor<Type>;
  readonly expectedPreviousState: ContributionStateFor<Type> | null;
  readonly sequence: number;
  readonly outcome: "advanced" | "terminal" | "idempotent_replay";
  readonly commandDigest: RequestDigest;
  readonly policyRevision: string;
  readonly credentialEpoch: number;
  readonly authorityHeadDigest: LogicalObjectDigest | null;
  readonly recordedAt: string;
}

export type LocalizationDemandState =
  | "awaiting_source"
  | "rejected"
  | "reconciled"
  | "mt_queued"
  | "mt_running"
  | "mt_failed"
  | "export_pending"
  | "export_ready"
  | "native_complete";

export interface LocalizationDemandCoordinateStatus {
  readonly state: LocalizationDemandState;
  readonly sourceVersionId: string | null;
  readonly targetLocale: string | null;
  readonly targetVariant: string | null;
  readonly totalUnitCount: number;
  readonly workItemCount: number;
  readonly nativeUnitCount: number;
  readonly queuedCount: number;
  readonly runningCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly reviewedUnitCount: number;
  readonly publishedUnitCount: number;
  readonly manifestId: string | null;
  readonly generationNumber: number | null;
  readonly updatedAt: string;
  readonly retryAfterSeconds: number;
  readonly failureCode: string | null;
  readonly failureRetryable: boolean;
  readonly failureAttemptNumber: number | null;
}

export interface LocalizationDemandStatus {
  readonly kind: "localization_demand_status";
  readonly protocol: ProtocolVersion;
  readonly contributionId: string;
  readonly state: LocalizationDemandState;
  readonly coordinates: readonly LocalizationDemandCoordinateStatus[];
  readonly retryAfterSeconds: number;
  readonly updatedAt: string;
}

export interface SourceAttestation {
  readonly kind: "source_attestation";
  readonly protocol: ProtocolVersion;
  readonly attestationId: string;
  readonly status: "valid" | "revoked" | "reverify_required";
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly resolutionId: string;
  readonly registry: {
    readonly root: string;
    readonly revision: string;
    readonly definitionDigest: RegistryDefinitionDigest;
    readonly policyRevision: string;
  };
  readonly externalIdentity: {
    readonly objectId: string;
    readonly publisher: string;
    readonly namespace: string;
    readonly upstreamImmutableRevision: string;
  };
  readonly acquisition: {
    readonly manifestRootDigest: ManifestRootDigest;
    readonly components: readonly {
      readonly name: string;
      readonly transportDigest: TransportDigest;
    }[];
  };
  readonly adapter: {
    readonly definitionId: string;
    readonly version: string;
    readonly buildDigest: AdapterBuildDigest;
    readonly sourceRevision: string;
    readonly toolchainDigest: ProtocolDigest<"toolchain">;
    readonly sbomDigest: ProtocolDigest<"sbom">;
    readonly provenanceDigest: ProtocolDigest<"provenance">;
  };
  readonly result: {
    readonly sourceDigest: SourceDigest;
    readonly logicalObjectDigest: LogicalObjectDigest;
  };
  readonly verifier: {
    readonly keyId: string;
    readonly keyVersion: number;
    readonly algorithm: "ed25519";
    readonly payloadDigest: AttestationPayloadDigest;
    readonly signature: string;
  };
}

export interface PublicUploadGrant {
  readonly kind: "public_upload_grant";
  readonly protocol: ProtocolVersion;
  readonly grantId: string;
  readonly audience: "public-upload";
  readonly plane: "public";
  readonly installationId: string;
  readonly contributionId: string;
  readonly scope: {
    readonly manifestRootDigest: ManifestRootDigest;
    readonly componentRole: string;
    readonly componentName: string;
    readonly transportDigest: TransportDigest;
    readonly contentLength: number;
    readonly mediaType: string;
  };
  readonly upload: PublicUploadTransport;
  readonly nonce: string;
  readonly credentialEpoch: number;
  readonly expiresAt: string;
  readonly serverProof: ServerSignatureEnvelope<"public_upload_grant">;
}

export interface PublicUploadGrantRequest {
  readonly kind: "public_upload_grant_request";
  readonly protocol: ProtocolVersion;
  readonly idempotencyKey: string;
  readonly installationId: string;
  readonly componentRole: string;
  readonly componentName: string;
  readonly installationProof: InstallationProof;
}

export type PublicUploadGrantSigningPayload = Omit<
  PublicUploadGrantRequest,
  "installationProof"
>;

export interface PublicUploadHttpsPut {
  readonly kind: "https_put";
  readonly method: "PUT";
  readonly url: string;
  readonly requiredHeaders: Readonly<Record<string, string>>;
}

/** Exact Rust-facing wire shape. Nested keys deliberately remain snake_case. */
export interface ProviderUploadGrantWire {
  readonly provider: string;
  readonly upload_session_id: string;
  readonly bucket: string;
  readonly staging_key: string;
  readonly token: string;
  readonly expires_at_epoch_ms: number;
  readonly upload_origins: readonly string[];
}

/** Exact Rust-facing wire shape. Nested keys deliberately remain snake_case. */
export interface NativeTransferAuthorizationWire {
  readonly contract_revision: string;
  readonly server_contract: "trans_hub_api_v1";
  readonly lane: "public";
  readonly direction: "upload";
  readonly workspace_id: string;
  readonly session_id: string;
  readonly authority_scope: string;
  readonly object_digest: string;
  readonly object_bytes: number;
  readonly part_bytes: number;
  readonly expires_at_epoch_ms: number;
  readonly source_head: string | null;
  readonly export_revision: number | null;
}

/** Exact Rust-facing wire shape. Nested keys deliberately remain snake_case. */
export interface NativeTransferCapabilityWire {
  readonly kind: "native_transfer_capability";
  readonly protocol: ProtocolVersion;
  readonly capability_id: string;
  readonly capability_epoch: number;
  readonly nonce: string;
  readonly authorization: NativeTransferAuthorizationWire;
  readonly provider_grant_digest: ProtocolDigest<"provider_upload_grant">;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly server_proof: ServerSignatureEnvelope<"native_transfer_capability">;
}

export interface PublicUploadProviderGrant {
  readonly kind: "provider_grant";
  readonly providerGrant: ProviderUploadGrantWire;
  readonly nativeCapability: NativeTransferCapabilityWire;
}

export type PublicUploadTransport =
  | PublicUploadHttpsPut
  | PublicUploadProviderGrant;

export interface PublicArtifactManifest {
  readonly kind: "public_artifact_manifest";
  readonly protocol: ProtocolVersion;
  readonly manifestId: string;
  readonly audience: "public-download";
  readonly plane: "public";
  readonly publicationId: string;
  readonly objectUida: Uida;
  readonly monotonicRevision: number;
  readonly source: {
    readonly headId: string;
    readonly versionId: string;
    readonly digest: SourceDigest;
    readonly locale: PlatformLocale;
  };
  readonly localization: {
    readonly targetLocale: PlatformLocale;
    readonly variant: PlatformVariant | null;
    readonly localeNormalizationRevision: 1;
  };
  readonly logicalObjectDigest: LogicalObjectDigest;
  readonly components: readonly AcquisitionComponent[];
  readonly manifestDigest: ManifestRootDigest;
  readonly publishedAt: string;
  readonly serverProof: ServerSignatureEnvelope<"public_artifact_manifest">;
}

export interface PublicDownloadTicket {
  readonly kind: "public_download_ticket";
  readonly protocol: ProtocolVersion;
  readonly ticketId: string;
  readonly audience: "public-download";
  readonly plane: "public";
  readonly manifestId: string;
  readonly manifestDigest: ManifestRootDigest;
  readonly componentName: string;
  readonly transportDigest: TransportDigest;
  readonly contentLength: number;
  readonly downloadUrl: string;
  readonly nonce: string;
  readonly credentialEpoch: number;
  readonly expiresAt: string;
  readonly serverProof: ServerSignatureEnvelope<"public_download_ticket">;
}

export type ProtocolDocument =
  | BootstrapRequest
  | BootstrapResponse
  | ContributionIntent
  | RegistryResolution
  | SourceAcquisitionManifest
  | ContributionStateReceipt
  | LocalizationDemandStatus
  | SourceAttestation
  | PublicUploadGrantRequest
  | PublicUploadGrant
  | PublicArtifactManifest
  | PublicDownloadTicket
  | PublicInstallationLifecycleCommand
  | PublicInstallationRecoveryCommand;
