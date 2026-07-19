# Trans-Hub Localizer

Make Obsidian community plugins feel native in your language. Trans-Hub Localizer applies verified translations to plugin names, descriptions, settings, commands, and interface text without changing the original plugin files.

Powered by [Trans-Hub](https://trans-hub.net), an open localization collaboration platform.

**中文简介：** 语枢 · 插件本地化让 Obsidian 社区插件以你选择的语言显示。译文在运行时安全应用，第三方插件文件和笔记内容保持不变。

## Highlights

- Select one or many enabled community plugins, or select them all at once.
- Choose the language you want to see; the plugin handles source detection automatically.
- Apply published translations to plugin metadata, settings, commands, interface text, and supported plugin detail pages.
- Keep plugin files and vault notes untouched; localization is applied only to Obsidian's presentation layer.
- Restore the official text immediately when localization is disabled.

Runtime localization uses exact, version-aware matches and excludes Markdown editors, reading views, code, scripts, and editable content.

## Install

After the plugin is accepted into the Obsidian Community directory, install **Trans-Hub Localizer** from **Settings → Community plugins**.

For a manual installation, download `main.js`, `manifest.json`, and `styles.css` from a GitHub release whose tag matches the manifest version, then place them in:

```text
<vault-config-dir>/plugins/trans-hub-plugin-localizer/
```

Enable the plugin, connect your Trans-Hub account in the browser, choose your display language, and select the plugins you want to localize.

## Privacy and security

- The plugin scans selected community plugins locally to identify their exact version and translation coverage.
- Trans-Hub receives the plugin identity, version, selected language, catalog counts, and cryptographic digests. Scanned interface text and note content are not uploaded.
- If you explicitly report a missing translation, only the source text shown in that report is submitted.
- Trans-Hub independently verifies official Obsidian registry and GitHub release sources before translations are published.
- Your notes are never read for this feature, and third-party plugin files are never modified.
- Account authorization happens in your browser. Device authorization data is stored with Obsidian's secure storage.
- The plugin contains no advertising or client-side telemetry.

See the [Trans-Hub privacy policy](https://trans-hub.net/zh-CN/legal/privacy) for server-side data handling.

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

## License

Apache-2.0. See [LICENSE](LICENSE).
