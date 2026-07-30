# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Maintainer rule (AI):** before every `vX.Y.Z` tag, complete `## [X.Y.Z]` below.  
CI Release body = this section only (via `scripts/changelog-for-release.py`; no repeated download/install boilerplate).  
See `docs/llm-wiki/release.md`.

## [Unreleased]

### Added

- **Desktop notification click opens the session** that fired turn-done / permission / ask_user (falls back to focusing the app when the session is unknown)
- **Edit queued follow-ups** in the composer send queue (text before auto-send)
### Changed
- **Compact dialog**: shows current context usage (known or estimated), a short explanation of what compact does, optional keep-note chips (empty note still allowed), and disables Compact while the session is busy. Manual compact stores a UI-side before estimate so the post-compact banner can still show `{before} → {after}` when the agent omits `tokensBefore`
**中文 · 变更**
- **压缩对话框**：展示当前上下文用量、简要说明与可选保留备注 chips；会话忙碌时禁用压缩；手动压缩时用 UI 估算补全 banner 的 before tokens

## [0.2.2] - 2026-07-30

> **Highlight:** In-app auto-update works for signed builds; calmer sidebar multi-select; PATH / busy / media reliability.
>
> **中文 · 亮点：** 正式版可应用内静默更新；侧栏多选更干净；PATH / 卡住忙碌 / 媒体更稳。

### Added

- **Sidebar multi-select polish**: list-check icon instead of a text button; project-row actions (select / collapse / add) show only on hover; multi-select bar can **permanently delete** selected chats with the existing danger confirm + toast
- **Zen mode** (Settings → Appearance → Interface + top-bar): hide left sidebar and right files pane; remembers prior collapse and restores on exit (`localStorage` `grok.zenMode`). Escape still stops generation only
- **Remember last Settings section + tab** for generic open (⌘/Ctrl+,, gear, `/settings`, tray); deep links unchanged (`localStorage` `grok.settingsLastRoute`)
- **Always-show back-to-bottom** (Settings → Appearance → Interface; off by default)
- **Always-on-top window** (Settings → General → App; `localStorage` `grok.windowAlwaysOnTop`)
- **Keyboard shortcuts filter** (Settings → Keyboard): search by label, id, or chord
- **Toggle sidebar** shortcut: ⌘/Ctrl+B (desktop rail and phone drawer)
- **Copy last assistant reply** shortcut: ⌘/Ctrl+Shift+C (same as `/copy`)
- **Collapse all activity** in the current chat (top-bar + session menu; streaming thoughts stay open)
- **Sidebar session relative time** (on by default; about once a minute)
- **Permission auto-deny timeout** (Settings → General → Permissions): Off / 30s / 1m / 2m / 5m with countdown on the bar

### Changed

- **Shortcuts catalog / help**: **Send** row follows the Composer send-key preference (Enter vs ⌘/Ctrl+Enter)
- **Shortcut registry**: global mod chords match via a shared catalog module with Settings/help

### Fixed

