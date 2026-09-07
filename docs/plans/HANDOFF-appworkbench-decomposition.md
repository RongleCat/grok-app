# Handoff — AppWorkbench 拆解与质量闸门修正

**交接时间**：2026-08-22 · **基线**：`main` @ `fae9b545`（干净，与 `origin/main` 一致） · **来源**：software-design-philosophy review

**执行位置**：worktree `D:/code/grok-app-appworkbench-decomp` · 分支 `refactor/appworkbench-decomposition`

## 现状（已核实的事实）

`docs/plans/CODE-QUALITY-PROGRESS.md` 标记 `FINAL: PASS`，但该结论建立在错误的度量对象上。

- `scripts/check-code-quality-gates.py` 的 `APP_*` 系列闸门只读 `ROOT/"src/App.tsx"`。
- `src/App.tsx` 现为 26 行 provider shell，域状态全部位于 `src/app/AppWorkbench.tsx`。
- `src/app/AppWorkbench.tsx`：**23,885 行 / 253 `useState` / 100 `useEffect` / 277 顶层 import**；函数体 `1170–18242` 为 hooks 与逻辑，`18243–23885` 是单个 `return` 的约 5.6k 行 JSX。
- 对比 baseline（App.tsx 24,843 行 / 318 `useState` / 111 `useEffect`）：规模基本未变，主要发生了搬迁。
- ledger 残余条目记 AppWorkbench 22,907，现 23,885，**已回涨约 1k**；AGENTS.md §7 的 growth freeze 按文件名写死在 `App.tsx`，对 workbench 无效。
- 闸门下界 `0 < app_lines()` 迫使 shell 保留一个假 state，注释已自陈：`src/App.tsx:11-13` "Keep a single shell lifecycle tick so gate budgets stay honest"。
- `files_ge_1000 = 80`，闸门 `≤ 80`，**顶格**，任意新增千行文件即红 CI。
- `src/lib`：511 个模块（99 个 <80 行，94 个 ≥500 行）。抽出的多为无状态 helper（浅模块），编排知识仍留在 workbench —— 277 个 import 就是这笔接口成本。

### WP-W0 实测更正（2026-08-22）

闸门改度量后（删 `shellEpoch` 之后）：`App.tsx.lines=24549`（shell 18 + AppWorkbench **24531**）、`useState=253`、`useEffect=100`、`files_ge_1000=80`。交接稿里的 23,885 是当时快照；当前文件更大。递减天花板起始 **25000 / 270 useState / 110 useEffect**（wave-b/c 的 APP_* 也必须一起抬，否则 `final` 模式会挂历史门槛）。

## 设计判断

问题不是"文件太大"，是**信息未被隐藏**：wave B/C 的拆分按代码形态与文件体积切，而非按知识归属切，因此每个 helper 的状态接线、生命周期、持久化仍回流到 workbench 顶层。改任何一个域都必须在 253 个 state 里判断耦合（认知负载 + 未知的未知）。Rust 侧（`commands/`、`session_manager/`）与 `src/i18n/`、`SettingsPage` 的拆分是合格的，不在本次范围内。

## 下一步（有序，含陷阱）

1. **先改闸门度量**：`app_lines()` / `app_hook_counts()` 改为 `src/App.tsx` 与 `src/app/AppWorkbench.tsx` 之和（或 glob `src/app/*.tsx`），移除 `0 <` 下界。
   **陷阱**：一改就会让 `final` 模式立刻 FAIL（24k vs ≤6000）。必须同时把 `APP_LINES_FINAL` 换成**递减天花板**（例如起始 24,000，每个 WP 下调），否则 CI 直接挂红，后续所有 PR 被阻塞。这一步要和 ledger 状态位一起改，不要单独提交。
   **已落地**：合计两文件；不用 glob（抽出到 `src/app/` 的域模块必须让指标下降）。
