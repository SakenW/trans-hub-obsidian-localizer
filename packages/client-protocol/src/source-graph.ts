/** Ecosystem-neutral, normalized source graph exchanged by every adapter. */
export type SourceGraphJsonValue =
  | string
  | number
  | boolean
  | null
  | SourceGraphJsonValue[]
  | { [key: string]: SourceGraphJsonValue };

export type NamespaceContractEvidence = {
  namespaceKey: string; namespaceContractId: string; namespaceId: string;
  namespaceSchemaRevisionId: string; namespaceSchemaRevision: number; contractDigest: string;
};

export type CanonicalNamespaceRevision = {
  rowOrdinal: number; namespaceContractId: string; namespaceId: string;
  namespaceSchemaRevisionId: string; namespaceSchemaRevision: number;
  contractDigestHex: string; evidenceDigestHex: string;
};
export type CanonicalContentSource = {
  rowOrdinal: number; sourceKey: string; sourceLocale: string; sourceDigestHex: string;
  provenance: { [key: string]: SourceGraphJsonValue };
};
export type CanonicalAtom = {
  rowOrdinal: number; sourceLocale: string; canonicalContentHex: string; contentDigestHex: string;
  placeholderSignature?: string | null; formatSignature?: string | null;
};
export type CanonicalUnit = {
  rowOrdinal: number; namespaceContractId: string; namespaceId: string;
  namespaceSchemaRevisionId: string; canonicalIdentityHex: string; uidaHashHex: string;
};
export type CanonicalOccurrence = {
  rowOrdinal: number; occurrenceKey: string; occurrenceDigestHex: string;
  stagedContentSourceOrdinal: number; stagedAtomOrdinal: number; stagedUnitOrdinal: number;
  orderIndex: number; context: { [key: string]: SourceGraphJsonValue };
};
export type CanonicalSourceSnapshot = {
  namespaceRevisions: readonly CanonicalNamespaceRevision[];
  contentSources: readonly CanonicalContentSource[];
  atoms: readonly CanonicalAtom[]; units: readonly CanonicalUnit[];
  occurrences: readonly CanonicalOccurrence[];
};
export type SourceSnapshotCompletenessEvidence = {
  discoveredContentSourceCount: number; submittedContentSourceCount: number;
  omittedContentSourceCount: number; discoveredOccurrenceCount: number;
  submittedOccurrenceCount: number; omittedOccurrenceCount: number;
};
export type CanonicalSourceChunk = Partial<CanonicalSourceSnapshot>;
