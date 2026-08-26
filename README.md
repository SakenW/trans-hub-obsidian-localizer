# 语枢 · 插件本地化

<p align="center">
  <b>简体中文</b> · <a href="#trans-hub-localizer">English</a>
</p>

**Trans-Hub Localizer 是一款 Obsidian 插件，为其他社区插件提供 i18n 与界面本地化，覆盖名称、设置、命令和界面文字。已有译文直接使用，缺失内容按需进入共享本地化流程。**

语枢会在服务端准备译文，并按插件、精确版本和语言发布可复用的译文制品。对应译文已经发布时，Trans-Hub Localizer 会直接下载并应用。后来的用户使用相同插件版本和语言时，也能复用这份译文，无需再次调用模型。

用户无需配置 AI 模型、翻译服务或 API Key。暂缺的插件、版本或语言会根据真实使用需求进入共享处理流程，完成并发布后由客户端同步。

由开放本地化协作平台 [语枢（Trans-Hub）](https://trans-hub.net) 驱动。

## 它适合哪些需求

- 想让 Obsidian 社区插件的名称、说明、设置、命令和界面文字使用自己选择的语言。
- 想直接使用已经准备好的译文，不想为每个插件配置模型或 API Key。
- 希望译文与插件精确版本对应，插件升级后继续获得可追踪的更新。
- 希望分清插件自带语言、语枢机翻和经过人工校对的译文。

Trans-Hub Localizer 处理插件界面本地化，不翻译笔记、选中文本或 Markdown 内容。

## 如何工作

1. 客户端在本机识别你选择的已启用社区插件、精确版本和已有语言。
2. 对应版本和语言已有已发布译文时，客户端直接下载并应用，缓存后的已发布译文可以离线继续使用。
3. 对应译文暂缺时，客户端只提交插件身份、版本、所选语言、覆盖事实和加密摘要。语枢校验官方目录与可信上游来源后，将缺失内容放入共享本地化流程。

缺失内容需要等待服务端完成翻译、检查和发布。客户端不会承诺每个新版本都能当场完成。

## 为什么选择语枢 · 插件本地化

### 已发布译文可以复用

常见的即时 AI 翻译需要每位用户自行准备模型或翻译接口，再为眼前的插件生成一次结果。语枢把完成的译文按版本发布。已有译文下载后即可使用，同版本、同语言的后续用户无需重复生成。

### 面向整个社区插件范围

覆盖范围由可验证来源决定。凡是当前精确版本能够绑定到 Obsidian 官方目录和可信上游 GitHub 来源的社区插件，都可以进入同一套本地化流程，无需为每个插件单独维护源码分支或翻译补丁。

能够进入流程表示该插件可被识别、校验和处理。能够立即应用还要求对应版本和语言已有已发布译文。

### 服务端权威、版本精确

语枢会独立校验 Obsidian 官方目录、上游 Release 与来源证据。客户端只会应用与当前精确来源版本对应的已发布译文，避免把旧缓存或本地修改过的插件包当作当前版本。

### 翻译来源清楚

客户端会区分插件自带语言、语枢机翻和人工校对结果。当前多数语枢译文由机器翻译生成，并会明确标注未经人工校对。熟悉相关插件或语言的用户可以参与翻译、校对和审查。

[查看 Obsidian 本地化进展并参与贡献](https://trans-hub.net/ecosystems/obsidian)

## 与即时 AI 翻译工具的区别

不同工具的具体功能会有差异。下面比较两种常见使用方式。

| 使用方式 | Trans-Hub Localizer | 常见即时 AI 翻译工具 |
| --- | --- | --- |
| 译文准备 | 服务端提前处理并按精确版本发布 | 用户发起请求后由模型生成 |
| 模型与接口 | 用户无需配置模型或 API Key | 通常需要用户配置模型、接口或密钥 |
| 已有译文 | 下载并直接应用 | 按工具规则重新生成或读取个人缓存 |
| 后续复用 | 同版本、同语言的用户共享已发布译文 | 通常以当前用户或当前设备为范围 |
| 缺失内容 | 按真实需求进入共享流程，发布后同步 | 可以立即请求模型生成，质量取决于模型和配置 |
| 更适合 | 长期使用多个插件，希望版本稳定、来源清楚 | 临时翻译、个人定制或需要立即生成结果 |

## 安全的运行时 I18n，而不是改写文件

默认模式使用运行时 **I18n** 与本地化。译文只应用到 Obsidian 的呈现层，不修改第三方插件文件或你的库（Vault）笔记。Markdown 编辑器、阅读视图、代码、脚本和可编辑内容均被排除。关闭本地化会立即恢复运行时显示的原文。

少数插件会把设置页渲染在运行时无法覆盖的位置。用户可以为单个符合条件的插件显式启用高级兼容模式。该模式默认关闭，只写入已经发布、与当前版本完全匹配且位置可确认的静态界面文字，并先保存可恢复备份。动态文字、带变量的模板、不匹配版本和无法确认位置的内容不会被修改。

高级兼容模式不会修改 Vault 笔记。插件文件在补丁后被其他程序改动时，语枢也不会自动覆盖该文件。

## 当前平台

当前公开版本支持 Obsidian 桌面端。移动端支持已经规划，正式发布前请以 [Obsidian 社区插件页](https://community.obsidian.md/plugins/trans-hub-plugin-localizer) 显示的平台信息为准。

## 常见问题

### 只能处理说明里列出的插件吗

没有固定插件名单。能够绑定 Obsidian 官方目录和可信上游版本的社区插件都可以进入同一流程。某个版本能否立即使用，取决于对应语言的译文是否已经发布。

### 用户需要提供 AI 模型或 API Key 吗

不需要。模型调用和译文处理在语枢服务端完成。已有译文由客户端下载并直接应用。

### 新安装的插件没有译文怎么办

符合来源条件的插件会按真实使用需求提交缺失状态。服务端完成处理并发布后，客户端会同步对应版本的译文。

### 会翻译笔记内容吗

不会。它处理社区插件的名称、说明、设置、命令和已支持的界面文字，不处理笔记正文、Markdown、代码或脚本。

### 会修改第三方插件文件吗

默认运行时模式不会修改文件。只有用户显式启用高级兼容模式，并对单个符合条件的插件使用兼容补丁时，才会修改经过验证的静态界面文字并保存备份。

### 机器翻译经过人工校对了吗

机器翻译和人工校对结果会分别标示。当前多数译文为机器翻译，不能自动视为已经人工校对。

## 安装

可直接在 Obsidian 的 **设置 → 第三方插件** 中安装 **Trans-Hub Localizer**。

如需手动安装，请从与版本号一致的 [GitHub Release](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`，并将三者放入下面的目录。

```text
<vault-config-dir>/plugins/trans-hub-plugin-localizer/
```

启用插件后，在浏览器中连接语枢账号，选择显示语言，再选择要本地化的插件即可。

> 仅安装 GitHub Release tag 与 `manifest.json` 版本完全一致的制品。不要混用不同版本的文件。

## 隐私与安全

- 插件仅在本机扫描你选择的社区插件，以识别准确版本和译文覆盖情况。
- 语枢只接收插件身份、版本、所选语言、目录计数和加密摘要，不会上传扫描到的界面文字或 Vault 笔记。
- 译文发布前，语枢会校验 Obsidian 官方目录及 GitHub Release 来源。
- 账号授权在浏览器中完成，设备授权数据由 Obsidian 安全存储保护。
- 插件不包含广告或客户端遥测。

服务端数据处理请参阅[语枢隐私政策](https://trans-hub.net/zh-CN/legal/privacy)。

## 支持与反馈

问题、建议和可复现的缺陷可以提交到本仓库的 [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues)。

## 从源码构建

需要 Node.js 24 和 pnpm 10.34.4。

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

## 发布完整性

Release 标签使用纯 `x.y.z` 语义化版本，并与 `manifest.json`、`package.json`、`versions.json` 保持一致。每个版本均从不可变标签重新构建、经测试，并附带 Obsidian 下载的三个文件对应的 GitHub 制品证明。

`1.0.0` 以下版本均为公开测试版。语枢会在社区目录测试、升级兼容性和人工审核流程稳定后发布 `1.0.0`。服务端、适配器和数据库内部迭代不会单独推动插件公开版本递增。

## 许可证

Apache-2.0，详见 [LICENSE](LICENSE)。

---

# Trans-Hub Localizer

<p align="center">
  <b>English</b> · <b>简体中文见上方</b>
</p>

**Trans-Hub Localizer is an Obsidian plugin for i18n and interface localization across community plugins, covering names, settings, commands, and UI text. Use published translations immediately; missing content enters a shared workflow on demand.**

Trans-Hub prepares translations on the server and publishes reusable artifacts for an exact plugin version and language. When a matching translation is available, Trans-Hub Localizer downloads and applies it directly. Later users with the same plugin version and language can reuse that translation without invoking another model.

Users do not configure an AI model, translation provider, or API key. Missing plugins, versions, and languages enter the shared workflow through real usage demand. The client synchronizes them after processing and publication are complete.

Powered by [Trans-Hub](https://trans-hub.net), an open localization collaboration platform.

## Who it is for

- People who want Obsidian community-plugin names, descriptions, settings, commands, and interface text in their chosen language.
- People who want ready-to-use translations without configuring a model or API key for every plugin.
- People who want translations tied to an exact plugin version and updated as plugins change.
- People who want clear labels for upstream-native, machine-translated, and human-reviewed text.

Trans-Hub Localizer localizes plugin interfaces. It does not translate notes, selected text, or Markdown content.

## How it works

1. The client identifies selected and enabled community plugins, their exact versions, and existing languages locally.
2. When a published translation exists for that version and language, the client downloads and applies it directly. Cached published translations remain available offline.
3. When a translation is missing, the client sends only the plugin identity, version, selected language, coverage facts, and cryptographic digests. Trans-Hub verifies the official registry and trusted upstream source before adding the missing content to the shared localization workflow.

Missing content must wait for server-side translation, checks, and publication. The client does not promise immediate completion for every new plugin version.

## Why Trans-Hub Localizer

### Reusable published translations

Common instant AI translators ask each user to provide a model or translation endpoint and generate a result for the plugin in front of them. Trans-Hub publishes completed translations by version. Available translations can be downloaded and used directly, and later users with the same version and language do not need to generate them again.

### Built for the whole community-plugin ecosystem

Eligibility follows verifiable sources. Every community plugin whose exact version can be bound to the official Obsidian directory and a trusted upstream GitHub source can enter the same localization workflow. It does not need a dedicated source-code fork or translation patch for each plugin.

Workflow eligibility means that a plugin can be identified, verified, and processed. Immediate availability also requires a published translation for the exact version and language.

### Server-authoritative, version-aware translations

Trans-Hub independently verifies the official Obsidian registry, upstream release, and source evidence. The client applies only a published translation for the exact current source version, preventing a stale cache or locally changed package from being treated as current.

### Clear translation provenance

The client distinguishes upstream-native language support, Trans-Hub machine translation, and human-reviewed results. Most Trans-Hub translations are currently machine-generated and clearly labeled as not human reviewed. People familiar with a plugin or language can help translate, proofread, and review its localization.

[View Obsidian localization progress and contribute](https://trans-hub.net/ecosystems/obsidian)

## How it differs from instant AI translation tools

Exact features vary by tool. This table compares two common ways to localize a plugin interface.

| Usage | Trans-Hub Localizer | Common instant AI translation tools |
| --- | --- | --- |
| Translation preparation | Processed on the server and published for an exact version | Generated after the user sends a request |
| Model and endpoint | No user-configured model or API key | Usually requires a user-configured model, endpoint, or key |
| Available translation | Downloaded and applied directly | Regenerated or loaded from a personal cache according to the tool |
| Later reuse | Shared by users with the same version and language | Usually limited to the current user or device |
| Missing content | Enters the shared workflow and synchronizes after publication | Can request immediate generation, with quality depending on the model and configuration |
| Best fit | Ongoing localization across several plugins with version and source checks | Temporary translation, personal wording, or immediate generation |

## Safe runtime i18n, not file rewriting

The default mode uses Runtime **i18n** and localization. Translations apply only to Obsidian's presentation layer and do not modify third-party plugin files or vault notes. Markdown editors, reading views, code, scripts, and editable content are excluded. Turning localization off immediately restores the text changed at runtime.

A few plugins render settings in places runtime localization cannot reach. A user can explicitly enable Advanced Compatibility for one eligible plugin. This mode is off by default. It writes only published static interface text whose exact version and location are verified, after saving a recoverable backup. It does not modify dynamic text, templates with variables, mismatched versions, or content whose location cannot be verified.

Advanced Compatibility never modifies vault notes. If another program changes the plugin file after patching, Trans-Hub will not overwrite that file automatically.

## Current platforms

The current public release supports Obsidian Desktop. Mobile support is planned. Until it ships, use the platform information on the [Obsidian community page](https://community.obsidian.md/plugins/trans-hub-plugin-localizer) as the current authority.

## Frequently asked questions

### Does it work only with plugins listed in the description

There is no fixed plugin list. Every community plugin that can be bound to the official Obsidian directory and a trusted upstream version can enter the same workflow. Immediate availability depends on whether a translation has been published for the exact version and language.

### Do users need an AI model or API key

No. Model calls and translation processing run on the Trans-Hub server. The client downloads and applies available translations directly.

### What happens when a newly installed plugin has no translation

Eligible plugins contribute their missing status through real usage demand. After server processing and publication, the client synchronizes the translation for the matching version.

### Does it translate note content

No. It handles community-plugin names, descriptions, settings, commands, and supported interface text. It does not process note bodies, Markdown, code, or scripts.

### Does it modify third-party plugin files

The default runtime mode does not modify files. A file changes only when a user explicitly enables Advanced Compatibility and applies a compatibility patch to one eligible plugin. The patch writes verified static interface text and saves a backup first.

### Are machine translations human reviewed

Machine-translated and human-reviewed results have separate labels. Most translations are currently machine-generated and should not be treated as human reviewed.

## Install

Install **Trans-Hub Localizer** from **Settings → Community plugins** in Obsidian.

For manual installation, download `main.js`, `manifest.json`, and `styles.css` from the [matching GitHub Release](https://github.com/SakenW/trans-hub-obsidian-localizer/releases), then place all three files in the directory below.

```text
<vault-config-dir>/plugins/trans-hub-plugin-localizer/
```

Enable the plugin, connect your Trans-Hub account in the browser, choose a display language, and select the plugins you want to localize.

> Install only assets whose GitHub Release tag exactly matches the version in `manifest.json`. Do not combine files from different versions.

## Privacy and security

- The plugin scans selected community plugins locally to identify their exact versions and translation coverage.
- Trans-Hub receives plugin identity, version, selected language, catalog counts, and cryptographic digests. It does not receive scanned interface text or vault notes.
- Trans-Hub verifies official Obsidian registry and GitHub release sources before translations are published.
- Account authorization happens in the browser, and Obsidian secure storage protects device authorization data.
- The plugin contains no advertising or client-side telemetry.

See the [Trans-Hub privacy policy](https://trans-hub.net/zh-CN/legal/privacy) for server-side data handling.

## Support and feedback

Questions, suggestions, and reproducible defects can be submitted through this repository's [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues).

## Build from source

Requires Node.js 24 and pnpm 10.34.4.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

## Release integrity

Release tags use plain `x.y.z` semantic versions and match `manifest.json`, `package.json`, and `versions.json`. Every release is rebuilt from its immutable tag, tested, and accompanied by GitHub artifact attestations for the three files Obsidian downloads.

Versions below `1.0.0` are public testing releases. Trans-Hub will publish `1.0.0` after community-directory testing, upgrade compatibility, and the human-review workflow have proven stable. Internal server, adapter, and database revisions do not change the plugin's public version.

## License

Apache-2.0. See [LICENSE](LICENSE).
