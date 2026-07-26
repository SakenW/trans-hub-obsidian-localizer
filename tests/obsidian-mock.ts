type RequestUrlHandler = (input: unknown) => Promise<unknown>;

let requestUrlHandler: RequestUrlHandler = () =>
  Promise.reject(new Error("requestUrl is not available in unit tests"));

export function requestUrl(input: unknown): Promise<unknown> {
  return requestUrlHandler(input);
}

export function setRequestUrlHandler(handler: RequestUrlHandler): void {
  requestUrlHandler = handler;
}

export function resetRequestUrlHandler(): void {
  requestUrlHandler = () =>
    Promise.reject(new Error("requestUrl is not available in unit tests"));
}

export function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/\/{2,}/gu, "/");
}

export class Notice {
  constructor(message: string, timeout?: number) {
    void message;
    void timeout;
  }
}
