import { protocolError } from "./errors.js";

export const CLIENT_PROTOCOL_ID = "trans-hub.client-protocol" as const;
export const CLIENT_PROTOCOL_REVISION = 1 as const;
export const MIN_SUPPORTED_CLIENT_PROTOCOL_REVISION = 1 as const;
export const CLIENT_SCHEMA_REVISION = 1 as const;

export interface ProtocolVersion {
  readonly protocol: typeof CLIENT_PROTOCOL_ID;
  readonly revision: typeof CLIENT_PROTOCOL_REVISION;
  readonly schemaRevision: typeof CLIENT_SCHEMA_REVISION;
}

export const CURRENT_PROTOCOL_VERSION: ProtocolVersion = Object.freeze({
  protocol: CLIENT_PROTOCOL_ID,
  revision: CLIENT_PROTOCOL_REVISION,
  schemaRevision: CLIENT_SCHEMA_REVISION,
});

export interface ProtocolRevisionRange {
  readonly minimum: number;
  readonly maximum: number;
}

export function negotiateProtocolRevision(
  peer: ProtocolRevisionRange
): typeof CLIENT_PROTOCOL_REVISION {
  if (
    !Number.isSafeInteger(peer.minimum) ||
    !Number.isSafeInteger(peer.maximum) ||
    peer.minimum < 1 ||
    peer.maximum < peer.minimum
  ) {
    protocolError("CP_INVALID_VALUE", "$.protocolRange", "protocol revision range is invalid");
  }
  if (
    peer.maximum < MIN_SUPPORTED_CLIENT_PROTOCOL_REVISION ||
    peer.minimum > CLIENT_PROTOCOL_REVISION
  ) {
    protocolError(
      "CP_UNSUPPORTED_PROTOCOL_REVISION",
      "$.protocolRange",
      `no compatible protocol revision; supported range is ${MIN_SUPPORTED_CLIENT_PROTOCOL_REVISION}-${CLIENT_PROTOCOL_REVISION}`
    );
  }
  return CLIENT_PROTOCOL_REVISION;
}
