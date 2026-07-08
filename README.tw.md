<div align="center">

<img src="extension/assets/logo.512x.png" width="120" alt="Claude i18n Logo" />

# Claude i18n

**為 [Claude.ai](https://claude.ai) 提供社區驅動的國際化多語言支持。**

[English](README.en.md) | [简体中文](README.zh.md) | 繁體中文

[![Release](https://img.shields.io/github/v/release/Pectics/claude-i18n?label=發行版)](https://github.com/Pectics/claude-i18n/releases/latest)
[![License](https://img.shields.io/github/license/Pectics/claude-i18n?label=授權)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Pectics/claude-i18n/total?label=下載量)](https://github.com/Pectics/claude-i18n/releases/latest)

[![Issues](https://img.shields.io/github/issues/Pectics/claude-i18n?label=議題)](https://github.com/Pectics/claude-i18n/issues)
[![Pull Requests](https://img.shields.io/github/issues-pr/Pectics/claude-i18n?label=拉取請求)](https://github.com/Pectics/claude-i18n/pulls)
[![Locale Update](https://img.shields.io/github/actions/workflow/status/Pectics/claude-i18n/locale-update.yml?label=語言包更新)](https://github.com/Pectics/claude-i18n/actions/workflows/locale-update.yml)
![Vercel Build](https://img.shields.io/github/checks-status/Pectics/claude-i18n/main?label=Vercel%20建置)

| 支援平台 | 支援語言 |
| ---: | :--- |
| [![Chrome](https://img.shields.io/badge/Chrome-4285f4?logo=googlechrome&logoColor=white)](#安裝) [![Edge](.github/badges/edge.svg)](#安裝) [![Userscript](https://img.shields.io/badge/Userscript-6f42c1?logo=tampermonkey&logoColor=white)](#安裝) | [![zh-CN](https://img.shields.io/badge/zh--CN-e5534b)](#支援的語言) [![zh-TW](https://img.shields.io/badge/zh--TW-e5534b)](#支援的語言) [![zh-HK](https://img.shields.io/badge/[WIP]%20zh--HK-e5534b)](#支援的語言) |

| 目前語言包 | 主語言包 | Dynamic 語言包 | 合計 |
| --- | ---: | ---: | ---: |
| 簡體中文 `zh-CN` | 18,564 | 50 | 18,614 |
| 繁體中文 `zh-TW` | 18,564 | 50 | 18,614 |

</div>


## 預覽

<div align="center">

<img src="assets/showcase-1.jpg" width="720" alt="Claude.ai 中文介面預覽" />

<details>
<summary>查看更多截圖</summary>
<img src="assets/showcase-2.jpg" width="720" alt="Claude.ai 擴充功能頁面中文介面" />
<img src="assets/showcase-3.jpg" width="720" alt="Claude.ai 付費方案頁面中文介面" />
</details>

</div>


## 安裝

| 你想怎麼用 | 推薦方式 | 入口 |
| --- | --- | --- |
| Chrome / Edge 日常使用 | 應用程式商店版本 | [Chrome Web Store](https://chromewebstore.google.com/detail/claude-i18n/fkfmbjccelbeolkoekeaegajhhdndajj) / [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/claude-i18n/meogggfdmdeigjpkcpkdhngaegpncgjc) |
| Firefox Desktop 或 macOS Safari | 使用者腳本實驗版 | [userscript/README.md](userscript/README.md) |
| 手動安裝或留檔 | Releases 裡的 `.crx` | [Releases](https://github.com/Pectics/claude-i18n/releases) |

安裝後開啟 [Claude.ai](https://claude.ai)，在左下角帳號選單進入語言設定，選擇 `zh-CN` 或 `zh-TW` 對應的中文選項即可。

### 應用程式商店版本

這是最穩妥的分發方式，適合 Chrome 和 Edge 使用者。透過商店安裝後，瀏覽器會負責後續更新。

- [Chrome Web Store: Claude i18n](https://chromewebstore.google.com/detail/claude-i18n/fkfmbjccelbeolkoekeaegajhhdndajj)
- [Microsoft Edge Add-ons: Claude i18n](https://microsoftedge.microsoft.com/addons/detail/claude-i18n/meogggfdmdeigjpkcpkdhngaegpncgjc)

### 使用者腳本實驗版

使用者腳本面向非 Chromium 瀏覽器，目前主要用於 Firefox Desktop 與 macOS Safari。

- Firefox Desktop：推薦 Tampermonkey 或 Violentmonkey；Greasemonkey 為 best-effort 支援。
- macOS Safari：目前只驗證過 Safari + Userscripts App。
- 詳細安裝、偵錯與限制見 [userscript/README.md](userscript/README.md)。

### 手動安裝 `.crx`

1. 在 [Releases](https://github.com/Pectics/claude-i18n/releases) 下載最新 `.crx` 檔案。
2. 開啟 Chrome / Edge 的 `chrome://extensions/`。
3. 啟用右上角的開發人員模式。
4. 將 `.crx` 檔案拖入擴充功能頁面並確認安裝。

### 本機開發

```bash
git clone https://github.com/Pectics/claude-i18n.git
cd claude-i18n
```

在 `chrome://extensions/` 啟用開發人員模式，選擇載入未封裝項目，然後選擇 `extension/` 目錄。

如果要重新產生託管語言包產物，執行：

```bash
./build.sh
```


## 運作方式

Claude.ai 原本就有多語言載入管線，問題在於它只接受官方 locale。Claude i18n 做的是一層很薄的協調：讓頁面看見額外 locale，讓後端繼續收到它認識的 `en-US`，再把缺少的語言檔交給擴充功能補上。

### 執行鏈路

1. `hook.js` 在 `document_start` 注入頁面主世界，盡早接管語言列表與 `fetch`。
2. 當 Claude.ai 建立官方語言陣列時，擴充功能會把遠端 `locales.json` 中的額外 locale 追加進去。
3. 當同源應用請求攜帶 `locale=zh-CN` 或 `locale=zh-TW` 時，請求裡的 locale 會回退成 `en-US`，瀏覽器本地記住使用者實際選擇的擴充 locale。
4. 當頁面請求 `/i18n/*.json` 或 `/i18n/dynamic/*.json` 時，擴充功能後台會依 locale 回傳對應語言包。
5. 同源 JSON 回應裡的頂層 `locale` 和 `gated_messages.locale` 會在瀏覽器端恢復成使用者選擇的擴充 locale。

### 元件分工

| 檔案 | 作用 |
| --- | --- |
| `extension/hook.js` | 頁面主世界 hook；負責語言列表注入、請求改寫、回應恢復和 i18n 請求接管。 |
| `extension/script.js` | 頁面與擴充功能後台之間的訊息橋。 |
| `extension/service.js` | 擴充功能後台；讀取遠端 manifest、下載語言包、維護快取。 |
| `locales.json` | 託管端語言列表，目前包含 `zh-CN` 和 `zh-TW`。 |
| `<locale>/<locale>.json` | 主介面語言包。 |
| `<locale>/<locale>.dynamic.json` | Dynamic / `gated_messages` 相關語言包。 |

### 快取策略

- 語言列表快取在 `localStorage`，並依遠端 manifest 版本定期刷新。
- 語言包版本資訊快取在 `chrome.storage.local`，以 `/version/{locale}.json` 的 hash 為準。
- 語言包正文快取在 Cache Storage；hash 變化時才重新下載，舊 hash 對應的快取會被清理。
- `/i18n/*.overrides.json` 目前由擴充功能回傳空物件 `{}`，避免 Claude.ai 對擴充 locale 請求不存在的 overrides 檔案。


## 支援的語言

統計來自目前倉庫中的語言包檔案。

| 語言 | Locale | 主語言包 | Dynamic 語言包 | 狀態 |
| --- | --- | ---: | ---: | --- |
| 簡體中文 | `zh-CN` | 18,564 | 50 | 可用 |
| 繁體中文 | `zh-TW` | 18,564 | 50 | 可用 |

歡迎繼續補充其他真正有使用場景的 locale。新增語言建議走下方的完整語言建立流程，而不是手工複製目錄。


## 參與貢獻

### 改進現有翻譯

直接編輯對應 locale 檔案即可：

- 主介面文案：`zh-CN/zh-CN.json`、`zh-TW/zh-TW.json`
- Dynamic 文案：`zh-CN/zh-CN.dynamic.json`、`zh-TW/zh-TW.dynamic.json`
- 英文原文：`.original/en-US.json`、`.original/en-US.dynamic.json`

請保留佔位符、HTML 標籤、ICU MessageFormat、URL、命令、程式碼片段和反引號內容。翻譯可以更自然，但結構不能變。

### 同步 Claude 上游更新

倉庫的 GitHub Actions 每 6 小時檢查一次 Claude.ai 上游語言檔。發現 key 新增、更新或刪除時，會更新 `bot/locale-update` 分支，並產生 `.pending/locale-update` 下的差異檔。

維護者通常按這個流程處理：

```bash
# 1. 為目標 locale 產生翻譯分塊
node scripts/locale-update/prepare_translation.mjs --locale zh-CN

# 2. 翻譯 .pending/locale-update/translation/<locale>/chunks/ 下的 JSONL
#    輸出寫到 manifest 指定的 out/ 路徑
#    推薦使用專案內建工作流程：
#      Claude Code: /apply-locale-update
#      Codex:       /apply-locale-update

# 3. 校驗並套用翻譯
node scripts/locale-update/apply_translation.mjs --locale zh-CN
```

`apply_translation.mjs` 會校驗行數、key 順序、佔位符、HTML 標籤、ICU 結構和明顯未翻譯內容；成功後會重建目標語言包並清理 `.pending/locale-update`。

### 新增全新語言

全新 locale 不再建議手工建立目錄。請先產生完整翻譯任務：

```bash
node scripts/create-full-locale/prepare_translation.mjs --locale fr-FR
```

腳本會讀取 `.original/en-US*.json`，可參考 `.original/ja-JP*.json` 和現有 `zh-CN` 語境，產生 `.pending/create-full-locale/<locale>/` 下的分塊任務。

翻譯完成後執行：

```bash
node scripts/create-full-locale/apply_translation.mjs --locale fr-FR
./build.sh
```

成功後會寫入 `<locale>/<locale>.json`、`<locale>/<locale>.dynamic.json`，並把 locale 追加到 `locales.json`。


## 近期更新

完整歷史見 [Releases](https://github.com/Pectics/claude-i18n/releases)。

### 1.1.2

- 將 `statsig` 相關命名遷移為 `dynamic`，適配 Claude.ai 近期語言包結構調整。

### 1.1.1

- 請求改寫從固定介面名遷移為通用 locale transport：統一處理 query、JSON、表單、`URLSearchParams` 和 `FormData`。
- 同源 JSON 回應會通用恢復 `locale` 與 `gated_messages.locale`。
- 遠端 `locales.json` 簡化為字串陣列結構。

### 1.1.0

- 將擴充功能執行鏈路拆為 `hook.js`、`script.js`、`service.js` 三層。
- 語言列表改為遠端 lazy load，語言包改為 hash 校驗與瀏覽器快取。
- 補齊 `/i18n/*.overrides.json`、Dynamic 語言包和相關請求鏈路。


## 常見問題

**它會翻譯我和 Claude 的對話嗎？**

Claude i18n 只負責介面文案；prompt、回覆和檔案內容都交給 Claude.ai 原本的流程處理。

**會影響我的 Claude 帳號嗎？**

擴充功能在瀏覽器端協調 locale 處理；帳號設定保持 Claude.ai 原有狀態。對 Claude 後端來說，請求仍會回退到它支援的官方 locale。

**為什麼後端請求要回退到 `en-US`？**

因為 Claude 後端目前不接受擴充 locale。回退可以避免帳號資料、啟動資訊和體驗設定請求失敗；瀏覽器端再把介面語言恢復為使用者實際選擇的 locale。

**語言包會自動更新嗎？**

會。擴充功能會透過遠端版本 hash 檢查更新，hash 變化時重新下載語言包。

**使用者腳本版本穩定嗎？**

它是實驗性分發路徑。Chrome / Edge 使用者優先使用擴充功能商店版本；Firefox 和 Safari 使用者可以試用使用者腳本，並參考 [userscript/README.md](userscript/README.md) 排查注入時序或快取問題。


## 授權

[MIT](LICENSE) © 2026 [Pectics](https://github.com/Pectics)


<div align="center">

如果你想支持這個專案，Star、回報翻譯問題、補充新 locale 都很有幫助。也可以透過下面的方式贊助維護。

[![愛發電](https://img.shields.io/badge/愛發電-946ce6?logo=afdian&logoColor=white)](https://afdian.com/a/Pectics)
[![PayPal](https://img.shields.io/badge/PayPal-142c8e?logo=paypal&logoColor=white)](https://paypal.me/Pectics)

| 微信讚賞 | 支付寶 |
|:---:|:---:|
| <img src="assets/wechat.png" width="160" alt="微信讚賞碼" /> | <img src="assets/alipay.png" width="160" alt="支付寶收款碼" /> |

</div>
