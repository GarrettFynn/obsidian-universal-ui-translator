# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-09-09

首个公开版本冒烟反馈（BRAT 渠道）后的改进批次。

### Added

- **社区插件市场条目级「译」按钮**（新通道，作用域页可独立开关）：市场条目右上角注入小按钮，点哪条译哪条——不必等整个市场列表自动翻完，缓存命中零 API 成本
- **翻译进度可见**：状态栏在途时显示"剩 N（已译 M）"，队列归零时短暂显示"本会话已译 M 条"
- **缓存落盘兜底**：每 30s 检查——累计 100 条立即落盘，有脏数据时每 5 分钟保底落盘（此前仅 onunload 落盘，崩溃即丢失整段会话译文）；缓存页显示"最后落盘"时间

### Fixed

- **配置变更即时生效，无需重启**：保存配置即重置熔断/负缓存状态，并重扫已渲染界面（此前熔断最长持续 10 分钟、已渲染节点不重译，造成"必须重启"的假象）

## [1.0.3] - 2026-09-09

### Added

- OpenAI 兼容接口新增「关闭思考模式」开关（R-34）：DeepSeek V4 系列等模型**默认开启思考模式**，对 UI 短文本会凭空产生上千 tokens 的推理输出——又慢（触发 30s 超时熔断）又贵（推理 tokens 照价计费）。打开开关后请求体注入 `thinking: {type: "disabled"}`，响应速度与费用恢复正常。冒烟实测：deepseek-v4-flash 默认配置下 598 条文本全超时、消耗数百万 tokens；关闭思考后秒回

## [1.0.2] - 2026-09-09

### Fixed

- 「测试连接」改为真实试译（R-33）：此前 OpenAI 兼容接口只探测 `/models`，Key 有效即报成功，但**模型名错误或账户欠费（402）时翻译会全灭而测试仍显示成功**（DeepSeek 实测：/models 不校验模型与余额）。现在试译一个词，并按 401/402/404/429 给出分类提示
- 翻译失败原因现在会写入 Console（`[uut] 翻译请求失败：…`，每段连续失败只记前 3 条），便于自查，不再需要盲目猜测熔断原因

## [1.0.1] - 2026-09-09

### Fixed

- 命令面板通道的存量扫描延迟到工作区布局就绪后执行。此前启动早期调用 `listCommands()` 会导致部分核心命令（如 `workspace:toggle-stacked-tabs`、`workspace:close-others`）的 checkCallback 抛错（Console 红字），且这些命令被当次过滤漏掉而永远漏译（Obsidian 1.13.7 启动期实测复现）
- 预热扫描同样改为布局就绪后执行
- 性能下界测试阈值按环境区分（本地 100ms / CI 300ms），消除 CI 共享 runner 抖动造成的误报

## [1.0.0] - 2026-09-09

First public release.

### Added

- **Four interception channels**: command palette (core commands included), context menus, settings panels, and a MutationObserver fallback for Notices, the status bar, modals and custom views
- **Five translation providers**: OpenAI-compatible (custom Base URL / local LLMs), DeepL, Google Cloud Translation, Azure Translator, and a fully custom HTTP endpoint (Ollama / LM Studio — zero cost)
- **Local-first cache**: in-memory LRU + on-disk JSON, keyed by text + provider + language + model, with lazy invalidation when the source plugin or Obsidian core updates
- **Three display modes**: translated / bilingual (two formats) / original, switchable anytime, plus a "临时显示原文/恢复译文" command
- **Smart filtering**: skips code, paths, URLs, numbers and already-localized text; placeholder protection with post-translation validation (mismatched placeholders are discarded, never cached)
- **Cost controls**: 100 ms batch aggregation, concurrency limit, configurable per-request timeout, monthly character budget with automatic circuit-breaker, and usage statistics
- **Scope control**: core/community toggles, per-plugin whitelist/blacklist, per-interceptor switches, custom skip-regexes and a user glossary (fixed translations that bypass cache and API)
- **Cache management**: statistics, one-click clear, export/import for sharing translations
- **Privacy by design**: no telemetry, no outbound calls except the configured translation endpoint; API keys encrypted with Electron `safeStorage` (`secrets.bin`, per-machine ciphertext)
- Desktop only (`isDesktopOnly: true`); Obsidian 1.5.0+

[1.1.0]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.1.0
[1.0.3]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.0.3
[1.0.2]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.0.2
[1.0.1]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.0.1
[1.0.0]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.0.0
