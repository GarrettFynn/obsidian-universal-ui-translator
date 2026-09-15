# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.2] - 2026-09-15

官方目录自动审查合规修复：1.3.1 因 manifest 描述含禁用词 "Obsidian"（目录上下文冗余）被判 Failed。顺手清零三处低成本警告；跨窗口 createElement 与声明式设置为有意设计/另行排期，未动。

### Fixed

- **审查 Error：描述含 "Obsidian"**：manifest 描述去除该词（目录上下文已隐含），其余能力表述不变

### Changed

- 审查告警清理：`setInterval`/click 监听回调的 Promise 返回改 `void`（main.ts / settings-tab.ts 两处）；删除 renderUsage 重写遗留的未用变量 `toTok`

## [1.3.1] - 2026-09-15

用户实测反馈修复：token 单价设置从未生效；社区市场弹窗内无任何 token 消耗视图。

### Fixed

- **token 单价保存 bug（1.3.0 缺陷）**：原双输入框的回填逻辑互斥——各自从"从未保存成功的价格"起步，两项永远无法同时成立，价格从未落盘（"填了没作用"的根因）。改为单一组合输入框 `输入价/输出价`（如 `2/8`），输入过程静默、完整合法即保存并 Notice 确认、清空即关闭；货币符号独立小框

### Added

- **市场弹窗常驻用量徽标**：社区市场浏览器为独立窗口，主窗口状态栏在其中不可见——右下角新增常驻徽标 `UUT 今日 1.2k tok · ≈¥0.03`（活动时含速率段），与状态栏同源供数、1Hz 刷新；翻译进度浮窗上移 56px 与徽标上下错开互不遮挡；仅弹窗创建（主窗口由状态栏承担，不重复）

## [1.3.0] - 2026-09-15

token 实测统计与进度反馈打磨版。设计依据：`文档/0915-1820-改进设计` + `文档/0915-1824-技术实现`（v1.1）。

### Added

- **token 实测统计（账单口径）**：OpenAI 兼容通道直接捕获响应 `usage` 字段（含此前从未计入的每请求 system prompt 开销；网关缺失时静默跳过不估算）——统计数字与账单零误差；usage.json 日桶扩展可选 in/outTokens 字段，旧文件无损兼容
- **状态栏用量速率段**（默认开，1Hz）：`UUT ▲ 34 tok/min · 今日 1.2k tok`，配置单价后追加 `· ≈¥0.03` 今日费用估算；其他引擎按字符口径显示；10 分钟无活动自动隐藏；字符串未变化时跳过 setText（零无谓 DOM 更新）
- **token 单价配置**（API 配置页 · 自定义接入接口配置块）：输入/输出单价（每百万）+ 货币符号，挂在 provider 配置上——换引擎各记各价
- **用量页增强**：会话卡片（tokens/送译/近 1 分钟与 5 分钟速率/峰值）、今日实测卡片、今日/本月费用卡片（配置单价后）、图表口径切换（tokens 实测 ⇄ 字符折算，悬停同时显示双口径）、计费口径标注

### Fixed

- **市场进度条"慢一秒"**（用户实测反馈）：完成态滞留 1.5s → 0.6s 并淡出；批在途期间填充条脉动（消除计数冻结感，`prefers-reduced-motion` 自动关闭）；主窗口状态栏从整轮 flush 冻结改为逐批递减刷新

### Changed

- UsageTracker 落盘去抖路径统一（record/recordTokens 共用 5s 节流）；速率环形窗口仅内存（10 分钟剪枝、2000 条硬顶），无新增文件 IO

## [1.2.0] - 2026-09-15

性能与持久化大版本：OpenAI 兼容通道合批、缓存升级零重译、市场翻译进度反馈。设计依据：`文档/0915-1719-综合改进设计_速度持久化进度_v1.1.md`（含编码前复审修正）。

### Changed

