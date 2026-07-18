export type UidaErrorCode =
  | "UIDA_ABORTED"
  | "UIDA_ARRAY_TOO_LARGE"
  | "UIDA_CANONICAL_BYTES_TOO_LARGE"
  | "UIDA_CIRCULAR_REFERENCE"
  | "UIDA_DIGEST_FAILED"
  | "UIDA_FLOAT_FORBIDDEN"
  | "UIDA_INTEGER_OUT_OF_RANGE"
  | "UIDA_INTERNAL_ERROR"
  | "UIDA_INVALID_CONCURRENCY"
  | "UIDA_INVALID_DIGEST"
  | "UIDA_INVALID_NAMESPACE"
  | "UIDA_MAX_DEPTH_EXCEEDED"
  | "UIDA_NFC_KEY_COLLISION"
  | "UIDA_NODE_LIMIT_EXCEEDED"
  | "UIDA_NULL_FORBIDDEN"
  | "UIDA_OBJECT_TOO_LARGE"
  | "UIDA_STRING_TOO_LONG"
  | "UIDA_UNPAIRED_SURROGATE"
  | "UIDA_UNSUPPORTED_TYPE"
  | "UIDA_WEBCRYPTO_UNAVAILABLE";

export class UidaError extends Error {
  readonly code: UidaErrorCode;
  readonly path?: string;

  constructor(
    code: UidaErrorCode,
    message: string,
    path?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "UidaError";
    this.code = code;
    this.path = path;
  }
}

export class UidaAbortError extends UidaError {
  constructor() {
    super("UIDA_ABORTED", "UIDA computation was aborted");
    this.name = "AbortError";
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new UidaAbortError();
}
