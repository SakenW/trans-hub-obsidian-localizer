import { describe, expect, it } from "vitest";
import { scanPluginUiStrings } from "../src/plugin-string-scanner";

const plugin = { id: "fixture", name: "Fixture Plugin", description: "", version: "1.0.0", dir: "fixture", enabled: true };
const linked = [
  'function link(parent,url,label){let a=parent.createEl("a");a.textContent=label;a.href=url;parent.append(a);return a}',
  'function renamed(lead,url,label="Learn more"){let f=createFragment();return f.append(document.createTextNode(lead)),link(f,url,label),f}',
].join(";");
const scan = (bundle: string) => scanPluginUiStrings({ plugin, bundle, sourceLocale: "en" });
const descriptor = (name: string) => `const group={type:"group",heading:"Visible group",items:[{name:"Visible setting",desc:${name},render:x=>x}]};`;
const variants = (name: string) => `function display(empty){return renamed(empty?\`\${${name}} Extra explanation. \`:\`\${${name}} \`,docs,"Read more")}`;

function expectRuntimeOnly(catalog: Awaited<ReturnType<typeof scan>>, source: string): void {
  const entry = catalog.strings.find((item) => item.source === source);
  expect(entry, source).toBeDefined();
  expect(entry?.evidence?.length).toBeGreaterThan(0);
  for (const evidence of entry?.evidence ?? []) {
    expect(evidence.literalStart).toBeUndefined();
    expect(evidence.literalEnd).toBeUndefined();
  }
}

