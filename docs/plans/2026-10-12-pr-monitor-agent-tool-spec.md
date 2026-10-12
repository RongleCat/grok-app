# Spec: PR Monitor —— 向 Agent 暴露监视能力（MCP 工具）

Status: ready-for-agent
交付 PR：https://github.com/RongleCat/grok-app/pull/1327（stack 在 `feat/session-pr-monitor` / PR #1325 之上）。
前序：`docs/plans/2026-10-12-pr-monitor-session-bound-spec.md`（监视身份 = 会话 + 仓库 + PR 号，
本文件在它之上）、`docs/llm-wiki/pr-monitor.md`（现行产品规则）。

## Problem Statement

监视 PR 目前只有**人的通路**：分支菜单「拉取请求」区里，人点铃铛挂载、点铃铛停止。Agent 在
这条链路上完全没有手脚：

1. Agent 用 `gh pr create` 开完 PR 之后，**必须等人**去菜单里点一次监视，否则这个 PR 上的评论 /
   review / CI 变化不会回到会话里。人不在电脑前，跟进就断了。
2. Agent 自己不知道「我在盯哪些 PR」：它无法列出当前会话的挂载，也无法在不切分支、不找人点铃铛的
   情况下停止监视。
3. 收尾不成体系：作者视角要「合并并关闭」，贡献者视角要「被作者关掉之后停止监视」；今天只有宿主
   在 PR 变为 MERGED/CLOSED 后投递一条状态变化的跟进并自动卸载（会话身份重构已经做了这一步），
   但**决定收尾动作的那一方（Agent）拿不到操作面**，也不知道该在什么时候做什么。

宿主已经是唯一权威：注册表、轮询、唤醒投递都在宿主进程里（见前序 spec）。缺的是把这套能力
**以工具形式**交到 Agent 手上。

## Solution

一个 **注入到会话里的 MCP server**（`pr-monitor`），三个工具；底下复用宿主已有的命令与
回环会话 API，不新造一套监视实现。

1. **宿主命令面收敛为一组回环路由**（与 session API 同一台服务器、同一 token 门，127.0.0.1）：

   | 方法 | 路径 | 语义 |
   |------|------|------|
   | GET | `/v1/pr-monitor/watches?session_id=` | 该会话的全部挂载（状态、checks、最近错误） |
   | POST | `/v1/pr-monitor/watches` | 挂载 `{session_id, project_path, pr_number, interval_secs?}` |
   | DELETE | `/v1/pr-monitor/watches` | 停止 `{session_id, pr_number}` |

   三者直接调用 UI 用的同一批宿主命令（`pr_monitor_watch` / `pr_monitor_unwatch` /
   `pr_monitor_state`），因此菜单与 Agent 永远不会对「这个会话在盯什么」产生分歧；Agent 挂载
   会立刻通过 `pr-monitor://state` 出现在菜单里。

2. **MCP 工具**（`scripts/pr-monitor-mcp.mjs`，零依赖 stdio JSON-RPC，与 official-aux 同构）：

   - `pr_watch(pr_number, project_path?, interval_secs?)` —— `gh pr create` 之后立刻挂载；
     `project_path` 省略时用本会话的项目。
   - `pr_unwatch(pr_number)` —— 收尾时停止。
   - `pr_watches()` —— 列出本会话挂载（状态 / checks / 最近错误），用于去重与收尾自检。

3. **注入与身份**：宿主在 connect（以及热切换 mcpServers 时）把该 server 加进会话的
   `mcpServers`，env 带三样东西：端点文件路径（内含 `{url, token}`）、**本会话 id**、本会话项目
   路径。会话 id 由 `SpawnOptions.app_session_id`（来自 `SessionMeta.id`）一路传到
   `AcpClient`，因此工具天然只能操作**自己这个会话**的挂载，跨会话既看不到也停不掉。

4. **收尾口径**：机械的一半留在宿主（PR 变为 MERGED/CLOSED → 投递最后一条跟进 → 自动卸载），
   决策的一半写进工具描述，交给 Agent：
   - 作者视角：PR 是自己开的、要求合并 → Agent 收尾时 `gh pr merge`，让 PR 关闭并清理分支。
   - 贡献者视角：被作者 Close → 收到状态变化那一条跟进后 `pr_unwatch`（宿主也会自动卸载），
     不再对已经结束的 PR 做动作。

5. **文档与交付**：`docs/llm-wiki/pr-monitor.md` 增「The agent's own handle (MCP tools)」；
   AGENTS.md 索引行同步；本文档作为本次交付的 spec 与工单载体；PR 描述按仓库 ship 规矩写。

## User Stories

