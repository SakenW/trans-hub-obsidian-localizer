export { computeUidaBatch, iterateUida } from "./batch.js";
export {
  canonicalizeUidaIdentity,
  UIDA_RESOURCE_LIMITS,
} from "./canonicalization.js";
export { computeUida, verifyUida } from "./compute.js";
export { createWebCryptoDigestPort } from "./digest.js";
export { UidaAbortError, UidaError, type UidaErrorCode } from "./errors.js";
export type {
  BatchUidaOptions,
  ComputeUidaOptions,
  DigestPort,
  Uida,
  UidaIdentityValue,
  UidaIndexedResult,
  UidaInput,
  UidaResult,
} from "./types.js";
