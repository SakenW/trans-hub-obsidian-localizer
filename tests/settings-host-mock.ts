/** Small DOM/Obsidian host for exercising callbacks; no network or real files. */
type Options = { text?: string; cls?: string | string[] };
export class TestElement {
  children: TestElement[] = [];
  attrs = new Map<string, string>();
  classes = new Set<string>();
  text = "";
  isConnected = true;
  scrollTop = 0;
  constructor(options: Options = {}) { this.text = options.text ?? ""; this.addClass(...(typeof options.cls === "string" ? options.cls.split(" ") : options.cls ?? [])); }
  createDiv(options: Options = {}): TestElement { const child = new TestElement(options); this.children.push(child); return child; }
  createSpan(options: Options = {}): TestElement { return this.createDiv(options); }
  createEl(tag: string, options: Options = {}): TestElement { const child = this.createDiv(options); child.attrs.set("tag", tag); return child; }
  setText(text: string): void { this.text = text; }
  empty(): void { this.children = []; }
  setAttr(key: string, value: string): void { this.attrs.set(key, value); }
  setAttrs(attrs: Record<string, string>): void { for (const [key, value] of Object.entries(attrs)) this.setAttr(key, value); }
  addClass(...names: string[]): void { for (const name of names) this.classes.add(name); }
  removeClass(name: string): void { this.classes.delete(name); }
  toggleClass(name: string, enabled: boolean): void { if (enabled) this.classes.add(name); else this.classes.delete(name); }
  querySelector(selector: string): TestElement | null { return this.descendants().find((element) => element.classes.has(selector.slice(1))) ?? null; }
  closest(): null { return null; }
  descendants(): TestElement[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  allText(): string { return [this.text, ...this.children.map((child) => child.allText())].join("\n"); }
}
export class App {}
export const Platform = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
};
export class Plugin { settings = {}; manifest = { id: "trans-hub-plugin-localizer", name: "Trans-Hub Localizer" }; }
export class ItemView {}
export class PluginSettingTab {
  containerEl = new TestElement();
  constructor(public app: App, _plugin: unknown) {}
  display(): void {}
  getSettingDefinitions(): unknown[] { return []; }
}
export class Modal {
  contentEl = new TestElement();
  constructor(_app: App) {}
  open(): void {}
  close(): void {}
}
export const notices: string[] = [];
export class Notice { constructor(message: string, _timeout?: number) { notices.push(message); } }
export const getLanguage = (): string => "zh";
export const normalizePath = (value: string): string => value;
export const requestUrl = (): Promise<never> => Promise.reject(new Error("Network is not allowed in UI tests"));
export class TestControl {
  inputEl = new TestElement(); selectEl = new TestElement(); buttonEl = new TestElement(); toggleEl = new TestElement();
  value: string | boolean = ""; text = ""; disabled = false; kind = "";
  click: () => void | Promise<void> = () => {};
  change: (value: never) => void | Promise<void> = () => {};
  setPlaceholder(): this { return this; }
  addOptions(): this { return this; }
  setValue(value: string | boolean): this { this.value = value; return this; }
  setDisabled(value: boolean): this { this.disabled = value; return this; }
  setButtonText(value: string): this { this.text = value; return this; }
  setTooltip(): this { return this; }
  setCta(): this { return this; }
  setWarning(): this { return this; }
  setDestructive(): this { return this; }
  onClick(callback: () => void | Promise<void>): this { this.click = callback; return this; }
  onChange(callback: (value: never) => void | Promise<void>): this { this.change = callback; return this; }
}
export const renderedSettings: Setting[] = [];
export class Setting {
  settingEl: TestElement; descEl: TestElement; name = ""; controls: TestControl[] = [];
  constructor(container: TestElement) { this.settingEl = container.createDiv(); this.descEl = this.settingEl.createDiv(); renderedSettings.push(this); }
  setName(name: string): this { this.name = name; this.settingEl.createSpan({ text: name }); return this; }
  setDesc(text: string): this { this.descEl.setText(text); return this; }
  setHeading(): this { return this; }
  private control(kind: string, callback: (control: TestControl) => void): this { const control = new TestControl(); control.kind = kind; this.controls.push(control); callback(control); return this; }
  addButton(callback: (control: TestControl) => void): this { return this.control("button", callback); }
  addToggle(callback: (control: TestControl) => void): this { return this.control("toggle", callback); }
  addDropdown(callback: (control: TestControl) => void): this { return this.control("dropdown", callback); }
  addText(callback: (control: TestControl) => void): this { return this.control("text", callback); }
}
