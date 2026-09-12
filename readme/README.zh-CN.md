# Trans-Hub Localizer · 语枢插件本地化

**让 Obsidian 社区插件用你的语言呈现。**

[English](../README.md) · **简体中文** · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

[![Release](https://img.shields.io/github/v/release/SakenW/trans-hub-obsidian-localizer)](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) · **桌面与移动端** · **无需配置 AI 模型或 API Key**

Trans-Hub Localizer 是一款为 Obsidian 社区插件提供汉化、翻译与界面本地化的插件。它优先保留检测到的插件自带译文，通过共享翻译补齐缺失内容，并自动同步已发布的更新。默认在运行时应用译文，不修改插件文件，不翻译或上传你的笔记。

[在 Obsidian 中安装](obsidian://show-plugin?id=trans-hub-plugin-localizer) · [查看本地化进展](https://trans-hub.net/ecosystems/obsidian) · [反馈与社区](https://github.com/SakenW/Trans-Hub/discussions)

<!-- section: getting-started -->
## 开始使用

需要 **Obsidian 1.11.4 或更高版本**、语枢账号，以及用于授权和同步的网络连接。支持桌面与移动端；高级文件兼容补丁仅限桌面端。

1. 在 **设置 → 第三方插件** 中安装并启用 **Trans-Hub Localizer**。
2. 打开插件设置，连接语枢账号。无需配置 AI 模型、模型服务商账号或 API Key。
3. 确认译文语言。插件自动发现已启用的社区插件，你可以排除不需要本地化的插件。

已有的已发布译文直接复用；缺失内容自动提交本地化需求，在后台处理并发布后同步。等待处理、发布或兼容性检查的内容可能暂时保留原文。

手动安装时，从同一个 [GitHub Release](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`，放入 `<vault-config-dir>/plugins/trans-hub-plugin-localizer/`。不要混用不同版本的文件。

<!-- section: use-cases -->
## 适合哪些场景

- 想将社区插件的设置、命令和界面翻译成自己的语言。
- 希望复用共享译文，不自行配置 AI 模型或 API Key。
- 希望在桌面和手机上使用，并在插件更新后自动检查兼容译文。

<!-- section: capabilities -->
## 核心能力

| 能力 | 实际效果 |
| --- | --- |
| 原生译文优先 | 保留检测到的当前插件自带翻译，补齐缺失文案。只有明确经过审核的修正译文，才可替换对应的原生文案。 |
| 共享翻译 | 不同用户复用已发布成果，缺失内容进入共享本地化流程。 |
| 自动同步 | 启动时先恢复已验证的缓存译文，运行期间继续检查更新。取得新译文需要网络连接。 |
| 更新后兼容复用 | 逐条通过兼容检查的运行时译文可以跨插件版本使用；有歧义或不兼容的内容会被跳过。 |
| 界面覆盖 | 支持可安全识别的名称、说明、设置、按钮、命令、通知、选项、工具提示、输入提示、无障碍标签及部分动态文案。 |
| 插件 README 文本 | 有匹配的已发布 README 译文时，可本地化社区插件详情页中受支持的文本；README 与核心界面覆盖分开计算。 |

运行时根据适用条件检查来源身份、作用域、语义角色、格式和动态占位符，不承诺每个插件的所有界面都能完整翻译。

<!-- section: languages -->
## 全语言支持，不限于预设选项

常用语言可快捷选择，其他语言可通过语言标识输入，并保留地区与文字变体。具体译文是否可用，取决于对应内容的处理与发布状态。

快捷选择包括 **简体中文、繁体中文、英语、日语、韩语、德语、法语、西班牙语、巴西葡萄牙语、俄语**。其他语言例如意大利语（`it`）、阿拉伯语（`ar`）、乌克兰语（`uk`）和塞尔维亚语拉丁字母变体（`sr-Latn`）。具体译文的可用性与质量，取决于已发布成果及该语言可用的处理服务。

这里指 **其他插件的译文语言**。语枢自身设置界面目前提供简体中文和英语，其他语言回退英语。页面顶部的语言链接仅切换本 README 的阅读语言。

<!-- section: quality -->
## 翻译质量与支持范围

本插件面向社区插件界面，不提供笔记翻译、网页翻译或设备端实时 LLM 翻译。

当前多数语枢译文由机器生成，未经人工校对。插件会区分译文来源和审核状态。来源与兼容性验证通过，不代表译文准确性已经经过人工审核。

本流程面向能通过 Obsidian 官方社区目录及可信上游来源验证身份和版本的社区插件。通过 BRAT 安装、私有插件或任意本地修改，并不自动获得兼容保证。当前来源语言流程使用英语。

笔记的 Markdown 编辑器、阅读视图、代码、脚本和可编辑内容均被排除。README 本地化仅限社区插件详情页，不会开启笔记翻译。

<!-- section: privacy -->
## 隐私与可选文件补丁

- 本机扫描用于识别插件版本及受支持的界面文案，不上传扫描到的界面文本或笔记。
- 请求包含插件身份、版本、目标语言、覆盖计数和加密摘要。账号授权与译文下载需要网络访问。
- 凭据使用 Obsidian 安全存储；服务端处理方式见[隐私政策](https://trans-hub.net/zh-CN/legal/privacy)。
- 默认运行时本地化不改写插件文件。关闭时恢复仍保持译文值的运行时文本，保留其他插件随后主动作出的修改。

**高级兼容模式仅限桌面端，默认关闭。** 必须对每个符合条件的插件主动应用补丁。补丁只修改与精确版本及制品绑定、经过验证的静态界面文案，并先保存备份和回执。只有文件仍符合补丁后摘要时才会恢复；插件升级或外部修改会被保留并报告为冲突。应用或恢复补丁后，需要重新加载目标插件。补丁绝不修改笔记。

<!-- section: faq -->
## 常见问题

**需要 API Key 吗？** 不需要。连接语枢账号即可，无需配置模型或 API Key。

**手机可以用吗？** 可以，运行时本地化支持移动端与桌面端。文件兼容补丁仅在桌面端提供。

**为什么有些文字仍未翻译？** 可能还在等待译文、来源无法验证，或无法安全识别界面。请查看插件状态；尚无已发布译文不代表不支持该语言。

**插件已经自带中文怎么办？** 优先保留检测到的原生译文，共享翻译补齐缺失部分；已审核修正是单独、明确的例外。

**插件更新后怎么办？** 重新检查兼容性，可复用的运行时条目继续生效，不兼容条目等待新版译文。文件补丁仍要求精确匹配。

**可以离线使用吗？** 可以复用此前已缓存、已验证的译文。账号授权、缺失内容处理和新译文下载需要网络连接。

<!-- section: contribute -->
## 参与贡献与获取帮助

欢迎参与[翻译、校对和术语维护](https://trans-hub.net/ecosystems/obsidian)。可复现问题请提交到 [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues)，使用问题与建议可在 [Discussions](https://github.com/SakenW/Trans-Hub/discussions) 讨论。

本简体中文 README 是所有语言版本的内容母版，英文是 GitHub 默认入口。译本同步规则见[贡献说明](../CONTRIBUTING.md)。

<!-- section: build -->
## 构建与许可证

使用 Node.js 24 和 pnpm 10.34.4：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm verify:public-copy
pnpm build
```

Release 标签须与 `manifest.json`、`package.json`、`versions.json` 一致。`1.0.0` 以下版本属于公开测试版。采用 [Apache-2.0](../LICENSE) 许可证。
