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
    const sourceSummary = describePluginTranslationSources(input.translation, input.catalog);
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
    return {
      kind: "localized",
      label: appendSourceSummary(
        translate("已本地化 {count} 条", { count: input.translation.entries.length }),
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
  return translation.entries.reduce((current, entry) => {
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
  if (!currentTranslation.entries.some((entry) => entry.provenanceKind !== undefined)) return "";
  const summary = summarizePluginTranslationSources(currentTranslation);
  return [
    summary.upstreamNative > 0 ? translate("插件自带 {count}", { count: summary.upstreamNative }) : "",
    summary.reviewedFill > 0 ? translate("语枢补充 {count}", { count: summary.reviewedFill }) : "",
    summary.reviewedCorrection > 0 ? translate("语枢校订 {count}", { count: summary.reviewedCorrection }) : "",
    summary.automatic > 0 ? translate("自动翻译 {count}", { count: summary.automatic }) : "",
    summary.published > 0 ? translate("语枢已发布 {count}", { count: summary.published }) : "",
  ].filter((value) => value !== "").join(" · ");
}

function appendSourceSummary(label: string, summary: string): string {
  return summary === "" ? label : `${label}；${summary}`;
}
