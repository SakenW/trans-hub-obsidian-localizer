import type {
  LocalizationDemandCoordinateStatus,
  LocalizationDemandState,
  LocalizationDemandStatus,
} from "@trans-hub/client-protocol";

import type { PluginLocalizationDemandStatusState } from "./plugin-state";

export type PluginDemandDisposition = "waiting" | "ready" | "native" | "failed";

export interface PluginDemandResolution {
  readonly coordinate: LocalizationDemandCoordinateStatus;
  readonly snapshot: PluginLocalizationDemandStatusState;
  readonly disposition: PluginDemandDisposition;
  readonly retryAfterMs: number;
}

export function resolvePluginDemandStatus(
  status: LocalizationDemandStatus,
  targetLocale: string,
): PluginDemandResolution {
  const candidates = status.coordinates.filter((coordinate) =>
    coordinate.targetLocale === null || coordinate.targetLocale === targetLocale
  );
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? "本地化需求状态缺少当前语言坐标。"
        : "本地化需求返回多个来源坐标，客户端无法安全选择。",
    );
  }
  const coordinate = candidates[0];
  return {
    coordinate,
    snapshot: snapshotPluginDemandStatus(coordinate),
    disposition: demandDisposition(coordinate.state, coordinate.failureRetryable),
    retryAfterMs: Math.max(status.retryAfterSeconds, coordinate.retryAfterSeconds) * 1_000,
  };
}

function snapshotPluginDemandStatus(
  coordinate: LocalizationDemandCoordinateStatus,
): PluginLocalizationDemandStatusState {
  return {
    state: coordinate.state,
    ...(coordinate.sourceVersionId === null ? {} : { sourceVersionId: coordinate.sourceVersionId }),
    ...(coordinate.targetLocale === null ? {} : { targetLocale: coordinate.targetLocale }),
    ...(coordinate.targetVariant === null ? {} : { targetVariant: coordinate.targetVariant }),
    totalUnitCount: coordinate.totalUnitCount,
    workItemCount: coordinate.workItemCount,
    nativeUnitCount: coordinate.nativeUnitCount,
    queuedCount: coordinate.queuedCount,
    runningCount: coordinate.runningCount,
    succeededCount: coordinate.succeededCount,
    failedCount: coordinate.failedCount,
    reviewedUnitCount: coordinate.reviewedUnitCount,
    publishedUnitCount: coordinate.publishedUnitCount,
    ...(coordinate.manifestId === null ? {} : { manifestId: coordinate.manifestId }),
    ...(coordinate.generationNumber === null ? {} : { generationNumber: coordinate.generationNumber }),
    retryAfterSeconds: coordinate.retryAfterSeconds,
    ...(coordinate.failureCode === null ? {} : { failureCode: coordinate.failureCode }),
    failureRetryable: coordinate.failureRetryable,
    ...(coordinate.failureAttemptNumber === null
      ? {}
      : { failureAttemptNumber: coordinate.failureAttemptNumber }),
    updatedAt: coordinate.updatedAt,
  };
}

function demandDisposition(
  state: LocalizationDemandState,
  failureRetryable: boolean,
): PluginDemandDisposition {
  if (state === "export_ready") return "ready";
  if (state === "native_complete") return "native";
  if (state === "rejected" || (state === "mt_failed" && !failureRetryable)) return "failed";
  return "waiting";
}
