import type {
  ControlHttpRequest,
  ControlHttpResponse,
  PublicHttpTransportPort,
  TransferHttpRequest,
} from "@trans-hub/public-client";
import { requestUrl } from "obsidian";

import { assertSafeApiBaseUrl } from "./api-base-url";

export interface HttpRequest<TBody = unknown> {
  readonly method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: TBody;
}

export interface HttpResponse<TBody = unknown> {
  readonly status: number;
  readonly body: TBody;
  readonly headers: Readonly<Record<string, string>>;
}

export interface TransportClient {
  send<TResponse = unknown, TBody = unknown>(
    request: HttpRequest<TBody>,
  ): Promise<HttpResponse<TResponse>>;
}

export class ObsidianHttpTransport implements TransportClient, PublicHttpTransportPort {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = assertSafeApiBaseUrl(baseUrl);
  }

  async send<TResponse = unknown, TBody = unknown>(
    request: HttpRequest<TBody>,
  ): Promise<HttpResponse<TResponse>> {
    const response = await requestUrl({
      url: `${this.baseUrl}${request.path}`,
      method: request.method,
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body), contentType: "application/json" }),
      throw: false,
    });
    return {
      status: response.status,
      body: parseBody(response.text) as TResponse,
      headers: normalizeHeaders(response.headers),
    };
  }

  async control(request: ControlHttpRequest): Promise<ControlHttpResponse> {
    if (!request.path.startsWith("/v1/public-client/")) {
      throw new Error("public_client_control_path_invalid");
    }
    const headers: Record<string, string> = { ...request.headers };
    if (request.credential !== null) {
      headers.Authorization = `Bearer ${request.credential.value}`;
    }
    return this.send({
      method: request.method,
      path: request.path,
      headers,
      ...(request.body === null ? {} : { body: request.body }),
    });
  }

  transfer(request: TransferHttpRequest): Promise<never> {
    void request;
    return Promise.reject(new Error("public_client_transfer_not_enabled_in_obsidian"));
  }
}

function parseBody(text: string): unknown {
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}
