# Spec: PR Monitor —— PR 与分支捆绑展示，PR 更新唤醒当前会话

Status: ready-for-agent
Tracker: Linear（本环境不可达，见「Further Notes」）—— 工单见 `## Tickets`。

## Problem Statement

用户在一个功能分支上工作时，Grok App 只能被动地被查看：聊天的 composer 上下文栏显示了当前目录和当前分支，但没有任何与 GitHub PR 相关的信息。想让 Agent 跟进 PR，用户必须自己离开对话、打开 GitHub、把评论或 CI 失败手工复制回对话框。PR 上发生的事（新评论 / review、CI 由 pending 变 fail、CI 转绿、可合并状态变化）不会到达会话，因此「Agent 主动跟进 PR 更新」这件事今天完全靠人肉触发。

## Solution

把「PR」和「分支」在 composer 上下文栏里绑在一起：

1. 当某个 PR 与当前分支绑定并且被**监视挂载**后，分支区在分支名之后显示该 PR 的序号与标题（标题超长截断为省略号），视觉与逻辑上 PR 都属于这个分支，遵循 git 原生语义（PR 的 head 分支等于当前分支）。
2. 挂载后，Host 侧按固定间隔轮询该 PR；当快照发生实质变化时，App 唤醒**被挂载的那个会话**，投递一条针对本次更新的跟进提示，由 Agent 主动处理（新增评论 → 回应/改代码；CI 失败 → 修 CI；CI 转绿 → 复核与收尾）。

无 PR、`gh` 缺失、非 git 仓库、分支为 detached 时，分支区只显示分支并软失败，绝不伪造 PR。

## User Stories

1. 作为在功能分支上工作的开发者，我希望 composer 分支区显示该分支对应的 PR 序号和标题，这样我不必切到浏览器就知道当前在给哪个 PR 干活。
2. 作为开发者，我希望 PR 标题过长时被截断成省略号，这样窄的上下文栏不会被撑破或换行。
3. 作为开发者，我希望 PR 只在我要跟进它时才显示（显式挂载），这样默认界面保持安静。
4. 作为开发者，我希望挂载动作就在分支菜单里（同一个分支 chip 内），这样 PR 与分支的绑定关系在交互上也成立。
5. 作为开发者，我希望挂载后分支 chip 能明确看出「正在监视」，这样我知道 App 会在 PR 更新时通知我。
6. 作为开发者，我希望 PR 收到新评论或 review 时，会话自己继续，Agent 直接读到评论内容并着手处理。
7. 作为开发者，我希望 CI 从 pending 变成失败时，会话被唤醒并拿到失败 check 的名字与状态，这样不必自己贴日志。
8. 作为开发者，我希望 CI 转绿或 PR 变成可合并时也能被唤醒，这样我能及时收尾合并。
9. 作为开发者，我希望同一份更新只唤醒一次，重复轮询不刷屏。
10. 作为开发者，我希望 Agent 正在跑一轮时不要打断它，更新排队等本轮结束再投递。
11. 作为开发者，我希望 PR 的更新提示里带着 PR 序号、标题、URL 与评论/CI 的具体内容，而不是一句空洞的「PR 更新了」。
12. 作为开发者，我希望在中文界面里跟进提示也是中文（15 个语言一致）。
13. 作为开发者，我希望挂在后台（窗口隐藏到托盘）时监视仍然有效，不必一直把窗口摆在前台。
14. 作为开发者，我希望 `gh` 未安装或未登录时软失败，界面不显示假 PR、不报致命错误。
15. 作为开发者，我希望当前分支没有对应 PR 时分支区保持原样（只有分支名）。
16. 作为开发者，我希望在 detached HEAD 上不显示任何 PR。
17. 作为开发者，我希望点击 PR 行能直接打开 PR Hub（既有面板），而不是造一个平行界面。
18. 作为开发者，我希望在 PR 菜单里能一键停止监视。
19. 作为维护者，我希望 App 完全退出后不再声称在监视（进程内监视，重启即失效，如实呈现）。
20. 作为维护者，我希望 Host 不再被 `FORCE_COLOR` 之类的环境变量污染 `gh --json` 输出，导致解析失败后显示空的 PR 列表。

## Implementation Decisions

**分层：粗粒度在 Host，细粒度与文案在 TS。**

