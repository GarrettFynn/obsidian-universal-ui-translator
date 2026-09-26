/**
 * en 英文覆盖包（1.4 国际化一期设计第四节）：键集与 zh-CN 完全一致
 * （tests/i18n.test.ts 双向断言）。UI 英语从简；「译」按钮字形为 TR（设计 4.2）。
 */
export const en: Record<string, string> = {
  // —— 主入口 Notice ——
  "notice.migrate-v115":
    "UUT v1.1.5: The community market no longer auto-translates by default (that toggle never took effect, and scrolling the market list kept consuming API quota).",
  "notice.migrate-v115-hint":
    "Use the per-item Translate button in the market (free on cache hit); to enable auto-translation, turn it on under Settings → Scope",
  "notice.key-decrypt-failed":
    "UUT: A saved API key failed to decrypt on this device. Please re-enter it in the settings",
  "notice.auth-failed": "UUT: The API key may be invalid (401/403). Check the API settings",
  "notice.budget-exceeded":
    "UUT: Monthly character budget exhausted; translation paused and originals restored. Adjust the monthly budget under Settings → API to continue",
  "notice.circuit-open":
    "UUT: Translation service kept failing; paused automatically for 10 minutes (see settings)",
  "notice.setup-required": "UUT: Configure a translation engine and API key in the settings first",
  "notice.original-on":
    "UUT: Switched to original text (new content is no longer written back; the cache keeps warming)",
  "notice.original-off": "UUT: Translations restored",

  // —— 命令名 / 命令通道 ——
  "command.toggle-original": "Toggle original/translated text",
  "command.patcher.disabled":
    "UUT: Command channel translation disabled (addCommand signature check failed)",
  "command.patcher.list-unavailable":
    "app.commands.listCommands unavailable; existing commands left to the DOMPatcher fallback",
  "command.patcher.activated":
    "CommandPatcher activated (addCommand hooking ready; existing scan awaits layout ready)",
  "command.patcher.swept": "CommandPatcher patched {n} existing commands",
  "command.patcher.patch-failed": "Failed to patch command (skipped): {n}",

  // —— 菜单通道 ——
  "menu.patcher.disabled": "UUT: Menu channel translation disabled (addItem signature check failed)",
  "menu.patcher.activated": "MenuPatcher activated",

  // —— 设置面板通道 ——
  "setting.patcher.disabled":
    "UUT: Settings panel channel translation disabled (Setting signature check failed)",
  "setting.patcher.activated": "SettingPatcher activated",

  // —— DOM 兜底通道 ——
  "dom.patcher.disabled":
    "UUT: DOM fallback channel translation disabled (MutationObserver unavailable)",
  "dom.patcher.activated": "DOMPatcher activated, watching {n} documents",
  "dom.patcher.adopted": "DOMPatcher adopted a new document",

  // —— 市场通道（按钮/徽标/消息）——
  "market.activated": "MarketplacePatcher activated",
  "market.adopted": "MarketplacePatcher adopted a new document",
  "market.button.glyph": "TR",
  "market.button.title-item": "Translate this plugin entry",
  "market.button.title-detail":
    "Translate this plugin's full description (README); Chinese UI text is skipped automatically at zero cost",
  "market.injected": "MarketplacePatcher injected {n} buttons",
  "market.notify.display-mode":
    "UUT: 'Show original text' mode is on — translations are cached but not written back; run the command 'Toggle original/translated text' to restore",
  "market.notify.budget":
    "UUT: Monthly character budget exhausted, translation paused (Settings → API to adjust the budget)",
  "market.notify.circuit":
    "UUT: Translation failing repeatedly, circuit breaker active (auto-recovery in ~10 minutes); saving the settings once resets it immediately",
  "market.notify.no-provider":
    "UUT: No translation engine or API key configured. Please finish setup in the settings",
  "market.notify.negative-cache": "UUT: This text just failed; no auto-retry within 5 minutes",
  "market.error.unknown": "unknown error",
  "market.progress.label": "UUT translating {n}/{m}",
  "market.progress.done": "UUT ✓ done",
  "market.progress.ended": "UUT finished",

  // —— 状态栏 ——
  "status.today-tokens": "UUT today {n} tok",
  "status.rate-chars": "▲ {n} chars/min · ",
  "status.circuit-countdown": "UUT circuit {n}:{m}",
  "status.translating": "UUT translating… {n} left ({m} done)",
  "status.session-done": "UUT ✓ {n} translated this session",
  "status.cache-purged": "Purged {n} cache entries mismatched with the current engine/language/model",
  "status.flush-failed": "Flush failed: {n}",
  "status.just-now": "just now",
  "status.cache-exported": "Cache exported to vault root: {n}",
  "status.import-bad-json": "Import failed: not a valid JSON file",
  "status.import-schema-unsupported":
    "Import failed: unsupported schemaVersion (supported ≤ {n}) or missing entries",
  "status.import-done": "Import done: {n} cache entries merged",

  // —— 通用（core / 装配层错误说明与日志）——
  "common.timeout-request": "Translation request",
  "common.log-key-save-failed": "[uut] Failed to save key: ",
  "common.log-translate-failed": "[uut] Translation request failed: {n}",
  "common.purge-no-engine":
    "No translation engine configured; cannot determine the current config, nothing purged",
  "common.no-engine-or-key": "No translation engine or API key configured",
  "common.provider-not-configured": "Provider not configured",
  "common.placeholder-rewritten": "Translation placeholders were rewritten",

  // —— Settings tab (batch 4: 163 entries + UI-language setting; keys mirror zh-CN 1:1) ——
  "settings.tab.general": "General",
  "settings.tab.api": "API",
  "settings.tab.usage": "Usage",
  "settings.tab.scope": "Scope",
  "settings.tab.cache": "Cache",
  "settings.tab.advanced": "Advanced",

  "settings.provider.openai": "OpenAI-compatible",
  "settings.provider.deepl": "DeepL",
  "settings.provider.google": "Google Cloud Translation",
  "settings.provider.azure": "Azure Translator",
  "settings.provider.custom": "Custom endpoint (local model)",

  "settings.cost-basis":
    "Cost basis: DeepSeek flash new pricing (since 2026-09-10) per million tokens: off-peak input ¥1 / output ¥4, peak time doubled; API-side cache-hit input only ¥0.02–0.04",

  "settings.usage.cost-zero": "≈ 0 tokens, ¥0",
  "settings.usage.cost-tokens": "{total} tokens (in {in} / out {out})",
  "settings.usage.cost-low": "≈ {tokens}, cost < ¥0.01 (half price off-peak)",
  "settings.usage.cost-high": "≈ {tokens}, peak ≈ ¥{yuan} (half price off-peak)",

  "settings.general.enable": "Enable UI translation",
  "settings.general.enable.desc":
    "Master switch; interceptors stay inactive while no usable engine is configured (design doc 4.4.2). Zero API cost while off; while on, API usage scales with rendered UI (per-channel scale notes on the Scope tab)",
  "settings.general.display-mode": "Display mode",
  "settings.general.display-mode.desc":
    "⚠️ Bilingual mode writes back longer text — LLM output tokens are about 2x pure translation (output unit price is higher); translation-only is cheapest",
  "settings.general.display-mode.replace": "Translation only",
  "settings.general.display-mode.bilingual": "Bilingual",
  "settings.general.display-mode.original": "Original (paused)",
  "settings.general.bilingual-format": "Bilingual format",
  "settings.general.bilingual-format.desc":
    "Applies in bilingual mode only; no API impact (layout of the written-back text only)",
  "settings.general.bilingual-format.t-first": "Translation (original)",
  "settings.general.bilingual-format.o-first": "Original | Translation",
  "settings.general.target-lang": "Target language",
  "settings.general.target-lang.desc":
    "e.g. zh-CN / zh-Hant / ja (language is part of the cache key; switches don't interfere)",
  "settings.general.ui-lang": "Plugin UI language",
  "settings.general.ui-lang.desc":
    "Follow Obsidian's UI language or pin Chinese/English; registration-time strings such as command names apply after restart; already rendered third-party UI is not retranslated",
  "settings.general.ui-lang.auto": "Follow Obsidian",
  "settings.general.ui-lang.zh": "Chinese",
  "settings.general.ui-lang.en": "English",

  "settings.api.engine": "Translation engine",
  "settings.api.key.desc.encrypted":
    "Stored encrypted via safeStorage in secrets.bin; not written to data.json (4.4.1)",
  "settings.api.key.desc.plain":
    "System-level encryption unavailable; the Key is stored obfuscated in secrets.bin — do not sync that file (4.4.1 fallback)",
  "settings.api.key.status": " | Key status: {s}",
  "settings.api.key.status.saved": "saved",
  "settings.api.key.status.unsaved": "not saved",
  "settings.api.key.placeholder.saved": "Saved — enter a new Key to overwrite",
  "settings.api.key.placeholder.empty": "Enter to encrypt and save",
  "settings.api.base-url.desc": "Can point to a local model, e.g. http://localhost:11434/v1",
  "settings.api.model": "Model",
  "settings.api.model.desc": "Default gpt-4o-mini (low-cost tier)",
  "settings.api.disable-thinking": "Disable thinking mode",
  "settings.api.disable-thinking.desc":
    "Recommended for models like DeepSeek V4 that enable “thinking” by default: short UI texts need no reasoning; turning it off is faster and saves tokens",
  "settings.api.price": "Token price (per million)",
  "settings.api.price.desc":
    "Format input/output, e.g. 2/8 (per your model's listed pricing). Once set, the status bar and usage page show cost estimates as measured tokens × price; leave empty to disable. Display only; does not affect the budget breaker",
  "settings.api.price.notice-enabled": "UUT: cost estimation enabled (visible in status bar and usage page)",
  "settings.api.region.desc": "e.g. eastasia",
  "settings.api.custom.endpoint": "Endpoint URL",
  "settings.api.custom.endpoint.desc": "e.g. http://localhost:11434/v1/chat/completions",
  "settings.api.custom.model": "Model name",
  "settings.api.custom.request-template": "Request body template",
  "settings.api.custom.request-template.desc":
    "Placeholders {{text}} {{targetLang}} {{model}}; leave empty for the OpenAI-compatible template",
  "settings.api.custom.response-path": "Response path",
  "settings.api.custom.response-path.desc": "Dot-separated path, e.g. choices.0.message.content; empty for default",
  "settings.api.connectivity": "Connectivity test",
  "settings.api.connectivity.desc":
    "Sends one test request to the current engine (negligible cost: a short text is a few dozen tokens, < ¥0.001 at basis price)",
  "settings.api.connectivity.button": "Test connection",
  "settings.api.usage": "Usage",
  "settings.api.monthly-usage.desc":
    "Sent {usage} chars this month (persisted in usage.json). {basis}; estimated cost this month {cost} (order-of-magnitude reference)",
  "settings.api.budget": "Monthly character budget",
  "settings.api.budget.desc":
    "Hard gate against accidental spend: over limit, translation pauses and the UI falls back to originals (4.5 breaker). Strongly recommended for paid engines; empty = unlimited. Scale reference: core UI ≈ 50–100k chars one-shot; full community market ≈ 300k chars per round",
  "settings.api.budget.placeholder": "unlimited",

  "settings.scope.note":
    "Recommended usage — the community market has two “TR” buttons: (1) the left list: the top-right corner of each entry translates that entry's name + description (about 150 chars, well under 0.1 cent); (2) the right detail pane: the “TR” button at the very top of the detail area translates the plugin's full README (thousands of chars ≈ 2,600 tokens, about 1.5 cents at peak price, half off-peak). Both are cached once translated; repeat clicks are free. Most English content you read is plugin descriptions — the “TR” button covers it without turning on the auto-translate switches below.",
  "settings.scope.core": "Translate Obsidian core UI",
  "settings.scope.core.desc":
    "Low risk: core UI text is fixed (≈ 50–100k chars), one-shot cost ≈ within ¥0.30 at basis price (half off-peak), zero after caching. Channels: core commands (settings panel / DOM fallback technically cannot attribute UI to core vs community plugins; not controlled by this switch)",
  "settings.scope.community": "Translate community plugin UI",
  "settings.scope.community.desc":
    "⚠️ High risk (API usage): visible entries in the community browser get auto-translated; scrolling keeps sending; full market ≈ 300k chars/round (≈ ¥1.1 peak, ≈ ¥0.55 off-peak at basis), re-triggered while the page stays open — off by default since v1.1.5; prefer per-entry “TR” buttons. Channels: community plugin commands, market browser auto-translation (settings panel / DOM fallback cannot attribute plugins; not controlled by this switch)",
  "settings.scope.interceptors": "Per-interceptor switches",
  "settings.scope.interceptors.desc":
    "Disable a channel when it misbehaves (D1 breaker manual entry). Per-channel API scale in each note",
  "settings.scope.ic.command": "Command palette",
  "settings.scope.ic.command.risk": "Low risk: command list is fixed, prewarmed once at startup, zero after caching",
  "settings.scope.ic.menu": "Menus",
  "settings.scope.ic.menu.risk": "Low risk: menu items are short and repetitive; cache hit rate usually >90%",
  "settings.scope.ic.setting": "Settings panels",
  "settings.scope.ic.setting.risk": "Low risk: each plugin's setting texts are fixed; cached after the first pass",
  "settings.scope.ic.dom": "DOM fallback",
  "settings.scope.ic.dom.risk":
    "⚠️ Medium risk: global MutationObserver; dynamic UI (status bar, popups, custom views) keeps sending; Notice/popups are no longer translated when off",
  "settings.scope.ic.market": "Market “TR” buttons",
  "settings.scope.ic.market.risk":
    "✅ Recommended: zero automatic cost — button locations: entry top-right corner in the list + very top of the detail pane after opening an entry; translates on click only, free on repeat cache hits; on failure the button turns red × with the exact reason (budget exceeded / breaker active / network error), no longer silent since v1.1.8",
  "settings.scope.whitelist": "Plugin whitelist",
  "settings.scope.whitelist.desc":
    "When non-empty, only these plugins are translated (one plugin id per line). ⚠️ Reserved in the current version; not yet effective",
  "settings.scope.blacklist": "Plugin blacklist",
  "settings.scope.blacklist.desc":
    "Commands of these plugins are not translated (includes this plugin by default). ⚠️ Command channel only in the current version; settings panel / DOM fallback cannot attribute plugins",
  "settings.scope.installed-ids": "Installed plugin ids (reference)",

  "settings.cache.enable": "Enable local cache",
  "settings.cache.enable.desc":
    "What: translations persist to translation-cache.json in the plugin folder — each text costs API once and survives Obsidian restarts. When to turn off: only while troubleshooting translation issues. ⚠️ While off, every render re-calls the API and the same UI repeatedly spends quota",
  "settings.cache.max-entries": "Cache entry limit",
  "settings.cache.max-entries.desc":
    "What: shared by memory and disk (default 50000, range 1000–200000; disk also has a 64MB byte cap, first-come first-trimmed); oldest entries evicted beyond it. When to adjust: market README translations add many entries; a low limit evicts early and re-spends API next time — translations are plain text and small, set generously. Trade-off: a bigger cache loads longer at startup (milliseconds) and uses more memory. Changes apply immediately; lowering evicts the oldest entries right away",
  "settings.cache.disk-absent": "Disk file not created yet",
  "settings.cache.disk-size": "Disk file ≈ {mb} MB",
  "settings.cache.last-flush": "Last flush {time}",
  "settings.cache.flush-pending":
    "Not flushed this session (checked every 30s; auto-flush after 100 entries or 5 minutes; or click “Flush now” below)",
  "settings.cache.stats": "Cache stats",
  "settings.cache.stats.desc":
    "Entries {n} (memory=disk same cap) | hit rate {rate}% (this session — the higher, the more served by the local cache and the cheaper) | {size} | {flush}",
  "settings.cache.flush-now": "Flush now",
  "settings.cache.flush-now.desc":
    "What: new translations stay in memory; every 30 seconds the plugin checks — after 100 new entries or 5 minutes since the last flush it writes the disk file; forced on normal unload/vault close. When to click: after translating many market READMEs, or before shutting down/restarting Obsidian, to persist new translations immediately. If you don't: a crash/force-kill loses translations since the last flush (up to 5 minutes); normal exit is unaffected. Zero API cost",
  "settings.cache.purge-stale": "Purge stale entries",
  "settings.cache.purge-stale.desc":
    "What: removes cache entries mismatching the current “engine + target language + model” — the cache key includes all three; after switching models or engines, old entries never hit again, pure dead weight. When to click: once after changing model/engine/target language. Note: entries written before v1.1.9 lack the model marker and are judged by engine+language only. Zero API cost",
  "settings.cache.clear": "Clear cache",
  "settings.cache.clear.desc":
    "What: deletes all cached translations (memory+disk) and resets translations shown on screen (R-07 linkage). When: translations misbehave (e.g. nested garble), or after changing the glossary and wanting a full re-translation. ⚠️ Cost: after clearing, all UI re-translates via API on next open (at basis price: core UI ≈ within ¥0.30, half off-peak)",
  "settings.cache.clear.notice": "UUT: cache cleared; UI translations will be re-translated on next access",
  "settings.cache.export": "Export cache",
  "settings.cache.export.desc":
    "What: exports the full cache to universal-ui-translator-cache-export.json in the vault root. When: migrating computers, or sharing your accumulated translations — the importer reuses them with zero API cost (FR-12). Zero API cost",
  "settings.cache.export.button": "Export",
  "settings.cache.import": "Import cache",
  "settings.cache.import.desc":
    "What: merges entries from a cache JSON file into the local cache (validates schemaVersion and entry structure; rejects invalid files). When: migrating back, or receiving a shared translation glossary. Zero API cost",
  "settings.cache.import.button": "Import",
  "settings.cache.import.no-file": "UUT: select a cache JSON file first",

  "settings.usage.basis": "Billing basis",
  "settings.usage.basis.token.desc":
    "Current engine (OpenAI-compatible) bills by token: since v1.3 the usage field returned by the API is captured directly (billing basis, incl. per-request system prompt overhead); the status bar keeps a “rate · today · cost” segment (toggle on the Advanced tab). Switching engines falls this page back to the character basis",
  "settings.usage.basis.chars.desc":
    "Current engine bills by characters (DeepL/Google/Azure): token figures are character-based estimates (input ≈ chars/4, output ≈ chars/2.5), order-of-magnitude reference",
  "settings.usage.month": "This month",
  "settings.usage.month.desc":
    "Sent {calls} entries | input {inChars} chars ≈ {inTok} tokens | output {outChars} chars ≈ {outTok} tokens | estimated cost {cost}. Month total sent {total} chars (same basis as the monthly budget, persisted in usage.json). Daily details recorded since v1.1.9; earlier history has month totals only",
  "settings.usage.card.session-tokens": "Session tokens (measured)",
  "settings.usage.card.session-calls": "Session entries",
  "settings.usage.card.session-calls.value": "{n} entries / {chars} chars",
  "settings.usage.card.rate1": "Last 1 min",
  "settings.usage.card.rate5": "Last 5 min",
  "settings.usage.card.rate-chars.value": "{n} chars/min",
  "settings.usage.card.peak": "Session peak",
  "settings.usage.card.today-tokens": "Today tokens (measured)",
  "settings.usage.card.today-cost": "Today cost (≈{currency})",
  "settings.usage.card.month-cost": "Month cost (≈{currency})",
  "settings.usage.card.month-calls": "Entries this month",
  "settings.usage.card.in-tokens": "Input tokens (est.)",
  "settings.usage.card.out-tokens": "Output tokens (est.)",
  "settings.usage.card.cost": "Estimated cost",
  "settings.usage.chart.title": "Last 30 days ({basis})",
  "settings.usage.chart.basis-token": "tokens measured",
  "settings.usage.chart.basis-est": "tokens estimated",
  "settings.usage.chart.toggle-chars": "chars estimate",
  "settings.usage.chart.bar-title":
    "{date}: {calls} calls\ninput {inChars} chars / measured {inTok} tokens\noutput {outChars} chars / measured {outTok} tokens",
  "settings.usage.legend.in": "Input tokens ({basis})",
  "settings.usage.legend.out": "Output tokens ({basis})",
  "settings.usage.legend.actual": "measured",
  "settings.usage.legend.est": "estimated",
  "settings.usage.today-week": "Today / last 7 days",
  "settings.usage.today-week.desc":
    "Today: {todayCalls} entries, measured {todayTok} tokens | last 7 days: {weekCalls} entries, measured {weekTok} tokens (estimated {weekEst})",
  "settings.usage.basis-note": "Basis notes",
  "settings.usage.basis-note.desc":
    "Since v1.3 the OpenAI-compatible channel records the real usage returned by the API (billing basis, incl. per-request system prompt overhead); “estimated” derives from character counts (input ≈ chars/4, output ≈ chars/2.5), serving historical data and non-token-billed engines. {basis}. Cache hits and glossary hits consume no API and are excluded here; the monthly budget basis remains characters",
  "settings.usage.split-low": "< ¥0.01 (half off-peak)",
  "settings.usage.split-high": "peak ≈ ¥{peak} (off-peak ≈ ¥{off})",

  "settings.advanced.skip-patterns": "Skip rules (regex)",
  "settings.advanced.skip-patterns.desc":
    "One regex per line; matched text is not sent (4.2.1 rule 1). Reduces unnecessary API usage; zero own cost",
  "settings.advanced.glossary": "Glossary (fixed translations)",
  "settings.advanced.glossary.desc":
    "One per line: source=translation; hits return directly, bypassing cache and API (FR-15) — savings: glossary hits cost nothing",
  "settings.advanced.batch-window": "Batch aggregation window (ms)",
  "settings.advanced.batch-window.desc":
    "Default 100, configurable 50–500 (4.2.2). Identical texts within the window dedupe into one request — larger windows slightly reduce duplicate requests; no effect on total character usage",
  "settings.advanced.max-concurrent": "Max concurrent requests",
  "settings.advanced.max-concurrent.desc":
    "Default 3 to avoid API rate limits (4.2.2). ⚠️ Raising it saves no money (total chars unchanged), it only affects speed; rate limiting may instead cost extra via retries",
  "settings.advanced.timeout": "Request timeout (ms)",
  "settings.advanced.timeout.desc":
    "Default 30000 (R-23: raise for slow engines); configurable 5000–120000 (4.2.2). Timed-out requests count as failed: sent characters are usually still billed",
  "settings.advanced.debug": "Debug mode",
  "settings.advanced.debug.desc": "Console interception logs. Purely local, zero API cost",

  // —— Provider error messages (batch 5: 33 entries, resolved via t() at message-construction time) ——
  "provider.http-not-injected": "HttpClient not injected",
  "provider.request": "request",
  "provider.timeout": "{label} timed out ({ms}ms)",
  "provider.connect-probe-ok": "Connected (probe: {n})",
  "provider.validate-failed": "Connection test failed: {n}",
  "provider.azure.count-mismatch": "Azure response count does not match the request",
  "provider.azure.missing-translation": "Azure response item {n} is missing translations[0].text",
  "provider.azure.empty-response": "Empty response; check the Key and Region",
  "provider.custom.name": "Custom endpoint",
  "provider.custom.empty-response": "Empty response; check the response path setting",
  "provider.custom.path-no-text": "Custom response: no translation extracted at path {path}",
  "provider.deepl.count-mismatch": "DeepL response translations count does not match the request",
  "provider.deepl.missing-text": "DeepL response item {n} is missing text",
  "provider.deepl.usage-ok": "Connected (DeepL usage query works)",
  "provider.deepl.network-error": "Network error: {n}",
  "provider.deepl.http-status": "HTTP {n}: check the API Key",
  "provider.google.count-mismatch": "Google response translations count does not match the request",
  "provider.google.missing-text": "Google response item {n} is missing translatedText",
  "provider.google.empty-response": "Empty response; check the API Key",
  "provider.openai.name": "OpenAI-compatible",
  "provider.openai.batch-index-misaligned": "Batch response indices are misaligned",
  "provider.openai.batch-line-invalid": "Batch response line format invalid: {n}",
  "provider.openai.batch-count-mismatch": "Batch response line count mismatch ({seen}/{total})",
  "provider.openai.missing-content": "OpenAI response is missing choices[0].message.content",
  "provider.openai.auth-failed": "API key invalid or expired (401/403)",
  "provider.openai.insufficient-balance": "Insufficient balance (402); top up or renew at the provider console",
  "provider.openai.model-not-found": "Model not found (404): check the model name \"{model}\"",
  "provider.openai.rate-limited": "Rate limited (429); retry later",
  "provider.openai.connect-ok": "Connected (model: {model}, probe: {probe})",

  // —— Batch-3 leftover pickups (scanner ≤2-line dedup misses; batch-5 master ruling) ——
  "notice.key-save-failed": "UUT: Failed to save key: {n}",
  "status.today-chars": "UUT today {n} chars",
  "status.cache-flushed": "Cache flushed ({time}), {n} entries in total",
  "status.export-failed": "Export failed: {n}",
  "market.log.translate-error": "[uut] Market \"TR\" button translation error: {n}",
  "market.notify.failed": "UUT: Translation request failed ({reason}); skipped automatically. Retry later",

  // —— Target language switch notice (batch 5) ——
  "notice.lang.switched":
    "UUT: Target language switched (caches are isolated per language; switching back costs nothing)",
};
