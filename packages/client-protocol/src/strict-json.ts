import { ClientProtocolError, protocolError } from "./errors.js";

export interface StrictJsonLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxStringLength: number;
  readonly maxObjectKeys: number;
  readonly maxArrayLength: number;
}

export const DEFAULT_STRICT_JSON_LIMITS: StrictJsonLimits = Object.freeze({
  maxBytes: 1_048_576,
  maxDepth: 64,
  maxNodes: 100_000,
  maxStringLength: 262_144,
  maxObjectKeys: 10_000,
  maxArrayLength: 100_000,
});

const JSON_WHITESPACE = new Set([" ", "\n", "\r", "\t"]);
const HEX_QUAD_PATTERN = /^[0-9a-fA-F]{4}$/u;

function assertPairedSurrogates(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        protocolError(
          "CP_UNPAIRED_SURROGATE",
          path,
          "JSON strings must not contain unpaired UTF-16 surrogates"
        );
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      protocolError(
        "CP_UNPAIRED_SURROGATE",
        path,
        "JSON strings must not contain unpaired UTF-16 surrogates"
      );
    }
  }
}

class StrictJsonParser {
  private index = 0;
  private nodes = 0;

  constructor(
    private readonly source: string,
    private readonly limits: StrictJsonLimits
  ) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue("$", 0);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      this.fail("trailing content after JSON document");
    }
    return value;
  }

  private parseValue(path: string, depth: number): unknown {
    if (depth > this.limits.maxDepth) {
      protocolError("CP_JSON_LIMIT_EXCEEDED", path, `JSON nesting exceeds ${this.limits.maxDepth}`);
    }
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) {
      protocolError(
        "CP_JSON_LIMIT_EXCEEDED",
        path,
        `JSON node count exceeds ${this.limits.maxNodes}`
      );
    }
    const character = this.source[this.index];
    if (character === "{") return this.parseObject(path, depth + 1);
    if (character === "[") return this.parseArray(path, depth + 1);
    if (character === '"') return this.parseString(path);
    if (character === "t") return this.parseLiteral("true", true);
    if (character === "f") return this.parseLiteral("false", false);
    if (character === "n") return this.parseLiteral("null", null);
    if (character === "-" || (character !== undefined && /[0-9]/u.test(character))) {
      return this.parseInteger(path);
    }
    this.fail("expected a JSON value");
  }

  private parseObject(path: string, depth: number): Record<string, unknown> {
    this.index += 1;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (true) {
      if (this.source[this.index] !== '"') {
        this.fail("object keys must be JSON strings");
      }
      const key = this.parseString(path);
      if (keys.has(key)) {
        protocolError(
          "CP_DUPLICATE_JSON_KEY",
          `${path}.${key}`,
          `duplicate JSON key ${JSON.stringify(key)}`
        );
      }
      keys.add(key);
      if (keys.size > this.limits.maxObjectKeys) {
        protocolError(
          "CP_JSON_LIMIT_EXCEEDED",
          path,
          `object key count exceeds ${this.limits.maxObjectKeys}`
        );
      }
      this.skipWhitespace();
      if (this.source[this.index] !== ":") this.fail("expected ':' after object key");
      this.index += 1;
      this.skipWhitespace();
      result[key] = this.parseValue(`${path}.${key}`, depth);
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === "}") {
        this.index += 1;
        return result;
      }
      if (separator !== ",") this.fail("expected ',' or '}' in object");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseArray(path: string, depth: number): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (true) {
      if (result.length >= this.limits.maxArrayLength) {
        protocolError(
          "CP_JSON_LIMIT_EXCEEDED",
          path,
          `array length exceeds ${this.limits.maxArrayLength}`
        );
      }
      result.push(this.parseValue(`${path}[${result.length}]`, depth));
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === "]") {
        this.index += 1;
        return result;
      }
      if (separator !== ",") this.fail("expected ',' or ']' in array");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseString(path: string): string {
    const start = this.index;
    this.index += 1;
    let closed = false;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        closed = true;
        break;
      }
      if (character === "\\") {
        this.index += 1;
        const escapeCode = this.source[this.index];
        if (escapeCode === "u") {
          const quad = this.source.slice(this.index + 1, this.index + 5);
          if (!HEX_QUAD_PATTERN.test(quad)) this.fail("invalid Unicode escape");
          this.index += 5;
          continue;
        }
        if (escapeCode === undefined || !'"\\/bfnrt'.includes(escapeCode)) {
          this.fail("invalid JSON escape");
        }
        this.index += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        this.fail("unescaped control character in JSON string");
      }
      this.index += 1;
    }
    if (!closed) this.fail("unterminated JSON string");
    const raw = this.source.slice(start, this.index);
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new ClientProtocolError("CP_INVALID_JSON", "invalid JSON string", path, {
        cause: error,
      });
    }
    if (typeof value !== "string") this.fail("invalid JSON string");
    if (value.length > this.limits.maxStringLength) {
      protocolError(
        "CP_JSON_LIMIT_EXCEEDED",
        path,
        `string length exceeds ${this.limits.maxStringLength}`
      );
    }
    assertPairedSurrogates(value, path);
    return value;
  }

  private parseInteger(path: string): number {
    const remainder = this.source.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)/u.exec(remainder);
    if (match === null) this.fail("invalid JSON number");
    const token = match[0];
    this.index += token.length;
    const next = this.source[this.index];
    if (next === "." || next === "e" || next === "E") {
      protocolError(
        "CP_FLOAT_FORBIDDEN",
        path,
        "floating-point numbers are forbidden in protocol JSON"
      );
    }
    const value = Number(token);
    if (!Number.isSafeInteger(value)) {
      protocolError(
        "CP_INTEGER_OUT_OF_RANGE",
        path,
        "protocol integers must be within the JavaScript safe integer range"
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }

  private parseLiteral<T>(token: string, value: T): T {
    if (this.source.slice(this.index, this.index + token.length) !== token) {
      this.fail(`invalid JSON literal; expected ${token}`);
    }
    this.index += token.length;
    return value;
  }

  private skipWhitespace(): void {
    while (JSON_WHITESPACE.has(this.source[this.index] ?? "")) this.index += 1;
  }

  private fail(message: string): never {
    protocolError("CP_INVALID_JSON", `$@${this.index}`, `${message} at character ${this.index}`);
  }
}

export function parseStrictJson(
  input: string | Uint8Array,
  limits: StrictJsonLimits = DEFAULT_STRICT_JSON_LIMITS
): unknown {
  let source: string;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > limits.maxBytes) {
      protocolError("CP_JSON_LIMIT_EXCEEDED", "$", `JSON input exceeds ${limits.maxBytes} bytes`);
    }
    source = input;
  } else {
    if (input.byteLength > limits.maxBytes) {
      protocolError("CP_JSON_LIMIT_EXCEEDED", "$", `JSON input exceeds ${limits.maxBytes} bytes`);
    }
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch (error) {
      throw new ClientProtocolError("CP_INVALID_UTF8", "protocol JSON must be valid UTF-8", "$", {
        cause: error,
      });
    }
  }
  return new StrictJsonParser(source, limits).parse();
}
