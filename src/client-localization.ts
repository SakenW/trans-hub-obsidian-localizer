import type { TargetLocale } from "./product-config";

type MessageParameters = Readonly<Record<string, string | number>>;

const ENGLISH_MESSAGES: Readonly<Record<string, string>> = {
  "选择变化后会自动扫描并同步。": "Changes are scanned and synchronized automatically.",
  "选择插件和目标语言，语枢会在译文发布后自动应用。第三方插件文件和笔记正文不会被修改。": "Choose plugins and a target language. Trans-Hub applies published translations automatically without modifying plugin files or note content.",
  "自动翻译": "Automatic translation",
  "关闭后立即恢复被运行时替换的原文；重新开启后继续应用所选插件的已发布译文。": "Turn this off to restore runtime-replaced source text immediately. Turn it on again to apply published translations for selected plugins.",
  "翻译插件名称和说明": "Translate plugin names and descriptions",
  "默认开启。开启时显示译名和译文说明；关闭时显示官方名称和原始说明。尚无名称译文的插件会保留官方名称。": "On by default. Show translated names and descriptions when available; otherwise keep the official metadata.",
  "翻译为": "Translate to",
  "插件自带的目标语言会优先保留，语枢只补齐仍显示原文的界面。插件自身界面也使用这里选择的语言。": "A plugin's own target-language text is preserved first, and Trans-Hub fills only UI that remains in the source language. This plugin also uses the language selected here.",
  "选择插件": "Choose plugins",
  "只显示当前已启用的第三方插件。有名称译文时显示译名，尚未发布时保留官方名称。默认全选，也可以搜索后逐项多选。": "Only enabled third-party plugins are shown. Translated names are used when published; otherwise official names remain. All are selected by default, and you can search or select individually.",
  "正在读取已启用插件…": "Reading enabled plugins…",
  "语枢已连接": "Trans-Hub connected",
  "连接语枢": "Connect Trans-Hub",
  "此设备会在重启 Obsidian 后自动恢复连接；离线时继续使用已缓存的已发布译文。": "This device reconnects automatically after Obsidian restarts. Cached published translations remain available offline.",
  "将在系统浏览器中登录并授权此设备；注册目前为邀请制。插件不会接触或保存账号密码。": "Sign in and authorize this device in your browser. Registration is currently invite-only. The plugin never handles or stores your password.",
  "查看 Obsidian 本地化生态": "View Obsidian localization ecosystem",
  "清除本机连接": "Clear device connection",
  "已清除本机连接信息；服务器上的短期凭据会自动过期。": "Device connection data cleared. Short-lived server credentials will expire automatically.",
  "在浏览器中连接": "Connect in browser",
  "请在浏览器中完成登录和设备授权。": "Complete sign-in and device authorization in your browser.",
  "注册": "Register",
  "打开邀请制注册页面": "Open the invite-only registration page",
  "没有发现已启用的第三方插件。启用插件后重新打开此页面即可选择。": "No enabled third-party plugins were found. Enable a plugin and reopen this page to select it.",
  "读取插件失败：{message}": "Could not read plugins: {message}",
  "{count} 个已启用插件": "{count} enabled plugins",
  "搜索插件": "Search plugins",
  "搜索插件名称或 ID": "Search plugin name or ID",
  "全选": "Select all",
  "清空": "Clear",
  "按本地化状态筛选插件": "Filter plugins by localization status",
  "已选择 {selected} / {total}": "Selected {selected} / {total}",
  "没有匹配的插件。": "No matching plugins.",
  "重新处理": "Retry",
  "仅重新处理此插件": "Retry this plugin only",
  "报告漏译": "Report missing translation",
  "报告仍显示原文的插件界面": "Report plugin UI that still shows source text",
  "正在重新处理 {pluginId}…": "Retrying {pluginId}…",
  "处理失败：{message}": "Processing failed: {message}",
  "正在扫描所选插件…": "Scanning selected plugins…",
  "遇到问题": "Troubleshooting",
  "重新处理所选插件": "Retry selected plugins",
  "重新扫描所选插件并尝试同步译文。通常不需要手动执行。": "Rescan selected plugins and try to synchronize translations. This is normally automatic.",
  "正在重新处理所选插件…": "Retrying selected plugins…",
  "报告漏译内容": "Report missing translation",
  "请填写 {pluginName} 仍显示的原文。只会提交你确认的这一条短界面文案，不会读取或上传笔记内容、文件路径或插件文件。": "Enter source text still shown by {pluginName}. Only this short UI string is submitted; note content, file paths, and plugin files are never read or uploaded.",
  "仍显示的原文": "Source text still shown",
  "可填写扫描遗漏的短 UI 文案；链接、路径和非界面内容会被拒绝。": "Enter a short UI string missed by scanning. Links, paths, and non-UI content are rejected.",
  "例如：Settings": "Example: Settings",
  "提交报告": "Submit report",
  "请输入一条安全的短插件界面原文。": "Enter one safe, short plugin UI source string.",
  "漏译报告已提交，感谢反馈。": "Missing-translation report submitted. Thank you.",
  "提交失败：{message}": "Submission failed: {message}",
  "语枢已连接，此设备以后会自动恢复连接。": "Trans-Hub connected. This device will reconnect automatically.",
  "连接成功，正在同步所选插件…": "Connected. Synchronizing selected plugins…",
  "语枢连接失败。": "Could not connect to Trans-Hub.",
  "插件目录已变化，请先重新处理该插件。": "The plugin catalog changed. Retry this plugin first.",
  "已停止所有插件翻译。": "Translation is disabled for all plugins.",
  "已扫描 {count} 个插件；登录语枢后会继续同步。": "Scanned {count} plugins. Synchronization continues after you connect Trans-Hub.",
  "已检查 {count} 个插件；新增 {requested} 个本地化需求，{waiting} 个正在由服务器处理或等待审查。": "Checked {count} plugins; added {requested} localization requests, with {waiting} being processed or awaiting review.",
  "已更新 {count} 个插件，共 {translations} 条译文。": "Updated {count} plugins with {translations} translations.",
  "已检查 {count} 个插件，目前没有新译文。": "Checked {count} plugins. No new translations are available.",
  "全部状态": "All statuses",
  "已本地化": "Localized",
  "等待发布": "Awaiting publication",
  "未收录": "Not cataloged",
  "处理失败": "Failed",
  "已本地化 {translated}/{total} 条（{percent}%），{missing} 条等待发布": "Localized {translated}/{total} strings ({percent}%); {missing} awaiting publication",
  "已沿用 {translated}/{total} 条安全译文": "Reused {translated}/{total} safe translations",
  "已本地化 {count} 条": "Localized {count} strings",
  "处理失败：需求未被接受": "Failed: request was not accepted",
  "等待目标语言译文发布": "Awaiting target-language publication",
  "等待本地化需求处理": "Localization request is being processed",
  "等待来源收录": "Awaiting source cataloging",
  "插件自带 {count}": "Plugin native {count}",
  "语枢补充 {count}": "Trans-Hub fill {count}",
  "语枢校订 {count}": "Trans-Hub correction {count}",
  "自动翻译 {count}": "Machine translation {count}",
  "语枢已发布 {count}": "Trans-Hub published {count}",
  "源语言，无需翻译": "Source language · no translation needed",
  "服务器暂时无法查询插件处理状态，请稍后重试。": "The server cannot check plugin processing status right now. Try again later.",
  "服务器暂时无法完成请求，请稍后重试。": "The server cannot complete this request right now. Try again later.",
  "此设备的语枢授权已失效，请清除本机连接后重新连接。": "This device's Trans-Hub authorization has expired. Clear the device connection and reconnect.",
  "操作：{operation}": "Operation: {operation}",
  "操作：{operation}，HTTP {status}": "Operation: {operation}, HTTP {status}",
  "{message}（{suffix}）": "{message} ({suffix})",
  "扫描已安装插件的界面文案": "Scan installed plugin UI strings",
  "扫描插件文案": "Scan plugin strings",
  "扫描完成：{plugins} 个插件，{strings} 条文案，{changed} 个目录有变化。": "Scan complete: {plugins} plugins, {strings} strings, {changed} changed catalogs.",
  "同步已安装插件的翻译": "Synchronize installed plugin translations",
  "同步插件翻译": "Synchronize plugin translations",
  "同步完成：新增需求 {requested}，拉取 {pulled}，处理中或待审查 {waiting}。": "Synchronization complete: {requested} new requests, {pulled} pulled, {waiting} processing or awaiting review.",
  "应用已缓存的插件译文": "Apply cached plugin translations",
  "{label}失败：{message}": "{label} failed: {message}",
};

let activeLocale: TargetLocale = "zh-CN";

export function setClientLocale(locale: TargetLocale): void {
  activeLocale = locale;
}

export function clientLocale(): TargetLocale {
  return activeLocale;
}

export function localizedClientName(): string {
  return activeLocale === "zh-CN" ? "语枢 · 插件本地化" : "Trans-Hub Localizer";
}

export function translate(source: string, parameters: MessageParameters = {}): string {
  const template = activeLocale === "zh-CN" ? source : ENGLISH_MESSAGES[source] ?? source;
  return Object.entries(parameters).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
