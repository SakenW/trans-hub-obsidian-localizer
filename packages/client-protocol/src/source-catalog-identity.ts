import { canonicalizeProtocolJsonWithLimits } from "./canonical.js";
import { protocolError } from "./errors.js";
import type { StrictJsonLimits } from "./strict-json.js";

export const SOURCE_CATALOG_IDENTITY_PROTOCOL =
  "trans-hub.source-catalog-identity" as const;
export const SOURCE_CATALOG_IDENTITY_REVISION = 1 as const;

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const SCOPE = /^[a-z][a-z0-9]*(?:[-.:][a-z0-9]+)*$/u;
const SOURCE_CATALOG_IDENTITY_LIMITS: StrictJsonLimits = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxStringLength: 1024 * 1024,
  maxObjectKeys: 10_000,
  maxArrayLength: 100_000,
});

export interface SourceCatalogIdentityUnitInput {
  readonly key: string;
  readonly text: string;
  readonly placeholderSignature: string;
  readonly formatSignature: string;
  readonly scopes: readonly string[];
}

export interface SourceCatalogIdentityInput {
  readonly resourceKey: string;
  readonly resourceVersion: string;
  readonly sourceLocale: string;
  readonly artifactDigest: string;
  readonly units: readonly SourceCatalogIdentityUnitInput[];
}

export interface SourceCatalogScopeIdentity {
  readonly scope: string;
  readonly unitCount: number;
  readonly digest: string;
}

export interface SourceCatalogIdentity {
  readonly protocol: typeof SOURCE_CATALOG_IDENTITY_PROTOCOL;
  readonly revision: typeof SOURCE_CATALOG_IDENTITY_REVISION;
  readonly resourceKey: string;
  readonly resourceVersion: string;
  readonly sourceLocale: string;
  readonly artifactDigest: string;
  readonly unitCount: number;
  readonly digest: string;
  readonly scopes: readonly SourceCatalogScopeIdentity[];
}

export interface SourceCatalogHashPort {
  sha256Hex(bytes: Uint8Array): Promise<string>;
}

interface NormalizedUnit {
  readonly key: string;
  readonly text: string;
  readonly placeholderSignature: string;
  readonly formatSignature: string;
  readonly scopes: readonly string[];
}

