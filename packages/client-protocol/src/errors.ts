export const CLIENT_PROTOCOL_ERROR_CODES = [
  "CP_INVALID_UTF8",
  "CP_INVALID_JSON",
  "CP_DUPLICATE_JSON_KEY",
  "CP_JSON_LIMIT_EXCEEDED",
  "CP_FLOAT_FORBIDDEN",
  "CP_INTEGER_OUT_OF_RANGE",
  "CP_UNPAIRED_SURROGATE",
  "CP_INVALID_TYPE",
  "CP_MISSING_FIELD",
  "CP_UNKNOWN_FIELD",
  "CP_INVALID_VALUE",
  "CP_UNSUPPORTED_PROTOCOL_REVISION",
  "CP_UNSUPPORTED_SCHEMA_REVISION",
  "CP_INVALID_DIGEST",
  "CP_DIGEST_DOMAIN_MISMATCH",
  "CP_REQUEST_DIGEST_MISMATCH",
  "CP_SIGNED_PAYLOAD_MISMATCH",
  "CP_ATTESTATION_PAYLOAD_MISMATCH",
  "CP_INVALID_LOCALE",
  "CP_INVALID_VARIANT",
  "CP_INVALID_TIMESTAMP",
  "CP_INVALID_NONCE",
  "CP_UNSAFE_LOCATOR",
  "CP_INVALID_MANIFEST_CLOSURE",
  "CP_INVALID_STATE_TRANSITION",
] as const;

export type ClientProtocolErrorCode = (typeof CLIENT_PROTOCOL_ERROR_CODES)[number];

export class ClientProtocolError extends Error {
  readonly code: ClientProtocolErrorCode;
  readonly path: string;

  constructor(code: ClientProtocolErrorCode, message: string, path = "$", options?: ErrorOptions) {
    super(message, options);
    this.name = "ClientProtocolError";
    this.code = code;
    this.path = path;
  }
}

export function protocolError(code: ClientProtocolErrorCode, path: string, message: string): never {
  throw new ClientProtocolError(code, message, path);
}
