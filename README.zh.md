<div align="center">

<img src="extension/assets/logo.512x.png" width="120" alt="Claude i18n Logo" />

# Claude i18n

**为 [Claude.ai](https://claude.ai) 提供社区驱动的国际化多语言支持。**

[English](README.md) | 简体中文 | [繁體中文](README.tw.md)

[![Release](https://img.shields.io/github/v/release/Pectics/claude-i18n?label=发行版)](https://github.com/Pectics/claude-i18n/releases/latest)
[![License](https://img.shields.io/github/license/Pectics/claude-i18n?label=许可证)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Pectics/claude-i18n/total?label=下载量)](https://github.com/Pectics/claude-i18n/releases/latest)

[![Issues](https://img.shields.io/github/issues/Pectics/claude-i18n?label=议题)](https://github.com/Pectics/claude-i18n/issues)
[![Pull Requests](https://img.shields.io/github/issues-pr/Pectics/claude-i18n?label=拉取请求)](https://github.com/Pectics/claude-i18n/pulls)
[![Locale Update](https://img.shields.io/github/actions/workflow/status/Pectics/claude-i18n/locale-update.yml?label=语言包更新)](https://github.com/Pectics/claude-i18n/actions/workflows/locale-update.yml)
![Vercel Build](https://img.shields.io/github/checks-status/Pectics/claude-i18n/main?label=Vercel%20构建)

| 支持平台 | 支持语言 |
| ---: | :--- |
| [![Chrome](https://img.shields.io/badge/Chrome-4285f4?logo=googlechrome&logoColor=white)](#安装) [![Edge](.github/badges/edge.svg)](#安装) [![Userscript](https://img.shields.io/badge/Userscript-6f42c1?logo=tampermonkey&logoColor=white)](#安装) | [![zh-CN](https://pectics.github.io/claude-i18n/badges/zh-CN.svg)](#支持的语言) [![zh-TW](https://pectics.github.io/claude-i18n/badges/zh-TW.svg)](#支持的语言) [![zh-HK](https://img.shields.io/badge/zh--HK-[WIP]-e5534b)](#支持的语言) |

<!-- locale-stats:summary:start -->
| 当前语言包 | 主语言包 | Dynamic 语言包 | 合计 |
| --- | ---: | ---: | ---: |
| 简体中文 `zh-CN` | 18,999 | 47 | 19,046 |
| 繁體中文 `zh-TW` | 18,564 | 50 | 18,614 |
<!-- locale-stats:summary:end -->

</div>


## 预览

<div align="center">

<img src="assets/showcase-1.jpg" width="720" alt="Claude.ai 中文界面预览" />

<details>
<summary>查看更多截图</summary>
<img src="assets/showcase-2.jpg" width="720" alt="Claude.ai 扩展页面中文界面" />
<img src="assets/showcase-3.jpg" width="720" alt="Claude.ai 付费计划页面中文界面" />
</details>

</div>


## 安装

| 你想怎么用 | 推荐方式 | 入口 |
| --- | --- | --- |
| Chrome / Edge 日常使用 | 应用商店版本 | [Chrome Web Store](https://chromewebstore.google.com/detail/claude-i18n/fkfmbjccelbeolkoekeaegajhhdndajj) / [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/claude-i18n/meogggfdmdeigjpkcpkdhngaegpncgjc) |
| Firefox Desktop 或 macOS Safari | 用户脚本实验版 | [userscript/README.md](userscript/README.md) |
| 手动安装或留档 | Releases 里的 `.crx` | [Releases](https://github.com/Pectics/claude-i18n/releases) |

安装后打开 [Claude.ai](https://claude.ai)，在左下角账号菜单进入语言设置，选择 `zh-CN` 或 `zh-TW` 对应的中文选项即可。

### 应用商店版本

这是最稳妥的分发方式，适合 Chrome 和 Edge 用户。通过商店安装后，浏览器会负责后续更新。

- [Chrome Web Store: Claude i18n](https://chromewebstore.google.com/detail/claude-i18n/fkfmbjccelbeolkoekeaegajhhdndajj)
- [Microsoft Edge Add-ons: Claude i18n](https://microsoftedge.microsoft.com/addons/detail/claude-i18n/meogggfdmdeigjpkcpkdhngaegpncgjc)

### 用户脚本实验版

用户脚本面向非 Chromium 浏览器，目前主要用于 Firefox Desktop 与 macOS Safari。

- Firefox Desktop：推荐 Tampermonkey 或 Violentmonkey；Greasemonkey 为 best-effort 支持。
- macOS Safari：目前只验证过 Safari + Userscripts App。
- 详细安装、调试与限制见 [userscript/README.md](userscript/README.md)。

### 手动安装 `.crx`

1. 在 [Releases](https://github.com/Pectics/claude-i18n/releases) 下载最新 `.crx` 文件。
2. 打开 Chrome / Edge 的 `chrome://extensions/`。
3. 开启右上角的开发者模式。
4. 将 `.crx` 文件拖入扩展页面并确认安装。

### 本地开发

```bash
git clone https://github.com/Pectics/claude-i18n.git
cd claude-i18n
```

在 `chrome://extensions/` 开启开发者模式，选择加载已解压的扩展程序，然后选择 `extension/` 目录。

如果要重新生成托管语言包产物，运行：

```bash
./build.sh
```


## 工作方式

Claude.ai 本来就有多语言加载管线，问题在于它只接受官方 locale。Claude i18n 做的是一层很薄的协调：让页面看见额外 locale，让后端继续收到它认识的 `en-US`，再把缺失的语言文件交给扩展补上。

### 运行链路

1. `hook.js` 在 `document_start` 注入页面主世界，尽早接管语言列表和 `fetch`。
2. 当 Claude.ai 构建官方语言数组时，扩展把远端 `locales.json` 中的额外 locale 追加进去。
3. 当同源应用请求携带 `locale=zh-CN` 或 `locale=zh-TW` 时，请求里的 locale 会回退为 `en-US`，浏览器本地记住用户实际选择的扩展 locale。
4. 当页面请求 `/i18n/*.json` 或 `/i18n/dynamic/*.json` 时，扩展后台按 locale 返回对应语言包。
5. 同源 JSON 响应里的顶层 `locale` 和 `gated_messages.locale` 会在浏览器端恢复成用户选择的扩展 locale。

### 组件分工

| 文件 | 作用 |
| --- | --- |
| `extension/hook.js` | 页面主世界 hook；负责语言列表注入、请求改写、响应恢复和 i18n 请求接管。 |
| `extension/script.js` | 页面与扩展后台之间的消息桥。 |
| `extension/service.js` | 扩展后台；读取远端 manifest、下载语言包、维护缓存。 |
| `locales.json` | 托管端语言列表，当前包含 `zh-CN` 和 `zh-TW`。 |
| `<locale>/<locale>.json` | 主界面语言包。 |
| `<locale>/<locale>.dynamic.json` | Dynamic / `gated_messages` 相关语言包。 |

### 缓存策略

- 语言列表缓存在 `localStorage`，并按远端 manifest 版本定期刷新。
- 语言包版本信息缓存在 `chrome.storage.local`，以 `/version/{locale}.json` 的 hash 为准。
- 语言包正文缓存在 Cache Storage；hash 变化时才重新下载，旧 hash 对应的缓存会被清理。
- `/i18n/*.overrides.json` 当前由扩展返回空对象 `{}`，避免 Claude.ai 对扩展 locale 请求不存在的 overrides 文件。


## 支持的语言

统计来自当前仓库中的语言包文件。

<!-- locale-stats:supported:start -->
| 语言 | Locale | 主语言包 | Dynamic 语言包 | 状态 |
| --- | --- | ---: | ---: | --- |
| 简体中文 | `zh-CN` | 18,999 | 47 | 可用 |
| 繁體中文 | `zh-TW` | 18,564 | 50 | 可用 |
<!-- locale-stats:supported:end -->

欢迎继续补充其他真正有使用场景的 locale。新增语言建议走下方的完整语言创建流程，而不是手工复制目录。


## 参与贡献

### 改进现有翻译

直接编辑对应 locale 文件即可：

- 主界面文案：`zh-CN/zh-CN.json`、`zh-TW/zh-TW.json`
- Dynamic 文案：`zh-CN/zh-CN.dynamic.json`、`zh-TW/zh-TW.dynamic.json`
- 英文原文：`.original/en-US.json`、`.original/en-US.dynamic.json`

请保留占位符、HTML 标签、ICU MessageFormat、URL、命令、代码片段和反引号内容。翻译可以更自然，但结构不能变。

### 同步 Claude 上游更新

仓库的 GitHub Actions 每 6 小时检查一次 Claude.ai 上游语言文件。发现 key 新增、更新或删除时，会更新 `bot/locale-update` 分支，并生成 `.pending/locale-update` 下的差异文件。

每次成功抓取后，GitHub Actions 都会用最新 upstream 快照对比 `main` 中的语言包，并把 `coverage.json` 和预先渲染的 `badges/<locale>.svg` 发布到 GitHub Pages。`bot/locale-update` 中的翻译在合并进 `main` 前不会计入覆盖率。

覆盖率达到 90% 时 badge 显示为绿色，达到 75% 时显示为黄色，低于 75% 时显示为红色；语言包无法读取时则显示灰色 `invalid`。

维护者通常按这个流程处理：

```bash
# 1. 为目标 locale 生成翻译分块
node scripts/locale-update/prepare_translation.mjs --locale zh-CN

# 2. 翻译 .pending/locale-update/translation/<locale>/chunks/ 下的 JSONL
#    输出写到 manifest 指定的 out/ 路径
#    推荐使用项目内置工作流：
#      Claude Code: /apply-locale-update
#      Codex:       /apply-locale-update

# 3. 校验并应用翻译
node scripts/locale-update/apply_translation.mjs --locale zh-CN
```

`apply_translation.mjs` 会校验行数、key 顺序、占位符、HTML 标签、ICU 结构和明显未翻译内容；成功后会重建目标语言包、同步三份 README 的语言包统计，并清理 `.pending/locale-update`。

### 添加全新语言

全新 locale 不再建议手工创建目录。请先生成完整翻译任务：

```bash
node scripts/create-full-locale/prepare_translation.mjs --locale fr-FR
```

脚本会读取 `.original/en-US*.json`，可参考 `.original/ja-JP*.json` 和现有 `zh-CN` 语境，生成 `.pending/create-full-locale/<locale>/` 下的分块任务。

翻译完成后运行：

```bash
node scripts/create-full-locale/apply_translation.mjs --locale fr-FR
./build.sh
```

成功后会写入 `<locale>/<locale>.json`、`<locale>/<locale>.dynamic.json`，并把 locale 追加到 `locales.json`。


## 近期更新

完整历史见 [Releases](https://github.com/Pectics/claude-i18n/releases)。

### 1.1.2

- 将 `statsig` 相关命名迁移为 `dynamic`，适配 Claude.ai 近期语言包结构调整。

### 1.1.1

- 请求改写从固定接口名迁移为通用 locale transport：统一处理 query、JSON、表单、`URLSearchParams` 和 `FormData`。
- 同源 JSON 响应会通用恢复 `locale` 与 `gated_messages.locale`。
- 远端 `locales.json` 简化为字符串数组结构。

### 1.1.0

- 将扩展运行链路拆为 `hook.js`、`script.js`、`service.js` 三层。
- 语言列表改为远端 lazy load，语言包改为 hash 校验与浏览器缓存。
- 补齐 `/i18n/*.overrides.json`、Dynamic 语言包和相关请求链路。


## 常见问题

**它会翻译我和 Claude 的对话吗？**

Claude i18n 只负责界面文案；prompt、回复和文件内容都交给 Claude.ai 原本的流程处理。

**会影响我的 Claude 账号吗？**

扩展在浏览器端协调 locale 处理；账号设置保持 Claude.ai 原有状态。对 Claude 后端来说，请求仍会回退到它支持的官方 locale。

**为什么后端请求要回退到 `en-US`？**

因为 Claude 后端目前不接受扩展 locale。回退可以避免账号资料、启动信息和体验配置请求失败；浏览器端再把界面语言恢复为用户实际选择的 locale。

**语言包会自动更新吗？**

会。扩展会通过远端版本 hash 检查更新，hash 变化时重新下载语言包。

**用户脚本版本稳定吗？**

它是实验性分发路径。Chrome / Edge 用户优先使用扩展商店版本；Firefox 和 Safari 用户可以试用用户脚本，并参考 [userscript/README.md](userscript/README.md) 排查注入时序或缓存问题。


## 许可证

[MIT](LICENSE) © 2026 [Pectics](https://github.com/Pectics)


<div align="center">

如果你想支持这个项目，Star、反馈翻译问题、补充新 locale 都很有帮助。也可以通过下面的方式赞助维护。

[![爱发电](https://img.shields.io/badge/爱发电-946ce6?logo=afdian&logoColor=white)](https://afdian.com/a/Pectics)
[![PayPal](https://img.shields.io/badge/PayPal-142c8e?logo=paypal&logoColor=white)](https://paypal.me/Pectics)

| 微信赞赏 | 支付宝 |
|:---:|:---:|
| <img src="assets/wechat.png" width="160" alt="微信赞赏码" /> | <img src="assets/alipay.png" width="160" alt="支付宝收款码" /> |

</div>
