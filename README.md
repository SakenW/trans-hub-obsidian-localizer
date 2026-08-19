# Trans-Hub Localizer

Runtime **i18n** and localization for Obsidian community plugins—make eligible plugins feel native in your language without modifying their files.

<p align="center">
  <b>English</b> · <b>简体中文见下方</b>
</p>

Trans-Hub Localizer applies verified translations to supported community-plugin names, descriptions, settings, commands, and interface text. It changes only Obsidian's presentation layer: third-party plugin files and vault notes remain untouched.

Powered by [Trans-Hub](https://trans-hub.net), an open localization collaboration platform.

## Why Trans-Hub Localizer

### Built for the whole community-plugin ecosystem

This is not a translation pack for a fixed shortlist of plugins. The client discovers your enabled community plugins locally and can process every plugin whose exact version can be bound to the official Obsidian directory and a trusted upstream GitHub source. New eligible plugins follow the same workflow; no per-plugin source-code patch or custom fork is required.

### Server-authoritative, version-aware translations

The client contributes only the plugin identity, exact version, selected language, coverage facts, and cryptographic digests. Trans-Hub independently verifies the official registry, upstream release, and source evidence on the server. Only a published translation export for that exact source version can be applied, which prevents stale caches or locally altered bundles from being treated as authoritative.

### Safe runtime i18n, not file rewriting

Translations are matched and applied at runtime to Obsidian's presentation layer. The plugin never edits third-party plugin files, bundled JavaScript, language packs, or vault notes. It also excludes Markdown editors, reading views, code, scripts, and editable content; turning localization off restores the original presentation immediately.

## What it does

- Select one, multiple, or all enabled community plugins.
- Choose a display language; source-language detection is automatic.
- Apply published translations to plugin metadata, settings, commands, interface text, and supported plugin detail pages.
- Restore original text immediately by disabling localization.
- Keep plugin files and vault notes unchanged.

Runtime localization uses exact, version-aware matches. Markdown editors, reading views, code, scripts, and editable content are excluded.

## Translation quality and contribution

Most Trans-Hub translations are currently machine-generated and are clearly labeled as not human reviewed. If you know a plugin or language well, you can help translate, proofread, and review its localization. Your contribution makes the text more accurate and keeps it maintainable as plugins evolve.

[View Obsidian localization progress and contribute](https://trans-hub.net/ecosystems/obsidian)

## Install

Install **Trans-Hub Localizer** from **Settings → Community plugins** in Obsidian.

For a manual installation, download `main.js`, `manifest.json`, and `styles.css` from the [matching GitHub Release](https://github.com/SakenW/trans-hub-obsidian-localizer/releases), then place all three files in:

```text
<vault-config-dir>/plugins/trans-hub-plugin-localizer/
```

Enable the plugin, connect your Trans-Hub account in the browser, choose your display language, and select the plugins you want to localize.

> Install only assets whose GitHub Release tag exactly matches the version shown in `manifest.json`. Do not combine files from different versions.

## Privacy and security

- The plugin scans selected community plugins locally to identify their exact version and translation coverage.
- Trans-Hub receives plugin identity, version, selected language, catalog counts, and cryptographic digests—not scanned interface text or vault notes.
- Trans-Hub verifies official Obsidian registry and GitHub release sources before translations are published.
- Account authorization happens in your browser; device authorization data uses Obsidian secure storage.
- The plugin contains no advertising or client-side telemetry.

See the [Trans-Hub privacy policy](https://trans-hub.net/zh-CN/legal/privacy) for server-side data handling.

## Support and feedback

- Ask questions, share feedback, or follow announcements in [Trans-Hub Discussions](https://github.com/SakenW/Trans-Hub/discussions).
- Report reproducible defects in this repository's [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues).

## Build from source

Requirements: Node.js 24 and pnpm 10.34.4.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

## Release integrity

Release tags use plain `x.y.z` semantic versions and match `manifest.json`, `package.json`, and `versions.json`. Every release is rebuilt from its immutable tag, tested, and accompanied by GitHub artifact attestations for the three files Obsidian downloads.

Versions below `1.0.0` are public testing releases. Trans-Hub will publish `1.0.0` only after community-directory testing, upgrade compatibility, and the human-review workflow have proven stable. Internal server, adapter, and database revisions do not change the plugin's public version.

## License

Apache-2.0. See [LICENSE](LICENSE).

---

# 语枢 · 插件本地化

面向 Obsidian 社区插件的运行时 **I18n** 与本地化：让符合条件的插件以你选择的语言自然显示，同时不修改插件文件。

语枢 · 插件本地化会为已支持的社区插件应用经校验的译文，覆盖名称、说明、设置、命令和界面文本。它只作用于 Obsidian 的呈现层，不会修改第三方插件文件或你的库（Vault）笔记。

由开放本地化协作平台 [语枢（Trans-Hub）](https://trans-hub.net) 驱动。

## 为什么选择语枢 · 插件本地化

### 面向整个社区插件生态

它不是只为一小批固定插件准备的翻译包。客户端会在本机发现已启用的社区插件；凡是当前精确版本能够绑定到 Obsidian 官方目录和可信上游 GitHub 来源的插件，都能进入同一套本地化流程。新增符合条件的插件无需逐个改源码、维护补丁或分叉仓库。

### 服务端权威、版本精确

客户端只提交插件身份、精确版本、所选语言、覆盖事实和加密摘要。语枢服务端会独立校验官方目录、上游 Release 与来源证据。只有与该精确来源版本对应的已发布译文制品才能被应用，避免把旧缓存或本地被修改过的插件包误当成权威内容。

### 安全的运行时 I18n，而不是改写文件

译文只在 Obsidian 呈现层按精确匹配运行时应用。插件不会改写第三方插件文件、打包 JavaScript、语言包或 Vault 笔记；Markdown 编辑器、阅读视图、代码、脚本和可编辑内容也会被排除。关闭本地化即可立即恢复原始呈现。

## 能做什么

- 选择一个、多个或全部已启用的社区插件。
- 选择显示语言；源语言由客户端自动识别。
- 将已发布译文应用于插件元数据、设置、命令、界面文本和已支持的插件详情页。
- 关闭本地化即可立即恢复原始文本。
- 始终保持插件文件和 Vault 笔记不变。

运行时本地化采用精确且与版本绑定的匹配；Markdown 编辑器、阅读视图、代码、脚本及可编辑内容均被排除在外。

## 翻译质量与贡献

当前多数语枢译文由机器翻译生成，并会明确标注未经人工校对。如果你熟悉某个插件或语言，欢迎参与翻译、校对和审查；这能让译文更准确，也能随插件版本持续维护。

[查看 Obsidian 本地化进展并参与贡献](https://trans-hub.net/ecosystems/obsidian)

## 安装

可直接在 Obsidian 的 **设置 → 第三方插件** 中安装 **Trans-Hub Localizer**。

如需手动安装，请从与版本号一致的 [GitHub Release](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`，并将三者放入：

```text
<vault-config-dir>/plugins/trans-hub-plugin-localizer/
```

启用插件后，在浏览器中连接语枢账号，选择显示语言，再选择要本地化的插件即可。

> 仅安装 GitHub Release tag 与 `manifest.json` 版本完全一致的制品；不要混用不同版本的文件。

## 隐私与安全

- 插件仅在本机扫描你选择的社区插件，以识别其准确版本和译文覆盖情况。
- 语枢只接收插件身份、版本、所选语言、目录计数和加密摘要；不会上传扫描到的界面文本或 Vault 笔记。
- 译文发布前，语枢会校验 Obsidian 官方目录及 GitHub Release 来源。
- 账号授权在浏览器中完成；设备授权数据由 Obsidian 安全存储保护。
- 插件不包含广告或客户端遥测。

服务端数据处理请参阅[语枢隐私政策](https://trans-hub.net/zh-CN/legal/privacy)。

## 支持与反馈

- 在 [语枢 Discussions](https://github.com/SakenW/Trans-Hub/discussions) 提问、提出反馈或关注公告。
- 可复现的问题请提交到本仓库的 [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues)。

## 从源码构建

环境要求：Node.js 24、pnpm 10.34.4。

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

## 发布完整性

Release 标签使用纯 `x.y.z` 语义化版本，并与 `manifest.json`、`package.json`、`versions.json` 保持一致。每个版本均从不可变标签重新构建、经测试，并附带 Obsidian 下载的三个文件对应的 GitHub 制品证明。

`1.0.0` 以下版本均为公开测试版。只有在社区目录测试、升级兼容性和人工审核流程稳定后，语枢才会发布 `1.0.0`；服务端、适配器和数据库内部迭代不会单独推动插件公开版本递增。

## 许可证

Apache-2.0，详见 [LICENSE](LICENSE)。
