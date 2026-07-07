<div align="center">

<img src="extension/assets/logo.512x.png" width="120" alt="Claude i18n Logo" />

# Claude i18n

**Gives Claude.ai a language that doesn't officially exist.**

[简体中文](README.md) | [繁體中文](README.tw.md) | English

[![Version](https://img.shields.io/badge/version-v1.1.2-orange?style=flat-square)](https://github.com/pectics/claude-i18n/releases)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Tampermonkey-brightgreen?style=flat-square)](#installation)
[![Locale](https://img.shields.io/badge/supported-Simplified%20Chinese-red?style=flat-square)](#supported-languages)

</div>

---

## What does it do?

Claude's official interface has never supported Simplified Chinese. **This extension fixes that.**

After installation, a **中文（中国）** option appears in Claude Web's language menu. One click switches more than 15,000 UI strings to Chinese — no proxy, no configuration, no waiting for Anthropic to get around to it.

<div align="center">

<img src="assets/showcase-1.jpg" width="720" alt="Main page" />

<details>
<summary>Click to view more screenshots</summary>
<img src="assets/showcase-2.jpg" width="720" alt="Extension page" />
<img src="assets/showcase-3.jpg" width="720" alt="Paid plan page" />
</details>

</div>

---

## Installation

### Option 1: Install from store (recommended)

> ⚡ Done in 30 seconds, no technical knowledge required

- Chrome Web Store:
  [Claude i18n](https://chromewebstore.google.com/detail/claude-i18n/fkfmbjccelbeolkoekeaegajhhdndajj)
- Microsoft Edge Add-ons:
  [Claude i18n](https://microsoftedge.microsoft.com/addons/detail/claude-i18n/meogggfdmdeigjpkcpkdhngaegpncgjc)

### Option 2: Userscript (experimental)

> 🧪 Experimental build for Firefox Desktop and macOS Safari Userscripts

Non-Chromium browser users can try the userscript builds. For Firefox, use [`userscript/claude-i18n.user.js`](userscript/claude-i18n.user.js) with Tampermonkey or Violentmonkey; Greasemonkey is best-effort experimental support. For Safari, try [`userscript/claude-i18n.safari.user.js`](userscript/claude-i18n.safari.user.js), currently verified only for macOS Safari + Userscripts App.

1. Install Tampermonkey, Violentmonkey, or Greasemonkey in Firefox Desktop
2. Or install Userscripts App in macOS Safari and allow access to `claude.ai`
3. Choose the matching `.user.js` script for your browser and save it
4. Open [claude.ai](https://claude.ai), click your username in the bottom-left → Language → **中文（中国）** ✓

See [`userscript/README.md`](userscript/README.md) for details.

### Option 3: Download from Releases

1. Go to the [Releases page](https://github.com/Pectics/claude-i18n/releases) and download the latest `.crx` file
2. Open Chrome / Edge and navigate to `chrome://extensions/`
3. Enable **Developer mode** in the top-right corner
4. **Drag and drop** the downloaded `.crx` file into the browser window
5. Click "Add extension" to confirm
6. Open [claude.ai](https://claude.ai), click your username in the bottom-left → Language → **中文（中国）** ✓

### Option 4: Build from source

```bash
git clone https://github.com/Pectics/claude-i18n.git
cd claude-i18n
```

Then in `chrome://extensions/`, enable **Developer mode**, click "Load unpacked", and select the project's `extension/` directory.

---

## How does it work?

Claude's backend still does not accept `zh-CN` as a real locale. This extension simulates `zh-CN` on the frontend, falls backend-only requests back to `en-US`, and then restores the extension locale in the browser.

```
You click "Chinese"
        ↓
`hook.js` is injected at `document_start` in the `MAIN` world
        ↓
When Claude Web builds the official locale array, the extension appends remote locales from `locales.json`
        ↓
`PUT` / `GET /api/account_profile`, `bootstrap`, and `experience` requests fall back to `en-US` where needed
        ↓
`GET /i18n/*.json` and `/i18n/dynamic/*.json` for extension locales are handed off to the extension backend
        ↓
The backend checks local cache first, then uses `/version/{locale}.json` hashes to decide whether a refresh is needed
        ↓
Returns the zh-CN main pack and dynamic pack
        ↓
UI switches using Claude's own locale flow
```

The current implementation has three layers:

- `hook.js`: runs in the page's main world and handles Array proxying, `fetch` interception, and request rewriting for `account_profile`, `bootstrap`, `experience`, and `i18n`.
- `script.js`: bridges messages between the page and the extension backend.
- `service.js`: talks to the remote Vercel site, reads `/locales.json` and `/version/{locale}.json`, and maintains local caches.

**Caching strategy:**

- Extension locale list: read from cached `locales.json` in `localStorage` first, then lazy-load the remote manifest; replace the cache only when the version or content changes.
- Language file version metadata: stored in `chrome.storage.local`, keyed by locale and backed by `/version/{locale}.json`.
- Language file bodies: stored in Cache Storage; re-downloaded only when the hash changes.
- `/i18n/*.overrides.json`: currently intercepted and returned as an empty `{}` object.

---

## Supported languages

| Language | String Count | Status |
|----------|---------|--------|
| Simplified Chinese (zh-CN) | 15,058 | ✅ Available |
| More languages | — | Contributions welcome |

---

## Contributing

### Updating language pack (syncing upstream)

When Claude.ai adds, modifies, or removes UI keys upstream, CI automatically fetches the latest `.original/` files every 6 hours and opens a diff PR. Before the PR is merged, translations need to be applied manually:

```bash
# 1. Prepare translation tasks for zh-CN (generates chunked JSONL files)
node scripts/locale-update/prepare_translation.mjs --locale zh-CN

# 2. Translate the chunk files under .pending/locale-update/translation/zh-CN/chunks/
#    The recommended way is to use the built-in translation workflow skill:
#      Claude Code:  /apply-locale-update
#      Codex:        /apply-locale-update
#    The skill reads chunks, translates, writes to out/, and validates placeholders/ICU/tags
#    Manual translation: each chunk is JSONL, lines have { key, en, reference, op }; use the manifest outputField

# 3. Validate and apply the translations
node scripts/locale-update/apply_translation.mjs --locale zh-CN
```

What each script does:
- `build_diff.mjs`: compares old and new `.original/` files to detect key diffs (add / update / remove)
- `prepare_translation.mjs`: splits diffs into manageable translation chunks
- `apply_translation.mjs`: validates translation integrity (placeholders, URLs, HTML tags, etc.) and merges back into `zh-CN/zh-CN.json`

### Improving translations

The main UI translation file is [`zh-CN/zh-CN.json`](zh-CN/zh-CN.json). For `gated_messages` / dynamic-related copy, edit [`zh-CN/zh-CN.dynamic.json`](zh-CN/zh-CN.dynamic.json).

The original main English strings are in [`.original/en-US.json`](.original/en-US.json).

Edit the JSON file and open a PR. The structure is straightforward:

```json
{
  "some.ui.key": "translated string"
}
```

### Adding a new language

1. Append a locale string to the `locales` array in [`locales.json`](locales.json) (for example, `"zh-TW"`)
2. Create the locale directory and both translation files:
   `zh-TW/zh-TW.json`
   `zh-TW/zh-TW.dynamic.json`
3. Run `./build.sh` and confirm it generates:
   `dist/locales.json`
   `dist/zh-TW/version.json`
4. Open a PR

---

## Changelog

### 1.1.2

- Globally replaced `statsig` keywords with `dynamic` to adapt to Claude.ai's latest refactor

### 1.1.1

- Replaced path-specific extension locale request rewrites with protocol-shape matching that checks `locale` in query parameters and request bodies
- The generic body rewrite path now supports `application/json`, `application/x-www-form-urlencoded`, `URLSearchParams`, and `FormData`
- Same-origin JSON responses now restore top-level `locale` and `gated_messages.locale` generically, without depending on fixed endpoint names such as `account_profile`, `bootstrap`, or `experiences`
- Simplified remote `locales.json` to a plain string-array format and updated both the build step and the extension's lazy cache loading logic accordingly

### 1.1.0

- Rebuilt the runtime pipeline into `hook.js`, `script.js`, and `service.js` for page interception, bridge messaging, and background caching
- Fell backend-facing extension locale requests back to `en-US`, then restored the extension locale in `account_profile`, `bootstrap/app_start`, and related responses
- Switched extension locale discovery to lazy-loaded remote `/locales.json`, cached in `localStorage`
- Switched language pack updates to `/version/{locale}.json` hash validation, with metadata in `chrome.storage.local` and payloads in Cache Storage
- Added compatibility handling for `experiences/claude_web`, `/i18n/*.overrides.json`, and the current request flow around extension locales

### 1.0.2

- Updated the extension to track Claude Web's latest frontend changes
- Moved the page hook to a more reliable runtime injection path so the i18n store can be captured again
- Stubbed the new `gated-messages` request path for extension locales to avoid 404 HTML responses breaking switches
- Added self-healing cache validation so stale invalid HTML payloads no longer poison the local language-pack cache
### 1.0.1

- Completed the frontend reverse engineering needed to reach Claude Web's runtime locale override entry
- Language switching became instant and reload-free
- Menu injection, runtime switching, request interception, and local caching all worked together as a polished flow

### 1.0.0

- Initial MVP release
- Added a Simplified Chinese entry to Claude Web's language menu
- Shipped the first working version of the hosted language packs, request interception, and browser-side loading flow

---

## FAQ

**Switched the language but nothing changed?** \
Make sure the extension is enabled, then refresh claude.ai.

**Will this affect my Claude account?** \
No. The extension operates entirely in the browser and doesn't modify any account settings or communicate with Anthropic's servers (other than the normal language pack fetch).

**Can I switch back to English afterwards?** \
Absolutely. Select any officially supported language from the language menu and the extension automatically exits Chinese mode.

**Are language packs updated automatically?** \
Yes. The extension detects remote updates via version hashes and downloads the latest pack when one is available.

---

## License

[MIT](LICENSE) © 2026 [Pectics](https://github.com/Pectics)

---

<div align="center">

If this extension has been useful to you, feel free to buy me a coffee ☕ \
Or simply leave a Star ⭐ — that means a lot too.

[![afdian](https://img.shields.io/badge/afdian-Pectics-946ce6?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMTUgMjUgMTMwIDExMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTY1IDkwLjdjLTEuNiAwLTIuOCAxLjMtMi44IDIuOCAwIDEuNiAxLjMgMi44IDIuOCAyLjhzMi44LTEuMyAyLjgtMi44YzAtMS42LTEuMy0yLjgtMi44LTIuOFoiIGZpbGw9IndoaXRlIi8+PHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik05MS44IDk5LjJjMS42IDAgMi44IDEuMyAyLjggMi44IDAgMS42LTEuMyAyLjgtMi44IDIuOC0xLjYgMC0yLjgtMS4zLTIuOC0yLjggMC0xLjYgMS4zLTIuOCAyLjgtMi44WiIgZmlsbD0id2hpdGUiLz48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTEzNC42IDk4LjRjMi41IDEuNSA2LjUgNC4xIDUuMSA4LjctLjUgMS43LTEuNyAzLjEtMy40IDQtMCAwLS4xLjEtLjEuMS0yLjIgMS4xLTUuMSAxLjItNy43LjMtLjgtLjMtMS42LS41LTIuNS0uOC0uNi0uMi0xLjItLjQtMS44LS42LTEuOSAzLjEtNS44IDYuNS0xMS4zIDkuNC05LjkgNS4yLTI0LjggOC42LTQyIDQuOC0xMy4yLTIuOS0yMS45LTguMy0yNS44LTE2LTMuMS02LjEtMi40LTEyLjMtLjgtMTYuMSAxLjUtMy4xIDUuNy03LjEgMTAuOS0xMS4zLTEuMy0xLjUtMi41LTMuNC0yLjQtNS4zIDAtMS42LjgtMi45IDIuMi0zLjggMy41LTIuNCA4LjItLjUgMTEuMSAxLjIgMS43LTEuMSAzLjMtMi4zIDQuOS0zLjMtMS4xLS40LTIuNy0uOC00LjctMS03LS43LTI1LjMtNC0zMS43LTYuOEMxOC45IDU1LjMgMTkuMSA0Ny44IDIwLjcgNDMuOWMyLjgtNi45IDE4LjEtMTEgMjUuMS0xMC44IDMuNC4xIDUuNCAxLjEgNi4xIDMuMSAxLjMgMy40LTIuNiA1LjMtNy43IDcuNy0xLjMuNi0yLjggMS40LTQuMyAyLjEgNy4xLjYgMTcuNy4yIDI1LjYtLjEgNi44LS4zIDEzLjItLjUgMTguNy0uNCAxOS4xLjQgMzQuMiA4LjQgNDQuNiAyMy43IDYuOCAxMCA0LjggMjAuMSAxLjcgMjcuOSAxLjQuMSAyLjcuNSA0IDEuNFpNNjEgNzYuNmMtMS4xLS40LTIuMi0uNi0yLjgtLjUuMi40LjcgMSAxLjIgMS42LjUtLjQgMS0uOCAxLjYtMS4yWm03Mi44IDI5LjhjLjUtLjMuNy0uNS44LS45LjItLjYtLjctMS4zLTIuNi0yLjQtMS40LS45LTIuOS0xLTUuMi0uNi0uMSAwLS4yIDAtLjMgMC0uMSAwLS4xIDAtLjIgMC0zLjUuMy02LjItMi45LTYuOC0zLjYtLjktMS4yLS43LTIuOC40LTMuOCAxLjEtLjkgMi44LS43IDMuOC40LjMuNC44LjggMS4yIDEuMSAzLjQtNy40IDUuNS0xNS45LS40LTI0LjUtOS42LTE0LjEtMjIuOC0yMS00MC40LTIxLjQtNS4zLS4xLTExLjcuMS0xOC40LjQtMTUuNi42LTI2LjcuOS0zMi45LTEuMS0uMS0wLS4xLS4xLS4yLS4xLTEuOC0uNi0zLjItMS4zLTQuMi0yLjMtMS0xLjEtMS0yLjguMS0zLjggMS4xLTEuMSAyLjgtMSAzLjguMS4xLjEuMy4yLjUuMyAyLjQtMi4xIDUuOS0zLjggOS4xLTUuNC4zLS4yLjctLjMgMS4xLS41LTIuNy4zLTYuMyAxLjEtMTAgMi41LTQuNyAxLjgtNi45IDMuNy03LjMgNC45LTIgNSA3IDkuNSAxMSAxMS4yIDUuNSAyLjQgMjIuNyA1LjYgMzAuMSA2LjQgNC43LjUgNy42IDEuOSA5LjMgMyA1LTMuMiA4LjktNS41IDEwLjEtNi4yIDEuMi0uOCAyLjktLjMgMy42LjlzLjMgMi45LS45IDMuN2MtMTQuMyA4LjQtMzYuNyAyMy4zLTM5LjggMjkuNy0xLjEgMi41LTEuNiA3IC43IDExLjUgMy4xIDYuMSAxMC44IDEwLjcgMjIuMiAxMy4yIDI1LjMgNS41IDQzLjItNS43IDQ3LjMtMTEuNC0uNC0uMy0uOC0uNy0xLjEtMS0uOS0xLjItLjctMi45LjUtMy43IDEuMi0uOSAyLjktLjcgMy43LjUuNS43IDMuNCAxLjUgNSAyIC45LjMgMS44LjYgMi43LjkgMS4zLjQgMi42LjQgMy42LS4xWiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=)](https://afdian.com/a/pectics)
[![PayPal](https://img.shields.io/badge/PayPal-Pectics-142c8e?style=flat-square&logo=paypal&logoColor=white)](https://paypal.me/Pectics)

| WeChat Pay | Alipay |
|:---:|:---:|
| <img src="assets/wechat.png" width="160" alt="WeChat Pay QR Code" /> | <img src="assets/alipay.png" width="160" alt="Alipay QR Code" /> |
</div>
