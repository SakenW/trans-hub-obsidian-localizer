import {
  calculatePluginTranslationCoverage,
  comparePluginCatalogIdentity,
  mergeCatalogNativeTranslations,
} from "./plugin-catalog-diff";
import { translate } from "./client-localization";
import { isUnprocessableMachineTranslationFailure } from "./plugin-demand-status";
import {
  getPluginSubmissionForLocale,
  getPluginTranslation,
  type PluginState,
  type PluginSubmissionState,
  type PluginTranslationState,
} from "./plugin-state";
import type { PluginUiCatalog } from "./plugin-string-scanner";
import type { TargetLocale } from "./product-config";

export type PluginLocalizationStatusKind =
  | "localized"
  | "catalog-mismatch"
  | "waiting"
  | "login-required"
  | "unrecorded"
  | "blocked"
  | "preserved-source"
  | "failed";

export interface PluginLocalizationStatus {
  readonly kind: PluginLocalizationStatusKind;
  readonly label: string;
  readonly catalogMismatch?: PluginCatalogMismatchSummary;
  readonly coverage?: PluginLocalizationCoverageSummary;
}

export interface PluginCatalogMismatchSummary {
  readonly safelyAppliedCount: number;
  readonly currentCatalog?: {
    readonly totalCount: number;
    readonly nativeCount: number;
    readonly missingCount: number;
  };
}

export interface PluginLocalizationCoverageSummary {
  readonly headline: string;
  readonly notice?: string;
  readonly complete: boolean;
  readonly scopeMetrics: readonly string[];
  readonly sourceMetrics: readonly PluginLocalizationCoverageSourceMetric[];
}

export interface PluginLocalizationCoverageSourceMetric {
  readonly label: string;
  readonly tone: "native" | "reviewed" | "automatic" | "published";
}

export type PluginManualRetryKind = "resynchronize" | "resubmit";

export function visiblePluginManualRetryKind(input: {
  readonly state: Pick<PluginState, "pluginCatalogs" | "pluginSubmissions" | "pluginTranslations">;
  readonly pluginId: string;
  readonly targetLocale: TargetLocale;
  readonly sourceSelectable: boolean;
  readonly hasSession: boolean;
}): PluginManualRetryKind | null {
  if (!input.sourceSelectable || !input.hasSession) return null;
  return pluginManualRetryKind({
    submission: getPluginSubmissionForLocale(input.state, input.pluginId, input.targetLocale),
    translation: getPluginTranslation(input.state, input.pluginId, input.targetLocale),
    catalog: input.state.pluginCatalogs[input.pluginId],
    targetLocale: input.targetLocale,
  });
}

export function pluginManualRetryKind(input: {
  readonly submission?: PluginSubmissionState;
  readonly translation?: PluginTranslationState;
  readonly catalog?: PluginUiCatalog;
  readonly targetLocale: string;
}): PluginManualRetryKind | null {
  if (input.targetLocale === "en") return null;
  const submission = input.submission;
  const demand = submission?.localizationDemandStatus;
  const currentCatalogSubmission = submission !== undefined
    && input.catalog !== undefined
    && submission.catalogDigest === input.catalog.digest
    && submission.pluginVersion === input.catalog.pluginVersion;
  const exactUnprocessableMachineFailure = demand?.state === "mt_failed"
    && !demand.failureRetryable
    && currentCatalogSubmission
    && demand.sourceVersionId === submission.sourceVersionId
    && isUnprocessableMachineTranslationFailure(demand.failureCode);
  const terminalCurrentMachineFailure = demand?.state === "mt_failed"
    && !demand.failureRetryable
    && input.translation?.targetLocale === input.targetLocale
    && demand.sourceVersionId === input.translation.sourceVersionId;
  if (submission === undefined) return null;
  if (submission.lastError?.code === "source_artifact_mismatch") return null;
  if (isCurrentLocaleSynchronizationError(submission.lastError, input.targetLocale)) {
    return "resynchronize";
  }
  if (
    input.translation?.targetLocale === input.targetLocale
    && !currentCatalogSubmission
    && !terminalCurrentMachineFailure
  ) return null;
  if (exactUnprocessableMachineFailure) return null;
  if (hasCompleteAuthoritativeTranslation(input, submission)) return null;
  if (terminalCurrentMachineFailure) return "resubmit";
  if (demand?.state === "distribution_blocked") return null;
  if (
    demand?.state === "rejected"
    || (demand?.state === "mt_failed" && !demand.failureRetryable)
    || submission.contributionState === "rejected"
    || submission.localizationContributionState === "rejected"
  ) return "resubmit";
  return null;
}

