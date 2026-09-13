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
- **本地缓存**：内存 LRU + 磁盘 JSON 同一上限（默认 5 万条、可调至 20 万，磁盘另有 64MB 字节硬顶），键含原文 + 引擎 + 语言 + 模型——同一界面二次打开零 API 调用
- **三种显示模式**：纯译文 / 双语对照 / 原文，随时切换，另有「临时显示原文/恢复译文」命令
- **智能过滤**：跳过代码、路径、URL、数字、已本地化文本；占位符保护 + 译后校验（占位符不一致的译文直接丢弃、不进缓存）
- **成本控制**：100ms 批量聚合、并发限制、单请求超时（可配置）、月度字符预算自动熔断
- **用量统计图表（v1.1.9）**：「用量统计」分页按天记录送译条数与输入/输出字符，近 30 天柱状图 + 本月 tokens 与人民币费用估算，花了多少一目了然
- **缓存治理（v1.1.9）**：缓存分页逐项写清"是什么 / 什么时候用 / 代价"——立即落盘、按当前引擎/语言/模型一键清理失效条目、磁盘文件实况、导出/导入共享
- **作用域控制**：核心/社区开关、插件白名单/黑名单、拦截器独立开关、自定义跳过正则与术语表（固定译法优先于缓存与 API）
- **社区插件市场按需翻译（核心功能）**：列表条目与详情面板（README 全文）各有「译」按钮，点哪条译哪条，缓存命中零成本——v1.1.5 起市场默认**不再**自动全量翻译（滚动列表会持续消耗 API），逐条按需是唯一推荐路径
- **费用透明**：设置页逐项标注 API 消耗风险与量级估算（基准：DeepSeek flash 2026-09-10 新定价，人民币口径），用量统计附实时 tokens 与费用折算，月度字符预算超限自动熔断；完整折算模型见下方「费用估算」专节
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
| OpenAI 兼容接口 | **推荐 DeepSeek**：Base URL `https://api.deepseek.com` + 模型 `deepseek-v4.1-flash`，并打开「关闭思考模式」开关；默认 `gpt-4o-mini`；支持自定义 Base URL（如接本地 Ollama：`http://localhost:11434/v1`） |
| DeepL | Free/Pro 端点自动识别（Free 版 Key 以 `:fx` 结尾）；免费档 50 万字符/月 |
| Google Cloud Translation | API Key；语言覆盖最广；免费档 50 万字符/月 |
| Azure Translator | Key + Region；免费档 200 万字符/月 |
| 自定义端点 | URL + 请求体模板 + 响应 JSONPath——Ollama / LM Studio / 任意本地模型，零成本 |

典型成本：**接近零**——各厂商免费额度足以覆盖界面文本量；本地模型仅费电。付费引擎下的精确估算见下节。

![设置面板](docs/screenshots/settings-tabs.png)

### 费用估算（以 DeepSeek flash 为基准，2026-09-10 新定价）

DeepSeek flash 系列自 2026-09-10 12:00（北京时间）起的定价（每百万 tokens）：

| | 空闲时段 | 高峰时段（= 空闲 × 2） |
| --- | --- | --- |
| 输入（缓存命中） | ¥0.02 | ¥0.04 |
| 输入（缓存未命中） | ¥1 | ¥2 |
| 输出 | ¥4 | ¥8 |

**折算模型**（界面文本 → tokens）：输入 tokens ≈ 英文字符数 / 4；输出 tokens ≈ 字符数 / 2.5（中文译文 1 token ≈ 1.5 汉字、长度约为原文 60%）。即**每 1 万字符界面 ≈ 2,500 输入 + 4,000 输出 tokens → 高峰约 ¥0.037，空闲半价**。

**每个动作花多少钱**（高峰 / 空闲）：

| 动作 | 字符量 | tokens（入+出） | 费用 |
| --- | --- | --- | --- |
| 市场列表单条目「译」（条目右上角按钮） | ≈150 | 38 + 60 | < ¥0.001，可忽略 |
| 插件详情 README「译」（详情区顶端按钮） | ≈4,000 | 1,000 + 1,600 | ≈ ¥0.015 / ¥0.007 |
| 核心界面全量（一次性，之后走缓存） | ≈8 万 | 2 万 + 3.2 万 | ≈ ¥0.30 / ¥0.15 |
| 市场全列表自动翻译（默认关闭的高风险开关） | ≈30 万/轮 | 7.5 万 + 12 万 | ≈ ¥1.1 / ¥0.55 每轮 |

