<div align="center">

<img src="extension/assets/logo.512x.png" width="120" alt="Claude i18n Logo" />

# Claude i18n

**给 Claude.ai 加上一个并不存在的语言。**

简体中文 | [繁體中文](README.tw.md) | [English](README.en.md)

[![Version](https://img.shields.io/badge/版本-v1.1.2-orange?style=flat-square)](https://github.com/Pectics/claude-i18n/releases)
[![License](https://img.shields.io/badge/许可证-MIT-blue?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/平台-Chrome%20%7C%20Edge%20%7C%20Tampermonkey-brightgreen?style=flat-square)](#安装)
[![Locale](https://img.shields.io/badge/已支持-简体中文-red?style=flat-square)](#支持的语言)

</div>

---

## 它能做什么？

Claude 官方至今不支持简体中文界面。**这个扩展解决了这个问题。**

安装后，Claude Web 的语言菜单里会出现 **中文（中国）** 选项。点一下，超过 15,000 条 UI 文本瞬间切换为中文。不需要代理，不需要配置，不需要等 Anthropic 哪天心情好了才支持。

<div align="center">

<img src="assets/showcase-1.jpg" width="720" alt="主页面" />

<details>
<summary>点击查看更多截图</summary>
<img src="assets/showcase-2.jpg" width="720" alt="扩展页面" />
<img src="assets/showcase-3.jpg" width="720" alt="付费计划页面" />
</details>

</div>

---

## 安装

### 方式一：应用商店安装（推荐）

> ⚡ 30 秒搞定，无需任何技术知识

- Chrome Web Store：
  [Claude i18n](https://chromewebstore.google.com/detail/claude-i18n/fkfmbjccelbeolkoekeaegajhhdndajj)
- Microsoft Edge Add-ons：
  [Claude i18n](https://microsoftedge.microsoft.com/addons/detail/claude-i18n/meogggfdmdeigjpkcpkdhngaegpncgjc)

### 方式二：用户脚本（实验性）

> 🧪 面向 Firefox Desktop 与 macOS Safari Userscripts 的实验性版本

非 Chromium 系列浏览器用户可以试用用户脚本版本。Firefox 推荐使用 [`userscript/claude-i18n.user.js`](userscript/claude-i18n.user.js) + Tampermonkey / Violentmonkey；Greasemonkey 为 best-effort 实验支持。Safari 可试用 [`userscript/claude-i18n.safari.user.js`](userscript/claude-i18n.safari.user.js)，目前仅验证 macOS Safari + Userscripts App。

1. 在 Firefox Desktop 安装 Tampermonkey、Violentmonkey 或 Greasemonkey
2. 或在 macOS Safari 安装 Userscripts App，并允许访问 `claude.ai`
3. 按浏览器选择对应的 `.user.js` 脚本并保存
4. 打开 [claude.ai](https://claude.ai)，点击左下角用户名 → 语言 → **中文（中国）** ✓

详细说明见 [`userscript/README.md`](userscript/README.md)。

### 方式三：从 Releases 下载

1. 前往 [Releases 页面](https://github.com/Pectics/claude-i18n/releases)，下载最新版本的 `.crx` 文件
2. 打开 Chrome / Edge，进入 `chrome://extensions/`
3. 打开右上角的 **开发者模式**
4. 将下载的 `.crx` 文件**直接拖进**浏览器窗口
5. 点击「添加扩展程序」确认安装
6. 打开 [claude.ai](https://claude.ai)，点击左下角用户名 → 语言 → **中文（中国）** ✓

### 方式四：从源码构建

```bash
git clone https://github.com/Pectics/claude-i18n.git
cd claude-i18n
```

然后在 `chrome://extensions/` 中打开**开发者模式**，选择「加载已解压的扩展程序」，选择项目的 `extension/` 目录。

---

## 它是怎么工作的？

Claude 的后端接口仍然不接受 `zh-CN` 这种扩展 locale。这个扩展在前端模拟支持了 `zh-CN`，并在实际请求中把后端部分统一回退为 `en-US`，再在浏览器端把语言状态和语言包替换回扩展 locale。

```
你点击「中文」
        ↓
hook.js 在 document_start + MAIN world 提前注入
        ↓
Claude Web 构建官方语言数组时，扩展把远端 locales.json 里的扩展语言追加进去
        ↓
PUT / GET /api/account_profile、bootstrap、experience 等接口按规则回退为 en-US
        ↓
GET /i18n/*.json、/i18n/dynamic/*.json 命中扩展语言后，交给扩展后台处理
        ↓
后台先查本地缓存，再按 /version/{locale}.json 的 hash 决定是否更新语言文件
        ↓
返回 zh-CN 主语言包与 dynamic 语言包
        ↓
UI 按 Claude 自己的语言流程切换为中文
```

当前实现分成三层：

- `hook.js`：运行在页面主世界，负责 Array 代理、`fetch` 拦截，以及 `account_profile` / `bootstrap` / `experience` / `i18n` 这些关键请求的改写。
- `script.js`：负责页面和扩展后台之间的桥接通信。
- `service.js`：负责访问远端 Vercel 站点、读取 `/locales.json` 和 `/version/{locale}.json`，并维护本地缓存。

**缓存策略：**

- 扩展语言列表：先读 `localStorage` 中缓存的 `locales.json`，再 lazy load 远端版本；只有版本或内容变化时才替换本地缓存。
- 语言文件版本信息：存放在 `chrome.storage.local`，按 locale 记录最近一次 `/version/{locale}.json` 的 hash。
- 语言文件正文：存放在 `Cache Storage`，只有 hash 变化时才重新下载对应的 `*.json` / `*.dynamic.json` 文件。
- `/i18n/*.overrides.json`：当前直接由扩展返回空对象 `{}`。

---

## 支持的语言

| 语言 | 条目数量 | 状态 |
|------|----------|------|
| 中文（中国） (zh-CN) | 15,058 条 | ✅ 可用 |
| 更多语言 | — | 欢迎贡献 |

---

## 参与贡献

### 更新语言包（同步上游）

当 Claude.ai 上游新增、修改或删除 UI key 时，CI 会每 6 小时自动拉取最新 `.original/` 文件并生成差异 PR。PR 合并前，需要手动完成翻译：

```bash
# 1. 为 zh-CN 准备翻译任务（生成分块 JSONL）
node scripts/locale-update/prepare_translation.mjs --locale zh-CN

# 2. 翻译 .pending/locale-update/translation/zh-CN/chunks/ 下的分块文件
#    推荐使用项目内置的翻译工作流 Skill：
#      Claude Code:  /offline-chunk-translation
#      Codex:        /offline-chunk-translation
#    Skill 会自动读取 chunk、翻译、写入 out/ 目录，并校验占位符/ICU/标签完整性
#    手动翻译也可：每个 chunk 是 JSONL，每行 { key, en, ja, op }，输出加 "zh" 字段

# 3. 校验并应用翻译结果
node scripts/locale-update/apply_translation.mjs --locale zh-CN
```

三个脚本的职责：
- `build_diff.mjs`：对比新旧 `.original/` 生成 key 差异（add / update / remove）
- `prepare_translation.mjs`：将差异拆分为可控大小的翻译分块
- `apply_translation.mjs`：校验翻译完整性（占位符、URL、HTML 标签等），合并回 `zh-CN/zh-CN.json`

### 改进翻译

主界面翻译位于 [`zh-CN/zh-CN.json`](zh-CN/zh-CN.json)。如果是 `gated_messages` / Dynamic 相关文案，请编辑 [`zh-CN/zh-CN.dynamic.json`](zh-CN/zh-CN.dynamic.json)。

原文主包对照在 [`.original/en-US.json`](.original/en-US.json)。

直接编辑 JSON 文件提 PR 即可，结构非常简单：

```json
{
  "some.ui.key": "对应的中文翻译"
}
```

### 添加新语言

1. 在 [`locales.json`](locales.json) 的 `locales` 数组中追加 locale 字符串（如 `"zh-TW"`）
2. 创建对应目录和两个翻译文件：
   `zh-TW/zh-TW.json`
   `zh-TW/zh-TW.dynamic.json`
3. 运行 `./build.sh`，确认会生成：
   `dist/locales.json`
   `dist/zh-TW/version.json`
4. 提交 PR

---

## 更新日志

### 1.1.2

- 全局替换 `statsig` 关键字为 `dynamic` 以适配 Claude.ai 的最新重构

### 1.1.1

- 将扩展 locale 的请求改写逻辑从按路径特判，重构为按协议形状匹配：统一检查 query 中的 `locale` 与请求 body 中的 `locale`
- 通用 body 改写链路现已支持 `application/json`、`application/x-www-form-urlencoded`、`URLSearchParams` 与 `FormData`
- same-origin JSON 响应会统一回写顶层 `locale` 与 `gated_messages.locale`，不再依赖 `account_profile`、`bootstrap`、`experiences` 等固定接口名
- 将远端 `locales.json` 简化为纯字符串数组结构，并同步调整构建与扩展侧的 lazy cache 读取逻辑

### 1.1.0

- 重构扩展运行链路为 `hook.js`、`script.js`、`service.js` 三层，分别负责页面拦截、桥接通信与后台缓存
- 扩展 locale 的后端请求统一回退为 `en-US`，并在 `account_profile`、`bootstrap/app_start` 等响应里恢复为扩展 locale
- 扩展语言列表改为从远端 `/locales.json` lazy load，并缓存到 `localStorage`
- 语言文件改为通过 `/version/{locale}.json` 做 hash 校验，版本信息存 `chrome.storage.local`，正文存 `Cache Storage`
- 补齐 `experiences/claude_web`、`/i18n/*.overrides.json` 等请求链路兼容处理

### 1.0.2

- 跟进 Claude Web 最近的前端逻辑更新，恢复自定义语言切换能力
- 调整 page hook 注入方式，避免 runtime i18n store 因时序问题捕获失败
- 兼容新版 `gated-messages` 请求链路，防止切换到扩展语言时被 404 HTML 响应中断
- 增加坏缓存自清理逻辑，旧的无效 HTML 响应不会再长期污染语言包缓存

### 1.0.1

- 前端逆向成功，打通 Claude Web 运行时语言覆盖入口
- 语言切换变为无刷新即时生效，整体体验明显更顺滑
- 菜单注入、运行时切换、语言包拦截与本地缓存链路正式闭环

### 1.0.0

- 初始 MVP 版本发布
- 在 Claude Web 语言菜单中注入简体中文入口
- 提供基础中文语言包分发、请求拦截与浏览器端加载能力

---

## 常见问题

**切换语言后没有效果？** \
确认扩展已启用，然后刷新 claude.ai 页面。

**会影响我的 Claude 账号吗？** \
不会。扩展只在浏览器端工作，不修改任何账号设置或与 Anthropic 服务器交互（除了正常的语言包拉取）。

**切换回英文还能正常用吗？** \
完全没问题。在语言菜单选择任意官方支持的语言，扩展会自动退出中文模式。

**语言包会自动更新吗？** \
会。扩展通过版本哈希检测远端更新，有新版本时自动下拉最新语言包。

---

## 许可证

[MIT](LICENSE) © 2026 [Pectics](https://github.com/Pectics)

---

<div align="center">

如果这个扩展帮到了你，可以请我喝杯咖啡 ☕ \
或者……点个 ⭐，也是莫大的支持。

[![爱发电](https://img.shields.io/badge/爱发电-Pectics-946ce6?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMTUgMjUgMTMwIDExMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTY1IDkwLjdjLTEuNiAwLTIuOCAxLjMtMi44IDIuOCAwIDEuNiAxLjMgMi44IDIuOCAyLjhzMi44LTEuMyAyLjgtMi44YzAtMS42LTEuMy0yLjgtMi44LTIuOFoiIGZpbGw9IndoaXRlIi8+PHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik05MS44IDk5LjJjMS42IDAgMi44IDEuMyAyLjggMi44IDAgMS42LTEuMyAyLjgtMi44IDIuOC0xLjYgMC0yLjgtMS4zLTIuOC0yLjggMC0xLjYgMS4zLTIuOCAyLjgtMi44WiIgZmlsbD0id2hpdGUiLz48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTEzNC42IDk4LjRjMi41IDEuNSA2LjUgNC4xIDUuMSA4LjctLjUgMS43LTEuNyAzLjEtMy40IDQtMCAwLS4xLjEtLjEuMS0yLjIgMS4xLTUuMSAxLjItNy43LjMtLjgtLjMtMS42LS41LTIuNS0uOC0uNi0uMi0xLjItLjQtMS44LS42LTEuOSAzLjEtNS44IDYuNS0xMS4zIDkuNC05LjkgNS4yLTI0LjggOC42LTQyIDQuOC0xMy4yLTIuOS0yMS45LTguMy0yNS44LTE2LTMuMS02LjEtMi40LTEyLjMtLjgtMTYuMSAxLjUtMy4xIDUuNy03LjEgMTAuOS0xMS4zLTEuMy0xLjUtMi41LTMuNC0yLjQtNS4zIDAtMS42LjgtMi45IDIuMi0zLjggMy41LTIuNCA4LjItLjUgMTEuMSAxLjIgMS43LTEuMSAzLjMtMi4zIDQuOS0zLjMtMS4xLS40LTIuNy0uOC00LjctMS03LS43LTI1LjMtNC0zMS43LTYuOEMxOC45IDU1LjMgMTkuMSA0Ny44IDIwLjcgNDMuOWMyLjgtNi45IDE4LjEtMTEgMjUuMS0xMC44IDMuNC4xIDUuNCAxLjEgNi4xIDMuMSAxLjMgMy40LTIuNiA1LjMtNy43IDcuNy0xLjMuNi0yLjggMS40LTQuMyAyLjEgNy4xLjYgMTcuNy4yIDI1LjYtLjEgNi44LS4zIDEzLjItLjUgMTguNy0uNCAxOS4xLjQgMzQuMiA4LjQgNDQuNiAyMy43IDYuOCAxMCA0LjggMjAuMSAxLjcgMjcuOSAxLjQuMSAyLjcuNSA0IDEuNFpNNjEgNzYuNmMtMS4xLS40LTIuMi0uNi0yLjgtLjUuMi40LjcgMSAxLjIgMS42LjUtLjQgMS0uOCAxLjYtMS4yWm03Mi44IDI5LjhjLjUtLjMuNy0uNS44LS45LjItLjYtLjctMS4zLTIuNi0yLjQtMS40LS45LTIuOS0xLTUuMi0uNi0uMSAwLS4yIDAtLjMgMC0uMSAwLS4xIDAtLjIgMC0zLjUuMy02LjItMi45LTYuOC0zLjYtLjktMS4yLS43LTIuOC40LTMuOCAxLjEtLjkgMi44LS43IDMuOC40LjMuNC44LjggMS4yIDEuMSAzLjQtNy40IDUuNS0xNS45LS40LTI0LjUtOS42LTE0LjEtMjIuOC0yMS00MC40LTIxLjQtNS4zLS4xLTExLjcuMS0xOC40LjQtMTUuNi42LTI2LjcuOS0zMi45LTEuMS0uMS0wLS4xLS4xLS4yLS4xLTEuOC0uNi0zLjItMS4zLTQuMi0yLjMtMS0xLjEtMS0yLjguMS0zLjggMS4xLTEuMSAyLjgtMSAzLjguMS4xLjEuMy4yLjUuMyAyLjQtMi4xIDUuOS0zLjggOS4xLTUuNC4zLS4yLjctLjMgMS4xLS41LTIuNy4zLTYuMyAxLjEtMTAgMi41LTQuNyAxLjgtNi45IDMuNy03LjMgNC45LTIgNSA3IDkuNSAxMSAxMS4yIDUuNSAyLjQgMjIuNyA1LjYgMzAuMSA2LjQgNC43LjUgNy42IDEuOSA5LjMgMyA1LTMuMiA4LjktNS41IDEwLjEtNi4yIDEuMi0uOCAyLjktLjMgMy42LjlzLjMgMi45LS45IDMuN2MtMTQuMyA4LjQtMzYuNyAyMy4zLTM5LjggMjkuNy0xLjEgMi41LTEuNiA3IC43IDExLjUgMy4xIDYuMSAxMC44IDEwLjcgMjIuMiAxMy4yIDI1LjMgNS41IDQzLjItNS43IDQ3LjMtMTEuNC0uNC0uMy0uOC0uNy0xLjEtMS0uOS0xLjItLjctMi45LjUtMy43IDEuMi0uOSAyLjktLjcgMy43LjUuNS43IDMuNCAxLjUgNSAyIC45LjMgMS44LjYgMi43LjkgMS4zLjQgMi42LjQgMy42LS4xWiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=)](https://afdian.com/a/pectics)
[![PayPal](https://img.shields.io/badge/PayPal-Pectics-142c8e?style=flat-square&logo=paypal&logoColor=white)](https://paypal.me/Pectics)

| 微信赞赏 | 支付宝 |
|:---:|:---:|
| <img src="assets/wechat.png" width="160" alt="微信赞赏码" /> | <img src="assets/alipay.png" width="160" alt="支付宝收款码" /> |
</div>
