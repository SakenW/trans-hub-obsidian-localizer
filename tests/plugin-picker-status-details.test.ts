import { describe, expect, it } from "vitest";

import { renderPluginPickerCoverageDetails } from "../src/plugin-picker-status-details";

describe("renderPluginPickerCoverageDetails", () => {
  it("详情保留阻断原因和来源范围，不重复卡片摘要", () => {
    const rendered: string[] = [];
    const details = {
      createDiv(options: { readonly text?: string }) {
        if (options.text !== undefined) rendered.push(options.text);
        return details;
      },
      createSpan(options: { readonly text?: string }) {
        if (options.text !== undefined) rendered.push(options.text);
        return details;
      },
    };
    const container = {
      createDiv() {
        return details;
      },
    } as unknown as HTMLElement;

    renderPluginPickerCoverageDetails(container, {
      notice: "无法公开发布：上游许可证不在当前安全分发范围",
      headline: "可安全应用 15/466 条匹配译文，451 条暂无权威译文",
      complete: false,
      scopeMetrics: ["插件界面 15/466"],
      sourceMetrics: [{ label: "插件自带 15", tone: "native" }],
    });

    expect(rendered).toEqual([
      "无法公开发布：上游许可证不在当前安全分发范围",
      "插件自带 15",
      "覆盖范围",
      "插件界面 15/466",
    ]);
  });
});
