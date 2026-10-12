# Spec: PR Monitor 重构 —— 监视以会话为单位，列表以仓库为单位

Status: delivered
前序：`docs/plans/2026-10-10-pr-monitor-wake-spec.md`（已随上游 PR #1322 交付，本文件描述它的重构）。

## Problem Statement

第一版 PR Monitor 把「监视」建成**分支的附属物**，于是有两处走形：

1. 宿主按 `projectPath + branch` 记账，一个会话想同时盯多个 PR，只能靠「在其他分支挂载」
   绕回来 —— 而那条通路要求挂载时带上 sessionId，否则整段列表根本不渲染；主页面上永远只
   看得到「当前分支的那一个 PR」。
2. 客户端把「哪个 PR 属于我」算在分支上（`bindPrToBranch`），chips 上显示 `分支 #1316 标题`。
   仓库里已有两个测试 PR（#1 `test/pr-monitor-wake`、#2 `test/pr-monitor-wake-2`），界面上
   却只能看到与当前分支同名的那一个。

事实层面：PR 是提到**仓库**的，head 分支只是 PR 的一个属性。在功能分支上开 PR 是 GitHub 的
开发约定，不是模型。

另外，第一版的唤醒链路整个在 TS（diff、prompt、排队、投递），因此：

- 窗口不在、切到别的聊天、客户端 hook 未挂载时，没有人投递唤醒；
- 排队只在客户端，会话忙时排的队与 composer 自己的 follow-up 队列是两套东西。

## Solution

**监视身份 = 会话 + 仓库 + PR 号；分支不进入模型。宿主全权投递。**

1. 宿主注册表以 session id 为键，一个会话持有任意多个 PR watch（每会话上限 32）。命令收敛为
   `pr_monitor_watch(sessionId, projectPath, prNumber, intervalSecs?)` /
   `pr_monitor_unwatch(sessionId, prNumber)` / `pr_monitor_state(sessionId)`；事件为
   `pr-monitor://state`（该会话的 watch 行，任何变化后推送）与 `pr-monitor://wake`
   （queued / delivered / settled / failed）。挂载时宿主自己播种基线，不再需要客户端
   `poll_now`；pending 由宿主持有，`consume_pending` 消失。
2. 分支菜单的「拉取请求」区变成**整仓 open PR 列表**：一行一个 PR，行尾铃铛独立开关，
   点行打开既有 PR Hub 深链。chip 只显示「本会话监视了几个」（`2 watching`），不点名 PR。
3. 唤醒链路搬到宿主：语义 diff、**每 PR 一条待投递**（后来的变化合并进这一条，同 kind 取最新，
   `from → to` 保留起点）、本地化提示（含失败 check 名与新评论正文）、排队与投递都由宿主做，
   经 `session_api::prepare_send` + `dispatch_turn` 投递 —— 与本地 session API 同一条路：
   会话没有存活 agent 就先 connect，会话正忙就进 composer 自己的 follow-up 队列。
4. 文案：宿主写进会话记录的文字放在 Rust 侧 `pr_monitor_i18n.rs`（15 语言，`en` 为权威，
   占位符与 `en` 锁步）；客户端渲染的文字（区块、铃铛、chip 计数、toast）留在 `src/i18n/`。

## User Stories

1. 作为开发者，我希望分支菜单里能看到**本仓库的全部 open PR**（含 draft），这样我不必先切到
   对应分支才能看到另一个 PR。
2. 作为开发者，我希望一个会话能同时监视多个 PR，每行一个铃铛，点一个不关闭菜单。
3. 作为开发者，我希望 chip 只说「我在盯几个 PR」，而不是假装某个 PR 属于当前分支。
4. 作为开发者，我希望 PR 的 head 分支仍然可见（它是 PR 的属性），但不再决定我能不能看到它。
5. 作为开发者，我希望 PR 更新时**我正在别的聊天里**也能被跟进：唤醒投给挂载它的那个会话。
6. 作为开发者，我希望会话忙时更新不打断当前轮次，且同一条更新只等到一轮、合并成一条提示。
7. 作为开发者，我希望会话没有存活 agent 时唤醒能把会话接起来，而不是静默失败。
8. 作为开发者，我希望 PR 被合并/关闭后只跟进一次然后停止监视。
9. 作为开发者，我希望 gh 未安装/未登录时软失败：不出现假 PR，也不假装「没有变化」。
10. 作为维护者，我希望监视随会话存在：删除会话即停止；切聊天、后台停放、闲置回收都不停。
11. 作为维护者，我希望别的会话的监视在这里不可见也不可停（每会话私有）。
12. 作为维护者，我希望文案只有一处权威：提示在宿主（会写进记录），UI 在 TS，两边都与 `en` 锁步。

