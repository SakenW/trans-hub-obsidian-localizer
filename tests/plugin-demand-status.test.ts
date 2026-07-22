import { describe, expect, it } from "vitest";

import type {
  LocalizationDemandCoordinateStatus,
  LocalizationDemandStatus,
} from "@trans-hub/client-protocol";
import { CURRENT_PROTOCOL_VERSION } from "@trans-hub/client-protocol";

import { resolvePluginDemandStatus } from "../src/plugin-demand-status";

const coordinate: LocalizationDemandCoordinateStatus = {
  state: "mt_running",
  sourceVersionId: "source-version",
  targetLocale: "zh-CN",
  targetVariant: "default",
  totalUnitCount: 10,
  workItemCount: 2,
  nativeUnitCount: 0,
  queuedCount: 0,
  runningCount: 2,
  succeededCount: 0,
  failedCount: 0,
  reviewedUnitCount: 0,
  publishedUnitCount: 0,
  manifestId: null,
  generationNumber: null,
  retryAfterSeconds: 10,
  failureCode: null,
  failureRetryable: false,
  failureAttemptNumber: null,
  updatedAt: "2026-07-23T00:00:00.000Z",
};

function status(
  coordinates: readonly LocalizationDemandCoordinateStatus[],
): LocalizationDemandStatus {
  return {
    kind: "localization_demand_status",
    protocol: CURRENT_PROTOCOL_VERSION,
    contributionId: "contribution",
    state: "mt_running",
    retryAfterSeconds: 10,
    coordinates,
    updatedAt: "2026-07-23T00:00:00.000Z",
  };
}

describe("resolvePluginDemandStatus", () => {
  it("refuses to guess when one contribution resolves to multiple matching coordinates", () => {
    expect(() => resolvePluginDemandStatus(status([
      coordinate,
      { ...coordinate, sourceVersionId: "other-source" },
    ]), "zh-CN")).toThrow("本地化需求返回多个来源坐标，客户端无法安全选择。");
  });

  it("refuses a response that does not contain the requested target locale", () => {
    expect(() => resolvePluginDemandStatus(status([
      { ...coordinate, targetLocale: "de-DE" },
    ]), "zh-CN")).toThrow("本地化需求状态缺少当前语言坐标。");
  });
});
