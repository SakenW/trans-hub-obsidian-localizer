import { normalizeError, publicClientError } from "./errors.js";
import type {
  ControlHttpRequest,
  ControlHttpResponse,
  PublicControlCredential,
  PublicHttpTransportPort,
  TransferHttpRequest,
  TransferHttpResponse,
} from "./ports.js";

export const CONTROL_PATHS = Object.freeze({
  bootstrap: "/v1/public-client/bootstrap",
  contributions: "/v1/public-client/contributions",
  contributionStatus: (contributionId: string) =>
    `/v1/public-client/contributions/${pathSegment(contributionId)}/status`,
  localizationDemandStatus: (contributionId: string) =>
    `/v1/public-client/contributions/${pathSegment(contributionId)}/localization-demand-status`,
  createUploadGrant: (contributionId: string) =>
    `/v1/public-client/contributions/${pathSegment(contributionId)}/upload-grants`,
});

function pathSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw publicClientError(
      "PC_CONFIGURATION",
      "Identifier cannot be used in a control path",
      {
        operation: "control-path",
      },
    );
  }
  return encodeURIComponent(value);
}

export function assertPublicCredential(
  credential: PublicControlCredential | null,
): PublicControlCredential | null {
  if (credential === null) return null;
  if (
    credential.audience !== "public-contribution-intake" ||
    credential.plane !== "public" ||
    typeof credential.value !== "string" ||
    credential.value.length < 32 ||
    typeof credential.installationId !== "string" ||
    credential.installationId.length === 0 ||
    typeof credential.sessionId !== "string" ||
    credential.sessionId.length === 0 ||
    !Number.isSafeInteger(credential.credentialEpoch) ||
    credential.credentialEpoch < 1 ||
    !Array.isArray(credential.capabilities) ||
    typeof credential.issuedAt !== "string" ||
    typeof credential.expiresAt !== "string"
  ) {
    throw publicClientError(
      "PC_CREDENTIAL_AUDIENCE",
      "Only a server-issued public-contribution-intake credential is accepted",
      { operation: "credential" },
    );
  }
  return credential;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function controlRequest(
  transport: PublicHttpTransportPort,
  request: ControlHttpRequest,
  operation: string,
): Promise<ControlHttpResponse> {
  let response: ControlHttpResponse;
  try {
    response = await transport.control({
      ...request,
      credential: assertPublicCredential(request.credential),
    });
  } catch (error) {
    throw normalizeError(error, operation);
  }
  if (response.status < 200 || response.status >= 300) {
    throw publicClientError(
      "PC_HTTP_STATUS",
      "The control endpoint returned a non-success status",
      { operation, status: response.status },
      { retryable: retryableStatus(response.status) },
    );
  }
  return response;
}

export async function transferRequest(
  transport: PublicHttpTransportPort,
  request: TransferHttpRequest,
  operation: string,
): Promise<TransferHttpResponse> {
  let response: TransferHttpResponse;
  try {
    response = await transport.transfer(request);
  } catch (error) {
    throw normalizeError(error, operation);
  }
  if (response.status < 200 || response.status >= 300) {
    throw publicClientError(
      "PC_HTTP_STATUS",
      "The transfer endpoint returned a non-success status",
      { operation, status: response.status },
      { retryable: retryableStatus(response.status) },
    );
  }
  return response;
}
