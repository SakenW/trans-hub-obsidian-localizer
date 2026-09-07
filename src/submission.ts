import {
  CURRENT_PROTOCOL_VERSION,
  computeProtocolDigest,
  createDigest,
  type ContributionStateReceipt,
  type LocalizationObservationIntent,
  type PublicDiscoveryReceipt,
} from "@trans-hub/client-protocol";
import type { PublicClient } from "@trans-hub/public-client";

import { sha256Hex } from "./identity";
import type { PluginUiCatalog } from "./plugin-string-scanner";
import { OBSIDIAN_CLIENT_VERSION } from "./product-config";

export const OBSIDIAN_PUBLIC_PROFILE = {
  externalRegistry: "official-directory",
  adapterDefinitionId: "obsidian",
  adapterVersion: "1.4.6",
  adapterBuildDigestHex: "bb81e7a6012cedb88222360f6de3fd85259c99b803066cc86952994206ab2f6d",
  registryPolicyRevision: 26,
  // This is a new public-source namespace. It starts after the legacy
  // discovery runtime was retired, so a persisted v2 receipt cannot be
  // replayed into the clean intake path.
  discoveryEpoch: 3,
  sourceDiscoveryEpoch: 24,
} as const;

// This is a retry namespace for a failed observation that has no saved
// contribution id. Successfully accepted observations are not force-resubmitted
// by changing this constant alone.
const LOCALIZATION_OBSERVATION_EPOCH = 12;

export async function submitObsidianPluginDiscovery(input: {
  readonly client: PublicClient;
  readonly installationId: string;
  readonly catalog: PluginUiCatalog;
  readonly targetLocales: readonly string[];
  readonly observationGeneration?: number;
}): Promise<PublicDiscoveryReceipt> {
  const targetLocales = [...new Set(input.targetLocales)].sort();
  if (targetLocales.length === 0) throw new Error("公共发现至少需要一个目标语言。");
  const generationSuffix = observationGenerationSuffix(input.observationGeneration);
  const idempotencyKey = `obsidian-public-discovery-v${OBSIDIAN_PUBLIC_PROFILE.discoveryEpoch}${generationSuffix}-${await sha256Hex([
    input.catalog.pluginId,
    targetLocales.join("\u0000"),
    input.catalog.scannedAt,
    OBSIDIAN_CLIENT_VERSION,
  ].join("\u0000"))}`;
  return input.client.submitPublicDiscovery({
    kind: "public_discovery_intent",
    protocol: CURRENT_PROTOCOL_VERSION,
    idempotencyKey,
    installationId: input.installationId,
    submittedAt: input.catalog.scannedAt,
    target: {
      registryKey: OBSIDIAN_PUBLIC_PROFILE.externalRegistry,
      externalObjectId: input.catalog.pluginId,
    },
    targetLocales,
  });
}

export async function submitObsidianLocalizationObservation(input: {
  readonly client: PublicClient;
  readonly installationId: string;
  readonly catalog: PluginUiCatalog;
  readonly repository: string;
  readonly targetLocale: string;
  readonly observationGeneration?: number;
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
  const generationSuffix = observationGenerationSuffix(input.observationGeneration);
  const idempotencyKey = `obsidian-localize-v${LOCALIZATION_OBSERVATION_EPOCH}${generationSuffix}-${await sha256Hex([
    input.repository,
    input.catalog.pluginVersion,
    input.targetLocale,
    input.catalog.digest,
    input.catalog.scannedAt,
    OBSIDIAN_CLIENT_VERSION,
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

function observationGenerationSuffix(generation: number | undefined): string {
  if (generation === undefined || generation === 0) return "";
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("observation_generation_invalid");
  }
  return `-r${generation}`;
}