- **Desktop auto-update (production)**: GitHub secrets + release pipeline produce signed updater archives and rolling `grok-desktop-latest` / `latest.json` (darwin / linux AppImage / windows). Install this build (or later) once so Settings → About can use the silent channel
- **Agent PATH parity (GUI vs Terminal)**: enrich spawn PATH with existing conda/mamba/miniforge, pyenv, nvm, asdf, volta roots without loading shell rc
- **Stuck busy spinner (#225)**: late stream tokens no longer re-promote settled chats; empty-run / hard stall / idle recycle settle liveMap
- **Video focus-switch crash (macOS)**: release `panic = "unwind"` so media:// `catch_unwind` works; pause video while the window is hidden
- **Wallpaper X search gallery**: long lists scroll again (masonry overflow fix)
- **Imagine / library “Set as background”**: reassemble full file via media:// Range (was truncated at 2 MiB); clearer errors; 40 MB cap
- **Long tool-heavy threads**: blank-transcript / bottom bounce / virtual-list height fixes; Chinese token units (百 / 千 / 万)

**中文 · 新增**

- 侧栏多选：选择改为清单图标；项目行操作仅 hover 显示；支持二次确认后永久删除
- 禅模式、记住上次设置页、始终显示回到底部、窗口置顶
- 快捷键筛选；⌘/Ctrl+B 切换侧栏；⌘/Ctrl+Shift+C 复制上一条助手回复
- 收起全部活动；侧栏相对时间；权限超时自动拒绝

**中文 · 变更**

- 发送快捷键展示随对话偏好；全局快捷键与目录同模块匹配

**中文 · 修复**

- 正式版应用内静默更新链路打通（需安装本版或之后的签名包一次）
- Agent PATH 对齐终端（conda 等）；侧栏卡住忙碌（#225）
- macOS 切焦点视频崩溃；壁纸画廊滚动；Imagine 设背景大图；长会话虚拟列表与中文 token 单位

## [0.2.1] - 2026-07-29

> **Highlight:** Per-project draft memory, video covers, durable relay retries, and calmer chat errors.
>
> **中文 · 亮点：** 按项目记住输入草稿、视频封面缓存、中转更耐断流、会话报错更低调。

### Added

- **Per-project composer drafts** (plus an orphan/“other chats” slot): half-typed new-chat text & attachments restore when you open new chat again
- **Cached video posters** for idle chat cards (`~/.grok-app/cache/video-posters` via ffmpeg; canvas capture on first play as fallback)
- **Session title LLM refine**: more reliable headless title generation (`max-turns 2`, longer timeout)

### Changed

- **Provider retries** for flaky custom relays / 中转: host cap and agent `max_retries` raised to **12**; soft `failed` status no longer aborts on the first blip
- **Turn errors**: Codex-style muted info pill instead of red “turn failed” boxes; reconnect chip reads “Reconnecting n/max”
- **Thinking live indicator**: dot and “Thinking…” share one pulse timing (no desync)

### Fixed

- **Composer newlines / blank lines** preserved after send; end-of-input ArrowRight no longer injects □ ghosts
- **Thinking / tool work phases** auto-collapse when the segment ends (empty tool status no longer keeps groups open)
- **History video paths** render as video cards again (absolute paths no longer stripped to document chips)
- **Stick-to-bottom** re-engages when a turn becomes busy; user scroll-up pin/escape unchanged
- **Long media chats**: stabilize virtual list / stick / media protocol workers (host crash hardening)

**中文 · 新增**

- 按项目（及无项目）记忆新建会话输入框与附件
- 聊天视频封面截帧缓存（ffmpeg / 首次播放 canvas 补齐）
- 会话短标题后台模型 refine 更稳

**中文 · 变更**

- 中转断流：重试上限 12，软失败不立刻熔断
- 回合错误改为低调灰 pill；顶栏「正在重新连接 n/max」
- 思考中圆点与文案同频闪烁

**中文 · 修复**

- 气泡保留换行/空行；输入框末尾右键不再出方框
- 工具/思考组段落后自动折叠
- 历史会话 mp4 恢复为视频卡
- 任务开始立即吸底跟随；长媒体会话与 media 协议更稳
### Fixed

- **Chat blank at bottom on long tool-heavy threads**: virtual list no longer inflates height for inlined tool steps; pin window force-mounts last user/assistant
- **Bottom scroll bounce / flash**: stick-to-bottom requires a clear upward gesture to unlock; clamp while pinned; ignore micro trackpad jitter and elastic overscroll; quieter virtual spacer remeasure while pinned
- **Token counts use Chinese units** (百 / 千 / 万·萬 / 亿·億) instead of English k/M; zh-TW uses 萬/億; account heatmap total uses the same formatter

## [0.2.0] - 2026-07-29

> **Highlight:** Wallpaper from X / Imagine; Appearance Theme · Interface; stabler long runs and chat prefs.
>
> **中文 · 亮点：** 从 X / Imagine 找壁纸；外观拆主题·界面；长任务更稳、聊天偏好更全。

### Added

- **Wallpaper from X / Imagine** (Settings → Appearance → Theme): search X for images (prompt-share first, filter dead URLs), generate with Imagine, masonry preview + lightbox, set as background
- **Appearance tabs**: Theme (light/dark/skin/wallpaper) vs Interface (thinking, font, actions, code wrap, timestamps); “?” tips instead of long desc blocks
- **Desktop in-app auto-update** (signed builds): check / download / install / relaunch from About; unsigned keeps GitHub open-release path
- **Updater channel status** in About + Host `updater_status`; maintainer `scripts/verify-updater-setup.sh`
- **Live Voice entry**: headphones next to mic, `/live-voice`, ⌘/Ctrl+Shift+V
- **Regenerate** last assistant turn; **Esc** stops generation when free
- **Session Markdown export**: thinking / tool options; download or copy
- **Command palette** quick actions; **Tasks panel** other busy chats (Open / Stop)
- **Context usage** chip from agent-reported tokens when available
- **Import providers from CC Switch** (#167)
- **General workspace** cwd for unbound chats (no forced project bind)
- **Trust sandbox / CSP**: `path_scope` for media/fs; asset protocol secret-path deny
- **Phone mirror**: default read-only, rotate token, allow-write toggle
- **Diagnostics**: rolling `logs/app.log.*`, error deck, chat ErrorBoundary, stream backpressure, long-tool heartbeat
- **Main chat virtual list** for long transcripts

### Changed

- **Appearance prefs**: thinking expand, chat font scale, message actions hover/always, default code wrap, message timestamps
- **Composer**: Enter vs ⌘/Ctrl+Enter send; model menu search; skills picker treats missing `userInvocable` as invocable
- **Desktop notifications**: turn-done + permission toggles (Settings → General → App)
- **Host automation scheduler** runs while app is alive (incl. tray)
- **Remote IM health watchdog** + listening / degraded / error status
- **Remove git worktree** from composer branch menu (in-app confirm)
- Markdown export includes tool one-liners by default; update prep only after successful install
- CLI install **fail-closed** without published checksum (escape hatch in Runtime / env)

### Fixed

- **Workbench auto-widen**: window set-size ACL so sidebar / files pane can grow the OS window
- **Long-run freezes**: tool terminal accounting (no re-open after completed); stdin write timeout; idle-based prompt wait; stream stall heartbeat; steer / diagnostic export no longer hang forever
- Chat scroll bounce on tall content; high-frequency stream coalescing
- SVG preview no longer injects raw HTML; resource absolute open/save grants path
- Windows CI `cargo test` (Common Controls v6 + PATH scrub); win_shell COM `unsafe` for cold rebuilds
- Doctor / CC Switch import dialog edge cases

### Security

- `media://` CORS limited to main-window origins; path allowlist enforced
- CLI download refuses missing checksum by default; mismatch always aborts

**中文 · 新增**

- 壁纸：从 X 搜索（优先提示词分享、过滤失效图）/ Imagine 生成，瀑布流 + 大图预览后设背景
- 外观：主题 · 界面分页；说明收到「?」提示里
- 桌面内更新（签名包）；关于页更新通道状态
- Live Voice 入口；重新生成；Esc 停止生成
- 会话 Markdown 导出；命令面板快捷操作；跨会话任务条
- 上下文用量芯片；CC Switch 导入提供商；无项目时的通用工作区
- 信任沙箱 / CSP；手机镜像默认只读；诊断日志与虚拟列表等

**中文 · 变更**

- 思考展开、字号、消息操作/时间戳、代码换行；发送快捷键与模型搜索
- 桌面通知开关；托盘下自动化仍跑；远程 IM 健康看门狗
- 可从 UI 移除 git worktree；CLI 安装默认要求校验和

**中文 · 修复**

- 侧栏/文件栏展开时窗口可真正变宽
- 长任务卡住、工具终态回写、流心跳与滚动抖动
- Windows CI / 资源预览等稳定性问题

**中文 · 安全**

- media 协议 CORS 与路径白名单；CLI 无校验和默认拒装

## [0.1.9] - 2026-07-27

> **Highlight:** Windows no more cmd flashes; LINE webhook actually listens on the documented port; installers downloadable from About.
>
> **中文 · 亮点：** Windows 不再狂闪 cmd；LINE Webhook 与文档端口一致；关于页可下载本机安装包。

### Added
- Settings → About: **Download installer** for the current OS when GitHub Release lists a matching asset (L08 tier B)
- LINE webhook: HMAC `X-Line-Signature` verification; loopback bind by default
- Remote IM: require non-empty allow-from before enable (`*` still allowed)
- Session data mode help copy; CLI session import only in shared mode
- Broader effort tokens for live switch (catalog-aligned)

### Fixed
- **Windows (#162):** hide console for git/CLI/open-url child processes (`CREATE_NO_WINDOW` / rundll32)
- **LINE (#161):** default webhook port **8081** (was 8082) matching UI cloudflared hint; bind errors write `lastError`
- Windows http(s) open no longer splits query `&` via `cmd /C start`
- Secrets writes use atomic lock + rename
- Windows release build: remove duplicate app-manifest embed (CVT1100 / link.exe)
- Sidebar busy settles when stop resolves without a final host event (#134, already on main)

### Changed
- CLI install: optional `GROK_CLI_REQUIRE_CHECKSUM=1` refuse unverified downloads

**中文 · 新增**
- 关于页：可下载本机对应安装包（L08 档 B）
- LINE：签名校验；默认仅本机回环监听
- 远程 IM：启用前必须填写 allow-from
- 会话数据模式说明；CLI 会话导入仅共享模式
- 思考力度取值与 CLI 目录对齐

**中文 · 修复**
- **Windows (#162)：** 子进程不再弹黑框
- **LINE (#161)：** 默认端口 8081；监听失败写入 lastError
- Windows 外链 `&` 不再被 cmd 截断
- 密钥文件原子写入

**中文 · 变更**
- CLI 安装可选强制校验和

## [0.1.8] - 2026-07-26

> **Highlight:** Multi-session chats keep running in the background; stabler replies; cleaner launch.
>
> **中文 · 亮点：** 多会话后台不中断；回复更完整；启动更干净。

### Added

- Multi-session: switch chats freely while others keep running
- Steer a running turn from a queued follow-up (without cancelling it)
- Remote IM (Feishu / WeChat and more) + optional phone mirror
- Settings tabs + search; skins, wallpaper, system theme
- Official plugin marketplace one-click install
- Stream-stuck banner (keep waiting / cancel)
- Richer Markdown editing in the resource pane
- Settings extras: voice prefs, close-to-tray, Doctor CLI info, soft-respawn toast, `/history` picker

### Fixed

- Launch opens a blank new chat (no auto last chat / no auto project)
- Sidebar remembers collapsed projects
- “Connect device” opens Remote IM first
- No “empty run” toast after normal text-only replies
- Answers no longer cut off mid-stream; fewer “stuck” chats
- Send / stop / permissions always apply to the chat on screen
- New chat no longer kills a turn that just started
- False “agent process limit” when little is actually running
- Message order when reopening a chat
- File editor height, Markdown editing, top-bar badges, primary button color

### Changed

- Default concurrent agents raised (8, max 32)
- Reopen-last-chat on startup is off by default (can re-enable in Settings)

**中文 · 新增**

- 多会话并行：切换会话时其他对话继续跑
- 回合中途可引导（队列项 Steer，不取消当前任务）
- 远程 IM（飞书 / 微信等）与可选手机镜像
- 设置分页与搜索；皮肤 / 壁纸 / 跟随系统
- 官方插件市场一键安装
- 流卡住提示、资源区 Markdown 更好编辑
- 语音偏好、关窗到托盘、Doctor CLI 信息、`/history` 等

**中文 · 修复**

- 启动默认进入空白新会话（不自动打开上次对话 / 不默认选项目）
- 侧栏项目折叠可记忆
- 「连接设备」默认进 IM 通信
- 正常纯文本回复不再弹「未调用工具」提示
- 回答不再中途截断；会话更少「卡住」
- 发送 / 停止 / 权限对准当前查看的会话
- 新建会话不再杀掉刚开始的任务
- 误报「进程已达上限」
- 切回会话时消息顺序、编辑器高度、角标与按钮颜色等

**中文 · 变更**

- 默认可同时跑更多 Agent（8，上限 32）
- 启动恢复上次对话默认关闭（可在设置中打开）

## [0.1.7] - 2026-07-25

> **Highlight:** large community feature batch (worktrees, voice, Extensions, Runtime toggles) plus hard stability repairs so `tsc` / `cargo test` / CI install stay green after multi-PR landing.

### Added

- **App update check** (#58): Settings → About checks GitHub Releases for newer installers.
- **Active agent tasks panel** (#59): right pane shows live tool tasks from the current stream.
- **Session content search** (#60): command palette / search matches journal message text, not only titles.
- **Plugin install & update** (#61): Settings → Extensions can install/update plugins (not only enable/disable).
- **Sandbox profile** (#66): Settings → Runtime sandbox (`off` / `workspace` / `read-only` / `strict` / `devbox`) at agent spawn.
- **Pin sessions** (#73): pin chats to the top of the sidebar.
- **Project inspect** (#75): Settings → Runtime summary from `grok inspect --json` (secret-safe).
- **CLI doctor in App Doctor** (#76): merge `grok doctor --json` findings into the Doctor modal.
- **CLI update check** (#63): Runtime / Doctor can run `grok update --check --json` and install via `grok update`.
- **Git worktree create / remove / gc** (#64, #74, #83): project chip creates sibling worktrees, removes non-main trees (force optional), dry-run prune then `git worktree prune`.
- **Composer voice dictation** (#89): mic capture → xAI STT; official login / API key only; in-app errors (no `window.alert`).
- **Find in chat** (#72): Cmd/Ctrl+F in the current conversation.
- **Reopen last chat on startup** (#71): restore last session once after launch (Settings toggle; default on).
- **Spawn toggles**: experimental memory (#67), max agent turns (#69), disable web search (#70), plan mode (#80), subagents (#81), preferred agent (#85), optional leader mode (#87).
- **Extensions depth**: MCP add/remove/doctor (#68), hooks (#78), agents/personas list (#77), plugin marketplace sources (#86).
- **Managed setup** (#79): Settings → Runtime `grok setup` preview/install with soft-respawn.
- **Permission rules editor** (#84): allow / deny / ask patterns in agent `config.toml`.
- **Project rules entry** (#82): first-class AGENTS.md / `.grok` rules surface in the resource pane.
- **Keyboard shortcuts panel** (#91): Settings → Shortcuts (read-only catalog).
- **Doctor remediations** (#88): apply CLI doctor automatic fixes from App Doctor when available.

### Fixed

- **Session data mode switch** (#62): independent↔shared recycles live/background/parked agents so none keep the old `GROK_HOME`.
- **Missing project folder** (#65): pathOk UX to relocate deleted/moved project directories.
- **Post-merge stability**: repair union-merge damage (Rust brace/tests, duplicate modules, truncated `useState` / JSX / CSS, deduped imports, bogus `pnpm-workspace.yaml`); `tsc` + `cargo test --lib` + frontend unit tests green again.
- **Git worktrees UI**: hide for non-git folders; soft refresh without flicker; compact rows.
- **Release notes**: slim GitHub Release body (CHANGELOG section only).

### Community

- Integrated community PRs through the post-0.1.6 batch (sonnemusk and others), including worktrees, voice, Extensions, and Runtime spawn flags.
- Superseded follow-up compile fix PR #92 after equivalent CI repairs landed on `main`.

**中文 · 新增**
- 应用更新检查、活动任务、会话正文搜索、插件安装更新、沙箱、置顶、inspect、CLI Doctor/更新。
- Worktree 新建/删除/清理；Composer 语音听写；会话内查找；启动恢复上次会话。
- Memory / max turns / 禁联网 / plan / subagents / preferred agent / leader 等 spawn 开关。
- MCP 增删与 doctor、hooks、agents 列表、marketplace、managed setup、权限规则、项目规则入口、快捷键面板、Doctor 自动修复。

**中文 · 修复**
- 会话模式切换回收 Agent；缺失项目目录可重定位。
- 大批量 PR 合并后的编译/类型/测试/安装链路修复；worktree UI 与发版日志精简。

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
