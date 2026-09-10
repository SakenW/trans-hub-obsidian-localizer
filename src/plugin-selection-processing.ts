import type { PluginScanResult } from "./plugin-automation";
import type { PluginSyncSummary } from "./plugin-sync";
import { translate } from "./client-localization";

export type PluginSelectionProcessingResult =
  | { readonly kind: "empty"; readonly scan: PluginScanResult }
  | { readonly kind: "login-required"; readonly scan: PluginScanResult }
  | { readonly kind: "synchronized"; readonly scan: PluginScanResult; readonly sync: PluginSyncSummary };

export type PluginSelectionProcessingScope = "full" | "selected" | "single-retry" | "batch-retry";

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

export function pluginSelectionNeedsAttention(result: PluginSelectionProcessingResult): boolean {
  return result.kind === "synchronized" && (result.sync.statusRead?.kind === "stale"
    || (result.sync.failedPluginIds?.length ?? 0) > 0 || (result.sync.blockedPluginIds?.length ?? 0) > 0);
}

export function describePluginSelectionProcessing(
  result: PluginSelectionProcessingResult,
  scope: PluginSelectionProcessingScope = "full",
): string {
  if (result.kind === "empty") {
    return scope === "full"
      ? translate("已停止所有插件翻译。")
      : translate("所选插件当前没有可处理的本地化内容。");
  }
  if (result.kind === "login-required") {
    return translate("{scope} {count} 个插件；登录语枢后会继续同步。", {
      scope: processingScopeLabel(scope),
      count: result.scan.scannedCount,
    });
  }
  const { scan, sync } = result;
  if (sync.statusRead?.kind === "stale") return describePluginStatusRefresh(sync, scan.scannedCount);
  const failedCount = new Set(sync.failedPluginIds ?? []).size;
  const blockedCount = new Set(sync.blockedPluginIds ?? []).size;
  const exportPendingCount = sync.exportPendingCount ?? 0;
  if (sync.pulledCount > 0) {
    const parts = [translate("{scope}更新 {count} 个插件，本机安全应用 {translations} 条译文。", {
      scope: processingScopeUpdateLabel(scope), count: sync.pulledCount, translations: sync.translationCount,
    })];
    if (sync.waitingCount > 0) parts.push(translate("仍有 {count} 个插件等待后续译文更新。", { count: sync.waitingCount }));
    if (failedCount > 0) parts.push(translate("{count} 个插件同步失败，可单独重试。", { count: failedCount }));
    if (blockedCount > 0) parts.push(translate("{count} 个插件受服务端限制。", { count: blockedCount }));
    return parts.join(" ");
  }
  if (sync.waitingCount > 0) {
    const detail = describeDemandStateCounts(sync);
    const summary = translate(
      exportPendingCount > 0
        ? "{scope} {count} 个插件；新增 {requested} 个本地化需求，{waiting} 个正在处理，其中 {export} 个正在自动发布"
        : "{scope} {count} 个插件；新增 {requested} 个本地化需求，{waiting} 个正在处理",
      {
        scope: processingScopeLabel(scope),
        count: scan.scannedCount,
        requested: sync.requestedCount,
        waiting: sync.waitingCount,
        export: exportPendingCount,
      },
    );
    const withDetail = detail === "" ? summary : `${summary}（${detail}）`;
    return failedCount === 0
      ? `${withDetail}。`
      : translate("{summary}；仍有 {failed} 个可恢复项，可点击“重试可恢复项”。", {
          summary: withDetail,
          failed: failedCount,
        });
  }
  if (exportPendingCount > 0) {
    return translate("{scope} {count} 个插件；{export} 个译文已生成，服务器正在自动发布。", {
      scope: processingScopeLabel(scope),
      count: scan.scannedCount,
      export: exportPendingCount,
    });
  }
  if (failedCount > 0) {
    return translate("{scope} {count} 个插件；{failed} 个可恢复项，可点击“重试可恢复项”。", {
      scope: processingScopeLabel(scope),
      count: scan.scannedCount,
      failed: failedCount,
    });
  }
  if (blockedCount > 0) {
    return translate("{scope} {count} 个插件；{blocked} 个服务端受限，请展开对应插件查看原因。", {
      scope: processingScopeLabel(scope),
      count: scan.scannedCount,
      blocked: blockedCount,
    });
  }
  return translate("{scope} {count} 个插件，目前没有新译文。", {
    scope: processingScopeLabel(scope),
    count: scan.scannedCount,
  });
}

export function describePluginStatusRefresh(
  sync: PluginSyncSummary,
  count: number,
): string {
  if (sync.statusRead?.kind === "stale") {
    return translate("状态刷新失败；已保留上次结果，{failed} 个插件的状态可能已过期。", {
      failed: new Set(sync.statusRead.failedPluginIds).size,
    });
  }
  const failedCount = new Set(sync.failedPluginIds ?? []).size;
  const blockedCount = new Set(sync.blockedPluginIds ?? []).size;
  const exportPendingCount = sync.exportPendingCount ?? 0;
  if (failedCount > 0) {
    return translate("已刷新所选 {count} 个插件状态；{failed} 个可恢复项，可点击“重试可恢复项”。", {
      count,
      failed: failedCount,
    });
  }
  if (blockedCount > 0) {
    return translate("已刷新所选 {count} 个插件状态；{blocked} 个服务端受限，请展开对应插件查看原因。", {
      count,
      blocked: blockedCount,
    });
  }
  if (sync.waitingCount > 0) {
    if (exportPendingCount > 0) {
      return translate("已刷新所选 {count} 个插件状态；{waiting} 个仍在处理，另有 {export} 个正在自动发布。", {
        count,
        waiting: sync.waitingCount,
        export: exportPendingCount,
      });
    }
    return translate("已刷新所选 {count} 个插件状态；{waiting} 个仍在处理中。", {
      count,
      waiting: sync.waitingCount,
    });
  }
  if (exportPendingCount > 0) {
    return translate("已刷新所选 {count} 个插件状态；{export} 个译文已生成，服务器正在自动发布。", {
      count,
      export: exportPendingCount,
    });
  }
  if (sync.pulledCount > 0) {
    return translate("已刷新所选 {count} 个插件状态，安全应用 {translations} 条译文。", {
      count,
      translations: sync.translationCount,
    });
  }
  return translate("已刷新所选 {count} 个插件状态，目前没有新译文。", { count });
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
    demandCount(sync.authorityRefreshingCount, "权威校验"),
    demandCount(counts.reconciled, "等待翻译"),
    demandCount(counts.mt_queued, "机翻排队"),
    demandCount(counts.mt_running, "机翻中"),
    demandCount(counts.export_pending, "自动发布中"),
    demandCount(counts.export_ready, "等待回拉"),
  ].filter((value) => value !== "").join("，");
}

function demandCount(count: number | undefined, label: string): string {
  return count === undefined || count <= 0 ? "" : `${label} ${count}`;
}

function processingScopeLabel(scope: PluginSelectionProcessingScope): string {
  if (scope === "batch-retry") return translate("已批量重试");
  if (scope === "selected") return translate("已检查所选");
  if (scope === "single-retry") return translate("已重试");
  return translate("已检查");
}

function processingScopeUpdateLabel(scope: PluginSelectionProcessingScope): string {
  if (scope === "batch-retry") return translate("已批量重试并");
  if (scope === "selected") return translate("已为所选插件");
  if (scope === "single-retry") return translate("已重试并");
  return translate("已");
}
