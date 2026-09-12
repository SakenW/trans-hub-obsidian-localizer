# Trans-Hub Localizer · Plugin Localization

**Make Obsidian community plugins appear in your language.**

**English** · [简体中文](readme/README.zh-CN.md) · [繁體中文](readme/README.zh-TW.md) · [日本語](readme/README.ja.md) · [한국어](readme/README.ko.md) · [Deutsch](readme/README.de.md) · [Français](readme/README.fr.md) · [Español](readme/README.es.md) · [Português (Brasil)](readme/README.pt-BR.md) · [Русский](readme/README.ru.md)

[![Release](https://img.shields.io/github/v/release/SakenW/trans-hub-obsidian-localizer)](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) · **Desktop and mobile** · **No AI model or API key configuration required**

Trans-Hub Localizer is an Obsidian plugin that translates and localizes community-plugin interfaces. It prioritizes detected built-in translations, fills missing content through shared translations, and automatically synchronizes published updates. By default it applies translations at runtime without modifying plugin files, and does not translate or upload your notes.

[Install in Obsidian](obsidian://show-plugin?id=trans-hub-plugin-localizer) · [View localization progress](https://trans-hub.net/ecosystems/obsidian) · [Feedback and community](https://github.com/SakenW/Trans-Hub/discussions)

<!-- section: getting-started -->
## Getting started

You need **Obsidian 1.11.4 or later**, a Trans-Hub account, and a network connection for authorization and synchronization. Desktop and mobile are supported; advanced file compatibility patches are desktop-only.

1. Install and enable **Trans-Hub Localizer** in **Settings → Community plugins**.
2. Open plugin settings and connect your Trans-Hub account. No AI model, model-provider account, or API key configuration is required.
3. Confirm the translation language. The plugin automatically discovers enabled community plugins; you can exclude plugins you do not need localized.

Existing published translations are reused directly; missing content automatically submits a localization request and synchronizes after background processing and publication. Content awaiting processing, publication, or compatibility checks may temporarily remain in its original language.

For manual installation, download `main.js`, `manifest.json`, and `styles.css` from the same [GitHub Release](https://github.com/SakenW/trans-hub-obsidian-localizer/releases), and place them in `<vault-config-dir>/plugins/trans-hub-plugin-localizer/`. Do not mix files from different versions.

<!-- section: capabilities -->
## Core capabilities

| Capability | What it does |
| --- | --- |
| Native translations first | Keeps detected translations built into the current plugin and fills missing text. Only explicitly reviewed corrective translations may replace the corresponding native text. |
| Shared translations | Different users reuse published results; missing content enters the shared localization workflow. |
| Automatic synchronization | Restores verified cached translations first at startup and continues checking for updates while running. Obtaining new translations requires a network connection. |
| Compatible reuse after updates | Runtime translations that pass compatibility checks individually may be used across plugin versions; ambiguous or incompatible content is skipped. |
| Interface coverage | Supports safely identifiable names, descriptions, settings, buttons, commands, notices, options, tooltips, input prompts, accessibility labels, and some dynamic text. |
| Plugin README text | When a matching published README translation exists, supported text on community-plugin detail pages can be localized; README and core-interface coverage are counted separately. |

Runtime checks cover source identity, scope, semantic role, formatting, and dynamic placeholders as applicable. Complete translation of every interface in every plugin is not promised.

<!-- section: languages -->
## Full language support

Target languages are not limited to a fixed list. Select common languages or enter a language identifier through the other-language input, retaining regional and script variants.

Quick choices include **Simplified Chinese, Traditional Chinese, English, Japanese, Korean, German, French, Spanish, Brazilian Portuguese, and Russian**. Other languages include Italian (`it`), Arabic (`ar`), Ukrainian (`uk`), and the Serbian Latin variant (`sr-Latn`). Availability and quality depend on published results and services available for that language.

This refers to the translation language of **other plugins**. Trans-Hub's own settings interface currently provides Simplified Chinese and English and falls back to English for other languages. The language links at the top only switch this README's reading language.

<!-- section: quality -->
## Translation quality and support scope

Most current Trans-Hub translations are machine-generated and have not been human proofread. The plugin distinguishes translation source and review status. Passing source and compatibility validation does not mean translation accuracy has been human-reviewed.

This workflow is for community plugins whose identity and version can be verified through the official Obsidian community directory and trusted upstream sources. Plugins installed through BRAT, private plugins, or arbitrary local modifications do not automatically receive a compatibility guarantee. The current source-language workflow uses English.

Markdown editors, reading views, code, scripts, and editable note content are excluded. README localization is limited to community-plugin detail pages and does not enable note translation.

<!-- section: privacy -->
## Privacy and optional file patches

- Local scanning identifies plugin versions and supported interface text; scanned interface text and notes are not uploaded.
- Requests include plugin identity, version, target language, coverage counts, and cryptographic digests. Account authorization and translation downloads require network access.
- Credentials use Obsidian secure storage; see the server-side handling in the [privacy policy](https://trans-hub.net/zh-CN/legal/privacy).
- Default runtime localization does not rewrite plugin files. When disabled, runtime text that still retains its translated value is restored, while later changes made by other plugins are preserved.

**Advanced compatibility mode is desktop-only and disabled by default.** You must explicitly choose to apply a patch to each eligible plugin you want to patch. Patches modify only verified static interface text bound to an exact version and artifact, and save backups and receipts first. Restoration occurs only when the file still matches the post-patch digest; plugin upgrades or external modifications are preserved and reported as conflicts. Reload the target plugin after applying or restoring a patch. Patches never modify notes.

<!-- section: faq -->
## Frequently asked questions

**Do I need an API key?** No. Connect a Trans-Hub account; no model or API key configuration is required.

**Can I use it on a phone?** Yes. Runtime localization supports mobile and desktop. File compatibility patches are desktop-only.

**Why is some text still untranslated?** It may await a translation, have an unverifiable source, or be an interface that cannot be safely identified. Check plugin status; no published translation yet does not mean the language is unsupported.

**What if a plugin already includes Chinese?** Detected native translations take priority and shared translations fill gaps; reviewed corrections are a separate, explicit exception.

**What happens after a plugin update?** Compatibility is checked again. Reusable runtime entries remain active, while incompatible entries await translations for the new version. File patches still require an exact match.

**Can I use it offline?** Reuse previously cached, verified translations. Account authorization, processing missing content, and downloading new translations require a network connection.

<!-- section: contribute -->
## Contribute and get help

Help with [translation, proofreading, and terminology maintenance](https://trans-hub.net/ecosystems/obsidian). Report reproducible issues in [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues); discuss usage questions and suggestions in [Discussions](https://github.com/SakenW/Trans-Hub/discussions).

The [Simplified Chinese README](readme/README.zh-CN.md) is the content master for every language version; English is GitHub's default entry point. See the [contribution guide](CONTRIBUTING.md) for translation synchronization rules.

<!-- section: build -->
## Build and license

Use Node.js 24 and pnpm 10.34.4:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm verify:public-copy
pnpm build
```

The release tag must match `manifest.json`, `package.json`, and `versions.json`. Versions below `1.0.0` are public betas. Licensed under [Apache-2.0](LICENSE).
