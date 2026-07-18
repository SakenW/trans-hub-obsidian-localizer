import type { AcquisitionKind, ClientType, PublicCapability } from "./contracts.js";
import { TERMINAL_CONTRIBUTION_STATES } from "./contracts.js";
import { protocolError } from "./errors.js";
import {
  normalizePlatformLocale,
  normalizePlatformVariant,
  type PlatformLocale,
} from "./locale.js";
import { expectEnum, expectString } from "./schema.js";

export const CLIENT_TYPES = [
  "public_plugin",
  "official_desktop",
  "official_cli",
  "third_party_client",
] as const;
export const PUBLIC_CAPABILITIES = [
  "contribution:submit",
  "contribution:read_receipt",
  "public_upload:write_quarantine",
  "translation:read",
] as const;
export const CONTRIBUTION_TYPES = [
  "ecosystem_claim",
  "source_discovery",
  "localization_observation",
  "explicit_translation_candidate",
  "issue",
] as const;
export const ACQUISITION_KINDS = [
  "single_blob",
  "signed_components",
  "fixed_git_tree",
  "immutable_api_snapshot",
] as const;
export const SOURCE_STATES = [
  "received",
  "target_resolved",
  "artifact_acquired",
  "byte_verified",
  "source_attested",
  "governance_accepted",
  "canonical_source_published",
] as const;
export const TRANSLATION_STATES = [
  "received",
  "target_resolved",
  "source_head_pinned",
  "translation_validated",
  "governance_accepted",
  "translation_published",
] as const;
export const OBSERVATION_STATES = ["received", "target_resolved", "triaged", "recorded"] as const;
export const CLAIM_STATES = [
  "received",
  "target_resolved",
  "triaged",
  "governance_accepted",
  "recorded",
] as const;
export const ALL_CONTRIBUTION_STATES = [
  ...SOURCE_STATES,
  ...TRANSLATION_STATES,
  ...OBSERVATION_STATES,
  ...CLAIM_STATES,
  ...TERMINAL_CONTRIBUTION_STATES,
] as const;

export function parseClientType(value: unknown, path: string): ClientType {
  return expectEnum(value, CLIENT_TYPES, path);
}

export function parseCapability(value: unknown, path: string): PublicCapability {
  return expectEnum(value, PUBLIC_CAPABILITIES, path);
}

export function uniqueValues<T extends string>(values: readonly T[], path: string): readonly T[] {
  if (new Set(values).size !== values.length) {
    protocolError("CP_INVALID_VALUE", path, "array values must be unique");
  }
  return values;
}

export function parseNullable<T>(value: unknown, parser: (value: unknown) => T): T | null {
  return value === null ? null : parser(value);
}
export function parseCanonicalLocale(value: unknown, path: string): PlatformLocale {
  const raw = expectString(value, path, { max: 64 });
  const normalized = normalizePlatformLocale(raw, path);
  if (normalized !== raw) {
    protocolError(
      "CP_INVALID_LOCALE",
      path,
      `locale must already be platform-normalized as ${normalized}`
    );
  }
  return normalized;
}

export function parseCanonicalVariant(value: unknown, path: string) {
  const normalized = normalizePlatformVariant(value, path);
  if (value !== null && normalized !== value) {
    protocolError(
      "CP_INVALID_VARIANT",
      path,
      `variant must already be platform-normalized as ${normalized}`
    );
  }
  return normalized;
}
export function parseAcquisitionKind(value: unknown, path: string): AcquisitionKind {
  return expectEnum(value, ACQUISITION_KINDS, path);
}
