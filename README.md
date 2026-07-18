# Trans-Hub Localizer

Automatically translate and localize Obsidian community plugin names, descriptions, settings, commands, and user interfaces into your preferred language. Trans-Hub Localizer is an Obsidian plugin translator and localization (i18n) client powered by [Trans-Hub](https://trans-hub.net).

**中文简介：** 语枢 · 插件本地化是一款 Obsidian 插件翻译与汉化工具，可自动发现并本地化第三方社区插件的名称、说明、设置、命令和界面文案。

## Features

- Discover translatable interface strings from the enabled community plugins you select.
- Localize plugin names and descriptions in Obsidian when complete published translations are available.
- Apply published translations at runtime without modifying third-party plugin files.
- Choose one target language while keeping Obsidian as the fixed public ecosystem and English as the source language.
- Restore original text immediately when localization is disabled.

It does not translate note content and never modifies third-party plugin files. Runtime localization uses exact text matches and excludes Markdown editors, reading views, code, scripts, and editable content.

## Install

After the plugin is accepted into the Obsidian Community directory, install **Trans-Hub Localizer** from **Settings → Community plugins**.

For a manual installation, download `main.js`, `manifest.json`, and `styles.css` from a GitHub release whose tag matches the manifest version, then place them in:

```text
<vault-config-dir>/plugins/trans-hub-plugin-localizer/
```

Enable the plugin and open its settings. Log in with a Trans-Hub account and choose the language to translate into. The Obsidian public ecosystem and English source language are fixed product boundaries, not user settings.

## What is sent

- The plugin reads `manifest.json` and `main.js` from enabled community plugins under the current vault configuration directory.
- It sends plugin identity, version, target language, catalog counts, and content digests to the Trans-Hub API. Scanned UI text and note content are not uploaded. A single UI source string is sent only when you explicitly submit a missing-translation report.
- It reads the official Obsidian community registry, version-matched GitHub Release metadata, and the immutable README from the same upstream tag to identify and localize plugin metadata.
- README localization is limited to the Obsidian community-plugin detail view. Links and code examples are preserved, and vault notes are never included.
- The plugin never handles your password. Short-lived credentials and the installation private key are stored in Obsidian SecretStorage, not in plugin settings. The plugin contains no advertising or client-side telemetry.

See the [Trans-Hub privacy policy](https://trans-hub.net/zh-CN/legal/privacy) for server-side data handling.

## Development

Requirements: Node.js 24 and pnpm 10.34.4.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm build:dev
```

Development builds connect to `http://127.0.0.1:8000` and open registration at `http://127.0.0.1:3000/register` by default. `TRANS_HUB_OBSIDIAN_DEV_API_BASE_URL` and `TRANS_HUB_OBSIDIAN_DEV_WEB_BASE_URL` may select other localhost or loopback ports; non-loopback development URLs are rejected. Production builds always use `https://api.trans-hub.net` and `https://trans-hub.net/register`, and ignore development overrides.

## Release integrity

Release tags use plain `x.y.z` semantic versions and must match `manifest.json`, `package.json`, and `versions.json`. The release workflow rebuilds from the immutable tag, runs lint, type checks and tests, verifies that the production bundle contains no loopback URL, creates SHA-256 checksums and GitHub artifact attestations, and publishes the assets Obsidian installs.

## License

Apache-2.0. See [LICENSE](LICENSE).
