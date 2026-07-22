import { describe, expect, it } from "vitest";

import { errorMessage } from "../src/error-message";

describe("errorMessage", () => {
  it("公开 Public Client 的安全诊断字段", () => {
    const error = Object.assign(new Error("The control endpoint returned a non-success status"), {
      code: "PC_HTTP_STATUS",
      diagnostic: { operation: "submit-contribution", status: 403 },
    });

    expect(errorMessage(error)).toBe(
      "The control endpoint returned a non-success status（操作：submit-contribution，HTTP 403）",
    );
  });

  it("不展开未知错误对象中的额外数据", () => {
    const error = Object.assign(new Error("请求失败"), { token: "must-not-appear" });

    expect(errorMessage(error)).toBe("请求失败");
  });

  it("将状态查询的重试耗尽错误转换为可操作的中文提示", () => {
    const error = Object.assign(new Error("The bounded retry budget was exhausted"), {
      code: "PC_RETRY_EXHAUSTED",
      diagnostic: { operation: "contribution-status" },
    });

    expect(errorMessage(error)).toBe("服务器暂时无法查询插件处理状态，请稍后重试。");
  });

  it("将凭据拒绝转换为重新连接提示", () => {
    const error = Object.assign(new Error("The control endpoint returned a non-success status"), {
      code: "PC_HTTP_STATUS",
      diagnostic: { operation: "contribution-status", status: 401 },
    });

    expect(errorMessage(error)).toBe(
      "此设备的语枢授权已失效，请重新连接。已缓存译文仍可继续使用。",
    );
  });

  it("将设备续期 401 转换为无需手动清理的重新连接提示", () => {
    expect(errorMessage(new Error("设备授权续期失败：HTTP 401"))).toBe(
      "此设备的语枢授权已失效，请重新连接。已缓存译文仍可继续使用。",
    );
  });
});
