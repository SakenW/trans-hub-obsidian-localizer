import { protocolError } from "./errors.js";

declare const digestHexBrand: unique symbol;

export const DIGEST_DOMAINS = [
  "source",
  "translation",
  "logical_object",
  "transport",
  "provider_checksum",
  "request",
  "signed_payload",
  "manifest_root",
  "attestation_payload",
  "adapter_build",
  "registry_definition",
  "policy",
  "placeholder_contract",
  "format_contract",
  "sbom",
  "provenance",
  "toolchain",
  "lifecycle_root_public_key",
  "provider_upload_grant",
] as const;

export type DigestDomain = (typeof DIGEST_DOMAINS)[number];

export type DigestHex<Domain extends DigestDomain> = string & {
  readonly [digestHexBrand]: Domain;
};

export interface ProtocolDigest<Domain extends DigestDomain> {
  readonly algorithm: "sha256";
  readonly domain: Domain;
  readonly hex: DigestHex<Domain>;
}

export type SourceDigest = ProtocolDigest<"source">;
export type TranslationDigest = ProtocolDigest<"translation">;
export type LogicalObjectDigest = ProtocolDigest<"logical_object">;
export type TransportDigest = ProtocolDigest<"transport">;
export type ProviderChecksum = ProtocolDigest<"provider_checksum">;
export type RequestDigest = ProtocolDigest<"request">;
export type ManifestRootDigest = ProtocolDigest<"manifest_root">;
export type AttestationPayloadDigest = ProtocolDigest<"attestation_payload">;
export type AdapterBuildDigest = ProtocolDigest<"adapter_build">;
export type RegistryDefinitionDigest = ProtocolDigest<"registry_definition">;

const HEX_256_PATTERN = /^[0-9a-f]{64}$/u;

export function createDigest<Domain extends DigestDomain>(
  domain: Domain,
  hex: string
): ProtocolDigest<Domain> {
  if (!HEX_256_PATTERN.test(hex)) {
    protocolError(
      "CP_INVALID_DIGEST",
      "$.digest.hex",
      "SHA-256 digest must be 64 lowercase hexadecimal characters"
    );
  }
  return Object.freeze({
    algorithm: "sha256",
    domain,
    hex: hex as DigestHex<Domain>,
  });
}

export function digestDomainSeparator(domain: DigestDomain): string {
  return `trans-hub.client-protocol/v1/${domain}\u0000`;
}
