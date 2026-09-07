import type {
  TranslationExportEndpoint,
  TranslationExportRevision,
  TranslationSyncRequest,
} from "./contracts";

type EndpointCredential = Readonly<{ bearerCredential: string }>;
type VersionedEndpointCredential<TRevision extends 2 | 3> =
  EndpointCredential & Readonly<{ manifestRevision: TRevision }>;

export function publicClientTranslationExportEndpoint(
  input: VersionedEndpointCredential<3>,
): TranslationExportEndpoint<3>;
export function publicClientTranslationExportEndpoint(
  input: EndpointCredential,
): TranslationExportEndpoint<2>;
export function publicClientTranslationExportEndpoint(
  input: EndpointCredential | VersionedEndpointCredential<3>,
): TranslationExportEndpoint<2 | 3> {
  const manifestRevision = revision(input);
  const headers = Object.freeze({
    ...authorizationHeaders(input.bearerCredential),
    "Trans-Hub-Translation-Export-Revision": String(manifestRevision),
  });
  return {
    manifestRevision,
    manifestPath: (request) =>
      `/v1/public-client/translation-exports/current?${query(request)}`,
    downloadTicketsPath: () =>
      "/v1/public-client/translation-exports/download-tickets",
    authorizationHeaders: () => headers,
  };
}

export function workspaceTranslationExportEndpoint(
  input: VersionedEndpointCredential<3> & Readonly<{ workspaceId: string }>,
): TranslationExportEndpoint<3>;
export function workspaceTranslationExportEndpoint(
  input: EndpointCredential & Readonly<{ workspaceId: string }>,
): TranslationExportEndpoint<2>;
export function workspaceTranslationExportEndpoint(
  input:
    | (EndpointCredential & Readonly<{ workspaceId: string }>)
    | (VersionedEndpointCredential<3> & Readonly<{ workspaceId: string }>),
): TranslationExportEndpoint<2 | 3> {
  const workspaceId = requiredSegment(
    input.workspaceId,
    "translation_workspace_invalid",
  );
  const manifestRevision = revision(input);
  const headers = Object.freeze({
    ...authorizationHeaders(input.bearerCredential),
    "Trans-Hub-Translation-Export-Revision": String(manifestRevision),
  });
  const base = `/v1/workspaces/${encodeURIComponent(workspaceId)}/translation-exports`;
  return {
    manifestRevision,
    manifestPath: (request) => `${base}/current?${query(request)}`,
    downloadTicketsPath: () => `${base}/download-tickets`,
    authorizationHeaders: () => headers,
  };
}

function revision(
  input: EndpointCredential | Readonly<{ manifestRevision: 3 }>,
): Extract<TranslationExportRevision, 2 | 3> {
  return "manifestRevision" in input ? input.manifestRevision : 2;
}

function query(
  request: TranslationSyncRequest<
    import("./contracts").AnyTranslationExportManifest
  >,
): string {
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