**token 耗费速率**：批量聚合窗口 100ms + 并发 3；一键翻译整篇 README（≈2,600 tokens）通常 2–5 秒完成。界面翻译不是持续流量——本地缓存命中即零请求，只有"第一次见到"的文本才消耗 tokens。

**怎么用到接近零成本**：① 译文本地缓存，同一内容永不再发请求；② 设置页「月度字符预算」超限自动熔断；③ 术语表命中的词条不走 API；④ 用 Ollama 本地模型则完全免费、数据不出本机。

### 用量统计与缓存管理（v1.1.9）

**「用量统计」分页**（设置 → Universal UI Translator）回答"我到底调用了多少 API、烧了多少 tokens"：

- **本月汇总**：送译条数、输入/输出字符、估算 tokens（入/出分列）、按 DeepSeek 基准价折算的人民币费用（高峰/空闲双口径）
- **近 30 天柱状图**：每天一根堆叠条（下=输入、上=输出 tokens 估算），鼠标悬停查看当天精确数值；另有「今日 / 近 7 日」摘要
- **口径说明**：tokens 由字符数折算（输入 ≈ 字符/4、输出 ≈ 字符/2.5），仅量级参考、非账单口径；**缓存命中与术语表命中不消耗 API、不计入此统计**；逐日明细自 v1.1.9 起记录（usage.json 向后兼容扩展，日桶保留近 62 天，月度预算判定口径不变）

**「缓存」分页功能速查**（设置页内每个功能均为"是什么 / 什么时候用 / 代价"三段式说明）：

| 功能 | 是什么 | 什么时候用 |
| --- | --- | --- |
| 启用本地缓存 | 译文持久化到 translation-cache.json，同一文本只付一次费 | 只有排查翻译异常时才需要关 |
| 缓存条目上限 | 内存=磁盘同一容量（默认 5 万，可调 1000–20 万；磁盘另有 64MB 硬顶），超出淘汰最久未用条目 | 市场 README 翻得多就往宽设——纯文本不占空间，上限太低会提前淘汰译文、重复消耗 API；调小立即生效 |
| 缓存统计 | 条数、命中率、磁盘文件实际大小、最后落盘时间 | 命中率越高越省钱 |
| 立即落盘 | 新译文先在内存，每 30 秒检查一次（满 100 条或满 5 分钟）才写盘；点此立即写入磁盘 | 翻完一大批 README 后、关机/重启 Obsidian 前点一下；崩溃/强杀只会丢"上次落盘以来"的新译文，正常退出不受影响 |
| 清理失效条目 | 删除与当前「引擎+语言+模型」不匹配的条目（缓存键含这三维，换模型后旧条目永不命中，纯占空间） | 换过模型/引擎/目标语言之后点一次；v1.1.9 前的旧条目无模型标记，只能按引擎+语言判定 |
| 清空缓存 | 删除全部缓存译文并重置界面译态 | 译文异常（如嵌套乱码）排查、换术语表后重来；⚠️ 之后全部界面重译一遍（核心界面 ≈ ¥0.30 以内） |
| 导出 / 导入 | 缓存与库根目录 JSON 文件互转（FR-12） | 换机迁移、把译文词表分享给他人（对方导入后零成本复用） |

### 免费额度教程：火山方舟「协作奖励计划」（每天用多少、次日返多少）

火山引擎方舟平台的协作奖励计划：**授权推理接入点 → 当天产生的 token 用量，次日 11 点后以等额免费资源包形式返还，自动抵扣账单**——先记账、后抵扣，最终 0 元。个人实名账号单模型每日返还上限 50 万 tokens（本插件核心界面全量翻译一次性仅约 5 万 tokens，之后全部走缓存，日常用量远低于此上限）。

**为什么说它特别适合本插件**：奖励计划的交换条件是"授权接入点的对话数据被匿名采集用于模型优化"。而本插件送译的**只有界面文本**——按钮、设置项、插件市场里的英文 README——不含你的任何笔记与隐私内容，采集代价在这个场景下几乎没有实际影响。

