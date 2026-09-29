import { describe, expect, it } from "vitest";
import { scanPluginUiStrings } from "../src/plugin-string-scanner";

const plugin = { id: "fixture", name: "Fixture", description: "", version: "1.0.0", dir: "fixture", enabled: true };
const rows = 'const choices=[{type:"Template",label:"Template",description:"Create a note from a template file.",iconId:"file-text"},{type:"Capture",label:"Capture",description:"Add text to a note.",iconId:"pencil"}];';
const menu = 'for(let choice of choices)menu.addItem(item=>item.setTitle(`${choice.label} \\u2014 ${choice.description}`).setIcon(choice.iconId));';
const scan = (bundle: string) => scanPluginUiStrings({ plugin, sourceLocale: "en", bundle });

describe("composed menu titles", () => {
  it("collects full rendered titles with runtime-only evidence", async () => {
    const catalog = await scan(rows + menu);
    for (const source of ["Template — Create a note from a template file.", "Capture — Add text to a note."]) {
      const item = catalog.strings.find((entry) => entry.source === source);
      expect(item?.evidence).toEqual([expect.objectContaining({ symbol: "composedMenuTitle" })]);
      expect(item?.evidence?.[0]).not.toHaveProperty("literalStart");
      expect(item?.evidence?.[0]).not.toHaveProperty("literalEnd");
    }
  });

  it.each([
    rows,
    rows + 'for(let choice of choices)log(`${choice.label} \\u2014 ${choice.description}`);',
    rows + 'const copy=choices;' + menu,
    rows + menu.replace("choice.description", "choice.type"),
    rows + 'for(let choice of choices){choice.label="Changed";menu.addItem(item=>item.setTitle(`${choice.label} \\u2014 ${choice.description}`));}',
    rows.replace('description:"Add text to a note."', "description:dynamic") + menu,
  ])("rejects unrendered, aliased or dynamic data: %s", async (bundle) => {
    expect((await scan(bundle)).strings.map((item) => item.source))
      .not.toContain("Template — Create a note from a template file.");
  });
});
