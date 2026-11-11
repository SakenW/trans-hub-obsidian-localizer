import { afterEach, describe, expect, it, vi } from "vitest";

const sodium = vi.hoisted(() => ({
  ready: Promise.resolve(),
  from_hex: vi.fn(() => new Uint8Array(32)),
  crypto_sign_seed_keypair: vi.fn(() => ({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(64) })),
  crypto_sign_detached: vi.fn(() => new Uint8Array(64)),
  crypto_sign_verify_detached: vi.fn(() => false),
  to_hex: vi.fn(() => "invalid-self-test-output"),
  memzero: vi.fn((bytes: Uint8Array) => bytes.fill(0)),
}));
vi.mock("libsodium-wrappers", () => ({ default: sodium }));
import { loadWasmEd25519 } from "../src/ed25519-wasm";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("WASM initialization is fail closed", () => {
  it("rejects missing WASM before importing or using the implementation", async () => {
    vi.stubGlobal("WebAssembly", undefined);
    await expect(loadWasmEd25519()).rejects.toThrow("不支持 WASM");
    expect(sodium.crypto_sign_seed_keypair).not.toHaveBeenCalled();
  });

  it("rejects incorrect self-test outputs and clears test secrets", async () => {
    const error: unknown = await loadWasmEd25519().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected initialization failure");
    expect(error.message).toContain("初始化失败");
    expect(error.cause).toBeInstanceOf(Error);
    if (!(error.cause instanceof Error)) throw new Error("Expected self-test failure cause");
    expect(error.cause.message).toBe("wasm_ed25519_self_test_failed");
    expect(sodium.memzero).toHaveBeenCalledTimes(2);
  });
});
