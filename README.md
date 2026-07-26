# Trans-Hub Localizer

Make supported Obsidian community plugins feel native in your language.

<p align="center">
  <b>English</b> · <a href="readme/README.zh-CN.md">简体中文</a>
</p>

Trans-Hub Localizer applies verified translations to supported community-plugin names, descriptions, settings, commands, and interface text. It changes only Obsidian's presentation layer: third-party plugin files and vault notes remain untouched.

Powered by [Trans-Hub](https://trans-hub.net), an open localization collaboration platform.

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
- A missing-translation report sends source text only when you explicitly submit that report.
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