- Host（Rust）新增 PR 监视模块：
  - 内存中的 watcher 注册表（进程生命周期），键为 `projectPath + branch`，值为 `{prNumber, sessionId, intervalSecs, lastFingerprint, lastSnapshot, mountedAt}`。
  - 一个 tick 循环（与既有 automations runner 同构：进程活着就 tick，窗口隐藏到托盘仍有效；完全退出即停止，不假装有守护进程）。
  - 每个 watcher 到期时执行一次 `gh pr view <n> --json …`（单次调用同时覆盖 PR 字段与 comments/reviews，复用既有解析器）。
  - **去重靠指纹**：把 PR 快照归一化为一个稳定指纹字符串（序号 / 标题 / state / draft / mergeable / updatedAt / checks 计数 / 评论 id 集合）。指纹未变则不产生任何事件；变了才发事件。
  - 事件 `pr-monitor://update` 负载包含 `{watcherId, projectPath, branch, prNumber, url, title, prev, next, at}`——同时给出前后两个快照，让 TS 侧做权威的细粒度 diff。
  - 命令：`pr_monitor_watch` / `pr_monitor_unwatch` / `pr_monitor_list` / `pr_monitor_poll_now` / `pr_monitor_consume_pending`（挂载种子、漏事件回收）；不提供 status 命令，`pr_monitor_list` 已给出每个 watch 的轮询/更新/错误状态。
  - Host **不做**语义 diff、**不**构造跟进文案（i18n 与复用既有 prompt builder 都在 TS 侧）。
- TS 纯逻辑模块 `prMonitor`：
  - `bindPrToBranch(prs, branch)`：git 原生绑定——取 `headRefName` 等于当前分支的 PR（去掉 `refs/heads/` 前缀、大小写敏感、忽略已合并/关闭的候选、优先 open）。分支为空或 detached 时不绑定。
  - `truncatePrTitle(title, max)` / `formatPrChipLabel(pr, max)`：长度受限 + 省略号；`max` 为字符数，按码点计数避免切坏代理对。
  - `diffPrSnapshots(prev, next)`：权威细粒度 diff，产出更新项（新评论 / 新 review / CI 由非失败变失败 / CI 转绿 / mergeable 变化 / PR 关闭或合并 / 标题变化），带稳定去重键。
  - `buildPrUpdatePrompt({pr, updates, checks, tr})`：构造发给会话的跟进提示；优先复用既有 `buildFixCiPrompt`（CI 失败）与 `buildPrCommentPrompt`（新评论/review），再叠加 i18n 的头部与任务段。总长度沿用既有 prompt 上限。
  - `pendingAfterBusy(pending, result)` / `shouldFlushPending(sessionState, pending)`：忙碌时不打断，排队等会话空闲再投递的纯策略。
- TS 编排 Hook `usePrMonitor`：
  - 输入 `{enabled, projectPath, branch, sessionId, locale, sendTurn?}`；`sendTurn` 默认 `api.sessionSend`（可注入，便于测试）。
  - 行为：解析当前分支绑定的 PR（复用既有 `git_pr_list`）；挂载 / 卸载走 Host 命令；订阅 `pr-monitor://update`；收到事件后 `diffPrSnapshots` → 非空则构造提示 → 投递唤醒；会话忙碌时排队，空闲后 flush；同一条更新的去重键只唤醒一次。
- 组件：分支 chip（composer 上下文栏的既有分支区）新增可选的 PR 展示：
  - 已挂载且绑定到 PR：分支名之后显示 `#<number>` 与截断标题（同一 chip 内，视觉捆绑）。
  - 分支菜单新增 PR 区：PR 行（序号 + 标题 + 打开 PR Hub）与挂载/停止监视开关。
  - 无 PR / 不可用：chip 与菜单都不出现 PR 行，只有分支。
- 复用既有能力，不造平行实现：PR 列表/详情/checks/comments 走既有 Host 命令与解析；fix-CI / 评论 → prompt 走既有 builder；打开 PR Hub 走既有深链（`prHubDeepLink` / settings anchor）。
- i18n：所有新增文案走 `createT`/`t`，15 个语言与 `en` 锁步。
- 文档：新增 `docs/llm-wiki/pr-monitor.md`，并在 `AGENTS.md` 的 llm-wiki 索引里登记。

**已知边界（如实呈现，不做假宣称）**：watcher 只在进程存活期间有效（与 automations 一致的诚实模型）；完全退出后不监视。挂载不持久化，重启即失效，界面只反映进程内真实状态。

## Testing Decisions

好的测试只断言外部可观察行为，不锁实现细节；不复制被测逻辑，不 mock 被测单元。