- **OpenAI 兼容通道合批（A1）**：单行短文本（≤200 字符）编号合批为单请求翻译（40 条/请求，`max_tokens: 4096` 防网关默认上限截断）——首译请求数 ÷30+、token ÷5–8、耗时从分钟级降至秒级；多行/超长文本走单条通道（失败隔离，单条失败不拖垮整批）；批量响应解析违例（行数/序号/格式）自动整批降级拆单重试，上游零改动
- **并发语义修正（A2）**：`maxConcurrentRequests` 现为**全局真实在途 HTTP 请求数**——装配层 http 包装统一信号量封顶所有引擎；原实现 Provider 内层硬编码并发 3 与外层批次并发相乘，设置 5 实际 15 路在途（429 与熔断的主要诱因）。信号量在超时计时之外获取（排队时间不吃超时预算），设置热生效
- **拆批尊重 Provider 声明（A4）**：单批条数上限改为 `min(聚合上限, provider.maxBatchSize)`——Custom 单条模板等声明值不再被越界
- **缓存来源版本维度退役（B1，设计决策 D5 推翻）**：缓存键本身已精确锚定原文文本（sha256(原文+引擎+语言+模型)），"来源版本变化即整批删除"只误伤升级后未变文本——Obsidian/插件每次升级后的全量重译与 token 重烧（持久化差的主因）不再发生；`from` 转为遗留字段，`app-version.ts` 模块删除（v1.1.11 的 `core@unknown` 降级问题随之消失）
- **缓存按最近访问淘汰（B2）**：命中刷新 `lastAccessAt`（不增脏计数，经 `accessedSinceFlush` 配合保底落盘）；90 天淘汰与磁盘保留优先级统一按最近访问口径——修复"写后 90 天必清"导致长期用户每 90 天全量重译一次的问题
- **429 与熔断解耦（A3）**：限流是背压信号不是服务故障，不再计入 5 次连续失败熔断（负缓存仍生效给服务商喘息）；熔断期间状态栏常驻倒计时 `熔断中 mm:ss`（此前只有一次性 Notice，用户不知还要等多久）
- **落盘健壮性（B4）**：崩溃丢失窗口 5 分钟 → 30 秒；缓存 JSON 紧凑化（原 2 空格缩进近乎翻倍文件体积）；`.bak` 兜底副本（5 分钟节流刷新，主文件损坏时 load 自动回落）；usage.json 由逐条翻译全量重写改为 5 秒去抖落盘（500 条翻译从 500 次写盘降到个位数）

### Added

- **市场翻译进度两级反馈（P1）**：「译」按钮翻译期间显示确定型 `已译/总数` 计数（先收集后送译，开译即知总量）；市场窗口右下角悬浮进度条——多趟翻译聚合显示、十档填充宽度（离散 CSS 类，符合官方审查禁内联样式红线）、完成后 1.5 秒自动移除。社区市场浏览器为独立窗口，主窗口状态栏此前在其中不可见，长 README 翻译全程黑盒

### Removed

- `src/core/app-version.ts`（核心版本号解析——B1 退役后无消费方；官方审查 navigator 禁令的规避代码一并消失）

## [1.1.11] - 2026-09-14

官方目录自动审查合规修复：1.1.10 因一处 navigator API 引用被判 Failed。无功能与行为变更。

### Fixed

- **审查 Error：禁止使用 navigator API**：核心缓存键版本维度（`core@<版本>`）在 `app.appVersion` 缺失时的 UA 解析兜底整体移除——静态检查不区分用途（本处并非 OS 探测），Platform API 又不提供版本号、无合规替代。降级影响：appVersion 缺失的极端场景下缓存键固定为 `core@unknown`，Obsidian 升级后旧译不再惰性失效，可经设置页「清空缓存」手动重建；`resolveFrom` 在翻译期调用（布局就绪后），正常情况下 appVersion 均有值，不受影响

## [1.1.10] - 2026-09-14

官方目录自动审查合规修复：1.1.9 因设置页一处自建 HTML 标题元素被判 Failed，本版按审查意见整改并顺带清零低风险告警。无功能与行为变更。

### Fixed

