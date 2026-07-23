import { afterEach, describe, expect, it } from "vitest";

import {
  isClientDisplayName,
  localizedClientName,
  setClientLocale,
  translate,
} from "../src/client-localization";

describe("client localization", () => {
  afterEach(() => { setClientLocale("zh-CN"); });

  it("uses the selected translation target for the plugin's own UI", () => {
    setClientLocale("en");
    expect(translate("翻译为")).toBe("Translate to");
    expect(translate("已选择 {selected} / {total}", { selected: 2, total: 3 }))
      .toBe("Selected 2 / 3");
    expect(localizedClientName()).toBe("Trans-Hub Localizer");
    expect(translate("查看进展并参与贡献")).toBe("View progress and contribute");
    expect(translate("查看详情")).toBe("View details");
    expect(translate("收起详情")).toBe("Hide details");
    expect(translate("重试此插件")).toBe("Retry this plugin");
    expect(translate("需要重试")).toBe("Retry needed");
  });

  it("keeps Simplified Chinese source copy for the Simplified Chinese target", () => {
    setClientLocale("zh-CN");
    expect(translate("翻译为")).toBe("翻译为");
    expect(localizedClientName()).toBe("语枢 · 插件本地化");
  });

  it("recognizes the previous navigation title after switching client locale", () => {
    setClientLocale("zh-CN");
    const previousNavigationTitle = localizedClientName();

    setClientLocale("en");

    expect(localizedClientName()).toBe("Trans-Hub Localizer");
    expect(isClientDisplayName(previousNavigationTitle)).toBe(true);
    expect(isClientDisplayName(localizedClientName())).toBe(true);
    expect(isClientDisplayName("Dataview")).toBe(false);
  });

  it("falls back deterministically when a bundled target pack is not published yet", () => {
    setClientLocale("ja");
    expect(translate("翻译为")).toBe("Translate to");
  });
});