## Implementation Decisions

**宿主（`src-tauri/src/pr_monitor.rs`）**

- `HashMap<sessionId, SessionMonitor>`，monitor 持有 `HashMap<prNumber, Watch>`；每会话上限 32；
  `intervalSecs` 默认 60、钳制 20–3600；tick 10s、启动延迟 8s。
- 每个到期的 watch 一次 `gh pr view <n> --json …`（PR 字段 + comments + reviews，单次调用同时
  覆盖 fix-CI 需要的 check 行）。
- 指纹去重（`snapshot_fingerprint`）：首次轮询只播种；指纹未动不发事件；动了才做语义 diff
  （新评论/review、CI 由非失败转失败、CI 转绿、state/mergeable/title 变化）；diff 为空不唤醒。
- `PendingWake`：每 PR 一条，`fold` 合并后来的变化（同 slot 取最新，`from → to` 保留起点）。
- 投递：`flush_session` 先看 `SessionManager::session_turn_busy`，忙则把「排队」通知只发一次；
  空闲则取最早的一条待投递（每会话每轮最多投一条），经 `session_api::prepare_send` +
  `dispatch_turn_or_timeout` 投递；`TurnStatus` 映射为 delivered / queued / Retry（下次 tick 再试，
  最多 2 次）/ failed(原因)。终端态（MERGED/CLOSED）投递后丢弃该 watch，状态 `settled`。
- 提示由宿主拼：header（带 URL 时带 URL）、变化行、新评论块（正文）、fix-CI 块（失败行，超过
  25 条记省略）、task 行，总长 ≤ 12000 字符；正文与 check 描述先做凭据擦除
  （`sk-…` / `xai-…` / `Bearer …`，对应 `src/lib/redact.ts`）。
- 文案：`src-tauri/src/pr_monitor_i18n.rs`，`MessageKey` 12 项 × 15 语言 + `render()` 填占位符；
  语言取 `tray_i18n::app_locale()`。
- 命令与事件：见 Solution；`PrMonitorState` / `PrMonitorWake` 用 camelCase 序列化；推送的
  watch 行只带「UI 会显示的东西」（`PrSnapshotView`，不含会话内容）。
- 复用而非重造：`git_pr_hub` 的 `parse_gh_pr_view_with_checks`（新增，返回 PR + check 行）、
  `check_rows_from_rollup`（新增）、`parse_gh_pr_comments_json`、`run_gh_in_project`、
  `prepare_project`；`process_util::apply_no_color_env_std`。

**客户端（TS）**

- `src/lib/api/prMonitor.ts`：3 个命令 + 2 个订阅（`onPrMonitorState` / `onPrMonitorWake`）。
- `src/lib/prMonitor.ts`：纯渲染逻辑 —— `truncatePrTitle` / `formatPrRowLabel` /
  `formatChecksLine` / `sortPrsForList` / `prListRows` / `pendingWakeCount` / `lastChangeOf` /
  `watchErrorOf` / `describeWake`，以及宿主负载的镜像类型。
- `src/hooks/usePrMonitor.ts`：读两次（每次列表出现读一次整仓 open PR；订阅时读一次本会话
  watch），之后只渲染推送；`toggleWatch(prNumber)` 挂载/停止并如实报错。
- `src/components/ComposerPrListSection.tsx`：整仓 PR 列表区块（行 + 行尾铃铛 + 变更/排队/失败
  提示行）；`composerPrSection({rows, loading, available})` 供菜单预留高度。
- `ComposerWorktreeMenu`：chip 计数与区块渲染；`WorkbenchComposerColumn` 用 `prListRows` 组装行。
- i18n：删除 14 个已搬到宿主的键与 2 个分支绑定残留键（`noPr` / `chipTip`），新增
  `chipCount` / `chipCountTip` / `empty` / `unwatchFailed`；15 语言与 `en` 锁步。

## Testing Decisions

- Rust 纯函数单测（模块内 `#[cfg(test)]`）：gh argv、快照与 check 行解析（含真实 `gh --json`
  形状、无 `bucket` 的回退）、指纹稳定性与分隔符安全、首次播种、一个真实变化只发一次、
  「会话不关心的 revision 不唤醒」（仅 updatedAt 变化、draft 切换）、部分 CI 恢复不唤醒、
  合并语义（同 slot 取最新、`from → to` 保留起点）、提示内容与预算、凭据擦除、
  `TurnStatus → WakeOutcome` 映射、每会话上限与 `validate_watch`。
