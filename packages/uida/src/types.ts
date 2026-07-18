declare const uidaBrand: unique symbol;

export type Uida = string & { readonly [uidaBrand]: "Uida" };

export type UidaIdentityValue =
  | string
  | boolean
  | number
  | readonly UidaIdentityValue[]
  | { readonly [key: string]: UidaIdentityValue };

export interface UidaInput {
  readonly namespace: string;
  readonly identity: UidaIdentityValue;
}

export interface UidaResult {
  readonly uida: Uida;
  readonly canonicalBytes: Uint8Array;
  readonly hashBytes: Uint8Array;
  readonly hashHex: string;
}

export interface UidaIndexedResult {
  readonly index: number;
  readonly result: UidaResult;
}

export interface DigestPort {
  digest(data: Uint8Array): Promise<Uint8Array>;
}

export interface ComputeUidaOptions {
  readonly digestPort?: DigestPort;
  readonly signal?: AbortSignal;
}

export interface BatchUidaOptions extends ComputeUidaOptions {
  readonly concurrency?: number;
}
