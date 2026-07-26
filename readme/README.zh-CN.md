# 语枢 · 插件本地化

让已支持的 Obsidian 社区插件以你选择的语言自然显示。

<p align="center">
  <a href="../README.md">English</a> · <b>简体中文</b>
</p>

语枢 · 插件本地化会为已支持的社区插件应用经校验的译文，覆盖名称、说明、设置、命令和界面文本。它只作用于 Obsidian 的呈现层，不会修改第三方插件文件或你的库（Vault）笔记。

由开放本地化协作平台 [语枢（Trans-Hub）](https://trans-hub.net) 驱动。

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
- 只有在你明确提交缺失译文反馈时，相关源文本才会发送。
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

Apache-2.0，详见 [LICENSE](../LICENSE)。
