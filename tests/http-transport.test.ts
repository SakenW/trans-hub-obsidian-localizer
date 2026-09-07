import type { ControlHttpRequest } from "@trans-hub/public-client";
import { afterEach, describe, expect, it } from "vitest";

import { ObsidianHttpTransport } from "../src/http-transport";
import { resetRequestUrlHandler, setRequestUrlHandler } from "./obsidian-mock";

afterEach(() => {
  resetRequestUrlHandler();
});

describe("ObsidianHttpTransport", () => {
  it("prevents cached authenticated discovery status reads", async () => {
    let captured: unknown;
    setRequestUrlHandler((input) => {
      captured = input;
      return Promise.resolve({
        status: 200,
        text: "{}",
        headers: {},
      });
    });
    const request: ControlHttpRequest = {
      method: "GET",
      path: "/v1/public-client/discoveries/discovery-id/status",
      headers: {},
      body: null,
      credential: {
        audience: "public-contribution-intake",
        plane: "public",
        installationId: "installation-id",
        sessionId: "session-id",
        credentialEpoch: 1,
        capabilities: ["contribution:read_receipt"],
        issuedAt: "2026-09-06T00:00:00.000Z",
        expiresAt: "2026-09-07T00:00:00.000Z",
        value: "token-value",
      },
    };

    await new ObsidianHttpTransport("https://api.trans-hub.net").control(request);

    expect(requestHeaders(captured)).toMatchObject({
      Authorization: "Bearer token-value",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    });
  });
});

function requestHeaders(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null) {
    throw new Error("request URL input is invalid");
  }
  const headers = (input as { headers?: unknown }).headers;
  if (
    typeof headers !== "object"
    || headers === null
    || Object.values(headers).some((value) => typeof value !== "string")
  ) {
    throw new Error("request URL headers are invalid");
  }
  return headers as Record<string, string>;
}
