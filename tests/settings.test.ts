import { describe, expect, it } from "vitest";

import { assertSafeApiBaseUrl, normalizeHttpBaseUrl } from "../src/api-base-url";

describe("normalizeHttpBaseUrl", () => {
  it("接受 http(s) 并移除末尾斜杠", () => {
    expect(normalizeHttpBaseUrl(" https://th.example.com/ ")).toBe(
      "https://th.example.com",
    );
    expect(normalizeHttpBaseUrl("http://127.0.0.1:8000/")).toBe(
      "http://127.0.0.1:8000",
    );
  });

  it("拒绝非 http(s) 和 URL 内嵌凭据", () => {
    expect(normalizeHttpBaseUrl("file:///tmp/trans-hub")).toBeNull();
    expect(normalizeHttpBaseUrl("https://user:secret@th.example.com")).toBeNull();
    expect(normalizeHttpBaseUrl("not a url")).toBeNull();
  });

  it("只允许本地 HTTP，远端必须使用 HTTPS", () => {
    expect(assertSafeApiBaseUrl("http://localhost:8000")).toBe("http://localhost:8000");
    expect(() => assertSafeApiBaseUrl("http://th.example.com")).toThrow("HTTPS");
    expect(assertSafeApiBaseUrl("https://th.example.com")).toBe("https://th.example.com");
  });
});
