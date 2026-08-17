# Grok App · llm-wiki

Agent 与贡献者的**可执行知识库**。改产品行为或 UI 文案前，先读本目录对应条目。

| 文档 | 用途 |
|------|------|
| [i18n.md](./i18n.md) | **多语言强制规则**：所有 UI 文案、增改键、双语同步 |
| [settings-ia.md](./settings-ia.md) | **设置页 IA**：一级导航 / 页内 tab / `settingsCatalog` 登记 / 搜索跳转 / 深链 |
| [dialogs.md](./dialogs.md) | **禁止系统默认控件**（裸 `<select>` / 原生菜单）；**禁止透明下拉**；**禁止层叠错误**；禁止 `window.confirm` / `prompt` / `alert`；复用 `Select` / `ContextMenu` / 既有面板 |
| [catalog.md](./catalog.md) | 与 Grok Build CLI 对齐的模型 / 推理强度 / 权限（含 YOLO） |
| [automations.md](./automations.md) | 自动化任务设计（Build `/loop` / scheduler；不阻塞 P0） |
| [spaces-kanban.md](./spaces-kanban.md) | **侧栏 Spaces**（项目分组，不是 git workspace）与 **Agent Kanban**（`#/kanban` 运行态看板，不是待办） |
| [slash-composer.md](./slash-composer.md) | 斜杠面板、技能标签、Goal 模式、Doctor |
| [session-continuity.md](./session-continuity.md) | Agent 续会话（load/bootstrap）、自动压缩归属 |
| [session-api.md](./session-api.md) | **本机会话接口**：列表 + session id 续跑（#626 第一刀；非新建、非打断） |
| [account.md](./account.md) | 官方登录 / 会员额度 / 热力图 / 调用日志 |
| [providers.md](./providers.md) | 自定义中转、agent GROK_HOME、编辑器探测 |
| [model-routing.md](./model-routing.md) | **模型分层**：识图 / 搜索 / 摘要 / 提示建议辅槽；省 Grok / 还原官方默认 |
| [setup.md](./setup.md) | 首次初始化门禁：CLI 必装、账户可跳过、多镜像安装 |
| [release.md](./release.md) | **发版 / Release 强制流程**：CHANGELOG、tag、三端 CI、macOS 损坏处理 |
| [website-downloads.md](./website-downloads.md) | **官网下载对接**：grok-app.com 按钮、稳定别名、`downloads.json`、禁止反代 |
| [maintain.md](./maintain.md) | **开源维护**：Issue 分拣、PR 审核、社区反馈入库、修复闭环；**已合并分支 / worktree 及时安全清理** |
| [chatcut.md](./chatcut.md) | **ChatCut Codex 插件**：适配器、MCP surface、Resources 内嵌浏览器 handoff、re-pull 迁移 |

## 原则

1. **可检索**：一条知识一个文件，标题即意图。  
2. **可执行**：写清路径、键名、禁止事项，而不是空泛建议。  
3. **变更同步**：改代码必改 wiki；改 wiki 后实现要跟上。  
4. **跨 Agent**：后续 Agent 接手时以本目录为准，不靠会话记忆。

## 相关源码

- i18n：`src/i18n/`
- Build 目录：`src/lib/grokCatalog.ts`
- UI 入口：`src/App.tsx`