1. 作为用 Agent 开 PR 的开发者，我希望 Agent 开完 PR 自己挂上监视，不必我回菜单点铃铛。
2. 作为开发者，我希望菜单能显示 Agent 挂上的监视（同一个宿主注册表），这样我能看到、也能自己停掉。
3. 作为贡献者，我希望我的 PR 被作者合并/关闭后自动停止监视，并收到一条说清结果的跟进。
4. 作为 Agent 维护者，我希望工具只能操作本会话的挂载，不串会话、不越权。
5. 作为 Agent，我希望有一个「我在盯什么」的查询，避免重复挂载、收尾前自检。
6. 作为维护者，我希望宿主不可用时工具**如实报错**（没有端点就说没有），不假装在监视。
7. 作为维护者，我希望工具面不引入新的监视实现：路由直接调 UI 用的宿主命令。
8. 作为维护者，我希望 MCP 脚本随宿主内嵌写出，打包安装（无仓库树）也能用。
9. 作为开发者，我希望 Agent 的收尾口径（合并并关闭 / 被关闭后停止）写在工具描述里，而不是
   散落在提示词里。
10. 作为维护者，我希望热切换 MCP 时不会把 Agent 的工具弄丢（会话 id 跟着走）。

## Implementation Decisions

- **分层**：宿主仍是唯一权威（注册表 / 轮询 / 投递）；本切片只增加「命令面（回环路由）」与
  「工具面（MCP）」，不复制监视逻辑、不改轮询与唤醒语义。
- **路由**：`src-tauri/src/session_api.rs` 增三条路由与 `delete` 导入；handler 只做 token 校验
  + 参数校验（`session_id` 必填）后调用 `pr_monitor::*` 命令。400 / 401 沿用既有
  `{ok, status, message}`；成功与命令级拒绝沿用挂载/卸载自己的结果 DTO（`{ok, error}` /
  `{ok, removed}`），脚本对两者都接受。
- **MCP**：`scripts/pr-monitor-mcp.mjs` 零依赖；`src-tauri/src/pr_monitor/mcp.rs` 用
  `include_str!` 内嵌、写到 `{app_data}/mcp/pr-monitor/`，并生成 ACP entry（command=node、
  env=端点 / 会话 id / 项目）；`extensions.rs` 在 `build_session_mcp_servers*` 末尾追加该
  entry（App 本地能力，无凭据，因此对所有路由生效；只有知道会话 id 时才注入）。
- **身份传递**：`SpawnOptions.app_session_id`（connect 用 `SessionMeta.id`，prewarm / 官方
  侧信道为 `None`）→ `AcpClient.app_session_id` → connect 与热切换两条构建路径都把会话 id
  传给 `build_session_mcp_servers*`。`McpInjectOptions` 保持 `Copy`，会话 id 作为独立参数传入。
- **不做**：不给 CLI 加 `--pr-watch`（本次工具面走 MCP，回环路由已可由脚本 / 其它外部程序调用）；
  不改唤醒提示词（收尾口径放工具描述）；不做宿主不可用时的排队补挂。
- **i18n**：本切片不新增用户可见文案（工具描述是 Agent 面文本，随脚本走，不进 15 语言目录）。

## Testing Decisions

- Rust：`cargo check --lib` 干净（无新增 warning）；`cargo test --lib`（含新增 mcp 模块测试：
  脚本内嵌且含三个工具名、无会话 id 时不注入）。
- 手工（本文件交付时执行）：`node scripts/pr-monitor-mcp.mjs` 走 stdio JSON-RPC ——
  `initialize` 返回 `pr-monitor`、`tools/list` 返回三个工具、无端点时调用如实报错。
- 端到端（需 dev 应用）：`gh pr create` 后让 Agent 调 `pr_watch`，菜单出现该挂载；PR 合并后
  收到一条跟进且挂载自动消失。
- 未覆盖（诚实记录）：HTTP 路由的集成测试需要 `AppHandle`，本地无轻量构造方式，故由端到端验收
  覆盖；宿主不可用（应用退出）时工具报错已由脚本手工验证。

## Delivery slices

本切片按四刀落地，每刀都能单独复验：

1. 宿主回环路由 `/v1/pr-monitor/watches`（GET/POST/DELETE），复用既有命令。
2. `pr-monitor` MCP server（脚本 + 内嵌 + 注入 + 会话 id 作用域）。
3. 收尾口径进工具描述（作者合并并关闭 / 贡献者被关闭后停止），宿主自动卸载保持现状。
4. 文档（llm-wiki / AGENTS 索引 / 本 spec）与 PR 描述。

## Further Notes

- 与 official-aux 的关系：两者都用「宿主内嵌脚本 + connect 注入 mcpServers」的同一条通路，但
  official-aux 走官方凭据、只对 custom main 注入；本 server 是 App 本地能力、对所有路由注入。
- 后续可选：给 CLI 加同路径 `grok-app --pr-watch/--pr-unwatch/--pr-watches`（便于 bash 与 CI
  场景），以及「宿主不可用时排队补挂」——两者都不在本切片。