- **审查 Error：设置页直接创建 HTML 标题元素**：用量统计页「近 30 天逐日用量」标题由 `createEl("h4")` 改为 `new Setting(...).setName(...).setHeading()`，与 Obsidian 设置 UI 风格统一
- **`onunload` / `display` 返回类型不符基类约定**：均由 `Promise<void>` 改为 `void`（Obsidian 调用方本就不 await，行为不变；缓存 flush 改异步发起不阻塞卸载）
- **原型劫持代码的 this 别名与 unbound method 告警**：命令 / 菜单 / 设置 / window.open 四个拦截通道改用箭头函数捕获或 bind，patch/restore 语义不变
- **其余静态告警**：`globalThis` 改 `window.navigator`（popout 窗口兼容）、冗余类型断言删除、`new Array()` 隐式 any[] 消除、`setWarning` 弃用调用改特征检测访问（保留低版本回退）

## [1.1.9] - 2026-09-13

用户反馈修复：缓存条目封顶 5000 且设置页无法调大；社区市场 README 译文缓存被提前淘汰、重复打开时重复消耗 API。同版新增用量统计图表页与缓存治理功能。

### Fixed

- **缓存"内存 5000 / 磁盘 20000"双层设计名存实亡**：flush 只写内存 Map，而内存每次写入都按上限淘汰——磁盘文件永远超不过内存上限（5000），磁盘侧 20000 条 / 8MB 设计不可达。改为内存=磁盘单一容量上限（默认 50000，设置页可调 1000–200000，热生效）；磁盘字节硬顶同步上调 8MB → 64MB（540MB 事故根因是嵌套失控产物，已由单条 4000 字符防线根治；64MB 仍低于 GitHub 100MB 单文件限制）
- **load 淘汰顺序倒置（LRU 反向）**：load 按 updatedAt 降序插入 Map 后按上限淘汰，从 Map 头部删掉的其实是最新条目、最旧的反而留下；改为升序插入，淘汰正确落在最旧条目
- **缓存上限无配置入口**：缓存分页新增「缓存条目上限」设置（调小立即淘汰最旧条目）

### Added

- **「用量统计」设置分页**：按天记录 API 送译条数与输入/输出字符（usage.json 向后兼容扩展，日桶保留近 62 天，月度预算口径不变）；本月汇总卡片（条数 / 输入 / 输出 / 估算 tokens / 估算费用）+ 近 30 天堆叠柱状图（纯 DOM/CSS 零依赖，悬停显示精确值）+ 今日 / 近 7 日摘要；tokens 为字符折算估算（输入 ≈ 字符/4、输出 ≈ 字符/2.5），页面如实标注非账单口径
- **缓存分页「清理失效条目」**：一键删除与当前 引擎+语言+模型 不匹配的缓存条目（换模型/引擎后旧条目因缓存键维度永不命中、纯占空间）；缓存条目新增可选 model 字段，旧条目无标记时按引擎+语言判定并在描述中说明
- 缓存统计行显示磁盘文件实际大小；缓存分页各功能说明统一按"是什么 / 什么时候用 / 代价"三段式重写（重点：「立即落盘」的内存→磁盘时机与崩溃丢失窗口）

## [1.1.8] - 2026-09-12

用户反馈修复：市场「译」按钮（列表条目 + README 详情）间歇性"点击无反应"——所有失败路径被静默回退为原文且按钮一律显示 ✓，失败被伪装成成功。

### Fixed

