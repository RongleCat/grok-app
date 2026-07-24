# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Maintainer rule (AI):** before every `vX.Y.Z` tag, complete `## [X.Y.Z]` below.  
CI Release body = this section only (via `scripts/changelog-for-release.py`; no repeated download/install boilerplate).  
See `docs/llm-wiki/release.md`.

## [Unreleased]

### Fixed

- **Session data mode switch**: flipping independent↔shared recycles live, background, and parked agents so none keep the old `GROK_HOME`; toast when agents restart. Import still never forces shared mode (E04/E05).

## [0.1.6] - 2026-07-24

> **Highlight:** early-turn fix (#52), multi-session stream, shared-mode CLI import, store write locks.

### Added

- **Import CLI sessions (shared mode)** (#57): Settings → General lists `~/.grok/sessions`; import one / all into App journals.
- **Session diagnostic export**: session menu → redacted zip (messages, runtime, CLI probe, logs, agent trail) for bug reports (#52).
- **Multi-session background stream** (#56): switching chats keeps busy turns streaming under the process cap.
- **A11y** (#53): conversation live region; permission / modal focus trap + Escape; ask_user `aria-pressed`.

### Fixed

- **Premature turn end** (#54 / #52): defer `prompt_complete` while tools, permission, plan, or ask_user are still open.
- **Orphan chat cwd**: no-project agents use `$HOME` instead of Dock `cwd=/` (#52).
- **Empty-run soft signal**: toast when a non-ask turn ends with zero tool calls (#52).
- **Store JSON write lock** (#55): exclusive lock + atomic rename; quarantine corrupt store files.
- **Git worktrees UI**: hide section for non-git folders; stop loading flicker; compact single-line rows.

### Community

- PRs **#53–#57** (sonnemusk). Closed #42 (worktrees), #52 (early end_turn).

**中文**
- 新增：CLI 会话导入（shared）、诊断包、后台多会话流式、无障碍。  
- 修复：工具/权限未完不提前就绪；无项目 cwd=`$HOME`；store 写锁；worktree 非 git 隐藏与紧凑行。

## [0.1.5] - 2026-07-24

> 中英文对照 / Bilingual notes.
>
> **Highlight:** Git worktree switch, per-project permission tiers, resource-pane text edit, clipboard image paste, structured error deck.

### Added

- **Git worktree switch** (#46): project chip lists `git worktree` siblings and rebinds session cwd (reuse / add project, trust inherited when possible).
- **Per-project permission default** (#47): trusted projects pin Ask / Accept edits / session / Deny / Full access; untrusted always forces Ask; cascade session → project → app.
- **Resource pane text edit** (#50): edit/save text·code·markdown with dirty state, ⌘/Ctrl+S, mtime conflict (reload vs overwrite), discard on close.
- **Structured error deck** (#51): CLI / auth / network / crash (+ quota, connect, process limit, timeout) cards with problem · cause · primary · secondary actions (Doctor / Account / Providers / Reconnect).

### Fixed

- **Composer image paste** (#48): WebView screenshot paste via event Files → Clipboard API → native OS clipboard (arboard → attachments/paste PNG); attach toast + clear errors.

### Community

- Integrated community PRs **#46–#48**, **#50–#51** (sonnemusk).
- README features + contributors list refreshed for shipped community work.

**中文 · 新增**
- Git worktree 从项目 chip 切换；可信项目默认权限阶梯；资源面板文本就地编辑保存；结构化错误卡（问题/原因/主次操作）。

**中文 · 修复**
- 粘贴截图/剪贴板图片可正确挂附件（含 macOS 系统剪贴板回退）。

**中文 · 文档**
- README 功能表与贡献者名单同步已合并社区能力。

## [0.1.4] - 2026-07-24

> 中英文对照 / Bilingual notes.
>
> **Highlight:** Plan review in the resource pane, top-only progress bar, opt-in keychain, custom-provider account usage.

### Security

- **Keychain opt-in on cold start** (#44): default keeps API keys in `secrets.json` (0600); OS keychain is Settings → General opt-in so app launch no longer prompts for Keychain unlock. Existing installs that already used keychain keep that mode.

### Added

- **Plan resource review** (#45): full plan Markdown + steps in the right **Resources → Plan** workbench; top sticky bar shows execution progress only (`n/m`, current step, meter); 「在资源中打开」/ review-gate auto-open; expand steps on demand; no plan card in the chat transcript.
- **Sticky Plan/Goal status bar** (L04, #41): progress + review actions above the chat stage.

### Fixed

- **macOS titlebar**: traffic-light safe inset so the sidebar panel toggle no longer underlaps red/yellow/green.
- **Composer placeholder**: hide overlay as soon as the DOM has typed/IME glyphs.
- **Chat scroll flicker**: ignore sub-4px content height noise while stick-to-bottom follows.
- **Custom provider account UI** (#43): sidebar shows active custom provider name/model and local usage instead of official OAuth identity when a custom route is active; hide official quota/login actions for that route.
- **Plan dismiss**: soft-hide top progress bar during execution without wiping plan state; review-gate dismiss still abandons the RPC.
- **Dead copy**: remove obsolete `composer.attachLater`.

### Community

- Integrated **#41**, **#43–#45** (plan UX, keychain startup, custom provider usage).

**中文 · 安全**
- 钥匙串改为设置里可选；默认仍用 `secrets.json`，避免冷启动弹系统密码框。

**中文 · 新增**
- 计划：顶部只显示执行进度；完整正文在资源面板 Markdown 审阅（批准/请求修改）；步骤按需展开。
- Plan/Goal 状态条（L04）。

**中文 · 修复**
- mac 交通灯与侧栏按钮重叠；输入框 placeholder 遮字；长对话滚动闪动；自定义中转时账户区与本地用量展示。

## [0.1.3] - 2026-07-24

> 中英文对照 / Bilingual notes.
>
> **Highlight:** OS keychain secrets, stream-stall cancel, MCP/Plugins enable, composer send queue, session switch fix.

### Security

- **API keys in OS keychain** (C07): `officialApiKey` / `relayApiKey` prefer macOS Keychain, Windows Credential Manager, or Linux Secret Service via `keyring`, with `secrets.json` (0600) fallback and one-time plaintext migration — community PR #34.

### Added

- **Composer follow-up send queue**: while the agent is busy, queue messages for the current session; auto-flush after the turn if you stay on that chat — community PR #40.
- **Stream stall cancel (I06)**: host watchdog emits `session://stream_stall` after pure silence (default 120s, Settings → Runtime); banner with Cancel turn / Keep waiting; tool events count as progress — community PR #37.
- **Journal write throttle (I04)**: mid-stream assistant journal flushes ≥500ms or on paragraph / turn end / stop / disconnect — community PR #37.
- **Changes panel — Workspace git status**: Session (agent tool edits) + Workspace (`git status`) sections; click for unified diff; refresh / open in editor / reveal / copy path — community PR #36.
- **Sidebar session list virtualization** (F07): windowed rendering for large project/orphan session groups (100+ rows); short lists unchanged — community PR #32.
- **Plugins manager** (L03): Settings → Extensions list / enable / disable / details / uninstall via `grok plugin` — community PR #39.
- **MCP enable + inject** (L03): Settings → Extensions toggles; enabled servers inject into ACP `session/new|load` and agent-home config — community PR #38.
- **ACP golden fixtures** (T06): offline protocol regression suite for wire shapes / mock stream / permissions — community PR #33.

### Fixed

- **Session switch re-stream**: switching historical sessions no longer re-types the whole assistant transcript as a live stream (Host FSM gate + frontend defense) — community PR #35.
- **Windows portable zip**: CI package finds product `Grok.exe` correctly.

### Community

- Integrated community PRs **#32–#40** (sonnemusk, shiaho777, tisrop).

**中文 · 安全**
- API 密钥优先写入系统钥匙串（Keychain / Credential Manager / Secret Service），失败时回退 `secrets.json`（0600），并支持一次性明文迁移。

**中文 · 新增**
- 忙时后续消息队列（当前会话自动发送）；流式卡顿取消提示 + 日志落盘节流；Changes 工作区 git 状态；侧栏会话虚拟列表；扩展页 Plugins 管理与 MCP 启用注入；ACP 协议 golden 回归。

**中文 · 修复**
- 切换历史会话不再整段重播流式回复；Windows 绿色版打包路径修正。

## [0.1.2] - 2026-07-24

> 中英文对照 / Bilingual notes.
>
> **Highlight:** session Changes/diff, fork & rewind, agent process limits, ask-user questionnaire.

### Added

- **Session Changes panel** (resource pane Files | Changes): track agent write/edit tools, unified diff from tool snippets or optional `git_file_diff` — community PR #28.
- **Session fork & rewind timeline**: fork full/partial history; rewind to a user prompt (local journal + best-effort agent) — community PR #29.
- **Agent process limits**: max concurrent warm agents (default 3) + idle recycle minutes (default 30); Settings → Runtime; `PROCESS_LIMIT` toast — community PR #30.
- **Ask user questionnaire**: in-app UI for `_x.ai/ask_user_question` (single/multi/free-text) instead of always cancelling — community PR #31.

### Community

- Integrated and closed community PRs **#28–#31**.

**中文 · 新增**
- 会话 Changes/diff 面板；会话分叉与回退时间线；并发 Agent 上限与闲置回收；Agent 问卷（ask_user）应用内作答。

## [0.1.1] - 2026-07-24

> 中英文对照 / Bilingual notes.
>
> **Highlight:** multi-account, Doctor support tools, context usage chip, Extensions (Skills/MCP), OAuth browser open, Windows 绿色版 + Linux deb/rpm.

### Added

- **Multi-account manager** (Settings → Account): compact hero, modal switcher, **Add account** = save current then OAuth; import/export account snapshots.
- **Doctor**: redacted support zip export; safe app-data reset (double in-app confirm; optional keep keys/accounts).
- **CLI install hardening**: HTTPS allowlist, streaming SHA-256, fail on published checksum mismatch.
- **Workbench UX**: session Markdown export; palette search by project path; connection status pill; keyboard shortcuts panel; optional desktop notifications for permission waits / finished turns.
- **Context usage chip** (composer): known tokens after compact, honest `~` estimate from visible chat, Compact… menu — community PR #25.
- **Settings → Extensions**: Skills + MCP inspect lists, project-scoped refresh, reveal paths, `/mcp` → Manage in Settings — community PR #27.
- **ACP connection test**: TCP + initialize probe and server setup one-liner in Runtime settings — community PR #23.
- Composer **file picker** (+ menu → Files / Folder) and **clipboard paste** for images/files.
- Open-source **maintenance playbook** (`docs/llm-wiki/maintain.md`).
- **Single-instance** plugin: second launch focuses the existing window.
- Thinking/reasoning **auto-collapse when done** (default); remembers expand/collapse choice.
- Error codes **QUOTA_EXCEEDED** / **CONNECT_FAILED** with clearer user-facing copy.
- **Import conversation** from markdown/JSON into a local session.
- **Linux x64** packages: AppImage + **.deb** + **.rpm** in release CI.
- **Windows x64 绿色版**: `Grok_*_x64-portable.zip` (unzip and run) alongside NSIS setup.
- **Traditional Chinese (zh-TW)** UI locale — community PR #18.
- **ACP API mode**: optional TCP remote ACP server (`host:port`) — community PR #20.

### Fixed

- **OAuth / device login**: open the authorize URL as soon as the CLI prints it (stream stdout); previously stuck on “Working…” with no browser — community PR #26.
- **Settings i18n**: Settings page uses full `createT` catalog (no raw keys / partial labels whitelist).
- **Settings → Session data mode** and **Add project trust**: replace `window.confirm` with in-app dialogs (Fixes #19).
- **Plan card**: keep `exit_plan_mode` `rpcId` so Approve / Request changes stay clickable (Fixes #17).
- **Plan mode**: handle `_x.ai/exit_plan_mode` + wire Plan card buttons.
- **Thinking UI**: multi-phase reasoning blocks; thought chunks bind to current assistant message.
- **Session ↔ project rebind** via composer project chip menu.
- Shell permission fallbacks use **underscore** optionIds — community PR #2.
- Session auto-title prompt follows **app locale** (incl. zh-TW) — community PR #1 / follow-ups.
- Composer stays **draftable while streaming**.
- macOS titlebar traffic-light inset / panel toggle drag.
- **Same-session history duplication** and stuck streaming flags.
- Login / connect error mapping (Access denied, quota, agent connect).

### Changed

- Release download table documents portable zip + Linux AppImage/deb/rpm.
- Bundle targets explicit: dmg / nsis / appimage / deb / rpm.

### Community

- Integrated and closed community PRs **#23–#27** (ACP probe, Doctor/workbench, context chip, OAuth browser, Extensions).
- Issues #3–#13 from launch-thread feedback; #17 / #19 fixed on main.
- PR #18 (zh-TW), PR #20 (ACP TCP) already on main.

**中文 · 新增**
- 多账号管理、Doctor 支持包/重置、CLI 安装校验、会话导出与连接状态、快捷键与桌面通知。
- 上下文用量芯片、设置 → 扩展（Skills/MCP）、ACP 连通测试。
- Windows **绿色版 zip**；Linux **AppImage / deb / rpm**。
- 多账号、导入对话、单实例、思考自动折叠、zh-TW、ACP API 模式等。

**中文 · 修复**
- 登录 OAuth/设备码时立即打开浏览器授权页（不再卡在 Working…）。
- 设置页 i18n 裸 key；`window.confirm` 替换；计划卡 RPC；历史重复与登录/连接错误提示等。

**中文 · 变更**
- 发布资源表与打包目标覆盖绿色版与 Linux 三件套。

## [0.1.0] - 2026-07-24

> 中英文对照 / Bilingual notes. English first (Keep a Changelog), then 中文摘要 under each section.
>
> **Highlight:** first public release — Grok Build desktop workbench, open-source packaging for macOS ARM / Intel + Windows.

### Added

- **Desktop workbench** for Grok Build (`grok agent stdio` ACP): projects, multi-session sidebar, streaming chat, live tool activity line, permission bar (Ask / allow once / session / YOLO).
- **First-run setup wizard**: multi-mirror CLI install, optional official account / API key / custom relay; CLI is a hard gate, account is skippable.
- **Account UI**: login surface, SuperGrok quota + usage heatmap, membership-oriented status.
- **Custom providers**: independent agent home (`GROK_HOME` / `agent-home`) so relays do not have to pollute `~/.grok`.
- **Rich media & files**: image / video / PDF / Office / code previews; path cards with smart open (ellipsis / sibling KB paths); resource pane + embedded multi-webview browser.
- **Automations (“已安排”)**: task list + silent create-from-chat (`grok-automation` fence stripped from bubbles); shell polling without blocking the main conversation.
- **i18n**: EN / 中文 UI via `src/i18n/`; tray menu follows locale.
- **In-app glass dialogs**: product UX never uses `window.confirm` / `prompt` / `alert`.
- **Packaging & open source**
  - GitHub Actions release matrix: macOS ARM64, macOS Intel, Windows x64.
  - Local cross-build: `cargo-xwin` + NSIS on macOS (`pnpm build:win`).
  - CHANGELOG-driven Release body (`scripts/changelog-for-release.py`) including macOS Gatekeeper / “damaged app” steps.
  - MIT license, bilingual README, CONTRIBUTING / SECURITY / CoC, issue & PR templates.

### Fixed

- Chat image cards: synchronous path resolve + cache to avoid zero-height flash / scroll jump while browsing history.
- Path open: strip agent `.../` ellipsis truncation; resolve files under project sibling folders (shared knowledge-base layout).
- Tauri feature allowlist: keep `macos-private-api` aligned for Windows cross-builds via cargo-xwin.
- Automation connect failures: do not leave empty “ghost” sessions in the sidebar.

### Changed

- Session continuity UX: single plain-text running tool line (not multi-row tool stack).
- Release process documented for AI maintainers: `docs/llm-wiki/release.md` + `docs/BUILD.md`.

### Notes

- **Not an official xAI product.** Real agents need a working [Grok Build](https://x.ai) CLI on the machine.
- macOS downloads are **unsigned / not notarized** — use `xattr -cr /Applications/Grok.app` if Gatekeeper blocks (see Release install notes).

**中文 · 新增**

- **Grok Build 桌面指挥台**：项目 / 多会话 / 流式对话 / 工具活动行 / 权限条（Ask · YOLO）。
- **首次向导**：CLI 多镜像安装（硬门禁）；账号 / Key / 中转可跳过。
- **账号与额度**、自定义中转（独立 `GROK_HOME`）、富媒体与资源预览、已安排自动化（对话静默创建，气泡不露 JSON）。
- **中英 UI + 托盘**、应用内毛玻璃弹窗（禁用系统 confirm/prompt/alert）。
- **开源与打包**：Actions 三端；本机 cargo-xwin 打 Windows；CHANGELOG 驱动 Release（含 macOS「已损坏」处理）；MIT 与双语 README。

**中文 · 修复**

- 聊天图片同步解析防滚动跳动；路径省略号 / 旁路知识库打开；Windows 交叉编译 private-api 白名单；自动化连接失败不留空壳会话。

**中文 · 变更**

- 工具活动改为单行纯文本；发版流程写入 `docs/llm-wiki/release.md` 供后续 AI 接手。

**中文 · 说明**

- **非 xAI 官方**；真 Agent 需本机 Grok Build CLI。macOS 未公证，遇 Gatekeeper 用 `xattr -cr`。
