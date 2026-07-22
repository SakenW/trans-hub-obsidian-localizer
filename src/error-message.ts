import { translate } from "./client-localization";

interface PublicClientDiagnosticError extends Error {
  readonly code: string;
  readonly diagnostic: {
    readonly operation: string;
    readonly status?: number;
  };
}

export function errorMessage(error: unknown): string {
  if (isExpiredDeviceAuthorization(error)) {
    return translate("此设备的语枢授权已失效，请重新连接。已缓存译文仍可继续使用。");
  }
  if (!isPublicClientDiagnosticError(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  if (isRetryBudgetExhausted(error)) {
    return error.diagnostic.operation === "contribution-status"
      ? translate("服务器暂时无法查询插件处理状态，请稍后重试。")
      : translate("服务器暂时无法完成请求，请稍后重试。");
  }
  const status = error.diagnostic.status;
  if (status === 401 && ["submit-contribution", "contribution-status"].includes(
    error.diagnostic.operation,
  )) {
    return translate("此设备的语枢授权已失效，请重新连接。已缓存译文仍可继续使用。");
  }
  const suffix = status === undefined
    ? translate("操作：{operation}", { operation: error.diagnostic.operation })
    : translate("操作：{operation}，HTTP {status}", { operation: error.diagnostic.operation, status });
  return translate("{message}（{suffix}）", { message: error.message, suffix });
}

function isExpiredDeviceAuthorization(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /设备授权(?:续期失败：HTTP (?:401|403)|已失效|已过期)/u.test(error.message);
}

function isRetryBudgetExhausted(error: PublicClientDiagnosticError): boolean {
  return error.code === "PC_RETRY_EXHAUSTED" ||
    /bounded retry budget was exhausted/iu.test(error.message);
}

function isPublicClientDiagnosticError(error: unknown): error is PublicClientDiagnosticError {
  if (!(error instanceof Error) || typeof (error as Partial<PublicClientDiagnosticError>).code !== "string") {
    return false;
  }
  const diagnostic = (error as Partial<PublicClientDiagnosticError>).diagnostic;
  return typeof diagnostic === "object" && diagnostic !== null &&
    typeof diagnostic.operation === "string" && diagnostic.operation !== "" &&
    (diagnostic.status === undefined || Number.isInteger(diagnostic.status));
}