describe("indirect UI evidence", () => {
  it.each([
    'class P{forward(x){b.setTooltip(x)}show(){this["forward"]=log;this.forward("Private forwarded label")}}',
    'class P{forward(x){b.setTooltip(x)}show(){`${this.forward=log}`;this.forward("Private forwarded label")}}',
    'const key="forward";class P{forward(x){b.setTooltip(x)}[key](x){log(x)}show(){this.forward("Private forwarded label")}}',
    'class P{static async forward(x){b.setTooltip(x)}show(){this.forward("Private forwarded label")}}',
    'class P{forward(x){eval("x=other");b.setTooltip(x)}show(){this.forward("Private forwarded label")}}',
  ])("rejects indirect dispatch replacement and dynamic parameter writes: %s", async (bundle) => {
    expect((await scan(bundle)).strings.map((item) => item.source)).not.toContain("Private forwarded label");
  });

  it("does not collect an object prototype setter as an enumerable Map key", async () => {
    const catalog = await scan('const commands=new Map(Object.entries({__proto__:Handler,"Visible label":Handler}));for(let k of commands.keys())d.addOption(k,k);');
    expect(catalog.strings.map((item) => item.source)).not.toContain("__proto__");
    expectRuntimeOnly(catalog, "Visible label");
  });
  it("forwards only the unique same-class UI parameter, with runtime-only evidence", async () => {
    const catalog = await scan([
      'class Panel { render(){this.renamed(el,"git-branch","Add conditional command",callback)}',
      'renamed(el,icon,tip,callback){new Button(el).setIcon(icon).setTooltip(tip).onClick(()=>callback())}}',
      'class Other {render(){this.renamed(el,"Internal icon","Private command",callback)} renamed(el,icon,tip,callback){log(tip)}}',
      'class Mixed extends Base {constructor(){super("Internal command type")}}',
    ].join(";"));
    expectRuntimeOnly(catalog, "Add conditional command");
    const sources = catalog.strings.map((item) => item.source);
    for (const text of ["git-branch", "Private command", "Internal icon", "Internal command type"]) expect(sources).not.toContain(text);
  });

  it("forwards only addOption's label argument and accepts tooltip options", async () => {
    const catalog = await scan('class P{render(){this.option("Internal option value","Visible option label");this.hint("Visible tooltip label")}option(value,label){d.addOption(value,label)}hint(label){b.setTooltip(label,{placement:"top"})}}');
    expectRuntimeOnly(catalog, "Visible option label");
    expectRuntimeOnly(catalog, "Visible tooltip label");
    expect(catalog.strings.map((item) => item.source)).not.toContain("Internal option value");
  });

  it.each([
    'tip="Changed";button.setTooltip(tip)',
    'tip+=" suffix";button.setTooltip(tip)',
    'log(`${tip=dynamic}`);button.setTooltip(tip)',
    '{let tip="Local";button.setTooltip(tip)}',
    'function nested(tip){button.setTooltip(tip)}',
    'const nested=tip=>button.setTooltip(tip)',
    'log(tip)',
    'button.setTooltip(transform(tip))',
    'button.setTooltip(tip);log(tip)',
  ])("rejects reassigned, shadowed or non-direct parameters: %s", async (body) => {
    const catalog = await scan(`class Panel{render(){this.forward("Private forwarded label")}forward(tip){${body}}}`);
    expect(catalog.strings.map((item) => item.source)).not.toContain("Private forwarded label");
  });

  it("rejects duplicate/replaced methods and calls with a different this binding", async () => {
    for (const bundle of [
      'class P{render(){this.forward("Private forwarded label")}forward(x){b.setTooltip(x)}forward(x){log(x)}}',
      'class P{render(){this.forward=log;this.forward("Private forwarded label")}forward(x){b.setTooltip(x)}}',
      'class P{render(){function nested(){this.forward("Private forwarded label")}}forward(x){b.setTooltip(x)}}',
      'class P{render(){const object={run(){this.forward("Private forwarded label")}}}forward(x){b.setTooltip(x)}}',
      'class P{render(){this.forward("Private forwarded label")}forward(x){b.setTooltip(x)}get forward(){return log}}',
      'class P{forward=log;render(){this.forward("Private forwarded label")}forward(x){b.setTooltip(x)}}',
    ]) expect((await scan(bundle)).strings.map((item) => item.source)).not.toContain("Private forwarded label");
  });

  it("resolves a renamed structural helper, static descriptor binding and both complete branches", async () => {
    const catalog = await scan(`${linked};var intro="Reusable workflow packages.";${descriptor("intro")}${variants("intro")}`);
    expectRuntimeOnly(catalog, "Reusable workflow packages.");
    expectRuntimeOnly(catalog, "Reusable workflow packages. Extra explanation.");
  });

  it("resolves a static direct UI description binding without linked documentation", async () => {
    expectRuntimeOnly(await scan('const copy="Reusable workflow packages.";setting.setDesc(copy);'), "Reusable workflow packages.");
  });

  it.each([
    'intro="Changed description";',
    'intro+="Changed description";',
    'intro++;',
    'log(`${intro=dynamic}`);',
    'log(`${intro+=dynamic}`);',
    'log(`${(()=>{work()})();intro=dynamic}`);',
    'function setDesc(intro){log(intro)}',
    'function unrelated(intro){return intro}',
    'function unrelated(){let intro="Local description";return intro}',
    'const unrelated=intro=>intro;',
    '({intro}=other);',
  ])("rejects ambiguous description writes/shadowing: %s", async (mutation) => {
    const catalog = await scan(`${linked};var intro="Private package description.";${mutation}${descriptor("intro")}${variants("intro")}`);
    expect(catalog.strings.map((item) => item.source)).not.toContain("Private package description. Extra explanation.");
    expect(catalog.strings.map((item) => item.source)).not.toContain("Private package description.");
  });

  it("rejects dynamic bindings, out-of-scope bindings, unproven helper and non-UI reuse", async () => {
    for (const bundle of [
      `${linked};var intro="Private package description."+dynamic;${descriptor("intro")}${variants("intro")}`,
      `${linked};function hidden(){var intro="Private package description.";}${descriptor("intro")}${variants("intro")}`,
      `function renamed(lead,url,label){log(lead)};var intro="Private package description.";${descriptor("intro")}${variants("intro")}`,
      `${linked};var intro="Private package description.";const data={desc:intro};${variants("intro")}`,
    ]) expect((await scan(bundle)).strings.map((item) => item.source)).not.toContain("Private package description. Extra explanation.");
  });

  it("rejects a linked helper that changes the description before creating its text node", async () => {
    const changed = linked.replace('let f=createFragment()', 'lead="Changed description";let f=createFragment()');
    const catalog = await scan(`${changed};var intro="Private package description.";${descriptor("intro")}${variants("intro")}`);
    expect(catalog.strings.map((item) => item.source)).not.toContain("Private package description. Extra explanation.");
  });

  it.each([
    'renamed=other;',
    'function shadow(renamed){return renamed}',
    'function renamed(lead){return log(lead)}',
  ])("rejects mutated and shadowed structural helper names: %s", async (mutation) => {
    const catalog = await scan(`${linked};var intro="Private package description.";${descriptor("intro")}${mutation}${variants("intro")}`);
    expect(catalog.strings.map((item) => item.source)).not.toContain("Private package description. Extra explanation.");
  });

  it("collects static Map keys only at the option label sink, never their values or patch spans", async () => {
    const catalog = await scan('var commands=new Map(Object.entries({Copy:CopyCommand,"Paste special":PasteCommand}));commands.get(id);for(let key of commands.keys()) dropdown.addOption(key,key);');
    expectRuntimeOnly(catalog, "Copy");
    expectRuntimeOnly(catalog, "Paste special");
    expect(catalog.strings.map((item) => item.source)).not.toContain("CopyCommand");
  });

  it.each([
    'for(let key of commands.keys()){dropdown.addOption(key,"Fixed label")}',
    'commands.get("Private map label");',
    'for(let key of commands.values()){dropdown.addOption(key,key)}',
    'commands.set("Another",Handler);for(let key of commands.keys()){dropdown.addOption(key,key)}',
    'consume(commands);for(let key of commands.keys()){dropdown.addOption(key,key)}',
    'const alias=commands;for(let key of commands.keys()){dropdown.addOption(key,key)}',
    'log(`${consume(commands)}`);for(let key of commands.keys()){dropdown.addOption(key,key)}',
    'for(let key of commands.keys()){log(`${key=dynamic}`);dropdown.addOption(key,key)}',
    'commands=new Map();for(let key of commands.keys()){dropdown.addOption(key,key)}',
    'for(let key of commands.keys()){key="Changed";dropdown.addOption(key,key)}',
    'for(let key of commands.keys()){(()=>{let key="Local";dropdown.addOption(key,key)})()}',
    'function shadow(commands){for(let key of commands.keys()){dropdown.addOption(key,key)}}',
    'for(let key of commands.keys()){log(key)}',
  ])("rejects unconsumed, value-only, mutated, escaped or shadowed Maps: %s", async (consumer) => {
    const catalog = await scan(`const commands=new Map(Object.entries({"Private map label":Handler}));${consumer}`);
    expect(catalog.strings.map((item) => item.source)).not.toContain("Private map label");
  });
});
