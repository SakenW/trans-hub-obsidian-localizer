import { UidaError } from "./errors.js";

export const UIDA_RESOURCE_LIMITS = Object.freeze({
  maxDepth: 100,
  maxStringScalars: 10_000_000,
  maxArrayItems: 1_000_000,
  maxObjectKeys: 10_000,
  maxNodes: 1_000_000,
  maxCanonicalBytes: 64 * 1024 * 1024,
});

type NormalizedValue =
  | string
  | boolean
  | number
  | NormalizedValue[]
  | NormalizedObject;
interface NormalizedObject {
  [key: string]: NormalizedValue;
}

interface NormalizationState {
  readonly active: WeakSet<object>;
  nodes: number;
}

const textEncoder = new TextEncoder();

function scalarLength(value: string, path: string): number {
  let scalars = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new UidaError(
          "UIDA_UNPAIRED_SURROGATE",
          `Unpaired high surrogate at ${path}`,
          path,
        );
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new UidaError(
        "UIDA_UNPAIRED_SURROGATE",
        `Unpaired low surrogate at ${path}`,
        path,
      );
    }
    scalars += 1;
    if (scalars > UIDA_RESOURCE_LIMITS.maxStringScalars) {
      throw new UidaError(
        "UIDA_STRING_TOO_LONG",
        `String exceeds ${UIDA_RESOURCE_LIMITS.maxStringScalars} Unicode scalars at ${path}`,
        path,
      );
    }
  }
  return scalars;
}

function normalizeString(value: string, path: string): string {
  scalarLength(value, path);
  return value.normalize("NFC");
}

function enterNode(
  state: NormalizationState,
  depth: number,
  path: string,
): void {
  if (depth > UIDA_RESOURCE_LIMITS.maxDepth) {
    throw new UidaError(
      "UIDA_MAX_DEPTH_EXCEEDED",
      `Identity depth exceeds ${UIDA_RESOURCE_LIMITS.maxDepth} at ${path}`,
      path,
    );
  }
  state.nodes += 1;
  if (state.nodes > UIDA_RESOURCE_LIMITS.maxNodes) {
    throw new UidaError(
      "UIDA_NODE_LIMIT_EXCEEDED",
      `Identity exceeds ${UIDA_RESOURCE_LIMITS.maxNodes} nodes at ${path}`,
      path,
    );
  }
}

function withActiveObject<T>(
  value: object,
  state: NormalizationState,
  path: string,
  action: () => T,
): T {
  if (state.active.has(value)) {
    throw new UidaError(
      "UIDA_CIRCULAR_REFERENCE",
      `Circular reference at ${path}`,
      path,
    );
  }
  state.active.add(value);
  try {
    return action();
  } finally {
    state.active.delete(value);
  }
}

function normalizeArray(
  value: readonly unknown[],
  state: NormalizationState,
  depth: number,
  path: string,
): NormalizedValue[] {
  if (value.length > UIDA_RESOURCE_LIMITS.maxArrayItems) {
    throw new UidaError(
      "UIDA_ARRAY_TOO_LARGE",
      `Array exceeds ${UIDA_RESOURCE_LIMITS.maxArrayItems} items at ${path}`,
      path,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => {
      if (typeof key !== "string") return true;
      if (key === "length") return false;
      const index = Number(key);
      return (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= value.length ||
        String(index) !== key
      );
    })
  ) {
    throw new UidaError(
      "UIDA_UNSUPPORTED_TYPE",
      `Arrays cannot contain extra properties at ${path}`,
      path,
    );
  }
  return withActiveObject(value, state, path, () => {
    const normalized: NormalizedValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new UidaError(
          "UIDA_UNSUPPORTED_TYPE",
          `Array items must be enumerable data properties at ${path}[${index}]`,
          `${path}[${index}]`,
        );
      }
      normalized.push(
        normalizeValue(descriptor.value, state, depth + 1, `${path}[${index}]`),
      );
    }
    return normalized;
  });
}

