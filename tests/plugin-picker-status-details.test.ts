import { describe, expect, it } from "vitest";

import { renderPluginPickerCoverageDetails } from "../src/plugin-picker-status-details";

describe("renderPluginPickerCoverageDetails", () => {
  it("在覆盖明细之前显示分发阻断原因", () => {
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
      scopeMetrics: [],
      sourceMetrics: [],
    });

    expect(rendered).toEqual([
      "无法公开发布：上游许可证不在当前安全分发范围",
      "可安全应用 15/466 条匹配译文，451 条暂无权威译文",
    ]);
  });
});
