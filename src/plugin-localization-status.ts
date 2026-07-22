import { calculatePluginTranslationCoverage } from "./plugin-catalog-diff";
import { translate } from "./client-localization";
import type { PluginSubmissionState, PluginTranslationState } from "./plugin-state";
import type { PluginUiCatalog } from "./plugin-string-scanner";

export type PluginLocalizationStatusKind =
  | "localized"
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
    const coverage = calculatePluginTranslationCoverage(input.catalog, input.translation, input.targetLocale);
    const sourceSummary = describePluginTranslationSources(
      input.translation,
      input.catalog,
      coverage?.missingCount ?? 0,
    );
    if (coverage !== undefined && coverage.missingCount > 0) {
      return {
        kind: "waiting",
        label: appendSourceSummary(
          translate("已本地化 {translated}/{total} 条（{percent}%），{missing} 条等待发布", {
            translated: coverage.translatedCount,
            total: coverage.totalCount,
            percent: coverage.percent,
            missing: coverage.missingCount,
          }),
          sourceSummary,
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
          sourceSummary,
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
          sourceSummary,
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
  if (submission.contributionState === "rejected" || submission.localizationContributionState === "rejected") {
    return { kind: "failed", label: translate("处理失败：需求未被接受") };
  }
  if (submission.sourceVersionId !== undefined) return { kind: "waiting", label: translate("等待目标语言译文发布") };
  if (submission.localizationContributionId !== undefined) {
    return { kind: "waiting", label: translate("等待本地化需求处理") };
  }
  return { kind: "waiting", label: translate("等待来源收录") };
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
  missingCount: number,
): string {
  const currentSources = catalog === undefined ? null : new Set(catalog.strings.map((item) => item.source));
  const currentTranslation = currentSources === null
    ? translation
    : { ...translation, entries: translation.entries.filter((entry) => currentSources.has(entry.source)) };
  if (!currentTranslation.entries.some((entry) => entry.provenanceKind !== undefined)
    && (currentTranslation.upstreamNativeCount ?? 0) === 0
    && missingCount === 0) return "";
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
    missingCount > 0 ? translate("待补 {count}", { count: missingCount }) : "",
  ].filter((value) => value !== "").join(" · ");
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
