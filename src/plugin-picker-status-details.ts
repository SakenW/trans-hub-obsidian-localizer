import { translate } from "./client-localization";
import type {
  PluginCatalogMismatchSummary,
  PluginLocalizationCoverageSummary,
} from "./plugin-localization-status";

export function renderPluginPickerCatalogMismatchDetails(
  container: HTMLElement,
  summary: PluginCatalogMismatchSummary,
): void {
  const details = container.createDiv({ cls: "trans-hub-plugin-picker__catalog-details" });
  details.createDiv({
    text: translate("已安全应用 {count} 条精确命中译文", { count: summary.safelyAppliedCount }),
    cls: "trans-hub-plugin-picker__catalog-applied",
  });
  if (summary.currentCatalog === undefined) return;

  const facts = details.createDiv({ cls: "trans-hub-plugin-picker__catalog-facts" });
  facts.createSpan({
    text: translate("当前目录 {count} 条", { count: summary.currentCatalog.totalCount }),
    cls: "trans-hub-plugin-picker__catalog-total",
  });
  for (const metric of [
    translate("插件自带 {count}", { count: summary.currentCatalog.nativeCount }),
    translate("待补 {count}", { count: summary.currentCatalog.missingCount }),
  ]) {
    facts.createSpan({
      text: metric,
      cls: "trans-hub-plugin-picker__catalog-metric",
    });
  }
}

export function renderPluginPickerCoverageDetails(
  container: HTMLElement,
  summary: PluginLocalizationCoverageSummary,
): void {
  const details = container.createDiv({ cls: "trans-hub-plugin-picker__catalog-details" });
  if (summary.notice !== undefined) {
    details.createDiv({
      text: summary.notice,
      cls: "trans-hub-plugin-picker__provenance",
    });
  }
  details.createDiv({
    text: summary.headline,
    cls: "trans-hub-plugin-picker__catalog-applied",
  });
  if (summary.sourceMetrics.length > 0) {
    const sources = details.createDiv({ cls: "trans-hub-plugin-picker__coverage-sources" });
    for (const metric of summary.sourceMetrics) {
      sources.createSpan({
        text: metric.label,
        cls: `trans-hub-plugin-picker__coverage-source mod-${metric.tone}`,
      });
    }
  }
  if (summary.scopeMetrics.length === 0) return;

  const scope = details.createDiv({ cls: "trans-hub-plugin-picker__coverage-scope" });
  scope.createSpan({
    text: translate("覆盖范围"),
    cls: "trans-hub-plugin-picker__coverage-scope-label",
  });
  scope.createSpan({ text: summary.scopeMetrics.join(" · ") });
}
