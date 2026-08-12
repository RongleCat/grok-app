# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Maintainer rule (AI):** before every `vX.Y.Z` tag, complete `## [X.Y.Z]` below.  
CI Release body = this section only (via `scripts/changelog-for-release.py`; no repeated download/install boilerplate).  
See `docs/llm-wiki/release.md`.

## [Unreleased]

### Fixed
- **Delayed post-turn history flush (#554)**: Journal reconciliation now retries over a short bounded window after a successful prompt RPC, so final assistant/tool rows that reach CLI history slightly late are recovered without reopening the session. Per-session locking prevents races with an immediate next send; disk reads run off the async executor and remain platform-neutral.

**中文 · 修复**
- **回合结束历史稍晚落盘（#554）**：prompt RPC 成功后在短时有界窗口内重试 journal 对账，无需重开会话即可补回稍晚写入 CLI 历史的最终回复/工具记录；会话级锁避免与紧接着的下一次发送竞争，磁盘读取移出异步执行线程，且不依赖平台特性。

## [0.2.15] - 2026-08-12

> **Highlight:** Tool/activity timeline shows real expandable output and explore groups; session open never hangs on MCP/OAuth; ask-user with rpcId 0 works; sticky composer target and optimistic Stop; project drag-reorder.
>
> **中文 · 亮点：** 工具活动轨真实可展开输出与「探索」分组；连接打开会话不再被 MCP/OAuth 卡住；rpcId=0 问卷正常弹出；发送绑定当前会话与乐观停止；侧栏项目拖拽排序。

### Added
- **Tool timeline / activity rail**: Live and history tool steps show type + call-arg labels with expandable real tool output (stdout/file text). Mixed read/search bursts collapse into an “Explore · N searches, M files” group. Thought steps expand to full text; finished thinking blocks auto-collapse like work blocks.
- **Sidebar project drag-reorder**: Pin-group-aware drag + Move Up/Down menu; order persisted.
- **Plan-mode bare chip exit**: Transient plan mode is never inherited as a global/project default (heals old `mode:"plan"` data); empty plan-mode strip gains an exit control.

**中文 · 新增**
- **工具/活动时间线**：一级类型+参数文案，真实工具输出可展开；混合读/搜合并为「探索」；思考全文可展开并在结束后自动折叠。
- **侧栏项目拖拽排序**：置顶分组内排序 + 上移/下移，顺序持久化。
- **计划模式条退出**：计划模式为临时态，不再当全局默认；空计划条可退出。

### Changed
- **Stop is optimistic**: UI unlocks immediately; agent cancel runs in the background. Sticky “thinking” after a dropped stream is healed via journal reconcile.
- **Automations chat fences**: Can update an existing task by id/title (no duplicate create); post-turn reconcile applies missed fences.

**中文 · 变更**
- **停止改为乐观解锁**：UI 立即恢复；代理取消后台执行；流中断导致的「思考中」卡死由 journal 对账修复。
- **自动化围栏**：可按 id/标题更新已有任务；回合结束对账补漏。

### Fixed
- **ACP connect never blocks on MCP/OAuth**: Session open builds `mcpServers` from config only (no `grok mcp list` / network token refresh), with a 2s budget and empty-inject fallback so `session/load|new` still proceeds when ChatCut OAuth or CLI probe hangs. Expired OAuth remotes are skipped on connect.
- **Tool output after reload**: Journal `\u0001output` is mapped on load; standalone/unwoven tool rows recover the same expand body as live rows.
- **Ask-user questionnaire with JSON-RPC id 0**: First question no longer silently drops (2-minute hang).
- **Composer sticky send target**: Sends bind to the viewed session so switching chats mid-turn no longer mis-routes prompts into the previous busy session.
- **Replayed tool kind/label**: History tool rows recover kind and humanized labels after session reload.

**中文 · 修复**
- **连接打开会话不再被 MCP/OAuth 阻塞**：config-only 注入 + 2 秒预算 + 空列表兜底；过期 OAuth 远程直接跳过。
- **历史回放工具输出/类型标签**：journal 输出与独立工具行展开与 live 一致。
- **rpcId 为 0 的问卷正常弹出**。
- **发送绑定当前查看会话**：忙时切换会话不再发错聊天。
- **回放工具 kind/标签恢复**。

## [0.2.14] - 2026-08-11

> **Highlight:** App and terminal Grok Build share sessions by default, release CI no longer dies on pnpm version conflict, sidebar one-click update, agent-home config heal, and goal/role chats no longer mis-create schedules.
>
> **中文 · 亮点：** 默认与 Grok Build 共享会话、修复发版 pnpm 冲突、侧栏一键更新、agent-home 配置自愈、目标/角色对话不再误建定时任务。

### Added
- **Sidebar update badge + install→restart**: When a newer App build is known, an accent control next to the brand mark runs download → install → relaunch (sim path reloads). Settings → About → Developer mode gates the update simulator and future debug tools.
- **Agent-home `config.toml` heal**: Spawn-time dedupe for duplicate keys (exact match, comment-tolerant tables, backup + write lock) stops `AGENT_CRASHED` from broken independent agent-home configs; valid files are never rewritten.

**中文 · 新增**
- **侧栏更新角标与安装后重启**：发现新版本可一键下载安装并重启；关于页开发者模式控制更新模拟器。
- **agent-home config.toml 自愈**：spawn 前去重损坏配置，避免独立模式下 Agent 秒崩。

### Changed
- **Default session data mode is shared**: Fresh installs use `session_data_mode=shared` (`GROK_HOME=~/.grok`) so Grok App and terminal Grok Build share the same agent home / CLI sessions. Existing installs keep the value already in settings. Independent mode (`~/.grok-app/agent-home`) remains available in Settings → Session data mode.
- **Release/CI pnpm setup**: Drop hard-coded `pnpm/action-setup` `version: 9` so `packageManager: pnpm@9.15.9` is the single source (fixes `Multiple versions of pnpm specified` that blocked v0.2.13 install assets).

**中文 · 变更**
- **默认与 Grok Build 共享会话数据**：新装默认 `shared`（`~/.grok`）；已安装用户保留原设置。独立模式仍可在设置中切换。
- **发版/CI pnpm**：去掉 workflow 硬编码版本，避免与 `packageManager` 冲突（修复 v0.2.13 Release 无安装包）。

### Fixed
- **CLI update check `No such file or directory (os error 2)`**: GUI PATH enrichment only joined nvm `alias/default` literally (e.g. `22` → `~/.nvm/versions/node/22/bin`, missing). Now resolves nested aliases (`lts/*`), major shims, and picks the highest matching install (`v22.22.0`) so `grok update --check --json` (installer=`npm`) finds `node`/`npm` without loading shell rc.
- **Scheduled-task mis-create from role/goal chat**: `grok-automation` fences auto-apply only for explicit “Create with AI” sessions or clear schedule intent; unexpected fences ask once in-app. One-off “每天…” no longer sticks the whole chat in automation setup. Goal chip / empty-state copy distinguishes timers from Goal tasks. Intentional 已安排 / manual form paths unchanged.
- **Relay sanitize base repair nested `block_on`**: Avoid runtime panic when repairing OpenCode Go proxy bases on the async worker.

**中文 · 修复**
- **设置 → CLI 检查更新 os error 2**：正确解析 nvm 别名到真实 Node `bin`，GUI 下 `grok update --check` 不再因找不到 node 失败。
- **目标/角色对话误建定时任务**：仅 AI 创建入口或明确排程意图才自动落库；意外 fence 需确认。不影响手动/已安排正常定时功能。
- **中继 sanitize base 修复嵌套 block_on**：异步 worker 上不再 panic。

## [0.2.13] - 2026-08-11

> **Highlight:** Mid-turn Queue Steer is live again (no deadlock), Windows can spawn Grok Build via WSL, Find Skills ranks by the draft prompt, native desktop alerts land on macOS, and a pre-release hardening pass closes stop-during-vision, permission RPC ordering, and WSL path injection.
>
> **中文 · 亮点：** 中途队列「引导」不再死锁、Windows 可经 WSL 启动 CLI、侧边技能按提示排序、原生桌面通知，以及发版前加固（Stop 中途视觉、权限 RPC 顺序、WSL 路径注入）。

### Added
- **WSL CLI backend (#546)**: On Windows, Settings → Runtime → CLI can spawn Grok Build via `wsl.exe` (distro + Linux path) when the binary lives only inside WSL. Project cwd and `GROK_HOME` map to `/mnt/…`; ACP TCP mode still wins when configured. Probe / connect / prewarm / Doctor share `probe_cli_for_settings`.
- **Find Skills in Side Workbench (#545)**: Docked Skills tab ranks host `skills_list` against the live composer draft (local keyword/purpose match, inventory-only) and inserts `[[skill:name]]` on click. Composer toolbar opens the panel; with an active prompt, show matches only (no full A–Z dump).
- **Native desktop notifications**: Host-side alerts for turn done / permission waits — macOS uses UNUserNotificationCenter inside a real `.app`, osascript under bare `tauri dev` (Script Editor); other platforms use `tauri-plugin-notification`. Background chats can force notify while the focused window stays quiet when focused.
- **Resource code preview languages + line numbers**: highlight.js covers common languages (PowerShell, Swift/ObjC, Scala, Dart, Elixir, Haskell, protobuf, GraphQL, less, nginx, nix, shaders, …); per-line gutter stays aligned with highlighted tokens.
- **Scheduled tasks UI slim-down**: Tasks-first Automations page; settings moved into a gear modal so the list remains the primary surface (#543 follow-up).

**中文 · 新增**
- **WSL CLI 后端 (#546)**：Windows 可经 WSL 启动 Grok Build；探测/连接/预热统一路径。
- **侧边技能面板 (#545)**：按输入框提示排序并插入 `[[skill:name]]`。
- **原生桌面通知**：回合完成/权限等待；mac 真 `.app` 与 dev 路径分流。
- **资源预览代码高亮与行号**：扩展语言；gutter 对齐。
- **计划任务页精简**：任务优先，设置进齿轮弹层。

### Fixed
- **Queue Steer / 引导 hangs on「正在引导…」**: Host re-locked `inner` via `snapshot()` after `_x.ai/interject` (`parking_lot` non-reentrant) → permanent deadlock. Return `snapshot_from_live` under the lock; prefer agent `_x.ai/interject` (fallback `x.ai/interject`); seed post-steer streaming shell + thinking timer; empty `done` chunks no longer kill empty live shells; stop chip history keeps「已由用户停止 / Stopped by user」.
- **Stop during Host vision still spawned `session/prompt`**: After `prepare_agent_prompt_for_main_detailed`, Host now verifies `active_turn_id` / `prompt_in_flight` / stream message id before `prompt_for`. Stop mid-vision no longer leaves a ghost agent turn with streams dropped as load-replay.
- **Permission / plan / ask_user gates**: FSM, allow_cache, and pending ids update only **after** a successful ACP respond (failed RPC keeps the gate).
- **Ghost optimistic streaming heal**: Do not heal while `sendInFlight`; grace raised to 45s so WSL cold connect is less likely to restore the composer mid-send.
- **WSL-only install connect**: Cold spawn / prewarm probe through WSL when backend is `wsl` (native PATH-only probe previously reported CliNotFound).
- **Composer blank lines + mid-text slash skills**: Draft is source of truth for Enter; contenteditable serialize keeps intentional blank lines; slash detect works on the caret prefix mid-message.
- **Shell / MCP permission approve cancels the turn (#542 / #544)**: Empty/tool-scoped option lists no longer answer with generic `always-allow`; session-allow rewrites to tool-scoped wire ids; unknown option failures surface as error deck.
- **Sidebar file open skipped highlight**: Editable kinds open in **preview** with CodePreview first; toolbar Edit enters the source editor.
- **Reveal in file manager default page**: Shared Host `reveal_in_file_manager` — Windows explorer without `CREATE_NO_WINDOW`, strip `\\?\`, Linux D-Bus ShowItems then `xdg-open` parent, macOS `open -R`.
- **Automations Scheduled scroll (#543)**: Page scrolls when chrome overflows instead of trapping content.
- **Session open switch storms**: Generation-gated fast open so rapid session switches do not thrash Host open.

**中文 · 修复**
- **引导死锁与空白**：锁内 `snapshot_from_live`；引导后空壳与思考计时；停止文案。
- **视觉识别中 Stop 仍下发 prompt**：prepare 后校验 turn 仍有效。
- **权限/计划/问卷**：ACP 成功后再改 FSM 与缓存。
- **幽灵 Thinking 误愈**：`sendInFlight` 不 heal；grace 45s。
- **仅 WSL 安装可连接**：探测走 distro。
- **换行与中途 slash 技能**：草稿为 SoT；空白行保留。
- **Shell 批准秒停 (#542/#544)**：工具作用域 optionId。
- **侧栏代码预览 / 资源管理器定位 / 计划页滚动 / 会话切换风暴**。

### Security
- **Prod dependency CVEs + anti-regression**: Bump `dompurify` ≥3.4.13 (GHSA-55q2-fjhq-7xh7); `pnpm.overrides` pin transitive `mermaid` ≥11.16.1 (streamdown). CI + `pnpm audit:prod` fail on moderate+. Root is pnpm-only: delete stale `package-lock.json`, ignore reintroductions, `preinstall`/`deps:check` reject npm/yarn at root, `packageManager` field set.
- **WSL CLI path shell injection**: `~/…` expansion uses argv-safe `bash -lc` (`$1` / `"$@"`); path/distro reject shell metacharacters before spawn.

**中文 · 安全**
- **生产依赖 CVE 与防回归**：DOMPurify / Mermaid；pnpm-only 根目录。
- **WSL CLI 路径注入**：argv 展开 + 字符白名单。

## [0.2.12] - 2026-08-09

> **Highlight:** Tool/activity rail polish, reliable media paths, ChatCut/MCP longevity, proxy honesty, and Linux sandbox/AppImage fixes — plus a pre-release hardening pass on quit, media allowlist, and shell tool labels.
>
> **中文 · 亮点：** 工具活动轨体验统一、本地媒体路径更稳、ChatCut/MCP 长授权与代理更诚实、Linux 沙箱/AppImage 可诊断；发版前补强退出确认、媒体 allowlist 与 shell 工具文案。

### Added
- **Tool activity rail primary labels**: Unified type + call-arg labels for live and history tool steps (phase rail + bare rows); secondary expand shows fail hint / detail tail only. Host `session://tool` now carries `input` for accurate primary text.
- **Thinking / work chrome timers**: Live **Thinking for…** / **Working for…** and finished **Thought for…** / **Worked for…** (中文：思考中/思考了、工作中/工作了) with duration; no gist-as-chrome.
- **Project skills scan + tag**: `skills_list` merges `grok inspect` with disk scan of `{project}/.grok/skills/*/SKILL.md`; name collision prefers project; **[Project] / [项目]** badge on project rows only.
- **Provider brand logos (optional)**: Appearance setting can show known provider logos in the route UI (local assets; no invented remote fetch of secrets).
- **Network probe shows effective proxy**: Settings probe surfaces redacted decision/source/url so system vs manual vs env is honest.
- **⌘W closes side workbench tabs first**: App menu owns Close so File preview + ⌘W closes the active side tab before the window (browser-style).

**中文 · 新增**
- **工具活动轨一级文案**：统一类型 + 调用参数（含 live `input`）；二级展开仅失败提示/详情尾。
- **思考/工作阶段计时 chrome**：思考中/思考了、工作中/工作了 + 时长。
- **项目 Skills 扫描与标签**：合并 inspect 与项目磁盘技能；同名项目优先；仅项目行显示 [项目]。
- **可选供应商品牌 Logo**：外观设置可开。
- **网络探测展示生效代理**：决策/来源/URL（凭证脱敏）。
- **⌘W 先关侧栏标签**：有侧栏标签时优先关 tab，空 strip 再关窗。

### Changed
- **ChatCut editor opens in system browser by default**: Embedded WebView cannot reliably play ChatCut media; billing/editor use OS browser. Opt-in side Resources embedded browser remains for `forceEditorInApp`.
- **Finished phase tools auto-collapse**: Default collapse when a step finishes unless the user manually expanded/collapsed; expand keys live on the parent so VirtualList remount does not wipe open state.
- **Quit busy excludes stuck Connecting**: Dead reconnect loops no longer trap Windows users behind quit confirm; host 3s failsafe still covers a wedged WebView.
- **Proxy resolution honesty**: System PAC/SOCKS/HTTP merge, `socks5h`, effective snapshot for Settings; Remote IM `grok -p` uses the same child proxy inject as ACP (#540).

**中文 · 变更**
- **ChatCut 默认系统浏览器打开编辑器**（内嵌 WebView 播不了媒体）；仍可 opt-in 应用内 Resources。
- **完成的阶段工具默认折叠**（用户手动展开优先；expand 状态父级持有）。
- **退出忙碌不计 Connecting 死循环**；WebView 卡死仍有 host 3s failsafe。
- **代理解析更诚实**（PAC/SOCKS/系统；Remote IM 同 ACP 注入）（#540）。

### Fixed
- **Busy quit confirm no longer force-exits after 3s**: When the FE successfully opens the busy-confirm dialog, host `pending_quit` is disarmed (still force-exits if the WebView never answers; second close still quits).
- **Media HTTP path existence oracle closed**: Allowlist check runs before `exists()` so untrusted missing paths stay **403**, allowed-but-missing stay honest **404**.
- **Windows multi-disk media paths**: Fused query-key rejection only targets media keys `t`/`p` (e.g. `t:/Users/…`); real drives like `F:/…` are no longer misclassified.
- **Shell tool `rawInput` bare string**: `extract_tool_input` now reads string-form `rawInput` before object fields (was dead code after `as_object()?`).
- **Empty “运行命令 / Run command” tool rows**: Multi-line shell titles (`Execute \`…\``) broke `tool_step` journal parsing so `input:` was buried. Journal write forces one-line title/input; parser recovers buried `input:` and title command snippets.
- **Main window size not remembered after resize**: Debounced persist (~400ms) of size/position/maximize to `.window-state.json`; quit-confirm flushes immediately.
- **False `context_compact` from tool titles**: Host no longer treats tool titles containing the word “compact” (e.g. python `print("… compact …")`) as compaction; only structured compact sessionUpdates + token counters count.
- **Media mid-path false absolutes**: Bare extract no longer yields `/file.mp4` tails after space+CJK folders (`…/grok 美女视频/file.mp4`); fused `t:/Users/…` query keys rejected across pathNormalize / imageSrc / thumbs.
- **Linux AppImage black window docs + helper (#539)**: Document Wayland/AMD + bundled WebKitGTK black-screen class; README prefers `.deb`/`.rpm` or system-WebKit extract; `scripts/run-linux-appimage-system-webkit.sh`.
- **Linux sandbox / userns denial → `SANDBOX_BLOCKED` (#541)**: bwrap `uid map: Permission denied` → dedicated error + Doctor/README guidance (sysctl or Sandbox → off).
- **Reconnect residual provider retries**: `session/load` / idle shared-process `retry_state` no longer journals NETWORK_PROVIDER or flips FSM without a host-owned turn.
- **MCP silent OAuth refresh**: Persist refresh_token + refresh near expiry so ChatCut (and similar) stay authorized without re-browser every hour.
- **Custom provider `context_window` TOML integer (#538)**: Write bare integer (not quoted string); heal legacy quoted values on list; docs note.
- **Context compact banner long text wrap (#537)**: Long summary lines wrap instead of overflowing the chrome.
- **Provider brand / proxy child env**: Direct mode strips proxy env; Use mode sets redacted logging; quit failsafe second-close force exit.

**中文 · 修复**
- **忙碌退出确认不再 3 秒后被强杀**：FE 弹出 confirm 时解除 pending_quit。
- **媒体 HTTP 路径存在性侧信道关闭**：先 allowlist 再 exists。
- **Windows 多盘媒体路径**：fused 仅 `t`/`p`。
- **Shell bare-string `rawInput`**：字符串形态可被提取。
- **工具行「运行命令」无内容**：多行 Execute 标题/input 解析修复。
- **主窗口尺寸记忆**：缩放后防抖落盘。
- **假 context_compact**：工具标题含 compact 字样不再当压缩。
- **媒体 mid-path 假绝对路径与 fused `t:/`**。
- **Linux AppImage 黑屏文档/脚本（#539）**。
- **Linux 沙箱 userns → SANDBOX_BLOCKED（#541）**。
- **重连残留 provider retry 不污染会话**。
- **MCP 静默 OAuth refresh（ChatCut 长授权）**。
- **`context_window` 写 bare TOML 整数（#538）**。
- **上下文压缩横幅长文换行（#537）**。
- **代理 Direct/Use 环境与二次关闭 failsafe**。

### Notes
- ChatCut embedded browser remains available only when explicitly forced in-app; default is system browser for media reliability.
- Linux sandbox block is diagnostic guidance — App does not change host sysctl automatically.

**中文 · 说明**
- ChatCut 默认系统浏览器；仅强制 in-app 时走内嵌。
- Linux 沙箱拦截只给引导，不自动改 sysctl。

## [0.2.11] - 2026-08-08

> **Highlight:** Desktop UX polish batch — native **Copy image** (Feishu-pasteable), **per-session composer drafts**, closable side pane + titlebar maximize, **Mark as unread**, and **DeepSeek balance** in settings/sidebar.
>
> **中文 · 亮点：** 桌面体验补丁包：原生**复制图片**（可贴飞书）、**按会话保留输入草稿**、非最大化可关侧栏 + 标题栏双击最大化、**标为未读**，以及 **DeepSeek 余额**查询。

### Added
- **DeepSeek balance probe**: Host `providers_balance` calls `GET https://api.deepseek.com/user/balance` (Bearer key; amounts stay strings). Settings → Custom providers shows **Check balance**; active DeepSeek route shows `110.00 CNY` on the sidebar footer and in UserMenu (5 min session cache, no invented zeros). Other providers unsupported for now (#534).
- **Mark as unread**: Session menu toggle uses existing unread storage; hold while the chat stays open so focus auto-clear does not wipe it instantly (#532).

**中文 · 新增**
- **DeepSeek 余额查询**：Host `providers_balance` 请求官方 `/user/balance`；设置页可查完整明细，激活 DeepSeek 时侧栏左下角与个人菜单显示 `110.00 CNY` 一行（会话内 5 分钟缓存，失败不编造 0）（#534）。
- **标为未读**：会话菜单切换未读标记；当前打开会话保持至离开再进入（#532）。

### Fixed
- **Copy image to OS clipboard (Tauri)**: Chat / attachment / lightbox “Copy image” prefers Host `clipboard_write_image_path` for local files (disk → arboard, no WebView fetch), then `clipboard_write_image` for URLs, then browser ClipboardItem. Fixes silent no-ops when pasting into Feishu and other apps (#535, #536).
- **Per-session composer drafts**: Switching threads no longer drops a half-typed follow-up. Each real session keeps text / attachments / goal mode in `localStorage` (`grok.composerSessionDrafts`); restore on open, debounced persist while typing, clear on send or explicit clear. New-chat still uses the existing per-project buffer (#533).
- **Right side pane closable (non-maximized)**: Sync-clamp aside width before paint, keep main top toggle while open, re-clamp window into the work area after grow, protect side chrome under narrow width (#532).
- **Titlebar double-click maximize (mac)**: Enable maximize on all desktop hosts; `mousedown(detail=2)` fallback when drag regions swallow `dblclick` (#532).

**中文 · 修复**
- **复制图片到系统剪贴板（桌面端）**：聊天/附件/灯箱「复制图片」本地文件优先 Host `clipboard_write_image_path`（读盘 → arboard，不经 WebView fetch），URL 再走 `clipboard_write_image`，最后才回退浏览器 ClipboardItem；修复粘贴到飞书等应用为空（#535, #536）。
- **按线程保留输入框草稿**：切换会话不再丢掉半截 follow-up。真实线程的文字/附件/Goal 模式写入 `localStorage`（`grok.composerSessionDrafts`），打开时恢复、输入防抖持久化、发送或清空时清除；新对话页仍用原有按项目草稿（#533）。
- **非最大化时右侧栏可关闭**：打开前同步钳位宽度，保留主顶栏切换，增长后回钳到工作区，窄宽度下保护侧栏控件（#532）。
- **标题栏双击最大化（mac）**：全桌面端启用；拖拽区吞掉 dblclick 时用 mousedown 回退（#532）。

## [0.2.10] - 2026-08-07

> **Highlight:** Align the desktop workbench with **Grok Build CLI 1.0** — default effort/workflows match the CLI, CLI version & agent-binary skew are visible and repairable, Ops (tasks/dashboard/board) is reachable from the command palette, workflow runs stream live logs, and `/goal` shows an honest session chip.
>
> **中文 · 亮点：** 桌面端对齐 **Grok Build CLI 1.0**：默认推理/workflows 与 CLI 一致；CLI 版本与 agent 旁路漂移可见可修；命令面板可进 Ops（任务/仪表盘/看板）；workflow 运行有实时日志；`/goal` 有诚实会话指示。

### Added
- **CLI 1.0 recommend chip + agent binary skew**: Runtime · CLI shows recommended ≥1.0.0 status; Doctor warns when the sibling `agent` binary version differs from `grok`, with one-click **Align agent with grok** (Settings + Doctor). Host `probe_cli` returns recommended / skew fields; `cli_repair_agent_sidecar` relinks/copies `~/.grok/bin/agent`.
- **Ops command-palette group**: **Agent ops** opens the multi-session dashboard; **Session task board** is fully wired (was palette-only); tasks / dashboard / board / batch share the `ops` group and keywords.
- **Workflow live log**: Headless Smoke/Run streams `workflows://run-progress` line events into Settings (elapsed time + progressive log); timeout kills the headless process.
- **Goal session chip waiting state**: When Composer `/goal` is on but the harness has not emitted `goal_updated`, a dashed **waiting** chip appears (no fake progress); active chip shows phase / detail / deliverable progress from real events.

**中文 · 新增**
- **CLI 1.0 推荐芯片 + agent 旁路漂移**：运行时 CLI 页展示推荐 ≥1.0.0；Doctor/设置检测 `agent` 与 `grok` 版本不一致并可一键对齐。
- **Ops 命令面板分组**：Agent 运维入口、会话任务看板完整接线；任务/仪表盘/看板/批量同属 ops。
- **Workflow 实时日志**：无头 Smoke/Run 按行推送进度到设置页；超时结束进程。
- **Goal 会话指示等待态**：已开 `/goal` 但尚无 `goal_updated` 时显示等待 chip，不发明进度。

### Changed
- **Default reasoning effort → high**: Aligns with Grok Build 1.0 `models_cache` (static catalog + new installs). One-shot migration lifts global stored product-default `medium` → `high`; deliberate low/high/max kept. Spawn passes catalog effort ids including custom `max` / `xhigh` (no 3-tier hard allowlist).
- **Workflows enabled by default**: App default and one-shot migration match CLI ≥0.2.111/1.0 (`workflows_enabled` true). Independent agent-home is synced; **shared** mode still does not rewrite `~/.grok`.
- **catalog.md / product copy**: Document 1.0 effort default, spawn pass-through, CLI recommend/skew, workflow live log, and goal chip honesty.

**中文 · 变更**
- **默认推理强度改为 high**：对齐 CLI 1.0；一次性迁移历史产品默认 medium；spawn 透传自定义 effort id。
- **Workflows 默认开启**：与 CLI 默认一致；独立 agent-home 写入，共享模式仍不改写 `~/.grok`。
- **产品文档**：catalog 与设置文案对齐 1.0。

### Fixed
- **Windows embedded browser stuck on “Loading…” (#530, #531)**: `side_browser_create` is now an async command that runs `window.add_child` via `spawn_blocking`, so the UI/IPC thread is not blocked while WebView2 waits on the platform event loop. Same-label webviews are reused (no sync close→recreate), frontend cleanup is delayed 150ms (StrictMode remount cancel), and create has a 15s timeout with error + open-external fallback. Thanks @Sixmin.
- **Side browser IME Enter**: URL bar composition/confirm Enter no longer navigates while IME is open (type-safe IME key check).
- **Workflow live log render**: Settings panel uses log `.text` (not the prep object) so typecheck/build stay clean.

**中文 · 修复**
- **Windows 内嵌浏览器卡在「加载中」（#530, #531）**：异步创建 WebView2 + 超时/复用，避免死锁。感谢 @Sixmin。
- **侧栏浏览器 IME 回车**：候选确认时不触发导航。
- **Workflow 实时日志类型**：结果面板正确渲染文本。

### Notes
- Hard CLI floor remains **0.2.112**; **1.0.0** is recommended (soft chip). App ACP always spawns **`grok`**, not the `agent` sidecar.
- Goal waiting chip is display-only; it does not enable the CLI goal harness.

**中文 · 说明**
- CLI 硬门槛仍为 0.2.112；推荐 1.0.0。App 始终 spawn `grok`。Goal 等待 chip 仅为展示，不会开关 harness。

## [0.2.9] - 2026-08-07

> **Highlight:** Chat stability & UX hardening — session-switch transcript ownership (#529), turn-end tool layout + localized work duration, sidebar group/Shift multi-select, context-ring occupancy accuracy, and an in-place embedded browser (no more recreate).
>
> **中文 · 亮点：** 会话切换稳定性（#529 不再串项目）、回合结束工具布局与中文本地化时长、侧边栏分组全选 + Shift 范围多选、上下文环占用率准确化、内嵌浏览器就地导航/刷新不再重建。

### Added
- **Sidebar group select-all + Shift range multi-select**: In multi-select mode, each project folder and “Other sessions” show Select-all / Deselect-all; Shift+click selects a contiguous range using sidebar tree order (#sidebar-refactor).
- **Login paste-back code (optional fallback)**: While `grok login` is waiting, Account panel can accept the “copy this code into Grok Build” verification code from some auth.x.ai pages and feed it to CLI stdin. Normal OAuth still auto-completes; no paste required (docs/llm-wiki/account.md).
- **Embedded browser refresh / in-place navigation**: URL changes navigate without tearing down the webview; toolbar refresh and Enter-on-same-URL do a true document reload (host `side_browser_reload`).
- **Dock/tray badge shows unread chats**: Badge now counts chats that finished a reply in the background (post turn-end), not live busy sessions; window focus / opening a chat clears it immediately.
- **CLI context window + percentage**: Agent-reported `context_window` / `percentage` (auto_compact_started / tokens_used) drive the context ring %, matching `/session-info`; persisted per-session so reopen keeps the CLI denominator.

**中文 · 新增**
- **侧边栏分组全选 + Shift 范围多选**：多选模式下每个项目/「其他会话」支持全选/取消全选；Shift+点击按侧栏树顺序连续选中。
- **登录粘贴验证码（可选回退）**：部分 auth.x.ai 页面要求「将代码复制到 Grok Build」时，可在账户面板把验证码送入运行中的 `grok login`；常规 OAuth 仍自动完成，无需粘贴。
- **内嵌浏览器刷新/就地导航**：改 URL 不再重建 Webview，刷新按钮与同 URL 回车做真正的文档重载。
- **Dock/托盘角标改为未读数**：统计后台回合结束的未读会话数，聚焦/打开会话即时清零。
- **CLI 上下文窗口与百分比**：以 `auto_compact_started` / `tokens_used` 的 `context_window` + `percentage` 为准显示上下文环百分比，与会话信息一致；跨会话重开也保留。

### Fixed
- **Session-switch transcript pollution (#529)**: `sessionTranscriptStore` now tracks `messagesOwnerSessionId` separately from the viewing id; reducers (stream / rehydrate / clear-streaming / journal) never reduce against the previous chat under the new session id. `openSession` paints the target cache immediately.
- **Turn-end tool layout**: Finished assistant segments collapse to thought → tools → content without a full remount (`reorderSegmentsToHistoryLayout`); live streaming keeps true interleave until the turn ends.
- **“Worked for …” accuracy**: Duration prefers the tool-span from journal timestamps over short remounted live timers; duration strings localized (zh / zh-TW: N分N秒, N小时N分).
- **Context ring inflated by billing aggregates**: `turn_completed.usage.totalTokens` is a multi-call billing sum (10–20 model calls) — it no longer drives the ring; only `context_size` / `auto_compact_started` / safe single-shot occupancy does. Cost rollup keeps billing totals.
- **Intermittent re-login after project switch (#528)**: Auth profile ranking prefers signed-in → refresh → not-expired → canonical `~/.grok`; `sync_cli_auth_to_agent_home` compares bytes (not mtime); process reuse gate uses route class from `AcpClient.custom_route` (custom channels store upstream model ids, not provider ids); warm reuse re-applies route auth before `session/load`; official `authenticate` re-syncs + retries once on soft-fail.
- **Rail free-scroll vs programmatic cursor (#280)**: Rail highlight prefers scroll-derived state; parent tracks the free-scroll cursor via ref-only `onScrollActiveChange` — prev/next step from the reading position without per-frame setState; a11y listitem wrapper keeps button semantics.
- **Rail highlight drift on filtered transcripts**: Rail estimate + jump now use the paint list (filtered) instead of journal indices, so hidden tool rows no longer offset the highlight.
- **Embedded browser open/close jitter**: Visibility uses a redundant-show/hide guard; bounds re-apply only when they move; webview no longer steals keyboard focus on create.
- **Stale Rust test**: `settings_default_factory_and_disk_roundtrip` asserted sandbox default `off`; product default is `workspace` (matches frontend `DEFAULT_SANDBOX_PROFILE`).

**中文 · 修复**
- **会话切换串台（#529）**：`sessionTranscriptStore` 增加 `messagesOwnerSessionId`，流式/重水合/清流式/日志合并一律只对目标会话自己的缓存归约；`openSession` 立即绘制目标缓存。
- **回合结束工具布局**：已完成的助手段落折叠为 思考→工具→正文，无需整组件重挂载；流式期间保持真实交错。
- **「工作 X 秒」时长不准**：优先取日志时间戳的实际工具跨度，不再被重挂载的短计时器覆盖；时长中文本地化（N分N秒 / N小时N分）。
- **上下文环被计费聚合撑满**：`turn_completed.usage.totalTokens` 是多次 modelCall 的计费总和，不再作为占用率；只有 `context_size` / `auto_compact_started` / 安全的单次占用才驱动圆环，费用汇总仍用计费值。
- **切换项目后偶发重新登录（#528）**：认证档案按 已登录→有 refresh→未过期→规范路径 排序；`sync_cli_auth_to_agent_home` 改为按字节比较；进程复用门改用 `AcpClient.custom_route`（自定义通道存的是上游模型名）；热复用前重放路由认证；官方认证软失败时重同步并重试一次。
- **轨道高亮漂移（#280）**：自由滚动高亮优先，父组件经 ref 同步读取位置；估算与跳转改用过滤后的绘制列表，隐藏的工具行不再导致高亮错位。
- **内嵌浏览器抖动**：显隐防抖 + 边界仅在移动时重应用；创建时不再抢键盘焦点。
- **过时的 Rust 测试**：沙箱默认值断言改为 `workspace`（与前端 `DEFAULT_SANDBOX_PROFILE` 一致）。

### Notes
- 上下文占用字段来自 Grok Build CLI 0.2.x wire（`params._meta.totalTokens` / `auto_compact_started`）；`turn_completed.usage` 仅用于费用统计。

## [0.2.8] - 2026-08-06

> **Highlight:** Volcengine Ark (火山方舟) provider preset with DeepSeek V4 Flash, plus Base URL full-path so Coding Plan roots are not forced to `/v1`.
>
> **中文 · 亮点：** 内置火山方舟预设（DeepSeek V4 Flash）+ Base URL「完整路径」，Coding Plan 根路径不再被强行补 `/v1`。

### Added
- **Provider Base URL “Full path” switch**: Next to the Base URL field label. When on, host does not auto-append `/v1` (stored as `app_base_url_full_path` in agent-home `config.toml`). Default off keeps legacy OpenAI-compatible `/v1` normalization so existing relays are unchanged. Enables Volcengine Ark Coding Plan roots (`…/api/coding`, `…/api/coding/v3`, `…/api/plan/v3`) and similar non-`/v1` gateways (#527).
- **Volcengine Ark (火山方舟) preset**: Add-provider gallery ships a one-click channel — `https://ark.cn-beijing.volces.com/api/plan/v3` with **full path**, `chat_completions`, model **`deepseek-v4-flash`** (DeepSeek V4 Flash), Grok-style efforts, console API-key link, brand logo, and empty-session welcome mark (logo +「火山方舟」). Existing local ids such as `huo-shan` / Ark hosts resolve the same brand (#527).

**中文 · 新增**
- **服务商 Base URL「完整路径」开关**：打开后不再自动拼接 `/v1`，兼容火山方舟 Coding Plan / Plan 等非 `/v1` 根路径；默认关闭，老配置行为不变（#527）。
- **火山方舟预设**：添加提供商一键预填完整路径 + Chat Completions + **DeepSeek V4 Flash**（`deepseek-v4-flash`）、品牌 logo 与空会话欢迎字标；已有 `huo-shan` 等通道按主机名识别同一品牌（#527）。

## [0.2.7] - 2026-08-06

> **Highlight:** Faster chat file/image cards (metadata + disk thumbs), less scroll jitter, boot probe timeout, and auth recycle after login so re-login no longer keeps a warm prewarm with stale OIDC.
>
> **中文 · 亮点：** 聊天文件/图片卡片更快（元数据打开 + 磁盘缩略图）、滚动更稳、启动 CLI 探测超时；登录后回收含 prewarm 的 Agent，避免「已登录仍 401」。

### Fixed
- **Chat file-card preview very slow**: Opening a path card no longer waits on window resize before showing the right pane; cards resolve path **metadata only** (`fs_resolve_path` / classify) instead of full-file `fs_open_path` on history paint; absolute opens use `fs_read_absolute` (skip monorepo walk); office/image previews stream without host-side unzip/base64 on open.
- **File cards silent on missing paths**: Chat `FilePathCard` soft-fail (`not found` / denied) now surfaces via `onOpenError` → status banner instead of looking like a dead click when the cited relative path is not on disk.
- **Unopenable paths stay plain code**: File path tokens that cannot resolve to a real on-disk path no longer render as interactive file cards — only verified paths (or URLs) get card chrome.
- **Chat image load jitter**: Inline image cards use a fixed 150px height (width follows ratio) so decode no longer reflows the transcript; chat scroller uses `scrollbar-gutter: stable`; virtual-list row measure ignores sub-4px flicker and coalesces ResizeObserver storms.
- **Image card aspect cache**: Natural image ratios are stored in memory + `localStorage` (`grok.imageAspectCache.v1`, keyed by absolute path / media `p=`), so scroll remounts and next launch draw the correct card width immediately without reflow.
- **Chat scroll jitter (all sessions)**: Virtual list no longer rebuilds spacers from mid-fling row remeasures (buffer heights until scroll idle); first measure anchors using the estimate; FilePathCard resolve results are cached so remounts do not flash plain→card.
- **Chat image thumb disk cache**: Card previews use Host-resized JPEG thumbs under `{app_data}/cache/image-thumbs` (path+mtime or URL key, ≤480px); lightbox still opens the original. Media HTTP image responses use week-long private cache headers.
- **Boot stuck on “Checking Grok Build…”**: CLI `--version` probe now has a 3s kill timeout and runs on `spawn_blocking`; frontend boot races settings+probe with a 12s timeout and shows Retry / open Setup instead of spinning forever.
- **Re-login still 401 (warm prewarm reuse)**: After successful login, logout, or multi-account switch, Host now `recycle_all_agents(..., "account_auth")` so live / background / parked **and prewarm** CLI processes are killed. Previously login only called `session_disconnect` (park), and `drain_all_agent_slots` omitted prewarm — connect preferred a Ready prewarm spawned with missing/stale OIDC → intermittent `AUTH_FAILED` / `no auth context` even though `auth.json` was synced (#525 file sync alone was not enough). Support: CharlieLam 2026-08-05.
- **AUTH error deck subtypes**: Host still emits `AUTH_FAILED`, but the banner refines with message + active provider route into `AUTH_NO_CONTEXT` (re-login + reconnect), `AUTH_API_KEY` (open Providers / Account), and `AUTH_CUSTOM_PROVIDER` (custom relay active — official re-login alone will not fix). en/zh/zh-TW; pure `refineAuthDeckCode` + tests.
- **Permission “Allow for session” cancels shell turn**: Host now stores the ACP `options` list with each pending permission and re-coerces the wire `optionId` on resolve. UI generic fallbacks (`always-allow` / `allow-always`) are rewritten to tool-scoped ids such as `allow-always-command` so Grok Build no longer returns `unknown permission option` and `permission_rejected` mid-turn. Also maps CLI `allow_always_bash` kind in the permission bar.
- **Sticky “Working” after turn end**: Live phase/step running state is gated on message streaming so unfinished wire tool statuses no longer keep “Working for …” forever; thought/tool/working icons and spacing share activity chrome tokens.

**中文 · 修复**
- **文件卡片打开慢 / 点不动 / 假卡片**：元数据解析代替整文件打开；缺失路径走错误条；无法落盘的 token 不再做成可点卡片。
- **图片卡片抖动与缩略图**：固定高度 + 宽高比缓存 + 磁盘 JPEG 缩略图；虚拟列表滚动测量更稳。
- **启动卡在「正在检查 Grok Build…」**：CLI 版本探测 3s 超时 + 前端 12s 竞态与重试。
- **重新登录仍 401**：登录/登出/切号后 `recycle_all_agents` 含 prewarm，避免旧 OIDC 预热进程被复用。
- **鉴权错误分型**：`AUTH_NO_CONTEXT` / `AUTH_API_KEY` / `AUTH_CUSTOM_PROVIDER` 引导不同处理。
- **「本会话始终允许」取消 shell 回合**：按 CLI 合法 optionId 重写；bash 始终允许映射。
- **回合结束后仍显示 Working**：运行中状态绑定 streaming，活动栏图标样式统一。

## [0.2.6] - 2026-08-05

> **Highlight:** Chat white-screen on older macOS WebKit (#526), Plan mode resume honesty, sticky Streaming/permission gates (#522–#525), window geometry restore, and xlsx security bump.
>
> **中文 · 亮点：** 修复旧版 macOS WebKit 聊天白屏（#526）；Plan 模式恢复与审批门闸更稳；Streaming/权限卡死（#522–#525）；记住窗口尺寸位置；xlsx 安全升级。

### Security
- **xlsx**: replace abandoned npm `xlsx@0.18.5` (Prototype Pollution / ReDoS) with SheetJS Community **0.20.3** from the official CDN tarball (CVE-2023-30533 / CVE-2024-22363 fixed). Drop obsolete `@types/xlsx`.

### Added
- **Remember main window geometry**: persist size, position, maximize, and fullscreen across launches (`tauri-plugin-window-state` for the primary workbench only; skip visible/decorations so close-to-tray and platform chrome stay correct). Also save on hide-to-tray.

### Changed
- **Default sandbox (new installs)**: App / Host default `sandboxProfile` is now **`workspace`** (OS isolation under the project tree). Existing settings that already stored `"off"` are unchanged. Settings UI still offers off / read-only / strict / devbox.
- **Windows Authenticode (optional CI)**: Release workflow imports `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD` when set, writes thumbprint merge config, and signs the Windows bundle with `signtool`. Unsigned builds remain supported without secrets. Docs: `docs/BUILD.md`.
- **Stream stall default**: product default soft-stall raised to **10 minutes** (migrate prior 120/180 once; keep deliberate custom values). Long tools/workflows often go quiet without being stuck.
- **Themed boot shell**: paint a Grok logo boot shell using Host `settings.theme` (UI dual-write); finish setup gate without blocking on media server, keychain, or full list hydrate.

### Fixed
- **#526 chat view white-screen on older macOS (WebKit)**: media path scan used a negative lookbehind regex (`(?<!…)`) that throws `Invalid regular expression: invalid group specifier name` on Safari/WKWebView before lookbehind support (e.g. macOS 12). Chat `UiErrorBoundary` then replaced the whole transcript. Rewrite with a post-match previous-char boundary check (no lookbehind).
- **Plan mode gate disconnect**: Host no longer drops live `exit_plan_mode` / `ask_user_question` reverse-RPCs as session/load replay (Build re-parks approval after resume with no prompt in flight). Background demoted turns surface Plan + AskUser; process exit / recycle invalidate plan rpcIds so Approve cannot write to a dead agent; UI keeps plan body read-only and reopens on a new rpcId. Background plan-ready toast when another chat awaits review.
- **Plan mode resume (P1)**: persist plan chrome under the app session (`plan_chrome.json`); on open, restore body + closed flags and merge agent `plan_mode.json` / `plan.md` when `awaiting_plan_approval`; sticky bar shows reconnect/re-park hint until a live reverse-RPC returns.
- **Plan pending sidebar badge**: sessions awaiting plan review (live gate or restored re-park) show a non-interactive plan chip on the session row; open / busy spinner / select / pin actions unchanged.
- **Window geometry flash**: create the main window at the cached size before show; skip plugin auto-restore on ready and apply saved size/position synchronously in setup, then show and focus.
- **Stream after thinking**: Host may mark the turn `ready` before the assistant body finishes (early `prompt_complete`). Late body tokens were dropped when the focused host was no longer “live streaming”, so the bubble stayed empty until restart (journal already had the text). Late tokens now apply when the turn bubble is still streaming or body-empty; pure post-turn replays still drop. Journal rehydrate retries once after 400ms if the body is still empty.
- **Multi-session turn routing**: drop parked co-tenant load/orphan traffic on shared agent processes so `session/load` cannot rewrite another chat’s journal. Enlarge in-chat image cards (≤150px, timeline pathMap); lightbox fits the stage then supports drag-pan when zoomed past the viewport.
- **PDF open freeze / black window**: `react-pdf` `Document` was given a new `Uint8Array` every render → remount loop and GPU thrash when opening a generated PDF (file card / panel). Memoize the `file` prop. `path_open` now detaches with null stdio on a blocking thread so slow default handlers cannot stall the WebView IPC loop.
- **#522 sticky Streaming busy after successful turn**: `session/prompt` Ok now always emits authoritative `PromptComplete` (compat `stopReason` / `stop_reason` / default `end_turn`); stamp prompt RPC with agent session id for multi-session routing; Host force-clears `prompt_in_flight` if still set after Ok.
- **#523 permission Allow for session rejected by CLI**: fallback wire `optionId`s aligned with Grok Build CLI (`allow-once`, `always-allow`, `reject-once`, plus `allow-always-command|mcp|domain`); Host + UI no longer send underscore / non-existent `allow-always`.
- **#524 stale permission bar after recycle**: track pending permission RPC per session; `recycle_all_agents` emits `session://permissions_invalidated` and clears gates; `resolve_permission` refuses dead agents.
- **#525 multi-project “re-login”**: prefer signed-in `~/.grok/auth.json` over stale signed-out agent-home profile; sync agent-home auth by **content**, not mtime only, so custom-route clear cannot block official restore on next project connect.

**中文 · 安全**
- **xlsx**：弃用 npm `xlsx@0.18.5`，改用官方 CDN 的 SheetJS Community **0.20.3**（修复 CVE-2023-30533 / CVE-2024-22363）；移除过时 `@types/xlsx`。

**中文 · 新增**
- **记住主窗口几何**：跨启动保存尺寸、位置、最大化与全屏（仅主工作台；隐藏到托盘时也会落盘）。

**中文 · 变更**
- **默认沙箱（新安装）**：默认 `sandboxProfile` 改为 **`workspace`**；已存 `"off"` 的用户设置不变。
- **Windows 可选 Authenticode**：Release CI 在配置证书密钥时用 `signtool` 签名；无密钥仍可出未签名包。
- **流式静默默认**：产品默认软静默阈值升至 **10 分钟**（旧 120/180 一次性迁移；用户自定义保留）。
- **主题启动壳**：按 Host `settings.theme` 绘制 Grok logo 启动壳；setup 门闸不再被媒体服务 / 钥匙串 / 全量列表拖住。

**中文 · 修复**
- **#526 旧版 macOS 聊天白屏**：媒体路径扫描使用负向 lookbehind，在无 lookbehind 的 WKWebView（如 macOS 12）上抛 `invalid group specifier name`，聊天 Error Boundary 整页灰屏。改为匹配后再检查前一字符边界。
- **Plan 门闸断连 / 恢复 / 侧栏徽章**：断连与 recycle 后审批 RPC 诚实；持久化 plan chrome；待审会话侧栏 plan 芯片。
- **窗口几何闪烁**：show 前同步恢复缓存尺寸位置。
- **思考后正文丢字 / 多会话路由 / 图卡与 lightbox**：late token 与 journal 再水合；共享 agent 不再改写其它会话；图卡放大与缩放拖拽。
- **PDF 打开卡死黑屏**：memoize `react-pdf` file；`path_open` 脱离 WebView IPC 循环。
- **#522–#525**：Streaming 卡 busy、权限 optionId、recycle 后权限条、多项目「重新登录」。

## [0.2.5] - 2026-08-04

> **Highlight:** Codex-style **side workbench** + redesigned **Settings → Extensions** (plugin cards, ChatCut recommend, market merge), multi-module **stream/perf isolation**, ChatCut Codex adapter + in-app MCP OAuth, and Docker mirror **QUIC → HTTP/2** fallback (#517).
>
> **中文 · 亮点：** Codex 式**右侧 Side Workbench** + **设置 → 扩展** 重设计（插件卡片 / ChatCut 推荐 / 市场并入）；多模块**流式与性能隔离**；ChatCut Codex 适配与应用内 MCP OAuth；手机镜像 Docker 隧道 **QUIC 失败自动改 HTTP/2**（#517）。

### Added
- **Side workbench** (Codex-style right pane): multi-tab shell for Files / Review (multi-file diff) / Terminal / Browser / Plan with picker shortcuts, env info, and glass empty states — pure `sideWorkbench` helpers + host terminal/browser seams; en/zh/zh-TW.
- **Settings → Extensions redesign**: remove top-level Market tab; tabs **Plugins · MCP · Skills · Agents · Hooks** with co-located search. Plugins page: **Recommended (ChatCut `#codex`)** → Installed → Installable (ensure `openai/plugins`) → Advanced; card grid, logo cache + media HTTP, infinite scroll, detail modal; GlassModal install confirms only.
- **ChatCut Codex plugin adapter**: surface header + Resources browser handoff / start simulation path; independent-mode MCP mirror honesty for Doctor; en/zh/zh-TW wiki (`docs/llm-wiki/chatcut.md`).
- **MCP in-app OAuth browser flow** for ChatCut and remote HTTP MCP (force browser authorize, surface host start errors, i18n for browser-flow copy).
- **Webview zoom hotkeys**: `Cmd/Ctrl +` / `-` / `0` for desktop zoom (#506).

### Changed
- **Stream / perf isolation batch**: adaptive host stream coalesce + tool batch queue (#516); virtualize long Grok activity step lists (#515); external composer draft store + memo editor (#510); memo session rows + isolate relative time (#509); stream-perf mode cuts wallpaper/backdrop thrash (#513); lazy heavy modals / live tasks panel / adaptive notify; subscribe full `liveMap` only when panels need it; live chat-find against transcript store.
- **Composer / stream hardening** alongside extensions UI: stick-follow, soft stall policy, path/media helpers shared with side workbench.

### Fixed
- **#517 Docker mirror tunnel**: detect repeated pre-registration QUIC connectivity failures in the managed cloudflared Docker adapter, clean up the failed attempt, and retry with `--protocol http2` (host-binary path unchanged; unit tests for protocol flag + failure heuristics).
- **Chat stick-to-bottom**: stream follow while pinned; user attachment strip layout; never auto-end turns on soft stall alone.
- **Media**: normalize local media paths and soft-fail missing files; render ChatCut S3 protocol-relative thumbs and skip placeholders.
- **Embedded browser**: stabilize native webview bounds; clean settings spacing CSS.
- **Extensions polish**: dedupe plugin / ChatCut·codex cards; flush logo tiles without padding; serve plugin logos via media HTTP with `~/.grok` allowlist.
- **CI baselines**: restore `cargo fmt` + file-size gates (worktree path tests extract; Project Inspect normalizer move) so quality checks stay green with the tunnel fix.

**中文 · 新增**
- **右侧 Side Workbench**（Codex 式）：文件 / 多文件 Review / 终端 / 浏览器 / Plan 分栏与快捷选择
- **设置 → 扩展重设计**：插件卡片与推荐位、ChatCut `#codex`、市场并入可安装列表；安装仅 GlassModal 确认
- **ChatCut Codex 适配** + Resources 浏览器交接；Doctor 诚实展示独立模式 MCP 镜像
- **应用内 MCP OAuth 浏览器流**（ChatCut / 远程 HTTP MCP）
- **网页缩放快捷键** `Cmd/Ctrl +` / `-` / `0`（#506）

**中文 · 变更**
- **流式与性能隔离批次**：Host 自适应合并与工具批队列、活动步骤虚拟列表、Composer 草稿外置、侧栏行 memo、stream-perf 壁纸减负、重型 Modal 懒加载等
- 侧栏与扩展 UI 同期加固 composer/stream 行为

**中文 · 修复**
- **#517 镜像 Docker 隧道**：QUIC 注册前连续失败时清理并改用 HTTP/2 重试
- 流式置底跟随、用户附件条、软 stall 不自动结束回合
- 本地媒体路径规范化 / 缺失软失败；ChatCut S3 协议相对缩略图
- 内嵌浏览器 bounds 稳定；插件卡片去重与 logo 媒体 HTTP
- CI fmt / 大文件闸门基线恢复

## [0.2.4] - 2026-08-01

> **Highlight:** Architecture-level code-quality remediation (App shell, CSS domains, Host modules, CI gates) plus sticky **Streaming busy** fix after long background-tool turns (#453). Ships the large pro-honesty batch already on main since 0.2.3.
>
> **中文 · 亮点：** 架构级代码质量整改（App 壳 / CSS 分域 / Host 模块 / CI 闸门）+ 长工具回合后 **Streaming busy 粘滞** 修复（#453）；并随包发布 0.2.3 之后已合入 main 的 pro 诚实体验批次。

### Fixed
- **#453 sticky Streaming busy**: after the prompt RPC completes with no permission/plan/ask_user gate, Host force-clears leftover `open_tool_ids` (bg task id mismatch / missing terminal tool updates) so reconnect and new-session send are not blocked (`deferred_prompt_complete_force_clears_open_tools_after_rpc`).
- **Stream tail flush**: flush coalesced stream IPC on turn end so answers are not truncated mid-sentence until reopen.
- **CI**: `cargo fmt --check` green; pnpm workspace `packages` field restored so frontend install works; quality gates + ESLint (TypeScript parse) on CI.

### Changed
- **Code quality remediation** (final gate PASS): thin `App.tsx` + `ThemeProvider`; domain CSS split; `commands/` / `session_manager/` / `api/` modularization; SettingsPage / ResourceViewer / i18n / settingsCatalog domain splits; residual clippy cleanup.
- **App growth freeze** documented in AGENTS.md / maintain.md (new state must not land in `App.tsx`).

**中文 · 修复**
- **#453 Streaming busy 粘滞**：prompt RPC 结束后、无权限/计划/Ask 门控时，强制清理残留 `open_tool_ids`，避免 reconnect / 新会话首条被排队
- **流式尾包刷新**：回合结束刷新合并中的 stream IPC，避免需重开会话才看到完整回复
- **CI**：fmt 通过；修复 pnpm workspace `packages`；质量闸门与 ESLint（TS 解析）

**中文 · 变更**
- **代码质量全盘整改**（final 闸门 PASS）：App 壳 / ThemeProvider、CSS 分域、commands·session_manager·api 模块化、Settings/ResourceViewer/i18n 拆分等
- **App 增胖冻结**写入 AGENTS.md / maintain.md

### Added

#### Composer & chat
- **Diff hunk comment → chat**: Changes panel per-hunk **Comment** opens a GlassModal for a review note, then inserts a structured prompt (file + hunk snippet + note) into the composer without auto-send; pure `diffComment` helpers + tests; en/zh/zh-TW
- **PR review workbench** (Settings → Runtime → Tools → Pull requests): when CI overall fails, **Fix with Grok** builds a composer draft from observed failed checks; each comment/review row gets **Ask Grok** for a comment-address draft. Inserts into the workbench composer + soft toast (never auto-sends; no invented `gh` data). Pure `prReviewWorkbench` helpers + tests; en/zh/zh-TW.
- **Agent dashboard peek + dispatch**: permission-first row sort (needs you → busy → connecting → error → idle); row chevron expands a read-only peek card (status, tool, path, model) without focusing the chat; **Open chat** inside peek focuses; top **Dispatch new agent** form (trusted project + prompt) opens a new chat, fills the composer, and soft-sends. Pure helpers `buildDashboardPeekModel` / `planDashboardDispatch` / `sanitizeDispatchPrompt` / `groupDashboardRowsByStatus` + tests; en/zh/zh-TW; no `window.confirm`.
- **Parallel task (worktree)**: one flow to create a linked git worktree and open a new chat there (palette `parallel-worktree-task` + worktree menu). Optional first prompt fills the composer; optional “send after open” (default off, trusted only). Pure `worktreeParallel` helpers + tests; en/zh/zh-TW
- **Editable plan canvas** (Resources → Plan): when a plan is awaiting review, **Edit plan** opens a local markdown draft; dirty drafts disable **Approve** (hint: request changes with your edits first); **Request changes with draft** sends feedback with clear revised-plan markers; discard dirty edit uses GlassModal (no `window.confirm`). Pure `planEditCanvas` helpers + tests; en/zh/zh-TW.
- **Send-intent honesty** (steer / queue / concurrent): pure `resolveSendIntent` classifies what Send will do — enqueue follow-up on same-session busy, foreign concurrent when another chat is live, blocked on permission/empty — without changing enqueue rules. Composer shows a pre-send banner + optional **Open as new chat** CTA; queue strip labels stay consistent (follow-up vs hold vs steer hint). en/zh/zh-TW + tests.
#### Composer & chat / Sessions
- **Agents rail** (Resources side mode): first-class **Agents** tab in the right resource pane shows the current session’s subagent/tool task tree (reuses `AgentTasksPanel` + `sessionTasks` — no invented metrics). Running-count badge; honest empty states (no tasks · filter empty · idle hint); bind cwd / WT badge same as floating Tasks panel. Pure `agentsRail` helpers + tests; en/zh/zh-TW.
- **Goal orchestration control panel**: Reliability Goal section gains **Clear timeline** (local event ring only — GlassModal confirm with count; never `window.confirm`) alongside phase filter chips and **Copy summary** (redacted one-pager). Session goal chip opens a small menu: open Reliability · copy summary · clear local timeline. Pure helpers `planClearGoalOrchEvents` / `shouldConfirmClearGoalOrch` / `resolveGoalControlEmptyState` (ui_off · no_events · filtered · session_mismatch) / `buildGoalControlSummary` / `canClearGoalBar` (composer `/goal` bar remains independent of the event ring). Honest empty states only — never invents goal progress. en/zh/zh-TW + tests.
#### Sessions & sidebar
- **Session task board**: cross-session board view of local sessions by status columns (needs you · running · error · idle · done/archived). Pure `sessionTaskBoard` helpers from sessions + liveMap only — no invented CI/cloud state; include-archived chip, title/project search, honest empty / filter-empty states. Open from Agent dashboard **Board view**, command palette `open-task-board`, or App state. en/zh/zh-TW + tests.
- **Agents & Personas console** (Settings → General → Agent): list built-in + user + project agent definitions and discovered personas (CLI `/config-agents` roots via host `agents_list`); filter, source badges, open/reveal when path known, folder browse, preferred-agent honesty when missing from catalog — never invents personas. Pure `agentsPersonasConsole` helpers + tests; en/zh/zh-TW; `settingsCatalog`.
- **Worktree compare vs main**: branch menu **Compare with main…** (linked worktrees only) opens a GlassModal with short stats chips + scrollable `git diff --name-status` file list (A/M/D/R badges). Soft-fail when same path / missing / not git; overflow count honesty (display cap 500). Per-row **Copy path** / **Reveal**. No merge or selective apply (out of scope). Pure `worktreeCompare` helpers + host `git_worktree_compare`; en/zh/zh-TW.
- **Workflows author experience** (Settings → Runtime → Tools): **New from template** GlassModal (name + user/project scope) writes a minimal pure-literal-meta `.rhai` scaffold via host `workflows_create` (path-scoped; refuse overwrite unless force); row **Reveal** / **Open** / Smoke / Run; collapsible **Recent runs** localStorage ring (max ~20, redacted log snippet, outcome/mode filters, GlassModal clear — no `window.confirm`); honest create-workflow skill hint (no visual graph editor). Pure `workflowsAuthor` helpers + tests; en/zh/zh-TW; `settingsCatalog`.
- **Automations Inbox** (review queue): Scheduled tasks page turns observed run history into an Inbox — outcome chips + search, unread mark-read / mark-all, open linked session (or project) when known, soft **Run now** only if the task still exists, clear via GlassModal (no `window.confirm`). Process-bound honesty banner: never invents offline runs after Quit. Pure `automationsInbox` helpers + tests; optional `sessionId` / `projectId` on run records; en/zh/zh-TW.
- **Sandbox profile wizard on project trust**: after trusting a project (when the global profile is still Off), optional GlassModal guide recommends **Workspace** for daily use, lets pick off / workspace / read-only / strict / devbox (danger note on off/devbox), and applies via Settings. Settings → sandbox row shows “Recommended for daily use” + **Open sandbox guide**. Windows / old-CLI honesty banners (soft-fail). Soft localStorage dismiss. Pure `sandboxWizard` helpers + tests; en/zh/zh-TW; no `window.confirm`.
- **Live Voice command center**: delegated session chips with title/status (click focuses session), dedicated tool + permission status region, footer honesty for Keep coding sessions on/off and end-session plan (keep vs cancel delegates). Pure `voiceCommandCenter` helpers + tests; empty transcript honesty (no invented STT); en/zh/zh-TW. No `window.confirm`.
#### Agent / search
- **Code graph product honesty** (Settings → Agent): unify codebase indexing status + project search mode chips so users see honest **keyword vs graph** states. Pure `codeGraphProduct` helpers (`resolveCodeGraphMode`, `buildCodeGraphStatusChips`, `annotateSearchHits`, `resolveCodeGraphEmptyState`, `planCodeGraphRebuild`) — **never invent graph hits** when only keyword (rg/walk) search exists; rebuild stays CLI-only until a host API lands. Indexing panel status line + soft “App search remains keyword” note; search panel mode chips + link to indexing. en/zh/zh-TW + `settingsCatalog` + tests.
- **Composer model / effort apply honesty**: after changing model or reasoning in the composer menus, a short toast states when it takes effect (immediate `session/set_model` · soft-respawn next message · next message when idle). Nested model/effort lists show a live-agent footer note; prefs errors are classified (set_model / soft-respawn / invalid / disconnected / busy). Pure `modelEffortApply` helpers + tests; en/zh/zh-TW. Spawn flags unchanged.
- **Skills task-level picker**: composer toolbar button opens a search + **recent** (localStorage ring, max 12) + host catalog list for the next prompt; pick inserts `[[skill:name]]` chip tokens (never invents skill rows). Soft empty states: no skills / filter empty / host-only CLI gap. Pure `skillsTaskPicker` helpers + tests; en/zh/zh-TW.
- **Memory operations center** (Settings → Agent): unify memory browser + embedding honesty + clear scopes — mode chips (`app_keyword` · `cli_hybrid` · `hybrid_unavailable` · `memory_off`), dream/watcher **config presence** only (never invents running status or embeddings), clear workspace/all via host `grok memory clear` with GlassModal confirm, session scope soft-unavailable. Pure `memoryOpsCenter` helpers + tests; en/zh/zh-TW; `settingsCatalog`.
- **LSP tools status workbench honesty** (Settings → Agent): dedicated card for `[features].lsp_tools` with status chips (`off` / `on` / `unset` / shared read-only / CLI old / host-only), soft-respawn note, and empty-state copy. Toggle reuses independent-only agent config write path. Honesty: App does not run language servers or invent live diagnostics — CLI agent tools only when enabled. Pure `lspToolsWorkbench` helpers + tests; en/zh/zh-TW; `settingsCatalog` keywords.
- **Resource multi-file tabs**: open several files in the Resources workbench with a tab strip (dedupe by path, max 12 with LRU drop), dirty marker for unsaved text edits, switch without losing drafts, and GlassModal discard confirm on close — pure `resourceTabs` helpers + tests; en/zh/zh-TW.
- **Message node deep links**: open a session and scroll to a message via `#/session/<id>/m/<messageId>` (or `?m=` / `?message=` / `?messageId=`). Reuses MessageNodeRail + virtualizer locate path; soft toast when the message is missing. Message action **Copy link** copies the app-relative hash. Multi-window secondary `#/session/<id>` still works (parser extended). Pure `messageNodeDeepLink` helpers + tests; en/zh/zh-TW.
- **Batch agents pro**: prompt template chips (code review · fix tests · summarize) with i18n titles/bodies; eligibility strip for selected projects (ready vs not eligible); results matrix **Copy summary** + **Download .txt** via pure `batchAgentsPro` (`applyBatchTemplate`, `exportBatchResultsSummary`, `planBatchExport` soft-fail empty, `classifyBatchResultRow` for ok-without-detail / partial honesty). en/zh/zh-TW + tests. No `window.confirm`.
- **Shared session-data mode switch honesty**: pure `sessionDataMode` helpers (normalize, honest home labels `~/.grok-app/agent-home` vs `~/.grok`, switch plan with concrete risk keys, shared-mode banner, always block silent mixed-read on flip). Settings shows current mode + home path, stronger shared banner (CLI share · no config rewrite · conflict possible). Independent ↔ shared confirm uses GlassModal risk list (not vague copy; no `window.confirm`); agents-recycled toast states histories were not merged. en/zh/zh-TW + `settingsCatalog` keywords; vitest.
- **App auto-update path honesty** (Settings → About): pure `appUpdateHonesty` maps signed in-app updater vs GitHub manual download vs unsupported package types vs host-only; progress states (checking / downloading / installing) with honest notes that agents, voice, Remote IM, and mirror stop only after successful install prepare; classified soft-fail errors (network · signature · plugin missing · not ready · host-only); manual path keeps Open release page + Download installer when asset URL known; no invented versions. en/zh/zh-TW + tests.
- **CLI supply-chain trust grades**: Setup + Settings → Runtime show explicit checksum risk chips (`verified` · `missing_sidecar` · `mismatch` · `unverified_allowed` · `unknown`) via pure `cliTrustSupplyChain` helpers. Missing sidecar is warn-grade honesty (official mirrors often omit sidecars); mismatch stays fail-closed and is never forceable. Clearer allow-unverified description; Doctor adds a `cli_checksum` finding when last install recorded `checksumVerified`. en/zh/zh-TW + tests.
- **Ask-user demo path** (Settings → Permissions): checklist with pass/fail chips for Ask policy, not YOLO, and ask-user enabled; **Apply recommended Ask policy**, **Copy sample prompt**, **Preview sample questionnaire** (AskUserModal, clearly demo — not from agent), and SPIKE-ACP docs link. Honesty banner: real `ask_user_question` depends on model/CLI; App only prepares settings and never auto-sends. Pure `askUserDemoPath` helpers + tests; en/zh/zh-TW; `settingsCatalog`.
- **Remote security ops** (Settings → Remote control → IM → Bridge overview): unified honesty checklist for allow-from ACL summary, inbound rate-limit status, Bridge health, phone-mirror write default, remote YOLO, and live-claim (never invents WS/Gateway without Bridge link). Pure `remoteSecurityOps` helpers (`parseAllowFromList` · `summarizeAllowFrom` · `classifyRemoteSecurityRisk` · `buildRemoteSecurityChecklist` · redacted `formatRemoteSecuritySummaryText`) + tests; copy summary button; link to channel allow-from; dangerous-write confirm inventory; YOLO enable uses GlassModal (no `window.confirm`); i18n en/zh/zh-TW; `docs/features/remote-security.md`.
- **Support bundle export honesty** (Reliability center): pure `supportBundlePro` helpers plan redacted sections (`doctor` / `settings` / `meta` / optional `stall-timeline` / `logs` / `README`), never claim secrets or invent logs; classified soft-fail (`host_only` · `cancel` · `io` · `empty` · `other`); GlassModal confirm with section checklist + text manifest preview before export; stall JSON only when signals exist. en/zh/zh-TW + tests.
- **Doctor platform capability matrix**: Doctor modal shows a **Platform matrix** table with honest macOS / Windows / Linux notes for CLI path probe, sandbox kernel (Seatbelt / Landlock / Windows soft-fail), window chrome (Overlay vs frameless vs decorated), app auto-update channel, and media loopback delivery — pure `doctorPlatformMatrix` helpers + tests; never invents probe results; en/zh/zh-TW. Complements the Windows day-use checklist without duplicating it.
#### Runtime / privacy
- **External OTEL dual opt-in honesty** (Settings → Runtime → Privacy): surfaces CLI enterprise OpenTelemetry (`GROK_EXTERNAL_OTEL` + exporters) without inventing off when unset. Status chips (`unknown` · `incomplete` · `ready` · `off` · `host_only`), dual-opt-in checklist, content-free-by-default note, redacted env template copy (no secrets written by App). Soft-parses privacy redacted preview for `[telemetry] otel_*` when present. Pure `externalOtelHonesty` helpers + tests; en/zh/zh-TW; `settingsCatalog`.
- **Windows day-use checklist** (Doctor): productizes `docs/验收/windows-dayuse-acceptance.md` as an in-app honesty card — install path, CLI found, project spaces, single attachment, app update check, mirror read-only. Pure `windowsDayuseChecklist` helpers auto-probe what App can know and leave the rest **manual** (never invents SmartScreen / unsigned). Non-Windows shows N/A with “not the target of this list”. Copy summary; deep links to About / Mirror / Runtime. Settings → Runtime platform tip. en/zh/zh-TW + tests.
#### Settings / permissions
- **Permission rules simulator pro honesty** (Settings → Permissions): sample tool-call chips (`git status` · `rm` · `edit`), deny/ask/allow count chips, list filter with empty honesty (no rules · filter empty + clear), severity-colored simulation result chips, honesty lines (preview-only / falls through to mode), and **Copy match summary** (stable plain-text; no `window.confirm`). Pure `permissionRulesPro` helpers (`resolvePermissionRulesEmptyState` · `countRulesByAction` · `formatSimulationResult` · `suggestSampleToolCalls`) + tests; en/zh/zh-TW.
- **Open-in-editor / reveal soft-fail honesty**: classify Host `open_in_editor` / `path_reveal` / `path_open` failures into stable kinds (`no_editor` · `not_found` · `path_denied` · `host_only` · `cancelled` · `other`) so ResourceViewer, Open Location, and file chips show i18n toasts instead of raw `Error:` dumps; soft preflight `planOpenInEditor`; Settings → Open files with empty / preferred-missing honesty when no editors are detected. Pure `openEditorHonesty` helpers + tests; en/zh/zh-TW. No `window.confirm`.
- **Compact apply-path + preset honesty**: dialog footer explains when `/compact` runs (`next_turn` / idle / unsupported flags), that light/standard/aggressive only seed keep-note templates (no CLI intensity flag), and token savings only when both before/after are known — never invents savings from estimates. Settings → Agent compaction section notes soft-respawn vs next spawn for mode/detail. Pure `compactApplyHonesty` helpers + tests; en/zh/zh-TW.
- **Linux day-use checklist** (Doctor): honesty card for day-to-day Linux use — CLI found, project path spaces, sandbox→Landlock (off = N/A; not off → warn that enforcement is Landlock), tray/autostart (manual without probe), Wayland/X11 (unknown without probe), app update check. Pure `linuxDayuseChecklist` helpers; never invents Landlock / tray / display-server status. Non-Linux shows N/A with “not the target of this list”. Copy summary; deep links to About / Runtime / Sandbox. Settings → Runtime platform tip. en/zh/zh-TW + tests.
- **Trace history pro**: session trace export list gains All / Local / Uploaded filter chips with counts, search, honest empty states (no exports · filter empty + clear filters), size display when known, uploaded badge only when the export flag is true (no remote URLs), and clear-all via **GlassModal** with count honesty (no `window.confirm`). Paths-only — never loads archive contents. Pure `traceHistoryPro` helpers + tests; en/zh/zh-TW.
- **Custom provider apply-path honesty** (Settings → Account → Providers): after save, toasts/banners distinguish **soft-respawn** (active route reloaded — next message uses new config, no app restart), **disk-only** (inactive provider saved until Use/composer activate), and **host-only** (browser/non-Tauri). Classified save soft-fails (timeout · validation · network · host-only · other) and fetch-models/ping soft-fails (timeout · network · auth · invalid URL · host-only · other). Empty-state honesty for no custom relays / host-only / load error. Pure `providerRouteHonesty` helpers + tests; en/zh/zh-TW; `settingsCatalog` keywords. No `window.confirm`.
- **Hooks activity redacted export** (Settings → Extensions → Hooks → Recent activity): **Export redacted…** downloads filtered rows as JSON and **Copy summary** copies a plain-text dump; every free-form field is re-redacted (no secrets). Soft-fail honesty for empty filter · clipboard blocked · download failure · other. Pure `hooksActivityExport` helpers (`planHooksActivityExport` / `formatHooksActivityExportText` / `classifyHooksExportError`) + tests; en/zh/zh-TW. No `window.confirm`.
- **CLI sessions search pro** (Settings → Agent / CLI sessions): linked · unlinked filter chips with counts; ranked free-text hits (title → id → first prompt → cwd); honest empty states (loading · searching · CLI missing soft-fail · empty catalog · filter/search empty + **Clear filters**); classified search/list error chips (`cli_missing` · `cli_unsupported` · `timeout` · `host_only` · `permission` · `other`); import/delete bulk buttons use honesty counts (skip already linked; delete only on-disk unlinked). Never invents sessions when CLI is missing. Pure `cliSessionsSearchPro` helpers + tests; en/zh/zh-TW; `settingsCatalog`. Delete still uses GlassModal (no `window.confirm`).
- **Partial stream apply-path honesty** (Settings → Runtime → Pool): when **Include partial stream events** is on, a contextual note shows soft-omit on older/unknown CLI vs active headless Remote IM deltas on CLI **0.2.117+** (in-app ACP chat unchanged). Pure `partialStreamHonesty` helpers + tests; en/zh/zh-TW; `settingsCatalog`.
- **Mirror client cap honesty** (MIRROR-CLIENT-CAP-PRO): Connect panel live cap bar/chip (`n / max`), soft-fail full banner when at limit (extra phones get HTTP 503), near-full warn, zero-client + host-stopped empty honesty (never invents clients while stopped), write-on reminder alongside the default read-only policy. Pure `mirrorClientCapPro` helpers + tests; en/zh/zh-TW.
- **Account heatmap empty honesty** (HEATMAP-USAGE-PRO): soft-fail when local session signals are missing (never invent activity cells or SuperGrok quota); day/week range chips + active-days / tokens / sessions summary chips; classified Host errors (`host_only` · `network` · `empty` · `other`). Pure `heatmapUsagePro` / `heatmapRange` helpers + tests; en/zh/zh-TW.
- **Wallpaper gallery pro** (Settings → Appearance → wallpaper source modal): honest empty states (idle · loading · no results · filter empty · classified error), kind filter chips (All · Images · Videos) with counts, client-side gallery filter, and soft-fail error chips (network · host · untrusted · empty · other). Never invents CDN gallery tiles — only real Host/search items. Pure `wallpaperGalleryPro` helpers + tests; en/zh/zh-TW.
- **Stall timeline open session + empty honesty**: Reliability Stall timeline rows offer **Open session** when the chat is still in the sidebar list (`planOpenStallSession`); empty vs filter-empty copy with clear-filters CTA; human quiet duration via `formatStallDuration`. Pure `stallTimelinePro` helpers + tests; en/zh/zh-TW; no `window.confirm`.
#### Runtime / process pool
- **Process budget empty honesty + limit callout** (PROCESS-BUDGET-RECLAIM-PRO): pure `processBudgetPro` helpers — `resolveProcessBudgetEmptyState` (loading · unavailable · error · empty pool), `classifyProcessBudgetError` (host-only · unavailable · timeout · permission · other), `formatOccupancySummary`, `shouldShowProcessLimitCallout` / limit empty state (no recent PROCESS_LIMIT in 24h). Settings + Reliability panel never invents busy occupancy; shows honest empty-pool vs host soft-fail; last limit callout always has empty or active copy. en/zh/zh-TW + tests. Does not change spawn policy.
- **Account SuperGrok quota honesty**: never invent remaining % when Host is silent — pure `accountQuotaHonesty` helpers (`resolveQuotaEmptyState` · `classifyQuotaError` network|auth|host_only|other · `formatQuotaUnknown` chips); Account panel unknown/empty chips + soft-fail when billing probe fails; en/zh/zh-TW + tests.
- **Network proxy apply + probe honesty** (Settings → Runtime → Network): empty surfaces for host-only / idle / empty targets / probe invoke error; structured apply-path honesty lines (saved · new agents · reconnect · probe uses effective proxy · manual invalid inherits env); **Retry probe** CTA after re-runnable failures (partial · all fail · empty · error) without `window.confirm`. Pure `networkProxyPro` helpers (`resolveNetworkProxyEmptyState` · `resolveProxyApplyHonesty` · `formatProbeSummary`) + tests; en/zh/zh-TW; `settingsCatalog`. Reuses existing `networkProxy` classify — never invents reachable targets.

## [0.2.3] - 2026-07-31

> **Highlight:** Composer model picker with custom multi-model providers (DeepSeek / Amux / Yun presets); large pro-honesty batch across settings, Remote IM, MCP, and sessions.
>
> **中文 · 亮点：** 输入框按提供商分组的模型选择 + 自定义多模型目录（DeepSeek / Amux / 云 API 预设）；设置 / 远程 IM / MCP / 会话等大范围 pro 诚实体验合入。

### Changed

- **Agent-home config write layer**: shared Host helpers in `agent_home_config` for independent-only `config.toml` path resolve (shared mode refuses), pure top-level / table bool+string upserts, and soft-skip sync. Migrated TodoGate, workflows, auto-wake, two-pass compaction, and subagent worktree snapshot writers off duplicated TOML edit/write paths. Product defaults and independent-only write behavior unchanged.
### Added

#### Composer / custom providers
- **Provider-grouped model picker**: composer chip + menus list models by official / custom provider; selecting a custom model activates that route (`providers_activate`) so the next send uses independent `GROK_HOME` + `config.toml`
- **Multi-model catalog per provider**: Settings → Account → Providers form supports multiple models with display names (`app_models` JSON in agent-home `config.toml`); fetch-models chips; create-only / overwrite for preset re-add; composer menu refreshes after CRUD
- **Configurable reasoning efforts**: per-provider effort ladder (DeepSeek 低/中/高/极高 UI mapped to spawn catalog); presets DeepSeek / Amux / Yun API with API-key signup links and brand logos

#### Sessions & diagnostics
- **Session / diagnostics NDJSON export** (`streaming-json` · `streaming-messages-json`): pure `streamSessionExport` helpers synthesize redacted ACP session/update or Anthropic Messages wire NDJSON from the App journal, or re-export diagnostics paste/probe with secrets scrubbed; soft-empty when no rows. Session Export menu adds both formats; Streaming ACP NDJSON panel gains **Save / Copy NDJSON**; SMJ export uses the same redacted path. Never writes unredacted tokens to disk. en/zh/zh-TW + tests
### Added

- **Cost usage hub pro** (Settings → Runtime → Tools → Cost rollup): project/session filter chips + day window, contextual empty states (no samples / empty window / no matches), clear-sample plan with GlassModal confirm (count honesty, no `window.confirm`), classified export soft-fail toasts (empty · clipboard · download · other). Pure `costRollup` helpers + tests; en/zh/zh-TW; `settingsCatalog`.

### Fixed

- **Custom providers dual-pane scroll**: Account → Providers no longer whole-page scrolls — left rail and right detail scroll independently (`settings-page__content--pane-fill`)

- **Long chat virtualizer (PERF-A11Y-PACK / perf)**: history browse no longer expands the continuous window to the tail just because idle force-mount lists the last user/assistant (that mounted hundreds of rows mid-scroll). Force expand is nearby-only while escaped; pin still expands for blank-pin defense. Adaptive viewport-scaled overscan, binary-search range find, rAF-coalesced scroll recompute, and cached cumulative offsets keep long transcripts snappy. Pure helpers + tests in `chatVirtualList`.
- **Custom provider save stuck on “Saving…” / requires restart** (#376): `providers_upsert` / activate / remove / set-default run file I/O on a blocking pool and recycle warm agents (`provider_route`) so the next message reloads `config.toml` + auth without a full app restart. Settings save uses a wall-clock timeout, always clears busy in `finally`, shows success / soft-fail apply toasts (en/zh/zh-TW), and no longer parks live agents via `sessionDisconnect` (which kept stale OIDC in memory). Pure `providerSave` helpers + tests.
- **MCP config.toml parser**: an unclosed multi-line `args = [` no longer silently swallows the next `[mcp_servers.*]` table (whole server used to disappear); array end detection is now string-literal-aware, so `]` inside a quoted arg (e.g. `"some]thing"`) no longer truncates the array
- **Wallpaper gallery**: `is_gallery_media_url` now accepts all download-allowlisted hosts (`abs.twimg.com`, `filesystem.site`) — legit Imagine/CDN images were silently filtered out before display
- **Wallpaper URL normalize**: legacy twimg `:thumb/:small/:medium/:large` suffixes are normalized to `:orig` again (the replacement branch was unreachable dead code after `Url::parse` succeeded)

### Changed

- **Remote IM: retire WPS channels** — `wps-xiezuo` (WPS Collaboration) and `wps-agentspace` (WPS Agentspace) are soft-retired: hidden from the default channel sidebar / new-bind picker (`REQUIRED_CHANNEL_IDS` + `filterActiveChannels`), schema `retired`/`unsupported` flags, soft-retired banner for existing saved instances (delete credentials only; no setup guide pack), pure `isRetiredChannel` / `filterActiveChannels` helpers + tests; en/zh/zh-TW. Host catalog keeps ids for legacy dispatch only.

### Added

#### MCP
- **OAuth recovery wizard**: multi-step GlassModal from MCP status modal and Extensions MCP rows — detect OAuth need → show server + reason → open sanitized auth URL (or honest TUI `/mcps` → `i` fallback when no headless `grok mcp oauth`) → “I’ve authorized” re-runs doctor → success / classified soft-fail (`no_url` · `no_cli_helper` · `open_url_failed` · `doctor_failed` · `still_needs_auth`). Pure step-machine helpers + vitest; secrets never logged; no `window.confirm`; en/zh/zh-TW
#### Agent / search
- **Project codebase search** (Settings → Agent): keyword search of the active trusted project by path/name and/or file content via host (`rg` when available, else capped walk). Results open in editor / reveal / Resources; honest empty/loading/error and soft-fail when path missing, not a dir, or untrusted — **never invents embeddings or CLI code-graph hits**. Pure `codebaseSearch` helpers + tests; host `project_codebase_search`; `settingsCatalog` + en/zh/zh-TW
#### Runtime / process pool
- **Process budget pro**: observable agent process occupancy — Host `process_budget_snapshot` (live / background / parked / total warm vs `maxConcurrentAgents`, idle recycle minutes, session ids only). Settings → Runtime → Process pool live bar + counts + reclaim plan copy; Reliability center card; last `session://process_limit` honesty callout. Pure `processBudget` helpers + tests; soft-fail when manager unavailable; en/zh/zh-TW + `settingsCatalog`. Does not change spawn policy.
#### Composer & chat
- **Diff accept batch** (Changes panel): **Accept all remaining** / **Reject all remaining** for session files (skips merge conflicts and already-decided paths; untracked wipe still needs in-app GlassModal confirm — never `window.confirm`); file-scoped **accept/reject all remaining hunks** when a multi-hunk diff is open; sequential host writes with busy/progress honesty and soft-fail partial summary toast; pure `planBatchAccept` / `planBatchReject` / `planBatchRemainingHunks` helpers + tests; en/zh/zh-TW
#### Composer & chat / reliability
- **Error deck pro**: classified recoveries for workspace untrusted, missing project path/selection, tool permission denied, MCP auth required, and OAuth expired (mapped from real App/host free-form strings — no dead codes). Banner primary/secondary actions: trust project, relocate/add project, open permissions, open MCP modal / Extensions. Pure `errorDeck` helpers + tests; `presentErrorBanner` uses classification for local UX errors; en/zh/zh-TW
#### Automations / schedules
- **Schedule run history**: Scheduled tasks page shows a local ring buffer (max ~50) of **observed** fires — host `automation://ran` / `automation://error` while the process is alive, plus client **Run now** outcomes (`ok` / `error` / `skipped`). Redacted error text; outcome filter chips; clear via **GlassModal** (no `window.confirm`). Honest copy: process-bound only — never invents offline runs after Quit; empty history is a soft-fail empty state. Pure `automationRunHistory` helpers + tests; i18n en/zh/zh-TW.

#### Sessions & sidebar
- **Session unread + mute pro**: bulk **Clear all unread** (sidebar action + session menu; in-app confirm when many; never `window.confirm`); pure helpers `clearAllUnread` / `listUnreadSessionIds` / `toggleUnread` / `shouldConfirmClearAllUnread` and mute-side `listMutedSessionIds` / `clearAllMutes` / `shouldConfirmClearAllMutes`; per-session **Mark as read**; muted-row indicator polish; Settings → Appearance → Interface shows muted + unread counts with clear actions; honest copy that **mute only suppresses desktop notifications** (unread dots still apply). Tests + en/zh/zh-TW + `settingsCatalog`
#### Runtime / network
- **Network proxy pro** (Settings → Runtime → Network): pure `networkProxy` helpers for mode normalize (`system` / `manual` / `none`), URL validation (`http` / `https` / `socks5` / `socks5h`), classified `network_probe` outcomes (all ok · partial · all fail · empty · error) and per-target soft-fail kinds (timeout · DNS · connect · proxy · TLS · other); Settings chips + invalid-URL inline soft-fail; clearer apply honesty (saved immediately · new agents · reconnect running sessions · probe uses effective proxy · invalid manual inherits env, not forced Direct). Host probe path only — no invented tunnel. i18n en/zh/zh-TW · `settingsCatalog` · tests.
#### Extensions / plugins
- **Plugin marketplace pro** (PLUGIN-MARKET-PRO): classified install/list/validate errors (CLI missing · too old · network · offline · timeout · not found · already installed · …) with kind chips + actionable hints; **row-stuck install errors** keep **Retry** (or Open Runtime / update CLI when soft-fail); honest catalog empty states (loading · CLI gap · offline · no sources · empty catalog · empty filter/query) with Clear filters / Retry / Refresh CTAs; soft-fail when CLI is missing/too old (warn, no hard crash). Pure `pluginMarketPro` helpers + tests; en/zh/zh-TW; CLI remains source of truth (no second App store).
#### Settings / keyboard
- **Keyboard shortcuts pro** (Settings → Keyboard): catalog search/filter by label · id · chord with empty-filter honesty; pure helpers for scope grouping, conflict summary counts, and reset-all remap planning; conflict panel shows chord/action badges + per-group meta; **Reset all** uses in-app GlassModal confirm (no `window.confirm`) with custom-binding count; en/zh/zh-TW + `settingsCatalog` keywords; tests
#### Appearance
- **Theme schedule pro** (Settings → Appearance → Theme): clock-based light/dark schedule gains pure helpers for HH:mm parse/validate, equal/invalid range soft-fail, and next-switch time; Settings shows a **next switch** preview line under the time inputs and soft-fail honesty when times are equal/invalid or Theme is locked; clearer schedule description; pure `themeSchedule` helpers + tests; `settingsCatalog`; en/zh/zh-TW

#### Composer & chat / media
- **Media load pro (MEDIA-LOAD-PRO)**: classified local media / preview failures (missing path · untrusted · host-only · broken blob · timeout · unsupported type · media server unavailable) with honest en/zh/zh-TW copy instead of raw host dumps or silent broken images; chat `ImageUi`, Resource preview, office fetch, and video/audio player soft-fail without crashing; pure `mediaLoadPro` helpers + tests; loopback media URLs stay local-only
#### Composer & chat
- **Agent Tasks panel pro**: running / done / all status chips with counts, honest empty states (no tasks · filter empty + clear), snapshot-mode banner key when `subagentWorktreeSnapshotEnabled`, soft-fail stop / bind-cwd classification (no raw `Error:` dumps, no `window.confirm`); pure `tasksPanelPro` helpers + tests; en/zh/zh-TW
#### Composer & chat
- **Ship → PR hub link**: after a successful Worktree **Ship…** `gh pr create`, the success panel shows the PR URL with **Open in browser** and **Open in PR hub** (Settings → Runtime → Tools, scroll to hub, optional `?pr=N` row highlight). Soft-fails if no project / hub unavailable (never `window.confirm`). Pure `prHubDeepLink` helpers + tests; en/zh/zh-TW
#### Remote control / IM
- **QQ OneBot channel pack** (Settings → Remote control → IM → QQ): NapCat / community forward-WebSocket setup guide + community-risk callout; field help for `ws_url` / optional access token / allow-from; **deep health** (forward WS · self-hosted · never claims live WS without Bridge link); pure `qqConfig` validation (ws/wss scheme, `url` alias, token optional); host test soft-fails missing/invalid URL and never opens a WebSocket; URL-only save allowed when token empty; i18n en/zh/zh-TW; no `window.confirm`
#### Remote control / IM
- **QQ official bot channel pack** (Settings → Remote control → IM → QQ official bot / `qqbot`): official Gateway setup guide + default INTERACTION intents callout; field help for `app_id` / `app_secret` / optional intents / allow-from; **deep health** (gateway · not OneBot · never claims live Gateway without Bridge link); pure `qqbotConfig` validation (App ID shape, secret required, intents default note); host test soft-fails missing/invalid credentials and may mint access token when online without opening Gateway; distinct from community OneBot `qq`; i18n en/zh/zh-TW; no `window.confirm`

#### Extensions / MCP
- **MCP status modal pro**: first-class status chips (`ok` / `error` / `oauth` / `disabled` / `unknown`), honest empty states (loading · empty catalog · soft-fail load · filter empty), redacted **Copy summary**, and soft-fail doctor when CLI is missing/too old/timeout (no hard crash; Authorize/Retry kept). Pure `mcpStatusPro` helpers + tests; en/zh/zh-TW.
#### Runtime / privacy
- **Privacy center pro** (Settings → Runtime → Privacy): classified `privacy_config` probe soft-fail (host-only · shared write refused · path not allowed · I/O · empty patch · other) with en/zh/zh-TW copy instead of raw dumps; clearer unset defaults (summary chips, per-key CLI-default hints, “unset ≠ off” banner — **never invents telemetry off**); apply honesty (soft-respawn · independent-only); pure `privacyConfig` helpers + tests; `settingsCatalog` entries for mixpanel / workspace teleport
#### Sessions & project rules
- **Session archive-by-age pro**: bulk archive older than 7 / 30 / 90 days with **live preview counts** on sidebar menu + Settings → Archived chips, **GlassModal confirm** (sample titles + “…and N more”, no `window.confirm`), and **empty honesty** (no chats · all archived · all pinned · all recent). Pure `sessionArchiveAge` plan/preview helpers + tests; en/zh/zh-TW.
#### Automations / schedules
- **Headless one-shot schedule fire** (AUTO-HEADLESS A2): CLI flag `--fire-due-schedules` (or `GROK_FIRE_DUE_SCHEDULES=1`) boots tray-hidden, fires **at most one** due scheduled task via existing host `automation_runner` / `fire_due_once` path, soft-fails when nothing is due / CLI missing / project untrusted, waits for turn idle (soft timeout), then **exits** — **not** a KeepAlive daemon. Helper script `fire-due-schedules.sh` generated under app-data schedules helpers (alongside LaunchAgent files; not KeepAlive-installed). Secondary-instance argv relays fire to the primary without focus steal. Scheduled tasks honesty matrix + panel: tray residency vs full Quit vs LaunchAgent vs **one-shot**; pure `automationsHeadlessHonesty` helpers + tests; en/zh/zh-TW; no `window.confirm`; no YOLO auto-approve invent.

#### Runtime / workflows
- **Sandbox profile pro** (Settings → General → Permissions): polish OS sandbox presets (`off` / `workspace` / `read-only` / `strict` / `devbox`) with pure `sandboxProfile` helpers (spawn args/env, project resolve, danger confirm keys), **honest soft-fail** when CLI is missing/too old for `--sandbox` (flag omitted) or when the platform has no kernel enforcement (Windows honesty; Linux-only child-network note on macOS), Settings banners + recommended-workspace tip; Host soft-gates spawn flags on known-old CLI; i18n en/zh/zh-TW; `settingsCatalog`; tests
- **Grok Build workflows — list + run** (Settings → Runtime → Tools): opt-in `workflowsEnabled` writes top-level `workflows_enabled` into independent agent-home `config.toml` (shared mode never rewrites `~/.grok`); soft-fail discovery of user + project `.rhai` names; **Smoke** / **Run** invoke headless `grok -p` that must call the agent `workflow` tool (no top-level `grok workflow` CLI subcommand — probed 0.2.117); result panel shows ok / soft-fail reason / redacted truncated log; no visual workflow editor; host `workflows_list` + `workflows_run`; pure helpers + tests; `settingsCatalog` + en/zh/zh-TW
#### Composer & chat / reliability
- **Slash menu pro**: composer `/` and `+` palette gains kind chips (All · Mode · Action · Prompt · Skill), pure filter helpers (`query` + `kind`), and honest empty states (loading · empty catalog · no matches · kind-filtered · no-query) with **Clear filters** CTA; never invents catalog rows; en/zh/zh-TW; pure `slashCatalog` helpers + tests
- **Attachments pro (ATTACHMENTS-PRO)**: classified paste/drop/pick errors (empty · too large · clipboard · host-only · write) with en/zh/zh-TW copy instead of raw `Error:` dumps; cancelled pick stays silent; image chips/cards keep honest pending/broken/missing preview phases (never re-claim ready after load failure); pure `attachmentsPro` helpers + tests
- **Goal orchestration panel** (CLI **0.2.117+** goal harness): Host soft-decodes ACP `sessionUpdate: goal_updated` (classifier / planner / strategist / verifier roles + deliverable progress) → `session://goal`. Reliability center shows a compact **Goal orchestration** timeline when events arrive; honest empty state when the CLI does not emit them (never invents goal progress). Display-only Settings toggle **Goal orchestration panel** (`goalOrchUiEnabled`, default on). Pure `goalOrch` helpers + fixtures/tests; ACP NDJSON diagnostics recognize `goal_updated`.
- **Goal orchestration pro**: Reliability Goal section gains phase chips (observed phases only), **Copy summary** (redacted plain text), and clearer empty honesty (`ui off` / no events / filtered). Soft session chip when a real `goal_updated` exists for the current session (opens Reliability; no fake progress). Pure helpers `filterGoalOrchByPhaseAndRole` / `formatGoalOrchSummaryText` / `resolveGoalOrchEmptyState` / `resolveGoalOrchSessionIndicator` + tests; en/zh/zh-TW.
#### Runtime / diagnostics
- **Doctor findings export pro**: Doctor modal **Copy all (redacted)** + **Export redacted…** for the filtered findings set — redacted text/JSON with filter echo and summary counts (ok/warn/fail · app/cli); empty filter soft-fails honestly (no download of empty invent); never includes secrets (`redact` on title/detail). Pure `doctorFindings` export helpers + tests; en/zh/zh-TW.
- **Tool audit ledger** (Reliability center + Settings → Runtime → Tools): append-only JSONL under `{app_data}/audit/tool_ledger.jsonl` records permission decisions (user + auto allow/deny) and tool start/end with redacted summaries, session id, project path, and outcome. Soft size rotate; soft-fail I/O; never logs secrets. View / filter / clear (in-app confirm) / export redacted JSONL. Pure `auditLedger` helpers + host/unit tests; `settingsCatalog` keywords; en/zh/zh-TW.
- **Audit ledger pro** (retention + filtered export): Settings retention presets **7 / 30 / 90 / unlimited** (`auditLedgerRetentionDays`, default unlimited) prune on write, size rotate, settings change, or `audit_ledger_prune`. Reliability export filters by event kind, session id, and date range; copy / download / native-save redacted JSONL of the filtered set. Pure helpers + vitest; Rust unit tests for prune/filter; en/zh/zh-TW + `settingsCatalog`.
#### Accessibility
- **Desktop a11y pack**: shared `installDialogFocus` focus trap (Tab cycle · Escape · restore) on confirm/prompt dialogs, command palette, Compact / Rewind modals, Doctor, Reliability center, phone sheets, and GlassModal; aria-labels for sidebar / settings nav / composer / resources pane and icon-only chrome; settings nav ArrowUp/Down/Home/End; sidebar session list ArrowUp/Down aliases for j/k; pure helpers + unit tests
#### Composer & chat
- **Session export pro (SESSION-EXPORT-PRO)**: multi-format transcript export honesty (Markdown · plain text · JSON · HTML — no NDJSON here). Soft-empty journal detection disables live-session menu rows and Markdown dialog actions; classified soft-fail toasts (empty · no target · load · write · clipboard · cancel silent); estimated size class chip in the Markdown export dialog; filesystem-safe filename sanitize. Pure `sessionExportPro` helpers + tests; en/zh/zh-TW. No `window.confirm`; export files hold journal content only (no secrets sidecar).
- **Context usage pro (CONTEXT-USAGE-PRO)**: empty/no-data honesty for the composer context chip — brand-new sessions still hide the "—" placeholder; soft-fail muted "—" after compact without token counts (menu stays open for last-compact + re-compact); tools/system-only transcripts soft-fall back to breakdown total; labelled breakdown section (system/tools/history/user/assistant/thought) with "—" for empty buckets (never "~0"); pure `resolveContextUsageSurface` / `resolveContextUsageEmptyState` / `buildContextBreakdownRows` helpers + tests; phone tools sheet shows the same breakdown; en/zh/zh-TW; no `window.confirm`
- **Session fork pro (SESSION-FORK-PRO)**: Fork / Resume-with-code dialogs show the CLI `--fork-session` checkbox always, disabled with honest copy when no agent session is linked (never claims a new agent id without one); classified soft-fail for dirty / no-project / unavailable / worktree collision·create / bind / fork / CLI-arm (en/zh/zh-TW, no raw `Error:` primary toasts); success toasts match actual restore + agent-fork outcomes; pure `sessionFork` helpers + tests; no `window.confirm`
- **Share-card export pro (EXPORT-SHARE-PRO)**: export-image dialog shows honest meta chips (smart/full · skin · structural layout · PNG size from the rendered stamp); Save/Copy only enable when the preview blob matches the selected skin/mode/session (no stale PNG); classified preview/save/clipboard errors with en/zh/zh-TW copy instead of raw `Error:` dumps; pure `exportSharePro` helpers + tests
#### Sessions & project rules
- **Session notes pro** (SESSION-NOTES-PRO): sticky-note GlassModal gains char-budget validation (near/at cap, NUL strip), empty / will-clear honesty, discard-dirty confirm + clear-note confirm (no `window.confirm`); pure helpers for search by content/title, clear-one / clear-all plans, and log meta that never includes note bodies (notes stay local — never auto-attached to agent prompts); sidebar note indicator unchanged; en/zh/zh-TW; tests
- **Rules / system prompt pro** (RULES-PROMPT-PRO): project rules editor kind chips + summary counts, empty-draft soft warn, classified soft-fail for list/open/save/ensure; per-session system prompt override + extra rules GlassModals gain char-budget validation (near/at cap, NUL strip), in-modal soft-fail, discard-dirty confirm (no `window.confirm`), busy save state; extra rules now strip NULs like system prompt; pure `rulesPromptPro` helpers + tests; en/zh/zh-TW
#### Setup / first-run
- **Setup gate pro** (SETUP-GATE-PRO): pure `setupGatePro` helpers + tests for boot decision (CLI hard-required, account optional), classified install/probe/account errors with recovery hints, ready-step checklist honesty (never soft-ok CLI; never invent auth-connected on skip); SetupWizard + App boot wire-up; i18n en/zh/zh-TW

#### Agent / memory
- **Memory hybrid search path (honest)** (Settings → Agent → Memory browser): probe embedding config; App browser search remains path-scoped **keyword** (never invents embeddings). No host-invocable `grok memory search` CLI as of 0.2.117 — when `[memory.embedding].model` is set, host `searchKind` is `hybrid_unavailable` and UI shows mode chips + status line (App keyword · CLI agent hybrid · browser hybrid unavailable) with soft-link to Memory embedding settings. Pure `memoryHybridSearch` helpers + tests; en/zh/zh-TW
- **Auto-wake** (Settings → General → Agent; CLI config `auto_wake_enabled`): opt-in toggle so Grok Build may inject a synthetic turn after background work completes (bash / monitor / task / loop). Behavior is CLI-side when supported. Default off. Independent mode writes top-level agent-home `auto_wake_enabled` only (no invented env override — `GROK_AUTO_WAKE` is pattern-shaped). Soft-respawn on change; older CLIs that ignore the key soft-fail. Pure helpers + tests; `settingsCatalog` + en/zh/zh-TW.
- **Batch agents (multi-project dispatch)**: select multiple trusted projects, one shared prompt — **Open sessions** (create + connect + send per project, multi-session concurrency) or **Headless summary** (`grok -p` one-shot per project with soft timeout). Soft-fails untrusted / missing path / CLI / timeout per project; progressive results + copy summary. Entry: Agent dashboard footer, Settings → Runtime → Tools, command palette. Pure `batchAgents` helpers + tests; host `batch_agents_headless`; en/zh/zh-TW; no `window.confirm`.
- **Config workbench allowlist expand** (Settings → General → Agent → Agent config.toml sections): more safe bool keys under independent agent-home — `[workflows] enabled`, `[features] auto_wake` / `two_pass_compaction` / `lsp_tools` / `codebase_indexing` / `remote_fetch` (plus existing `[ui]` permission_mode / yolo, `[subagents]` / `[memory]` enabled). Shared mode remains read-only; never rewrites secrets or invents AppSettings for the new feature keys; soft-respawn on save; en/zh/zh-TW + pure helper tests
- **Codebase indexing UX** (Settings → Agent; `[features].codebase_indexing`): honest enable/status for Grok Build **code graph** indexing (not memory embeddings). Missing key stays unset with CLI default **on** shown as effective status only; independent agent-home writes bool + soft-respawn; shared mode read-only; non-bool (glob) forms stay read-only custom; soft-fail when CLI is known older than 0.2.117. Pure helpers + tests; `settingsCatalog` + en/zh/zh-TW
- **Memory browser pro** (Settings → Agent): kind chips apply after content-search merge (regression fix); contextual empty states (off / loading / empty catalog / searching / no matches / filtered) with mode-aware hints + **Clear filters**; honest keyword-only App search hints and soft-link to Memory embedding when model unset; name vs content match badges + match summary; pure `buildMemoryBrowserDisplayRows` / `resolveMemoryBrowserEmptyState` + tests; en/zh/zh-TW
- **Memory embedding (CLI 0.2.117)** (Settings → Agent): host reads allowlisted `[memory.*]` keys from active GROK_HOME `config.toml` (`embedding.model` / `dimensions`, `search.*`, `search.mmr`, `search.temporal_decay`, `dream.*`, `watcher`, `initial_injection`) with soft-fail when missing; independent agent-home can write safe keys + soft-respawn (shared mode read-only). Memory browser shows honest **App keyword** vs **CLI hybrid/keyword** status and links to the panel. App `memory_search` stays path-scoped keyword scan — never invents embeddings client-side.

#### Remote control / phone mirror
- **Mirror pro** (MIRROR-PRO): honest Connect-panel status pill + soft-fail when the public tunnel fails but the local host stays up (`soft_local` / tunnel-dead banners); classified error chips and actionable hints (cloudflared missing · timeout · spawn · dead · port bind · client cap · desktop-only · WS/RPC); never invents “live” from a loopback URL; diagnostics sanitize tokens/URLs; phone chrome link pill distinguishes connected / reconnecting / disconnected / invalid link. Pure `mirrorStatus` helpers + tests; en/zh/zh-TW + `settingsCatalog`

#### Runtime / connection
- **GitHub PR hub** (Settings → Runtime → Tools): list open PRs for the active project via `gh pr list --json` (number · title · author · mergeable · checks rollup); expand for CI checks table (`gh pr checks`) and recent conversation comments/reviews (`gh pr view --json comments,reviews`); open PR / comment / check URLs in browser; soft-fail when `gh`/`git` missing or path is not a repo. Pure `gitPrHub` parsers + host commands (`git_pr_list` / `git_pr_view` / `git_pr_checks` / `git_pr_comments`) + en/zh/zh-TW + `settingsCatalog`
- **GitHub PR hub** (Settings → Runtime → Tools): list open PRs for the active project via `gh pr list --json` (number · title · author · mergeable · checks rollup); expand for `gh pr checks`; open in browser; soft-fail when `gh`/`git` missing or path is not a repo. Pure `gitPrHub` parsers + host commands + en/zh/zh-TW + `settingsCatalog`
- **Managed setup signature honesty** (Settings → Runtime → Managed setup): signature status chips map probe outcomes to `absent` / `present_unverified` / `verify_ok` / `verify_failed` / `soft_fail` — **never** claims `verify_ok` from path presence or `managedSettingsActive` alone; host surfaces explicit CLI/inspect/doctor `signatureVerified` when present else `presenceOnly`; recovery hints + GlassModal detail; pure helpers + Rust unit tests; en/zh/zh-TW + `settingsCatalog`
- **Managed setup pro** (Settings → Runtime → Managed setup): guided CLI → auth → preview → install → verify steps; host `managed_setup_status` soft-probes local `managed_config.toml` / signature sidecars / `requirements.toml` + inspect `managedSettings*` flags (never loads signature contents; App does not re-verify crypto); clearer signature-rejected errors; en/zh/zh-TW + `settingsCatalog`
- **Leader fleet pro** (Settings → Runtime → Connection): honest connect status pill (never invents running from socket alone); soft-fail error kinds + hints (CLI missing / unsupported / timeout / parse / stale socket / list|info fail); useLeader honesty banners; classification chips on fleet rows; i18n detail-field labels; pure `leaderFleet` helpers + tests; en/zh/zh-TW + `settingsCatalog`
- **Doctor findings triage** (DOCTOR-PRO): App + CLI doctor rows unify into classifiable findings with level / source / category / search filters, issues-only, per-row + visible copy, and **GlassModal** detail (fix id / disposition); pure `doctorFindings` helpers + tests; en/zh/zh-TW
- **CLI update channels** (CLI ≥ **0.2.117**): Settings → Runtime → CLI and About show current version + channel (`stable` / `alpha` / unknown from `grok update --check --json` only — never invented). Switch via `grok update --alpha|--stable`, optional version pin (`--version <V>`) with in-app confirm; soft-fail on older CLIs / unknown channels. Host `cli_update_install` accepts optional channel/version/force; pure helpers + tests.
- **Privacy center** (Settings → Runtime → Privacy): honest Grok Build **0.2.117** privacy-related `config.toml` keys from the active `GROK_HOME` — `[features] telemetry`, `[telemetry] trace_upload` / `mixpanel_enabled`, `[harness] disable_codebase_upload` / `disable_workspace_teleport`. Missing keys stay unset (never invent “off”). Independent agent-home: allowlisted write + soft-respawn; shared mode: read-only probe of `~/.grok`. Coding-data / retention / training is **not** a config key — UI links to CLI `/privacy` only (no fake App toggle). Pure helpers + tests; `settingsCatalog` + en/zh/zh-TW
- **Streaming messages JSON** (Settings → Runtime → Tools): parse/preview headless `grok --output-format streaming-messages-json` NDJSON (Anthropic Messages wire format; **CLI 0.2.117+**) — pure `streamingMessagesJson` helpers + tests; offline NDJSON import; optional short headless probe (soft-fail older CLI); reconstruct assistant/user frames, `tool_use` / `tool_result`, usage, `stop_reason`; redacted export/copy (no secrets in logs)
- **SDK Connect wizard** (Settings → Runtime → Connection): start local `agent serve`, show masked secret + ws URL, TCP health probe, copy curl / websocat / `grok --remote` examples for external clients, and optional paste remote serve URL + probe. Secrets never logged; full token only via one-time clipboard after start.
- **Todo gate** (Settings → General → Agent; CLI **0.2.117+**): toggle enable TodoGate + max fires per prompt (1–20, default 3). When on, spawn passes top-level `--todo-gate` (overrides remote `todo_gate_enabled`; built-in default off). Independent mode also writes agent-home `todo_gate_enabled` / `todo_gate_max_fires_per_prompt`. Soft-respawn on change.
- **Todo gate pro** (Settings → General → Agent): max-fires UI honesty (effective clamp 1–20, apply-path notes for independent config write vs shared App-only — no CLI max-fires flag; never rewrites `~/.grok`), soft-respawn note, optional gate-activity status line when a host fire signal exists else honest **N/A** (never invents counts), older-CLI soft-fail banner. Pure `todoGate` helpers + tests; en/zh/zh-TW; `settingsCatalog`.
- **Subagent worktree snapshot** (Settings → General → Agent; CLI **0.2.117+** config `subagent_worktree_snapshot_enabled`): opt-in toggle so nested subagents can snapshot / rehydrate isolated worktrees. Independent mode writes the top-level agent-home key; spawn sets `GROK_SUBAGENT_WORKTREE_SNAPSHOT` (soft-fail when CLI is known older). Soft-respawn on change. Tasks panel shows a short note when enabled.
- **Streaming ACP NDJSON diagnostics** (Settings → Runtime → Tools; CLI **0.2.117+**): pure parser for headless `--output-format streaming-json` as agent-native ACP session-update NDJSON (not `streaming-messages-json`); import/paste or soft-gated headless probe; event type counts + copy summary

#### Composer & chat
- **Send queue pro**: clear-all uses in-app **GlassModal** confirm with honest count (never `window.confirm`); pure `planClearSendQueue` / strip + empty-state helpers; reorder (up/down + index) kept; cleared toast honesty; en/zh/zh-TW + tests
- **Worktree Ship / Open PR**: from the branch menu, WT/CLI session menu, or Changes → Workspace — GlassModal for PR title/body/draft; host `git_push_branch` (`git push -u origin HEAD`, soft-fail) then optional `gh_pr_create` (fork-aware `--repo` / `--head owner:branch`); never `window.confirm`; never fake success when `gh` fails; pure `wtShipFlow` helpers + tests
- **Live Voice → Build tool + permission path** (VOX-BUILD-FULL): host emits **tool_running → completed / soft_fail / error** (plus **permission_pending**) on `voice://tool` with `activeTool` / `toolStatus`; overlay shows tool chip + **in-overlay allow once / allow session / deny** for delegated-session `session://permission` (same `sessionResolvePermission` path — no `window.confirm`); deny / stop-cancel **soft-fail** (`permission_denied` / `cancelled`); **Stop** cancels in-flight host tools and, when Keep coding sessions is off, stops delegated agents; **keepAgentsOnEnd** wired to host; mic/CLI soft-fail retained; pure helpers + tests; en/zh/zh-TW
- **Live Voice → Build tool loop** (VOX-BUILD-LOOP): host emits tool **running → ok / soft_fail / error** on `voice://tool` with `activeTool` on state; overlay shows Build tool chip + system lines; **mic missing/denied soft-fails** (warn, keep session for playback/tools); **CLI missing soft-fails** tool results (`ok: false, reason: cli_missing`) so voice stays open; classified errors (`voice.err.*`) en/zh/zh-TW; pure helpers + tests
- **Plan mode pro** (PLAN-MODE-PRO): Resources → Plan contextual empty states (plan mode waiting · settings disabled · user-closed cycle · idle + history CTA); sticky bar **Open in resources** also works in plan mode before a draft arrives; pin policy keeps empty Plan panel reachable after open-in-resources (no bounce to Files). Pure `planModePro` helpers + tests; en/zh/zh-TW
- **Composer prompt history pro** (`/history` + empty ↑): Home/End/Page list navigation; recent rows show relative time; clear cross-session recent via in-app GlassModal (no `window.confirm`) + remove-one; clear-filter empty affordance; pure helpers + tests
- **Live Voice delegate status** (VOX-DELEG): overlay shows listening / thinking / speaking from host `voice://` events, **Stop**, honest empty transcript (no fake STT), delegated session chips, and optional **Send transcript to active session** when a chat is open
- **Send queue** edit / reorder · **composer min height** · **cross-session recent prompts**
- **Chat width** · **chat / code font** · **tool auto-collapse** · **transcript filter** (hide tool steps)
- **Regenerate** with optional model pick · **assistant word count** (optional)
- **File-changes chip** (session edits) · **git dirty chip** (workspace porcelain)
- **Session change review**: per-file +/−, unified / side-by-side diff, open in Resources, j/k in Changes list; chip always opens Changes tab (works without git)
- **Structured JSON replies**: when a session JSON Schema is active, assistant turns show a Structured panel — progressive parse + light required-field validation while streaming (partial keys, validation path timeline), honest “not valid JSON” on finished failure, copy / export when complete, optional known token usage from agent events, and a Structured badge
- **Diff accept / reject / restore** (Changes panel): Accept keeps working tree (writes after snapshot when needed); Reject restores HEAD via path-scoped `git checkout` (or before snapshot / delete untracked with in-app confirm — never wipe untracked without confirm); Restore re-applies saved after content; per-hunk accept/reject when before+after exist; soft-fails outside git; pure `diffAccept` helpers + host `apply_file_patch` / `git_checkout_file` / `delete_project_file`
- **Structured JSON replies**: when a session JSON Schema is active, finished assistant turns show a Structured panel — parse + light required-field validation, honest “not valid JSON” on failure, copy / export, and a Structured badge
- **Context usage / cost estimates**: chip menu shows input/output/total when known; optional crude USD estimate from a static rates table (never invoice-grade); Settings → Appearance → **Show usage estimates** (on by default, with disclaimer)
- **Compact dialog presets** (light / standard / aggressive): note templates for `/compact` (CLI has no intensity flag yet); optional keep-note + chips; before → after estimate when tokens known; last compact range when available
- **Compaction mode / detail** (Grok Build CLI **0.2.117+**): Settings → Agent + Compact dialog selectors for `--compaction-mode` `summary|transcript|segments` and `--compaction-detail` `none|minimal|balanced|verbose` (segments only); Host always sets `GROK_COMPACTION_MODE` / `GROK_COMPACTION_DETAIL` env and passes CLI flags when the probed binary is ≥ 0.2.117 (soft-fail on older CLIs); soft-respawn on change
- **Two-pass prefire compaction** (Settings → General → Agent; CLI **0.2.117+** config `two_pass_compaction_enabled`): opt-in toggle for hierarchical two-pass prefire compact. Independent mode writes the top-level agent-home key; spawn sets `GROK_TWO_PASS_COMPACTION` (soft-fail when CLI is known older); shared mode keeps App setting only (does not rewrite `~/.grok`). Soft-respawn on change. Pure helpers + tests; `settingsCatalog` + en/zh/zh-TW

#### Sessions & sidebar
- **Continue last agent for this project** (CLI `grok -c/--continue`): project menu + command palette finds the newest agent session under active `GROK_HOME` for the project path, then opens the linked App chat or imports history; soft-fails with a toast when none exist
- **Continue last agent (cwd) pro**: classified soft-fail toasts (no session · no CLI · untrusted · host-only · import failed) with empty honesty when none exist; pure `continueCwd` preflight/classify helpers + tests; en/zh/zh-TW
- **Duplicate chat** (vs **Fork…** + optional worktree) · **session notes** · **mute** · **unread dot**
- **Open session in new window** — session menu opens a second Tauri webview with `#/session/<id>` deep link; re-open focuses the existing window; close secondary for real (main still tray/confirm)
- **Multi-window live slots**: session-keyed Host agent pool (live / background / parked) so two windows can stream concurrently — connect/prompt/stop are scoped by sessionId; busy demote keeps the other turn alive (never silent kill). Secondary may **warm-connect** (main still defers warm-connect while browsing a foreign mid-turn). Composer **Stop** = current chat only; Tasks/dashboard **Stop all** = every busy session. Host can prompt an already-background/parked agent without demoting a different mid-turn live chat. Pure `planConnectToSession` / `resolveStopTargets` / concurrent-preserve policy + tests; soft-fail process limit; honest secondary tip + **Focus main window**; en/zh/zh-TW
- **Resume with code restore** — open an existing chat on a clean sibling git worktree at HEAD (session menu + command palette; dirty tree refused; same safety as Fork → restore code)
- **CLI `--fork-session` on Fork / Resume**: optional checkbox (when a linked agent session exists) creates a **new** agent session id with parent context via ACP `session/fork` (Grok `_x.ai/session/fork` fallback) instead of reusing via `session/load`; one-shot `SessionMeta.forkAgentSession`; source agent session left unchanged
- **Session rules** (per-chat `grok --rules`; session menu → GlassModal; soft-respawn on change)
- **Session system prompt override** (per-chat `grok --system-prompt-override` / `--system-prompt`; session menu → GlassModal textarea; Clear; soft-respawn on change; never logs full prompt body)
- **Session max agent turns** (per-chat `grok --max-turns` override; session menu → number input; 0/empty inherits global Settings 1–200; soft-respawn on change)
- **Export** Markdown copy + **HTML export** · **bulk archive by age** · **date groups** · **project color**
- **Session export formats** (menu): Markdown (existing options) · **plain text** (`.txt`, headless-style) · JSON · HTML; full-transcript Markdown download prefers CLI `grok export <agentSessionId>` when linked and soft-falls back to the local journal
- **Export** Markdown copy + **HTML export** · **share-card PNG** (session menu → Export as image; optional thinking; footer **Generated with Grok App**; custom logo in Settings) · **bulk archive by age** · **date groups** · **project color**
- **Sidebar j/k** navigation (when list focused)
- **CLI-aligned worktrees**: create under `~/.grok/worktrees/<repo>/<name>` by default (matches `grok --worktree`); optional sibling layout; start-ref validation; sidebar **CLI** vs **WT** badge
- **Hybrid session search** (command palette): mode chips **All / Title / Content**, optional **Include archived**, keyword content snippets + Title/Content badges — no embeddings (honest keyword hybrid only)
- **Hybrid session search ranking** (optional): command palette Keyword / Hybrid chips + Settings → Appearance → Interface; Hybrid = keyword + local token-overlap ranking on titles/snippets (honest local hybrid — not cloud embeddings / no embedding API); pref in localStorage
- **Session search pro** (command palette): remembered scope chips + include-archived (localStorage); Keyword/Hybrid rank hints; contextual empty states (idle / loading / no matches / filtered) with mode-aware hints and **Clear filters**; pure `resolveSessionSearchEmptyState` / filter-pref helpers + tests; en/zh/zh-TW

#### Appearance / app shell
- **Theme schedule** (System + clock) · **follow system language**
- **Confirm quit while busy** (in-app dialog; optional skip) · **dock/tray busy badge**
- **Tray / notify pro** (TRAY-NOTIFY-PRO): pure `trayNotifyPro` helpers + tests — clamp dock busy badge (cap 99), secondary-window no-op, clear when pref off; Settings honesty for OS notification permission (request / denied / unsupported), quiet-hours “active now”, live busy-count status under the tray badge toggle; en/zh/zh-TW + `settingsCatalog`
- **Shortcut conflicts** (Settings → Keyboard): panel lists chords shared by multiple actions; capture warns in-app before save; optional **Reset conflicting to default** (pure `findChordConflicts` + tests)
- **Shortcut scopes** (Settings → Keyboard): each catalog row is tagged **Global** vs **Chat**; optional **Allow same chord across scopes** ignores cross-scope conflicts in capture/panel only (stored remaps + App matching unchanged)
- **Share-card logo** (Settings → Appearance → Interface): upload custom PNG/JPEG/WebP for conversation image export

#### Tasks / system
- **Remote IM resilience** (RIM-RESILIENCE): Bridge crash recovery with exponential reconnect backoff (cap 60s) without holding the runtime lock during waits; status DTO exposes `restartAttempt` / `nextRetrySecs` / `recoveryPhase` / `errorKind` / `rateLimited`; overview recovery card (honest rate-limit vs crash vs network); soft inbound turn rate limit (per-chat + global) with non-silent IM replies; agent quota/rate-limit errors mapped to clear copy. Pure `resilience` helpers + tests; i18n en/zh/zh-TW; GlassModal unchanged for other confirms.
- **Automations background honesty** (AUTO-DETACH lite): pure `automationsBackgroundStatus` helper + tests; Scheduled tasks page banner when any task is enabled (app/tray must stay running; optional deep-link to **Launch at login**); busy-quit dialog extra note; Launch at login desc clarifies schedules pause on full quit (no fake detached daemon)
- **Auto-runner / schedules tray residency** (AUTO-RUNNER): host `automation_runner` status API (tray-only ticks; process required; no fake daemon); setting **Keep tray for schedules** (default on — close still hides to tray when any task is enabled); optional **macOS LaunchAgent helper** (generates script+plist under app data; user LaunchAgent starts full app at login / crash-only KeepAlive); `--start-in-tray` / `GROK_START_IN_TRAY`; Scheduled tasks page background panel + Settings registration; pure policy tests + Rust unit tests
- **AUTO-HEADLESS-LITE honesty** (Scheduled tasks): clear tray vs full-quit vs LaunchAgent matrix (no fake detached daemon); host runner status surface with **last tick** + **paused reason** (`process_bound` / `close_exits` / `awaiting_tick` / …); LaunchAgent install/remove/reveal **soft-fails** via `GlassModal` (toggle stays on last good status); pure `automationsHeadlessHonesty` helpers + tests; i18n en/zh/zh-TW
- Tasks tree · Stop-all skip-confirm · Plan history · Mirror write guard · Reliability / Leader / Memory / MCP / CLI notice (prior)
- **Reliability stall timeline**: localStorage ring (~40) of historical stall signals (id · session · title · kind · stallSeconds · reason · at); recorded on soft / hard stream-stall; Reliability center **Stall timeline** card with search + kind chips + clear (in-app confirm); never stores secrets
- **Stall timeline pro**: deepen Reliability **Stall timeline** with pure filter (kind chips + search title/session/reason), **Export redacted JSON** download (known fields only; titles/reasons re-redacted; no secrets), and **clear-all plan** + GlassModal confirm (count in copy; no `window.confirm`); pure helpers + tests; i18n en/zh/zh-TW
- **Agent config.toml safe viewer** (Settings → General → Agent): redacted monospaced view of active-mode `config.toml` (independent agent-home or shared `~/.grok` with warning); section jump chips; copy path / reveal / open in external editor — no freeform writer
- **Remote IM depth** (Settings → Remote control → IM): secrets **masked by default** with show/hide (`RimSecretField`); Bridge **event timeline** local ring (~50, no secrets) on overview with collapsible list + in-app clear; clearer **channel health** for Feishu/Lark (WebSocket) and Telegram (long poll) — credentials / bridge link / open ACL / transport hints
- **WeCom channel pack** (Settings → Remote control → IM → 企业微信): mode-aware bind (WebSocket vs Webhook) with setup guide, field help, public-URL callout only in webhook mode; **deep health** card (transport / credentials / mode-switch soft-fail); pure `wecomConfig` validation + host test that only claims credential presence for the selected mode (never fakes live WS/public callback); i18n en/zh/zh-TW
- **DingTalk channel pack** (Settings → Remote control → IM → 钉钉): Stream-mode setup guide + field help; **deep health** card (transport / credentials / AI-card + open-ACL hints); pure `dingtalkConfig` validation + host test that only claims Client ID/Secret presence (never fakes live Stream gateway); i18n en/zh/zh-TW
- **Weixin channel pack** (Settings → Remote control → IM → 微信个人): ilink long-poll setup guide (scan primary + paste), field help, **deep health** (transport / token / proxy / chat_id / text menus); pure `weixinConfig` validation + host soft-fail that only claims token presence (never fakes live getUpdates); i18n en/zh/zh-TW
- **LINE channel pack** (Settings → Remote control → IM → LINE): Messaging API webhook setup guide (LINE Developers → webhook), field help (channel_secret / channel_access_token · port · callback_path), **strong public-URL callout** + recommended cloudflared copy snippet (helper only); **deep health** (webhook · tunnel honesty · never claims public callback live without proof); pure `lineConfig` validation + host soft-fail credential shape only; i18n en/zh/zh-TW; no `window.confirm`
- **Slack channel pack** (Settings → Remote control → IM → Slack): Socket Mode setup guide (Create App → Socket Mode → events → Install → dual tokens), field help (`xoxb-` / `xapp-` / allow-from), **deep health** (socket mode · no public URL · dual-token · ACL); pure `slackConfig` validation + host soft-fail that requires both tokens and never fakes live Socket Mode without Bridge; i18n en/zh/zh-TW; no `window.confirm`
- **Telegram channel pack** (Settings → Remote control → IM → Telegram): BotFather setup guide, field help (token / proxy / thread isolation), **deep health** (long poll · no webhook · proxy scheme · ACL); pure `telegramConfig` validation (token shape, proxy URL, soft proxy-auth warn); host test soft-fails invalid format/proxy before live `getMe` and never pretends getUpdates is live; i18n en/zh/zh-TW; no `window.confirm`
- **Discord channel pack** (Settings → Remote control → IM → Discord): Bot create → Message Content Intent callout → invite → paste token setup guide; field help (token / allow-from / thread isolation / progress style); **deep health** (Gateway · no public URL · Intent note · credentials / bridge link honesty — never claims Gateway live without Bridge link); pure `discordConfig` validation (token shape, allow_from, thread_isolation, progress_style); host test soft-fails missing/invalid token format before REST `@me` and only claims bot identity (not Gateway); i18n en/zh/zh-TW; no `window.confirm`
- **Matrix channel pack** (Settings → Remote control → IM → Matrix): homeserver + access token setup guide, field help (user id / auto-join / proxy / cross-signing); **deep health** (/sync long poll · no public URL · credentials / ACL honesty — never claims /sync live without Bridge link); pure `matrixConfig` validation (homeserver URL, token shape, optional MXID, proxy); host test soft-fails missing/invalid credential shape only (never fakes live /sync); i18n en/zh/zh-TW; no `window.confirm`
- **Feishu/Lark channel pack** (Settings → Remote control → IM → 飞书/Lark): WS setup guide + field help; **deep health** card (no-webhook · domain · card events · open ACL); pure `feishuConfig` validation + host test soft-fails invalid App ID / missing custom domain before live `tenant_access_token` (never claims WS is online without Bridge link); i18n en/zh/zh-TW
- **Weibo channel pack** (Settings → Remote control → IM → 微博): paste-first setup guide + field help (app_id / app_secret / allow_from · advanced token_endpoint / ws_endpoint); **deep health** (WebSocket · no public URL · credential / custom-endpoint honesty — never claims WS live without Bridge link); pure `weiboConfig` validation; host test soft-fails missing/invalid credential shape only; i18n en/zh/zh-TW; no `window.confirm`
- **Cost rollup** (Settings → Runtime → Tools): aggregate **known** token usage by project/day from live `session://usage` (+ compact `tokensAfter` when present); honest **Unknown** when missing; crude `$` via static rates (never invoice-grade); local sample ring + pure `costRollup` helpers/tests
- **Cost rollup** (Settings → Runtime → Tools): aggregate **known** token usage by project/day **or session/day** from live `session://usage` (+ compact `tokensAfter` when present); 7/14/30-day window; honest **Unknown** when missing; crude `~$` via static rates with estimate/partial badges (never invoice-grade); optional **Copy / Download** plain-text summary; clear samples via in-app confirm; local sample ring + pure `costRollup` helpers/tests
- **Leader fleet** (Settings → Runtime → Connection): list running leaders via `grok leader list --json`, per-row / global **Details** (`grok leader info --json`), stop-all with in-app confirm (`grok leader kill`); host soft-fails on older CLIs without the management surface
- **Reliability support zip**: export from Reliability center includes a redacted **stall timeline** snapshot (`stall-timeline.json` — structured stall kinds/seconds/session ids only; Host redacts secrets; never `secrets.json`)
- **Mirror write audit log** (Settings → Remote → Phone mirror): localStorage ring (~50) of write enable/disable, link regenerate, host start/stop — no tokens/URLs stored; collapsible list + in-app clear confirm
- **Mirror harden**: when write is on, show allowlisted write RPC categories + broad-surface warning; optional **max phone clients** (1–16, default 4, HTTP 503 when full); **regenerate link** in-app confirm (with connected count); host logs redact tokens/URLs (`token_tail` / `/t/<redacted>/…`)
- **Subagent worktree (cwd) badge**: when `spawn_subagent` / Agent / subagent tool_step data includes a cwd or worktree path (labeled fields, JSON, or absolute path), Tasks panel shows a compact **WT** / truncated-path badge and can reveal or copy the path — UI-only over existing tool_step data; nested tree unchanged
- **Subagent worktree bind (Tasks)**: from a task row with known cwd, **Use as chat folder** (badge click or detail action) binds the open chat to that path as agent cwd — reuses worktree switch / `project_add`, marks session WT meta; still reveal + copy; no “bind next subagent” session menu
- **Plan depth**: request-changes optional revision note (in-app modal → `session_resolve_plan` feedback); plan history search/filter by title·preview + decision chips, clear-all (in-app confirm), open chat when session still present
- **Disallowed built-in tools** (Settings → General → Agent): chips + freeform list → `AppSettings.disallowedTools` / CLI `--disallowed-tools a,b`; coexists with Disable web search; soft-respawn on change
- **Allowed built-in tools** (Settings → General → Agent): chips + freeform list → `AppSettings.allowedTools` / CLI `--tools a,b`; empty = all tools (CLI default); when set restricts to listed tools; coexists with denylist (both-set UI hint); soft-respawn on change
- **Agent profile path** (Settings → General → Agent): optional file for `grok agent --agent-profile`; soft-respawns on change
- **Agents JSON spawn** (Settings → General → Agent): optional inline subagent definitions as JSON object → top-level `grok --agents <JSON>`; empty omits flag; invalid JSON blocks save; soft-respawns on apply; does not write shared `~/.grok`
- **Agent config.toml safe section edit** (Settings → General → Agent): allowlisted keys only (`[ui]` permission_mode / yolo, `[subagents]` enabled, `[memory]` enabled) under independent agent-home; redact-on-read preview; shared mode clear warning + read-only; never freeform secret rewrite; soft-respawn on save
- **Agent serve** start/stop from Settings → Runtime → Connection (`grok agent serve --bind/--secret`; default `127.0.0.1:2419`; masked secret + one-time connection URL copy)
- **Agent dashboard filters**: status chips with per-status counts (all / busy / permission / connecting / idle / error), free-text session search, project id/name/path filter, empty-filter state + clear; **Stop all busy (app-wide)** still targets every stoppable session globally (not only the filtered list)
- **Agent dashboard multi-select stop**: row checkboxes + select-all visible; **Stop selected (n)** only targets stoppable rows among the selection (idle/error ignored); pure `filterStoppableAmongSelection` + tests; live tool title shown more prominently; status as permission/busy badges — no invented metrics
- **Agent serve `--remote`**: optional proxy-mode upstream URL in Settings → Runtime → Connection; client connection string template (`grok --remote ws://…/ws --secret …`) with masked status + one-time full copy; health note (local bind TCP only; no secret in logs)
- **Agent dashboard filters**: status chips with per-status counts (all / busy / permission / connecting / idle / error), free-text session search, project id/name/path filter, empty-filter state + clear; **Stop all busy** still targets every stoppable session globally (not only the filtered list)
- **Trace history manage** (Traces modal + Settings → Runtime): search by title/path, remove row, clear all (in-app confirm), optional file size from host `stat` after export — still paths only, never loads archive contents
- **Memory browser filters** (Settings → Agent): free-text search + kind chips (all / global / workspace / session / index / other) with counts, empty-filter state + clear; preview redact and clear-all workspace memory unchanged
- **Trace export + upload** (`grok trace`): session menu **Export local** (default, `--local`) vs **Export and upload…** with in-app confirm (network to xAI); host `session_trace_export` `localOnly` (default true); history may note `uploaded=true` when CLI reports remote info (paths only, no URLs/secrets); actionable failure toasts

#### Permissions / CLI
- **CLI `--no-ask-user`** (Settings → General → Agent; **CLI ≥ 0.2.117**): toggle spawns with top-level `--no-ask-user` so the agent does not emit `ask_user_question` questionnaires; optional per-session override (`SessionMeta.noAskUser` / `session_set_no_ask_user`, `null` inherits global); soft-respawn on change; pure resolve/spawn helpers + tests
- **Background wait policy** (CLI **0.2.117+**, Settings → General → Agent): `wait` (default) · `no_wait` (`--no-wait-for-background`) · `timeout` (`--background-wait-timeout` 1–3600s). Headless first-turn wait for background bash/monitor/subagents; wired on Remote IM / wallpaper headless and soft-gated on ACP top-level spawn (older CLI omits flags — no crash). Pure helpers + tests (`backgroundWaitPolicy`)
- **Include partial stream events** (CLI **0.2.117+**, Settings → Runtime → Pool): toggle `includePartialMessages` → headless paths using `--output-format streaming-messages-json` also pass `--include-partial-messages` for incremental `stream_event` text/thinking deltas. Remote IM upgrades format when on and CLI is new enough; older CLI soft-fails (flag omitted). Pure helpers + tests (`partialStream`)
- **CLI `--permission-mode` alignment**: pure App policy / YOLO / plan-mode map (`default` · `acceptEdits` · `auto` · `dontAsk` · `bypassPermissions` · `plan`); spawn pins top-level `--permission-mode` (+ agent `--always-approve` for YOLO); Settings shows CLI label + advanced mode selector; product **Auto** policy
- **Doctor fix depth**: plan banner (“N automatic fixes available (M need confirm)”), **Apply safe fixes** for non-destructive CLI remediations (sequential host `cli_doctor_fix`, then re-run doctor); destructive fixes stay per-row with in-app confirm; clearer fix-id + host errors
- **CLI worktree list**: host runs `grok worktree list --json` (text fallback); branch menu **CLI worktrees** section with refresh, reveal path, open as session cwd when the folder exists; soft-fail when CLI missing; pure JSON/text parsers + tests
- **CLI worktree DB** (Grok Build **0.2.117+**): host wraps `grok worktree db path|stats|rebuild` (timeout + soft-fail on older CLIs); pure text/JSON stats parsers + tests; Settings → Runtime → CLI **CLI worktree DB** shows path, stats summary, and **Rebuild** with in-app confirm (not `window.confirm`)
- **CLI sessions search** (Settings → Agent / CLI sessions): host `cli_sessions_search` runs `grok sessions search` (tries `--json`, else text parse of summaries + first prompts); enriches with local dir / linked state for import·open·delete; falls back to disk filter including first user prompt when CLI is unavailable
- **Permission rules simulator**: Settings → Permissions → try a tool call (e.g. `Bash(git status)`) and see allow / deny / ask / no-match from current compact rules (deny > ask > allow); pure client helpers + tests — does not write config
- **Memory content search** (Settings → Agent → Workspace memory files): host `memory_search` scans file bodies under active `GROK_HOME/memory` (path-scoped; hit + per-file byte caps); redacted snippets; Open / Reveal per row (previews stay redacted)
- **ACP server health** (Settings → Runtime → Connection): pure `parseAcpServerAddr` + host `acp_server_probe` (TCP ~2s, latency only, no secrets); blur validation, **Test connection**, ok/fail status chip; clearer API mode vs local CLI help + deep-link to Agent serve; soft-respawn when the address changes

#### Extensions / marketplace
- **Marketplace plugin detail**: clicking a catalog plugin opens a real detail panel (name, description, marketplace, version, skill/hooks/agents/MCP badges) with Install / Reinstall — not a stub
- **Install failure recovery**: last install error stays on that plugin row with **Retry**; cleared on success
- Installed **Details** shows structured marketplace/provides summary when available (plus CLI `plugin details` body)
- **Plugin validate** (`grok plugin validate`): **Validate** on installed plugin rows and on a local path before advanced install; multi-line CLI messages stay in an in-panel result (not only toast); soft-fail when the CLI is too old
- **Plugin validate pro**: classify outcomes (CLI too old / missing, path-only, parse/missing-field, not found, …) with severity chips + actionable hints in a **GlassModal** result (no `window.confirm`); soft-fail capability gaps stay warn (no hard action banner); pure `pluginValidate` helpers + tests; en/zh/zh-TW
- **Delete CLI sessions from disk** (Settings → Agent / CLI sessions): per-row delete + delete all unlinked; path-scoped under active `GROK_HOME/sessions`; linked App chats stay
- **Hooks Try / override**: validate sample stdin JSON (object only, ~32 KB cap), record synthetic dry-run activity (does **not** execute shell hooks); activity outcome filter chips (all/ok/fail/skip) + clear activity (in-app confirm)
- **MCP status modal depth**: search filter, status chips (all / ok / warn / error / unknown) from inspect `compatibilityStatus`/`transport`, count summary, refresh while open, copy name/target — host list only (no fake servers)
- **New skill scaffold** (Settings → Extensions → Skills): modal name/description + user (path-scoped GROK_HOME `/skills`) or project scope; host creates folder + default `SKILL.md` (no overwrite); refresh list and open existing SKILL.md editor
- **Skill edit pro** (Settings → Extensions → Skills): **Validate** + save preflight for `SKILL.md` frontmatter (name/description/body), classified load/save/create errors with actionable hints in a **GlassModal** (no `window.confirm`); pure `skillEditFeedback` helpers + tests; en/zh/zh-TW
- **Agents tab + scaffold**: Settings → Extensions → **Agents** lists user / project / bundled definition files; **New agent** modal (name + user/project scope) writes a SKILL-like `{name}.md` under active `GROK_HOME/agents` or project `.grok/agents` (no overwrite unless confirmed); open/reveal after create; preferred agent still chosen later in Settings → Agent
- **Project inspect depth** (Settings → Runtime): secret-safe hooks rows + skill name lists from `grok inspect --json`; section chips (plugins / skills / MCP / hooks / agents / rules / config / models / permissions); expand long lists; per-section copy JSON / copy path / reveal; pure filter helpers + tests
- **MCP doctor findings** (slash MCP modal + Extensions): host `mcp_doctor(name?)` runs `grok mcp doctor --json` with timeout and redacted errors; pure helpers flatten checks/issues into `{ id, level, title, detail, server? }` rows (no invented servers); **Run MCP doctor** shows findings with server filter + search; inspect refresh coexists with doctor results
- **MCP OAuth GUI** (slash MCP modal): when doctor marks a server / finding as OAuth required or expired, show **Authorize…** / **Retry OAuth**; open sanitized auth URLs from doctor text (secrets stripped) via system browser; GlassModal instructions for TUI `/mcps` → `i` when no URL (CLI has no headless `mcp oauth`); pure classifiers + tests; never logs client secrets
- **Hooks try-run**: Settings → Extensions → Hooks can **real-run** a script under `~/.grok/hooks` or project `.grok/hooks` only (host `hooks_try_run`, optional JSON stdin, timeout, redacted stdout/stderr); paths outside hooks dirs are refused; `ok` only on exit 0
- **Hooks try-run activity pro**: Recent activity is a **localStorage ring** of observed outcomes (ACP / stderr / try-runs); outcome filter chips (all/ok/fail/skip) with counts; honest empty vs filter-empty; **Clear** via GlassModal (count, no `window.confirm`); pure parse/load/save/filter helpers + tests; en/zh/zh-TW
- **Hooks validate pro**: try-run / stdin **Validate** show classified outcomes (path refused, timeout, non-zero exit, invalid JSON, …) with actionable hints in a **GlassModal** result (no `window.confirm`); pure `hooksValidate` helpers + tests; en/zh/zh-TW

#### X Evidence Rail (MVP)
- **X 证据轨** backend (`x_evidence.rs`, design: `docs/features/x-search.md`): `x_evidence_search` searches X via headless Grok CLI and persists every post as a local **evidence row** (sqlite `{app_data}/x-evidence/evidence.db`) with a stable `evidence_id`; posts without a canonical `x.com/…/status/…` URL are stored but flagged `verified=false` — hallucinated links never pass as evidence
- **Local evidence bus**: `x_evidence_list` (filter by session tag / query / author) + `x_evidence_get` (by ids) so later agent turns re-read evidence without re-searching or losing citations
- **Quote pack**: `x_quote_pack` renders evidence ids into a paste-ready markdown pack saved under `{app_data}/x-evidence/packs/*.md` (unverified items clearly marked); write-to-X path intentionally absent
- Frontend API wrappers in `src/lib/api.ts` (`xEvidenceSearch` / `xEvidenceList` / `xEvidenceGet` / `xQuotePack`)

**中文 · 新增（按域）**

- **输入/自定义提供商**：按提供商分组的模型选择（切换即 `providers_activate`）；每提供商多模型展示名目录；可配置推理力度阶梯；DeepSeek / Amux / 云 API 预设、申请 Key 链接与品牌 Logo

- **Agent**：**代码库索引 UX**（设置 → Agent；`[features].codebase_indexing`）：如实展示代码**图**索引开关与状态（非记忆 embedding）；缺失键保持未设置并标注 CLI 默认开启；独立 agent-home 写 bool + soft-respawn；共享只读；glob 自定义只读；旧 CLI soft-fail；纯助手与测试；en/zh/zh-TW + settingsCatalog
- **输入/对话**：队列、高度、提示历史、宽度字号、工具折叠/过滤、重生选模型、字数、变更芯片、工作区 dirty 芯片、会话变更审阅（+/− · 并排 diff · j/k）、结构化 JSON 回复面板（校验/复制/导出）、上下文用量/费用粗估
- **会话/侧栏**：复制 vs 分叉、恢复对话并还原代码（干净 worktree）、便签、会话规则（`--rules`）、会话最大轮次（`--max-turns` 覆盖；空/0 继承全局）、静音、未读点、HTML 导出、按天归档、日期分组、项目色、j/k 导航、CLI 对齐 worktree（默认 `~/.grok/worktrees`、侧栏 CLI/WT 标记）；**混合会话搜索**（全部/标题/内容芯片、含已归档、关键词片段与徽章，无向量）
- **会话/侧栏**：复制 vs 分叉、恢复对话并还原代码（干净 worktree）、便签、会话规则（`--rules`）、系统提示词覆盖（`--system-prompt-override`）、会话最大轮次（`--max-turns` 覆盖；空/0 继承全局）、静音、未读点、HTML 导出、按天归档、日期分组、项目色、j/k 导航、CLI 对齐 worktree（默认 `~/.grok/worktrees`、侧栏 CLI/WT 标记）
- **会话/侧栏**：复制 vs 分叉、恢复对话并还原代码（干净 worktree）、便签、会话规则（`--rules`）、会话最大轮次（`--max-turns` 覆盖；空/0 继承全局）、静音、未读点、HTML 导出、会话导出格式（Markdown / **纯文本** / JSON / HTML；完整 Markdown 优先 CLI `grok export`、失败回退本地会话）、按天归档、日期分组、项目色、j/k 导航、CLI 对齐 worktree（默认 `~/.grok/worktrees`、侧栏 CLI/WT 标记）
- **输入/对话**：队列、高度、提示历史、宽度字号、工具折叠/过滤、重生选模型、字数、变更芯片、工作区 dirty 芯片、会话变更审阅（+/− · 并排 diff · j/k）、结构化 JSON 回复面板（校验/复制/导出）、上下文用量/费用粗估、压缩对话框强度预设（轻/标/激 · 备注模板 · 前后估值）
- **输入/对话**：**实时语音委派状态**（听/思/说、停止、诚实空转写、可选发送转写到当前会话）、队列、高度、提示历史、宽度字号、工具折叠/过滤、重生选模型、字数、变更芯片、工作区 dirty 芯片、会话变更审阅（+/− · 并排 diff · j/k）、结构化 JSON 回复面板（校验/复制/导出）、上下文用量/费用粗估
- **会话/侧栏**：复制 vs 分叉、恢复对话并还原代码（干净 worktree）、便签、会话规则（`--rules`）、会话最大轮次（`--max-turns` 覆盖；空/0 继承全局）、静音、未读点、HTML 导出、按天归档、日期分组、项目色、j/k 导航、CLI 对齐 worktree（默认 `~/.grok/worktrees`、侧栏 CLI/WT 标记）
- **外观/壳**：主题定时、跟随系统语言、忙碌退出确认、托盘角标、快捷键冲突面板（录制警告 + 重置冲突项）、快捷键范围（全局/对话列 + 可选跨范围共用组合键）
- **会话/侧栏**：复制 vs 分叉、**新窗口打开会话**（`#/session/<id>` 深链；副窗仅查看、不抢 live 槽）、恢复对话并还原代码（干净 worktree）、便签、会话规则（`--rules`）、会话最大轮次（`--max-turns` 覆盖；空/0 继承全局）、静音、未读点、HTML 导出、按天归档、日期分组、项目色、j/k 导航、CLI 对齐 worktree（默认 `~/.grok/worktrees`、侧栏 CLI/WT 标记）
- **会话/侧栏**：复制 vs 分叉、恢复对话并还原代码（干净 worktree）、便签、会话规则（`--rules`）、会话最大轮次（`--max-turns` 覆盖；空/0 继承全局）、静音、未读点、HTML 导出、按天归档、日期分组、项目色、j/k 导航、CLI 对齐 worktree（默认 `~/.grok/worktrees`、侧栏 CLI/WT 标记）；**混合会话搜索排序**（命令面板 Keyword/Hybrid + 设置；本地词元重叠，非云端嵌入）
- **会话/侧栏**：复制 vs 分叉、恢复对话并还原代码（干净 worktree）、分叉/恢复可选 CLI `--fork-session`（新 agent session id，ACP `session/fork`）、便签、会话规则（`--rules`）、会话最大轮次（`--max-turns` 覆盖；空/0 继承全局）、静音、未读点、HTML 导出、按天归档、日期分组、项目色、j/k 导航、CLI 对齐 worktree（默认 `~/.grok/worktrees`、侧栏 CLI/WT 标记）
- **外观/壳**：主题定时、跟随系统语言、忙碌退出确认、托盘角标、快捷键冲突面板（录制警告 + 重置冲突项）
- **会话/侧栏**：复制 vs 分叉、恢复对话并还原代码（干净 worktree）、便签、会话规则（`--rules`）、静音、未读点、HTML 导出、**分享卡片 PNG**（会话菜单 → 导出为图片；页脚 Generated with Grok App；设置可上传自定义 Logo）、按天归档、日期分组、项目色、j/k 导航、CLI 对齐 worktree（默认 `~/.grok/worktrees`、侧栏 CLI/WT 标记）
- **外观/壳**：主题定时、跟随系统语言、忙碌退出确认、托盘角标、**分享卡片 Logo**（外观 → 界面）
- **Agent**：禁用内置工具（芯片 + 自由列表 → `--disallowed-tools`；与禁用网页搜索并存；更改 soft-respawn）；可选 profile 路径（`--agent-profile`）
- **系统**：**Agent serve** 启停（设置 → 运行时 → 连接）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选；**记忆浏览器** 搜索 + 类型芯片筛选（空结果/清除）
- **系统**：**已安排任务后台诚实说明**（无独立守护进程；横幅 + 忙碌退出附注 + 登录启动说明）；**Agent serve** 启停（设置 → 运行时 → 连接）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选
- **系统**：**Agent serve** 启停（设置 → 运行时 → 连接）；**可靠性卡顿时间线**（localStorage ring ~40、筛选/清空确认、无密钥）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选
- **Agent**：禁用内置工具（芯片 + 自由列表 → `--disallowed-tools`；与禁用网页搜索并存；更改 soft-respawn）；可选 profile 路径（`--agent-profile`）；**config.toml 安全查看**（脱敏 monospaced、分区跳转、复制路径/在文件夹显示/外部编辑器；非自由写入）
- **Agent**：禁用内置工具（芯片 + 自由列表 → `--disallowed-tools`；与禁用网页搜索并存；更改 soft-respawn）；**允许的工具**（`--tools` allowlist；空=全部；与 denylist 并存提示；soft-respawn）；可选 profile 路径（`--agent-profile`）
- **Agent**：禁用内置工具（芯片 + 自由列表 → `--disallowed-tools`；与禁用网页搜索并存；更改 soft-respawn）；可选 profile 路径（`--agent-profile`）；**Agents JSON** 启动注入（`--agents`；空省略；无效阻止保存；soft-respawn；不写共享 `~/.grok`）
- **Agent**：禁用内置工具（芯片 + 自由列表 → `--disallowed-tools`；与禁用网页搜索并存；更改 soft-respawn）；可选 profile 路径（`--agent-profile`）；**config.toml 安全分区编辑**（独立 agent-home 白名单键、脱敏预览、共享模式只读警告、禁止整文件改写密钥）
- **系统**：**Agent serve** 启停（设置 → 运行时 → 连接）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选
- **系统**：**Agent serve** 启停（设置 → 运行时 → 连接）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选、多选停止（仅可停止行）、工具标题与权限徽章
- **系统**：**Agent serve** 启停（设置 → 运行时 → 连接）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；**Trace 本地导出 vs 导出并上传**（确认弹窗、`localOnly` 默认 true、历史上传标记、失败 toast）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选
- **系统**：**Agent serve** 启停（设置 → 运行时 → 连接）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记与 **用作对话目录**（绑定当前会话 cwd）；**Agent 仪表盘** 状态/搜索/项目筛选
- **系统**：**Agent serve** 启停（设置 → 运行时 → 连接）；**远程 IM 深度**（密钥默认遮罩+显示/隐藏、Bridge 事件时间线 ring、飞书/Lark 与 Telegram 渠道健康卡）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选
- **系统**：**Agent serve** 启停（设置 → 运行时 → 连接）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选；**费用汇总**（设置 → 运行时 → 诊断：按项目/日汇总已知 token，缺失为未知，粗估非账单）
- **系统**：**Agent serve** 启停（设置 → 运行时 → 连接）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**镜像加固**（写入类别列表/宽面警告、最大连接数、轮换确认、日志脱敏）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选
- **系统**：**Leader fleet**（list / info / kill 确认；旧 CLI 软失败）；**Agent serve** 启停（设置 → 运行时 → 连接）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选
- **系统**：**已安排任务托盘驻留 / AUTO-RUNNER**（Host 调度状态 API、为已安排保留托盘、可选 macOS LaunchAgent 助手生成与安装——非假 daemon）；**Agent serve** 启停（设置 → 运行时 → 连接）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选
- **系统**：**Agent serve** 启停（设置 → 运行时 → 连接）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选；**可靠性支持包**含脱敏卡顿时间线快照
- **系统**：**Agent serve** 启停（设置 → 运行时 → 连接）；可选 **`--remote` 代理** + 客户端连接字符串模板（脱敏状态 / 启动时复制完整值；健康检查仅本机 TCP）；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选
- **系统**：**SDK 连接向导**（设置 → 运行时 → 连接：本地 serve 启停、掩码密钥/ws URL、TCP 探测、curl/websocat/grok 示例、远程 URL 探测；密钥不落日志）；**Agent serve**；**手机镜像写入审计**（本地 ring、无密钥/URL）；**Trace 历史管理**（搜索/移除/清空确认/可选大小）；任务面板子代理 **WT/cwd** 标记；**Agent 仪表盘** 状态/搜索/项目筛选
- **计划**：**请求修改** 可选修订说明；计划历史搜索/决策筛选、清空确认、会话仍在时可打开
- **扩展/市场**：目录插件详情面板（描述/版本/组件徽章 + 安装/重装）；安装失败行内重试；已安装 provides 结构化摘要；**Hooks 试跑/覆盖**（校验 stdin JSON、合成 dry-run 活动、结果筛选与清空确认；不执行 shell hook）
- **扩展/市场**：目录插件详情面板（描述/版本/组件徽章 + 安装/重装）；安装失败行内重试；已安装 provides 结构化摘要；**MCP 状态弹层**（搜索/状态芯片/计数/刷新/复制名称与目标）
- **扩展/市场**：目录插件详情面板（描述/版本/组件徽章 + 安装/重装）；安装失败行内重试；已安装 provides 结构化摘要；**新建技能脚手架**（名称/描述/用户或项目作用域 → 默认 SKILL.md + 打开编辑器）
- **扩展/市场**：**技能编辑 pro**（校验 + 保存前检查 SKILL.md 前置元数据；加载/保存/创建错误分类与可操作提示的 GlassModal；无 `window.confirm`）
- **扩展/市场**：目录插件详情面板（描述/版本/组件徽章 + 安装/重装）；安装失败行内重试；已安装 provides 结构化摘要；**Agents** 页列出定义文件并支持 **新建 Agent** 脚手架（用户/项目作用域、`Name.md` 模板、覆盖确认、打开/显示）
- **扩展/市场**：目录插件详情面板（描述/版本/组件徽章 + 安装/重装）；安装失败行内重试；已安装 provides 结构化摘要；**插件校验**（`plugin validate`：已安装行 + 本地路径安装前；行内结果面板；旧 CLI 软失败）
- **扩展/市场**：**插件校验 pro**（分类结果 + GlassModal 提示；CLI 过旧/缺失 soft-fail；纯 helpers + 测试；en/zh/zh-TW）
- **扩展/市场**：目录插件详情面板（描述/版本/组件徽章 + 安装/重装）；安装失败行内重试；已安装 provides 结构化摘要；**项目检查深度**（分区芯片、钩子/技能名清单、展开列表、分节复制 JSON/路径）
- **扩展/市场**：目录插件详情面板（描述/版本/组件徽章 + 安装/重装）；安装失败行内重试；已安装 provides 结构化摘要；**MCP doctor** 诊断结果列表（`mcp_doctor` + 扁平 findings；斜杠 MCP 弹窗可运行/筛选；与 inspect 刷新共存）
- **扩展/市场**：**MCP OAuth GUI**（诊断标记需 OAuth / 凭证过期时显示「授权…」/「重试 OAuth」；打开脱敏后的授权 URL；无 URL 时 GlassModal 指引 TUI `/mcps` → `i`；无头 CLI 无 `mcp oauth`；不写客户端密钥日志）
- **扩展/市场**：**MCP OAuth 恢复向导**（状态弹窗 + Extensions 多步 GlassModal：检测 → 服务器/原因 → 脱敏 URL 或 TUI 回退 →「我已授权」重跑 doctor → 成功/分类 soft-fail；纯 step-machine + 测试；无 `window.confirm`；en/zh/zh-TW）
- **扩展/市场**：目录插件详情面板（描述/版本/组件徽章 + 安装/重装）；安装失败行内重试；已安装 provides 结构化摘要；**Hooks 试跑**（仅 hooks 目录内脚本、可选 JSON stdin、超时、脱敏输出；目录外拒绝；仅 exit 0 成功）
- **权限/CLI**：**`--no-ask-user`**（设置 → 通用 → Agent；**CLI ≥ 0.2.117**）：顶层 flag 禁用 ask_user 问卷；可选会话覆盖（`null` 继承全局）；soft-respawn；纯 resolve/spawn 助手与测试
- **权限/CLI**：**包含部分流式事件**（CLI 0.2.117+：`--include-partial-messages`；仅 `streaming-messages-json`；设置 → 运行时 → 进程池；远程 IM 升级 format；旧 CLI soft-fail）
- **权限/CLI**：`--permission-mode` 映射与 spawn；设置页 CLI 标签与高级选择；**Auto** 策略；Doctor 安全批量修复；**删除磁盘 CLI 会话**（单条/全部未关联；限定 `GROK_HOME/sessions`）
- **权限/CLI**：**后台等待策略**（CLI 0.2.117+：`wait` / `no_wait` / `timeout`；设置 → Agent；无头与 ACP 顶层 soft-fail 旧 CLI）
- **扩展/市场**：目录插件详情面板（描述/版本/组件徽章 + 安装/重装）；安装失败行内重试；已安装 provides 结构化摘要
- **权限/CLI**：`--permission-mode` 映射与 spawn；设置页 CLI 标签与高级选择；**Auto** 策略；Doctor 安全批量修复；**删除磁盘 CLI 会话**（单条/全部未关联；限定 `GROK_HOME/sessions`）；**CLI worktree 列表**（`grok worktree list`；分支菜单刷新/显示/安全打开为 cwd）
- **权限/CLI**：`--permission-mode` 映射与 spawn；设置页 CLI 标签与高级选择；**Auto** 策略；Doctor 安全批量修复；**删除磁盘 CLI 会话**（单条/全部未关联；限定 `GROK_HOME/sessions`）；**CLI 会话搜索**（`grok sessions search` 摘要+首条提示，失败则本地磁盘含首条提示筛选）
- **权限/CLI**：`--permission-mode` 映射与 spawn；设置页 CLI 标签与高级选择；**Auto** 策略；Doctor 安全批量修复；**删除磁盘 CLI 会话**（单条/全部未关联；限定 `GROK_HOME/sessions`）；**权限规则试算**（输入工具调用预览 allow/deny/ask，不写配置）
- **权限/CLI**：`--permission-mode` 映射与 spawn；设置页 CLI 标签与高级选择；**Auto** 策略；Doctor 安全批量修复；**删除磁盘 CLI 会话**（单条/全部未关联；限定 `GROK_HOME/sessions`）；**记忆正文搜索**（`GROK_HOME/memory` 路径限定 + 上限；脱敏摘录；打开/显示）
- **权限/CLI**：`--permission-mode` 映射与 spawn；设置页 CLI 标签与高级选择；**Auto** 策略；Doctor 安全批量修复；**删除磁盘 CLI 会话**（单条/全部未关联；限定 `GROK_HOME/sessions`）；**ACP 服务器健康检查**（解析/TCP 探测/状态芯片/blur 校验；地址变更 soft-respawn）
- **X 证据轨（MVP）**：`x_evidence_search` 经 headless Grok CLI 搜 X 并逐条落库为本地证据行（sqlite，稳定 `evidence_id`，无合法 status 链接标 `verified=false`）；`x_evidence_list` / `x_evidence_get` 本地证据总线跨回合复用；`x_quote_pack` 生成可粘贴 markdown 引用包（设计文档 `docs/features/x-search.md`；不含发帖写路径）


**中文 · 修复**

- **自定义提供商双栏滚动**：账户 → 自定义提供商页不再整页滚动，左右列表/详情各自内部滚动

- CLI SHA-256（#227）；CSS（#259）；多轮对话滚动卡顿（#280）
- **MCP config.toml 解析**：多行 `args = [` 漏闭合不再吞掉下一个 `[mcp_servers.*]` 表头（整个 server 曾被静默丢弃）；数组结尾判定改为字符串感知，引号内的 `]` 不再截断参数
- **壁纸画廊**：`is_gallery_media_url` 补齐下载白名单主机（`abs.twimg.com`、`filesystem.site`），合法 Imagine/CDN 图不再被静默过滤
- **壁纸 URL 归一**：twimg 老式 `:thumb/:small/:medium/:large` 后缀恢复归一为 `:orig`（原替换分支在 `Url::parse` 成功后不可达）


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
- **Ask User Question timeout** (Settings → General → Permissions): Off / 30s / 1m / 2m / 5m with countdown on the questionnaire modal; auto-dismisses (cancel) when the timer ends. **App-enforced** (localStorage); aligns with Grok Build CLI **0.2.117** `[toolset.ask_user_question]` `timeout_enabled` / `timeout_secs` conceptually — does not rewrite `~/.grok/config.toml`

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
- 收起全部活动；侧栏相对时间；权限超时自动拒绝；Agent 提问超时自动忽略

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
