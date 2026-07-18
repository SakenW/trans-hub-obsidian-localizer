import type { PluginScanResult } from "./plugin-automation";
import type { PluginSyncSummary } from "./plugin-sync";
import { translate } from "./client-localization";

export type PluginSelectionProcessingResult =
  | { readonly kind: "empty"; readonly scan: PluginScanResult }
  | { readonly kind: "login-required"; readonly scan: PluginScanResult }
  | { readonly kind: "synchronized"; readonly scan: PluginScanResult; readonly sync: PluginSyncSummary };

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
  if (sync.waitingCount > 0) {
    return translate("已检查 {count} 个插件；新增 {requested} 个本地化需求，{waiting} 个正在由服务器处理或等待审查。", {
      count: scan.scannedCount,
      requested: sync.requestedCount,
      waiting: sync.waitingCount,
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

export function pendingTranslationRetryDelay(attempt: number): number {
  const normalizedAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.floor(attempt))
    : 0;
  return Math.min(5_000 * (2 ** normalizedAttempt), 60_000);
}