**接入步骤**：

1. 注册[火山引擎](https://www.volcengine.com/)并完成实名认证（个人实名即可参加）
2. 打开[协作奖励计划页](https://ark.volcengine.com/region:cn-beijing/openManagement/rewardPlan)，按页面指引为 Doubao-Seed 系列模型的推理接入点授权（首次授权还有一次性的冷启动免费包）
3. 在火山方舟控制台创建 API Key
4. 打开 Obsidian **设置 → Universal UI Translator → API 配置**：
   - 翻译引擎选 **OpenAI 兼容接口**
   - **Base URL 填**：`https://ark.cn-beijing.volces.com/api/v3`
   - **API Key 填**：上一步创建的密钥
   - **模型填**：`doubao-seed-2-1-turbo-260628`
   - 打开 **「关闭思考模式」** 开关（本插件会按火山方舟规范注入 `thinking: disabled`——UI 短文本无需推理，关掉更快、更省 tokens）
   - 点「测试连接」，成功后即可使用
5. 次日 11 点后到方舟控制台 **资源中心 → 资源包管理** 核对奖励包到账与抵扣情况

**注意事项（官方规则的踩坑点）**：

- **奖励按接入点授权统计**：若控制台为你分配了接入点 ID（形如 `ep-xxxx`），把模型框改填该接入点 ID 更稳妥；填了**未授权**的接入点 = 不采集也不返还，直接扣余额
- **不是调用时免费**：调用当先生成账单挂账，次日奖励包到账后自动抵扣——账户建议预留少量余额，防止单日用量超上限后欠费停机、API 报错
- **奖励包 30 天有效**，过期清零；多个奖励包并存时优先消耗快过期的
- **额度性质是抵扣券**：只抵扣在线推理的输入/输出/缓存命中 token 费用（正是本插件的调用类型）；批量推理、知识库等费用不适用
- **隐私边界**：授权接入点收发的文本会被匿名采集且**不可撤回**。本插件只发送界面文本，风险极低；但请**不要把这个 Key 复用到处理私密内容的其他工具**——那种场景建议另建一个不授权的接入点，各走各的

### 安全与隐私

- 无遥测、无分析、无外发请求（除你配置的翻译端点）
- API Key 经 Electron `safeStorage`（操作系统钥匙串）加密存储为 `secrets.bin`，**密文只能在本机解密**——请勿将该文件纳入 Obsidian Sync / git 同步；换机后按设置页提示重新输入即可
- 翻译缓存存于本地插件目录，可自由导出/导入
- 所有原型劫持均做特征检测、可独立开关，并在卸载时完整还原（含实例级补丁）

### 已知限制

- **不支持 Canvas/WebGL 渲染文本**（如 Excalidraw 画布、Graph 关系图）
- **不支持 WebWorker / iframe 内文本**
- **用户内容一律不译**：笔记编辑器、阅读视图、文件名（文件管理器、标签页标题、快速切换器）、大纲、标签、悬浮预览、嵌入笔记、搜索摘录
- **插件黑名单的边界**：命令/菜单/设置通道严格生效；DOM 兜底通道无法识别文本归属，黑名单插件的自定义视图仍可能被翻译（可用跳过正则补充）
- **仅桌面端**（`isDesktopOnly: true`），本版本不支持移动端

### 开发

```bash
npm install
npm run build          # tsc 类型检查 + esbuild（刻意不做 minify）
npm test               # 159 个单元与集成测试
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
- **Local-first cache**: in-memory LRU + on-disk JSON under one shared cap (default 50k entries, adjustable up to 200k; 64 MB on-disk byte ceiling), keyed by text + provider + language + model — opening the same UI twice issues zero API calls
- **Three display modes**: translated / bilingual (translation with original in brackets) / original, switchable anytime, plus a "临时显示原文/恢复译文" command
- **Smart filtering**: skips code, paths, URLs, numbers and already-localized text; placeholder protection with post-translation validation (mismatched placeholders are discarded, never cached)
- **Cost controls**: 100 ms batch aggregation, concurrency limit, per-request timeout (configurable), monthly character budget with automatic circuit-breaker
- **Usage dashboard (v1.1.9)**: the "用量统计" tab records daily call counts and input/output characters — a 30-day bar chart plus monthly token & cost estimates make spending obvious at a glance
- **Cache governance (v1.1.9)**: the cache tab explains every action in a what/when/cost format — manual flush, one-click purge of entries that no longer match the current provider/language/model, on-disk file size, export/import sharing
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
| OpenAI-compatible | Recommended: DeepSeek — Base URL `https://api.deepseek.com` + model `deepseek-v4.1-flash` with "关闭思考模式" toggled ON; default `gpt-4o-mini`; custom Base URL supported (e.g. `http://localhost:11434/v1` for Ollama) |
| DeepL | Free/Pro endpoint auto-detected (free keys end with `:fx`); 500k chars/month free |
| Google Cloud Translation | API key; broadest language coverage; 500k chars/month free |
| Azure Translator | Key + region; 2M chars/month free |
| Custom endpoint | URL + request template + response JSONPath — Ollama / LM Studio / any local model, zero cost |

Typical cost: **zero** — the free tiers of all major providers cover UI-text volumes, and local models cost only electricity.

### Usage stats & cache management (v1.1.9)

- The **用量统计 (Usage)** tab answers "how much API have I actually used": monthly totals (calls, input/output characters, estimated tokens and cost in CNY on the DeepSeek price basis), a 30-day stacked bar chart (hover any bar for exact figures), and today / last-7-day summaries. Tokens are character-based estimates (input ≈ chars/4, output ≈ chars/2.5), not billing figures; **cache and glossary hits cost no API calls and are not counted**. Daily detail is recorded from v1.1.9 onward (usage.json stays backward-compatible; day buckets are kept for 62 days; monthly-budget accounting is unchanged).
- The **缓存 (Cache)** tab documents every action in a what / when-to-use / cost format:
  - **缓存条目上限** — one shared memory+disk capacity (default 50k entries, adjustable 1k–200k; 64 MB disk byte ceiling). Translations are plain text and cheap to keep: set it wide so marketplace README translations are not evicted early and re-billed.
  - **立即落盘 (Flush now)** — new translations live in memory and are written to disk on a 30 s check (at ≥100 pending entries or after 5 min), plus a forced flush on clean unload. Click it after a big README batch or before shutting down/restarting Obsidian; a crash only loses translations since the last flush (≤5 min).
  - **清理失效条目 (Purge stale entries)** — deletes cache entries that no longer match your current provider + language + model. The cache key embeds all three, so after switching models the old entries can never hit again and only waste space. Entries written before v1.1.9 carry no model marker and are judged by provider + language only.
  - **清空缓存 (Clear)** — wipes all cached translations and resets the UI translation state; everything retranslates once on next view (core UI ≈ ¥0.30).
  - **导出 / 导入 (Export / Import)** — move the cache to/from a JSON file in the vault root for migration or sharing; the recipient reuses your translations at zero API cost.

### Security & privacy

- No telemetry, no analytics, no outbound requests except the translation endpoint **you** configure
- API keys are encrypted via Electron `safeStorage` (the OS keychain) and stored as `secrets.bin`. The ciphertext **can only be decrypted on the same machine** — do **not** sync `secrets.bin` across devices (Obsidian Sync / git). If decryption fails (e.g. after syncing to a new machine), re-enter the key in settings
- The translation cache lives locally in the plugin directory and can be exported/imported by you
- All prototype hooks are feature-detected, individually switchable, and fully restored on unload (including instance-level patches)

### Known limitations

- **Canvas / WebGL rendered text** (e.g. Excalidraw canvas, Graph view) cannot be intercepted
- **WebWorker / iframe content** is out of reach by design
- **User content is never translated**: note editor, reading view, file names (explorer, tab titles, quick switcher), outline, tags, hover previews, embedded notes, and search excerpts
- **Blacklist boundary**: strictly honored in command/menu/settings channels; the DOM fallback cannot attribute text to a plugin, so a blacklisted plugin's custom views may still be translated (use skip-regexes as a supplement)
- **Desktop only** (`isDesktopOnly: true`); mobile is not supported in this release

### Development

```bash
npm install
npm run build          # tsc type-check + esbuild (deliberately not minified)
npm test               # 159 unit & integration tests
npm run test:coverage  # core modules 75.9%–100% line coverage
```

### License

MIT — see [LICENSE](LICENSE).