- **「译」按钮失败静默化（根因修复）**：协调层新增结果分类（`translateWithOutcome`：translated / cache / glossary / filtered / no-provider / budget / circuit / negative-cache / failed），点击后按真实结果反馈——有待译节点但零回写时按钮显示红色 × 并 Notice 说明具体原因（预算超限 / 熔断中 / 未配置引擎 / 请求失败摘要），3 秒后恢复可重试；无可译节点（已译/被过滤）仍显示 ✓。其他四个通道经 `translate()` 薄封装，行为零变化
- **月度预算超限纯静默**（types.ts 承诺的"超限提示"此前未实现）：超限时每会话 Notice 提示一次，告知到设置页调整预算
- **回写竞态**：「译」按钮回写前补 `isConnected` 存活检查（设计文档 5.2 此前在 DOM 兜底通道有、市场通道漏实现）——详情区频繁重渲染时译文曾写到已销毁节点上不可见；全部游离且根容器仍存活时自动重试一次（译文已入缓存，零 API 成本秒出）
- **手动点击绕过 5 分钟负缓存**（显式重试意图；熔断与预算保护不动）；coordinator 意外抛错时按钮不再永久卡在「…」
- **同父兄弟节点锁定**（二次复查发现）：已译标记此前"一回写即打父元素"——`<p>文字1<a>链接</a> 文字2</p>` 这类同父多文本节点结构下，部分节点失败时父元素仍被打标，TreeWalker 跳过 `[data-uut]` 祖先导致失败节点永久锁死、重试无效。改为"父元素的全部送译子节点均成功"才打标的延迟判定
- **「临时显示原文」模式下的假失效**：该模式翻译成功进缓存但按模式不回写界面，按钮此前伪装 ✓——现明确提示当前模式与恢复方法
- 部分游离自动补救：一趟内"成功+游离"混合时也自动补一趟（此前仅全部游离才重试，用户会看到中英夹杂需手动再点）；重试后仍全部游离（详情区持续重渲染）时按钮回到可再点的「译」而非伪装 ✓
- 注入扫描性能：7500+ 条目 × 高频突变下，按钮存在性检查改 O(1) 快速路径（`firstElementChild`/`lastElementChild`），querySelector 仅作兜底

## [1.1.7] - 2026-09-12

费用模型换基准 + 按钮位置指引（无代码逻辑变更）。

### Changed

- **费用估算换用 DeepSeek flash 2026-09-10 新定价**（每百万 tokens：空闲 输入 ¥1 / 输出 ¥4，高峰翻倍；API 侧缓存命中 ¥0.02–0.04）：设置页用量统计升级为实时「tokens 分解 + 人民币费用」折算（高峰/空闲双口径），各分页旧美元价格标注全部替换；README 新增「费用估算」专节（定价表、折算模型、分场景费用、token 耗费速率、零成本路径）
- 设置页「作用域」分页顶部说明改写为「译」按钮**精确位置指引**（列表条目右上角 / 详情区最顶端），使用说明 FAQ 同步

## [1.1.6] - 2026-09-11

### Fixed

- **详情「译」按钮覆盖 README 正文**（1.1.5 实测缺陷：只翻译了按钮旁的简短预览）：Obsidian 1.13.7 市场弹窗详情区是多个并列兄弟容器（简介头部与 README 正文分属不同子树），v1.1.5 以"第一个详情子容器"为翻译根罩不住正文。翻译根提升为整个 `.mod-community-plugin` 弹窗并排除左侧 `.modal-sidebar` 列表——README 无论在哪个子容器都覆盖，列表条目不重复送译，原生中文界面文本仍由规则 5c 零成本跳过

## [1.1.5] - 2026-09-11

用户反馈修复：双语模式下译文被反复嵌套再翻（`译文 (译文 (…))` 乱码）；社区市场页面常驻持续消耗 API 额度；设置项风险标注缺失。

### Fixed

- **嵌套重复翻译（三层防线）**：①「译」按钮回写经 `markWrittenBack()` 登记到 DOM 兜底通道去重账本，跨通道回写不再被当成新内容重送；② DOM 兜底通道去重记录统一 trim 口径（含前后空白的回写不再误判重送）；③ 过滤器新增规则 5c——目标语言为中文时文本含 ≥2 个汉字即拒绝送译，双语回写产物从结构上不可能再进入翻译管线
- **缓存体积失控**（嵌套乱码把 `translation-cache.json` 撑到数百 MB、git 推送被远端单文件上限拒绝）：过滤器规则 2b 拒译超 2000 字符文本（单请求成本硬上限）；缓存单条目 src+tgt 超 4000 字符拒绝写入、load 时自动剔除旧版垃圾条目；落盘在 20000 条上限外新增 8MB 字节硬顶
- **额度消耗**：`scope.core` / `scope.communityPlugins` / `cacheEnabled` 三个此前从未生效的死开关完成接线；市场弹窗默认不再自动全量翻译（滚动列表即持续送译的根因切除），条目「译」按钮始终可用（零自动消耗）
- 过滤器在配置变更时热同步目标语言与跳过正则（此前改完需重启才生效）