- Rust 文案表测试：15 语言每键非空、占位符与 `en` 完全一致、抽查翻译（de/ja/pt-BR/zh）、
  未知语言回退 `en`、`render` 填充与保留未提供的占位符。
- `#[ignore]` 真实往返：`live_gh_round_trip`（走发布的 poll 路径打真实 PR）与
  `live_watch_round_trip`（真实仓库上的挂载/列出/卸载，含跨会话隔离）。
- TS：`prMonitor.test.ts`（标签、整仓列表与排序、行组装、会话级提示、唤醒 toast 文案，含 zh）、
  `usePrMonitor.test.tsx`（列表只读一次、watch 只读一次、只认自己的推送、唤醒 toast、
  挂载/停止与失败上报、refresh）、`ComposerWorktreeMenu.pr.test.tsx`（整仓两行都在、
  每行铃铛、chip 计数、空态与加载态、portal/材质契约）、`ComposerWorktreeMenu.test.tsx`
  （chip 计数与「不点名 PR」）。

## Out of Scope

- webhook 中继（smee 等真推送通道）与长驻 `gh pr checks --watch` 子进程。
- 跨会话共享 watch（引用计数）、监视状态跨重启持久化。
- 非 GitHub 宿主；PR Hub 面板内的挂载开关。
- 仓库外部的 issue tracker：切分与进度以本文件所在目录下的 plan 文档维护。

## Delivery slices

沿用上一版 spec 的四刀切分，开发期间以本文件所在目录下的 plan 文档维护：

1. 宿主监视：挂载 / 卸载 / 列表 + 轮询 + 指纹去重 + 更新事件。
2. 客户端列表：分支菜单「拉取请求」区，一行一个 PR。
3. 宿主投递：把跟进提示投进被挂载的会话（忙碌时排队）。
4. 文档、质量门与交付。

## Further Notes

- 上游状态：第一版实现已随 **RongleCat/grok-app#1322** 合入（`feat(pr-monitor): band the
  branch-bound PR into the composer chip and wake the chat on updates`）；本 PR 是它的重构，
  面向上游 `main` 开 draft。
- 被接受的 UI 设计（一行一个 PR、行尾铃铛、可同时挂载多个）来自本仓库 fork 的
  `test/pr-monitor-wake` 分支，本次按 B 的模型重写实现，不搬运其分支身份相关的 props/CSS。
- 「gh 启动的监视进程」在实现里是宿主进程内的一个 tick 循环 + 每个到期 watch 的一次 `gh`
  调用：没有独立守护进程，也不做假宣称（见 `docs/llm-wiki/pr-monitor.md` 的 Honest limits）。
- 「不轮询」的落点：客户端不再向宿主拉取监视状态（`pr_monitor_list` / `consume_pending`
  这类周期性/事后拉取全部删除，只留订阅时的一次性读取与挂载/卸载命令）；对 GitHub 的读取仍是
  宿主按间隔调用 `gh`——GitHub 没有面向本地客户端的推送 API，不引入中继就没有真推送。

## Verification

自动化门（本地全绿）：

- `tsc -b --pretty false`、`eslint src --max-warnings 0`、`vitest run`（7930+ 通过）、
  `vite build`；
- `cargo fmt --all -- --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`。

真实往返（本机、有网、`gh` 已登录）：

- `PR_MONITOR_LIVE_PR=<n> cargo test live_gh_round_trip -- --ignored --nocapture`：
  走发布的 poll 路径打真实 PR，打印 state/checks/评论数/check 行数/指纹。
- `cargo test live_watch_round_trip -- --ignored --nocapture`：真实仓库上挂载 / 列出 / 卸载，
  并确认跨会话隔离。

端到端验收（在两个测试 PR 上）：

| 步骤 | 期望 |
| --- | --- |
| 打开分支菜单 | 「拉取请求」区同时列出 #1 与 #2（不再是当前分支那一个） |
| 依次点两行的铃铛 | 两行都进入监视态，chip 显示 `2 watching`，菜单不关闭 |
| 把 #1 的验收文档 `STATUS` 改成 `DONE` 并推送 | CI 由失败转通过 → 会话收到一条跟进提示 |
| 在 #2 下评论 | 新评论 → 会话被唤醒（若正忙则先提示排队，空闲后投递） |
| 合并/关闭任一 PR | 该 PR 跟进一次后停止监视（`settled`），列表中消失 |

证据落在本文件的「Verification」段与此 PR 的描述里（含实际命令与输出片段）。
