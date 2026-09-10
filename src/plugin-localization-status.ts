import type { PublicLocalizationStatusProjection } from "@trans-hub/client-protocol";

import {
  calculatePluginTranslationCoverage,
  comparePluginCatalogIdentity,
  isPluginInterfaceString,
  mergeCatalogNativeTranslations,
  unmatchedPluginInterfaceStrings,
} from "./plugin-catalog-diff";
import { translate } from "./client-localization";
import {
  getPluginSubmissionForLocale,
  getPluginTranslation,
  type PluginState,
  type PublicPluginDiscoveryState,
  type PluginSubmissionState,
  type PluginTranslationState,
} from "./plugin-state";
import type { PluginUiCatalog } from "./plugin-string-scanner";
import { isTargetLocale, type TargetLocale } from "./product-config";

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
  /**
   * The selected plugin has no server submission yet, so the client is still
   * preparing its first safe discovery and localization contribution.
   */
  readonly initialSubmission?: boolean;
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

export function isPublicDiscoveryManuallyRetryable(
  discovery: PublicPluginDiscoveryState | undefined,
  targetLocale: TargetLocale,
): boolean {
  if (discovery === undefined || !discovery.targetLocales.includes(targetLocale)) return false;
  const projection = discovery.localizationProjection;
  const healthyProjectionInFlight = projection?.targetLocale === targetLocale
    && ["discovery", "validating", "parsing", "translating", "publishing"]
      .includes(projection.stage);
  const requiresFreshRegistryObservation = [
    "registry_projection_stale",
    "registry_binding_changed",
  ].includes(discovery.blockedReasonCode ?? "");
  return discovery.statusRevision === 2
    && discovery.classification === "blocked"
    && discovery.taskState === "blocked"
    && (
      // A stale projection or changed binding has no current source authority.
      // A user-clicked retry submits a fresh observation only; Stage A
      // revalidates the registry before any source or translation work exists.
      (requiresFreshRegistryObservation && (discovery.retryGeneration ?? 0) === 0)
      || (
        discovery.retryAllowed === true
        && discovery.retryAfterSeconds === 0
        && ["registry_entry_unknown"]
          .includes(discovery.blockedReasonCode ?? "")
      )
    )
    // The server's blocked result supersedes a cached in-flight projection for
    // a fresh registry observation. Other retryable failures still wait for a
    // healthy in-flight projection to settle.
    && (requiresFreshRegistryObservation || !healthyProjectionInFlight);
}

/**
 * A pre-recovery receipt can retain an invalid registry binding while its
 * cached localization projection still says it is translating. Re-observe
 * that exact state once after the client has learned how to recover it.
 *
 * Ordinary stale projections and receipts that already consumed a recovery
 * generation are excluded, so periodic synchronization cannot create an
 * unbounded submission loop.
 */
export function requiresOneTimeRegistryBindingRecovery(
  discovery: PublicPluginDiscoveryState | undefined,
  targetLocale: TargetLocale,
): boolean {
  return discovery?.statusRevision === 2
    && discovery.targetLocales.includes(targetLocale)
    && discovery.classification === "blocked"
    && discovery.taskState === "blocked"
    && discovery.blockedReasonCode === "registry_binding_changed"
    && (discovery.retryGeneration ?? 0) === 0;
}

