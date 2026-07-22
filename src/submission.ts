import {
  CURRENT_PROTOCOL_VERSION,
  computeProtocolDigest,
  createDigest,
  type ContributionStateReceipt,
  type IssueIntent,
  type LocalizationObservationIntent,
  type SourceDiscoveryIntent,
} from "@trans-hub/client-protocol";
import type { PublicClient } from "@trans-hub/public-client";

import { sha256Hex } from "./identity";
import type { PluginUiCatalog } from "./plugin-string-scanner";
import { OBSIDIAN_CLIENT_VERSION } from "./product-config";

export const OBSIDIAN_PUBLIC_PROFILE = {
  externalRegistry: "obsidian_community_plugins",
  adapterDefinitionId: "obsidian",
  adapterVersion: "1.1.0",
  adapterBuildDigestHex: "2111e10336edf23c59661e66b6155a1ef127642161ea4ccd766fb1cc16b15580",
} as const;

export async function submitObsidianPluginDiscovery(input: {
  readonly client: PublicClient;
  readonly installationId: string;
  readonly catalog: PluginUiCatalog;
  readonly repository: string;
  readonly candidateLocators: readonly string[];
}): Promise<ContributionStateReceipt<"source_discovery">> {
  const observationMaterial = {
    pluginId: input.catalog.pluginId,
    pluginVersion: input.catalog.pluginVersion,
    repository: input.repository,
    catalogDigest: input.catalog.digest,
    artifactDigest: input.catalog.artifactDigest,
    stringCount: input.catalog.strings.length,
  };
  const digestPort = {
    async digest(bytes: Uint8Array): Promise<Uint8Array> {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
    },
  };
  const observationDigest = await computeProtocolDigest("request", observationMaterial, digestPort);
  const idempotencyKey = `obsidian-public-v11-${await sha256Hex([
    input.repository,
    input.catalog.pluginVersion,
    input.catalog.artifactDigest,
    input.catalog.digest,
    OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex,
  ].join("\u0000"))}`;
  const payload: Omit<SourceDiscoveryIntent, "installationProof"> = {
    kind: "contribution_intent",
    protocol: CURRENT_PROTOCOL_VERSION,
    contributionType: "source_discovery",
    idempotencyKey,
    installationId: input.installationId,
    submittedAt: input.catalog.scannedAt,
    targetHint: {
      externalRegistry: OBSIDIAN_PUBLIC_PROFILE.externalRegistry,
      externalObjectId: input.repository,
      upstreamVersion: input.catalog.pluginVersion,
      officialArtifactLocator: null,
    },
    adapterHint: {
      definitionId: OBSIDIAN_PUBLIC_PROFILE.adapterDefinitionId,
      version: OBSIDIAN_PUBLIC_PROFILE.adapterVersion,
      buildDigest: createDigest("adapter_build", OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex),
    },
    provenance: {
      clientType: "public_plugin",
      clientVersion: OBSIDIAN_CLIENT_VERSION,
      userAction: "automatic_observation",
      observationDigest,
    },
    discovery: {
      candidateLocators: [...new Set(input.candidateLocators)],
      localArtifactDigest: createDigest("transport", input.catalog.artifactDigest),
    },
  };
  return input.client.submitContribution(payload) as Promise<ContributionStateReceipt<"source_discovery">>;
}

export async function submitObsidianLocalizationObservation(input: {
  readonly client: PublicClient;
  readonly installationId: string;
  readonly catalog: PluginUiCatalog;
  readonly repository: string;
  readonly targetLocale: string;
}): Promise<ContributionStateReceipt<"localization_observation">> {
  const summaryMaterial = {
    pluginId: input.catalog.pluginId,
    pluginVersion: input.catalog.pluginVersion,
    repository: input.repository,
    sourceLocale: input.catalog.sourceLocale,
    targetLocale: input.targetLocale,
    catalogDigest: input.catalog.digest,
  };
  const digestPort = {
    async digest(bytes: Uint8Array): Promise<Uint8Array> {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
    },
  };
  const summaryDigest = await computeProtocolDigest("request", summaryMaterial, digestPort);
  const idempotencyKey = `obsidian-localize-v9-${await sha256Hex([
    input.repository,
    input.catalog.pluginVersion,
    input.targetLocale,
    input.catalog.digest,
    OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex,
  ].join("\u0000"))}`;
  const payload: Omit<LocalizationObservationIntent, "installationProof"> = {
    kind: "contribution_intent",
    protocol: CURRENT_PROTOCOL_VERSION,
    contributionType: "localization_observation",
    idempotencyKey,
    installationId: input.installationId,
    submittedAt: input.catalog.scannedAt,
    targetHint: {
      externalRegistry: OBSIDIAN_PUBLIC_PROFILE.externalRegistry,
      externalObjectId: input.catalog.pluginId,
      upstreamVersion: input.catalog.pluginVersion,
      officialArtifactLocator: `https://github.com/${input.repository}`,
    },
    adapterHint: {
      definitionId: OBSIDIAN_PUBLIC_PROFILE.adapterDefinitionId,
      version: OBSIDIAN_PUBLIC_PROFILE.adapterVersion,
      buildDigest: createDigest("adapter_build", OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex),
    },
    provenance: {
      clientType: "public_plugin",
      clientVersion: OBSIDIAN_CLIENT_VERSION,
      userAction: "automatic_observation",
      observationDigest: summaryDigest,
    },
    observation: {
      sourceLocaleRaw: input.catalog.sourceLocale,
      targetLocaleRaw: input.targetLocale,
      variantRaw: "default",
      summaryDigest,
    },
  };
  return input.client.submitContribution(payload) as Promise<ContributionStateReceipt<"localization_observation">>;
}

