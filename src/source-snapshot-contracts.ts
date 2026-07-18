export type SourceSubmissionJsonValue =
  | string
  | number
  | boolean
  | null
  | SourceSubmissionJsonValue[]
  | { readonly [key: string]: SourceSubmissionJsonValue };

export interface NamespaceContractEvidence {
  readonly namespaceKey: string;
  readonly namespaceContractId: string;
  readonly namespaceId: string;
  readonly namespaceSchemaRevisionId: string;
  readonly namespaceSchemaRevision: number;
  readonly contractDigest: string;
}

export interface CanonicalSourceSnapshot {
  readonly namespaceRevisions: readonly {
    readonly rowOrdinal: number;
    readonly namespaceContractId: string;
    readonly namespaceId: string;
    readonly namespaceSchemaRevisionId: string;
    readonly namespaceSchemaRevision: number;
    readonly contractDigestHex: string;
    readonly evidenceDigestHex: string;
  }[];
  readonly contentSources: readonly {
    readonly rowOrdinal: number;
    readonly sourceKey: string;
    readonly sourceLocale: string;
    readonly sourceDigestHex: string;
    readonly provenance: Readonly<Record<string, SourceSubmissionJsonValue>>;
  }[];
  readonly atoms: readonly {
    readonly rowOrdinal: number;
    readonly sourceLocale: string;
    readonly canonicalContentHex: string;
    readonly contentDigestHex: string;
    readonly placeholderSignature?: string | null;
    readonly formatSignature?: string | null;
  }[];
  readonly units: readonly {
    readonly rowOrdinal: number;
    readonly namespaceContractId: string;
    readonly namespaceId: string;
    readonly namespaceSchemaRevisionId: string;
    readonly canonicalIdentityHex: string;
    readonly uidaHashHex: string;
  }[];
  readonly occurrences: readonly {
    readonly rowOrdinal: number;
    readonly occurrenceKey: string;
    readonly occurrenceDigestHex: string;
    readonly stagedContentSourceOrdinal: number;
    readonly stagedAtomOrdinal: number;
    readonly stagedUnitOrdinal: number;
    readonly orderIndex: number;
    readonly context: Readonly<Record<string, SourceSubmissionJsonValue>>;
  }[];
}

export function postgresJsonbText(value: SourceSubmissionJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("json_number_not_finite");
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(", ")}]`;
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.length - right.length || left.localeCompare(right),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}: ${postgresJsonbText(item)}`).join(", ")}}`;
}