export function visiblePluginManualRetryKind(input: {
  readonly state: Pick<PluginState, "pluginCatalogs" | "pluginSubmissions" | "publicPluginDiscoveries" | "pluginTranslations">;
  readonly pluginId: string;
  readonly targetLocale: TargetLocale;
  readonly sourceSelectable: boolean;
  readonly hasSession: boolean;
}): PluginManualRetryKind | null {
  if (!input.sourceSelectable || !input.hasSession) return null;
  const submission = getPluginSubmissionForLocale(input.state, input.pluginId, input.targetLocale);
  const translation = getPluginTranslation(input.state, input.pluginId, input.targetLocale);
  const catalog = input.state.pluginCatalogs[input.pluginId];
  // A historical discovery or synchronization error must not leave a retry
  // affordance on a card whose exact current catalog is already complete.
  if (submission !== undefined && hasCompleteAuthoritativeTranslation({
    translation, catalog, targetLocale: input.targetLocale,
  }, submission)) return null;
  const current = describePluginLocalizationStatus({
    submission, translation, catalog,
    publicDiscovery: input.state.publicPluginDiscoveries[input.pluginId],
    targetLocale: input.targetLocale, hasSession: input.hasSession,
  });
  if (current.kind === "localized" || current.kind === "preserved-source") return null;
  const discovery = input.state.publicPluginDiscoveries[input.pluginId];
  if (isPublicDiscoveryManuallyRetryable(
    discovery,
    input.targetLocale,
  )) {
    return "resubmit";
  }
  const retryKind = pluginManualRetryKind({
    submission,
    translation,
    catalog,
    targetLocale: input.targetLocale,
  });
  // A current server projection owns the next source transition. In
  // particular, `published` only needs the ordinary sync pull; resubmitting
  // source discovery cannot make that download faster and made published
  // cards look failed. Keep a genuine local resynchronization error visible.
  if (
    discovery?.localizationProjection?.targetLocale === input.targetLocale
    && ["discovery", "validating", "parsing", "translating", "publishing", "published"]
      .includes(discovery.localizationProjection.stage)
    && retryKind === "resubmit"
  ) return null;
  if (
    discovery?.localizationProjection?.targetLocale === input.targetLocale
    && retryKind === "resynchronize"
    && discoverySupersedesLocalSynchronizationError(discovery, submission?.lastError)
  ) return null;
  if (discovery?.taskState === "blocked") return null;
  return retryKind;
}

function discoverySupersedesLocalSynchronizationError(
  discovery: PublicPluginDiscoveryState,
  error: PluginSubmissionState["lastError"],
): boolean {
  if (error?.updatedAt === undefined) return false;
  const errorAt = Date.parse(error.updatedAt);
  const discoveryAt = Date.parse(
    discovery.updatedAt ?? discovery.localizationProjection?.updatedAt ?? discovery.submittedAt,
  );
  return Number.isFinite(errorAt) && Number.isFinite(discoveryAt) && errorAt < discoveryAt;
}