function hasCompleteAuthoritativeTranslation(
  input: {
    readonly translation?: PluginTranslationState;
    readonly catalog?: PluginUiCatalog;
    readonly targetLocale: string;
  },
  submission: PluginSubmissionState,
): boolean {
  const { catalog, translation } = input;
  if (
    catalog === undefined
    || translation === undefined
    || translation.pluginId !== catalog.pluginId
    || translation.targetLocale !== input.targetLocale
    || translation.sourceVersionId !== submission.sourceVersionId
    || !comparePluginCatalogIdentity(catalog, translation).exact
  ) return false;
  const coverage = calculatePluginTranslationCoverage(
    catalog,
    translation,
    input.targetLocale,
  );
  return coverage?.exactPluginVersion === true && coverage.missingCount === 0;
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
  { value: "login-required", label: "需要登录" },
  { value: "unrecorded", label: "未收录" },
  { value: "blocked", label: "分发受限" },
  { value: "preserved-source", label: "保留原文" },
  { value: "failed", label: "处理失败" },
];

export function describePluginLocalizationStatus(input: {
  readonly submission?: PluginSubmissionState;
  readonly translation?: PluginTranslationState;
  readonly catalog?: PluginUiCatalog;
  readonly targetLocale: string;
  readonly hasSession?: boolean;
  readonly requiresReconnect?: boolean;
}): PluginLocalizationStatus {
  if (input.targetLocale === "en") {
    return { kind: "localized", label: translate("源语言，无需翻译") };
  }
  if (input.hasSession === false) {
    return {
      kind: "login-required",
      label: translate(input.requiresReconnect ? "重新连接后继续同步" : "登录后同步"),
    };
  }
  const recoverableSynchronizationError = input.submission?.lastError;
  if (
    recoverableSynchronizationError !== undefined
    && recoverableSynchronizationError.code !== "source_artifact_mismatch"
    && isCurrentLocaleSynchronizationError(recoverableSynchronizationError, input.targetLocale)
  ) {
    return {
      kind: "failed",
      label: translate("同步失败：{message}。点击右侧“重试此插件”，无需关闭开关。", {
        message: recoverableSynchronizationError.message,
      }),
    };
  }
  const currentCatalogSubmission = input.submission !== undefined
    && input.catalog !== undefined
    && input.submission.catalogDigest === input.catalog.digest
    && input.submission.pluginVersion === input.catalog.pluginVersion;
  const currentDistributionBlock = input.submission?.localizationDemandStatus?.state === "distribution_blocked"
    && input.submission.localizationDemandStatus.sourceVersionId === input.submission.sourceVersionId;
  const currentUnprocessableMachineFailure = input.submission?.localizationDemandStatus?.state === "mt_failed"
    && input.submission.localizationDemandStatus.sourceVersionId === input.submission.sourceVersionId
    && isUnprocessableMachineTranslationFailure(input.submission.localizationDemandStatus.failureCode);
  if (
    currentCatalogSubmission
    && input.submission?.lastError?.code === "source_artifact_mismatch"
  ) {
    return {
      kind: "catalog-mismatch",
      label: translate("本地安装与权威目录的精确制品不一致，已暂停同步"),
    };
  }
  if (
    currentCatalogSubmission
    && !currentDistributionBlock
    && !currentUnprocessableMachineFailure
    && (input.submission?.contributionState === "rejected"
      || input.submission?.localizationContributionState === "rejected")
  ) {
    return {
      kind: "failed",
      label: translate("需求未被接受。点击右侧“重试此插件”。"),
    };
  }
  if (input.translation?.targetLocale === input.targetLocale) {
    const demand = input.submission?.localizationDemandStatus;
    const exactCompleteTranslation = input.submission !== undefined
      && hasCompleteAuthoritativeTranslation(input, input.submission);
    const authorityRefreshing = demand?.state === "reconciled"
      && demand.failureCode === "PublicDistributionAuthorityRefreshing"
      && demand.sourceVersionId === input.translation.sourceVersionId;
    const distributionBlock = demand?.state === "distribution_blocked"
      && demand.sourceVersionId === input.translation.sourceVersionId
      ? { failureCode: demand.failureCode }
      : undefined;
    const machineTranslationFailure = demand?.state === "mt_failed"
      && demand.sourceVersionId === input.translation.sourceVersionId
      && !exactCompleteTranslation
      ? {
          retryable: demand.failureRetryable,
          attemptNumber: demand.failureAttemptNumber,
          failureCode: demand.failureCode,
        }
      : undefined;
    if (input.catalog !== undefined) {
      const identity = comparePluginCatalogIdentity(input.catalog, input.translation);
      if (
        !identity.exact
        || distributionBlock !== undefined
        || machineTranslationFailure !== undefined
        || authorityRefreshing
      ) {
        return safeIntersectionStatus(
          input.translation,
          input.catalog,
          input.targetLocale,
          {
            catalogDrift: !identity.exact,
            distributionBlock,
            machineTranslationFailure,
            authorityRefreshing,
          },
        );
      }
    }
    const effectiveTranslation = mergeCatalogNativeTranslations(input.catalog, input.translation);
    const coverage = calculatePluginTranslationCoverage(input.catalog, effectiveTranslation, input.targetLocale);
    const sourceMetrics = describePluginTranslationSourceMetrics(
      effectiveTranslation,
      input.catalog,
      coverage,
    );
    const sourceSummary = sourceMetrics.map((metric) => metric.label).join(" · ");
    const scopeMetrics = coverage === undefined ? [] : describeScopeCoverageMetrics(coverage);
    if (coverage !== undefined && coverage.missingCount > 0) {
      const waiting = hasAuthoritativePendingDemand(
        input.submission,
        input.translation.sourceVersionId,
      );
      const headline = translate(waiting
        ? "已本地化 {translated}/{total} 条（{percent}%），{missing} 条等待发布"
        : "已发布 {translated}/{total} 条（{percent}%），{missing} 条尚未发布", {
        translated: coverage.translatedCount,
        total: coverage.totalCount,
        percent: coverage.percent,
        missing: coverage.missingCount,
      });
      return {
        kind: waiting ? "waiting" : "localized",
        label: appendSourceSummary(
          headline,
          appendSourceSummary(scopeMetrics.join(" · "), sourceSummary),
        ),
        coverage: coverageSummary(headline, false, scopeMetrics, sourceMetrics),
      };
    }
    if (coverage !== undefined && !coverage.exactPluginVersion) {
      const headline = translate("已沿用 {translated}/{total} 条安全译文", {
        translated: coverage.translatedCount,
        total: coverage.totalCount,
      });
      return {
        kind: "localized",
        label: appendSourceSummary(
          headline,
          appendSourceSummary(scopeMetrics.join(" · "), sourceSummary),
        ),
        coverage: coverageSummary(headline, true, scopeMetrics, sourceMetrics),
      };
    }
    if (coverage !== undefined) {
      const headline = translate("已本地化 {translated}/{total} 条（{percent}%）", {
        translated: coverage.translatedCount,
        total: coverage.totalCount,
        percent: coverage.percent,
      });
      return {
        kind: "localized",
        label: appendSourceSummary(
          headline,
          appendSourceSummary(scopeMetrics.join(" · "), sourceSummary),
        ),
        coverage: coverageSummary(headline, true, scopeMetrics, sourceMetrics),
      };
    }
    const machineTranslationFailureLabel = describeMachineTranslationFailure(machineTranslationFailure);
    const localizedLabel = translate("已本地化 {count} 条", {
      count: new Set(input.translation.entries.map((entry) => entry.source)).size,
    });
    return {
      kind: distributionBlock !== undefined
        ? "blocked"
        : authorityRefreshing
          ? "waiting"
          : machineTranslationFailure !== undefined
            ? machineTranslationFailure.retryable ? "waiting" : "failed"
            : "localized",
      label: appendSourceSummary(
        distributionBlock === undefined
          ? authorityRefreshing
            ? translate("服务器正在校验当前精确版本的权威来源与许可证")
            : machineTranslationFailureLabel ?? localizedLabel
          : describeDistributionBlock(distributionBlock.failureCode),
        sourceSummary,
      ),
    };
  }
  const submission = input.submission;
  if (submission === undefined) {
    return { kind: "unrecorded", label: translate("尚未提交本地化需求") };
  }
  if (submission.lastError !== undefined) {
    return {
      kind: "failed",
      label: translate("同步失败：{message}。点击右侧“重试此插件”，无需关闭开关。", {
        message: submission.lastError.message,
      }),
    };
  }
  if (
    currentCatalogSubmission
    && isSourceContributionProcessing(submission.contributionState)
  ) {
    return { kind: "waiting", label: translate("等待可信来源收录") };
  }
  const demand = submission.localizationDemandStatus;
  if (demand !== undefined) {
    switch (demand.state) {
      case "awaiting_source":
        return { kind: "waiting", label: translate("等待可信来源收录") };
      case "rejected":
        return {
          kind: "failed",
          label: translate("本地化需求未被接受。点击右侧“重试此插件”。"),
        };
      case "reconciled":
        if (demand.failureCode === "PublicDistributionAuthorityRefreshing") {
          return {
            kind: "waiting",
            label: translate("服务器正在校验当前精确版本的权威来源与许可证"),
          };
        }
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
        if (isUnprocessableMachineTranslationFailure(demand.failureCode)) {
          return {
            kind: "preserved-source",
            label: describeMachineTranslationFailure({
              retryable: false,
              attemptNumber: demand.failureAttemptNumber,
              failureCode: demand.failureCode,
            })!,
          };
        }
        return demand.failureRetryable
          ? {
              kind: "waiting",
              label: translate("机器翻译暂时失败，服务器将自动重试（第 {attempt}/5 次）", {
                attempt: demand.failureAttemptNumber ?? 1,
              }),
            }
          : {
              kind: "failed",
              label: translate("机器翻译失败，服务器已停止自动重试。点击右侧“重试此插件”。"),
            };
      case "distribution_blocked":
        return {
          kind: "blocked",
          label: describeDistributionBlock(demand.failureCode),
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
        return {
          kind: "waiting",
          label: demand.publishedUnitCount > 0
            ? translate("译文已发布，等待客户端回拉")
            : translate("译文制品已生成，等待服务端公共目录更新"),
        };
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
    return {
      kind: "failed",
      label: translate("需求未被接受。点击右侧“重试此插件”。"),
    };
  }
  if (submission.sourceVersionId !== undefined) return { kind: "waiting", label: translate("等待目标语言译文发布") };
  if (submission.localizationContributionId !== undefined) {
    return { kind: "waiting", label: translate("等待本地化需求处理") };
  }
  return { kind: "waiting", label: translate("等待来源收录") };
}

function isCurrentLocaleSynchronizationError(
  error: PluginSubmissionState["lastError"],
  targetLocale: string,
): boolean {
  return error !== undefined
    && (error.targetLocale === undefined || error.targetLocale === targetLocale);
}

function isSourceContributionProcessing(state: string): boolean {
  return state === "received"
    || state === "target_resolved"
    || state === "artifact_acquired"
    || state === "byte_verified";
}

function describeDistributionBlock(failureCode: string | undefined): string {
  switch (failureCode) {
    case "PublicDistributionPolicyPending":
      return translate("暂无法公开发布：许可证证据已确认，服务端正在生成公开分发策略");
    case "PublicDistributionLicenseUnsupported":
      return translate("无法公开发布：上游许可证不在当前安全分发范围");
    case "PublicDistributionLicenseEvidenceMissing":
      return translate("无法公开发布：缺少当前精确版本的许可证证据");
    case "PublicDistributionPolicyAmbiguous":
      return translate("无法公开发布：当前精确版本存在冲突的公开分发策略");
    case "PublicSourceVersionYanked":
      return translate("无法公开发布：当前来源版本已下架");
    case "PublicDistributionSourceDrift":
      return translate("暂无法公开发布：当前来源与权威来源不一致，需重新收录精确来源版本");
    case "PublicDistributionSourceUnsupported":
      return translate("无法公开发布：当前来源未通过权威来源校验");
    case "PublicDistributionManualDeny":
      return translate("无法公开发布：管理员已关闭当前精确版本的公开分发");
    case "PublicDistributionAuthorizationDenied":
      return translate("无法公开发布：服务器无权为当前来源建立公开分发策略");
    case "PublicDistributionAuthorityInvalid":
      return translate("无法公开发布：当前来源的权威证据无效");
    case "PublicDistributionAuthorityRetryExhausted":
      return translate("无法公开发布：权威来源校验多次失败，服务器已停止自动重试");
    default:
      return translate("无法公开发布：当前精确版本的公开分发策略不可用");
  }
}

function describeMachineTranslationFailure(
  failure: {
    readonly retryable: boolean;
    readonly attemptNumber?: number;
    readonly failureCode?: string;
  } | undefined,
): string | undefined {
  if (failure === undefined) return undefined;
  if (isUnprocessableMachineTranslationFailure(failure.failureCode)) {
    return translate("机器翻译无法安全处理当前来源中的复杂占位符；该条将保留原文。");
  }
  return failure.retryable
    ? translate("机器翻译暂时失败，服务器将自动重试（第 {attempt}/5 次）", {
      attempt: failure.attemptNumber ?? 1,
    })
    : translate("机器翻译失败，服务器已停止自动重试。点击右侧“重试此插件”。");
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

function describePluginTranslationSourceMetrics(
  translation: PluginTranslationState,
  catalog: PluginUiCatalog | undefined,
  coverage: ReturnType<typeof calculatePluginTranslationCoverage>,
): readonly PluginLocalizationCoverageSourceMetric[] {
  const currentSources = catalog === undefined ? null : new Set(catalog.strings.map((item) => item.source));
  const currentTranslation = currentSources === null
    ? translation
    : { ...translation, entries: translation.entries.filter((entry) => currentSources.has(entry.source)) };
  if (!currentTranslation.entries.some((entry) => entry.provenanceKind !== undefined)
    && (currentTranslation.upstreamNativeCount ?? 0) === 0) return [];
  const summary = summarizePluginTranslationSources(currentTranslation);
  const authorityNativeCount = inputCatalogMatchesAuthorityArtifact(catalog, currentTranslation)
    ? Math.max((currentTranslation.upstreamNativeCount ?? 0) - summary.reviewedCorrection, 0)
    : 0;
  const effectiveUpstreamNative = Math.max(
    coverage === undefined
      ? (currentTranslation.upstreamNativeCount ?? 0) - summary.reviewedCorrection
      : Math.max(summary.upstreamNative, authorityNativeCount),
    summary.upstreamNative,
  );
  return [
    effectiveUpstreamNative > 0
      ? { label: translate("插件自带 {count}", { count: effectiveUpstreamNative }), tone: "native" as const }
      : undefined,
    summary.reviewedFill > 0
      ? { label: translate("语枢已校对 {count}", { count: summary.reviewedFill }), tone: "reviewed" as const }
      : undefined,
    summary.reviewedCorrection > 0
      ? { label: translate("语枢校对修正 {count}", { count: summary.reviewedCorrection }), tone: "reviewed" as const }
      : undefined,
    summary.automatic > 0
      ? { label: translate("语枢机翻 {count}（未经人工校对）", { count: summary.automatic }), tone: "automatic" as const }
      : undefined,
    summary.published > 0
      ? { label: translate("语枢已发布（未分类）{count}", { count: summary.published }), tone: "published" as const }
      : undefined,
  ].filter((value): value is PluginLocalizationCoverageSourceMetric => value !== undefined);
}

function inputCatalogMatchesAuthorityArtifact(
  catalog: PluginUiCatalog | undefined,
  translation: PluginTranslationState,
): boolean {
  return catalog !== undefined
    && translation.catalogIdentity !== undefined
    && translation.pluginVersion === catalog.pluginVersion
    && translation.sourceUnitCount === translation.catalogIdentity.unitCount
    && (translation.upstreamNativeCount ?? 0) <= translation.catalogIdentity.unitCount
    && translation.catalogIdentity.artifactDigest === catalog.artifactDigest
    && translation.artifactDigest === catalog.artifactDigest
    && catalog.catalogIdentity?.artifactDigest === catalog.artifactDigest;
}

function coverageSummary(
  headline: string,
  complete: boolean,
  scopeMetrics: readonly string[],
  sourceMetrics: readonly PluginLocalizationCoverageSourceMetric[],
  notice?: string,
): PluginLocalizationCoverageSummary {
  return { headline, ...(notice === undefined ? {} : { notice }), complete, scopeMetrics, sourceMetrics };
}

function describeScopeCoverageMetrics(
  coverage: NonNullable<ReturnType<typeof calculatePluginTranslationCoverage>>,
): readonly string[] {
  if (coverage.unattributedNativeCount > 0) {
    return [translate("插件自带 {count} 条（范围明细待同步）", {
      count: coverage.unattributedNativeCount,
    })];
  }
  return coverage.scopes.map((item) => translate("{scope} {translated}/{total}", {
    scope: scopeLabel(item.scope),
    translated: item.translatedCount,
    total: item.totalCount,
  }));
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

function safeIntersectionStatus(
  translation: PluginTranslationState,
  catalog: PluginUiCatalog,
  targetLocale: string,
  cause: {
    readonly catalogDrift: boolean;
    readonly authorityRefreshing?: boolean;
    readonly distributionBlock?: { readonly failureCode?: string };
    readonly machineTranslationFailure?: {
      readonly retryable: boolean;
      readonly attemptNumber?: number;
      readonly failureCode?: string;
    };
  },
): PluginLocalizationStatus {
  const effectiveTranslation = mergeCatalogNativeTranslations(catalog, translation);
  const coverage = calculatePluginTranslationCoverage(catalog, effectiveTranslation, targetLocale);
  const translatedCount = coverage?.translatedCount
    ?? new Set(effectiveTranslation.entries.map((entry) => entry.source)).size;
  const totalCount = coverage?.totalCount ?? translatedCount;
  const missingCount = coverage?.missingCount ?? 0;
  const safeIntersection = missingCount > 0
    ? translate("已安全应用 {translated}/{total} 条匹配译文，{missing} 条暂不可安全应用", {
        translated: translatedCount,
        total: totalCount,
        missing: missingCount,
      })
    : translate("已安全应用 {translated}/{total} 条匹配译文", {
      translated: translatedCount,
      total: totalCount,
    });
  const distributionBlock = cause.distributionBlock === undefined
    ? undefined
    : describeDistributionBlock(cause.distributionBlock.failureCode);
  const machineTranslationFailure = describeMachineTranslationFailure(cause.machineTranslationFailure);
  const authorityRefreshing = cause.authorityRefreshing
    ? translate("服务器正在校验当前精确版本的权威来源与许可证")
    : undefined;
  const headline = distributionBlock
    ?? authorityRefreshing
    ?? machineTranslationFailure
    ?? (cause.catalogDrift ? translate("本地目录与服务器权威目录待同步") : safeIntersection);
  const hasPrimaryCause = distributionBlock !== undefined
    || authorityRefreshing !== undefined
    || machineTranslationFailure !== undefined
    || cause.catalogDrift;
  const notice = hasPrimaryCause
    ? appendSourceSummary(
      safeIntersection,
      cause.catalogDrift && headline !== translate("本地目录与服务器权威目录待同步")
        ? translate("本地目录与服务器权威目录待同步")
        : "",
    )
    : undefined;
  const scopeMetrics = coverage === undefined ? [] : describeScopeCoverageMetrics(coverage);
  const sourceMetrics = describePluginTranslationSourceMetrics(
    effectiveTranslation,
    catalog,
    coverage,
  );
  return {
    kind: distributionBlock !== undefined
      ? "blocked"
      : authorityRefreshing !== undefined
        ? "waiting"
        : machineTranslationFailure !== undefined
          ? isUnprocessableMachineTranslationFailure(
            cause.machineTranslationFailure?.failureCode,
          )
            ? "preserved-source"
            : cause.machineTranslationFailure?.retryable ? "waiting" : "failed"
          : cause.catalogDrift ? "catalog-mismatch" : "localized",
    label: appendSourceSummary(
      headline,
      appendSourceSummary(
        scopeMetrics.join(" · "),
        appendSourceSummary(sourceMetrics.map((metric) => metric.label).join(" · "), notice ?? ""),
      ),
    ),
    coverage: coverageSummary(
      headline,
      missingCount === 0,
      scopeMetrics,
      sourceMetrics,
      notice,
    ),
  };
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
