export function requestUrl(): Promise<never> {
  return Promise.reject(new Error("requestUrl is not available in unit tests"));
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
