import type { PluginScanResult } from "./plugin-automation";
import type { PluginSyncSummary } from "./plugin-sync";
import { translate } from "./client-localization";

export type PluginSelectionProcessingResult =
  | { readonly kind: "empty"; readonly scan: PluginScanResult }
  | { readonly kind: "login-required"; readonly scan: PluginScanResult }
  | { readonly kind: "synchronized"; readonly scan: PluginScanResult; readonly sync: PluginSyncSummary };

export class PluginProcessingQueue {
  private tail: Promise<void> = Promise.resolve();

  run<Result>(task: () => Promise<Result>): Promise<Result> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export async function processPluginSelection(input: {
  readonly scan: () => Promise<PluginScanResult>;
  readonly hasSession: () => boolean;
  readonly synchronize: () => Promise<PluginSyncSummary>;
  readonly applyCached: () => void;
}): Promise<PluginSelectionProcessingResult> {
  const scan = await input.scan();
  if (scan.scannedCount === 0) {
    input.applyCached();
    return { kind: "empty", scan };
  }
  if (!input.hasSession()) {
    input.applyCached();
    return { kind: "login-required", scan };
  }
  const sync = await input.synchronize();
  return { kind: "synchronized", scan, sync };
}

export function describePluginSelectionProcessing(result: PluginSelectionProcessingResult): string {
  if (result.kind === "empty") return translate("已停止所有插件翻译。");
  if (result.kind === "login-required") {
    return translate("已扫描 {count} 个插件；登录语枢后会继续同步。", {
      count: result.scan.scannedCount,
    });
  }
  const { scan, sync } = result;
  const failedCount = new Set(sync.failedPluginIds ?? []).size;
  if (sync.waitingCount > 0) {
    const detail = describeDemandStateCounts(sync);
    const summary = translate("已检查 {count} 个插件；新增 {requested} 个本地化需求，{waiting} 个仍在处理中", {
      count: scan.scannedCount,
      requested: sync.requestedCount,
      waiting: sync.waitingCount,
    });
    const withDetail = detail === "" ? summary : `${summary}（${detail}）`;
    return failedCount === 0
      ? `${withDetail}。`
      : translate("{summary}；{failed} 个处理失败，可在列表中单独重试。", {
          summary: withDetail,
          failed: failedCount,
        });
  }
  if (failedCount > 0) {
    return translate("已检查 {count} 个插件；{failed} 个处理失败，可在列表中单独重试。", {
      count: scan.scannedCount,
      failed: failedCount,
    });
  }
  if (sync.pulledCount > 0) {
    return translate("已更新 {count} 个插件，共 {translations} 条译文。", {
      count: sync.pulledCount,
      translations: sync.translationCount,
    });
  }
  return translate("已检查 {count} 个插件，目前没有新译文。", { count: scan.scannedCount });
}

export function pendingTranslationPluginIds(
  result: PluginSelectionProcessingResult,
): readonly string[] {
  if (result.kind !== "synchronized") return [];
  return [...new Set(result.sync.waitingPluginIds ?? [])];
}

export const MAX_PENDING_TRANSLATION_QUICK_RETRIES = 8;

export function pendingTranslationRetryDelay(
  attempt: number,
  serverSuggestedMs = 0,
): number {
  const normalizedAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.floor(attempt))
    : 0;
  const localDelay = Math.min(5_000 * (2 ** normalizedAttempt), 60_000);
  const serverDelay = Number.isFinite(serverSuggestedMs)
    ? Math.max(0, Math.floor(serverSuggestedMs))
    : 0;
  return Math.min(Math.max(localDelay, serverDelay), 15 * 60 * 1_000);
}

function describeDemandStateCounts(sync: PluginSyncSummary): string {
  const counts = sync.demandStateCounts ?? {};
  return [
    demandCount(counts.awaiting_source, "等待来源"),
    demandCount(counts.reconciled, "等待翻译"),
    demandCount(counts.mt_queued, "机翻排队"),
    demandCount(counts.mt_running, "机翻中"),
    demandCount(counts.export_pending, "等待发布"),
    demandCount(counts.export_ready, "等待回拉"),
  ].filter((value) => value !== "").join("，");
}

function demandCount(count: number | undefined, label: string): string {
  return count === undefined || count <= 0 ? "" : `${label} ${count}`;
}
