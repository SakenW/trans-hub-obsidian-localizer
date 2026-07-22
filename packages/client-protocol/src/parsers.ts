import { parseSourceAcquisitionManifest } from "./acquisition-parser.js";
import { parseSourceAttestation } from "./attestation-parser.js";
import {
  parseBootstrapRequest,
  parseBootstrapResponse,
} from "./bootstrap-parser.js";
import type { ProtocolDocument } from "./contracts.js";
import { parseContributionIntent } from "./contribution-parser.js";
import { protocolError } from "./errors.js";
import {
  parsePublicInstallationLifecycleCommand,
  parsePublicInstallationRecoveryCommand,
} from "./lifecycle-parser.js";
import { parseLocalizationDemandStatus } from "./localization-demand-parser.js";
import { parseRegistryResolution } from "./registry-parser.js";
import { parseContributionStateReceipt } from "./state-parser.js";
import { parseStrictJson } from "./strict-json.js";
import {
  parsePublicArtifactManifest,
  parsePublicDownloadTicket,
  parsePublicUploadGrant,
  parsePublicUploadGrantRequest,
} from "./transfer-parser.js";

export { parseSourceAcquisitionManifest } from "./acquisition-parser.js";
export { parseSourceAttestation } from "./attestation-parser.js";
export {
  parseBootstrapLinkBinding,
  parseBootstrapRequest,
  parseBootstrapResponse,
  parsePublicCredentialRenewalResponse,
} from "./bootstrap-parser.js";
export { parseContributionIntent } from "./contribution-parser.js";
export {
  parseInstallationLifecycleReceipt,
  parseInstallationLifecycleRecoveryRequest,
  parseInstallationLifecycleRotationRequest,
  parseInstallationLifecycleTerminalRequest,
  parsePublicInstallationLifecycleCommand,
  parsePublicInstallationRecoveryCommand,
  parsePublicLifecycleTrustCapability,
} from "./lifecycle-parser.js";
export { parseRegistryResolution } from "./registry-parser.js";
export { parseLocalizationDemandStatus } from "./localization-demand-parser.js";
export {
  assertContributionTransition,
  parseContributionStateReceipt,
} from "./state-parser.js";
export {
  parsePublicArtifactManifest,
  parsePublicDownloadTicket,
  parsePublicUploadGrant,
  parsePublicUploadGrantRequest,
} from "./transfer-parser.js";

export function parseProtocolDocument(input: unknown): ProtocolDocument {
  const value =
    typeof input === "string" || input instanceof Uint8Array
      ? parseStrictJson(input)
      : input;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    protocolError(
      "CP_INVALID_TYPE",
      "$",
      "protocol document must be an object",
    );
  }
  const kind = (value as Record<string, unknown>).kind;
  switch (kind) {
    case "bootstrap_request":
      return parseBootstrapRequest(value);
    case "bootstrap_response":
      return parseBootstrapResponse(value);
    case "contribution_intent":
      return parseContributionIntent(value);
    case "registry_resolution":
      return parseRegistryResolution(value);
    case "source_acquisition_manifest":
      return parseSourceAcquisitionManifest(value);
    case "contribution_state_receipt":
      return parseContributionStateReceipt(value);
    case "localization_demand_status":
      return parseLocalizationDemandStatus(value);
    case "source_attestation":
      return parseSourceAttestation(value);
    case "public_upload_grant":
      return parsePublicUploadGrant(value);
    case "public_upload_grant_request":
      return parsePublicUploadGrantRequest(value);
    case "public_artifact_manifest":
      return parsePublicArtifactManifest(value);
    case "public_download_ticket":
      return parsePublicDownloadTicket(value);
    case "public_installation_lifecycle_command":
      return parsePublicInstallationLifecycleCommand(value);
    case "public_installation_recovery_command":
      return parsePublicInstallationRecoveryCommand(value);
    default:
      protocolError(
        "CP_INVALID_VALUE",
        "$.kind",
        "unknown protocol document kind",
      );
  }
}
