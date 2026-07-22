import type {
  TranslationExportEndpoint,
  TranslationSyncRequest,
} from "./contracts";

type EndpointCredential = Readonly<{ bearerCredential: string }>;

export function publicClientTranslationExportEndpoint(
  input: EndpointCredential,
): TranslationExportEndpoint {
  const headers = Object.freeze({
    ...authorizationHeaders(input.bearerCredential),
    "Trans-Hub-Translation-Export-Revision": "2",
  });
  return {
    manifestRevision: 2,
    manifestPath: (request) =>
      `/v1/public-client/translation-exports/current?${query(request)}`,
    downloadTicketsPath: () =>
      "/v1/public-client/translation-exports/download-tickets",
    authorizationHeaders: () => headers,
  };
}

export function workspaceTranslationExportEndpoint(
  input: EndpointCredential & Readonly<{ workspaceId: string }>,
): TranslationExportEndpoint {
  const workspaceId = requiredSegment(
    input.workspaceId,
    "translation_workspace_invalid",
  );
  const headers = authorizationHeaders(input.bearerCredential);
  const base = `/v1/workspaces/${encodeURIComponent(workspaceId)}/translation-exports`;
  return {
    manifestRevision: 1,
    manifestPath: (request) => `${base}/current?${query(request)}`,
    downloadTicketsPath: () => `${base}/download-tickets`,
    authorizationHeaders: () => headers,
  };
}

function query(request: TranslationSyncRequest): string {
  return new URLSearchParams({
    source_version_id: request.sourceVersionId,
    target_locale: request.targetLocale,
    target_variant: request.targetVariant ?? "default",
  }).toString();
}

function authorizationHeaders(
  credential: string,
): Readonly<Record<string, string>> {
  if (credential.trim() === "" || /[\r\n]/u.test(credential)) {
    throw new TypeError("translation_bearer_credential_invalid");
  }
  return Object.freeze({ Authorization: `Bearer ${credential}` });
}

function requiredSegment(value: string, code: string): string {
  if (value.trim() === "" || value !== value.normalize("NFC"))
    throw new TypeError(code);
  return value;
}
