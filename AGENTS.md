# AGENTS.md — obsidian-universal-ui-translator

## 构建与验证
- 构建命令（门禁）：`npm run build`（tsc 类型检查 + esbuild 打包，产物 `main.js`）
- 测试命令：`npm test`（Vitest）
- 每次修改后必须运行构建验证，失败即停并报告

## 目录结构（设计文档附录 A）
- `main.ts`：插件入口
- `src/`：正式源码（`core/` 调度层、`interceptors/` 拦截层、`providers/` 适配层、`filters/`、`ui/`）
- `tests/`：Vitest 测试
- `spikes/`：一次性技术验证代码（不进正式构建产物，不进发布包）
- `文档/`：AI 协作文档（指令 / 审查报告 / 状态报告）

## 编码规范
- TypeScript 开启 `strictNullChecks`；导出 API 不得泄漏 `any`（spikes/ 内的一次性代码除外）
- CSS 类名统一 `.uut-` 前缀；禁止全局选择器与 `!important`（设计文档 5.4 节）
- esbuild 不做 minify——上架要求构建产物可读（设计文档 9.2 节）
- 网络请求统一使用 Obsidian `requestUrl`，禁止裸 `fetch`（设计文档 4.3.1 节）
- 哈希计算用 Node `crypto` 模块，不用 `crypto.subtle`（设计文档 4.2.3 节）
- 所有对 Obsidian 原型/内部 API 的 patch 必须在 `onunload` 中完整还原（含实例级还原）

## 协作约定
- 执行层只按 `文档/` 下最新的 `MMDD-HHMM-执行指令_vX.X.md` 执行
- 红线以指令文档"五、约束与红线"快照为准
