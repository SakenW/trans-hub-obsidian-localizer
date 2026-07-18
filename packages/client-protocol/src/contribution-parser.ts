import type {
  ClientProvenance,
  ContributionIntent,
  ContributionTargetHint,
  InstallationProof,
} from "./contracts.js";
import { protocolError } from "./errors.js";
import { LOCALE_NORMALIZATION_REVISION } from "./locale.js";
import {
  CONTRIBUTION_TYPES,
  parseCanonicalLocale,
  parseCanonicalVariant,
  parseClientType,
  parseNullable,
  uniqueValues,
} from "./parser-primitives.js";
import {
  exactObject,
  expectArray,
  expectEd25519Signature,
  expectEnum,
  expectHttpsUrl,
  expectIdentifier,
  expectInteger,
  expectLiteral,
  expectNonce,
  expectString,
  expectTimestamp,
  expectUida,
  expectUuid,
  parseDigest,
  parseProtocolVersion,
  type UnknownRecord,
} from "./schema.js";

export function parseInstallationProof(value: unknown, path: string): InstallationProof {
  const record = exactObject(value, path, [
    "domain",
    "algorithm",
    "keyId",
    "requestDigest",
    "challenge",
    "nonce",
    "signedAt",
    "credentialEpoch",
    "signature",
  ]);
  return {
    domain: expectLiteral(record.domain, "public_contribution_intake", `${path}.domain`),
    algorithm: expectLiteral(record.algorithm, "ed25519", `${path}.algorithm`),
    keyId: expectIdentifier(record.keyId, `${path}.keyId`),
    requestDigest: parseDigest(record.requestDigest, "request", `${path}.requestDigest`),
    challenge: expectNonce(record.challenge, `${path}.challenge`),
    nonce: expectNonce(record.nonce, `${path}.nonce`),
    signedAt: expectTimestamp(record.signedAt, `${path}.signedAt`),
    credentialEpoch: expectInteger(record.credentialEpoch, `${path}.credentialEpoch`, {
      minimum: 1,
    }),
    signature: expectEd25519Signature(record.signature, `${path}.signature`),
  };
}

function parseTargetHint(value: unknown, path: string): ContributionTargetHint {
  const record = exactObject(value, path, [
    "externalRegistry",
    "externalObjectId",
    "upstreamVersion",
    "officialArtifactLocator",
  ]);
  return {
    externalRegistry: expectIdentifier(record.externalRegistry, `${path}.externalRegistry`),
    externalObjectId: expectString(record.externalObjectId, `${path}.externalObjectId`, {
      max: 512,
    }),
    upstreamVersion: parseNullable(record.upstreamVersion, (item) =>
      expectString(item, `${path}.upstreamVersion`, { max: 256 })
    ),
    officialArtifactLocator: parseNullable(record.officialArtifactLocator, (item) =>
      expectHttpsUrl(item, `${path}.officialArtifactLocator`)
    ),
  };
}

function parseAdapterHint(value: unknown, path: string) {
  const record = exactObject(value, path, ["definitionId", "version", "buildDigest"]);
  return {
    definitionId: expectIdentifier(record.definitionId, `${path}.definitionId`),
    version: expectString(record.version, `${path}.version`, { max: 64 }),
    buildDigest: parseDigest(record.buildDigest, "adapter_build", `${path}.buildDigest`),
  } as const;
}

function parseProvenance(value: unknown, path: string): ClientProvenance {
  const record = exactObject(value, path, [
    "clientType",
    "clientVersion",
    "userAction",
    "observationDigest",
  ]);
  return {
    clientType: parseClientType(record.clientType, `${path}.clientType`),
    clientVersion: expectString(record.clientVersion, `${path}.clientVersion`, {
      max: 64,
    }),
    userAction: expectEnum(
      record.userAction,
      ["automatic_observation", "explicit_submit", "explicit_edit"],
      `${path}.userAction`
    ),
    observationDigest: parseDigest(
      record.observationDigest,
      "request",
      `${path}.observationDigest`
    ),
  };
}

