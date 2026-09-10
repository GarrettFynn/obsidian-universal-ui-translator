# Universal UI Translator

**用自己的翻译 API 翻译 Obsidian 核心与社区插件界面。**
**Translate Obsidian core and community plugin UI with your own translation API.**

[中文](#中文) · [English](#english)

[![GitHub release](https://img.shields.io/github/v/release/GarrettFynn/obsidian-universal-ui-translator)](https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases)
[![Build](https://github.com/GarrettFynn/obsidian-universal-ui-translator/actions/workflows/release.yml/badge.svg)](https://github.com/GarrettFynn/obsidian-universal-ui-translator/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![双语命令面板](docs/screenshots/bilingual-command-palette.png)

---

## 中文

> 第一次接触 Obsidian？推荐阅读面向新手的详细图文说明：[docs/使用说明.md](docs/使用说明.md)

### 这是什么

Obsidian 社区插件生态以英文为主，汉化依赖插件作者自觉。本插件是一个**界面文本中间件**：拦截 Obsidian 核心与社区插件输出的界面文本，调用**你自己配置**的翻译 API 完成翻译，再按你的偏好写回界面——无需等待插件作者汉化。

插件本体**不含任何翻译引擎或词库**，翻译质量与成本由你选择的 API 决定。

### 功能特性

- **四条拦截通道**：命令面板（含核心命令）、右键菜单、设置面板、MutationObserver 全局兜底（Notice、状态栏、Modal、自定义视图）
- **五种翻译引擎**：OpenAI 兼容接口（含自定义 Base URL / 本地模型）、DeepL、Google Cloud Translation、Azure Translator、自定义 HTTP 端点（Ollama / LM Studio，零成本）
- **本地缓存**：内存 LRU + 磁盘 JSON，键含原文 + 引擎 + 语言 + 模型——同一界面二次打开零 API 调用
- **三种显示模式**：纯译文 / 双语对照 / 原文，随时切换，另有「临时显示原文/恢复译文」命令
- **智能过滤**：跳过代码、路径、URL、数字、已本地化文本；占位符保护 + 译后校验（占位符不一致的译文直接丢弃、不进缓存）
- **成本控制**：100ms 批量聚合、并发限制、单请求超时（可配置）、月度字符预算自动熔断、用量统计
- **作用域控制**：核心/社区开关、插件白名单/黑名单、拦截器独立开关、自定义跳过正则与术语表（固定译法优先于缓存与 API）
- **社区插件市场按需翻译**：条目右上角「译」按钮，点哪条译哪条，缓存命中零成本——不必等全列表翻完
- **目标语言任意**：默认简体中文，可填 `ja` / `zh-Hant` / `ko` / `fr` 等任意语言代码；缓存按语言隔离，随时切换互不影响
- **配置热生效**：改配置即重置熔断并全量重扫界面，无需重启；缓存自动落盘（100 条或 5 分钟），崩溃不丢译文
- **隐私优先**：无遥测、无外发请求（除你配置的翻译端点）；API Key 经 safeStorage 加密

### 安装

- **官方社区插件目录**（审核通过后）：设置 → 第三方插件 → 社区插件 → 搜索「Universal UI Translator」
- **BRAT（beta 渠道）**：安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件 → 「Add Beta plugin」→ 粘贴本仓库地址
- **手动安装**：将 `main.js`、`manifest.json`、`styles.css` 复制到 `<库>/.obsidian/plugins/universal-ui-translator/`

### 配置

1. 打开 **设置 → Universal UI Translator → API 配置** 页
2. 选择引擎并填入 API Key（加密存储于 `secrets.bin`，绝不写入 `data.json`）
3. 点击「测试连接」——成功后拦截层自动激活

| 引擎 | 说明 |
| --- | --- |
| OpenAI 兼容接口 | 默认 `gpt-4o-mini`；支持自定义 Base URL（如接本地 Ollama：`http://localhost:11434/v1`） |
| DeepL | Free/Pro 端点自动识别（Free 版 Key 以 `:fx` 结尾）；免费档 50 万字符/月 |
| Google Cloud Translation | API Key；语言覆盖最广；免费档 50 万字符/月 |
| Azure Translator | Key + Region；免费档 200 万字符/月 |
| 自定义端点 | URL + 请求体模板 + 响应 JSONPath——Ollama / LM Studio / 任意本地模型，零成本 |

典型成本：**零**——各厂商免费额度足以覆盖界面文本量；本地模型仅费电。

![设置面板](docs/screenshots/settings-tabs.png)

### 安全与隐私

- 无遥测、无分析、无外发请求（除你配置的翻译端点）
- API Key 经 Electron `safeStorage`（操作系统钥匙串）加密存储为 `secrets.bin`，**密文只能在本机解密**——请勿将该文件纳入 Obsidian Sync / git 同步；换机后按设置页提示重新输入即可
- 翻译缓存存于本地插件目录，可自由导出/导入
- 所有原型劫持均做特征检测、可独立开关，并在卸载时完整还原（含实例级补丁）

### 已知限制

- **不支持 Canvas/WebGL 渲染文本**（如 Excalidraw 画布、Graph 关系图）
- **不支持 WebWorker / iframe 内文本**
- **用户内容一律不译**：笔记编辑器、阅读视图、文件名（文件管理器与标签页标题）、大纲、标签、悬浮预览、嵌入笔记、搜索摘录
- **仅桌面端**（`isDesktopOnly: true`），本版本不支持移动端

### 开发

```bash
npm install
npm run build          # tsc 类型检查 + esbuild（刻意不做 minify）
npm test               # 121 个单元与集成测试
npm run test:coverage  # 核心模块行覆盖率 75.9%–100%
```

### 许可证

MIT，见 [LICENSE](LICENSE)。

---

## English

### What it does

Obsidian's community plugin ecosystem is mostly English-only, and localization depends on each plugin author. Universal UI Translator is a **UI text middleware**: it intercepts interface text from Obsidian core and community plugins, orchestrates translation through a translation API **you configure**, and writes results back to the UI — no waiting for plugin authors to localize.

The plugin ships **no translation engine or glossary of its own**. Translation quality and cost are determined by the API you choose; the plugin only standardizes interception, orchestration, caching, and write-back.

### Features

- **Four interception channels**: command palette (including core commands), context menus, settings panels, and a MutationObserver fallback for Notices, the status bar, modals and custom views
- **Five translation providers**: OpenAI-compatible (incl. custom Base URL / local LLMs), DeepL, Google Cloud Translation, Azure Translator, and a fully custom HTTP endpoint (Ollama / LM Studio — zero cost)
- **Local-first cache**: in-memory LRU + on-disk JSON, keyed by text + provider + language + model — opening the same UI twice issues zero API calls
- **Three display modes**: translated / bilingual (translation with original in brackets) / original, switchable anytime, plus a "临时显示原文/恢复译文" command
- **Smart filtering**: skips code, paths, URLs, numbers and already-localized text; placeholder protection with post-translation validation (mismatched placeholders are discarded, never cached)
- **Cost controls**: 100 ms batch aggregation, concurrency limit, per-request timeout (configurable), monthly character budget with automatic circuit-breaker, and usage statistics
- **Scope control**: core/community toggles, per-plugin whitelist/blacklist, per-interceptor switches, custom skip-regexes and a user glossary (fixed translations that bypass cache and API)
- **On-demand marketplace translation**: a "译" button on each community-plugin item translates just that entry — cache hits cost zero API calls
- **Any target language**: defaults to `zh-CN`; set `ja` / `zh-Hant` / `ko` / `fr` or any language code — the cache is keyed per language, switch anytime
- **Hot-applied settings**: config changes reset the circuit breaker and rescan the rendered UI instantly — no restart needed; cache auto-flushes to disk (at 100 entries or every 5 min), crash-safe
- **Privacy by design**: no telemetry, no outbound calls except your configured translation endpoint; API keys encrypted with Electron `safeStorage`

### Installation

- **Community plugin directory** (once approved): Settings → Community plugins → Browse → search "Universal UI Translator"
- **BRAT (beta channel)**: install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin → "Add Beta plugin" → paste this repository's URL
- **Manual**: copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/universal-ui-translator/`

### Configuration

1. Open **Settings → Universal UI Translator → API 配置**
2. Pick a provider and enter your API key (encrypted and stored in `secrets.bin`, never in `data.json`)
3. Click **测试连接** — on success, interception activates automatically

| Provider | Notes |
| --- | --- |
| OpenAI-compatible | Default `gpt-4o-mini`; custom Base URL supported (e.g. `http://localhost:11434/v1` for Ollama) |
| DeepL | Free/Pro endpoint auto-detected (free keys end with `:fx`); 500k chars/month free |
| Google Cloud Translation | API key; broadest language coverage; 500k chars/month free |
| Azure Translator | Key + region; 2M chars/month free |
| Custom endpoint | URL + request template + response JSONPath — Ollama / LM Studio / any local model, zero cost |

Typical cost: **zero** — the free tiers of all major providers cover UI-text volumes, and local models cost only electricity.

### Security & privacy

- No telemetry, no analytics, no outbound requests except the translation endpoint **you** configure
- API keys are encrypted via Electron `safeStorage` (the OS keychain) and stored as `secrets.bin`. The ciphertext **can only be decrypted on the same machine** — do **not** sync `secrets.bin` across devices (Obsidian Sync / git). If decryption fails (e.g. after syncing to a new machine), re-enter the key in settings
- The translation cache lives locally in the plugin directory and can be exported/imported by you
- All prototype hooks are feature-detected, individually switchable, and fully restored on unload (including instance-level patches)

### Known limitations

- **Canvas / WebGL rendered text** (e.g. Excalidraw canvas, Graph view) cannot be intercepted
- **WebWorker / iframe content** is out of reach by design
- **User content is never translated**: note editor, reading view, file names (explorer and tab titles), outline, tags, hover previews, embedded notes, and search excerpts
- **Desktop only** (`isDesktopOnly: true`); mobile is not supported in this release

### Development

```bash
npm install
npm run build          # tsc type-check + esbuild (deliberately not minified)
npm test               # 121 unit & integration tests
npm run test:coverage  # core modules 75.9%–100% line coverage
```

### License

MIT — see [LICENSE](LICENSE).
