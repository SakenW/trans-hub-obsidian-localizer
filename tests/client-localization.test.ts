import { afterEach, describe, expect, it } from "vitest";

import { localizedClientName, setClientLocale, translate } from "../src/client-localization";

describe("client localization", () => {
  afterEach(() => { setClientLocale("zh-CN"); });

  it("uses the selected translation target for the plugin's own UI", () => {
    setClientLocale("en");
    expect(translate("翻译为")).toBe("Translate to");
    expect(translate("已选择 {selected} / {total}", { selected: 2, total: 3 }))
      .toBe("Selected 2 / 3");
    expect(localizedClientName()).toBe("Trans-Hub Localizer");
  });

  it("keeps Simplified Chinese source copy for the Simplified Chinese target", () => {
    setClientLocale("zh-CN");
    expect(translate("翻译为")).toBe("翻译为");
    expect(localizedClientName()).toBe("语枢 · 插件本地化");
  });

  it("falls back deterministically when a bundled target pack is not published yet", () => {
    setClientLocale("ja");
    expect(translate("翻译为")).toBe("Translate to");
  });
});