function parseContributionBase(record: UnknownRecord, path: string) {
  return {
    protocol: parseProtocolVersion(record.protocol, `${path}.protocol`),
    idempotencyKey: expectString(record.idempotencyKey, `${path}.idempotencyKey`, {
      min: 16,
      max: 128,
    }),
    installationId: expectUuid(record.installationId, `${path}.installationId`),
    submittedAt: expectTimestamp(record.submittedAt, `${path}.submittedAt`),
    targetHint: parseTargetHint(record.targetHint, `${path}.targetHint`),
    adapterHint: parseAdapterHint(record.adapterHint, `${path}.adapterHint`),
    provenance: parseProvenance(record.provenance, `${path}.provenance`),
    installationProof: parseInstallationProof(
      record.installationProof,
      `${path}.installationProof`
    ),
  };
}

const CONTRIBUTION_BASE_KEYS = [
  "kind",
  "protocol",
  "contributionType",
  "idempotencyKey",
  "installationId",
  "submittedAt",
  "targetHint",
  "adapterHint",
  "provenance",
  "installationProof",
] as const;
export function parseContributionIntent(value: unknown, path = "$"): ContributionIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    protocolError("CP_INVALID_TYPE", path, "expected a contribution object");
  }
  const initial = value as UnknownRecord;
  const contributionType = expectEnum(
    initial.contributionType,
    CONTRIBUTION_TYPES,
    `${path}.contributionType`
  );
  const payloadKey =
    contributionType === "ecosystem_claim"
      ? "claim"
      : contributionType === "source_discovery"
        ? "discovery"
        : contributionType === "localization_observation"
          ? "observation"
          : contributionType === "explicit_translation_candidate"
            ? "candidate"
            : "issue";
  const record = exactObject(value, path, [...CONTRIBUTION_BASE_KEYS, payloadKey]);
  expectLiteral(record.kind, "contribution_intent", `${path}.kind`);
  const base = parseContributionBase(record, path);

  if (contributionType === "ecosystem_claim") {
    const claim = exactObject(record.claim, `${path}.claim`, [
      "publisherHint",
      "namespaceHint",
      "summary",
    ]);
    return {
      kind: "contribution_intent",
      contributionType,
      ...base,
      claim: {
        publisherHint: expectString(claim.publisherHint, `${path}.claim.publisherHint`, {
          max: 256,
        }),
        namespaceHint: expectString(claim.namespaceHint, `${path}.claim.namespaceHint`, {
          max: 256,
        }),
        summary: expectString(claim.summary, `${path}.claim.summary`, {
          max: 4096,
        }),
      },
    };
  }

  if (contributionType === "source_discovery") {
    const discovery = exactObject(record.discovery, `${path}.discovery`, [
      "candidateLocators",
      "localArtifactDigest",
    ]);
    const candidateLocators = uniqueValues(
      expectArray(
        discovery.candidateLocators,
        `${path}.discovery.candidateLocators`,
        (item, itemPath) => expectHttpsUrl(item, itemPath),
        { minimum: 1, maximum: 32 }
      ),
      `${path}.discovery.candidateLocators`
    );
    return {
      kind: "contribution_intent",
      contributionType,
      ...base,
      discovery: {
        candidateLocators,
        localArtifactDigest: parseNullable(discovery.localArtifactDigest, (item) =>
          parseDigest(item, "transport", `${path}.discovery.localArtifactDigest`)
        ),
      },
    };
  }

  if (contributionType === "localization_observation") {
    const observation = exactObject(record.observation, `${path}.observation`, [
      "sourceLocaleRaw",
      "targetLocaleRaw",
      "variantRaw",
      "summaryDigest",
    ]);
    return {
      kind: "contribution_intent",
      contributionType,
      ...base,
      observation: {
        sourceLocaleRaw: expectString(
          observation.sourceLocaleRaw,
          `${path}.observation.sourceLocaleRaw`,
          { max: 64 }
        ),
        targetLocaleRaw: parseNullable(observation.targetLocaleRaw, (item) =>
          expectString(item, `${path}.observation.targetLocaleRaw`, { max: 64 })
        ),
        variantRaw: parseNullable(observation.variantRaw, (item) =>
          expectString(item, `${path}.observation.variantRaw`, { max: 64 })
        ),
        summaryDigest: parseDigest(
          observation.summaryDigest,
          "request",
          `${path}.observation.summaryDigest`
        ),
      },
    };
  }

  if (contributionType === "explicit_translation_candidate") {
    const candidate = exactObject(record.candidate, `${path}.candidate`, [
      "sourceHeadId",
      "sourceVersionId",
      "sourceDigest",
      "sourceLocale",
      "targetLocale",
      "variant",
      "localeNormalizationRevision",
      "semanticUnitUida",
      "placeholderContractDigest",
      "formatContractDigest",
      "translationDigest",
      "contentOrigin",
    ]);
    const sourceLocale = parseCanonicalLocale(
      candidate.sourceLocale,
      `${path}.candidate.sourceLocale`
    );
    const targetLocale = parseCanonicalLocale(
      candidate.targetLocale,
      `${path}.candidate.targetLocale`
    );
    if (sourceLocale === targetLocale) {
      protocolError(
        "CP_INVALID_LOCALE",
        `${path}.candidate.targetLocale`,
        "source and target locale must differ"
      );
    }
    return {
      kind: "contribution_intent",
      contributionType,
      ...base,
      candidate: {
        sourceHeadId: expectIdentifier(candidate.sourceHeadId, `${path}.candidate.sourceHeadId`),
        sourceVersionId: expectIdentifier(
          candidate.sourceVersionId,
          `${path}.candidate.sourceVersionId`
        ),
        sourceDigest: parseDigest(
          candidate.sourceDigest,
          "source",
          `${path}.candidate.sourceDigest`
        ),
        sourceLocale,
        targetLocale,
        variant: parseCanonicalVariant(candidate.variant, `${path}.candidate.variant`),
        localeNormalizationRevision: expectLiteral(
          candidate.localeNormalizationRevision,
          LOCALE_NORMALIZATION_REVISION,
          `${path}.candidate.localeNormalizationRevision`
        ),
        semanticUnitUida: expectUida(
          candidate.semanticUnitUida,
          `${path}.candidate.semanticUnitUida`
        ),
        placeholderContractDigest: parseDigest(
          candidate.placeholderContractDigest,
          "placeholder_contract",
          `${path}.candidate.placeholderContractDigest`
        ),
        formatContractDigest: parseDigest(
          candidate.formatContractDigest,
          "format_contract",
          `${path}.candidate.formatContractDigest`
        ),
        translationDigest: parseDigest(
          candidate.translationDigest,
          "translation",
          `${path}.candidate.translationDigest`
        ),
        contentOrigin: expectEnum(
          candidate.contentOrigin,
          ["user_edited", "imported", "unknown"],
          `${path}.candidate.contentOrigin`
        ),
      },
    };
  }

  const issue = exactObject(record.issue, `${path}.issue`, [
    "category",
    "severity",
    "summary",
    "evidenceDigest",
  ]);
  return {
    kind: "contribution_intent",
    contributionType,
    ...base,
    issue: {
      category: expectEnum(
        issue.category,
        ["metadata", "source_integrity", "localization_quality", "license", "other"],
        `${path}.issue.category`
      ),
      severity: expectEnum(
        issue.severity,
        ["info", "warning", "blocking"],
        `${path}.issue.severity`
      ),
      summary: expectString(issue.summary, `${path}.issue.summary`, {
        max: 8192,
      }),
      evidenceDigest: parseNullable(issue.evidenceDigest, (item) =>
        parseDigest(item, "request", `${path}.issue.evidenceDigest`)
      ),
    },
  };
}