export async function computeSourceCatalogIdentity(
  input: SourceCatalogIdentityInput,
  hash: SourceCatalogHashPort,
): Promise<SourceCatalogIdentity> {
  const resourceKey = requiredText(input.resourceKey, "$.resourceKey", 200);
  const resourceVersion = requiredText(
    input.resourceVersion,
    "$.resourceVersion",
    240,
  );
  const sourceLocale = requiredText(input.sourceLocale, "$.sourceLocale", 64);
  if (!SHA256_HEX.test(input.artifactDigest)) {
    protocolError(
      "CP_INVALID_DIGEST",
      "$.artifactDigest",
      "artifact digest must be lowercase SHA-256",
    );
  }
  if (input.units.length === 0 || input.units.length > 100_000) {
    protocolError(
      "CP_INVALID_VALUE",
      "$.units",
      "source catalog must contain 1..100000 units",
    );
  }
  const keys = new Set<string>();
  const units = input.units
    .map((unit, index): NormalizedUnit => {
      const key = requiredText(unit.key, `$.units[${index}].key`, 240);
      if (keys.has(key)) {
        protocolError(
          "CP_INVALID_VALUE",
          `$.units[${index}].key`,
          "source catalog unit keys must be unique",
        );
      }
      keys.add(key);
      const scopes = [
        ...new Set(
          unit.scopes.map((scope, scopeIndex) => {
            const value = requiredText(
              scope,
              `$.units[${index}].scopes[${scopeIndex}]`,
              64,
            );
            if (!SCOPE.test(value)) {
              protocolError(
                "CP_INVALID_VALUE",
                `$.units[${index}].scopes[${scopeIndex}]`,
                "invalid content scope",
              );
            }
            return value;
          }),
        ),
      ].sort();
      if (scopes.length === 0 || scopes.length > 64) {
        protocolError(
          "CP_INVALID_VALUE",
          `$.units[${index}].scopes`,
          "each unit needs 1..64 content scopes",
        );
      }
      return {
        key,
        text: requiredText(unit.text, `$.units[${index}].text`, 1024 * 1024),
        placeholderSignature: boundedText(
          unit.placeholderSignature,
          `$.units[${index}].placeholderSignature`,
          4096,
        ),
        formatSignature: boundedText(
          unit.formatSignature,
          `$.units[${index}].formatSignature`,
          4096,
        ),
        scopes,
      };
    })
    .sort((left, right) => compareUnicodeScalar(left.key, right.key));

  const base = {
    protocol: SOURCE_CATALOG_IDENTITY_PROTOCOL,
    revision: SOURCE_CATALOG_IDENTITY_REVISION,
    resourceKey,
    resourceVersion,
    sourceLocale,
    artifactDigest: input.artifactDigest,
  } as const;
  const digest = await checkedDigest(hash, { ...base, units }, "$.digest");
  const scopeNames = [...new Set(units.flatMap((unit) => unit.scopes))].sort();
  const scopes = await Promise.all(
    scopeNames.map(async (scope): Promise<SourceCatalogScopeIdentity> => {
      const scopedUnits = units
        .filter((unit) => unit.scopes.includes(scope))
        .map(({ scopes: _scopes, ...unit }) => unit);
      return {
        scope,
        unitCount: scopedUnits.length,
        digest: await checkedDigest(
          hash,
          { ...base, scope, units: scopedUnits },
          `$.scopes.${scope}.digest`,
        ),
      };
    }),
  );
  return Object.freeze({
    ...base,
    unitCount: units.length,
    digest,
    scopes: Object.freeze(scopes.map((scope) => Object.freeze(scope))),
  });
}

function compareUnicodeScalar(left: string, right: string): number {
  const leftScalars = [...left];
  const rightScalars = [...right];
  const length = Math.min(leftScalars.length, rightScalars.length);
  for (let index = 0; index < length; index += 1) {
    const leftScalar = leftScalars[index];
    const rightScalar = rightScalars[index];
    if (leftScalar === undefined || rightScalar === undefined) {
      throw new Error("source_catalog_scalar_missing");
    }
    const leftCodePoint = leftScalar.codePointAt(0);
    const rightCodePoint = rightScalar.codePointAt(0);
    if (leftCodePoint === undefined || rightCodePoint === undefined) {
      throw new Error("source_catalog_code_point_missing");
    }
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint;
  }
  return leftScalars.length - rightScalars.length;
}