export type ObsidianLocalizationIssueKind = "missing" | "inaccurate";

export async function submitObsidianLocalizationIssue(input: {
  readonly client: PublicClient;
  readonly installationId: string;
  readonly issueKind: ObsidianLocalizationIssueKind;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly repository: string;
  readonly targetLocale: string;
  readonly sourceText: string;
  readonly currentTargetText?: string;
  readonly suggestedTargetText?: string;
  readonly submittedAt?: string;
}): Promise<ContributionStateReceipt<"issue">> {
  const sourceText = normalizeMissingUiSourceText(input.sourceText);
  const currentTargetText = input.issueKind === "inaccurate"
    ? normalizeReportedTargetText(input.currentTargetText, "请填写当前显示的译文。")
    : undefined;
  const suggestedTargetText = normalizeOptionalReportedTargetText(input.suggestedTargetText);
  const evidence = {
    issueKind: input.issueKind,
    pluginId: input.pluginId,
    pluginVersion: input.pluginVersion,
    repository: input.repository,
    targetLocale: input.targetLocale,
    sourceText,
    ...(currentTargetText === undefined ? {} : { currentTargetText }),
    ...(suggestedTargetText === undefined ? {} : { suggestedTargetText }),
  };
  const digestPort = {
    async digest(bytes: Uint8Array): Promise<Uint8Array> {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
    },
  };
  const evidenceDigest = await computeProtocolDigest("request", evidence, digestPort);
  const idempotencyKey = `obsidian-localization-quality-v2-${await sha256Hex([
    input.issueKind,
    input.repository,
    input.pluginVersion,
    input.targetLocale,
    sourceText,
    currentTargetText ?? "",
    suggestedTargetText ?? "",
    OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex,
  ].join("\u0000"))}`;
  const payload: Omit<IssueIntent, "installationProof"> = {
    kind: "contribution_intent",
    protocol: CURRENT_PROTOCOL_VERSION,
    contributionType: "issue",
    idempotencyKey,
    installationId: input.installationId,
    submittedAt: input.submittedAt ?? new Date().toISOString(),
    targetHint: {
      externalRegistry: OBSIDIAN_PUBLIC_PROFILE.externalRegistry,
      externalObjectId: input.repository,
      upstreamVersion: input.pluginVersion,
      officialArtifactLocator: `https://github.com/${input.repository}`,
    },
    adapterHint: {
      definitionId: OBSIDIAN_PUBLIC_PROFILE.adapterDefinitionId,
      version: OBSIDIAN_PUBLIC_PROFILE.adapterVersion,
      buildDigest: createDigest("adapter_build", OBSIDIAN_PUBLIC_PROFILE.adapterBuildDigestHex),
    },
    provenance: {
      clientType: "public_plugin",
      clientVersion: OBSIDIAN_CLIENT_VERSION,
      userAction: "explicit_submit",
      observationDigest: evidenceDigest,
    },
    issue: {
      category: "localization_quality",
      severity: "info",
      summary: input.issueKind === "missing"
        ? `Missing UI localization: ${input.pluginId}@${input.pluginVersion} -> ${input.targetLocale}: ${sourceText}`
        : `Inaccurate upstream localization: ${input.pluginId}@${input.pluginVersion} -> ${input.targetLocale}: ${sourceText} => ${currentTargetText}${suggestedTargetText === undefined ? "" : `; suggested: ${suggestedTargetText}`}`,
      evidenceDigest,
    },
  };
  return input.client.submitContribution(payload) as Promise<ContributionStateReceipt<"issue">>;
}

export function submitObsidianMissingTranslationIssue(
  input: Omit<Parameters<typeof submitObsidianLocalizationIssue>[0], "issueKind">,
): Promise<ContributionStateReceipt<"issue">> {
  return submitObsidianLocalizationIssue({ ...input, issueKind: "missing" });
}

export function normalizeMissingUiSourceText(value: string): string {
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (normalized.length < 2) throw new Error("请填写仍显示的原文。");
  if (normalized.length > 500) throw new Error("原文最多 500 个字符。");
  return normalized;
}

export function normalizeReportedTargetText(value: string | undefined, emptyMessage: string): string {
  const normalized = value?.normalize("NFC").replace(/\s+/gu, " ").trim() ?? "";
  if (normalized.length < 1) throw new Error(emptyMessage);
  if (normalized.length > 500) throw new Error("单条译文不能超过 500 个字符。");
  return normalized;
}

function normalizeOptionalReportedTargetText(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return normalizeReportedTargetText(value, "");
}