2. 删除 `src/App.tsx` 的 `shellEpoch` 假 state（必须在第 1 步之后）。**已落地。**
3. 同步 AGENTS.md §7：growth freeze 的对象改为 App shell + AppWorkbench 合计行数，明确"新状态落域模块"。**已落地；** `docs/llm-wiki/maintain.md` 同步。
4. **按信息拆 workbench**，每次一个域，域内自持 state + effect + 持久化，对外只暴露少量动词方法。建议顺序（依赖由弱到强）：layout/panes → search/palette → exports/share → sandbox+reliability → sessions（最后，最重）。不要再切"读-算-写"式的阶段模块。
   **WP-W1 已落地**：`useWorkbenchLayout` 自持开合/适配/拖拽/持久化。
   **WP-W2 已落地**：`useSearchPalette` 自持开合/查询/筛选/journal 扫描/键盘导航。
   **WP-W3 已落地**：`useSessionExportText` + `useSessionExportImage` 自持导出弹层/文件格式/分享卡。
   **WP-W4 已落地**：`useSandboxWizard` + `useReliabilityCenter` 自持向导/可靠性中心开合与 ring。下一步 sessions。天花板 **22550 / 232 / 96**。
   **WP-W5 已落地**：`useSessionCatalog` 自持列表、`sessions://changed` 刷新、侧栏多选。`openSession` / `newChat` 仍在 workbench。天花板 **22400 / 229 / 93**。
   **WP-W6 已落地**：`files_ge_1000` 80→**69**（CSS part、session/contextUsage 测试、stall history、IM channel catalog）。下一步 JSX view shell；sessions 仍欠 open/newChat。
   **WP-W7 已落地**：侧栏树 JSX → `WorkbenchSessionTree`（projects / orphans / 多选条）。`openSession` / `newChat` 仍在 workbench。天花板 **21800 / 229 / 93**。
   **WP-W8 已落地**：左栏 chrome/nav/UserMenu → `WorkbenchSidebar`（树作 children）。天花板 **21500 / 229 / 93**。
   **WP-W10 已落地**：中栏 chrome → `WorkbenchMain`（标题/toast/顶栏动作；chat/kanban/automations 作 children）。天花板 **21200 / 229 / 93**。
   **WP-W11 已落地**：右栏 → `WorkbenchResourcesAside`；search/export/sandbox/reliability 弹层 → `WorkbenchDomainOverlays`。天花板 **21080 / 229 / 93**。
   **WP-W12 已落地**：journal 管道 → `sessionJournalHydrate`（store + 返回值；abort / refine / reconcile 可单测）。`openSession` / `newChat` 仍在 workbench。天花板 **20880 / 229 / 93**。
   **WP-W13 已落地**：`openSession` → `useSessionNavigation`（gen/timer/viewing bind/hydrate/warm-connect）。
   **WP-W14 已落地**：`newChat` → `useSessionNavigation`。sendQueue / composer focus 在 `useSendQueue` 之后原地晚绑。天花板 **20520 / 229 / 91**。
   **WP-W15 已落地**：Doctor / 规则 / 历史归档确认 / worktree×3 / 快捷键 / 教程 / Voice → `WorkbenchChromeOverlays`。天花板 **20450 / 229 / 91**。
   **WP-W16 已落地**：AskUser / status / dashboard / rewind-fork / plan / schema / note-rules-turns-prompt → `WorkbenchSessionModals`。Compact / Queue / Settings / AppDialog / chat 体仍留 workbench。天花板 **20020 / 229 / 91**。
   **WP-W17 已落地**：composer 列（权限条 + 输入壳）→ `WorkbenchComposerColumn` + `WorkbenchComposerShell`（均 <1000）。`ConversationThreadLive` / Compact / Queue / Settings / AppDialog 仍留 workbench。天花板 **19080 / 229 / 91**。
   **WP-W18 已落地**：侧栏/composer context menu → `WorkbenchFloatingMenus` + project/session item builders（均 <1000）。`ConversationThreadLive` / Compact / Queue / Settings / AppDialog 仍留 workbench。天花板 **18120 / 229 / 91**。
   **WP-W19 已落地**：Settings 舞台 → `WorkbenchSettingsStage`（<1000）。host 仍持 settings state / 导航 / preload。`ConversationThreadLive` / Compact / Queue / AppDialog 仍留 workbench。天花板 **17600 / 229 / 91**。
   **WP-W20 已落地**：chat 舞台（thread + stall/plan/find/tasks/error）→ `WorkbenchChatStage`（<1000）。composer 作 children 留在 `main__stage`。Compact / Queue / AppDialog 仍留 workbench。天花板 **17240 / 229 / 91**。
   **WP-W21 已落地**：Compact/Queue 弹层 state+JSX → `useCompactDialog` + `useQueueEditDialog` + `WorkbenchComposerModals`（均 <1000）。host 仍绑 send/connect。AppDialog 仍留 workbench。天花板 **17020 / 221 / 90**。
   **WP-W22 已落地**：AppDialog 挂载 → `WorkbenchAppDialogStage`。host 仍 `setAppDialog` 打开。天花板 **16990 / 221 / 90**。
   **WP-W23 已落地**：composer 听写 FSM + live-voice 开合 → `useVoiceDictation`。host 仍持 voiceId/STT/auto-send 与 send()。天花板 **16650 / 218 / 88**。
   **WP-W24 已落地**：executeSend / submit / 提交后清稿 → `useComposerSend`。host 仍持 connect、live map、settings。天花板 **16030 / 218 / 88**。
   **WP-W25 已落地**：Settings 开合 / section / tab / focus / hash / last-route / native cover → `useSettingsNavigation`。labels 袋 → `settingsLabels.ts`。host 仍持 settingsGet 水合与 prefs 值。天花板 **15790 / 214 / 84**。
   **WP-W26 已落地**：Host AppSettings prefs 水合 → `parseAppSettingsPrefs` + `useAppSettingsPrefs`。locale/composer chips/CLI probe 仍在 boot。天花板见 W27。
   **WP-W27 已落地**：ensureConnected + connecting claims + liveMap 订阅 → `useSessionConnect`。#870 验收：改 settings 导航/prefs/connect 不必打开 host 函数体。天花板 **15350 / 160 / 83**。
   **WP-W28 已落地**：git worktree 列表 / 创建 / GC / ship / switch / remove / 徽章 → `useGitWorktreeChrome`。overlay 收成 `worktreeChrome` 一袋。git dirty 仍在 host，经 `applyStatusBranch` 补 branch chip。天花板 **14650 / 130 / 80**。下一步 Side Workbench。
   **WP-W29 已落地**：Side Workbench tabs / dock composer / Review focus / close-tab / git probe / chat→side 路由 → `useSideWorkbenchChrome`。host 只填 aside/open/toast 晚绑袋。`sessionChangesById` 与 git dirty 仍在 host。天花板 **14400 / 120 / 74**。方案见 [2026-09-06-appworkbench-w29-side-workbench.md](./2026-09-06-appworkbench-w29-side-workbench.md)。
   **WP-W30 已落地**：mute / unread / plan-pending Set、storage 事件、clear-on-view、tray/dock 计数 → `useSessionChromeBadges`。host 只填 tr / setAppDialog / viewing id。plan chrome 仍调 `markPlanPendingBadge`。天花板 **14200 / 116 / 68**。方案见 [2026-09-07-appworkbench-w30-session-badges.md](./2026-09-07-appworkbench-w30-session-badges.md)。
   **WP-W31 已落地**：account 快照 / loading / loginHint / 已存账号 / 配额表 / 登录切换登出 / boot refresh → `useAccountQuotaChrome`。host 只填 toast / dialog / setup.auth / IDLE 壳。天花板 **13900 / 108 / 66**。方案见 [2026-09-07-appworkbench-w31-account-quota.md](./2026-09-07-appworkbench-w31-account-quota.md)。
   **WP-W32 已落地**：MCP inspect 列表 + doctor 报告 → `useMcpDoctorChrome`。天花板 **13800 / 100 / 66**。方案见 [2026-09-07-appworkbench-w32-mcp-doctor.md](./2026-09-07-appworkbench-w32-mcp-doctor.md)。下一步 setup / boot（W33）。
   **pi**：协作者本机无 pi，按 owner 规则跳过。
   **5 个 worktree**：误会。远端 `main` 已含那些产品改动（本地只是 squash 后残留 SHA）。不挡大拆。
