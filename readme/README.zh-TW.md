# Trans-Hub Localizer · 語樞外掛本地化

**讓 Obsidian 社群外掛以你的語言呈現。**

[English](../README.md) · [简体中文](README.zh-CN.md) · **繁體中文** · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

[![Release](https://img.shields.io/github/v/release/SakenW/trans-hub-obsidian-localizer)](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) · **桌面與行動版** · **無需設定 AI 模型或 API Key**

Trans-Hub Localizer 是一款為 Obsidian 社群外掛提供漢化、翻譯與介面本地化的外掛。它優先保留偵測到的外掛內建譯文，透過共享翻譯補齊缺失內容，並自動同步已發布的更新。預設會在執行階段套用譯文，不修改外掛檔案，也不翻譯或上傳你的筆記。

[在 Obsidian 中安裝](obsidian://show-plugin?id=trans-hub-plugin-localizer) · [查看本地化進度](https://trans-hub.net/ecosystems/obsidian) · [回饋與社群](https://github.com/SakenW/Trans-Hub/discussions)

<!-- section: getting-started -->
## 開始使用

需要 **Obsidian 1.11.4 或更高版本**、語樞帳號，以及用於授權與同步的網路連線。支援桌面與行動版；進階檔案相容性修補僅限桌面版。

1. 在 **設定 → 第三方外掛** 中安裝並啟用 **Trans-Hub Localizer**。
2. 開啟外掛設定，連線語樞帳號。無需設定 AI 模型、模型服務商帳號或 API Key。
3. 確認譯文語言。外掛會自動發現已啟用的社群外掛，你可以排除不需要本地化的外掛。

既有的已發布譯文會直接重複使用；缺失內容會自動提交本地化需求，在背景處理並於發布後同步。等待處理、發布或相容性檢查的內容可能暫時保留原文。

手動安裝時，從同一個 [GitHub Release](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) 下載 `main.js`、`manifest.json` 和 `styles.css`，放入 `<vault-config-dir>/plugins/trans-hub-plugin-localizer/`。不要混用不同版本的檔案。

<!-- section: use-cases -->
## 適合哪些情境

- 想將社群外掛的設定、命令和介面翻譯成自己的語言。
- 希望重用共享譯文，不自行設定 AI 模型或 API Key。
- 希望在電腦和手機上使用，並在外掛更新後自動檢查相容譯文。

<!-- section: capabilities -->
## 核心功能

| 功能 | 實際效果 |
| --- | --- |
| 原生譯文優先 | 保留偵測到的目前外掛內建翻譯，補齊缺失文案。只有明確經過審核的修正譯文，才能取代對應的原生文案。 |
| 共享翻譯 | 不同使用者重複使用已發布成果，缺失內容進入共享本地化流程。 |
| 自動同步 | 啟動時先還原已驗證的快取譯文，執行期間持續檢查更新。取得新譯文需要網路連線。 |
| 更新後相容重複使用 | 逐項通過相容性檢查的執行階段譯文可跨外掛版本使用；有歧義或不相容的內容會被略過。 |
| 介面覆蓋 | 支援可安全識別的名稱、說明、設定、按鈕、命令、通知、選項、工具提示、輸入提示、無障礙標籤及部分動態文案。 |
| 外掛 README 文字 | 有相符的已發布 README 譯文時，可本地化社群外掛詳細頁中受支援的文字；README 與核心介面覆蓋會分開計算。 |

執行階段會根據適用條件檢查來源身分、範圍、語意角色、格式和動態預留位置，不承諾每個外掛的所有介面都能完整翻譯。

<!-- section: languages -->
## 全語言支援，不限於預設選項

常用語言可快速選擇，其他語言可透過語言標識輸入，並保留地區與文字變體。具體譯文是否可用，取決於對應內容的處理與發布狀態。

快速選擇包括 **簡體中文、繁體中文、英語、日語、韓語、德語、法語、西班牙語、巴西葡萄牙語、俄語**。其他語言例如義大利語（`it`）、阿拉伯語（`ar`）、烏克蘭語（`uk`）和塞爾維亞語拉丁字母變體（`sr-Latn`）。具體譯文的可用性與品質，取決於已發布成果及該語言可用的處理服務。

這裡指的是 **其他外掛的譯文語言**。語樞自身設定介面目前提供簡體中文和英語，其他語言會回退至英語。頁面頂端的語言連結僅切換本 README 的閱讀語言。

<!-- section: quality -->
## 翻譯品質與支援範圍

本外掛面向社群外掛介面，不提供筆記翻譯、網頁翻譯或裝置端即時 LLM 翻譯。

目前多數語樞譯文由機器產生，未經人工校對。外掛會區分譯文來源和審核狀態。來源與相容性驗證通過，不代表譯文準確性已經過人工審核。

本流程面向可透過 Obsidian 官方社群目錄及可信任上游來源驗證身分和版本的社群外掛。透過 BRAT 安裝、私有外掛或任意本機修改，並不自動獲得相容性保證。目前來源語言流程使用英語。

筆記的 Markdown 編輯器、閱讀視圖、程式碼、指令碼和可編輯內容均被排除。README 本地化僅限社群外掛詳細頁，不會啟用筆記翻譯。

<!-- section: privacy -->
## 隱私與可選檔案修補

- 本機掃描用於識別外掛版本及受支援的介面文案，不會上傳掃描到的介面文字或筆記。
- 請求包含外掛身分、版本、目標語言、覆蓋計數和加密摘要。帳號授權與譯文下載需要網路存取。
- 憑證使用 Obsidian 安全儲存；伺服器端處理方式請見[隱私權政策](https://trans-hub.net/zh-CN/legal/privacy)。
- 預設執行階段本地化不會改寫外掛檔案。關閉時會還原仍保有譯文值的執行階段文字，保留其他外掛之後主動作出的修改。

**進階相容模式僅限桌面版，預設關閉。** 必須對每個符合條件的外掛主動套用修補。修補只修改與精確版本及成品繫結、經過驗證的靜態介面文案，並先儲存備份和收據。只有檔案仍符合修補後摘要時才會還原；外掛升級或外部修改會被保留並回報為衝突。套用或還原修補後，需要重新載入目標外掛。修補絕不修改筆記。

<!-- section: faq -->
## 常見問題

**需要 API Key 嗎？** 不需要。連線語樞帳號即可，無需設定模型或 API Key。

**手機可以使用嗎？** 可以，執行階段本地化支援行動版與桌面版。檔案相容性修補僅在桌面版提供。

**為什麼有些文字仍未翻譯？** 可能仍在等待譯文、來源無法驗證，或無法安全識別介面。請查看外掛狀態；尚無已發布譯文不代表不支援該語言。

**外掛已經內建中文怎麼辦？** 優先保留偵測到的原生譯文，共享翻譯補齊缺失部分；已審核的修正是單獨、明確的例外。

**外掛更新後怎麼辦？** 重新檢查相容性，可重複使用的執行階段項目會繼續生效，不相容項目等待新版譯文。檔案修補仍要求精確相符。

**可以離線使用嗎？** 可以重複使用先前已快取、已驗證的譯文。帳號授權、缺失內容處理和新譯文下載需要網路連線。

<!-- section: contribute -->
## 參與貢獻與取得協助

歡迎參與[翻譯、校對和術語維護](https://trans-hub.net/ecosystems/obsidian)。可重現問題請提交至 [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues)，使用問題與建議可在 [Discussions](https://github.com/SakenW/Trans-Hub/discussions) 討論。

[簡體中文 README](README.zh-CN.md) 是所有語言版本的內容母版，英文是 GitHub 預設入口。譯本同步規則請見[貢獻說明](../CONTRIBUTING.md)。

<!-- section: build -->
## 建置與授權條款

使用 Node.js 24 和 pnpm 10.34.4：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm verify:public-copy
pnpm build
```

Release 標籤必須與 `manifest.json`、`package.json`、`versions.json` 一致。`1.0.0` 以下版本屬於公開測試版。採用 [Apache-2.0](../LICENSE) 授權條款。
