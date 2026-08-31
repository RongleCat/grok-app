# Grok App · llm-wiki

Agent 与贡献者的**可执行知识库**。改产品行为或 UI 文案前，先读本目录对应条目。

| 文档 | 用途 |
|------|------|
| [i18n.md](./i18n.md) | **多语言强制规则**：所有 UI 文案、增改键、双语同步 |
| [settings-ia.md](./settings-ia.md) | **设置页 IA**：一级导航 / 页内 tab / `settingsCatalog` 登记 / 搜索跳转 / 深链 |
| [dialogs.md](./dialogs.md) | **禁止系统默认控件**（裸 `<select>` / 原生菜单）；**禁止透明下拉**；**禁止层叠错误**；禁止 `window.confirm` / `prompt` / `alert`；复用 `Select` / `ContextMenu` / 既有面板 |
| [catalog.md](./catalog.md) | 与 Grok Build CLI 对齐的模型 / 推理强度 / 权限（含 YOLO） |
| [automations.md](./automations.md) | 自动化任务设计（Build `/loop` / scheduler；不阻塞 P0） |
| [slash-composer.md](./slash-composer.md) | 斜杠面板、技能标签、Goal 模式、Doctor |
| [session-continuity.md](./session-continuity.md) | Agent 续会话（load/bootstrap）、自动压缩归属 |
| [session-api.md](./session-api.md) | **本机会话接口**：列表 + session id 续跑（#626 第一刀；非新建、非打断） |
| [ssh-remote.md](./ssh-remote.md) | **SSH 远端工作区**：OpenSSH Host、Watch、远端会话/文件/终端/Skills/localhost 转发；远端路径不当本地盘 |
| [account.md](./account.md) | 官方登录 / 会员额度 / 热力图 / 调用日志 |
| [providers.md](./providers.md) | 自定义中转、agent GROK_HOME、编辑器探测 |
| [model-routing.md](./model-routing.md) | **模型分层**：识图 / 搜索 / 摘要 / 提示建议辅槽；省 Grok / 还原官方默认 |
| [setup.md](./setup.md) | 首次初始化门禁：CLI 必装、账户可跳过、多镜像安装 |
| [release.md](./release.md) | **发版 / Release 强制流程**：CHANGELOG 短句、What's New 弹窗、tag、三端 CI、macOS 损坏处理 |
| [website-downloads.md](./website-downloads.md) | **官网下载对接**：grok-app.com 按钮、稳定别名、`downloads.json`、禁止反代 |
| [maintain.md](./maintain.md) | **开源维护**：Issue 分拣、PR 审核、社区反馈入库、修复闭环；**已合并分支 / worktree 及时安全清理** |
| [chatcut.md](./chatcut.md) | **ChatCut Codex 插件**：适配器、MCP surface、Resources 内嵌浏览器 handoff、re-pull 迁移 |
| [agent-gui-reference.md](./agent-gui-reference.md) | **Agent GUI 参考**：桌面客户端与 CLI 的交互界面规范 |
| [git-worktrees.md](./git-worktrees.md) | **Git worktree**：分支菜单、创建/移除/GC、会话绑定与徽章 |
| [icons.md](./icons.md) | **图标**：应用 Dock 图标 vs 托盘/状态栏图标，不得混用 |
| [media-delivery.md](./media-delivery.md) | **本地媒体投递**：loopback HTTP + path resolve（产品路径不直接用 `media://`） |
| [plugins-marketplace.md](./plugins-marketplace.md) | **插件市场**：插件目录、安装流与兼容性约束 |
| [remote-im.md](./remote-im.md) | **Remote IM**：GUI 配置全渠道 · Bridge · Grok Build；goal 见 `docs/plans/GOAL-remote-im.md` |
| [appearance-skins.md](./appearance-skins.md) | **外观皮肤包**：`.grokskin` 布局、K19 allowlist、`grok://` + `grok-app:`、从不自动 apply、网站只用 `url=` |

## 原则

1. **可检索**：一条知识一个文件，标题即意图。  
2. **可执行**：写清路径、键名、禁止事项，而不是空泛建议。  
3. **变更同步**：改代码必改 wiki；改 wiki 后实现要跟上。  
4. **跨 Agent**：后续 Agent 接手时以本目录为准，不靠会话记忆。

## 相关源码

- i18n：`src/i18n/`
- Build 目录：`src/lib/grokCatalog.ts`
- UI 入口：`src/App.tsx`
