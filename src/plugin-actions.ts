import { Notice, type Plugin } from "obsidian";

import { errorMessage } from "./error-message";
import { translate } from "./client-localization";
import type { PluginScanResult } from "./plugin-automation";
import type { PluginSyncSummary } from "./plugin-sync";

export function registerPluginTranslationCommands(host: Plugin, actions: {
  readonly scan: () => Promise<PluginScanResult>;
  readonly synchronize: () => Promise<PluginSyncSummary>;
  readonly apply: () => void;
  readonly reportStatus?: (message: string, failed: boolean) => void;
}): void {
  host.addCommand({
    id: "scan-installed-plugin-ui",
    name: translate("扫描已安装插件的界面文案"),
    callback: () => { void run(translate("扫描插件文案"), async () => {
      const result = await actions.scan();
      const message = translate("扫描完成：{plugins} 个插件，{strings} 条文案，{changed} 个目录有变化。", {
        plugins: result.scannedCount,
        strings: result.stringCount,
        changed: result.changedCount,
      });
      new Notice(message);
      actions.reportStatus?.(message, false);
    }, actions.reportStatus); },
  });
  host.addCommand({
    id: "sync-installed-plugin-translations",
    name: translate("同步已安装插件的翻译"),
    callback: () => { void run(translate("同步插件翻译"), async () => {
      const result = await actions.synchronize();
      const message = translate("同步完成：新增需求 {requested}，拉取 {pulled}，处理中或待审查 {waiting}。", {
        requested: result.requestedCount,
        pulled: result.pulledCount,
        waiting: result.waitingCount,
      });
      new Notice(message);
      actions.reportStatus?.(message, false);
    }, actions.reportStatus); },
  });
  host.addCommand({
    id: "apply-cached-plugin-translations",
    name: translate("应用已缓存的插件译文"),
    callback: () => { actions.apply(); },
  });
}

async function run(
  label: string,
  action: () => Promise<void>,
  reportStatus?: (message: string, failed: boolean) => void,
): Promise<void> {
  try { await action(); }
  catch (error) {
    console.error(`[Trans-Hub] ${label} failed`, error);
    const message = translate("{label}失败：{message}", { label, message: errorMessage(error) });
    new Notice(message, 10_000);
    reportStatus?.(message, true);
  }
}
