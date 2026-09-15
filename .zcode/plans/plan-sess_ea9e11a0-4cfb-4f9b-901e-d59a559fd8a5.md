# 1.3.2 审查合规修复与重新发布

## 根因
官方目录自动审查唯一的 **Error**：manifest.json 描述含 "Obsidian"（目录上下文冗余，禁用词）——上一版改写描述时引入。Warning 不阻塞发布（1.1.11 即带警告通过），但低成本项顺手清理。

## 改动清单

### 必改（解除 Failed）
1. `manifest.json` 描述去掉 "Obsidian"：
   `"Translate core & community plugin UI via your own API — batched for speed, cached to save tokens (survives upgrades), with live token usage & cost tracking."`

### 顺手清理的 Warning（低成本）
2. `main.ts:160`：`setInterval(() => this.updateUsageStatusBar(), ...)` → `() => void this.updateUsageStatusBar()`（Promise 返回改 void）
3. `src/ui/settings-tab.ts:605`：图表切换 click 监听去掉 `async`，内部 `void this.renderTabs()`（同上）
4. `src/ui/settings-tab.ts:536`：删除未使用的 `toTok` 变量（1.3.1 重写 renderUsage 的遗留）

### 明确不动的 Warning（有意设计，既往通过版本同样携带）
- `document.createElement`（marketplace-patcher）：跨窗口弹窗必须用目标 doc 自建元素（R-30），createEl 帮手跨 realm 不存在——改了会破坏市场弹窗注入
- `getSettingDefinitions()` 声明式设置：大型重构，另行排期
- `main.ts:486` console.log：debugMode 门控的调试日志，静态分析无法识别，保留

## 发布流程（按《Git 双端同步说明》既定流程）
1. 版本 bump 1.3.2（manifest + versions.json），CHANGELOG 增补条目
2. `npm run build` + `npm test` 门禁全绿
3. 更新 D:\ObsidianVault 库内安装（main.js / manifest.json / styles.css）
4. main 提交 → `git push origin main`（华为云全量备份）
5. github-public 干净分支：`read-tree main` → `rm -r --cached 文档 spikes` → commit "Release 1.3.2" → push github → tag 1.3.2 → push tag（触发 Actions 构建发布）
6. 切回 main 后 `git checkout -- .` 恢复工作区（上次发布流程的已知残局，本次主动处理）
7. API 确认 Actions run 成功、Release 资产附加