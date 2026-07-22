import {
  calculatePluginTranslationCoverage,
  comparePluginCatalogIdentity,
} from "./plugin-catalog-diff";
import { translate } from "./client-localization";
import type { PluginSubmissionState, PluginTranslationState } from "./plugin-state";
import type { PluginUiCatalog } from "./plugin-string-scanner";

export type PluginLocalizationStatusKind =
  | "localized"
  | "catalog-mismatch"
  | "waiting"
  | "unrecorded"
  | "failed";

export interface PluginLocalizationStatus {
  readonly kind: PluginLocalizationStatusKind;
  readonly label: string;
}

export interface PluginTranslationSourceSummary {
  readonly upstreamNative: number;
  readonly reviewedFill: number;
  readonly reviewedCorrection: number;
  readonly automatic: number;
  readonly published: number;
}

export const PLUGIN_LOCALIZATION_STATUS_FILTERS: readonly {
  readonly value: PluginLocalizationStatusKind | "all";
  readonly label: string;
}[] = [
  { value: "all", label: "全部状态" },
  { value: "localized", label: "已本地化" },
  { value: "catalog-mismatch", label: "目录待同步" },
  { value: "waiting", label: "等待发布" },
  { value: "unrecorded", label: "未收录" },
  { value: "failed", label: "处理失败" },
];

