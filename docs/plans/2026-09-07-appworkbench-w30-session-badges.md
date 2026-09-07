# AppWorkbench 继续拆解 — WP-W30 会话徽章

**日期**：2026-09-07  
**基线**：`origin/main` @ `030f656d`（`feat(sidebar): pin SuperGrok quota on the expanded rail (#1050)`）  
**来源**：HANDOFF · W29 后续「会话徽章」· 软件设计哲学（深模块 / 信息隐藏）  
**执行位置**：worktree `D:/code/grok-app-appworkbench-w30-session-badges` · 分支 `refactor/appworkbench-w30-session-badges`

---

## 1. 问题

Mute / unread / plan-pending 的 Set、localStorage、CustomEvent、tray/dock 计数、clear-on-view 仍堆在 `AppWorkbench` 顶层。改侧栏圆点必须在 100+ 个 `useState` 里判断耦合。

约束（不可破）：

- AGENTS.md §7：App shell + AppWorkbench **合计行数只降不升**；禁止再往 host 加 `useState` / 大功能块。
- 按**知识归属**抽深 hook（state + effect + persist + 少量动词），不切 80-prop Stage 壳。
- `files_ge_1000` ≤80；新文件 <1000 行。
- 一次一个域。不 merge `main`，除非用户明确说。
- UI 文案走 `createT` / `t()`；无 `window.confirm` / `prompt` / `alert`。

---

## 2. 本刀锁定

新建 `src/hooks/useSessionChromeBadges.ts`（对标 `useSideWorkbenchChrome`）：

自持：

- `mutedSessionIds` + `SESSION_MUTE_CHANGE_EVENT`
- `unreadSessionIds` + `SESSION_UNREAD_CHANGE_EVENT`
- `planPendingSessionIds` + `markPlanPendingBadge`
- `manualUnreadHoldIdsRef`（当前正在看时手动标未读，离开再开才清）
- `applyClearSessionUnread` / `applyMarkSessionUnread`
- mute toggle、clear-all（含 `setAppDialog` 确认）
- 前台绑定 / focus / visibility 清未读
- tray / Windows taskbar `busyCount`（count = unread size）

`viewingSessionId` / `tr` / `setAppDialog` 晚绑在 `SessionChromeBadgesHost`。

`session.sessionId`、`isSecondaryWindow`、`trayBusyBadge`、`winTaskbarOverlay` 作 hook 入参（设置项与窗口角色不是徽章知识）。

Host 仍调 `markPlanPendingBadge`（plan chrome / host events / restore）。`sessionChangesById` 与 git dirty 仍留 host。

---

## 3. 测试

`src/hooks/useSessionChromeBadges.test.ts`（jsdom）：

1. 存储事件同步 mute set
2. `applyClearSessionUnread` 立刻从 set 去掉
3. 正在看时 `applyMarkSessionUnread` 打 hold，不清
4. 绑定前台会话清未读
5. `markPlanPendingBadge` 按 plan gate 增删
6. 超过阈值的 clear-all 走 `setAppDialog`
7. unread size 驱动 `traySetBusyCount`

---

## 4. 后续（不在本刀）

实测（W30 接线后）：

| | W29 ledger | W30 worktree | 新天花板 |
|--|----------|--------------|----------|
| 行数 | 14258（main@#1050 实为 14262） | **14062** | 14400 → **14200** |
| useState | 116 | **113** | 120 → **116** |
| useEffect | 71 | **65** | 74 → **68** |

新 hook 295 行。

其后 W31 账号 / 配额 → W32 MCP doctor → W33 setup / boot。
