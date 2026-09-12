# Contributing

Help translate and proofread plugin text at [Trans-Hub](https://trans-hub.net/ecosystems/obsidian). For reproducible client bugs, use [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues); for questions, use [Discussions](https://github.com/SakenW/Trans-Hub/discussions).

## README translations

The Simplified Chinese [README](readme/README.zh-CN.md) is the content source for every language, including English. The root `README.md` is the English GitHub entry. Translate directly from Chinese and keep English first in each language navigation bar.

1. Update the Chinese source for changes to product behavior, installation, privacy, or limitations.
2. Synchronize all translations. Preserve section markers, commands, version numbers, links, review-status distinctions, and desktop-only patch restrictions. Natural phrasing is welcome; additional promises and omitted limitations are not.
3. Check each translation against the source. Record the reviewed Chinese file's SHA-256 in that translation's `sourceSha256` entry in `readme/translations.json`. Compute it with `node --input-type=module -e 'import {readFileSync} from "node:fs"; import {createHash} from "node:crypto"; console.log(createHash("sha256").update(readFileSync("readme/README.zh-CN.md")).digest("hex"))'` from the public repository root.
4. Run `pnpm verify:public-copy` and inspect GitHub's rendered Markdown, including the language links. Hash and structure checks detect stale files and missing sections; they do not certify translation accuracy. Never refresh all hashes merely to silence the check.

The current README editions are English, Simplified and Traditional Chinese, Japanese, Korean, German, French, Spanish, Brazilian Portuguese, and Russian. README editions, the Localizer's settings language, and target languages for other plugins are separate capabilities. New editions should include the full document and reciprocal navigation, with a corresponding manifest entry.

## 中文维护约定

简体中文是唯一内容母版，英文为 GitHub 默认首页，所有语言直接依据中文维护。先更新中文，再同步各译本，核对安装、功能、隐私、安全边界和常见问题后，才更新 `readme/translations.json` 对应译本的中文 SHA-256。

顶部语言导航始终英语第一，当前语言加粗。保留章节标记、命令、版本和链接。校验器只能发现结构缺失、失效链接及母版变更后的未同步状态，不能替代语义校对。不要为了通过检查而直接批量刷新摘要。

## Development

Use Node.js 24 and the pnpm version in `package.json`. Before proposing a code change, run the affected tests, lint, type checking, and build. Do not include credentials, vault notes, generated bundles, or unrelated changes in a contribution.