export function describePluginLocalizationStatus(input: {
  readonly submission?: PluginSubmissionState;
  readonly translation?: PluginTranslationState;
  readonly catalog?: PluginUiCatalog;
  readonly targetLocale: string;
}): PluginLocalizationStatus {
  if (input.targetLocale === "en") {
    return { kind: "localized", label: translate("源语言，无需翻译") };
  }
  if (input.translation?.targetLocale === input.targetLocale) {
    if (input.catalog !== undefined) {
      const identity = comparePluginCatalogIdentity(input.catalog, input.translation);
      if (!identity.exact) {
        if (identity.kind === "artifact") {
          return {
            kind: "catalog-mismatch",
            label: translate("本地插件文件与官方版本不一致；已安全应用 {count} 条精确命中译文", {
              count: identity.safelyAppliedCount,
            }),
          };
        }
        const scopes = identity.mismatchedScopes.map(scopeLabel).join("、");
        return {
          kind: "catalog-mismatch",
          label: identity.kind === "legacy"
            ? translate("服务器正在更新目录身份；已安全应用 {count} 条精确命中译文", {
                count: identity.safelyAppliedCount,
              })
            : translate("服务器目录正在更新：{scopes}；已安全应用 {count} 条精确命中译文", {
                scopes: scopes === "" ? translate("目录范围") : scopes,
                count: identity.safelyAppliedCount,
              }),
        };
      }
    }
    const coverage = calculatePluginTranslationCoverage(input.catalog, input.translation, input.targetLocale);
    const sourceSummary = describePluginTranslationSources(
      input.translation,
      input.catalog,
    );
    const scopeSummary = coverage === undefined ? "" : describeScopeCoverage(coverage);
    if (coverage !== undefined && coverage.missingCount > 0) {
      const waiting = hasAuthoritativePendingDemand(
        input.submission,
        input.translation.sourceVersionId,
      );
      return {
        kind: waiting ? "waiting" : "localized",
        label: appendSourceSummary(
          translate(waiting
            ? "已本地化 {translated}/{total} 条（{percent}%），{missing} 条等待发布"
            : "已发布 {translated}/{total} 条（{percent}%），{missing} 条尚未发布", {
            translated: coverage.translatedCount,
            total: coverage.totalCount,
            percent: coverage.percent,
            missing: coverage.missingCount,
          }),
          appendSourceSummary(scopeSummary, sourceSummary),
        ),
      };
    }
    if (coverage !== undefined && !coverage.exactPluginVersion) {
      return {
        kind: "localized",
        label: appendSourceSummary(
          translate("已沿用 {translated}/{total} 条安全译文", {
            translated: coverage.translatedCount,
            total: coverage.totalCount,
          }),
          appendSourceSummary(scopeSummary, sourceSummary),
        ),
      };
    }
    if (coverage !== undefined) {
      return {
        kind: "localized",
        label: appendSourceSummary(
          translate("已本地化 {translated}/{total} 条（{percent}%）", {
            translated: coverage.translatedCount,
            total: coverage.totalCount,
            percent: coverage.percent,
          }),
          appendSourceSummary(scopeSummary, sourceSummary),
        ),
      };
    }
    return {
      kind: "localized",
      label: appendSourceSummary(
        translate("已本地化 {count} 条", {
          count: new Set(input.translation.entries.map((entry) => entry.source)).size,
        }),
        sourceSummary,
      ),
    };
  }
  const submission = input.submission;
  if (submission === undefined) return { kind: "unrecorded", label: translate("未收录") };
  if (submission.lastError !== undefined) {
    return {
      kind: "failed",
      label: translate("同步失败：{message}。可单独重试此插件。", {
        message: submission.lastError.message,
      }),
    };
  }
  const demand = submission.localizationDemandStatus;
  if (demand !== undefined) {
    switch (demand.state) {
      case "awaiting_source":
        return { kind: "waiting", label: translate("等待可信来源收录") };
      case "rejected":
        return { kind: "failed", label: translate("处理失败：本地化需求未被接受") };
      case "reconciled":
        return {
          kind: "waiting",
          label: translate("已建立 {count} 条缺失本地化需求，等待机器翻译", {
            count: demand.workItemCount,
          }),
        };
      case "mt_queued":
        return {
          kind: "waiting",
          label: translate("机器翻译排队中：{queued}/{total} 条", {
            queued: demand.queuedCount,
            total: demand.workItemCount,
          }),
        };
      case "mt_running":
        return {
          kind: "waiting",
          label: translate("机器翻译中：已完成 {succeeded}/{total} 条，正在处理 {running} 条", {
            succeeded: demand.succeededCount,
            total: demand.workItemCount,
            running: demand.runningCount,
          }),
        };
      case "mt_failed":
        return demand.failureRetryable
          ? {
              kind: "waiting",
              label: translate("机器翻译暂时失败，服务器将自动重试（第 {attempt}/5 次）", {
                attempt: demand.failureAttemptNumber ?? 1,
              }),
            }
          : {
              kind: "failed",
              label: translate("机器翻译失败，自动重试已停止。可单独重试此插件。"),
            };
      case "export_pending":
        return {
          kind: "waiting",
          label: translate("翻译已完成 {succeeded}/{total} 条，等待译文制品发布", {
            succeeded: demand.succeededCount,
            total: demand.workItemCount,
          }),
        };
      case "export_ready":
        return { kind: "waiting", label: translate("译文已发布，等待客户端回拉") };
      case "native_complete":
        return {
          kind: "localized",
          label: translate("插件自带目标语言，已覆盖 {count} 条", {
            count: demand.nativeUnitCount,
          }),
        };
    }
  }
  if (submission.contributionState === "rejected" || submission.localizationContributionState === "rejected") {
    return { kind: "failed", label: translate("处理失败：需求未被接受") };
  }
  if (submission.sourceVersionId !== undefined) return { kind: "waiting", label: translate("等待目标语言译文发布") };
  if (submission.localizationContributionId !== undefined) {
    return { kind: "waiting", label: translate("等待本地化需求处理") };
  }
  return { kind: "waiting", label: translate("等待来源收录") };
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case "runtime-ui": return translate("插件界面");
    case "metadata": return translate("名称与说明");
    case "readme": return "README";
    default: return scope;
  }
}

