# Trans-Hub Localizer / 语枢 · 插件本地化

Make Obsidian community plugins feel native in your language.

让 Obsidian 社区插件以你选择的语言自然显示。

Trans-Hub Localizer applies verified translations to supported community-plugin names, descriptions, settings, commands, and interface text. It changes only Obsidian's presentation layer: third-party plugin files and vault notes remain untouched.

语枢 · 插件本地化会为已支持的社区插件应用经校验的译文，覆盖名称、说明、设置、命令和界面文本。它只作用于 Obsidian 的呈现层，不会修改第三方插件文件或你的库（Vault）笔记。

Powered by [Trans-Hub](https://trans-hub.net), an open localization collaboration platform. / 由开放本地化协作平台 [语枢（Trans-Hub）](https://trans-hub.net) 驱动。

## What it does / 功能

- Select one, multiple, or all enabled community plugins. / 选择一个、多个或全部已启用的社区插件。
- Choose your display language; source-language detection is automatic. / 选择显示语言；源语言由客户端自动识别。
- Apply published translations to plugin metadata, settings, commands, interface text, and supported plugin detail pages. / 将已发布译文应用于插件元数据、设置、命令、界面文本和已支持的插件详情页。
- Restore original text immediately by disabling localization. / 关闭本地化即可立即恢复原始文本。
- Keep plugin files and vault notes unchanged. / 始终保持插件文件和库笔记不变。

Runtime localization uses exact, version-aware matches. Markdown editors, reading views, code, scripts, and editable content are excluded.

运行时本地化采用精确且与版本绑定的匹配；Markdown 编辑器、阅读视图、代码、脚本及可编辑内容均被排除在外。

## Translation quality and contribution / 翻译质量与贡献

Most Trans-Hub translations are currently machine-generated and are clearly labeled as not human reviewed. If you know a plugin or language well, you can help translate, proofread, and review its localization. Your contribution makes the text more accurate and keeps it maintainable as plugins evolve.

[View Obsidian localization progress and contribute](https://trans-hub.net/ecosystems/obsidian)

当前多数语枢译文由机器翻译生成，并会明确标注未经人工校对。欢迎参与翻译、校对和审查，让插件本地化更准确，也能随版本持续维护。

## Install / 安装

Install **Trans-Hub Localizer** from **Settings → Community plugins** in Obsidian.

可直接在 Obsidian 的 **设置 → 第三方插件** 中安装 **Trans-Hub Localizer**。

For a manual installation, download `main.js`, `manifest.json`, and `styles.css` from the [matching GitHub Release](https://github.com/SakenW/trans-hub-obsidian-localizer/releases). Place all three files in:

如需手动安装，请从与版本号一致的 [GitHub Release](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`，并将三者放入：

```text
<vault-config-dir>/plugins/trans-hub-plugin-localizer/
```

Enable the plugin, connect your Trans-Hub account in the browser, choose your display language, and select the plugins you want to localize.

启用插件后，在浏览器中连接语枢账号，选择显示语言，再选择要本地化的插件即可。

## Privacy and security / 隐私与安全

- The plugin scans selected community plugins locally to identify their exact version and translation coverage. / 插件仅在本机扫描你选择的社区插件，以识别其准确版本和译文覆盖情况。
- Trans-Hub receives plugin identity, version, selected language, catalog counts, and cryptographic digests—not scanned interface text or vault notes. / 语枢仅接收插件身份、版本、所选语言、目录计数和加密摘要；不会上传扫描到的界面文本或库笔记。
- A missing-translation report sends source text only when you explicitly submit that report. / 只有在你明确提交缺失译文反馈时，相关源文本才会被发送。
- Trans-Hub verifies official Obsidian registry and GitHub release sources before translations are published. / 译文发布前，语枢会校验 Obsidian 官方目录及 GitHub Release 来源。
- Account authorization happens in your browser; device authorization data uses Obsidian secure storage. / 账号授权在浏览器中完成；设备授权数据由 Obsidian 安全存储保护。
- The plugin contains no advertising or client-side telemetry. / 插件不包含广告或客户端遥测。

See the [Trans-Hub privacy policy](https://trans-hub.net/zh-CN/legal/privacy) for server-side data handling. / 服务端数据处理请参阅[语枢隐私政策](https://trans-hub.net/zh-CN/legal/privacy)。

## Support and feedback / 支持与反馈

- Ask questions, share feedback, or follow announcements in [Trans-Hub Discussions](https://github.com/SakenW/Trans-Hub/discussions).
- Report reproducible defects in this repository's [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues).

- 在 [语枢 Discussions](https://github.com/SakenW/Trans-Hub/discussions) 提问、提出反馈或关注公告。
- 可复现的问题请提交到本仓库的 [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues)。

## Build from source / 从源码构建

Requirements: Node.js 24 and pnpm 10.34.4. / 环境要求：Node.js 24、pnpm 10.34.4。

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

## Release integrity / 发布完整性

Release tags use plain `x.y.z` semantic versions and match `manifest.json`, `package.json`, and `versions.json`. Every release is rebuilt from its immutable tag, tested, and accompanied by GitHub artifact attestations for the three files Obsidian downloads.

Release 标签使用纯 `x.y.z` 语义化版本，并与 `manifest.json`、`package.json`、`versions.json` 保持一致。每个版本均从不可变标签重新构建、经测试，并附带 Obsidian 下载的三个文件对应的 GitHub 制品证明。

Versions below `1.0.0` are public testing releases. Trans-Hub will publish `1.0.0` only after community-directory testing, upgrade compatibility, and the human-review workflow have proven stable. Internal server, adapter, and database revisions do not change the plugin's public version.

`1.0.0` 以下版本均为公开测试版。只有在社区目录测试、升级兼容性和人工审核流程稳定后，语枢才会发布 `1.0.0`；服务端、适配器和数据库内部迭代不会改变插件的公开版本号。

## License / 许可证

Apache-2.0. See [LICENSE](LICENSE). / Apache-2.0，详见 [LICENSE](LICENSE)。