function normalizeRecord(
  value: object,
  state: NormalizationState,
  depth: number,
  path: string,
): NormalizedObject {
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new UidaError(
      "UIDA_UNSUPPORTED_TYPE",
      `Only plain objects are valid UIDA objects at ${path}`,
      path,
    );
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > UIDA_RESOURCE_LIMITS.maxObjectKeys) {
    throw new UidaError(
      "UIDA_OBJECT_TOO_LARGE",
      `Object exceeds ${UIDA_RESOURCE_LIMITS.maxObjectKeys} keys at ${path}`,
      path,
    );
  }

  return withActiveObject(value, state, path, () => {
    const normalized: NormalizedObject = Object.create(
      null,
    ) as NormalizedObject;
    const seen = new Set<string>();
    for (const key of ownKeys) {
      if (typeof key !== "string") {
        throw new UidaError(
          "UIDA_UNSUPPORTED_TYPE",
          `Symbol object keys are not valid UIDA values at ${path}`,
          path,
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new UidaError(
          "UIDA_UNSUPPORTED_TYPE",
          `UIDA object properties must be enumerable data properties at ${path}.${key}`,
          `${path}.${key}`,
        );
      }
      const normalizedKey = normalizeString(key, `${path}.${key}`);
      if (seen.has(normalizedKey)) {
        throw new UidaError(
          "UIDA_NFC_KEY_COLLISION",
          `Object keys collide after NFC normalization at ${path}.${normalizedKey}`,
          path,
        );
      }
      seen.add(normalizedKey);
      normalized[normalizedKey] = normalizeValue(
        descriptor.value,
        state,
        depth + 1,
        `${path}.${normalizedKey}`,
      );
    }
    return normalized;
  });
}

function normalizeValue(
  value: unknown,
  state: NormalizationState,
  depth: number,
  path: string,
): NormalizedValue {
  enterNode(state, depth, path);
  if (typeof value === "string") return normalizeString(value, path);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new UidaError(
        "UIDA_FLOAT_FORBIDDEN",
        `Floats are forbidden at ${path}`,
        path,
      );
    }
    if (!Number.isSafeInteger(value)) {
      throw new UidaError(
        "UIDA_INTEGER_OUT_OF_RANGE",
        `Integer is outside the IEEE-754 safe range at ${path}`,
        path,
      );
    }
    return value;
  }
  if (value === null) {
    throw new UidaError(
      "UIDA_NULL_FORBIDDEN",
      `Null is forbidden at ${path}`,
      path,
    );
  }
  if (Array.isArray(value)) return normalizeArray(value, state, depth, path);
  if (typeof value === "object")
    return normalizeRecord(value, state, depth, path);
  throw new UidaError(
    "UIDA_UNSUPPORTED_TYPE",
    `Unsupported UIDA value type ${typeof value} at ${path}`,
    path,
  );
}

function serializeCanonical(value: NormalizedValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number")
    return String(value);
  if (Array.isArray(value))
    return `[${value.map(serializeCanonical).join(",")}]`;
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeCanonical(value[key])}`);
  return `{${entries.join(",")}}`;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > UIDA_RESOURCE_LIMITS.maxCanonicalBytes) return bytes;
  }
  return bytes;
}

export function canonicalizeUidaIdentity(identity: unknown): Uint8Array {
  const normalized = normalizeValue(
    identity,
    { active: new WeakSet(), nodes: 0 },
    0,
    "$",
  );
  const canonical = serializeCanonical(normalized);
  if (utf8ByteLength(canonical) > UIDA_RESOURCE_LIMITS.maxCanonicalBytes) {
    throw new UidaError(
      "UIDA_CANONICAL_BYTES_TOO_LARGE",
      `Canonical identity exceeds ${UIDA_RESOURCE_LIMITS.maxCanonicalBytes} bytes`,
      "$",
    );
  }
  return textEncoder.encode(canonical);
}
