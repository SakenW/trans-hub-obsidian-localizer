/**
 * Wire shapes shared by every Source Submission client. They deliberately
 * contain only server-facing field names and primitives: workflow state,
 * transport, signing and retry policy remain in the caller's runtime.
 */
export type SourceSubmissionReceiptWire = Readonly<{
  submission_id: string | null;
  client_submission_id: string;
  source_stream_id: string;
  route_kind: "small" | "large";
  status: string;
  replayed: boolean;
  authorization_decision_id: string;
  authorization_reason_code: string;
}>;

export type PublishedSourceVersionWire = Readonly<{
  submission_id: string;
  source_stream_id: string;
  source_version_id: string | null;
  head_version: number | null;
  logical_snapshot_digest: string | null;
  event_id: string | null;
  replayed: boolean;
  authorization_decision_id: string;
  authorization_reason_code: string;
}>;

export type SourceSubmissionLeaseWire = Readonly<{
  submission_id: string;
  attempt_id: string | null;
  attempt_number: number | null;
  fencing_number: number | null;
  lease_expires_at: string | null;
  staged_byte_limit: number | null;
  staged_row_limit: number | null;
  replayed: boolean;
  authorization_decision_id: string;
  authorization_reason_code: string;
}>;

export type SourceSubmissionChunkReceiptWire = Readonly<{
  submission_id: string;
  attempt_id: string;
  chunk_id: string | null;
  chunk_index: number;
  fencing_number: number;
  staged_row_count: number;
  staged_byte_count: number;
  replayed: boolean;
  authorization_decision_id: string;
  authorization_reason_code: string;
}>;

export type SourceSubmissionStatusWire = Readonly<{
  submission_id: string;
  client_submission_id: string;
  source_stream_id: string;
  route_kind: "small" | "large";
  status: string;
  expected_head_version: number;
  source_version_id: string | null;
  head_version: number | null;
  logical_snapshot_digest: string | null;
  latest_attempt_id: string | null;
  latest_attempt_number: number | null;
  latest_fencing_number: number | null;
  lease_expires_at: string | null;
  created_at: string;
}>;

export type SourceSubmissionAttemptStatusWire = Readonly<{
  submission_id: string;
  attempt_id: string;
  attempt_number: number;
  status: string;
  fencing_number: number;
  lease_expires_at: string;
  staged_row_limit: number;
  staged_byte_limit: number;
  staged_row_count: number;
  staged_byte_count: number;
  chunk_count: number;
  created_at: string;
  completed_at: string | null;
}>;

/**
 * Exact server-side result for a source-submission command.
 *
 * This is wire data only: retry policy and local recovery decisions remain in
 * the caller's fixed workflow package.  Keeping the shape here lets every
 * ecosystem verify that a response still belongs to its original command.
 */
export type IngestionCommandResultWire = Readonly<{
  command_id: string;
  request_digest: string;
  command_kind: string;
  result_kind: string;
  submission_id: string;
  client_submission_id: string;
  source_stream_id: string;
  attempt_id: string | null;
  chunk_id: string | null;
  source_version_id: string | null;
  head_version: number | null;
  event_id: string | null;
  aggregate_version: number;
  authorization_decision_id: string;
  authorization_reason_code: string;
  created_at: string;
}>;
