import { createDigest, digestDomainSeparator, type TransportDigest } from "./digest.js";
import { protocolError } from "./errors.js";

export interface ProtocolStreamingDigestPort {
  digest(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array>;
}

async function* framedTransportChunks(
  chunks: AsyncIterable<Uint8Array>
): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(digestDomainSeparator("transport"));
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) {
      protocolError("CP_INVALID_TYPE", "$.transport", "transport chunks must be Uint8Array");
    }
    yield chunk;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function computeTransportDigest(
  chunks: AsyncIterable<Uint8Array>,
  digestPort: ProtocolStreamingDigestPort
): Promise<TransportDigest> {
  const digestBytes = await digestPort.digest(framedTransportChunks(chunks));
  if (digestBytes.byteLength !== 32) {
    protocolError("CP_INVALID_DIGEST", "$.transport", "digest port must return exactly 32 bytes");
  }
  return createDigest("transport", bytesToHex(digestBytes));
}
