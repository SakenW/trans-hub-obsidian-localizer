import { describe, expect, it } from "vitest";
import { scanPluginUiStrings } from "../src/plugin-string-scanner";

const plugin = { id: "sample", name: "Example Plugin", version: "1.0.0", description: "Example workflow", dir: ".obsidian/plugins/sample", enabled: true };
const bundle = `
var baseline={settings:{name:"Larger symbols",desc:"Show bigger symbols",hint:"Keep %s backups"}};
var english=commonJS((unused,module)=>{module.exports={settings:{name:"Larger symbols",desc:"Show bigger symbols",hint:"Keep %s backups"}}});
var chinese=commonJS((unused,module)=>{module.exports={settings:{name:"大号符号",desc:"显示更大的符号",hint:"保留 %s 份备份"}}});
var german=commonJS((unused,module)=>{module.exports={settings:{name:"Große Symbole",desc:"Größere Symbole anzeigen",hint:"%s Backups behalten"}}});
function getText(locale){let promise;switch(locale){
case "en-GB":promise=Promise.resolve().then(()=>interop(english(),1));break;
case "zh":promise=Promise.resolve().then(()=>interop(chinese(),1));break;
case "de":promise=Promise.resolve().then(()=>interop(german(),1));break;
default:return baseline}
return promise;}
`;

describe("lazy bundled locale catalogs", () => {
  it("binds native Chinese to the literal English fallback without executing loaders", async () => {
    const result = await scanPluginUiStrings({ plugin, bundle, sourceLocale: "en", targetLocale: "zh-CN" });
    expect(result.strings.find((entry) => entry.source === "Larger symbols")?.nativeTarget).toBe("大号符号");
    expect(result.strings.find((entry) => entry.source === "Keep %s backups")?.nativeTarget).toBe("保留 %s 份备份");
    expect(result.strings.some((entry) => entry.source === "Große Symbole")).toBe(false);
  });
  it("rejects native targets with incompatible placeholders", async () => {
    const result = await scanPluginUiStrings({ plugin, bundle: bundle.replace("保留 %s 份备份", "保留备份"), sourceLocale: "en", targetLocale: "zh-CN" });
    expect(result.strings.find((entry) => entry.source === "Keep %s backups")?.nativeTarget).toBeUndefined();
  });
  it("does not bind a loader that writes a different object from its module parameter", async () => {
    const result = await scanPluginUiStrings({ plugin, bundle: bundle.replaceAll("module.exports", "other.exports"), sourceLocale: "en", targetLocale: "zh-CN" });
    expect(result.strings.every((entry) => entry.nativeTarget === undefined)).toBe(true);
  });
  it("does not treat an unrelated fallback as English", async () => {
    const result = await scanPluginUiStrings({ plugin, bundle: bundle.replace('name:"Larger symbols",desc:"Show bigger symbols",hint:"Keep %s backups"', 'name:"Unrelated value",desc:"Another value",hint:"Different value"'), sourceLocale: "en", targetLocale: "zh-CN" });
    expect(result.strings.every((entry) => entry.nativeTarget === undefined)).toBe(true);
  });
});
