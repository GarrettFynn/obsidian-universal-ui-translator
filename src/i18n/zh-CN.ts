/**
 * zh-CN 键源（1.4 国际化一期设计第四节）：
 * 值逐字取自源码字面量，对账基线 = spikes/spike-4-i18n-inventory/inventory.json
 * （批次三范围：marketplace-patcher 20 + main.ts 26 + 其余 interceptors 12 + core 4，共 62 条 → 56 键）。
 * - 含标点与全半角，逐字一致，禁止顺手改写（中文零回归硬验收线）；
 * - 模板字面量条目的 ${...} 槽位改为 {n}/{m} 占位（字面片段逐字保留），经 t(key, vars) 插值还原；
 * - status.rate-chars 保留源码字面量的尾随空格（inventory 文本经扫描器空白归一化，见 scan.mjs）。
 * 批次五追加：provider.*（inventory 33 条 + 扫描器 ≤2 行去重漏收 10 处）、批次三遗留补抽 6 键、
 * notice.lang.switched（唯一新撰文案）。
 */
export const zhCN: Record<string, string> = {
  // —— 主入口 Notice ——
  "notice.migrate-v115":
    "UUT v1.1.5：社区市场默认不再自动翻译（此前该开关实际未生效，滚动市场列表会持续消耗 API 额度）。",
  "notice.migrate-v115-hint":
    "逐条翻译请用市场条目上的「译」按钮（缓存命中零成本）；确需自动翻译请到 设置 → 作用域 手动打开",
  "notice.key-decrypt-failed": "UUT：已保存的 API Key 在本机解密失败，请在设置页重新输入",
  "notice.auth-failed": "UUT：API Key 可能失效（401/403），请检查设置页 API 配置",
  "notice.budget-exceeded":
    "UUT：本月字符预算已用完，翻译已暂停并回退原文；如需继续请到 设置页 → API 配置 调整月度预算",
  "notice.circuit-open": "UUT：翻译服务连续失败，已自动暂停 10 分钟（详见设置页）",
  "notice.setup-required": "UUT：请先在设置页配置翻译引擎与 API Key",
  "notice.original-on": "UUT：已切换为原文显示（新渲染内容不再回写；缓存继续预热）",
  "notice.original-off": "UUT：已恢复译文显示",

  // —— 命令名 / 命令通道 ——
  "command.toggle-original": "临时显示原文/恢复译文",
  "command.patcher.disabled": "UUT：命令通道翻译已停用（addCommand 特征检测失败）",
  "command.patcher.list-unavailable":
    "app.commands.listCommands 不可用，存量命令留待 DOMPatcher 兜底",
  "command.patcher.activated":
    "CommandPatcher 已激活（addCommand 增量劫持就绪；存量扫描待布局就绪）",
  "command.patcher.swept": "CommandPatcher 存量 patch {n} 条",
  "command.patcher.patch-failed": "patch 命令失败（已跳过）: {n}",

  // —— 菜单通道 ——
  "menu.patcher.disabled": "UUT：菜单通道翻译已停用（addItem 特征检测失败）",
  "menu.patcher.activated": "MenuPatcher 已激活",

  // —— 设置面板通道 ——
  "setting.patcher.disabled": "UUT：设置面板通道翻译已停用（Setting 特征检测失败）",
  "setting.patcher.activated": "SettingPatcher 已激活",

  // —— DOM 兜底通道 ——
  "dom.patcher.disabled": "UUT：DOM 兜底通道翻译已停用（MutationObserver 不可用）",
  "dom.patcher.activated": "DOMPatcher 已激活，观察 {n} 个 document",
  "dom.patcher.adopted": "DOMPatcher 纳管新 document",

  // —— 市场通道（按钮/徽标/消息）——
  "market.activated": "MarketplacePatcher 已激活",
  "market.adopted": "MarketplacePatcher 纳管新 document",
  "market.button.glyph": "译",
  "market.button.title-item": "翻译此插件条目",
  "market.button.title-detail":
    "翻译此插件的详细介绍（README 全文）；中文界面文本自动跳过、零消耗",
  "market.injected": "MarketplacePatcher 注入 {n} 个按钮",
  "market.notify.display-mode":
    "UUT：当前处于「临时显示原文」模式——译文已进缓存但不回写界面；执行命令「临时显示原文/恢复译文」恢复",
  "market.notify.budget": "UUT：本月字符预算已用完，翻译已暂停（设置页 → API 配置可调整预算）",
  "market.notify.circuit":
    "UUT：翻译服务连续失败、熔断保护中（约 10 分钟自动恢复）；到设置页保存一次配置可立即重置",
  "market.notify.no-provider": "UUT：未配置翻译引擎或 API Key，请到设置页完成配置",
  "market.notify.negative-cache": "UUT：该文本刚刚失败过，5 分钟内不再自动重试",
  "market.error.unknown": "未知错误",
  "market.progress.label": "UUT 翻译中 {n}/{m}",
  "market.progress.done": "UUT ✓ 已完成",
  "market.progress.ended": "UUT 已结束",

  // —— 状态栏 ——
  "status.today-tokens": "UUT 今日 {n} tok",
  "status.rate-chars": "▲ {n} 字/min · ",
  "status.circuit-countdown": "UUT 熔断中 {n}:{m}",
  "status.translating": "UUT 翻译中… 剩 {n}（已译 {m}）",
  "status.session-done": "UUT ✓ 本会话已译 {n} 条",
  "status.cache-purged": "已清理 {n} 条与当前引擎/语言/模型不匹配的缓存条目",
  "status.flush-failed": "落盘失败：{n}",
  "status.just-now": "刚刚",
  "status.cache-exported": "缓存已导出到库根目录：{n}",
  "status.import-bad-json": "导入失败：不是合法 JSON 文件",
  "status.import-schema-unsupported":
    "导入失败：schemaVersion 不受支持（当前支持 ≤ {n}）或缺少 entries",
  "status.import-done": "导入完成：{n} 条缓存条目已合并",

  // —— 通用（core / 装配层错误说明与日志）——
  "common.timeout-request": "翻译请求",
  "common.log-key-save-failed": "[uut] Key 保存失败：",
  "common.log-translate-failed": "[uut] 翻译请求失败：{n}",
  "common.purge-no-engine": "未配置翻译引擎，无法判定当前配置，未做任何清理",
  "common.no-engine-or-key": "未配置翻译引擎或 API Key",
  "common.provider-not-configured": "Provider 未配置",
  "common.placeholder-rewritten": "译文占位符被改写",

  // —— 设置页（settings-tab，批次四 163 条 + 界面语言设置项；值逐字取自源码字面量）——
  "settings.tab.general": "基础",
  "settings.tab.api": "API 配置",
  "settings.tab.usage": "用量统计",
  "settings.tab.scope": "作用域",
  "settings.tab.cache": "缓存",
  "settings.tab.advanced": "高级",

  "settings.provider.openai": "OpenAI 兼容接口",
  "settings.provider.deepl": "DeepL",
  "settings.provider.google": "Google Cloud Translation",
  "settings.provider.azure": "Azure Translator",
  "settings.provider.custom": "自定义端点（本地模型）",

  "settings.cost-basis":
    "费用基准：DeepSeek flash 新定价（2026-09-10 起）每百万 tokens：空闲 输入 ¥1 / 输出 ¥4，高峰时段翻倍；API 侧缓存命中输入仅 ¥0.02–0.04",

  "settings.usage.cost-zero": "≈ 0 tokens，¥0",
  "settings.usage.cost-tokens": "{total} tokens（入 {in} / 出 {out}）",
  "settings.usage.cost-low": "≈ {tokens}，费用 < ¥0.01（空闲时段半价）",
  "settings.usage.cost-high": "≈ {tokens}，高峰 ≈ ¥{yuan}（空闲时段半价）",

  "settings.general.enable": "启用界面翻译",
  "settings.general.enable.desc":
    "总开关；未配置可用翻译引擎时拦截器不激活（设计文档 4.4.2）。关闭后零 API 消耗；打开期间按界面渲染量消耗 API（各通道消耗量级见「作用域」分页标注）",
  "settings.general.display-mode": "显示模式",
  "settings.general.display-mode.desc":
    "⚠️ 双语对照模式下回写文本更长，LLM 输出 tokens 约为纯译文的 2 倍（输出单价高于输入）；纯译文最省",
  "settings.general.display-mode.replace": "纯译文",
  "settings.general.display-mode.bilingual": "双语对照",
  "settings.general.display-mode.original": "原文（暂停回写）",
  "settings.general.bilingual-format": "双语格式",
  "settings.general.bilingual-format.desc": "仅双语对照模式生效；对 API 消耗无影响（仅改变回写排版）",
  "settings.general.bilingual-format.t-first": "译文 (原文)",
  "settings.general.bilingual-format.o-first": "原文 | 译文",
  "settings.general.target-lang": "目标语言",
  "settings.general.target-lang.desc": "如 zh-CN / zh-Hant / ja 等（缓存键含语言维度，切换互不影响）",
  "settings.general.ui-lang": "插件界面语言",
  "settings.general.ui-lang.desc":
    "跟随 Obsidian 界面语言或固定中文/英文；命令名等注册期文案重启后生效，已渲染的他人界面文案不回溯",
  "settings.general.ui-lang.auto": "跟随 Obsidian",
  "settings.general.ui-lang.zh": "中文",
  "settings.general.ui-lang.en": "English",

  "settings.api.engine": "翻译引擎",
  "settings.api.key.desc.encrypted": "safeStorage 加密存储于 secrets.bin，不写入 data.json（4.4.1）",
  "settings.api.key.desc.plain":
    "当前系统不支持系统级加密，Key 仅以混淆方式存储于 secrets.bin，请勿同步该文件（4.4.1 降级分支）",
  "settings.api.key.status": "｜Key 状态：{s}",
  "settings.api.key.status.saved": "已保存",
  "settings.api.key.status.unsaved": "未保存",
  "settings.api.key.placeholder.saved": "已保存，输入新 Key 可覆盖",
  "settings.api.key.placeholder.empty": "输入后自动加密保存",
  "settings.api.base-url.desc": "可指向本地模型，如 http://localhost:11434/v1",
  "settings.api.model": "模型",
  "settings.api.model.desc": "默认 gpt-4o-mini（低成本档）",
  "settings.api.disable-thinking": "关闭思考模式",
  "settings.api.disable-thinking.desc":
    "DeepSeek V4 等默认开启“思考”的模型建议打开：UI 短文本无需推理，关掉后更快、更省 tokens",
  "settings.api.price": "token 单价（每百万）",
  "settings.api.price.desc":
    "格式 输入价/输出价，如 2/8（按你所用模型后台标价填）。填好后状态栏与用量页按 实测 token × 单价 展示费用估算；留空关闭。仅影响展示，不影响预算熔断",
  "settings.api.price.notice-enabled": "UUT：费用估算已启用（状态栏与用量页可见）",
  "settings.api.region.desc": "如 eastasia",
  "settings.api.custom.endpoint": "端点 URL",
  "settings.api.custom.endpoint.desc": "如 http://localhost:11434/v1/chat/completions",
  "settings.api.custom.model": "模型名",
  "settings.api.custom.request-template": "请求体模板",
  "settings.api.custom.request-template.desc": "占位符 {{text}} {{targetLang}} {{model}}；留空使用 OpenAI 兼容模板",
  "settings.api.custom.response-path": "响应路径",
  "settings.api.custom.response-path.desc": "点分隔路径，如 choices.0.message.content；留空为默认值",
  "settings.api.connectivity": "连通性测试",
  "settings.api.connectivity.desc":
    "向当前引擎发送一次测试请求（消耗极少额度：一条短文本约几十 tokens，按基准价 < ¥0.001）",
  "settings.api.connectivity.button": "测试连接",
  "settings.api.usage": "用量统计",
  "settings.api.monthly-usage.desc":
    "本月已发送 {usage} 字符（usage.json 持久化）。{basis}；按此折算本月已消耗 {cost}（仅量级参考）",
  "settings.api.budget": "月度字符预算",
  "settings.api.budget.desc":
    "防意外烧额度的硬闸门：超限自动暂停送译、界面回退原文（4.5 熔断）。付费引擎强烈建议设置；留空为不限。参考量级：核心界面一次性约 5–10 万字符；社区市场全量约 30 万字符/轮",
  "settings.api.budget.placeholder": "不限",

  "settings.scope.note":
    "推荐用法——社区插件市场的「译」按钮有两个：① 左侧列表：每个插件条目的【右上角】，翻译该条目的名称+简介（约 150 字符，费用不足 0.1 分钱）；② 右侧详情：点开任意插件后，详情区【最顶端】的「译」按钮，翻译该插件的 README 全文（数千字符 ≈ 2,600 tokens，高峰价约 1.5 分钱，空闲时段半价）。两者译过即缓存、重复点击零成本。绝大多数要读的英文内容是插件说明与介绍，用「译」按钮即可覆盖，无需打开下面的自动翻译开关。",
  "settings.scope.core": "翻译 Obsidian 核心界面",
  "settings.scope.core.desc":
    "低风险：核心界面文本量固定（约 5–10 万字符），一次性成本按基准价 ≈ ¥0.30 以内（空闲时段半价），缓存后零成本。生效通道：核心命令（设置面板 / DOM 兜底通道技术上无法区分界面归属核心还是社区插件，不受此开关控制）",
  "settings.scope.community": "翻译社区插件界面",
  "settings.scope.community.desc":
    "⚠️ 高风险（API 消耗）：开启后社区市场浏览器的可见条目会被自动翻译，滚动列表即持续送译；市场数千条目全量约 30 万字符/轮（按基准价高峰 ≈ ¥1.1、空闲 ≈ ¥0.55），页面常驻期间反复触发——v1.1.5 起默认关闭，建议改用条目「译」按钮。生效通道：社区插件命令、市场浏览器自动翻译（设置面板 / DOM 兜底无法归因插件，不受此开关控制）",
  "settings.scope.interceptors": "拦截器独立开关",
  "settings.scope.interceptors.desc": "单通道异常时关闭对应通道（D1 熔断手动入口）。各通道的 API 消耗量级见逐项标注",
  "settings.scope.ic.command": "命令面板",
  "settings.scope.ic.command.risk": "低风险：命令清单固定，启动时预热一次，缓存后零成本",
  "settings.scope.ic.menu": "菜单",
  "settings.scope.ic.menu.risk": "低风险：菜单项短且重复率高，缓存命中率通常 >90%",
  "settings.scope.ic.setting": "设置面板",
  "settings.scope.ic.setting.risk": "低风险：各插件设置项文本量固定，翻过一次即缓存",
  "settings.scope.ic.dom": "DOM 兜底",
  "settings.scope.ic.dom.risk":
    "⚠️ 中风险：全局 MutationObserver 观察，动态界面（状态栏、弹窗、自定义视图）会持续送译；关闭后 Notice/弹窗等不再翻译",
  "settings.scope.ic.market": "社区市场「译」按钮",
  "settings.scope.ic.market.risk":
    "✅ 推荐：零自动消耗——按钮位置：列表条目【右上角】+ 点开插件后详情区【最顶端】；点击才翻译，缓存命中后重复点击零成本；失败时按钮变红 × 并弹出具体原因（预算超限 / 熔断中 / 网络错误），v1.1.8 起不再静默",
  "settings.scope.whitelist": "插件白名单",
  "settings.scope.whitelist.desc": "非空时仅翻译这些插件（每行一个插件 id）。⚠️ 当前版本为预留配置，运行时尚未生效",
  "settings.scope.blacklist": "插件黑名单",
  "settings.scope.blacklist.desc":
    "这些插件的命令不翻译（默认含本插件自身）。⚠️ 当前版本仅命令通道生效；设置面板 / DOM 兜底无法归因插件归属",
  "settings.scope.installed-ids": "已安装插件 id 参考",

  "settings.cache.enable": "启用本地缓存",
  "settings.cache.enable.desc":
    "是什么：译文持久化到插件目录 translation-cache.json——同一文本只付一次 API 费用，重启 Obsidian 后仍然有效。什么时候关：只有排查翻译异常时才需要关。⚠️ 关闭后每次渲染界面都重新调 API，同一界面会反复消耗额度",
  "settings.cache.max-entries": "缓存条目上限",
  "settings.cache.max-entries.desc":
    "是什么：内存与磁盘共用此上限（默认 50000，范围 1000–200000；磁盘另有 64MB 字节硬顶，先到先截），超出后淘汰最久未用的条目。什么时候调：社区市场 README 全文翻译条目量大，上限太低会提前淘汰译文、下次打开重复消耗 API——译文是纯文本不占空间，建议往宽了设。代价：容量越大，启动时加载缓存越久（毫秒级）、占内存越多。修改即时生效；调小会立即淘汰最旧条目",
  "settings.cache.loose-key": "跨模型/引擎复用缓存（宽松缓存键）",
  "settings.cache.loose-key.desc":
    "是什么：开启后缓存键退化为「原文+目标语言」，换模型或换引擎后旧译文直接复用，不再全量重译。什么时候开：经常换模型试探（同一界面每换一次模型就重译一遍，是最费的用量放大器）。代价：不同模型的译文风格会混杂在同一缓存里；开启期间「清理失效条目」不可用。关闭后恢复按 引擎+语言+模型 隔离",
  "status.cache-purge-loose":
    "宽松缓存键（跨模型/引擎复用）已开启：条目无引擎/模型维度可判定，清理会误删共享译文——已禁用。如需清理请先关闭该开关",
  "settings.cache.disk-absent": "磁盘文件尚未创建",
  "settings.cache.disk-size": "磁盘文件约 {mb} MB",
  "settings.cache.last-flush": "最后落盘 {time}",
  "settings.cache.flush-pending":
    "本会话尚未落盘（每 30s 检查，累计 100 条或 5 分钟自动落盘；也可点下方「立即落盘」）",
  "settings.cache.stats": "缓存统计",
  "settings.cache.stats.desc":
    "条目 {n}（内存=磁盘同上限）｜命中率 {rate}%（本会话统计——命中率越高，越多内容走了本地缓存、越省钱）｜{size}｜{flush}",
  "settings.cache.flush-now": "立即落盘",
  "settings.cache.flush-now.desc":
    "是什么：新译的译文先存在内存里，插件每 30 秒检查一次——累计满 100 条新译文、或距上次落盘满 5 分钟，才写入磁盘文件；插件正常卸载/关库时也会强制写入。什么时候点：刚翻完一大批市场 README、或准备关机/重启 Obsidian 前点一下，立刻把内存里的新译文写入磁盘。不点会怎样：崩溃/强杀会丢掉「上次落盘以来」的新译文（最多 5 分钟的量），正常退出不受影响。零 API 消耗",
  "settings.cache.purge-stale": "清理失效条目",
  "settings.cache.purge-stale.desc":
    "是什么：删除与当前「引擎 + 目标语言 + 模型」不匹配的缓存条目——缓存键包含这三个维度，换过模型或引擎后，旧条目永远不会再命中，纯占空间。什么时候点：换过模型/引擎/目标语言之后点一次。注意：v1.1.9 之前写入的旧条目没有模型标记，只能按引擎+语言判定。零 API 消耗",
  "settings.cache.clear": "清空缓存",
  "settings.cache.clear.desc":
    "是什么：删除全部缓存译文（内存+磁盘），同时重置界面已显示的译文（R-07 联动）。什么时候用：译文出现异常（如嵌套乱码）、或换了术语表想全部重译时。⚠️ 代价：清空后所有界面将在下次打开时重新消耗 API 翻译一遍（按基准价：核心界面 ≈ ¥0.30 以内，空闲时段半价）",
  "settings.cache.clear.notice": "UUT：缓存已清空，界面译文将在下次访问时重新翻译",
  "settings.cache.export": "导出缓存",
  "settings.cache.export.desc":
    "是什么：把缓存完整导出到库根目录 universal-ui-translator-cache-export.json。什么时候用：换电脑迁移，或把自己积累的译文分享给他人——对方导入后零 API 消耗直接复用（FR-12）。零 API 消耗",
  "settings.cache.export.button": "导出",
  "settings.cache.import": "导入缓存",
  "settings.cache.import.desc":
    "是什么：从缓存 JSON 文件合并条目进本地缓存（校验 schemaVersion 与条目结构，非法文件拒绝）。什么时候用：换机迁移回来，或接收他人分享的译文词表。零 API 消耗",
  "settings.cache.import.button": "导入",
  "settings.cache.import.no-file": "UUT：请先选择缓存 JSON 文件",

  "settings.usage.basis": "计费口径",
  "settings.usage.basis.token.desc":
    "当前引擎（OpenAI 兼容接口）按 token 计费：v1.3 起直接采集 API 返回的 usage 字段（账单口径，含每请求 system prompt 开销）；状态栏常驻「速率 · 今日 · 费用」段（高级页可关）。切换其他引擎后本页回落字符口径",
  "settings.usage.basis.chars.desc":
    "当前引擎按字符计费（DeepL/Google/Azure）：tokens 项为字符折算估算（输入 ≈ 字符/4、输出 ≈ 字符/2.5），仅量级参考",
  "settings.usage.month": "本月用量",
  "settings.usage.month.desc":
    "送译 {calls} 条｜输入 {inChars} 字符 ≈ {inTok} tokens｜输出 {outChars} 字符 ≈ {outTok} tokens｜估算费用 {cost}。本月累计发送 {total} 字符（与月度预算同口径，usage.json 持久化）。逐日明细自 v1.1.9 起记录，此前历史只有月累计",
  "settings.usage.card.session-tokens": "本会话 tokens（实测）",
  "settings.usage.card.session-calls": "本会话送译",
  "settings.usage.card.session-calls.value": "{n} 条 / {chars} 字",
  "settings.usage.card.rate1": "近 1 分钟",
  "settings.usage.card.rate5": "近 5 分钟",
  "settings.usage.card.rate-chars.value": "{n} 字/min",
  "settings.usage.card.peak": "会话峰值",
  "settings.usage.card.today-tokens": "今日 tokens（实测）",
  "settings.usage.card.today-cost": "今日费用（≈{currency}）",
  "settings.usage.card.month-cost": "本月费用（≈{currency}）",
  "settings.usage.card.month-calls": "本月送译条数",
  "settings.usage.card.in-tokens": "输入 tokens（估算）",
  "settings.usage.card.out-tokens": "输出 tokens（估算）",
  "settings.usage.card.cost": "估算费用",
  "settings.usage.chart.title": "近 30 天逐日用量（{basis}）",
  "settings.usage.chart.basis-token": "tokens 实测",
  "settings.usage.chart.basis-est": "tokens 折算估算",
  "settings.usage.chart.toggle-chars": "字符折算",
  "settings.usage.chart.bar-title":
    "{date}：调用 {calls} 条\n输入 {inChars} 字符 / 实测 {inTok} tokens\n输出 {outChars} 字符 / 实测 {outTok} tokens",
  "settings.usage.legend.in": "输入 tokens（{basis}）",
  "settings.usage.legend.out": "输出 tokens（{basis}）",
  "settings.usage.legend.actual": "实测",
  "settings.usage.legend.est": "估算",
  "settings.usage.today-week": "今日 / 近 7 日",
  "settings.usage.today-week.desc":
    "今日：{todayCalls} 条，实测 {todayTok} tokens｜近 7 日：{weekCalls} 条，实测 {weekTok} tokens（折算估算 {weekEst}）",
  "settings.usage.basis-note": "口径说明",
  "settings.usage.basis-note.desc":
    "v1.3 起 OpenAI 兼容通道记录 API 返回的真实 usage（账单口径，含每请求 system prompt 开销）；「折算估算」由字符数估算（输入 ≈ 字符/4、输出 ≈ 字符/2.5），服务于历史数据与非 token 计费引擎。{basis}。缓存命中与术语表命中不消耗 API、不计入此统计；月度预算口径仍为字符",
  "settings.usage.split-low": "< ¥0.01（空闲半价）",
  "settings.usage.split-high": "高峰 ≈ ¥{peak}（空闲 ≈ ¥{off}）",

  "settings.advanced.skip-patterns": "跳过规则（正则）",
  "settings.advanced.skip-patterns.desc":
    "每行一条正则；命中文本不送译（4.2.1 规则 1）。减少不必要的 API 消耗；零自身成本",
  "settings.advanced.glossary": "术语表（固定译法）",
  "settings.advanced.glossary.desc":
    "每行一条：原文=译文；命中直接返回，不进缓存与 API（FR-15）——省额度：命中词条零消耗",
  "settings.advanced.batch-window": "批量聚合窗口（毫秒）",
  "settings.advanced.batch-window.desc":
    "默认 100，可配置 50–500（4.2.2）。窗口内相同文本去重共享一次请求——调大可略微减少重复请求；对总字符消耗无影响",
  "settings.advanced.max-concurrent": "最大并发请求数",
  "settings.advanced.max-concurrent.desc":
    "默认 3，避免触发 API 限流（4.2.2）。⚠️ 调大不省钱（总字符量不变），只影响速度；触发限流反而可能因重试多耗额度",
  "settings.advanced.timeout": "单请求超时（毫秒）",
  "settings.advanced.timeout.desc":
    "默认 30000（R-23：慢引擎上调）；可配置 5000–120000（4.2.2）。超时的请求按失败处理：已发送的字符通常仍会计费",
  "settings.advanced.debug": "调试模式",
  "settings.advanced.debug.desc": "Console 输出拦截日志。纯本地行为，零 API 消耗",

  // —— Provider 错误消息（批次五 33 条：值逐字取自源码字面量；消息构造时刻 t() 解析）——
  "provider.http-not-injected": "HttpClient 未注入",
  "provider.request": "请求",
  "provider.timeout": "{label}超时（{ms}ms）",
  "provider.connect-probe-ok": "连接成功（试译：{n}）",
  "provider.validate-failed": "连通性测试失败：{n}",
  "provider.azure.count-mismatch": "Azure 响应条数与请求不符",
  "provider.azure.missing-translation": "Azure 响应第 {n} 条缺少 translations[0].text",
  "provider.azure.empty-response": "响应为空，请检查 Key 与 Region",
  "provider.custom.name": "自定义端点",
  "provider.custom.empty-response": "响应为空，请检查响应路径配置",
  "provider.custom.path-no-text": "Custom 响应按路径 {path} 未提取到译文",
  "provider.deepl.count-mismatch": "DeepL 响应 translations 数量与请求不符",
  "provider.deepl.missing-text": "DeepL 响应第 {n} 条缺少 text",
  "provider.deepl.usage-ok": "连接成功（DeepL 用量查询正常）",
  "provider.deepl.network-error": "网络错误：{n}",
  "provider.deepl.http-status": "HTTP {n}：请检查 API Key",
  "provider.google.count-mismatch": "Google 响应 translations 数量与请求不符",
  "provider.google.missing-text": "Google 响应第 {n} 条缺少 translatedText",
  "provider.google.empty-response": "响应为空，请检查 API Key",
  "provider.openai.name": "OpenAI 兼容接口",
  "provider.openai.batch-index-misaligned": "批量响应序号错位",
  "provider.openai.batch-line-invalid": "批量响应行格式不符：{n}",
  "provider.openai.batch-count-mismatch": "批量响应行数不符（{seen}/{total}）",
  "provider.openai.missing-content": "OpenAI 响应缺少 choices[0].message.content",
  "provider.openai.auth-failed": "API Key 无效或已失效（401/403）",
  "provider.openai.insufficient-balance": "账户余额不足（402），请到服务商后台充值或续费",
  "provider.openai.model-not-found": "模型不存在（404）：请检查模型名「{model}」",
  "provider.openai.rate-limited": "触发限流（429），请稍后重试",
  "provider.openai.connect-ok": "连接成功（模型：{model}，试译：{probe}）",

  // —— 批次三遗留补抽（扫描器 ≤2 行去重漏收项，主脑裁定补抽；值逐字取自源码字面量）——
  "notice.key-save-failed": "UUT：Key 保存失败：{n}",
  "status.today-chars": "UUT 今日 {n} 字",
  "status.cache-flushed": "缓存已落盘（{time}），共 {n} 条",
  "status.export-failed": "导出失败：{n}",
  "market.log.translate-error": "[uut] 市场「译」按钮翻译异常：{n}",
  "market.notify.failed": "UUT：翻译请求失败（{reason}），已自动跳过；可稍后重试",

  // —— 目标语言切换提示（批次五唯一允许新撰的中文文案）——
  "notice.lang.switched": "UUT：目标语言已切换（缓存按语言隔离，切回零成本）",
};