export function summarizePluginTranslationSources(
  translation: PluginTranslationState,
): PluginTranslationSourceSummary {
  const summary: PluginTranslationSourceSummary = {
    upstreamNative: 0,
    reviewedFill: 0,
    reviewedCorrection: 0,
    automatic: 0,
    published: 0,
  };
  const effectiveEntries = new Map<string, (typeof translation.entries)[number]>();
  for (const entry of translation.entries) {
    const current = effectiveEntries.get(entry.source);
    if (current === undefined || provenancePriority(entry.provenanceKind) > provenancePriority(current.provenanceKind)) {
      effectiveEntries.set(entry.source, entry);
    }
  }
  return [...effectiveEntries.values()].reduce((current, entry) => {
    switch (entry.provenanceKind) {
      case "upstream-native": return { ...current, upstreamNative: current.upstreamNative + 1 };
      case "th-reviewed-fill": return { ...current, reviewedFill: current.reviewedFill + 1 };
      case "th-reviewed-correction": return { ...current, reviewedCorrection: current.reviewedCorrection + 1 };
      case "th-automatic": return { ...current, automatic: current.automatic + 1 };
      case "th-published": return { ...current, published: current.published + 1 };
      default: return current;
    }
  }, summary);
}

function describePluginTranslationSources(
  translation: PluginTranslationState,
  catalog: PluginUiCatalog | undefined,
): string {
  const currentSources = catalog === undefined ? null : new Set(catalog.strings.map((item) => item.source));
  const currentTranslation = currentSources === null
    ? translation
    : { ...translation, entries: translation.entries.filter((entry) => currentSources.has(entry.source)) };
  if (!currentTranslation.entries.some((entry) => entry.provenanceKind !== undefined)
    && (currentTranslation.upstreamNativeCount ?? 0) === 0) return "";
  const summary = summarizePluginTranslationSources(currentTranslation);
  const effectiveUpstreamNative = Math.max(
    (currentTranslation.upstreamNativeCount ?? 0) - summary.reviewedCorrection,
    summary.upstreamNative,
  );
  return [
    effectiveUpstreamNative > 0 ? translate("插件自带 {count}", { count: effectiveUpstreamNative }) : "",
    summary.reviewedFill > 0 ? translate("语枢已校对 {count}", { count: summary.reviewedFill }) : "",
    summary.reviewedCorrection > 0 ? translate("语枢校对修正 {count}", { count: summary.reviewedCorrection }) : "",
    summary.automatic > 0 ? translate("语枢机翻 {count}（未经人工校对）", { count: summary.automatic }) : "",
    summary.published > 0 ? translate("语枢已发布（未分类）{count}", { count: summary.published }) : "",
  ].filter((value) => value !== "").join(" · ");
}

function describeScopeCoverage(
  coverage: NonNullable<ReturnType<typeof calculatePluginTranslationCoverage>>,
): string {
  if (coverage.unattributedNativeCount > 0) {
    return translate("插件自带覆盖范围明细待服务端提供");
  }
  const scopes = coverage.scopes.map((item) => translate("{scope} {translated}/{total}", {
    scope: scopeLabel(item.scope),
    translated: item.translatedCount,
    total: item.totalCount,
  }));
  return scopes.join(" · ");
}

function hasAuthoritativePendingDemand(
  submission: PluginSubmissionState | undefined,
  sourceVersionId: string,
): boolean {
  const demand = submission?.localizationDemandStatus;
  if (demand === undefined || demand.sourceVersionId !== sourceVersionId) return false;
  if (demand.state === "mt_failed") return demand.failureRetryable;
  return [
    "reconciled",
    "mt_queued",
    "mt_running",
    "export_pending",
    "export_ready",
  ].includes(demand.state);
}

function appendSourceSummary(label: string, summary: string): string {
  return summary === "" ? label : `${label}；${summary}`;
}

function provenancePriority(
  provenance: PluginTranslationState["entries"][number]["provenanceKind"],
): number {
  switch (provenance) {
    case "th-reviewed-correction": return 5;
    case "upstream-native": return 4;
    case "th-reviewed-fill": return 3;
    case "th-automatic": return 2;
    case "th-published": return 1;
    default: return 0;
  }
}
