**用自己的翻译 API 翻译 Obsidian 界面：核心、社区插件，以及社区插件市场本身。**
**Translate the Obsidian UI — core, community plugins, and the community-plugin browser itself — with your own translation API.**

**✨ 为什么选它 / Why**
- 🧩 **社区插件全覆盖**：命令面板、右键菜单、设置面板、弹窗通知——外加**社区插件市场条目级的「译」按钮**，点哪条译哪条，缓存命中零成本
- 🌐 **目标语言任意**：默认简体中文，设置 → 基础 → 目标语言 可填 `ja` / `zh-Hant` / `ko` / `fr` 等任意语言代码；缓存按语言隔离，随时切换互不影响
- 💰 **零成本可行**：DeepL/Google/Azure 免费额度足够覆盖界面文本量；接 Ollama 本地模型则完全免费、离线可用
- 🔒 **隐私优先**：无遥测，唯一外发是你自己配置的翻译端点；笔记正文永不翻译；API Key 经系统钥匙串加密

**🚀 推荐引擎 / Recommended provider — DeepSeek**
- 引擎选「OpenAI 兼容接口」，Base URL 填 `https://api.deepseek.com`，模型填 `deepseek-v4.1-flash`——快速经济，界面文本秒回，成本约几分钱
- ⚠️ **记得打开「关闭思考模式」开关**（API 配置页）：V4 系列默认开启思考模式，不关的话每条短文本都会长篇推理——又慢又费 tokens
- DeepSeek model `deepseek-v4.1-flash` works great here — just toggle ON "关闭思考模式" (disable thinking) in API settings, otherwise thinking mode burns tokens on every tiny UI string

---
