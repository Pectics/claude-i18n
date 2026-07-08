<div align="center">

<img src="extension/assets/logo.512x.png" width="120" alt="Claude i18n Logo" />

# Claude i18n

**Provide community-driven internationalization and multi-language support for Claude.ai.**

[简体中文](README.md) | [繁體中文](README.tw.md) | English

[![Release](https://img.shields.io/github/v/release/Pectics/claude-i18n?label=Release)](https://github.com/Pectics/claude-i18n/releases/latest)
[![License](https://img.shields.io/github/license/Pectics/claude-i18n?label=License)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Pectics/claude-i18n/total?label=Downloads)](https://github.com/Pectics/claude-i18n/releases/latest)

[![Pull Requests](https://img.shields.io/github/issues-pr/Pectics/claude-i18n?label=Pull%20Requests)](https://github.com/Pectics/claude-i18n/pulls)
[![Issues](https://img.shields.io/github/issues/Pectics/claude-i18n?label=Issues)](https://github.com/Pectics/claude-i18n/issues)
[![Locale Update](https://img.shields.io/github/actions/workflow/status/Pectics/claude-i18n/locale-update.yml?label=Locale%20Update)](https://github.com/Pectics/claude-i18n/actions/workflows/locale-update.yml)
![Vercel Build](https://img.shields.io/github/checks-status/Pectics/claude-i18n/main?label=Vercel%20Build)

| Supported platforms | Supported languages |
| ---: | :--- |
| [![Chrome](https://img.shields.io/badge/Chrome-4285f4)](#installation) [![Edge](https://img.shields.io/badge/Edge-1677ff)](#installation) [![Userscript](https://img.shields.io/badge/Userscript-6f42c1)](#installation) | [![zh-CN](https://img.shields.io/badge/zh--CN-e5534b)](#supported-languages) [![zh-TW](https://img.shields.io/badge/zh--TW-e5534b)](#supported-languages) [![zh-HK](https://img.shields.io/badge/[WIP]%20zh--HK-e5534b)](#supported-languages) |

| Current locale pack | Main pack | Dynamic pack | Total |
| --- | ---: | ---: | ---: |
| Simplified Chinese `zh-CN` | 18,564 | 50 | 18,614 |
| Traditional Chinese `zh-TW` | 18,564 | 50 | 18,614 |

</div>


## Preview

<div align="center">

<img src="assets/showcase-1.jpg" width="720" alt="Claude Web Chinese interface preview" />

<details>
<summary>View more screenshots</summary>
<img src="assets/showcase-2.jpg" width="720" alt="Claude Web extension page in Chinese" />
<img src="assets/showcase-3.jpg" width="720" alt="Claude Web plan page in Chinese" />
</details>

</div>


## Installation

| Use case | Recommended route | Link |
| --- | --- | --- |
| Daily Chrome / Edge use | Store build | [Chrome Web Store](https://chromewebstore.google.com/detail/claude-i18n/fkfmbjccelbeolkoekeaegajhhdndajj) / [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/claude-i18n/meogggfdmdeigjpkcpkdhngaegpncgjc) |
| Firefox Desktop or macOS Safari | Experimental userscript | [userscript/README.md](userscript/README.md) |
| Manual install or archival package | `.crx` from Releases | [Releases](https://github.com/Pectics/claude-i18n/releases) |

After installation, open [claude.ai](https://claude.ai), go to the language setting from the bottom-left account menu, and select the Chinese option for `zh-CN` or `zh-TW`.

### Store Build

This is the most reliable distribution path for Chrome and Edge. Once installed from the store, browser updates are handled for you.

- [Chrome Web Store: Claude i18n](https://chromewebstore.google.com/detail/claude-i18n/fkfmbjccelbeolkoekeaegajhhdndajj)
- [Microsoft Edge Add-ons: Claude i18n](https://microsoftedge.microsoft.com/addons/detail/claude-i18n/meogggfdmdeigjpkcpkdhngaegpncgjc)

### Experimental Userscript

The userscript build is for non-Chromium browsers, mainly Firefox Desktop and macOS Safari.

- Firefox Desktop: Tampermonkey or Violentmonkey is recommended; Greasemonkey is best-effort.
- macOS Safari: currently verified only with Safari + Userscripts App.
- Installation, debugging notes, and limitations are in [userscript/README.md](userscript/README.md).

### Manual `.crx` Install

1. Download the latest `.crx` from [Releases](https://github.com/Pectics/claude-i18n/releases).
2. Open `chrome://extensions/` in Chrome or Edge.
3. Enable Developer mode.
4. Drag the `.crx` into the extensions page and confirm installation.

### Local Development

```bash
git clone https://github.com/Pectics/claude-i18n.git
cd claude-i18n
```

In `chrome://extensions/`, enable Developer mode, choose "Load unpacked", and select the `extension/` directory.

To rebuild hosted locale artifacts:

```bash
./build.sh
```


## How It Works

Claude Web already has a locale-loading pipeline; it just only accepts official locales. Claude i18n adds a thin coordination layer: the page can see extra locales, the backend still receives `en-US` where it needs an official locale, and the missing locale files are served by the extension.

### Runtime Flow

1. `hook.js` is injected into the page's main world at `document_start`, before Claude Web finishes wiring its locale state.
2. When Claude Web builds the official locale array, the extension appends extra locales from the remote `locales.json`.
3. When same-origin app requests carry `locale=zh-CN` or `locale=zh-TW`, the transport locale falls back to `en-US`, while the browser remembers the user's selected extension locale.
4. When the page requests `/i18n/*.json` or `/i18n/dynamic/*.json`, the extension backend returns the matching locale pack.
5. Same-origin JSON responses with top-level `locale` or `gated_messages.locale` are restored in the browser to the user's selected extension locale.

### Components

| File | Role |
| --- | --- |
| `extension/hook.js` | Main-world page hook for locale-list injection, request rewriting, response restoration, and i18n interception. |
| `extension/script.js` | Message bridge between the page and the extension background worker. |
| `extension/service.js` | Background worker that reads the remote manifest, downloads locale packs, and maintains cache state. |
| `locales.json` | Hosted locale manifest, currently listing `zh-CN` and `zh-TW`. |
| `<locale>/<locale>.json` | Main UI locale pack. |
| `<locale>/<locale>.dynamic.json` | Dynamic / `gated_messages` locale pack. |

### Cache Strategy

- The locale manifest is cached in `localStorage` and refreshed against the remote manifest version.
- Locale pack version metadata is cached in `chrome.storage.local`, keyed by hashes from `/version/{locale}.json`.
- Locale pack bodies are cached in Cache Storage; they are re-downloaded only when the hash changes, and old hash entries are pruned.
- `/i18n/*.overrides.json` currently returns an empty `{}` for extension locales so Claude Web does not fail on missing override files.


## Supported Languages

Counts come from the locale files currently in this repository.

| Language | Locale | Main pack | Dynamic pack | Status |
| --- | --- | ---: | ---: | --- |
| Simplified Chinese | `zh-CN` | 18,564 | 50 | Available |
| Traditional Chinese | `zh-TW` | 18,564 | 50 | Available |

Additional locales are welcome when they have a real product audience. Use the full-locale creation flow below instead of copying directories by hand.


## Contributing

### Improve Existing Translations

Edit the locale files directly:

- Main UI copy: `zh-CN/zh-CN.json`, `zh-TW/zh-TW.json`
- Dynamic copy: `zh-CN/zh-CN.dynamic.json`, `zh-TW/zh-TW.dynamic.json`
- English source: `.original/en-US.json`, `.original/en-US.dynamic.json`

Preserve placeholders, HTML tags, ICU MessageFormat, URLs, commands, code spans, and backticks. The wording can be more natural; the structure must remain compatible.

### Sync Claude Upstream Changes

GitHub Actions checks Claude Web's upstream locale files every 6 hours. When keys are added, updated, or removed, it updates the `bot/locale-update` branch and writes diffs under `.pending/locale-update`.

Maintainers usually apply the update like this:

```bash
# 1. Generate translation chunks for the target locale
node scripts/locale-update/prepare_translation.mjs --locale zh-CN

# 2. Translate JSONL chunks under .pending/locale-update/translation/<locale>/chunks/
#    Write outputs to the manifest-provided out/ paths
#    Recommended built-in workflow:
#      Claude Code: /apply-locale-update
#      Codex:       /apply-locale-update

# 3. Validate and apply translations
node scripts/locale-update/apply_translation.mjs --locale zh-CN
```

`apply_translation.mjs` validates row counts, key order, placeholders, HTML tags, ICU structure, and obvious untranslated content. On success it rebuilds the target locale packs and clears `.pending/locale-update`.

### Add a New Locale

For a brand-new locale, generate a full translation task first:

```bash
node scripts/create-full-locale/prepare_translation.mjs --locale fr-FR
```

The script reads `.original/en-US*.json`, can use `.original/ja-JP*.json` and existing `zh-CN` as context, and writes chunked work under `.pending/create-full-locale/<locale>/`.

After translating the chunks, run:

```bash
node scripts/create-full-locale/apply_translation.mjs --locale fr-FR
./build.sh
```

On success it writes `<locale>/<locale>.json`, `<locale>/<locale>.dynamic.json`, and appends the locale to `locales.json`.


## Recent Changes

Full history is available in [Releases](https://github.com/Pectics/claude-i18n/releases).

### 1.1.2

- Renamed `statsig`-related language-pack handling to `dynamic` to match Claude Web's current locale structure.

### 1.1.1

- Moved request rewriting from fixed endpoint names to a generic locale transport layer covering query strings, JSON, forms, `URLSearchParams`, and `FormData`.
- Same-origin JSON responses now restore `locale` and `gated_messages.locale` generically.
- Simplified the remote `locales.json` shape to a string array.

### 1.1.0

- Split the runtime into `hook.js`, `script.js`, and `service.js`.
- Switched locale discovery to lazy-loaded remote metadata, and language-pack updates to hash validation plus browser cache.
- Added handling for `/i18n/*.overrides.json`, Dynamic locale packs, and related request paths.


## FAQ

**Does it translate my conversations with Claude?**

Claude i18n only handles Claude Web interface text; prompts, replies, and file content stay in Claude Web's normal flow.

**Will this affect my Claude account?**

The extension coordinates locale handling in the browser. Account settings remain in Claude Web's normal state, and backend-facing requests still fall back to an official locale.

**Why do backend requests fall back to `en-US`?**

Claude's backend does not currently accept extension locales. The fallback prevents profile, bootstrap, and experience requests from failing; the browser then restores the interface locale the user selected.

**Are locale packs updated automatically?**

Yes. The extension checks remote version hashes and downloads fresh packs when hashes change.

**Is the userscript build stable?**

It is experimental. Chrome and Edge users should prefer the store build; Firefox and Safari users can try the userscript and use [userscript/README.md](userscript/README.md) for injection or cache troubleshooting.


## License

[MIT](LICENSE) © 2026 [Pectics](https://github.com/Pectics)


<div align="center">

If you want to support the project, stars, translation fixes, and new-locale contributions all help. Sponsorship is also welcome through the links below.

[![afdian](https://img.shields.io/badge/afdian-946ce6?logo=afdian&logoColor=white)](https://afdian.com/a/Pectics)
[![PayPal](https://img.shields.io/badge/PayPal-142c8e?logo=paypal&logoColor=white)](https://paypal.me/Pectics)

| WeChat Pay | Alipay |
|:---:|:---:|
| <img src="assets/wechat.png" width="160" alt="WeChat Pay QR Code" /> | <img src="assets/alipay.png" width="160" alt="Alipay QR Code" /> |

</div>