export function pluginManualRetryKind(input: {
  readonly submission?: PluginSubmissionState;
  readonly translation?: PluginTranslationState;
  readonly catalog?: PluginUiCatalog;
  readonly targetLocale: string;
}): PluginManualRetryKind | null {
  if (input.targetLocale === "en") return null;
  const submission = input.submission;
  const currentCatalogSubmission = submission !== undefined
    && input.catalog !== undefined
    && submission.catalogDigest === input.catalog.digest
    && submission.pluginVersion === input.catalog.pluginVersion;
  if (submission === undefined) return null;
  if (submission.lastError?.code === "source_artifact_mismatch") {
    // A rejected mismatch contribution can be stale server-side: the object
    // version digest may predate the bundle-normalization change while the
    // local file matches the official release.  The manual resubmit submits a
    // fresh discovery observation so the server can re-acquire the artifact
    // and reconcile the digest (one-time authority recovery).  A normal
    // mismatch pause (contribution not rejected) keeps no retry button.
    if (
      submission.contributionState === "rejected"
    ) {
      return "resubmit";
    }
    return null;
  }
  if (
    currentCatalogSubmission
    && ["public_catalog_unavailable", "plugin_sync_failed"].includes(submission.lastError?.code ?? "")
    && isCurrentLocaleSynchronizationError(submission.lastError, input.targetLocale)
  ) return "resynchronize";
  if (hasCurrentPublishedTranslation(input, submission)) return null;
  if (submission.lastError?.code === "translation_pack_invalid") return null;
  if (
    submission.contributionState === "rejected"
    && !hasCompleteAuthoritativeTranslation(input, submission)
  ) return "resubmit";
  if (isCurrentLocaleSynchronizationError(submission.lastError, input.targetLocale)) return "resynchronize";
  if (
    input.translation?.targetLocale === input.targetLocale
    && !currentCatalogSubmission
  ) return null;
  if (hasCompleteAuthoritativeTranslation(input, submission)) return null;
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
  readonly publicDiscovery?: PublicPluginDiscoveryState;
  readonly translation?: PluginTranslationState;
  readonly catalog?: PluginUiCatalog;
  readonly targetLocale: string;
  readonly hasSession?: boolean;
  readonly requiresReconnect?: boolean;
}): PluginLocalizationStatus {
  if (input.targetLocale === "en") {
    return { kind: "localized", label: translate("源语言，无需翻译") };
  }
  const exactLocalPublishedTranslation = hasExactLocalPublishedTranslation(input);
  if (input.hasSession === false && !exactLocalPublishedTranslation) {
    return {
      kind: "login-required",
      label: translate(input.requiresReconnect ? "重新连接后继续同步" : "登录后同步"),
    };
  }
  const availableProjection = matchingCurrentLocalizationProjection(input);
  const usableCachedTranslation = hasUsableSafeCachedTranslation(input);
  // A real server block/revocation is current authority truth even when an old
  // exact cache exists. Published/in-flight projections still let safe cache
  // use remain visible.
  const matchingProjection = !exactLocalPublishedTranslation
    || !usableCachedTranslation
    || availableProjection?.stage === "blocked"
    ? availableProjection
    : undefined;
  const currentProjection = matchingProjection !== undefined
    && usableCachedTranslation
    && matchingProjection.stage !== "blocked"
    && input.translation?.targetLocale === input.targetLocale
    && input.translation.sourceVersionId === matchingProjection.sourceVersionId
    ? undefined
    : matchingProjection;
  if (currentProjection !== undefined) {
    switch (currentProjection.stage) {
      case "discovery":
        return { kind: "waiting", label: translate("已提交公共目录发现，等待服务端处理") };
      case "validating":
        return { kind: "waiting", label: translate("正在准备当前权威版本的译文任务") };
      case "parsing":
        return { kind: "waiting", label: translate("当前权威版本正在解析并建立来源目录") };
      case "translating":
        return { kind: "waiting", label: translate("当前权威版本正在翻译") };
      case "publishing":
        return { kind: "waiting", label: translate("译文正在生成可下载发布版本") };
      case "published":
        return { kind: "waiting", label: translate("译文已发布，等待客户端下载") };
      case "blocked":
        return { kind: "blocked", label: describeDiscoveryBlock(input.publicDiscovery?.blockedReasonCode) };
    }
  }
  if (
    isTargetLocale(input.targetLocale)
    && input.publicDiscovery?.targetLocales.includes(input.targetLocale)
    && !exactLocalPublishedTranslation
    && input.translation?.targetLocale !== input.targetLocale
  ) {
    if (input.publicDiscovery.taskState === "blocked") {
      return isTargetLocale(input.targetLocale)
        && isPublicDiscoveryManuallyRetryable(input.publicDiscovery, input.targetLocale)
        ? {
            kind: "failed",
            label: translate("目录条目暂无法处理。可使用重试操作恢复。"),
          }
        : {
            kind: "blocked",
            label: describeDiscoveryBlock(input.publicDiscovery.blockedReasonCode),
          };
    }
    if (input.publicDiscovery.taskState === "result_verified") {
      return {
        kind: "waiting",
        label: translate("服务端已验证当前来源，正在建立本地化发布状态。"),
      };
    }
    return { kind: "waiting", label: translate("正在验证公共目录条目…") };
  }
  const currentCatalogSubmission = input.submission !== undefined
    && input.catalog !== undefined
    && input.submission.catalogDigest === input.catalog.digest
    && input.submission.pluginVersion === input.catalog.pluginVersion;
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
    && input.translation?.targetLocale !== input.targetLocale
    && input.submission?.contributionState === "rejected"
  ) {
    return {
      kind: "failed",
      label: translate("需求未被接受。可使用重试操作恢复。"),
    };
  }
  if (input.translation?.targetLocale === input.targetLocale
    && usableCachedTranslation) {
    if (input.catalog !== undefined) {
      const identity = comparePluginCatalogIdentity(input.catalog, input.translation);
      if (!identity.exact) return safeIntersectionStatus(input.translation, input.catalog, input.targetLocale);
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
      const headline = translate("已获取 {translated}/{total} 条匹配译文（{percent}%），{missing} 条尚未发布", {
        translated: coverage.translatedCount,
        total: coverage.totalCount,
        percent: coverage.percent,
        missing: coverage.missingCount,
      });
      return {
        kind: "localized",
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
      const headline = translate("已获取 {translated}/{total} 条匹配译文（{percent}%）", {
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
    const localizedLabel = translate("已本地化 {count} 条", {
      count: new Set(input.translation.entries.map((entry) => entry.source)).size,
    });
    const cachedTranslationLabel = translate("已获取 {count} 条缓存译文，等待当前目录匹配", {
      count: new Set(input.translation.entries.map((entry) => entry.source)).size,
    });
    const waitingForCatalog = input.catalog === undefined;
    return {
      kind: waitingForCatalog ? "waiting" : "localized",
      label: appendSourceSummary(
        waitingForCatalog ? cachedTranslationLabel : localizedLabel,
        sourceSummary,
      ),
    };
  }
  const submission = input.submission;
  const recoverableSynchronizationError = submission?.lastError;
  if (recoverableSynchronizationError?.code === "translation_pack_invalid") {
    return {
      kind: "failed",
      label: translate("译文包校验未通过，已保留现有译文；无需重试，等待服务端修复。"),
    };
  }
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
  if (submission === undefined) {
    return {
      kind: "waiting",
      label: translate("正在准备首次本地化…"),
      initialSubmission: true,
    };
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
  if (submission.contributionState === "rejected") {
    return {
      kind: "failed",
      label: translate("需求未被接受。可使用重试操作恢复。"),
    };
  }
  if (submission.sourceVersionId !== undefined) return { kind: "waiting", label: translate("等待目标语言译文发布") };
  return { kind: "waiting", label: translate("等待来源收录") };
}

function hasExactLocalPublishedTranslation(input: {
  readonly translation?: PluginTranslationState;
  readonly catalog?: PluginUiCatalog;
  readonly targetLocale: string;
}): boolean {
  const { catalog, translation } = input;
  // Older verified caches predate per-entry provenance and published counts;
  // exact catalog identity remains their fail-closed publication evidence.
  return catalog !== undefined
    && translation !== undefined
    && translation.pluginId === catalog.pluginId
    && (translation.authorityPluginVersion ?? translation.pluginVersion) === catalog.pluginVersion
    && translation.targetLocale === input.targetLocale
    && comparePluginCatalogIdentity(catalog, translation).exact;
}

function hasUsableSafeCachedTranslation(input: {
  readonly translation?: PluginTranslationState;
  readonly catalog?: PluginUiCatalog;
  readonly targetLocale: string;
}): boolean {
  if (input.translation?.targetLocale !== input.targetLocale) return false;
  // Without a current scan we cannot claim an exact intersection, but an
  // authenticated non-empty cache remains a pending cached state (not a
  // localized result) and must not be discarded from the UI.
  if (input.catalog === undefined) return input.translation.entries.length > 0;
  const unmatched = new Set(unmatchedPluginInterfaceStrings(input.catalog, input.translation));
  if (input.catalog.strings.some((entry) => isPluginInterfaceString(entry) && !unmatched.has(entry.source))) {
    return true;
  }
  // A numeric upstream-native aggregate is a usable local-language signal only
  // for the same authoritative artifact/version; it must not rescue an
  // incompatible zero-match cached dictionary.
  const authorityVersion = input.translation.authorityPluginVersion ?? input.translation.pluginVersion;
  return (input.translation.upstreamNativeCount ?? 0) > 0
    && authorityVersion === input.catalog.pluginVersion
    && (input.translation.artifactDigest === undefined
      || input.catalog.artifactDigest === undefined
      || input.translation.artifactDigest === input.catalog.artifactDigest)
    && (calculatePluginTranslationCoverage(input.catalog, input.translation, input.targetLocale)?.translatedCount ?? 0) > 0;
}

function describeDiscoveryBlock(reason: string | undefined): string {
  switch (reason) {
    case "executor_retry_exhausted": return translate("自动处理多次失败，需要服务端恢复；反复刷新不会重新启动。");
    case "source_validation_rejected": return translate("插件来源验证未通过，需要服务端核查后才能继续。");
    case "validator_not_approved": return translate("插件来源与当前验证规则不匹配，需要服务端核查。");
    case "registry_binding_changed": return translate("插件来源绑定已变化，等待服务端确认。");
    default: return translate("当前权威版本暂无法公开发布");
  }
}

function matchingCurrentLocalizationProjection(input: {
  readonly publicDiscovery?: PublicPluginDiscoveryState;
  readonly catalog?: PluginUiCatalog;
  readonly targetLocale: string;
}): PublicLocalizationStatusProjection | undefined {
  const projection = input.publicDiscovery?.localizationProjection;
  if (
    projection === undefined
    || input.catalog === undefined
    || projection.discoveryId !== input.publicDiscovery?.discoveryId
    || projection.externalObjectId !== input.catalog.pluginId
    || projection.targetLocale !== input.targetLocale
    || (
      input.publicDiscovery.catalogIdentityDigest !== undefined
      && input.publicDiscovery.catalogIdentityDigest !== input.catalog.digest
    )
    || (
      input.publicDiscovery.catalogIdentityDigest === undefined
      && projection.catalogIdentityDigest !== null
      && projection.catalogIdentityDigest?.hex !== input.catalog.digest
    )
  ) return undefined;
  return projection;
}

function hasCurrentPublishedTranslation(
  input: Pick<Parameters<typeof pluginManualRetryKind>[0], "catalog" | "targetLocale" | "translation">,
  submission: PluginSubmissionState,
): boolean {
  return input.catalog !== undefined
    && input.translation?.targetLocale === input.targetLocale
    && input.translation.sourceVersionId === submission.sourceVersionId
    && (input.translation.authorityPluginVersion ?? input.translation.pluginVersion)
      === input.catalog.pluginVersion
    && comparePluginCatalogIdentity(input.catalog, input.translation).exact;
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
  const currentSources = catalog === undefined ? null : new Set(catalog.strings.filter(isPluginInterfaceString).map((item) => item.source));
  const currentTranslation = currentSources === null
    ? translation
    : { ...translation, entries: translation.entries.filter((entry) => currentSources.has(entry.source)) };
  if (!currentTranslation.entries.some((entry) => entry.provenanceKind !== undefined)
    && (currentTranslation.upstreamNativeCount ?? 0) === 0) return [];
  const summary = summarizePluginTranslationSources(currentTranslation);
  const authorityNativeCount = inputCatalogMatchesAuthorityArtifact(catalog, currentTranslation)
    ? Math.max((currentTranslation.catalogIdentity?.scopes.some((item) => item.scope === "readme" && item.unitCount > 0)
      ? currentTranslation.upstreamScopeCoverage?.["runtime-ui"] ?? 0
      : currentTranslation.upstreamNativeCount ?? 0) - summary.reviewedCorrection, 0)
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
    && (translation.authorityPluginVersion ?? translation.pluginVersion) === catalog.pluginVersion
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

function appendSourceSummary(label: string, summary: string): string {
  return summary === "" ? label : `${label}；${summary}`;
}

function safeIntersectionStatus(
  translation: PluginTranslationState,
  catalog: PluginUiCatalog,
  targetLocale: string,
): PluginLocalizationStatus {
  const effectiveTranslation = mergeCatalogNativeTranslations(catalog, translation);
  const coverage = calculatePluginTranslationCoverage(catalog, effectiveTranslation, targetLocale);
  const translatedCount = coverage?.translatedCount
    ?? new Set(effectiveTranslation.entries.map((entry) => entry.source)).size;
  const totalCount = coverage?.totalCount ?? translatedCount;
  const missingCount = coverage?.missingCount ?? 0;
  const safeIntersection = missingCount > 0
    ? translate("已获取 {translated}/{total} 条匹配界面译文，{missing} 条保留原文", {
        translated: translatedCount,
        total: totalCount,
        missing: missingCount,
      })
    : translate("已获取 {translated}/{total} 条匹配界面译文", {
      translated: translatedCount,
      total: totalCount,
    });
  const authorityPluginVersion = translation.authorityPluginVersion ?? translation.pluginVersion;
  const versionNotice = authorityPluginVersion === catalog.pluginVersion
    ? undefined
    : translate("当前使用 {version} 的本地化译文；插件可继续使用，建议升级至 {version} 以获得最佳匹配", {
        version: authorityPluginVersion,
      });
  const safeIntersectionWithVersion = appendSourceSummary(
    safeIntersection,
    versionNotice ?? "",
  );
  const headline = safeIntersectionWithVersion;
  const scopeMetrics = coverage === undefined ? [] : describeScopeCoverageMetrics(coverage);
  const sourceMetrics = describePluginTranslationSourceMetrics(
    effectiveTranslation,
    catalog,
    coverage,
  );
  return {
    kind: "localized",
    label: appendSourceSummary(
      headline,
      appendSourceSummary(
        scopeMetrics.join(" · "),
        sourceMetrics.map((metric) => metric.label).join(" · "),
      ),
    ),
    coverage: coverageSummary(
      headline,
      missingCount === 0,
      scopeMetrics,
      sourceMetrics,
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
