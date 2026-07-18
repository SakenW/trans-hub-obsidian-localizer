import { ClientProtocolError } from "@trans-hub/client-protocol";

export const PUBLIC_CLIENT_ERROR_CODES = [
  "PC_ABORTED",
  "PC_CONFIGURATION",
  "PC_CREDENTIAL_AUDIENCE",
  "PC_PROTOCOL_REJECTED",
  "PC_TRANSPORT",
  "PC_HTTP_STATUS",
  "PC_RETRY_EXHAUSTED",
  "PC_SIGNING_FAILED",
  "PC_SIGNATURE_INVALID",
  "PC_EXPIRED",
  "PC_CLOCK_SKEW",
  "PC_SCOPE_MISMATCH",
  "PC_DIGEST_MISMATCH",
  "PC_LENGTH_MISMATCH",
  "PC_STORAGE",
  "PC_SOURCE",
  "PC_SINK",
] as const;

export type PublicClientErrorCode = (typeof PUBLIC_CLIENT_ERROR_CODES)[number];

export interface PublicClientDiagnostic {
  readonly operation: string;
  readonly attempt?: number;
  readonly status?: number;
  readonly protocolCode?: string;
  readonly detail?: string;
}

export class PublicClientError extends Error {
  readonly code: PublicClientErrorCode;
  readonly retryable: boolean;
  readonly diagnostic: PublicClientDiagnostic;

  constructor(
    code: PublicClientErrorCode,
    message: string,
    options: {
      readonly retryable?: boolean;
      readonly diagnostic: PublicClientDiagnostic;
      readonly cause?: unknown;
    }
  ) {
    super(
      message,
      options.cause === undefined
        ? undefined
        : { cause: new Error("Underlying public-client error details were redacted") }
    );
    this.name = "PublicClientError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.diagnostic = Object.freeze({ ...options.diagnostic });
  }
}

export function publicClientError(
  code: PublicClientErrorCode,
  message: string,
  diagnostic: PublicClientDiagnostic,
  options?: { readonly retryable?: boolean; readonly cause?: unknown }
): PublicClientError {
  return new PublicClientError(code, message, {
    diagnostic,
    ...(options?.retryable === undefined ? {} : { retryable: options.retryable }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}

export function normalizeError(error: unknown, operation: string): PublicClientError {
  if (error instanceof PublicClientError) return error;
  if (error instanceof ClientProtocolError) {
    return publicClientError(
      "PC_PROTOCOL_REJECTED",
      "The server response violated the public protocol contract",
      { operation, protocolCode: error.code, detail: safeProtocolPath(error.path) },
      { cause: error }
    );
  }
  if (error instanceof Error && error.name === "AbortError") {
    return publicClientError(
      "PC_ABORTED",
      "The operation was cancelled",
      { operation },
      { cause: error }
    );
  }
  return publicClientError(
    "PC_TRANSPORT",
    "The transport operation failed",
    { operation },
    { cause: error, retryable: true }
  );
}

function safeProtocolPath(path: string): string {
  return path.length <= 256 && /^\$(?:\.[A-Za-z][A-Za-z0-9_]*|\[[0-9]+\])*$/u.test(path)
    ? path
    : "$";
}

export function protocolBoundary<T>(operation: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw normalizeError(error, operation);
  }
}
