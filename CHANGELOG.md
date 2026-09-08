# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.0.0