- Rust 纯函数（prior art：`automation_runner.rs` / `git_pr_hub.rs` 模块内 `#[cfg(test)]`）：`gh` argv 构造（字段集合、序号、无 flag 注入）、快照归一化（用真实 `gh --json` 形状的样例，含 `statusCheckRollup` 无 `bucket` 的回退分支）、指纹稳定性（同输入同指纹；评论新增/CI 变化必然改指纹）、到期判定与间隔钳制。会话与网络不参与这些测试。
- TS 纯函数（prior art：`src/lib/gitPrHub.test.ts`、`prReviewWorkbench.test.ts`）：绑定（含 `refs/heads/` 前缀、detached、无匹配、多个候选）、截断（含多字节/代理对与边界 `max`）、`diffPrSnapshots`（新评论、review、pending→fail、pending→success、无变化返回空）、`buildPrUpdatePrompt`（真实调用既有 builder，断言输出含序号/标题/作者/失败 check 名）、忙碌排队策略。
- TS 唤醒链路：以「真实发布的函数」驱动 `事件负载 → diff → prompt → sendTurn`，只 stub 会话传输（注入 `sendTurn`）与来源事件，不替换 diff / prompt / 策略本身；断言投递文本确实指向本次更新，且同一条更新只投递一次。
- 组件渲染（prior art：`ComposerWorktreeMenu.test.tsx` 的 server-render）：给出绑定 PR 时分支区渲染出 `#<number>` 与截断标题；未挂载 / 无 PR / 不可用时不得渲染假 PR。
- Host 真实 `gh` 往返：以 `#[ignore]` 标记的 live 测试在本机对真实 PR 跑一次，人工执行并把输出存证；CI 不依赖网络。

## Out of Scope

- Linear 之外的 issue tracker；本环境无法访问 Linear（见 Further Notes）。
- GitLab / Bitbucket / Jenkins 等非 GitHub CI 提供商。
- 重做或替换既有 PR Hub（列表 / 详情 / 评论）与 Ship 流程。
- 系统通知 / IM 通知渠道；唤醒只在会话内。
- 监视间隔、开关等可配置 UI；挂载动作本身即开关。
- 无 UI 进程的独立守护进程式监视；不做假宣称。
- 挂载状态跨重启持久化。

## Tickets

Linear（team **BOR** / project **Grok App**）：spec **BOR-98**，子工单 **BOR-99**（T1）、**BOR-100**（T2）、**BOR-101**（T3）、**BOR-102**（T4），blocked-by 关系按下方阻塞边建立。开发期间工单以本地文件 tracker（`issues/01..04`）维护，Linear 于交付阶段回填。

垂直切片（tracer bullet），括号内为阻塞边：

1. **T1 — Host PR 监视：挂载 / 卸载 / 列表 + 轮询 + 指纹去重 + 更新事件**（`BOR-99`，无阻塞）。交付：Host 能在进程存活期间监视某个 PR，变化时发出前后快照事件，未变化不打扰；`gh` 调用不再被颜色环境变量污染。验收：cargo 单测覆盖 argv / 归一化 / 指纹 / 到期与间隔策略；live `gh` 往返有存证输出。
2. **T2 — 分支区 PR 显示与挂载开关**（`BOR-100`，阻塞于 T1）。交付：composer 分支 chip 在挂载后显示 `#序号 + 截断标题`，分支菜单里有 PR 行与挂载/停止监视开关，可打开 PR Hub；无 PR / 不可用时软失败不伪造。验收：渲染测试 + 15 语言文案 + 类型/风格检查通过。
3. **T3 — PR 更新唤醒当前会话**（`BOR-101`，阻塞于 T1、T2）。交付：收到更新事件后，会话自动收到一条针对该更新的跟进提示并继续处理；同一条更新只唤醒一次；会话忙碌时排队不打断。验收：真实发布函数的 diff / prompt 单测 + 只 stub 会话传输的唤醒链路测试。
4. **T4 — 文档、质量门与交付**（`BOR-102`，阻塞于 T1、T2、T3）。交付：`docs/llm-wiki/pr-monitor.md` 与 AGENTS 索引；全部既有门 0 错误（typecheck / lint / test / build:ui / cargo fmt·clippy·test）；分支推送并创建 PR。

## Further Notes

- **Tracker**：工单发布在 Linear `Boring Link`（BOR）/ project `Grok App`：spec `BOR-98`，工单 `BOR-99` … `BOR-102`（各含验收清单与证据链接，阻塞边为 Linear 原生 blocked-by）。开发期间本会话没有 Linear 访问（无 MCP 工具、无 `linear`/`lcli` CLI），工单以本地文件 tracker 形式维护（`issues/01-host-pr-monitor.md` … `issues/04-docs-gates-ship.md`）并随 spec 落盘；交付阶段打通 Linear MCP 后一次性回填，工单状态如实反映最终结果，未虚构开发期间的 Linear 活动记录。
- PR↔分支绑定遵循 git 原生语义：一个分支最多一个 PR（同 head 分支的多个 PR 取 open 中最新者），PR 在 GitHub 上本来就以 head 分支为身份。
- 监控对象是「squash/rebase 前的 head 分支」，PR 被合并后 watcher 在下一个 tick 看到 state 变化，唤醒一次后即视为终态并可卸载。
- 该特性不改动 PR Hub / Ship 流程；PR Hub 仍是唯一详情的落点。