5. 5.6k 行 JSX 拆为 view shell + 域容器；modals 先经既有 `useAppDialogs` 收口。
6. `files_ge_1000` 从 80 降到 <70，留出余量。**WP-W6 已落地（69）。**
7. 复核 `src/lib` 中 99 个 <80 行模块，合并纯 pass-through。
   **WP-W9 已落地（无可合并项）**：99 个 <80 行模块里，纯 re-export 只有有意保留的 barrel：`src/lib/api.ts`、`src/lib/session.ts`、`src/lib/remoteIm/index.ts`。其余是真实 helper，不是 pass-through。不合并。

## 验收标准

- 改动单一域时无需打开 `AppWorkbench.tsx`。
- 闸门输出的 `App.tsx.*` 指标与真实编排规模一致（不再存在被度量绕过的文件）。
- `python scripts/check-code-quality-gates.py --mode final` 在**新度量**下 PASS，且 ledger 的 metrics log 追加真实数字。
- `AppWorkbench` 行数与 `useState` 数单调下降，禁止再次通过重命名/搬迁"达标"。

## 流程约束

- AGENTS.md §8：每完成一项（一次闸门改动、一个域抽取、一个自修 commit）立刻请 **pi** 审核校对，blocker 清掉才进下一项。
- 本次 review **未经 pi 校对**：本机 `Get-Command pi` 无结果，pi CLI 不可用。接手方需先解决 pi 可用性，或按规则记录失败原因后停在该项。WP-W0 记录：`docs/plans/2026-08-22-wp-w0-pi-review.md`。
- 分支卫生：另有 5 个 worktree 领先 `main`（`diagnose/long-chat-send-flash` 3、`fix/sidebar-other-session-inset` 5、`fix/settings-shortcut-toggle` 2、`fix/windows-snap-min-width` 1、`fix/narrow-ctrl-b-window-size` 1）。它们都会碰 workbench，**开始第 4 步大拆前先把这些落地或明确放弃**，否则冲突成本极高。
