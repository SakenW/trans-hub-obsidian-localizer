import { UidaError } from "./errors.js";
import type { DigestPort } from "./types.js";

export function createWebCryptoDigestPort(
  ...arguments_: [] | [subtle: SubtleCrypto | undefined]
): DigestPort {
  const subtle =
    arguments_.length === 0 ? globalThis.crypto?.subtle : arguments_[0];
  return {
    async digest(data: Uint8Array): Promise<Uint8Array> {
      if (!subtle) {
        throw new UidaError(
          "UIDA_WEBCRYPTO_UNAVAILABLE",
          "WebCrypto subtle.digest is unavailable; inject a DigestPort",
        );
      }
      try {
        const input = new Uint8Array(data);
        return new Uint8Array(await subtle.digest("SHA-256", input));
      } catch (error) {
        if (error instanceof UidaError) throw error;
        throw new UidaError(
          "UIDA_DIGEST_FAILED",
          "WebCrypto SHA-256 digest failed",
          undefined,
          {
            cause: error,
          },
        );
      }
    },
  };
}
