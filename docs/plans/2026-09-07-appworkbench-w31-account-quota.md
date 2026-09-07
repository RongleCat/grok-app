# AppWorkbench 继续拆解 — WP-W31 账号 / 配额

**日期**：2026-09-07  
**基线**：`origin/main` @ `3ec81c67`（W30 #1054）  
**来源**：HANDOFF · W29 表「W31 账号 / 配额」  
**执行位置**：worktree `D:/code/grok-app-appworkbench-w30-session-badges` · 分支 `refactor/appworkbench-w31-account-quota`

---

## 1. 问题

`account` 快照、loading/busy、heatmap/probe error、loginHint、已存账号 / 额度表、boot 缓存再 refresh、登录切换登出仍堆在 host。已有 `useAccountQuotaAutoRefresh` 只管 10 分钟 tick，投影 state 仍回流。

---

## 2. 本刀

新建 `src/hooks/useAccountQuotaChrome.ts`：

自持：account 快照 + loading/busy + errors + loginHint + savedAccounts / activeId / quotas；`refreshAccount*`；boot 两段 refresh；Account 设置页打开时 refresh；10 分钟 auto-refresh；login / logout / switch / save / add / remove / cancel / paste code。

晚绑 host：`tr` · `showToast` · `setAppDialog` · `noteAccountConnected`（写 setup.auth/cli）· `resetFocusedSession`（登录成功后 IDLE 壳）。

入参：`manualCliPath`、`accountSettingsOpen`。

**不抽**：`importChatTranscript`（会话导入，只借用 busy 动词）；provider 余额；setup / boot 闸门（W33）。

---

## 3. 后续

实测（W31 接线后）：

| | W30 main | W31 worktree | 新天花板 |
|--|----------|--------------|----------|
| 行数 | 14062 | **13759** | 14200 → **13900** |
| useState | 113 | **104** | 116 → **108** |
| useEffect | 65 | **63** | 68 → **66** |

其后 W32 MCP doctor → W33 setup / boot。
