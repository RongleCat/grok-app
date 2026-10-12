# ADR 0005 — PR 监视以会话为单位，PR 属于仓库而非分支

- 状态：已采纳
- 日期：2026-10-12

## 背景

PR Monitor 第一版（上游 PR #1322）把「监视」建成**分支的附属物**：注册表以
`projectPath + branch` 为键，composer 分支 chip 显示「当前分支对应的 PR」，分支菜单只列
「当前分支绑定的 PR」+「本会话在其他分支挂载的 PR」。

这条绑定不是 GitHub 的事实：PR 是提到**仓库**的，head 分支只是它的一个属性；在功能分支
上开 PR 是开发约定。
把监视挂在分支上，直接导致两处走形：

- `gh` 的轮询循环按 `projectPath + branch` 记账，一个会话要盯两个 PR 时，第二行只能靠
  「其他分支的挂载」绕回来（且要求挂载时带上 sessionId，否则整段列表根本不显示）；
- 客户端只能在分支菜单里看到「当前分支的 PR」，而仓库里的测试 PR #1 / #2 中永远有一行
  看不见——正是本次要修的症状。

## 决策

**监视的身份是「会话 + 仓库 + PR 号」，分支不进入模型。**

- 宿主注册表以 **session id** 为键，一个会话持有任意多个 PR watch；命令是
  `pr_monitor_watch(sessionId, projectPath, prNumber)` /
  `pr_monitor_unwatch(sessionId, prNumber)` / `pr_monitor_state(sessionId)`；事件负载里没有
  branch 字段，PR 的 head 分支只作为快照属性用于展示。
- 客户端列出**本仓库的全部 open PR**（一行一个，行尾铃铛独立开关），chip 只显示
  「本会话监视了几个」，不再点名某个 PR。
- 监视生命周期随会话：删除会话即停止；切聊天、会话被后台停放或闲置回收都不停。

## 影响

- 唤醒投递整体移到宿主：宿主自己判断会话忙闲、排队、拼本地化提示（Rust 侧文案表
  `pr_monitor_i18n.rs`，15 语言，`en` 为权威）并经 `session_api` 的 turn 路径投递。客户端
  不再持有队列、diff、prompt 或任何 watch 状态，只渲染宿主推送的行。
- 代价是把 `buildFixCiPrompt` / `buildPrCommentPrompt` 的**同构组合**搬进宿主；TS 那份继续
  服务 PR Hub 的按钮，两处需要同步维护（结构由各自的测试钉住）。
- 「当前分支的 PR」这一概念从此不存在：没有 `bindPrToBranch`，没有分支 chip 上的 PR 号，
  也没有 `prWatchKey(projectPath, branch)`。