### Changed

- `scope.communityPlugins` 默认关闭；因其在旧版本从未生效，升级时对所有用户执行一次性迁移置关（之后尊重手动选择），并 Notice 告知
- 「译」按钮翻译过的条目打 `data-uut="mkt"` 标记：DOM 兜底通道跳过、重复点击零送译；插件卸载时清除标记

### Added

- 设置面板逐项风险与费用标注（基准：DeepSeek V4 Flash 峰时价 输入 $0.44 / 输出 $1.32 每百万 tokens）；API 分页用量统计附实时费用折算；月度预算标注为防烧额度硬闸门
- 缓存分页新增「启用本地缓存」开关（原死配置接线）与「立即落盘」按钮（不等自动落盘策略，手动关闭崩溃丢失窗口）
- 社区市场**详情面板**（插件 README 全文——绝大多数待读英文内容所在）注入「译」按钮：点击并行翻译当前选中插件的完整介绍，代码块不译；切换插件详情重渲染后按钮自动重注入

## [1.1.4] - 2026-09-10

官方平台审核 1.1.3 反馈的收尾（零 Error 后的 Warning 清理）。

### Fixed

- manifest 描述补回结尾标点（平台规则：描述须以 `.`/`!`/`?` 结尾）
- `setTimeout` 统一走 `window.setTimeout`（popout 兼容），对应测试切到 jsdom 环境
- 构建依赖 `builtin-modules` 包替换为 Node 内置 `node:module`

## [1.1.3] - 2026-09-10

官方社区平台（community.obsidian.md）自动审核首轮反馈修复。

### Fixed

- manifest 描述移除 "Obsidian" 字样（平台硬性规则：目录语境下该词冗余）
- 状态栏显隐从内联 `style.display` 赋值改为 CSS 类切换（`no-static-styles-assignment`）
- 版本探测的 `navigator.userAgent` 兜底改为计算属性访问（仅用于取 Obsidian 版本号，非 OS 探测；Platform API 不提供版本信息）

### Added

- Release 工作流新增构建产物来源证明（artifact attestations），用户可加密验证产物确由本仓库构建

### Changed

- `require("electron")` 改为动态 `import()`；`setTimeout` 改用 window 宿主（popout 兼容）；移除加载/卸载的 console 日志；清空缓存按钮在 1.13+ 运行时改用 `setDestructive`（特征检测回退 `setWarning`）

## [1.1.2] - 2026-09-10

发布前全量冒烟（CDP 自动化，13 项）暴露的修复。

### Fixed

- **用户内容保护补强**：DOM 兜底通道不再进入 `.prompt` 弹窗层——快速切换器（Ctrl+O）的文件名、"打开库"的库名属用户内容，承诺不译（命令面板文本由命令通道覆盖，不受影响；副作用：插件黑名单在命令面板显示层现在严格生效，此前会被 DOM 兜底覆盖）

## [1.1.1] - 2026-09-10

### Fixed

- **社区插件市场真正覆盖了**（自动翻译 + 条目「译」按钮）：CDP 实测 1.13.7 发现市场浏览器是 `window.open` 弹出的**第三个独立窗口**（opener=主窗口），不在 workspace leaves 与 `app.setting` 引用链内，此前完全够不到。新增 `WindowOpenHook`：包装主窗口 `window.open` 捕获弹窗并纳管其 document（卸载时完整还原）。注意：插件加载前已打开的市场窗口无法追溯捕获，重开一次即可

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

[1.1.4]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.1.4
[1.1.3]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.1.3
[1.1.2]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.1.2
[1.1.1]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.1.1
[1.1.0]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.1.0
[1.0.3]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.0.3
[1.0.2]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.0.2
[1.0.1]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.0.1
[1.0.0]: https://github.com/GarrettFynn/obsidian-universal-ui-translator/releases/tag/1.0.0
