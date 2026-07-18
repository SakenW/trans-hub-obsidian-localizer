import type {
  NativeTransferCapabilityWire,
  ProviderUploadGrantWire,
} from "@trans-hub/client-protocol";

import type { NativePreparedPublicByteSource, PublicProviderUploadPort } from "./ports.js";

export interface NativeProviderUploadStatus {
  readonly sessionHandle: string;
  readonly sessionId: string;
  readonly lane: "public";
  readonly direction: "upload";
  readonly status: "completed";
  readonly transferredBytes: number;
  readonly objectBytes: number;
  readonly completionHandle: string;
}

export interface NativeProviderUploadBridgePort {
  startUpload(
    input: {
      readonly capability: NativeTransferCapabilityWire;
      readonly payloadHandle: string;
      readonly resumeCancelled: false;
      readonly grant: ProviderUploadGrantWire;
    },
    signal?: AbortSignal
  ): Promise<NativeProviderUploadStatus>;
}

const NATIVE_PAYLOAD_HANDLE = /^obj-[0-9a-f]{64}$/u;

/**
 * Adapts the platform-neutral Public Client to a product shell's Private Native
 * Core bridge. It never opens source bytes in JavaScript: the Core reopens the
 * encrypted CAS handle, verifies the server capability, and performs the upload.
 */
export function createNativeProviderUploadPort(
  bridge: NativeProviderUploadBridgePort
): PublicProviderUploadPort {
  return {
    async upload(input): Promise<void> {
      const source = nativePreparedSource(input.source);
      const authorization = input.nativeCapability.authorization;
      if (
        source.transportDigest.algorithm !== input.expected.transportDigest.algorithm ||
        source.transportDigest.domain !== input.expected.transportDigest.domain ||
        source.transportDigest.hex !== input.expected.transportDigest.hex ||
        source.contentLength !== input.expected.contentLength ||
        authorization.object_digest !== `sha256:${input.expected.transportDigest.hex}` ||
        authorization.object_bytes !== input.expected.contentLength
      ) {
        throw new Error("public_native_upload_source_scope_mismatch");
      }
      const status = await bridge.startUpload(
        {
          capability: input.nativeCapability,
          payloadHandle: source.payloadHandle,
          resumeCancelled: false,
          grant: input.providerGrant,
        },
        input.signal
      );
      if (
        status.status !== "completed" ||
        status.lane !== "public" ||
        status.direction !== "upload" ||
        status.sessionId !== authorization.session_id ||
        status.objectBytes !== authorization.object_bytes ||
        status.transferredBytes !== authorization.object_bytes ||
        status.sessionHandle.length === 0 ||
        status.completionHandle.length === 0
      ) {
        throw new Error("public_native_upload_completion_invalid");
      }
    },
  };
}

function nativePreparedSource(value: unknown): NativePreparedPublicByteSource {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "native_prepared_public_source" ||
    !("payloadHandle" in value) ||
    typeof value.payloadHandle !== "string" ||
    !NATIVE_PAYLOAD_HANDLE.test(value.payloadHandle) ||
    !("transportDigest" in value) ||
    typeof value.transportDigest !== "object" ||
    value.transportDigest === null ||
    !("algorithm" in value.transportDigest) ||
    value.transportDigest.algorithm !== "sha256" ||
    !("domain" in value.transportDigest) ||
    value.transportDigest.domain !== "transport" ||
    !("hex" in value.transportDigest) ||
    typeof value.transportDigest.hex !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.transportDigest.hex) ||
    !("contentLength" in value) ||
    typeof value.contentLength !== "number" ||
    !Number.isSafeInteger(value.contentLength) ||
    value.contentLength <= 0 ||
    !("open" in value) ||
    typeof value.open !== "function"
  ) {
    throw new Error("public_native_upload_source_required");
  }
  return value as NativePreparedPublicByteSource;
}