export function parseSourceCatalogIdentity(
  input: unknown,
): SourceCatalogIdentity {
  if (!isRecord(input)) {
    protocolError("CP_INVALID_TYPE", "$", "catalog identity must be an object");
  }
  assertExactKeys(input, [
    "protocol",
    "revision",
    "resourceKey",
    "resourceVersion",
    "sourceLocale",
    "artifactDigest",
    "unitCount",
    "digest",
    "scopes",
  ]);
  if (
    input.protocol !== SOURCE_CATALOG_IDENTITY_PROTOCOL ||
    input.revision !== SOURCE_CATALOG_IDENTITY_REVISION
  ) {
    protocolError(
      "CP_UNSUPPORTED_PROTOCOL_REVISION",
      "$.revision",
      "unsupported source catalog identity revision",
    );
  }
  const unitCount = nonNegativeInteger(input.unitCount, "$.unitCount");
  if (
    !Array.isArray(input.scopes) ||
    input.scopes.length === 0 ||
    input.scopes.length > 64
  ) {
    protocolError(
      "CP_INVALID_VALUE",
      "$.scopes",
      "catalog identity needs 1..64 scopes",
    );
  }
  const scopes = input.scopes.map(
    (candidate, index): SourceCatalogScopeIdentity => {
      if (!isRecord(candidate)) {
        protocolError(
          "CP_INVALID_TYPE",
          `$.scopes[${index}]`,
          "scope identity must be an object",
        );
      }
      assertExactKeys(
        candidate,
        ["scope", "unitCount", "digest"],
        `$.scopes[${index}]`,
      );
      const scope = requiredUnknownText(
        candidate.scope,
        `$.scopes[${index}].scope`,
        64,
      );
      if (!SCOPE.test(scope)) {
        protocolError(
          "CP_INVALID_VALUE",
          `$.scopes[${index}].scope`,
          "invalid content scope",
        );
      }
      const digest = String(candidate.digest ?? "");
      if (!SHA256_HEX.test(digest)) {
        protocolError(
          "CP_INVALID_DIGEST",
          `$.scopes[${index}].digest`,
          "invalid scope digest",
        );
      }
      return Object.freeze({
        scope,
        unitCount: nonNegativeInteger(
          candidate.unitCount,
          `$.scopes[${index}].unitCount`,
        ),
        digest,
      });
    },
  );
  const scopeNames = scopes.map((scope) => scope.scope);
  if (scopeNames.join("\0") !== [...new Set(scopeNames)].sort().join("\0")) {
    protocolError(
      "CP_INVALID_VALUE",
      "$.scopes",
      "scope identities must be unique and sorted",
    );
  }
  const artifactDigest = String(input.artifactDigest ?? "");
  const digest = String(input.digest ?? "");
  if (!SHA256_HEX.test(artifactDigest) || !SHA256_HEX.test(digest)) {
    protocolError(
      "CP_INVALID_DIGEST",
      "$.digest",
      "catalog identity digests are invalid",
    );
  }
  return Object.freeze({
    protocol: SOURCE_CATALOG_IDENTITY_PROTOCOL,
    revision: SOURCE_CATALOG_IDENTITY_REVISION,
    resourceKey: requiredUnknownText(input.resourceKey, "$.resourceKey", 200),
    resourceVersion: requiredUnknownText(
      input.resourceVersion,
      "$.resourceVersion",
      240,
    ),
    sourceLocale: requiredUnknownText(input.sourceLocale, "$.sourceLocale", 64),
    artifactDigest,
    unitCount,
    digest,
    scopes: Object.freeze(scopes),
  });
}

async function checkedDigest(
  hash: SourceCatalogHashPort,
  value: unknown,
  path: string,
): Promise<string> {
  const digest = await hash.sha256Hex(
    canonicalizeProtocolJsonWithLimits(value, SOURCE_CATALOG_IDENTITY_LIMITS),
  );
  if (!SHA256_HEX.test(digest)) {
    protocolError(
      "CP_INVALID_DIGEST",
      path,
      "hash port must return lowercase SHA-256",
    );
  }
  return digest;
}

function requiredText(value: string, path: string, maxLength: number): string {
  const normalized = boundedText(value, path, maxLength).normalize("NFC");
  if (normalized.trim() === "") {
    protocolError("CP_INVALID_VALUE", path, "value must not be blank");
  }
  return normalized;
}

function requiredUnknownText(
  value: unknown,
  path: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    protocolError("CP_INVALID_TYPE", path, "value must be a string");
  }
  return requiredText(value, path, maxLength);
}

function boundedText(value: string, path: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      `text exceeds ${maxLength} characters`,
    );
  }
  return value.normalize("NFC");
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    protocolError(
      "CP_INVALID_VALUE",
      path,
      "value must be a non-negative safe integer",
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path = "$",
): void {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.join("\0") !== wanted.join("\0")) {
    protocolError(
      "CP_UNKNOWN_FIELD",
      path,
      "catalog identity fields do not match the contract",
    );
  }
}
