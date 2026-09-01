# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Maintainer rule (AI):** before every `vX.Y.Z` tag, complete `## [X.Y.Z]` below.  
CI Release body = this section only (via `scripts/changelog-for-release.py`; no repeated download/install boilerplate).  
See `docs/llm-wiki/release.md`.

**What's New popup:** each bullet's **first sentence** is what users see. Keep that sentence to one short line (added / fixed / improved — no paths, no implementation, no issue piles). A second short sentence is allowed for GitHub / this file only. Do **not** rewrite already-shipped `## [X.Y.Z]` sections.

## [Unreleased]

### Fixed
- Desktop composer reasoning menu no longer shows the raw spawn id for the top tier. It uses the localized label (e.g. Extra high / 极高) like the other effort stops (#994).
- Project chats no longer inherit the default-workspace sandbox. Writes inside the selected project work again (#986).
- Expanded tool steps no longer stack title and command on one line. The last row in a Worked-for list keeps its real height (#983).
- Thinking no longer stays on screen as the final reply. The real answer paints in place; switching chats is not required (#968).
- Settings search finds Chinese keywords for permission, telemetry, login, and more. Bilingual keywords stay locked by catalog test (#970).
- Queue edit and other glass dialogs stay above the embedded browser. Native webviews hide while the modal is open (#976).
- Doctor and the agent dashboard no longer use native dropdowns. They use the same app Select as settings (#981).
- Screen-reader labels for the files pane and setup steps follow the UI language. They no longer stay English (#982).

**中文 · 修复**
- 桌面 Composer 推理强度最高档不再显示原始 `xhigh`，会走本地化文案（如「极高」），与其它档位一致（#994）。
- 项目会话不再误用默认工作区的沙箱。在选中项目里写文件又能成功了（#986）。
- 展开的工具步骤不再把标题和命令叠在同一行。工作列表最后一行会按真实高度排开（#983）。
- 思考结束后不再把思考过程当成最终回复。正文会直接画出来，不用切走再切回来（#968）。
- 设置搜索补上了中文关键词，权限、遥测、登录等能搜到了。目录测试会锁住双语关键词（#970）。
- 打开内置浏览器时，队列编辑等毛玻璃弹窗不再被挡住。弹窗打开期间会暂时藏起原生页面（#976）。
- Doctor 和智能体面板不再用系统原生下拉。跟设置一样走项目 Select（#981）。
- 文件面板和设置向导的读屏标签跟界面语言走。不再固定英文（#982）。

### Changed
- More UI languages fill in strings that still matched English. Remaining locales including Japanese, Korean, Russian, Ukrainian, and Tamil follow the locale (#972–#975, #977–#980).
- Background git status work is quieter. The dirty chip pauses while the window is hidden, and Host runs status off the async runtime (#988, #990).
- Opening a chat with media settles with fewer polls. Reveal still waits on load events; the safety net is slower (#989).

**中文 · 变更**
- 更多界面语言补上了原先还跟英文重复的可见文案。含日/韩/俄/乌/泰米尔等剩余语言跟语言走（#972–#975、#977–#980）。
- 后台 git status 更省。窗口隐藏时脏标记停轮询，Host 也不再堵在 async 线程上（#988、#990）。
- 打开带媒体的会话少扫 DOM。仍靠加载事件揭开，兜底轮询更慢（#989）。

## [0.2.29] - 2026-08-31

> **Highlight:** One-click CLI install, complete translations, and smoother long chats.
>
> **中文 · 亮点：** 一键装 CLI、翻译补全、长对话更顺。

### Added
- When the Grok Build CLI is missing, Runtime settings offers a one-click install.

**中文 · 新增**
- 找不到 Grok Build CLI 时，运行时设置里可以直接一键安装。

### Changed
- Missing translations are filled in. SSH, IM security, permission rules, and Doctor checks follow the UI language.
- Scrolling a long chat does less work per frame. Three full-journal scans no longer run on every render.
- Long chats scroll more smoothly. Measuring one row no longer re-adds every row above it.

**中文 · 变更**
- 补上缺的翻译。SSH、IM 安全、权限规则和 Doctor 检查跟界面语言。
- 长会话滚动每帧少做一些活。三处全量遍历不再每次渲染都跑。
- 长会话滚动更顺。测量一行不再把它上面所有行的高度重新加一遍。

### Fixed
- CLI update banner and empty side-tab hint follow Appearance text color on wallpaper. They sat outside the old chrome list and used tertiary ink.
- Opening a remote file no longer shows a failed banner when the file already loaded. Listing a parent folder is not treated as an SSH outage.
- Rewind puts the discarded user prompt back in the composer. Edit it and send again, including attachments.
- Chat no longer jumps while the agent is streaming. Switching away and back no longer lands in the middle.
- Live thinking is not clipped in a 220px box. The transcript follows the stream.
- Opening an SSH path chip no longer blanks the window. The files pane shows a loading state instead of an empty Suspense.
- A question from the agent comes back after a reload instead of leaving the chat stuck. Reopening the chat restores it.
- Rollback no longer spins for minutes when the agent is slow to answer. Forking a chat also stops holding up other chats' sends.
- Rewind is refused while a chat you switched away from is still streaming. It used to cut that chat's history mid-turn.

**中文 · 修复**
- 壁纸上 CLI 更新条和「未打开标签」跟外观文字色。原先不在暴露层名单里，用了过淡的 tertiary。
- 修复远端文件已经打开仍显示 failed。展开目录失败不再盖住已经读出来的正文。
- 修复回退后用户那句从对话里消失、没法改。会回到输入框，带上原来的附件。
- 修复对话输出时屏幕往上跳、切出 App 再回来落到中间。正在看历史时不会被拽回底部。
- 修复 Live Thinking 被 220px 小框截断。主对话跟着流式输出走。
- 修复点 SSH 路径 chip 整窗变白。文件面板先显示加载，不再空白。
- 修复重载后 agent 的提问消失、会话卡在思考中。重新打开会话会把提问恢复出来。
- 修复回退在 agent 迟迟不应答时转好几分钟。分叉会话也不再占住别的会话的发送。
- 修复切走的会话还在输出时仍允许回退。原先会截断那条会话的历史。

## [0.2.28] - 2026-08-29

> **Highlight:** SSH remote hosts, a combined model chip, and chat that stays with the stream.
>
> **中文 · 亮点：** SSH 远端主机、模型推理合一芯片，对话跟住输出。

### Added
- SSH remote hosts can be watched from Settings. Runtime → SSH; list, open, and start remote chats over OpenSSH.

**中文 · 新增**
- 设置里可 Watch SSH 远端主机。运行时 → SSH；列出、打开，并在远端文件夹开新对话。

### Changed
- Composer model chip is one control for model + effort. Advanced hub; empty and active chats share the same width.
- Message action buttons stay visible. Appearance still has On hover.
- Opening a file uses the full preview. The tree stays closed unless you pick Files or jump from env.

**中文 · 变更**
- 输入框模型按钮改为模型+推理一颗芯片。高级悬停侧出选项；空对话和进行中对话同一列宽。
- 消息操作按钮默认始终显示。外观里仍可改回悬停显示。
- 打开文件用满宽预览。除非点 Files 或从环境跳转，文件树保持收起。

### Fixed
- Last chat lines stay above the composer. Bottom overscroll no longer hides the tail.
- Rewind on the last user bubble undoes that turn. Local journal still truncates if agent rewind fails.
- First send on a new chat is not dropped when the agent is parked as viewed-only.
- SSH path chips in chat open the files tree like local projects.
- Long live thinking stays on the latest tokens. After a turn finishes, the view stays on the stream.
- Wallpaper frost stays on during a live turn. Overlay at 0% no longer clears blur.
- Windows taskbar keeps the Grok mark after an update.
- Mac Steer is Ctrl+Enter only, matching Grok Build CLI. Cmd+Enter no longer steers.
- Windows wallpaper frost reaches the sidebar and empty chat.
- Fork from a middle turn no longer brings back later parent messages.
- Rapid follow-up messages no longer lose the next reply.
- Cmd/Ctrl click keeps multi-select in the session list.

**中文 · 修复**
- 修复对话最后几行压在输入框上。底部超滚不再把尾巴藏起来。
- 修复点最后一条用户消息无法回退。Agent rewind 失败时仍截断本地记录。
- 修复新会话第一轮发出去没有真正开跑。
- 修复 SSH 会话里点路径 chip 不能跳到侧栏文件树。
- 修复思考过长时看不到最新内容。任务结束后视口留在流式输出结尾。
- 修复进会话、开始直播时壁纸突然变清楚。遮罩拉到 0% 也不会关掉模糊。
- 修复 Windows 更新后任务栏变成空白文档图标。
- 修复 Mac 引导快捷键。对标 Grok Build CLI，只用 Ctrl+Enter。
- 修复 Windows 壁纸透过侧栏和空会话。
- 修复从中间分叉时后面的父会话消息又回来。
- 修复连续快速发送时下一条回复丢失。
- 修复按住 Cmd/Ctrl 点选会话时只留下最后一条。

## [0.2.27] - 2026-08-27

> **Highlight:** Settings opacity, plugin packs, LaTeX, and a less blocking ask bar.
>
> **中文 · 亮点：** 设置页透明度、斜杠选插件、对话公式，提问不再挡住会话。

### Added
- Settings overlay opacity can be adjusted. Appearance → Theme; 20% floor; not in `.grokskin`.
- After an update, the app shows this version's notes. Reopen from the account menu or Settings → About.
- Slash menu can pick a whole plugin pack. A single skill from the pack can still be chosen.
- Chat can render LaTeX. Matches Grok Build CLI `$…$` / `$$…$$`.
- The text-selection toolbar can be hidden. Right-click still works.
- The progress rail can sit on the left or right.
- Text color and shadow can be customized. These fields travel with `.grokskin`.

**中文 · 新增**
- 设置页可调节不透明度。外观 → 主题；最低约 20%；不进皮肤包。
- 更新后会弹出本版说明。账户菜单和设置 → 关于可再打开。
- 斜杠菜单可以选整个插件。仍可只选其中一条 skill。
- 对话支持 LaTeX 公式。与 Grok Build CLI 的 `$…$` / `$$…$$` 一致。
- 可隐藏划词工具栏。右键菜单仍可用。
- 对话进度条可改到左侧或右侧。
- 可自定义文字颜色和阴影。这两项会随皮肤包导入导出。

### Changed
- OpenRouter preset is now GLM-5.3 Flash. Saved channels stay until re-added.
- Zhipu GLM is a single gallery entry with official branding.
- Custom provider form puts name, URL, and key first.
- Environment info can pin beside the chat.
- Plan card and agent questions no longer cover the transcript.
- Titlebar, wallpaper, and pane contrast were cleaned up.
- Overlay blur notes a macOS 27+ bug.
- Dock icons use the authored black and white sets.
- README lists Linux AppImage runtime packages.
- Unused UI widgets were removed.
- What's New notes are one short sentence per bullet.

**中文 · 变更**
- OpenRouter 预设改为 GLM-5.3 Flash。已保存通道不会自动改。
- 智谱 GLM 改为单入口并带官方标识。
- 自定义服务商表单把关键信息提前。
- 环境信息可固定到对话旁。
- 计划卡片和 Agent 提问不再挡住会话。
- 标题栏、壁纸和分栏对比已调整。
- 遮罩模糊下注明 macOS 27+ 有 bug。
- Dock 图标改用成品黑白套件。
- 补充 Linux AppImage 运行依赖说明。
- 移除未使用的界面组件。
- 更新公告每条只保留一句话。

### Fixed
- Opening a past chat waits until image and video cards have a real height, then shows the thread and scrolls to the latest once.
- Chat stays pinned through thinking, tools, and pane resize.
- Custom effort catalogs no longer check two rungs at once.
- The providers list scrolls when there are many channels.
- Windows editor open no longer passes extended-length paths.
- Desktop pet motion and language follow the app again.
- Composer newline no longer drops the whole line.
- Session API second turn no longer deadlocks.
- Signed-out startup no longer waits on authenticate.
- Sidebar selection, new-chat fold, and leftover plan overlay were fixed.
- Wallpaper overlay now continues across the right pane.
- Appearance preset and color cards are flat. Video presets play in the card.
- Appearance preset cards show an outline only when selected.

**中文 · 修复**
- 修复打开历史会话不滚到最底部。等图片和视频卡片高度算准后再展示记录，并只滚一次到底。
- 修复思考、工具输出和打开侧栏时聊天不跟到底。
- 修复自定义推理档会同时勾中两档。
- 修复服务商列表条目多时无法滚动。
- 修复 Windows 用编辑器打开路径。
- 修复桌宠动画和语言。
- 修复输入框换行把整行下移。
- 修复会话接口第二轮卡住。
- 修复未登录启动长时间等待。
- 修复侧栏选中、新建会话折叠和计划面板遮罩。
- 修复壁纸遮罩在右侧栏变亮。
- 去掉外观预设卡和配色卡的浮雕；视频预设会在卡片里播放。
- 外观预设卡仅在选中时显示描边。

## [0.2.26] - 2026-08-24

> **Highlight:** Import Grok Build CLI sessions from Account; phone mirror on the same Wi-Fi; Windows permission/rewind clicks; long chats stay scrollable.
>
> **中文 · 亮点：** 从账户导入 Grok Build CLI 会话；同一 Wi-Fi 手机镜像；Windows 权限/回退按钮可点；长对话滚动不再卡死。

### Added
- **Import Grok Build CLI sessions from Account → Recent sessions**: Import & open a row, or import the listed table into the sidebar. Empty sidebar offers the same when local CLI logs exist. Import may add the CLI cwd as an **untrusted** project (never home `/` or `~/`).
- **Second SuperGrok login hint** on the account switcher: Add account, then switch. One login stays active.

**中文 · 新增**
- **从设置 → 账户「近期会话」导入 Grok Build CLI 对话**到侧栏；空侧栏在有本地 CLI 记录时提供同一入口。导入可为 CLI 工作目录补一条**未信任**项目（不会把家目录或 `/` 加成项目）。
- **账户切换**提示可添加第二个 SuperGrok 登录；同一时间只有一个登录生效。

### Changed
- **Settings overlay navigation (#870)**: open/section/tab/hash/last-route live in `useSettingsNavigation`. Pref hydration is `useAppSettingsPrefs`; session connect/live map is `useSessionConnect`.
- **AppWorkbench domain split (#869)**: session tree, sidebar, composer send, settings stage and related chrome live in extracted modules.
- **Bottom terminal tab chrome**: hover shows the close chip on every tab; a close-all icon sits next to New terminal.
- **Plan / resources pane enter motion**: desktop in-flow aside interpolates width with the existing pane-split token; overlay and side-expanded stay snap. Bottom terminal height still snaps (no chat virtualizer reflow); chrome/body fade in.
- **Light wallpaper readability**: light theme uses its own white veil and weaker main mix so text stays ink-dark on mixed wallpaper; no extra cards under chrome.

**中文 · 变更**
- **设置页导航 / prefs / connect（#870）**：开合走 `useSettingsNavigation`，prefs 水合走 `useAppSettingsPrefs`，会话 connect/live map 走 `useSessionConnect`。
- **AppWorkbench 拆分（#869）**：会话树、侧栏、发送路径、设置舞台等迁到独立模块。
- **底部终端标签栏**：鼠标悬停任意标签显示关闭；加号旁增加关闭所有终端。
- **计划 / 资源侧栏入场**：桌面分栏宽度用现有 pane-split 令牌插值；overlay 与展开覆盖仍一次落位。底部终端高度仍一次到位（避免长对话重排）；顶栏和内容淡入。
- **浅色壁纸可读性**：浅色主题用独立白色 veil、主区更通透；文字保持深色描边，不额外加承载卡片。

### Fixed
- **Windows permission bar clicks (#878, #880)**: the card dumped ACP request JSON as the command preview, and Approve / Deny could miss clicks (floating composer is `pointer-events: none` without `no-drag`). Preview is the command/path; buttons stay clickable; busy/error show on the card.
- **Windows rewind confirm stayed open (#879, #880)**: failures toasted under the modal overlay (`z-index` 60 vs 12000). Toast is portaled above overlays; rewind shows the error in the dialog; the timeline closes before confirm.
- **Long-chat history browse freeze (#881, #882)**: a 4800px overscan floor remounted too much markdown on a fling. Browse overscan scales down with row count; the pin-to-bottom window is unchanged.
- **Phone mirror same-LAN access (#875)**: the host bound only `127.0.0.1`, so replacing the URL with a LAN IP returned `ERR_CONNECTION_REFUSED`. Loopback stays the default. **Allow same Wi-Fi** (in-app confirm) rebinds `0.0.0.0` and copies/QRs the detected LAN IPv4. Soft-fail copy no longer claims LAN works without that toggle.
- **Windows PTY clippy**: `PtySession.pid` is Unix-only (process-group SIGKILL). Windows kill stays on `ChildKiller`, so CI `-D warnings` stays green.
- **Expanded SideWorkbench vs macOS traffic lights**: when the sidebar is hidden or overlayed, the shared pane chrome pads with `--titlebar-safe-left`.
- **WeCom webhook replay window**: signed callbacks whose `timestamp` is outside ±300 seconds are rejected with 401.
- **WeCom webhook loopback hint**: webhook mode bound to 127.0.0.1 now surfaces that public callbacks need `allow_external` (runtime last_error code + Settings health copy).
- **CLI session project import**: auto-add uses home-relative depth ≥ 2, so Linux `/home/name/projects` and Windows `C:\Users\name\Documents` are not treated as projects. Missing home refuses.
- **Theme switch snapshot cap**: WebKit color snapshot skips animation when the live DOM has more than 400 elements, avoiding jank on large trees.
- **Closing a terminal really kills the shell**: tab × / close-all / overflow / project switch call host `terminal_pty_kill` (process killer + PTY drop), not only hide the chip. Hide-panel still keeps sessions.
- **Bottom terminal tab numbers follow creation order**: the plus button appends a new chip on the right, so the original Terminal 1 stays Terminal 1 instead of being pushed to Terminal 2.
- **Terminal prompt inset**: side and bottom PTY text sits 5px inside the pane. The 50% veil still covers the full terminal; padding is on `.xterm`, not the host.
- **New session side pane opens the picker, not Plan**: the unused `planFocusKey` 0 is no longer treated as a focus bump, so opening the right pane on a fresh chat shows the kind menu instead of an empty Plan tab.
- **Plan empty state centers in the side pane**: the idle title / hint / history CTA no longer sit in a left-capped 28rem column when Plan is a side-workbench tab.
- **Context compact cards stay at the moment of compaction (#855)**: mid-turn auto-compact freezes the current assistant bubble, inserts the banner, then continues streaming below it so later tools are not piled on the composer.
- **Files tree refreshes when the agent creates files (#863)**: open Resources keeps expand state and re-lists root + expanded folders as session write paths change — no need to close and reopen the pane.
- **Long chat transcript scroll no longer hitches on Worked-for blocks or lift-off (#853)**: Follow-up to #842. Virtual-window growth that still covers the viewport commits in the background (`startTransition`) and at most 3 rows per frame; collapsed tool steps skip `toolExpandBody` until opened; scroll settle uses velocity + a 160ms stillness floor so touchpad lift-off is not treated as a stop; hover is disabled while moving; pin snap restores the pre-commit distance from the bottom so expanding overscan does not bounce.
- **WeCom webhook auth + ACL fail-closed (#851)**: webhook mode requires `callback_token` and verifies signatures; empty `allowFrom` denies all (use `*` to opt in); loopback bind by default.
- **Settings segmented controls no longer flash (#856)**: shared `SegmentedControl` for tabs and theme capsules; first mount settles without a vertical expand.
- **Welcome intro motion + Appearance toggle (#857)**: restored “what to do today” cadence; optional welcome animation (on by default).
- **Sidebar open/close motion stable (#858)**: wide-window rail eases with the main pane; titlebar safe padding no longer snaps toward traffic lights.
- **Settings frosts wallpaper behind the stage (#859)**: `app-settings-stage` uses glass blur/saturate under wallpaper.
- **Theme light/dark transition keeps sidebar blur (#860)**: View Transition elsewhere; WebKit color WAAPI so backdrop-filter stays live.
- **Pet body edge no longer shows a white fringe (#861)**: same-ink stroke covers AA seams.

- **Composer matches chat reading width after the first turn**: once a session has transcript, the floating input (and permission bar) follow Appearance → chat width via `--chat-width-max`. Empty/new-session welcome still uses the classic `42rem` input.
- **Sidebar “Other sessions” no longer sits under empty project space**: collapsing every project (or shrinking a folder after a long session list) now retargets the locked L1 projects height to the remaining rows instead of keeping the last expanded px.
- **Sidebar project header icons**: chevron + space name expand/collapse the project list; space switching is a standalone switch button that appears on row hover like collapse/more; collapse-all stays outside; select, archive-older, and add-project move into a ⋯ menu.
- **Official-aux X/Imagine on packaged custom mains**: `/Applications/Grok.app` never bundled `scripts/official-aux-mcp.mjs`, so ACP injected `mcpServers count=0` while ChatCut still auto-loaded from independent `agent-home/config.toml`. Host now writes the MCP script into `agent-home-official`, disables user MCP `enabled` flags during solo inject, ships official-aux `--rules` on prewarm, and tells the model to call `official-aux__x_keyword_search` directly instead of `search_tool` (which was resolving to ChatCut).

**中文 · 修复**
- **Windows 权限卡点击无响应（#878, #880）**：预览区曾渲染整段 ACP JSON；浮动输入区 `pointer-events: none` 且权限卡未标 `no-drag`，WebView2 会把点击当成拖窗口。现显示真实命令，按钮可点，失败写在卡片上。
- **Windows 回退确认窗关不掉（#879, #880）**：错误 toast 被挡在遮罩下。toast 提到 overlay 之上；失败写在弹窗里；打开确认时关掉时间线。
- **长会话上下滚动卡死（#881, #882）**：浏览历史时 overscan 下限 4800px，一甩挂太多 markdown。现按行数缩小浏览 overscan，钉在底部的窗口不变。
- **手机镜像同一局域网访问（#875）**：主机原先只绑 `127.0.0.1`，把链接换成局域网 IP 会 `ERR_CONNECTION_REFUSED`。默认仍是回环。开启 **允许同一 Wi-Fi**（应用内确认）后改绑 `0.0.0.0`，复制/二维码使用探测到的局域网 IPv4。隧道失败时的文案不再暗示「换成局域网 IP 就能用」。
- **Windows PTY clippy**：`PtySession.pid` 仅 Unix 用于进程组 SIGKILL；Windows 仍走 `ChildKiller`，CI `-D warnings` 不再红。
- **展开侧栏避开 macOS 交通灯**：侧栏隐藏或 overlay 时，共享顶栏使用 `--titlebar-safe-left` 内边距。
- **企微 webhook 重放窗口**：`timestamp` 超出 ±300 秒的已签名回调返回 401。
- **企微 webhook loopback 提示**：未开启 `allow_external` 且绑在 127.0.0.1 时，运行状态与设置页提示「公网回调需开启 allow_external」。
- **CLI 会话导入项目路径**：按相对 home 深度 ≥ 2 判断，不再把 Linux `/home/name/projects` 或 Windows `C:\Users\name\Documents` 当成项目；取不到 home 则拒绝。
- **主题切换快照上限**：DOM 超过 400 个元素时跳过 WebKit 颜色快照，避免大树卡帧。
- **关闭终端会真正杀掉 shell**：标签 × / 关闭全部 / 超出上限 / 切换项目都会走宿主 `terminal_pty_kill`（杀进程 + 关掉 PTY），不是只藏标签。收起面板仍保留会话。
- **底部终端标签序号跟随创建顺序**：加号把新标签加到右边，原来的「终端 1」不会被挤成「终端 2」。
- **终端提示符内边距**：侧栏和底部 PTY 文字距面板 5px。50% 遮罩仍铺满整个终端，内边距加在 `.xterm` 上，不加在外壳。
- **新建会话打开侧栏显示可选菜单，而不是计划**：不再把未使用的 `planFocusKey` 0 当成一次聚焦，新对话打开右侧栏会看到种类菜单，而不是空的计划页签。
- **侧栏计划空状态在面板内居中**：计划作为侧栏页签打开时，标题 / 说明 / 计划历史不再落在左侧 28rem 窄列里。
- **「上下文已自动压缩」卡片留在压缩发生的时间点（#855）**：回合中压缩会冻结当前助手气泡、插入横幅，再在下方继续流式输出，后续工具不再堆到输入框上方。
- **Agent 新建文件后右侧文件树自动刷新（#863）**：保持展开状态，按会话写入路径重列根目录与已展开文件夹，不用关面板再开。
- **长对话滑过「Worked for …」和抬手时不再卡顿（#853）**：#842 的后续。视口已被覆盖时的窗口扩张走后台提交，每帧最多挂 3 行；折叠的 tool 步骤在展开前不算 `toolExpandBody`；settle 用速度 + 160ms 静止下限，触控板抬手不再被当成停下；滑动中关掉 hover；贴底 snap 恢复 commit 前的离底距离，扩张 overscan 时不再弹跳。
- **企微 webhook 鉴权 + ACL 默认拒绝（#851）**：webhook 必须填 `callback_token` 并验签；空 `allowFrom` 拒绝全部（显式 `*` 才开放）；默认只绑 loopback。
- **设置页签/胶囊切换不再闪（#856）**：公共 `SegmentedControl`；首次挂载不纵向展开。
- **新对话欢迎动画 + 外观开关（#857）**：恢复入场节奏；欢迎动画默认开、可关。
- **侧栏开合动效稳定（#858）**：宽窗侧栏与主区连续移动；标题栏安全边距不再回弹红绿灯。
- **壁纸下设置舞台毛玻璃（#859）**：`app-settings-stage` 使用 glass blur。
- **深浅主题切换保持侧栏模糊（#860）**：非 WebKit 用 View Transition；WebKit 用颜色 WAAPI。
- **宠物身体外缘白边消除（#861）**：同色描边盖住抗锯齿缝。
- **有聊天记录后输入框与阅读宽度一致**：会话产生内容后，浮动输入框（及权限条）跟随设置 → 外观的聊天宽度（`--chat-width-max`）。新建/空会话欢迎态仍用原来的 `42rem` 输入框宽度。
- **侧栏「其他会话」不再被空项目区顶到最下面**：收起全部项目（或长会话列表变短）后，L1 项目区会按剩余行高回缩，而不再锁在上次展开的像素高度。
- **侧栏项目区顶部图标**：箭头+空间名展开/收起整个项目区；切换空间是独立按钮，和折叠/更多一样只在该行 hover 时出现；折叠全部仍留在外面；多选、按时间归档、添加项目收进 ⋯ 菜单。
- **打包后自定义主模型的官方 X/画图注入**：正式版 App 找不到 `official-aux-mcp.mjs`，ACP 注入空 MCP，ChatCut 仍从独立 `agent-home/config.toml` 自动拉起。现将脚本写入 `agent-home-official`，solo inject 时关掉用户 MCP 的 `enabled`，预热进程带上官方 `--rules`，并要求模型直接调用 `official-aux__x_keyword_search` 而不是 `search_tool`（后者会命中 ChatCut）。

## [0.2.25] - 2026-08-23

> **Highlight:** Desktop pet mirrors on the right of the screen and no longer wakes the workbench; appearance packs; long chats, files, and Settings stay full-window and responsive; Windows caption/titlebar geometry is honest.
>
> **中文 · 亮点：** 桌面宠物在屏幕右侧水平镜像且按下不再唤醒主窗；外观包；长对话、文件树和设置页铺满且更跟手；Windows 标题栏/最大化几何正确。

### Added
- **Windows `install-latest.cmd`**: with Node / pnpm / Rust / VS Build Tools, double-click to fast-forward `origin/main` and silently install an unsigned side-by-side **grok-app-latest** under `%LOCALAPPDATA%\grok-app-latest`. Does not replace official **Grok**. For people waiting on the next GitHub Release; not a signed production build (`docs/BUILD.md`).
- **Appearance packs (.grokskin)**: Settings → Appearance can save, import, and export the current skin + wallpaper + crop + clip + overlay. Apply always confirms first. `grok://` and `.grokskin` files write a pending import and never auto-apply. Export bakes the visible wallpaper crop (video uses system ffmpeg when present).
- **Custom provider extra request headers (#812)**: Settings → Account → Providers can add key/value HTTP headers. They write Grok Build `extra_headers` on `[model.<id>]` (sent verbatim). Use for AgentRouter / AnyRouter WAF (`User-Agent`, `Originator`) or Anthropic `x-api-key`. Empty list omits the field.
- **OpenRouter provider preset**: Add-provider gallery one-click fill — `https://openrouter.ai/api/v1` with **chat_completions**, model **`stealth/ox-alpha`** (Ox Alpha), Grok-style effort `low`/`medium`/`high`/`max` (default medium), vision on, 1 048 576 context, and the OpenRouter mark (purple `#7624F4` in light theme, ink in dark). Get API Key opens https://openrouter.ai/settings/keys. Existing auto-suffixed ids such as `openrouter-----…` resolve the same channel.
- **Optional Windows taskbar overlay for unread sessions** (#775): Settings → General → App toggle, **off by default**, independent of the dock/tray unread badge. When on, the host paints 1–9 / 10+ via `set_overlay_icon` (Tauri `set_badge_count` is a no-op on Windows). Hide-to-tray restore re-applies the last overlay count after Explorer AddTab.
- **Shortcuts help (Ctrl+/)**: the overlay now searches by label / id / chord, groups like Settings → Keyboard, and lists zoom, newline, prompt history, and type-to-focus. The list scrolls instead of clipping the last rows.

**中文 · 新增**
- **Windows `install-latest.cmd`**：已有 Node / pnpm / Rust / VS Build Tools 时可双击，把 `origin/main` fast-forward 后静默安装一份未签名的并排 **grok-app-latest**（`%LOCALAPPDATA%\grok-app-latest`），不覆盖正式版 **Grok**。给等不及下一版 GitHub Release 的人用，不是签名生产包（`docs/BUILD.md`）。
- **外观包（.grokskin）**：设置 → 外观可保存/导入/导出当前皮肤 + 壁纸 + 裁切 + 片段 + 遮罩。套用前必须确认。`grok://` 和 `.grokskin` 只写入待导入槽，从不静默套用。导出按当前窗口可见区域烘焙壁纸（视频在本机有 ffmpeg 时裁切）。
- **自定义提供商可填额外请求头（#812）**：设置 → 账号 → 提供商可添加键/值 HTTP 头，写入 Grok Build `[model.<id>].extra_headers`（推理请求原样发送）。用于 AgentRouter / AnyRouter 校验 `User-Agent` / `Originator`，或 Anthropic 的 `x-api-key`。空列表不写该字段。
- **OpenRouter 服务商预设**：添加提供商图库一键填入 `https://openrouter.ai/api/v1`（chat_completions）、模型 **`stealth/ox-alpha`**（Ox Alpha）、思考档 `low`/`medium`/`high`/`max`（默认 medium）、开启视觉、上下文 1 048 576，并带 OpenRouter 标（浅色主题紫色 `#7624F4`，深色跟当前文字色）。获取 Key 打开 https://openrouter.ai/settings/keys。本地已有带随机后缀的 `openrouter-----…` 仍识别为同一渠道。
- **可选 Windows 任务栏未读 overlay**（#775）：设置 → 通用 → 应用里开关，**默认关闭**，与程序坞/托盘未读角标互不绑定。开启后 Host 用 `set_overlay_icon` 画 1–9 / 10+（Tauri 的 `set_badge_count` 在 Windows 上是空操作）。从托盘还原时按上次 overlay 计数在 Explorer AddTab 后再贴一次。
- **快捷键帮助（Ctrl+/）**：面板可按名称 / id / 组合键筛选，按设置页同样的分组列出；补上缩放、换行、历史提示、打字聚焦；列表可滚动，不再裁掉末尾几项。

### Changed
- **Code-quality gates measure App shell + AppWorkbench**: `APP_*` budgets sum `src/App.tsx` and `src/app/AppWorkbench.tsx` (decreasing ceilings from current combined size). The 26-line shell no longer vacuously passes the old 6000-line bar. Fake `shellEpoch` state in `App.tsx` is gone.
- **Workbench pane open/close/resize lives in `useWorkbenchLayout`**: sidebar/aside fit, overlay grow, and splitter drag persist inside the layout hook. AppWorkbench keeps verbs (`openAsidePane`, `beginSidebarResize`, …).
- **Command palette search lives in `useSearchPalette`**: open/query/filters, journal scan, and keyboard nav persist inside the hook. AppWorkbench keeps action dispatch (`runPaletteAction`) and session open.
- **Session export/share lives in `useSessionExportText` / `useSessionExportImage`**: markdown modal, file formats, traces, and PNG share-card preview/skin persist in those hooks. AppWorkbench keeps menu labels and modal JSX.
- **Sandbox wizard and reliability center chrome live in `useSandboxReliability`**: offer/dismiss persistence and stall/error rings sit in the hook. Profile apply and the reliability view memo stay on the host.
- **Session catalog lives in `useSessionCatalog`**: sidebar list refresh, `sessions://changed` fanout, and multi-select persist in the hook. AppWorkbench keeps open/new-chat and archived grouping.
- **Sidebar session tree lives in `WorkbenchSessionTree`**: project/orphan paint and the multi-select bar. Open/new-chat stay on the host.
- **Left workbench rail lives in `WorkbenchSidebar`**: chrome, primary nav, and user footer. The session tree is a child; open/new-chat stay on the host.
- **Center workbench chrome lives in `WorkbenchMain`**: title row, toast, drop overlay, and top actions. Chat / kanban / automations stay as children.
- **Resources pane lives in `WorkbenchResourcesAside`**: resize handle and SideWorkbench. Skill insert stays on the host.
- **Search / export / sandbox / reliability overlays live in `WorkbenchDomainOverlays`**: those domain hooks already own state; AppWorkbench keeps session-open and sandbox profile apply.
- **Thousand-line file budget is 69**: domain CSS parts, session/contextUsage tests, stall-history module, and Remote IM channel catalog are split so `files_ge_1000` sits under 70.
- **Desktop pet on the right is a horizontal mirror**: Bottom-left keeps the authored ¾-right face. On the right half of the **screen work area** the mark is `scaleX(-1)` so the eyes look toward centre. Position comes from the overlay window (not `window.screenX`, which is 0 in the pet webview). The flip follows while dragging.
- **macOS workbench sidebar uses the same frost as Settings**: Left rail (sessions + Settings nav) applies `--sidebar-blur` backdrop-filter instead of relying on native vibrancy alone. Settings is available before first navigation and swaps atomically with the workbench; the account portal closes in the same commit. Settings nav width follows the workbench rail. The glass meets the chat column with no opaque black seam. Returning keeps the workbench painted instead of hiding Settings for 320ms and leaving only the wallpaper in WKWebView.
- **macOS sidebar right edge no longer flashes while dragging**: The seam is an inset hairline on the solid chat column, not a 1px layout border on Sidebar vibrancy. Window drag and split resize no longer alias that pixel light/dark.
- **Chat transcript scroll no longer thrashes layout on mounted rows**: Virtual rows share a single `ResizeObserver` and measure via `borderBoxSize` instead of synchronous `getBoundingClientRect()` on mount; code block line-wrap/number preferences use in-memory caches to avoid blocking `localStorage` reads; right-edge message node rail uses memoized node IDs and skips redundant tick scrolls.
- **UI font and terminal font are local-font dropdowns**: Settings → Appearance lists installed families (searchable) instead of a free-text name. UI default is the app sans stack; terminal default is the built-in Nerd Font stack. Reset is unchanged.
- **Debug dock icon is the white invert**: `pnpm dev` uses `src-tauri/icons/dev` (white plate, dark mark) so the running debug app is distinct from the installed black production icon. Release bundles are unchanged.
- **Windows AUMID follows the bundled identifier**: `pnpm dev` (`com.grokapp.desktop.dev`) is no longer grouped with official Grok on the taskbar / WinRT toasts. Release stays `com.grokapp.desktop`. Sessions still share App data unless `GROK_APP_HOME` is set.
- **Resource markdown preview windows long files**: Side-pane `.md` keeps short files as one tree. Files at 200+ lines split on headings (and length caps) and only mount visible sections, instead of ReactMarkdown for the whole buffer.
- **In-chat find stays off the workbench shell**: Ctrl+F match scanning and stream ticks live in the find bar / transcript island. Opening or closing find still toggles the shell; typing and token growth do not.
- **Files tree windows long listings**: Side-pane / resource trees keep short folders as a full list. At 32+ visible rows, only the viewport is mounted (28px rows), instead of recursively mapping every expanded entry.
- **L/R splitter drag no longer re-renders the workbench every move**: In-flow sidebar / aside width is written on the pane element while the pointer is down. Layout prefs commit on pointer-up. Dragging the left rail past the open min still collapses live.
- **Bottom terminal toggle snaps height**: Ctrl+` jumps between 0 and the last panel height. The chat column is not interpolated for 320ms, so a long transcript does not reflow on every open/close. Drag-resize and persist-mounted PTY are unchanged.
- **Chat code line numbers are one text node**: Fences with line numbers on keep a single gutter (`1\n2\n…`) instead of one React node per source line, so a 5000-line streamed/pasted block no longer mounts thousands of spans.
- **Wide windows toggle side panes instantly; narrow windows overlay them**: Ctrl+B / Ctrl+Alt+B no longer interpolate flex width against the chat column. When sidebar + chat + aside fit, the split snaps with no animation. When they would crush chat, the pane overlays with a transform and the OS window does not grow.
- **Resource code preview windows long files**: Side-pane / Changes `CodePreview` keeps short files as a full list. Files at 200+ lines (including 5000-line sources) only mount the visible rows and highlight those lines, instead of highlight.js + one DOM node per line for the whole file.
- **Permission countdown, git dirty chip, and Tasks liveMap stay off the workbench shell**: Auto-deny seconds tick inside the permission bar. Git chip setState runs only when the count/label change. The Tasks panel subscribes to liveMap itself. ConversationThreadLive is memoized with stable callbacks.
- **Pet overlay does not parse the workbench**: `#/pet` `import()`s `PetApp`; the main window `import()`s `App`.
- **Clippy is deny-warnings on all CI legs (#829)**: `cargo clippy --all-targets -- -D warnings` now gates Linux / macOS / Windows. Platform-cfg dead code, mechanical style, and skin-share follow-up lints restore a green gate; no product behavior change.
- **Clippy is silent on macOS host builds again (#785)**: Windows-only overlay/WSL/shim items use the existing `cfg_attr(not(windows), allow(dead_code))` idiom so cross-platform tests stay; mechanical style lints and Tauri `too_many_arguments` allows restore zero `cargo clippy --all-targets` warnings without behavior change.
- **Locale catalogs load on demand**: English stays in the main bundle. The other 14 languages `import()` when selected; UI falls back to English until that chunk arrives.
- **Heavy surfaces leave first paint**: Bottom terminal (xterm) mounts after first open; project-rules TipTap and the image lightbox load on demand.
- **Live tool title rows keep activity VirtualList**: Only streaming thought bodies (variable height) drop windowing. Running 36px tool titles no longer dump the whole step list into the DOM.
- **Weaving tools no longer clones every chat row**: History message object identity is kept so memoized transcript rows survive stream ticks. Row memo no longer busts on a new `wovenMessages` array.
- **Completed tool journal writes leave the ACP pump**: `load_messages` / `save_messages` for finished tools run on `spawn_blocking` so disk IO does not stall later stream tokens.
- **PTY output is coalesced**: `terminal://data` flushes every 16ms or 4KiB instead of one IPC per 8KiB OS read.
- **Pet cursor watch idles when hidden**: Overlay pointer polling stays ~64ms while visible or dragging, and sleeps 500ms when the pet is hidden or disabled.
- **Session journals write compact JSON**: `messages.json` mid-stream flushes rewrite the whole file; pretty-print indent was extra disk/CPU on long chats. Existing pretty files still load.
- **Stream-perf actually drops wallpaper GPU cost**: `html[data-stream-perf="1"]` now turns off wallpaper sidebar/settings blur and pauses wallpaper video for the live turn (the flag already existed; CSS/JS did not honor it).
- **Streaming markdown keeps a stable ReactMarkdown component map**: `remarkPlugins` and leaf tags are module-level; path/code/img handlers memoize so a token tick does not remount the tree.
- **Streamdown CSS no longer loads at boot**: Chat uses `MarkdownChat`, not Streamdown. Styles move onto the unused `MessageResponse` module so a later import still looks right.
- **Vendor JS split for markdown / TipTap / xterm**: Vite emits separate chunks so those stacks can cache independently of the app shell (and drop off first paint once their call sites are lazy).
- **README refresh for the current workbench**: Public README (en / zh / ru) now leads with Highlights + grouped capabilities — 15 locales, desktop pet, Remote IM + phone mirror, local session API, Imagine / ChatCut, Kanban / Project Spaces, Grok 4.6 Extra High, custom-provider presets — instead of the early session-and-preview feature table. Install, Gatekeeper, and Linux troubleshooting stay.
- **DeepSeek preset adds V4 Flash Vision Exp**: The add-provider catalog now includes `deepseek-v4-flash-vision-exp` alongside Flash and Pro. Existing saved DeepSeek channels are unchanged until re-added or edited.
- **Official site on GitHub About and README**: Repo homepage, `package.json` `homepage`, and public READMEs now point to [https://grok-app.com](https://grok-app.com) (no trailing slash).

**中文 · 变更**
- **代码质量闸门改为度量 App shell + AppWorkbench**：`APP_*` 预算合计 `src/App.tsx` 与 `src/app/AppWorkbench.tsx`（从当前合计规模起递减天花板）。26 行 shell 不再让旧的 6000 行门槛空过。`App.tsx` 里的假 `shellEpoch` state 已删。
- **工作台左右栏开关/拖拽收进 `useWorkbenchLayout`**：开合、窗口适配、分割条拖拽在 layout hook 内持久化。AppWorkbench 只留动词方法。
- **命令面板搜索收进 `useSearchPalette`**：开合/查询/筛选、journal 扫描、键盘导航在 hook 内持久化。AppWorkbench 只留动作分发（`runPaletteAction`）和打开会话。
- **会话导出/分享卡收进 `useSessionExportText` / `useSessionExportImage`**：Markdown 弹层、文件格式、trace、PNG 分享卡预览/皮肤在 hook 内持久化。AppWorkbench 只留菜单文案和弹层 JSX。
- **沙箱向导和可靠性中心收进 `useSandboxReliability`**：向导出现/不再提示、stall/error 环在 hook 内。档位套用和 reliability view 计算仍在宿主。
- **会话目录收进 `useSessionCatalog`**：侧栏列表刷新、`sessions://changed` 同步、多选在 hook 内。AppWorkbench 只留打开/新建会话和归档分组。
- **侧栏会话树收进 `WorkbenchSessionTree`**：项目/无归属会话绘制和多选条。打开/新建会话仍在宿主。
- **左栏收进 `WorkbenchSidebar`**：chrome、主导航、用户菜单。会话树是子节点；打开/新建会话仍在宿主。
- **中栏 chrome 收进 `WorkbenchMain`**：标题、toast、拖放层、顶栏动作。对话 / 看板 / 自动化仍是子节点。
- **右栏收进 `WorkbenchResourcesAside`**：拖拽条和 SideWorkbench。插入 skill 仍在宿主。
- **搜索/导出/沙箱/可靠性弹层收进 `WorkbenchDomainOverlays`**：域 hook 已自持状态；宿主只留打开会话和套用沙箱档。
- **千行文件预算改为 69**：CSS part、session/contextUsage 测试、stall history、Remote IM 渠道目录拆开，`files_ge_1000` 降到 70 以下。
- **桌面宠物在屏幕右半边水平镜像**：左侧仍是原来的 ¾ 右视脸。到屏幕工作区右半边时整只 `scaleX(-1)`。位置用宠物窗口坐标（不用 `window.screenX`，浮层 WebView 里经常是 0）。拖动过程中跟着翻。
- **macOS 主页面侧栏与设置导航同一套毛玻璃**：会话列表和设置左栏都用 `--sidebar-blur` 的 backdrop-filter，不再只靠系统 vibrancy。设置页在首次导航前就已可用，并与工作台原子切换；账户菜单浮层在同一次提交中收起。设置左栏宽度跟工作台侧栏走，玻璃接到聊天列不再夹实色黑边。返回时工作台始终保持已绘制，不再先隐藏设置层并等待 320ms、让 WKWebView 只剩壁纸。
- **macOS 侧栏右缘拖动不再明暗闪烁**：分割线画在实色聊天列上，不再用 Sidebar 毛玻璃上的 1px layout 边框。拖窗口和拖分割条时那一像素不会再在亮/暗之间跳。
- **长对话滚动消除挂载重排与同步存储阻塞**：虚拟列表改用单个共享 `ResizeObserver` 并通过 `borderBoxSize` 获取高度，消除新行挂载时的 `getBoundingClientRect()` 强制同步重排（Layout Thrashing）；代码块换行与行号偏好使用内存缓存，避免挂载时同步读取 `localStorage` 阻塞主线程；右侧消息节点轴缓存节点 ID 集合并在可视范围内跳过冗余滚动。
- **界面字体和终端字体改为本机字体下拉**：设置 → 外观列出本机已安装字体族（可搜索），不再手填名称。界面默认是应用无衬线栈；终端默认是内置 Nerd Font。重置不变。
- **开发版 Dock 图标改白底反色**：`pnpm dev` 使用 `src-tauri/icons/dev`（白底深色标），和已安装的黑底正式版区分。发布包图标不变。
- **Windows AUMID 跟随 bundled identifier**：`pnpm dev`（`com.grokapp.desktop.dev`）不再和正式版抢任务栏分组 / WinRT toast。发布包仍是 `com.grokapp.desktop`。会话/设置仍共用，除非设置 `GROK_APP_HOME`。
- **资源栏 Markdown 对长文件做窗口化**：侧栏 `.md` 短文件仍整树渲染。200 行以上按标题（及长度上限）切块，只挂可见节，不再对整份 buffer 跑 ReactMarkdown。
- **对话内查找不再打穿工作台**：Ctrl+F 的匹配和流式跳动留在找条 / 对话岛。开关查找仍会切壳；打字和 token 增长不会。
- **文件树对长列表做窗口化**：侧栏 / 资源树短目录仍整表渲染。可见行达到 32 以上只挂视口（28px 行高），不再递归把每个展开节点打进 DOM。
- **拖左右分割条不再每帧重绘工作台**：按住时只改侧栏/右栏元素宽度；松手才写入 layout。左栏拖过最小宽度仍即时收起。
- **底栏终端开关改为瞬时高度**：Ctrl+` 在 0 和上次高度之间直接跳。聊天列不再插值 320ms，长对话不会每次开关都重排。拖高度和常驻 PTY 不变。
- **聊天代码行号改成一个文本节点**：开启行号时 gutter 是一份 `1\n2\n…`，不再一行一个 React 节点；流式/粘贴的 5000 行代码块不会再挂几千个 span。
- **宽窗瞬时切换侧栏，窄窗改为覆盖层**：Ctrl+B / Ctrl+Alt+B 不再用 flex 宽度去挤聊天列。侧栏 + 聊天 + 右栏能放下时无动画直接切分；会压到聊天时改为 overlay + transform，也不再拉大系统窗口。
- **资源栏代码预览对长文件做窗口化**：侧栏 / Changes 的 `CodePreview` 短文件仍整表渲染。200 行以上（含 5000 行源文件）只挂可见行并高亮这些行，不再对整文件跑 highlight.js、也不再一行一个 DOM 节点。
- **权限倒计时、git 脏文件芯片和 Tasks liveMap 不再打穿工作台**：自动拒绝秒数在权限条内部跳动。git 芯片只在条数/文案变化时 setState。Tasks 面板自己订阅 liveMap。ConversationThreadLive 带稳定回调并 memo。
- **宠物浮层不再解析工作台**：`#/pet` 动态加载 `PetApp`；主窗口动态加载 `App`。
- **CI 全平台 clippy 改为 deny warnings（#829）**：Linux / macOS / Windows 均以 `cargo clippy --all-targets -- -D warnings` 过门。平台条件死代码、机械风格和皮肤包后续 lint 清干净，无产品行为变化。
- **macOS 上 clippy 再次零警告（#785）**：Windows 专用 overlay/WSL/shim 用既有 `cfg_attr(not(windows), allow(dead_code))`，跨平台测试仍跑；机械风格与 Tauri `too_many_arguments` allow 恢复 `cargo clippy --all-targets` 零警告，无行为变化。
- **语言包按需加载**：主包只带英文。另外 14 种语言选中后再 `import()`；chunk 到达前界面先用英文。
- **重表面离开首屏**：底栏终端（xterm）第一次打开才挂载；项目规则 TipTap 和图片灯箱按需加载。
- **进行中的 tool 标题行仍走活动列表虚拟化**：只有流式 thought（变高）才关掉窗口化；36px 的 running tool 不再把整表打进 DOM。
- **织入 tool 不再克隆整份 transcript**：历史消息保持同一对象引用，流式时 memo 行能活下来；行比较也不再被新的 `wovenMessages` 数组打穿。
- **完成态 tool journal 不再堵 ACP 泵**：落盘改 `spawn_blocking`，磁盘 IO 不再挡住后续 token。
- **终端 PTY 输出合并发送**：`terminal://data` 每 16ms 或满 4KiB 再发，不再每次 OS read（8KiB）打一次 IPC。
- **桌宠隐藏时降低光标轮询**：可见或拖动时仍约 64ms；隐藏/关闭时睡 500ms。
- **会话 journal 改写紧凑 JSON**：流式落盘会重写整份 `messages.json`，pretty 缩进在长对话上白烧磁盘。旧的 pretty 文件仍能读。
- **流式性能模式真正减壁纸 GPU**：`html[data-stream-perf="1"]` 会关掉壁纸侧栏/设置毛玻璃，并暂停壁纸视频（旗标早就有，CSS/JS 之前没接上）。
- **流式 markdown 不再每跳一次 token 换一套 components**：`remarkPlugins` 和叶子标签提到模块级；路径/代码/图片处理器 memo，避免 ReactMarkdown 整树重挂。
- **启动不再加载 Streamdown CSS**：聊天走 `MarkdownChat`，不走 Streamdown。样式挪到未接入的 `MessageResponse`，以后真用到时才会带上。
- **markdown / TipTap / xterm 拆成独立 JS chunk**：Vite 单独打包这三坨，壳改动不再带着重库一起失效；后续 lazy 后它们可以离开首屏。
- **README 按当前工作台重装**：公开 README（英 / 中 / 俄）改为亮点 + 分组能力：十五种语言、桌面宠物、远程 IM + 手机镜像、本机会话接口、Imagine / ChatCut、看板 / 项目空间、Grok 4.6 极高、自定义提供商预设；不再沿用早期「会话 + 预览」功能表。安装、Gatekeeper、Linux 排障保留。
- **DeepSeek 预设增加 V4 Flash Vision Exp**：添加提供商目录现含 `deepseek-v4-flash-vision-exp`，与 Flash / Pro 并列。已保存的 DeepSeek 渠道不会自动改，直到重新添加或编辑。
- **仓库 About 与 README 挂上官网**：GitHub 仓库网站、`package.json` `homepage` 与各语言 README 现指向 [https://grok-app.com](https://grok-app.com)（无末尾斜杠）。

### Fixed
- **Desktop pet press no longer wakes the workbench**: Dragging or single-clicking the mark only moves it / plays an emote. Double-click opens the main window (or the focused session). The overlay no longer yields key to main on pointer-down, and on macOS it opts out of app activation so a pet press cannot raise a background or hidden workbench.
- **macOS launch can type and use shortcuts without a first click**: After `show()`, the Host reasserts key/activation once the page has loaded, retries briefly if NSApp stayed inactive while the window claimed key, and points firstResponder at the WKWebView so ⌘, and other web shortcuts reach the DOM.
- **Settings covers the window with wallpaper on (#846)**: Wallpaper chrome lift no longer forces `position: relative` on the settings overlay. Short tabs (Pet, Archived chats) were shrinking to content height, so wallpaper (and the desktop pet) showed in the leftover strip.
- **Agent questionnaire no longer freezes the workbench (#844)**: Answering or dismissing `_x.ai/ask_user_question` used to wait on the Host IPC with every control disabled. The modal now closes first and restores only if a failed accept is still the live request. Portaled overlays also opt out of the window-drag region so macOS titlebar drag cannot swallow clicks.
- **Windows titlebar drag-up no longer grows height (#786)**: Follow-up to #783/#784. Caption maximize stayed up, but dragging the titlebar still stretched the frame. Windows skips JS `start_dragging` (`data-tauri-drag-region="false"`) and keeps compositor caption drag. Host `set_min_size` no longer runs on every `Moved` (tao re-applies inner size and double-counts the shadow offset); it skips while maximized, while the pointer is down, and when the min is unchanged.
- **Desktop pet stays the chosen body, celebrates once, and no longer stalls on Windows**: Typing and in-progress tools no longer morph the mark into the catalog `!` or orbit/comet ribbons — the rest shape stays, with an attentive/curious face. Colorful belts fire only when the last live turn becomes unread-ready, then a corner pastille. Overlay paint throttles after idle, pauses while hidden, and cursor look events stay on the pet window (no duplicate still-cursor wakeups) so a long-running Windows overlay no longer freezes until restart.
- **Windows caption maximize stays maximized; titlebar drag moves the window (#783)**: Follow-up to #773/#774. The button defers `maximize()` until after mouse-up so Aero does not drag-to-restore (flash). The `body` visualViewport transform pin is gone — it broke `-webkit-app-region: drag`, so pulling the titlebar up north-resized (bottom never lifted). An 8px top no-drag strip keeps native HTTOP.
- **Windows maximize button is a real maximize (#773)**: The caption square used a Linux work-area `setSize` fill when `isMaximized()` lagged ~40ms. That cancelled the OS maximize, left the glyph as a square, and after restore, dragging the top edge panned the WebView inside the frame. Windows now waits for the OS flag and never fakes geometry; the button switches to the restore glyph.
- **In-app update waits for Install and restart (#777)**: Settings → About Check for updates only checks and downloads. Sidebar and Install and restart open an in-app confirm (version + restart) before install+relaunch. Cancel does nothing. Unsigned GitHub download is unchanged.
- **Windows dark-taskbar tray is a white glyph, not a white square (#776)**: Follow-up to #747/#748, not a revert of the invisibility fix. Light taskbars keep the black rounded tile + white glyph. Dark taskbars drop the white fill and show a white Grok mark on transparency. The host still follows `SystemUsesLightTheme` (not the in-app theme) and does not restore black-on-transparent.
- **Slow trackpad scroll-up can leave stick-to-bottom (#778)**: Pixel-mode wheels send 2–8px ticks, so a single 10px event never unpinned. Release once the viewport is 10px off the bottom, even across ticks, and do not snap the virtual list back after the user has left.
- **Long chats no longer bounce up while images/PDF previews decode (#771)**: Per-row pinned snaps are gone. Media-sized height jumps coalesce to one follow instead of one per file.
- **Win+Right snap is true half on short displays (#765)**: Comfort `minWidth` stays 900. The Host caps the OS min to half the current monitor work area (height too), so a 1440×900 work area snaps to 720 instead of sticking at 900 (~2/3). A larger display restores the 900 floor.
- **Windows Alt+Tab can type without a click first (#768)**: Tauri `unstable` (side-browser multi-webview) builds the page as a child `WRY_WEBVIEW`, so Alt-Tab / taskbar only activates the outer HWND. The host now forwards `WM_SETFOCUS` / `WM_ACTIVATE` into that child so composer and shortcuts work immediately.

**中文 · 修复**
- **按下桌面宠物不再唤醒主窗口**：拖动或单击标记只移动 / 做表情；双击才打开主窗口（或聚焦当前会话）。浮层在按下时不再把键盘焦点交回主窗口；macOS 上宠物窗选择不激活应用，避免后台或已隐藏的工作台被带起来。
- **macOS 启动后不用先点一下就能打字和用快捷键**：`show()` 之后等页面加载完再确认一次键盘焦点/激活；若窗口已是 key 但 NSApp 仍 inactive，短重试几次；并把 firstResponder 指到 WKWebView，让 ⌘, 等网页快捷键进 DOM。
- **有壁纸时设置页铺满窗口（#846）**：壁纸层级提升不再给设置 overlay 强制 `position: relative`。内容短的页（宠物、归档对话）以前按内容高度收缩，壁纸和桌面宠物会从底下露出来。
- **Agent 提问弹窗不再卡住工作台（#844）**：回答或忽略 `_x.ai/ask_user_question` 以前会等 Host IPC，期间所有按钮都禁用。现在先关弹窗，只有失败的接受且仍是当前请求时才恢复。浮层也退出窗口拖动区，避免 macOS 标题栏拖动吞掉点击。
- **Windows 标题栏往上拖不再把窗口拉高（#786）**：#783/#784 的后续。最大化能站住，但拖标题栏仍会拉长窗口。Windows 关掉 JS `start_dragging`（`data-tauri-drag-region="false"`），保留 compositor 标题栏拖动。`set_min_size` 不再在每次 `Moved` 里重设客户区（tao 会把阴影边框加两次）；最大化、按住鼠标、min 没变时都跳过。
- **桌面宠物以本体为主、只在全部完成时撒彩带，Windows 长跑不再卡死**：打字和工具进行中不再把标记变成感叹号或轨道/彗星彩带，始终显示所选形体（专注/好奇脸）。彩带只在最后一个进行中的回合变成未读完成时播一次，然后右上角亮未读小圆点。空闲后降低绘制频率、隐藏时暂停，光标看向事件只发给宠物窗且静止不再重复唤醒，避免 Windows 透明浮层用久了卡顿卡死、重启才恢复。
- **Windows 点最大化不再闪回，标题栏往上拖是移动窗口（#783）**：#773/#774 的后续。最大化推迟到鼠标松开之后，避免 Aero 当成拖拽立刻还原。去掉会破坏标题栏拖动的 `body` transform；顶边留 8px 非拖动带，标题栏中部往上拖会把整窗抬起来，不再把下沿无限拉高。
- **Windows 右上角最大化是系统最大化（#773）**：按钮在 `isMaximized()` 还没跟上时会走 Linux 的铺满工作区 `setSize`，把真正的最大化取消掉，图标也不变；还原后再从上沿往下拉，页面会在窗口里往下挪。Windows 现在等系统标志、不再假铺满，按钮换成还原图标。
- **应用内更新须确认「安装并重启」（#777）**：设置 → 关于「检查更新」只检查和下载。侧栏与「安装并重启」会先弹出应用内确认（版本 + 即将重启），取消不安装。未签名的 GitHub 下载路径不变。
- **Windows 深色任务栏托盘改为白标透明底，不再是白方块（#776）**：#747/#748 的后续，不是撤回可见性修复。浅色任务栏仍是黑底圆角块 + 白标；深色任务栏去掉白色填充，只用透明底上的白色 Grok 标。仍跟任务栏 `SystemUsesLightTheme`，不跟应用内主题；也不会退回深色栏上看不见的黑标。
- **触控板慢慢往上滚能离开贴底锁（#778）**：像素模式滚轮每次只有 2–8px，单次 10px 永远松不开。离开底部累计 10px 就放锁，虚拟列表不再把你弹回去。
- **长对话里图片/PDF 预览解码时不再往上弹（#771）**：不再在每一行高度变化时贴底；媒体尺寸的高度跳变合并成一次跟随。
- **Win+Right 在矮屏上能贴真正半屏（#765）**：舒适下限仍是 900。Host 把系统 min 限制在当前显示器工作区的一半（高度同样），1440×900 会贴 720 而不是卡在 900（约 2/3）。拖到更大屏后 900 下限会回来。
- **Windows Alt+Tab 后不用先点一下就能打字（#768）**：Tauri `unstable`（资源栏内嵌浏览器）把页面建成子窗口 `WRY_WEBVIEW`，Alt+Tab / 任务栏只激活外层 HWND。Host 现在把 `WM_SETFOCUS` / `WM_ACTIVATE` 转进该子窗口，输入框和快捷键立刻可用。

## [0.2.24] - 2026-08-21

> **Highlight:** Full bloub pet with compact Look/Bubbles settings; fork from an assistant reply; Windows no longer freezes at end of turn; Explorer-file paste and local session API stall are fixed.
>
> **中文 · 亮点：** 宠物换完整 bloub 形变、设置拆成紧凑的外观/气泡；可从助手回复分叉；Windows 回合结束不再卡死；资源管理器文件可粘贴，本地 session API 不再一轮后卡死。

### Added
- **Fork from an assistant reply**: “Fork from here” sits on completed Grok bubbles (not user prompts). The new chat copies through that turn; the child agent is rewound to match (bootstrap fallback if rewind is unavailable).
- **AI98PRO provider preset**: Add-provider gallery ships a one-click Grok relay — `https://ai98pro.xyz/v1` with Responses, models **`grok-4.6`** + **`grok-4.5`**, official effort `low`/`medium`/`high`/`xhigh` (default Extra high), vision on, and config id **`AI98PRO`** (stored slug `ai98pro`). Existing auto-suffixed local ids such as `ai98pro-----…` resolve the same channel.
- **Settings closes with Ctrl+, / Esc (#752)**: Pressing the settings chord again on the Settings page (including in a field) returns to the workbench. Esc does the same, without stopping a background turn. Nested dialogs and Select menus still own Escape first. The account-menu Settings row, slash `/settings`, command-palette settings actions, and “Back to app” show the live chord.
- **Ctrl+Q twice to quit (#743)**: First press toasts; second within 2s exits. Side-terminal Ctrl+Q (XON after Ctrl+S freeze) is not swallowed. macOS tray does not advertise `(Ctrl+Q)` — ⌘Q is still immediate quit; the catalog mac column is `⌃ Q`.
- **Ctrl+Enter steers a live turn (Grok Build CLI chord) (#741)**: While the agent is mid-turn, Ctrl+Enter (Cmd+Enter on macOS too) injects the composer draft via Steer / `sessionInterject`. Empty composer + a queued follow-up steers the head. You no longer have to queue first and click **Steer**. Plain Enter still queues.
- **Pet uses the full bloub morph catalogue**: the overlay now runs the measured SVG engine (idle, thinking, wink, notify, alert, hexagon, orbit, comet, …) instead of the old clip-path faces. Settings pick the 8 rest shapes plus 16 rest expressions. Typing in the composer plays the catalog alert morph (slanted !) and returns to the chosen rest shape after a short pause; unread ready chats show a vivid orange-red pastille (lime on already-hot bodies) rather than the video’s blue.

**中文 · 新增**
- **从助手回复分叉**：「从这里分叉」在已完成的 Grok 气泡上（不再挂用户气泡）。新会话复制到该回合结束；子 Agent 会 rewind 对齐截断历史（rewind 不可用则 journal bootstrap）。
- **AI98PRO 服务商预设**：添加提供商图库一键填入 `https://ai98pro.xyz/v1`（Responses）、**Grok 4.6 / 4.5**、官方思考档 `low`/`medium`/`high`/`xhigh`（默认极高）、开启视觉；配置 ID 为 **AI98PRO**（落盘 slug `ai98pro`）。本地已有带随机后缀的 `ai98pro-----…` 仍识别为同一渠道。
- **设置页再按 Ctrl+, / Esc 回到主窗（#752）**：设置页再按一次设置快捷键（输入框里也能关）走「返回应用」。Esc 同样离开设置，不误停后台生成；嵌套对话框和 Select 仍先处理 Esc。账号菜单 Settings、`/settings`、命令面板设置项、「返回应用」显示当前和弦。
- **Ctrl+Q 连按两次退出（#743）**：第一次提示，2 秒内再按才退出。侧栏终端的 Ctrl+Q（XON，Ctrl+S 冻结后靠它解冻）不吞。macOS 托盘不写 `(Ctrl+Q)`，⌘Q 仍立即退出；目录 mac 列是 `⌃ Q`。
- **Ctrl+Enter 引导当前回合（对标 Grok Build CLI）（#741）**：Agent 正在跑时，Ctrl+Enter（macOS 也认 Cmd+Enter）把输入框里的内容直接 Steer 进当前回合。输入框空、队列里有跟进时引导队首。不用先排队再点「引导」。普通 Enter 仍是排队。
- **宠物换成完整 bloub 形变目录**：浮层改用测过的 SVG 引擎（静止、思考、眨眼、通知、警示、六边形、轨道、彗星等），不再用旧的 clip-path 表情。设置可选 8 种休息形体和 16 种休息表情。输入框打字会走目录里的警示（斜感叹号），停打后回到所选休息形体；未读完成会话是显眼的橙红圆点（身体已经很热时改用柠黄），不再用视频里的蓝色。

### Changed
- **Pet settings use Look / Bubbles tabs**: Settings → Pet no longer stacks appearance and bubble chrome on one long page. Default tab is Look; Bubbles holds the chip toggle, progress bar, auto-hide, and bubble shape/background. `#/settings/pet` still opens Look. Look packs enable + size on one toolbar, with the live preview left of the shape / face / color / eye pickers.
- **Workbench shell split (#757)**: Prefs/layout hooks, GlassModals, compact overlay, in-app dialog host, and command palette live under `workbench-modals/`. Transcript helpers move to `src/lib/session/*` with a stable barrel. Send / open-session / rewind stay in AppWorkbench.

**中文 · 变更**
- **宠物设置拆成「外观设置 / 气泡设置」两个 tab**：默认打开外观；气泡（提示框、进度条、自动关闭、形状/背景）单独一页。旧链 `#/settings/pet` 仍落到外观。外观 tab 把开关和尺寸收进顶栏一行，预览在左、形体/表情/颜色/眼睛在右，减少纵向高度。
- **工作台外壳拆分（#757）**：偏好/布局 hook、GlassModal、紧凑浮层、应用内对话框、命令面板进 `workbench-modals/`；会话 transcript 助手进 `src/lib/session/*`（barrel 保持 `@/lib/session`）。发送 / 打开会话 / rewind 仍在 AppWorkbench。

### Fixed
- **Windows Host builds again after Explorer-file paste (#763)**: `clipboard-win` 5.4’s `FileList` implements `Getter` for both `Vec<String>` and `Vec<PathBuf>`, so rustc could not infer `get_clipboard` (`E0282`). Name `Vec<String>` explicitly. Follow-up to #756.
- **Desktop pet remembers its last place after quit**: Drag origin is flushed on pointer-up, hide, and process exit. A stuck OS-drag flag can no longer persist 0,0 while hiding. Settings writes keep the live overlay instead of stale x/y. Reopen places the window so the mark (not just the frame’s top-left) stays put when overlay size changes.
- **Long chats no longer flash on send and at turn settle (#760)**: This is not #714 / #703 (stick-lock no longer yanks a slight scroll-up, and send only sticks once). After send, the virtual list no longer fights two `itemCount`s; journal rewrite of the last user id no longer force-sticks.
- **Windows paste of Explorer files (.dmp) no longer dies on NotReadableError (#755)**: Composer paste of an on-disk file (crash dumps, locked/large binaries) now reads the OS clipboard path list (`CF_HDROP`) and attaches `@path` like drag-drop. WebView `File.arrayBuffer()` is only used for in-memory blobs (screenshots). Unreadable blobs get a dedicated i18n hint instead of the Chromium English `NotReadableError`.
- **Windows no longer freezes at end of a long turn (#754)**: A trailing `prompt_complete` after `session/prompt` RPC Ok used to re-arm the end-of-turn handler. The second pass emitted IPC while journal reconcile still held the store lock; the WebView WndProc waited on that lock inside `SendMessage` and the window stopped painting. Duplicate finish is now a no-op, and post-turn UI rehydrate reads App `messages.json` only (Host already merged agent history).
- **Local session API no longer wedges after the first turn**: A hung ACP handshake used to keep `connect_lock` forever (90s timeout abandoned the waiter without aborting the task). Later `--session-send` / `POST /turns` then waited ~180s and the CLI lied with `app_not_running`. Connect now aborts and bounded-kills pending children; dispatch returns `retry_later` in 15s; health exposes `connectLockBusy`; CLI maps timeouts to `error`; queued external prompts persist on disk and the Host drains them without the main window.
- **Japanese PR hub and Ukrainian agent command keep `{name}` (#751)**: `ja` `prHub.author` was `作成者` with no author; `uk` `preferredCurrent` shipped `--agent ` with nothing to paste. Catalog tests now fail if any locale drops or renames an `en` placeholder.
- **Sidebar tree text columns line up (#745)**: Projects and Other labels share one left edge. Project names and the session titles under them share `--tree-text-inset`. The L1 chevron column is 20px (was 28).
- **Windows tray icon stays visible on a dark taskbar (#747)**: The notification-area mark is no longer a black glyph on transparency. Light taskbars get a black tile / white glyph; dark taskbars get the inverse. The host follows `SystemUsesLightTheme` (not the in-app theme) and swaps live.
- **Windows “follow system” theme now switches with Personalization (#749)**: Boot still locks WebView2 form chrome, but that froze `prefers-color-scheme`, so the main window stayed put when the OS flipped. The host watches `AppsUseLightTheme` and the UI reapplies `data-theme`.
- **Phone mirror serves the packaged SPA when dist is missing (#734)**: Filesystem `dist` / `GROK_MIRROR_DIST` still win in dev; packaged builds fall back to embedded `frontendDist`. Token gates on `/t/{token}` and `/assets` are unchanged.
- **macOS green zoom no longer deadlocks the UI (#735)**: After a resize/move debounce, window-state persist hops back to the main thread before `save_window_state`. The plugin mutex + macOS geometry getters could AB-deadlock when maximize fired a Resized storm.
- **Queued follow-up reply no longer stays blank until you switch chats (#737)**: Turn-1 journal rehydrate (400/900ms) was copying the previous answer onto the queued `a-pending-*` bubble. Turn-2 tokens then looked like a replay and were dropped. Same-turn lift still runs once disk has the new user prompt; a stale Host `ready` no longer freezes that pending shell.
- **User bubbles paint the hydrated draft, not a leftover `/goal` or `/skill` first line**: Optimistic send and reload already hydrates; the live bubble now uses the same text.
- **Type-to-focus no longer doubles letters (#739)**: Printable keys only focus the composer. Chromium/WebView2 already types that key into the newly focused editor; a second `insertText` made `aa` from one `a` (#706). Space still inserts itself (`preventDefault` so the page does not scroll).
- **Pet typing / settings / spin**: composer typing plays the catalog alert morph (slanted !) and returns to the chosen rest shape when keystrokes stop; Settings → Pet shape and rest-face clicks update the preview immediately; **Spin spin spin** restores the colorful orbit belts instead of collapsing to a point.
- **Japanese UI is no longer two-thirds Simplified Chinese (#732)**: Settings / Doctor / extensions / session catalogs that still copied `zh` verbatim are Japanese. `session.placeholderTitle` is `新しいチャット` (matches the tray). A catalog test fails if a non-Chinese locale copies simplified-only Han from `zh`.
- **Windows `pnpm test` no longer fails on a fresh clone (#730)**: `window-config.test.ts` now normalizes CRLF before asserting on Host source, so `core.autocrlf=true` checkouts stay green.
- **German “turn” is *Vorgang*, not *Zug* (#728)**: 125 catalog sites no longer read as “train” / “chess move”.
- **15-locale auto-title and test cascade (#726)**: CJK titles no longer panic when peeling 「」 / “”; every shipped locale’s placeholder name is recognised; engine-locale tests no longer poison `APP_HOME_ENV_LOCK` on a non-English desktop.
- **Parallel `cargo test` is reliable again (#727)**: `plan_chrome` takes the shared app-home lock; a poisoned env lock no longer takes the rest of the suite with it.
- **Dates and clocks follow Settings, not the WebView (#729)**: history / audit timestamps and the quota-reset clock use the chosen locale (tray included).
- **Boot splash and “follow system” honour the chosen language (#731)**: splash copy covers all 15 catalogs; `<html lang>` is no longer `en` for twelve of them; follow-system reads the Host OS tag instead of the WebView’s `navigator.language`.
- **`cargo fmt --check` is green on main (#725)**.

**中文 · 修复**
- **Windows Host 在资源管理器粘贴修复后重新能编过（#763）**：`clipboard-win` 5.4 的 `FileList` 同时实现 `Vec<String>` 和 `Vec<PathBuf>`，`get_clipboard` 推不出类型（`E0282`）。显式标成 `Vec<String>`。#756 的后续。
- **桌面宠物关闭再开会回到上次位置**：松手、隐藏、退出都会把坐标写盘。卡住的系统拖动标记不会在隐藏时把 0,0 存进去。改设置不再用过期的 x/y 覆盖现场。重新打开时按宠物（不是窗口左上角）对齐，浮层大小变了也不会把宠物挪走。
- **长对话发送/回合结束不再整页闪（#760）**：不是 #714 / #703（那是贴底后轻滑被拽回、发送双吸底）。发送后虚拟列表不再用两套条数抢窗口；日记改写最后一条 user id 时不再强制吸底。
- **Windows 粘贴资源管理器文件（.dmp）不再报 NotReadableError（#755）**：Explorer 复制的已有磁盘路径改为读系统剪贴板文件列表（`CF_HDROP`）并按 `@path` 附加，与拖放一致。截图等无路径内容仍走 `arrayBuffer`。读不了的 blob 用专用文案，不再把 Chromium 英文 `NotReadableError` 拼进横幅。
- **Windows 长回合结束不再卡死整窗（#754）**：`session/prompt` RPC 已经结束之后，迟到的 `prompt_complete` 会再次武装结束逻辑。第二次结束在 journal 对账还占着 store 锁时发 IPC，WebView 的 WndProc 在 `SendMessage` 里等这把锁，窗口不再重绘。重复结束现在是空操作；回合结束后的 UI 补刷只读 App `messages.json`（Host 已经合并过 agent 历史）。
- **本地 session API 干完一轮后不再卡死**：卡住的 ACP 握手会把 `connect_lock` 永久占住（90s 超时只放弃等待、不 abort 任务），之后的 `--session-send` / `POST /turns` 会挂到约 180s，CLI 还谎称 `app_not_running`。现在超时会 abort 并用有上界的 kill 清 pending 子进程；派活 15s 内回 `retry_later`；health 带 `connectLockBusy`；CLI 把超时映射成 `error`；外部 queued 落盘，由 Host drain，不依赖主窗口。
- **日语 PR hub 和乌克兰语 agent 命令不再丢掉 `{name}`（#751）**：`ja` 的 `prHub.author` 只有「作成者」没有人名；`uk` 的 `preferredCurrent` 复制出来是空的 `--agent `。目录测试会拦截任何语言丢掉或改名 en 占位符。
- **侧栏树文字列对齐（#745）**：Projects 与 Other 标题左缘对齐；项目名与其下会话标题共用 `--tree-text-inset`。一级箭头列从 28px 收到 20px。
- **Windows 托盘在深色任务栏上不再隐身（#747）**：通知区不再用透明底黑标。浅色任务栏黑底白标，深色任务栏白底黑标。跟随任务栏 `SystemUsesLightTheme`（不是应用内主题），切换后即时换标。
- **Windows「跟随系统」现在会跟个性化一起切（#749）**：启动锁 WebView2 表单颜色后，`prefers-color-scheme` 不再更新，系统换深浅色主窗不动。Host 改为监视 `AppsUseLightTheme`，前端重刷 `data-theme`。
- **手机镜像在没有磁盘 dist 时改走打包内嵌前端（#734）**：开发模式仍优先文件系统 / `GROK_MIRROR_DIST`；正式包用 embedded `frontendDist`。`/t/{token}` 与 `/assets` 的 token 门不变。
- **macOS 点绿色放大不再卡死（#735）**：resize/move debounce 到期后先 hop 回主线程再 `save_window_state`。插件 mutex 加上跨线程几何查询会在 maximize 的 Resized 风暴里 AB 死锁。
- **排队跟进跑完后，不用切会话才看到回复（#737）**：上一轮 journal 补刷会把旧正文盖到新的空 pending 气泡上，跟进 token 被当成 replay 丢掉。磁盘追上新 user 之后仍会做同轮抬升；过期的 Host `ready` 也不会把排队中的 pending 结算掉。
- **用户气泡按 hydrated 草稿画，不再露出 `/goal` / `/skill` 首行**。
- **打字聚焦输入框不再重复字母（#739）**：可打印键只负责聚焦。Chromium/WebView2 会把该键打进刚聚焦的输入框；再 `insertText` 一次就会变成按 `a` 出 `aa`（#706）。空格仍自己插入（必须 `preventDefault`，否则会滚页面）。
- **宠物打字 / 设置 / 转圈**：输入走目录里的警示（斜感叹号），停打后回到原形；设置里点形状和表情会马上反映到预览；「转转转」找回彩带轨道，不再缩成一个点。
- **日语界面不再有三分之二简体中文（#732）**：原先原样复制 `zh` 的设置 / Doctor / 扩展 / 会话词条改为日语。`session.placeholderTitle` 与托盘一致为 `新しいチャット`。CI 会拦截非中文目录复制简体专用汉字。
- **Windows 全新 clone 上 `pnpm test` 不再红（#730）**：断言 Host 源码前把 CRLF 归一成 LF。
- **德语 “turn” 改为 Vorgang，不再用 Zug（#728）**。
- **十五语言自动标题与测试连锁失败（#726）**：剥「」/“”不再 panic；占位标题覆盖全部语言；非英语桌面上的 engine locale 断言不再毒化锁。
- **并行 `cargo test` 重新稳定（#727）**。
- **日期和时间跟设置语言走，不再跟 WebView（#729）**。
- **启动页和「跟随系统」使用所选语言（#731）**。
- **`cargo fmt --check` 在 main 上重新通过（#725）**。

## [0.2.23] - 2026-08-20

> **Highlight:** Fifteen UI locales; attach another chat as context; custom STT; think → tools timeline stays honest; sidebar drag no longer fires on a twitch.
>
> **中文 · 亮点：** 十五种界面语言；可附加另一段对话；自定义听写端点；思考/工具时间线恢复诚实；侧栏拖动不再一碰就触发。

### Added
- **Fifteen UI locales with complete catalogs (#708)**: Settings and OS language detection include German, Spanish, Filipino, French, Indonesian, Italian, Japanese, Korean, Brazilian Portuguese, Tamil, and Ukrainian (plus existing English, Russian, Simplified and Traditional Chinese). Every new catalog has the full English key set. Japanese is nearly fully translated; the others cover chrome plus expanded surfaces (remaining deep settings stay English, like Russian). Dates, compact counts, heatmap labels, and tray/menu copy follow the locale instead of forking on Chinese-vs-English. Russian `tray.*` keys are filled. Latin and Sanskrit are not shipped.
- **Interrupted turns after an app restart**: If the host process dies mid-turn, reopening the chat journals `turn_cancelled|host_exit` instead of looking finished. Continue sends a new prompt (with the unfinished command when known). Unclean host exits and Windows last-crash notes go into the session diagnostic zip.
- **Pet stage bubbles, boot color, and peek-hide**: Chips pop only when an agent posts a mid-turn reply (not the session title). Concurrent chats stack instead of overwriting. The overlay boots in the saved color. Settings add auto-hide seconds (default 15), an optional progress bar (off — spinner/check is enough), and bubble shape/background presets. Single-click opens the window; double-click hides it; a second click within 3s of opening also hides (quick peek).
- **File preview refresh (#711)**: The files toolbar can re-read the open file from disk after the agent edits it. Unsaved drafts keep the button disabled so a refresh cannot wipe the editor.
- **Type-to-focus composer (#704)**: With the chat in the foreground, typing while focus is not in an input focuses the composer and inserts the character. IME composition, sidebar j/k, terminals/editors, overlays, and Space-on-button are left alone.
- **Double-click a sidebar chat to rename (#702)**: Project and Other-session rows edit the title in place. Enter / blur save when the name changed; Escape cancels. F2 on a focused row does the same. Right-click Rename still uses the existing prompt. Multi-select does not start rename.
- **Pet eye color, white body, and celebrate spin**: Settings → Pet can pick eyes independently of the body (body palette + Auto). White stays pale in both themes. The mark spins when a focused task finishes, or from the pet menu.
- **Pet task bubbles can be turned off (#696)**: Settings → Pet and the pet context menu can hide the session chips above the mark. The overlay shrinks when they are off.
- **Attach another chat as context**: `/attach-chat`, composer `+`, or right-click **Attach to current chat** picks a local conversation; drag a sidebar chat onto the composer to attach it. Chips sit on the composer; the journal stores `[[chat:id]]` tokens; the host prefixes a compact transcript for the agent only (max 3; source chat unchanged). Row-body drag onto a project still moves the chat.
- **Custom OpenAI-compatible STT endpoint for composer dictation (#700)**: Settings → Voice can pick a custom `/audio/transcriptions` endpoint (Groq / OpenAI / Mistral / local server) with per-provider API keys stored in the OS keychain; official xAI dictation and Live Voice stay unchanged. Chinese dictation gets simplified / traditional script steering, and the 跟随系统 language hint now follows the resolved UI locale.

**中文 · 新增**
- **十五种界面语言，词条补全（#708）**：设置和系统语言可识别德、西、菲、法、印尼、意、日、韩、巴西葡、泰米尔、乌克兰（加上原有的英、俄、简中、繁中）。新语言都有完整 key 集。日语接近全译；其余覆盖主界面并扩展了设置（深层仍可回落英文，和俄语一样）。日期、数字、热力图、托盘/菜单跟界面语言走，不再按「中文或英语」二分。补上俄语 `tray.*`。不收录拉丁语和梵语。
- **应用重启后的中断回合**：宿主进程中途死掉再打开会话，会记 `turn_cancelled|host_exit`，不再看起来像做完了。芯片上的「继续」发新 prompt（有未跑完的命令会带上）。非干净退出和 Windows 崩溃摘要会进会话诊断包。
- **宠物阶段性气泡、启动色、点一下就藏**：气泡只在 Agent 写出阶段性回复时弹出（不再只显示会话标题）；不同会话往上叠加、互不覆盖。启动即用已保存的自定义颜色。设置里可调自动关闭秒数（默认 15）、可选进度条（默认关，左边旋转/打钩即可），以及气泡形状和背景。单击打开窗口，双击隐藏；打开后 3 秒内再点一次也会藏（看一眼就收）。
- **文件预览可刷新（#711）**：文件工具栏能从磁盘重新读取当前打开的文件，agent 改完不必关 tab。有未保存草稿时按钮禁用，避免冲掉编辑。
- **打字自动聚焦输入框（#704）**：对话在前台、光标不在输入框时，敲键盘会聚焦 composer 并写入该字符。中文输入法、侧栏 j/k、终端/编辑器、弹层、按钮上的空格不受影响。
- **双击侧栏对话可重命名（#702）**：项目里和其他会话的行内直接改标题。Enter / 失焦在标题有改动时保存，Esc 取消。聚焦行按 F2 同样进入。右键「重命名」仍走原来的弹窗。多选模式不会进入重命名。
- **宠物可改眼睛颜色、白色身体、完成转圈**：设置 → 宠物里眼睛和身体分开选（身体色板 + 自动）。白色在两种主题下都保持浅色。聚焦任务完成时（或右键菜单）会转圈。
- **桌宠提示框可关（#696）**：设置 → 宠物，以及宠物右键菜单，都能关掉任务气泡；关掉后浮层会收小。
- **把另一段对话当作上下文加入**：`/attach-chat`、输入框 `+`、或右键「加入目前对话」可加入本地对话；把侧栏会话拖到输入框也会附加。chip 挂在输入框；日记只存 `[[chat:id]]`；Host 只给 Agent 加一段压缩记录（最多 3 段；来源对话不改）。拖行身到项目仍是移动会话。
- **Composer 听写支持自定义 OpenAI 兼容 STT 端点（#700）**：设置 → Voice 可选用任意 `/audio/transcriptions` 端点（Groq / OpenAI / Mistral / 本地服务），API Key 按提供方独立存入系统钥匙串，明文不出 webview；官方 xAI 听写与 Live Voice 不变。中文听写支持简体 / 繁体引导，「跟随系统」语言提示跟随界面实际语言。

### Changed
- **Remaining UI locales filled**: German, Spanish, French, Korean, Brazilian Portuguese, Indonesian, Filipino, Ukrainian, Tamil, and Russian catalogs now cover essentially the full key set (product names and symbols stay English). Russian leftovers after that pass were filled again. Korean leftovers after the first pass were filled again.
- **Italian catalog is now fully translated**: Remaining settings / Doctor / extensions copy that still fell back to English is Italian.

**中文 · 变更**
- **其余界面语言补全**：德、西、法、韩、巴西葡、印尼、菲、乌克兰、泰米尔、俄语目录覆盖完整 key 集（品牌名和符号仍可保持英文）。
- **意大利语目录补全**：原先回落英文的设置、Doctor、扩展文案改为意大利语。

### Fixed
- **Sidebar session drag needs a clearer move**: Opening a chat no longer turns into a drag from an 8px twitch, the first-click synthetic jump, or the pet overlay stealing key / remapping the cursor. The gesture waits for 16px after an 80ms hold. Showing the pet gives the workbench key back so the first click after launch still selects a chat.
- **Shift+Enter no longer wipes composer text**: Newlines split the live line in place. The editor no longer rebuilds from a lagging React snapshot, which deleted what you had just typed.
- **Chat timeline keeps think → tools → body cycles**: Mid-turn status no longer gets hoisted into the thinking fold, and the next “思考中” no longer starts while tools from the previous round are still running. Live interleave stays in stream order after the turn ends (v0.2.19 honesty; the 0.2.20/0.2.21 process-fold had mashed the whole turn).
- **Thinking timer is per episode**: The first “思考中” no longer keeps counting through later tool rounds, and the next thinking row starts from zero instead of continuing the previous clock. Work-phase “工作中” uses this phase’s tool times, not the assistant bubble’s send time.
- **Live work stays expanded**: The “工作中” rail stays open so you can see which tools are running. It auto-collapses when that burst finishes with no errors, and stays open if any tool failed.
- **Live tools no longer look stuck on the first reads**: Journal completion now settles in-progress reads even after later tools arrive, and the work rail follows the currently running step so later bash/polls are not clipped off-screen.
- **STREAM_STALL after send is this-turn only**: A new prompt no longer inherits the previous answer as “output paused”. The empty first-token wait is 90s (was 45s) so Grok 4.x high-effort thinking is less likely to look like a dead gateway.
- **Relative chat images resolve from curl dest and journal tail**: Markdown basenames like `foo.png` no longer miss when the real file was written with `curl -o` (or similar) into an absolute path. Rehydrate after journal ready so first-paint does not lock an empty card. `/workspace/` is not matched inside `/Users/…/Documents/workspace`.
- **Pet bubble body wraps 2–3 lines; session title stays readable on light chips**: Stage text is no longer a single ellipsis line. The session title under it uses contrast-safe muted color (paper/white no longer hides it). With the progress bar off, the chip does not keep an empty track gap.
- **“No credentials on the agent” points to Providers, not only official Sign in (#705)**: The banner now explains that a terminal CC Switch / custom relay is unused until you click Use in Settings, and the primary action opens Custom providers.
- **Chat no longer jitters when scrolling up from the bottom (#703)**: Stick-to-bottom only snaps rubber-band past max; a 10px trackpad nudge can leave the pin. Sending after reading history force-sticks once in layout (not a double rAF + busy-edge bump).
- **New-chat Connecting no longer hangs when `connect_lock` is held (#709)**: The 90s wall clock now covers lock wait (sibling task, so a blocking ACP poll cannot starve the timer). A timed-out attempt is invalidated so it cannot start a handshake after the lock frees. Idle recycle kill / send / disconnect wait for the lock with a timeout. Connect enqueue + timeout also sync-append to `app.log` if the tracing worker is silent. The client drops `sessionConnect` after 100s so the pill cannot sit on Connecting forever.
- **Finished turns no longer stay on 思考中 / 连接中**: After the last assistant body is painted, leftover streaming or a leaked connect claim kept Stop and blocked the next send. Client heal unlocks the composer (reply stays) when Host is idle, or after 90s if Host itself went stale.
- **Late tool-turn answers paint without remount (#697 / #698)**: Stream text that arrives after a tool-only (or thinking-only) bubble can now fill that bubble in place. A ready→ready skip no longer hides the final answer.
- **Permission bars and journal flush after live lock**: A remounted WebView can recover the full approval card instead of looking stuck thinking. The stream journal flushes after the live lock is released.
- **User images no longer echo as broken assistant cards**: Pasted / attached user files are not re-attached onto the assistant turn. Outside-project paths 403 after restart no longer lock the card as a corrupt blob.
- **Windows pet overlay no longer inherits File / Edit / Window / Help; toggle follows real window visibility; hit target shrinks after drag (#696)**: The overlay keeps a window-local empty menu and strips the native bar. Hide retries if the HWND stays painted; File → Close hides instead of destroying. Host clears drag when the left button is up, and measured hit radius is clamped to the mark size.
- **Linux / KDE pet overlay can be clicked and dragged**: The always-on-top pet stays focusable on Linux so KWin delivers pointer events, hides the GTK Edit/Window/Help bar that `app.set_menu` reapplied on the transparent window, and moves with `movementX/Y` on Wayland (late `startDragging` has no button serial).
- **Windows release build compiles the last-crash filter**: `windows` 0.61 moved `EXCEPTION_CONTINUE_SEARCH` into Debug and gates `SetUnhandledExceptionFilter` on `Win32_System_Kernel`. The Host now enables that feature so NSIS / portable packages can build.
- Attach is drag-onto-composer or the row menu (no ⋮⋮ grip-drag). Host compact keeps the newest turns; chips-only missing/empty sources return typed errors; recycle bootstrap keeps a stub or re-expanded attach context.

**中文 · 修复**
- **侧栏会话拖动不再一碰就触发**：点开会话时 8px 的轻微移动、按下后第一次虚假位移、以及宠物窗口抢焦点/重映射指针，都不会立刻变成拖动。启动后第一次点击会话会选中，不会被宠物 `show()` 吃掉。
- **Shift+Enter 不再删掉输入框文字**：换行在当前行原地拆开，不再用滞后的 React 草稿整页重绘（那会把刚打的字清掉）。
- **对话时间线恢复「思考 → 工具 → 正文」循环**：过程旁白不再被折进思考折叠里；上一轮工具还没跑完时，也不会在下面先画出新的「思考中」。回合结束后仍保持流式顺序（回到 0.2.19；0.2.20/0.2.21 的过程折叠把整轮揉成一团）。
- **思考计时按轮次清零**：第一轮「思考中」不再把后面的工具时间算进去；下一轮思考从 0 开始，而不是接着上一轮的秒数。工作阶段的「工作中」只用本阶段工具时间，不用整条气泡的发送时刻。
- **进行中的工作不折叠**：「工作中」保持展开，能看到正在跑哪些工具；这一段跑完且没有报错再自动折叠，有报错则保持展开。
- **进行中的工具不再卡在第一条读取**：后面又来新工具时，前面已完成的读取会从「进行中」结算掉；工作列表会跟到当前正在跑的那一步，后面的命令/轮询不会被截在视口外。
- **发消息后的 STREAM_STALL 只看本轮**：新 prompt 不会因为上一轮已有正文而显示「输出暂时停住了」。尚未出首 token 的等待窗口改为 90 秒（原 45 秒），减少高思考模型被误判成网关挂死。
- **相对路径聊天图片能对上 curl 落盘和日记尾**：`foo.png` 这类 markdown 文件名不再漏掉 `curl -o` 写到绝对路径的文件。日记 ready 后再解析一次，避免首屏把卡片钉成空图。`/Users/…/Documents/workspace` 里的 `/workspace/` 不会被误当成工作区根。
- **宠物气泡正文可折 2–3 行；浅色底上也能看见会话标题**：阶段性回复不再只挤一行省略。下面的会话标题用对比色，纸张/白色背景不再把标题隐成空行。关掉进度条时不再留那条空白。
- **「Agent 侧没有可用凭据」不再只叫人官方登录（#705）**：文案说明终端 CC Switch / 中转要在设置里点「使用」才会进 App；主按钮打开自定义服务商。
- **贴底后再轻微上滑不再抖动（#703）**：贴底锁只回弹越过底部的橡皮筋；10px 触控板轻拨即可离开。先上滑再发送只会在 layout 里吸一次底，不会双 rAF + busy 再吸一次。
- **`connect_lock` 被占住时新对话不再一直 Connecting（#709）**：90 秒墙钟覆盖等锁；握手在旁路任务里跑，ACP 阻塞也挡不住超时。超时后作废这次 connect。recycle 杀进程、发送、断开等锁都有上限。tracing 日志挂了时 connect 关键行仍会写入 `app.log`。前端 100 秒丢掉卡住的 `sessionConnect`。
- **回合结束后不再一直「思考中 / 连接中」**：正文已经出来，UI 还停在停止键、发不了下一句。Host 已空闲（或卡住超过 90 秒）时自动解锁，回复保留。
- **工具回合的晚到正文不再要重挂才出现（#697 / #698）**：只有工具（或只有思考）的气泡，后到的流式文字会填进同一条。ready→ready 跳过状态时也不再把最终答案藏掉。
- **权限条和日记在解开 live lock 后会补上**：WebView 重挂后能恢复完整审批卡，不再看起来卡在思考。流式日记在释放锁之后再刷盘。
- **用户图片不再回显成损坏的助手图卡**：用户粘贴/附图不会再挂到助手回合上。项目外路径重启后 403 也不再把卡片钉成坏图。
- **Windows 宠物不再继承 File / Edit / Window / Help；开关跟真实窗口走；拖完热区会收回（#696）**：浮层用自己的空菜单并卸掉原生菜单栏。关掉后若仍显示会再 hide 一次；File → 关闭只会收起。松开鼠标后 Host 清掉拖拽状态，热区半径按标记尺寸封顶。
- **Linux / KDE 上可以点、可以拖桌面宠物**：Linux 上宠物窗保持可接收指针；去掉 GTK 应用菜单画在透明 overlay 上的 Edit/Window/Help；Wayland 用位移挪窗，不再等已经过期的 `startDragging` 抓手。
- **Windows 正式包能编过崩溃摘要钩子**：`windows` 0.61 把 `EXCEPTION_CONTINUE_SEARCH` 挪到 Debug，并把 `SetUnhandledExceptionFilter` 挂在 `Win32_System_Kernel` 上。Host 打开该 feature，NSIS / 绿色版才能编出来。
- 附加对话改为拖到输入框或用行菜单（无 ⋮⋮ 拖曳）。压缩时保留最新轮次；只发 chip 且来源缺失/空白会返回明确错误；Agent 重开后仍保留附加上下文或占位。

## [0.2.22] - 2026-08-19

> **Highlight:** Move chats between projects; a persist-mounted terminal under the chat; Russian UI; pet overlay no longer steals the first click.
>
> **中文 · 亮点：** 会话可移到其他项目；对话栏底部常驻终端；俄语界面；宠物窗口不再抢走第一次点击。

### Changed
- **Pet settings nav icon has two short eyes**: The hex outline now includes two short vertical strokes so the sidebar item reads as the companion, not a generic polygon.
- **Pet menu keeps a single settings item**: The overlay context menu no longer lists both Edit and Pet settings (they opened the same Settings → Pet page).

**中文 · 变更**
- **设置里的宠物图标加了两只短竖线眼睛**：不再只是空六边形。
- **宠物菜单只保留「宠物设置」**：右键里「编辑」和「宠物设置」进的是同一页，已去掉重复的「编辑」。

### Added
- **Move chats between projects (#616)**: Sidebar menu, multi-select, and drag-and-drop can place a chat (including Other sessions) under another folder. Confirm first — the agent reopens in the new cwd and does not reuse the old CLI session. Relative paths from the previous workspace may break.
- **Chat-column bottom terminal and pane motion (#681)**: `⌘\`` toggles a persist-mounted terminal under the chat. Sidebar / aside / settings / account-menu / project-list click-toggles interpolate instead of hard-cutting.
- **Russian UI locale (#689)**: Settings language list and system-language detection include `ru`. Catalog is English-backed with translated overrides; tray / app menu follow the same locale.

**中文 · 新增**
- **会话可移到其他项目（#616）**：侧栏菜单、多选和拖到项目上可以把对话（含「其他会话」）挂到另一个文件夹。会先确认；Agent 在新目录重开，不会把旧 CLI 会话 load 进新仓库。原先工作区的相对路径可能失效。
- **对话栏底部终端与分栏动画（#681）**：`⌘\`` 打开/收起聊天下方常驻终端。侧栏、右侧栏、设置、账号菜单、项目列表的点击开合改为插值，不再硬切。
- **俄语界面（#689）**：设置语言列表和跟随系统可切到 `ru`。词库以英文兜底、常用面有俄文；托盘和原生菜单同步。

### Fixed
- **Project list collapse no longer snaps and leaves a leftover scrollbar (#694)**: Closing a project (or the L1 Projects chevron) paints the locked height, then interpolates to 0. The overlay thumb stays hidden while height is moving. Overflow is restored before the active chat scrolls into view. Open folders retarget the px lock when a chat is dropped in, so new rows are not clipped and the next close still interpolates.
- **Pet context menu stays near the click**: The menu opens at the right-click and only slides enough to stay on the visible work-area slice of the overlay (no jump to the mark or the window corner).
- **Pet overlay no longer steals the workbench’s first click**: The always-on-top pet window is not focusable (`canBecomeKeyWindow = NO` / `WS_EX_NOACTIVATE`). Tao `show()` still calls `makeKeyAndOrderFront`; if the overlay becomes key while the main window is visible, key is returned immediately so composer / list clicks land on the first press.
- **Official login no longer breaks a working custom relay**: After sign-in, Host kept calling ACP `authenticate(cached_token)` on custom-route processes. That RPC reads `~/.grok/auth.json`, Grok Build then sends OIDC to the relay (`HTTP 400 Incorrect API key` / network card), and logout “fixed” it immediately. Custom routes now skip `cached_token`; login / account switch bind agent-home via `prepare_route_auth_for_agent` (official syncs, custom clears).
- **History image chips no longer decode the full original (#692, #693)**: User-message paste thumbs use the same Host thumbnail path as assistant cards (#675). First paint stays empty until the ≤480px JPEG is ready, a live loopback `src` is not blanked on remount, and the `<img>` is no longer remounted on URL change. Long threads with screenshots no longer flash the window while a new reply streams.
- **Live “思考中” timer no longer inherits another chat’s clock**: A leftover `turnStartedAt` (or a later correction) used to stick at 50+ minutes, then jump to the real duration after remount. The live timer now follows this turn’s clock and will not start before the assistant bubble’s `createdAt`.
- **New-chat first send no longer false-heals as “message never reached the agent”**: Ghost-heal treated a leftover previous-session turn clock plus the `__draft__` → real-id handoff as “Host idle, send finished”. The toast fired, the composer was restored, and the agent still ran the prompt. New chat now clears the clock; draft sends start/migrate it; `sessionCreate` moves the send claim onto the real id immediately; heal also counts the draft claim as in-flight.
- **Composer branch chip follows in-place checkout (#690)**: `git switch` in the same working tree no longer leaves the chip stale until the menu is opened. The dirty-status poll already had HEAD; it now patches the matching worktree row.
- **Reasoning effort survives session respawn (#682)**: Changing effort on an existing chat was overwritten by `session/load` restoring the old CLI journal. A real change now clears `agent_session_id` (next connect uses `session/new`) and the next send waits for the preference write. Custom providers with an effort catalog get `supports_reasoning_effort` in App `agent-home` only.
- **CLI import no longer paints `<system-reminder>` as a user bubble (#687)**: Reminder-only / `synthetic_reason: project_instructions` envelopes in `chat_history.jsonl` are skipped. A wrapped `<user_query>` is kept.
- **Voice/STT no longer re-copies official OIDC into a custom route's agent-home**: `voice_auth` blind-called `sync_cli_auth_to_agent_home` on every token read, undoing the custom-route auth strip until the next spawn (a live relay process could lazily load the OIDC). It now goes through route-aware `prepare_route_auth_for_agent`; voice still falls back to `~/.grok/auth.json` for official xAI endpoints.
- **Rewind-unsupported error now takes the clean path in drop-last**: The `initialize`-not-advertised early return is phrased as `method not supported`, so journal drop-last skips the pointless last-turn fallback retry and its misleading warn log.
- **Long tool-heavy chats no longer flicker stacked replies**: Collapsed thinking is no longer counted in the first-paint row estimate, and a virtual-list start that lands on a 0-height tool plateau walks back to the previous real message. A 1px height change no longer remounts a different pair of assistant bubbles (Windows WebView leftover paint looked like the transcript flashing).
- **A refused chat move no longer kills the live agent (#616 follow-up)**: Host validated the target folder only after dropping the session's ACP process, so an untrusted / missing target (or a same-project no-op from a stale caller) still cost the chat its `agent_session_id` and forced `session/new`. `session_move_to_project` now prechecks the target and cwd change first; the agent is dropped only when the move will actually happen.
- **Composer skill chips no longer show a tiny hammer emoji**: Inline skill / tool tags in the input (and user bubbles) use 14px Tabler SVGs so the glyph matches the 12px label. Imagine uses the wand; other skills keep the tool icon.

**中文 · 修复**
- **收起项目列表不再硬切、也不再留下滚动条（#694）**：关掉项目（或一级「项目」）会先锁住当前高度再插值到 0。动画期间隐藏 overlay 滑块；高度恢复后再把当前会话滚进视野。往已展开的文件夹里拖入会话时会改写锁定高度，新行不会被裁切，下次收起仍能插值。
- **宠物右键菜单贴着点击位置**：菜单在右键处打开，只在会出屏时平移，不再跳到标记另一侧或窗口左上角。
- **宠物窗口不再抢走主窗口的第一次点击**：置顶宠物窗不可成为 key（macOS `canBecomeKeyWindow = NO` / Windows `WS_EX_NOACTIVATE`）。Tao 的 `show()` 仍会 `makeKeyAndOrderFront`；若主窗口已可见，立刻把焦点还回去，输入框和列表第一次点击就能生效。
- **登录官方号不再把正在用的中转打挂**：签入后自定义路由仍会 `authenticate(cached_token)`，CLI 读 `~/.grok/auth.json` 后把 OIDC 打到中转（HTTP 400 Incorrect API key / 网络异常），退出登录立刻又好。现在自定义路由不再做 `cached_token`；登录/切号按当前路由 `prepare_route_auth`（官方同步，自定义清掉）。
- **历史里的用户附图不再解原图（#692, #693）**：用户气泡里的粘贴缩略图走和助手图卡同一套 Host 缩略图（#675）。缓存未命中时先占位，已有 loopback 地址不再清成空，换地址时也不再拆掉 `<img>` 重挂。带截图的长对话在往外写时窗口不再整屏闪。
- **「思考中」不再沿用上一会话的计时**：上一轮留下的 `turnStartedAt` 会把时长钉在 50 多分钟，滑一下或重挂载后又变成真正的几分钟。现在跟本轮时钟走，也不会早于这条助手气泡的 `createdAt`。
- **新建会话首条消息不再误报「消息没有真正发给 Agent」**：上一条会话留下的计时，加上草稿 `__draft__` 切到真实 session id 的空档，会被当成 Host 空闲、发送已结束。于是 toast 弹出、输入框还原，Agent 其实已经在跑。现在新建会话会清计时，草稿发送会建/迁移计时，`sessionCreate` 当下就把发送认领迁到新 id，heal 也会把草稿认领当成仍在发送。
- **输入框上的分支 chip 会跟着同目录切分支更新（#690）**：同一工作树里 `git switch` 后不再要点开菜单才刷新。脏状态轮询本来就有 HEAD，现在会补到对应 worktree 行。
- **切换推理力度后不再被旧 CLI 会话盖回去（#682）**：已有对话改 effort 会被 `session/load` 恢复成旧值。真正改过时清掉 `agent_session_id`（下次 `session/new`），下一条发送会等偏好写完。带 effort 目录的自定义渠道只在 App `agent-home` 写 `supports_reasoning_effort`。
- **导入 CLI 会话不再把 `<system-reminder>` 画成用户气泡（#687）**：`chat_history.jsonl` 里只有 reminder / `project_instructions` 的信封会丢掉；带 `<user_query>` 的仍保留正文。
- **用语音不再把官方 OIDC 复制回自定义路由的 agent-home**：`voice_auth` 每次取 token 都盲同步 `auth.json`，把自定义路由刚清掉的凭据又写回去（存活的中转进程可能懒加载到）。现在改走按路由处理的 `prepare_route_auth_for_agent`；语音本身仍会回退读 `~/.grok/auth.json`。
- **Agent 不支持 rewind 时撤回消息走干净路径**：`initialize` 未公布 rewind 的早退错误改为 `method not supported` 措辞，撤回上一条不再多发一次注定失败的兜底调用、也不再打误导性的 warn 日志。
- **工具很多的长对话不再把两轮回复叠在一起闪**：折叠的思考不再计入行高预估；虚拟列表起点落在一串 0 高工具行上时，回退到前一条真实消息。高度差 1px 不会再换一套助手气泡（Windows 上旧层清不掉，看起来像正文狂闪）。
- **移动会话被拒绝时不再误杀正在跑的 Agent（#616 跟进）**：Host 原来先杀掉会话的 ACP 进程、后校验目标文件夹，未信任/丢失的目标（或过期调用方发来的同项目 no-op）也会让会话丢掉 `agent_session_id`、被迫 `session/new`。现在 `session_move_to_project` 先预检目标和 cwd 是否变化，确认真的要移动才断开 Agent。
- **输入框里的 skill 标签图标不再过小**：工具 / skills / imagine 等标签改用 14px SVG，和 12px 文字齐平。imagine 用魔杖，其余仍用扳手。

## [0.2.21] - 2026-08-18

> **Highlight:** Create Image / Create Video from the composer + menu; Agent Kanban and Project Spaces; chat no longer freezes on the first generated image or stays stuck Connecting.
>
> **中文 · 亮点：** 输入框 + 菜单可创作图像/视频；智能体看板与项目空间；出图首屏不再卡死，「连接中」不再只能重启。

### Added
- **Create Image / Create Video in the composer + menu (#677)**: When the bundled Imagine skill is available, Add lists **Create Image** (localized Imagine) and **Create Video** (Imagine + a short video starter prompt). Skill id stays `imagine`.
- **Side workbench CodeMirror editor (#661 follow-up)**: Files edit mode uses CodeMirror 6 (Atom One palette + line numbers, Tab as two spaces, ⌘/Ctrl+S). Markdown still uses TipTap. Preview mode is unchanged.
- **Side-browser Design Mode (#636)**: The Browser tab can inspect localhost / same-origin preview elements and send the selection, optional snapshot, and style note into the composer.
- **Discover Claude / Cursor skills toggle**: Settings → Extensions → Skills can turn external compat discovery off. Independent session mode also writes `[compat.claude] skills` / `[compat.cursor] skills` in agent-home `config.toml`. Shared mode only hides them in the App (does not rewrite `~/.grok`).
- **Session interrupt recovery**: Shutdown cancels the ACP TCP reader with the process, stamped events require an exact session owner, and per-session send claims/epochs survive reconnect so a kill cannot leave a ghost stream or a wedged queue.
- **Agent Kanban**: Sidebar / palette / `#/kanban` shows live sessions in Needs you / Working / Done. A finished turn stays in Done across pane remounts (not a personal to-do list). Opening a card does not hide it.
- **Project Spaces**: Sidebar groups projects into named spaces (All / Default / custom). Membership survives restart; search from All does not force a space switch. Name errors stay inline in the prompt (red), not a toast.
- **Transcript selection quotes**: Selecting text in a bubble shows a floating bar (copy, optional comment, add to chat). Quotes sit **beside** the draft as a compact “N notes / N 条注释” chip — they are not pasted into the input. They persist on project/session drafts and the send queue. The agent sees `Quoted excerpt` / `Comment` blocks; the journal stores `[[quote]]` / `[[note]]` fences so reload rebuilds the cards. Queue **Guide** serializes quotes (and re-queues them on failure). Send settlement compares quotes so a quote added during an in-flight send is not overwritten on failure. Switching sessions closes the selection bar.

**中文 · 新增**
- **输入框 + 菜单可创作图像 / 视频（#677）**：有 Imagine 技能时，「添加」里出现「创作图像」和「创作视频」。技能 id 仍是 `imagine`；创作视频会带上短片起始提示。
- **侧栏 CodeMirror 编辑器（#661 后续）**：Files 编辑模式改用 CodeMirror 6（Atom One 配色 + 行号，Tab 两个空格，⌘/Ctrl+S）。Markdown 仍用 TipTap。预览模式不变。
- **侧栏浏览器设计模式（#636）**：Browser 页可点选本机 / 同源预览元素，把选区、可选快照和样式备注送进输入框。
- **探测 Claude / Cursor 技能开关**：设置 → 扩展 → 技能可关闭外源兼容探测。独立会话模式会写入 agent-home `config.toml`；共享模式只在应用内隐藏，不改写 `~/.grok`。
- **会话中断恢复**：关掉 Agent 时一并取消 TCP 读；打戳事件必须对上会话主人；发送认领按会话隔离，重连后不会留下幽灵流或卡死的队列。
- **智能体看板**：侧栏 / 命令面板 / `#/kanban` 按「需要你 / 工作中 / 已完成」展示运行中的会话。回合结束后切走再回来仍留在已完成（不是个人待办）。打开卡片不会把它藏掉。
- **项目空间**：侧栏项目可分到命名空间（全部 / 默认 / 自定义）。成员关系重启后仍在；「全部」里搜索不会误切空间。重名等错误在对话框里用红字提示，不再用顶部 toast。
- **正文选中批注**：在气泡里选中文字后出现浮层（复制、可选评论、添加到对话）。注释作为紧凑的「N 条注释」贴在输入框旁，**不粘进正文**。会跟项目/会话草稿和发送队列一起保存。发给模型的是 `Quoted excerpt` / `Comment`；日记里写 `[[quote]]` / `[[note]]`，重载后还能还原成卡片。队列「引导」会带上注释（失败重新入队也保留）。发送结算会比较注释，发送过程中新加的注释在失败时不会被旧快照盖掉。切换会话会关掉选择浮层。

### Changed
- **Composer workspace chip on every desktop chat (#662)**: The project / default-workspace control above the input is no longer limited to a brand-new draft that already has a folder. Pick, add, or return to the default workspace from the existing `ComposerProjectMenu`. Chinese copy uses 默认工作区 (was 通用). Sidebar `+` stays. Phone still uses the tools sheet.

**中文 · 变更**
- **桌面输入框上方始终显示工作区（#662）**：不再只在「已选项目的全新空草稿」才出现。沿用现有 `ComposerProjectMenu` 选择、添加或回到默认工作区。中文不再用「通用」。侧栏 `+` 保留。手机仍走工具页。

### Fixed
- **Selection comment pop hierarchy**: The comment field uses the input well so it no longer blends into the panel; the excerpt stays plain truncated text.
- **Stuck「连接中」until restart**: The status pill is per-chat (another session’s handshake no longer paints this one Connecting). Host connect has a 90s wall clock; `ProcessExited` during handshake fails the FSM; leftover Connecting is not treated as a healthy live process. `session/set_mode` runs after Ready. Click the pill or Reconnect to cancel and retry — that button stays enabled.
- **Chat no longer freezes when a generated image first appears (#675, #676)**: The card first-paints a placeholder or cached thumb instead of the full Imagine PNG. Host cache hits read source width/height from a sidecar (or the thumb JPEG header) and do not decode the original again.
- **Assistant body text no longer stacks on itself**: Conclusion markdown and work-fold tool stdout could occupy the same box when a parent flex column crushed their height (`overflow: visible` expand bodies then painted over the answer). Transcript rows, timeline children, and `.chat-md--answer` no longer shrink; expand-body `overflow: visible` is only used inside a capped/virtual scroller.
- **Compact dialog overflow + help**: Long inline help on Compact context could exceed `.modal` max-height (`overflow: hidden`, no scroll body) and clip the Compact button. Descriptions move into a title `?` tip; the body scrolls and the footer stays pinned. Connect failure after confirm no longer fails silently.
- **Pathless「文件」tab no longer stays beside an opened file**: Opening a file from the tree replaces the picker Files chip. Picking Files again focuses the open file instead of minting a second dead tab (which did nothing and could stall the pane).
- **Slash palette `/rc` and `/review-` select `review-commit` (#644)**: Treat `-` as a word boundary so kebab initials match, rank name prefix above description, and keep description as fallback only when no name hits. Peer skills that mention `review-commit` in YAML no longer steal the default highlight.
- **Working rail overlap and leftover ANSI (#667, #672)**: Long live **工作中** rows no longer paint tool bodies over the next line; leftover `[39m` / `[32m` SGR after a dropped ESC is stripped. Mapped lists no longer flex-shrink into a 360px box that crushes expanded rows.
- **75Hz external-display chat scroll (#651)**: Virtual-list window updates pair `requestAnimationFrame` with an 8ms fallback so a missed vsync on a mixed 120Hz/75Hz Mac does not drop the scroll to a 37.5Hz stutter.
- **Command-palette search scroll and keyboard (#657)**: ⌘K results sit in a real scrollport (wheel / trackpad work). Arrow keys move a highlight; Enter opens the row; ⌘/Ctrl 1–9 still jump to the numbered session.
- **Included-usage exhaustion is no longer a generic provider error (#659)**: When Grok Build reports `subscription:free-usage-exhausted`, Host stops the 15-retry loop immediately and emits `QUOTA_EXCEEDED`. The chat card uses the CLI line “You hit your free usage limit.” (rolling 24-hour window + Account). A bare 429 / “rate limit, retry later” uses the CLI “Rate limited” / “Wait a minute” card, not the free-usage sentence.
- **Desktop notification click restores the session (#654)**: Clicking a native toast now unminimizes / focuses the main window and opens the chat that fired it (permission, ask-user, or turn-done). Windows uses a WinRT `on_activated` toast instead of the fire-and-forget plugin path; packaged macOS waits for the UN default action. Missing `sessionId` still focuses the app. `tauri dev` osascript toasts (Script Editor) still cannot deep-link.
- **Skills catalog matches CLI discovery (#653)**: Settings → Extensions → Skills no longer keeps listing Claude/Cursor compat skills after Grok Build has them turned off. `skills_list` now runs `grok inspect` with the session `GROK_HOME` and drops `~/.claude` / `~/.cursor` rows when `[compat.claude] skills` or `[compat.cursor] skills` is false (or the new App overlay is off). Slash / + pickers share the same list.
- **Premature 工作了 + copy/retry while the turn is still running (#670)**: Host no longer emits stream `done` while the prompt or tools are still open. A later finished fragment folds into the live sibling without duplicating answer text. Copy/MD/retry stay hidden until Ready.
- **Windows huge assistant replies / paste become a .txt card (#647)**: On Windows only, a single reply or clipboard paste ≥ 8000 characters is shown as a short preview plus a file card (or attached as `.txt`). macOS / Linux keep full markdown and normal paste. Find-in-chat still shows the full body.
- **New chat no longer restores a leftover first prompt**: Each project keeps a new-session composer buffer. After send, that buffer was often left on disk (`#620` leftovers, or a mid-type snapshot that is not byte-identical to the sent text). Restore now drops buffers that match a recent send **exactly**, as a **prefix** of that send, or as a **short first-line fragment** (e.g. saved `好的` / `d` vs sent `好的` / `你看好了吗？`). Attachment-only unsent drafts still restore. A follow-up send on an existing thread does not wipe a new-task buffer that still has extra files.
- **Shift+Enter first press starts a new line**: The composer stored `\n` but re-projected a trailing `<br>`, which WebKit treats as an empty-editor sentinel (first Shift+Enter looked like a no-op). Each line is now a `div`; a trailing empty line is marked `data-composer-nl="1"` so serialize keeps the newline and the caret stays on that line. ZWSP caret pads are not used for this path (they split IME 汉字).
- **Windows taskbar icon no longer looks a size smaller (#650)**: `icon.ico` is generated from a fill-cropped raster so the mark fills the frame. macOS `icon-source.png` / `.icns` stay on the dock-grid master.
- **Side workbench file tabs and per-project isolation (#661 slice)**: Inactive file chips show a filename (and a short parent path on collisions). Switching projects stashes that project's tabs. Opening Files shows the tree and adopts the placeholder chip instead of minting a second pathless tab. The CodeMirror editor from the same PR is **not** in this slice.

**中文 · 修复**
- **选区注释弹窗层次**：评论框用输入井，不再和面板糊成一块；摘录仍是普通截断文本。
- **一直卡在「连接中」、只能重启**：顶栏药丸按当前会话投影（别的会话在握手时，这个聊天不再显示连接中）。整段 connect 有 90 秒墙钟；握手期间进程退出会离开 Connecting；未完成的握手不再被当成健康活进程。`session/set_mode` 改到 Ready 之后。点击药丸或「重新连接」可取消并重试，按钮不再因连接中被禁用。
- **对话出图那一下不再卡死（#675、#676）**：卡片首屏改占位或缓存缩略图，不再先解完整原图。Host 缓存命中读 sidecar / JPEG 头拿宽高，不再为读尺寸再解一遍原图。
- **助手正文不再叠字**：结论 Markdown 和工作轨里的工具输出会被父级 flex 压扁到同一块区域（展开体 `overflow: visible` 再盖到答案上）。消息行、时间线子项和 `.chat-md--answer` 不再被压缩；只有带滚动条的工作列表才允许展开体溢出。
- **压缩弹窗过长、按钮被裁切**：原先说明全铺在弹窗里，超出 `.modal` 最大高度后底部「压缩」被裁掉（容器 `overflow: hidden`、没有可滚 body）。说明收到标题旁 `?`，正文可滚、底部按钮固定。确认后连不上 Agent 也不再静默失败。
- **空的「文件」tab 不再和已打开文件并排**：从树里打开文件会替换选择器里的「文件」占位。再点「文件」只会聚焦已打开的文件，不会再多出一个点了没反应、还会卡住侧栏的死标签。
- **斜杠菜单 `/rc`、`/review-` 会选中 `review-commit`（#644）**：把 `-` 当词界以匹配 kebab 首字母，名字前缀优先于描述，且只有名字全无命中时才用描述兜底。YAML 里互相点名 `review-commit` 的 skill 不再抢走默认高亮。
- **工作轨叠字和残留 ANSI（#667、#672）**：长「工作中」不再把工具正文盖到下一行；ESC 丢掉后残留的 `[39m` / `[32m` 会被剥掉。展开后的列表不再被压进 360px 盒子里叠字。
- **75Hz 外接屏聊天滑动（#651）**：虚拟列表窗口更新在 rAF 之外加 8ms 兜底，混用 120Hz/75Hz 时漏一帧不会掉成肉眼 37.5Hz。
- **命令面板搜索可滚动、可用键盘（#657）**：⌘K 结果有独立滚动区。方向键高亮，Enter 打开，⌘/Ctrl 1–9 仍跳到编号会话。
- **额度用尽不再显示成普通提供商报错（#659）**：官方返回 `subscription:free-usage-exhausted` 时，Host 立刻停转并记 `QUOTA_EXCEEDED`，气泡对齐 CLI 的 “You hit your free usage limit.”（滚动 24 小时窗口 + 账号）。普通 429 走 CLI 的 “Rate limited / 等一分钟再发”，不再和免费用量写成一句。
- **点击桌面通知回到对应会话（#654）**：点原生通知会还原/聚焦主窗口并打开发出该通知的会话。Windows 走带点击回调的 WinRT toast；已打包的 macOS 等 UN 默认点击。没有 `sessionId` 时仍只聚焦应用。`tauri dev` 的 osascript（脚本编辑器）通知仍无法回跳。
- **技能目录与 CLI 探测一致（#653）**：在 Grok Build 关掉兼容探测后，设置 → 扩展 → 技能不再继续列出 Claude/Cursor 技能。`skills_list` 用当前会话的 `GROK_HOME` 跑 `grok inspect`，并在 config.toml / 应用开关关闭时丢掉 `~/.claude`、`~/.cursor` 条目。斜杠 / + 选择器共用这份列表。
- **回合还在跑就出现「工作了」和复制/重试（#670）**：Host 在 prompt / 工具未结束时不再发 stream done。后到的完成片段并进仍在工作的那条，正文不重复。Ready 之前不显示复制 / MD / 重试。
- **Windows 超长回复/粘贴改为 txt 卡片（#647）**：仅 Windows，单条回复或粘贴 ≥ 8000 字改成预览 + 文件卡。macOS / Linux 仍是完整 Markdown / 正常粘贴。对话内查找仍显示全文。
- **新建对话不再带回已发送的残留**：每个项目有一份新会话输入缓冲。发送后这份缓冲常留在磁盘上（`#620` 残留，或和发出去的原文不完全相同的半截）。恢复时会丢掉与最近发送**完全相同**、作为其**前缀**、或**短且首行相同**的碎片（例如存的是 `好的` / `d`，发出去的是 `好的` / `你看好了吗？`）。只有附件的未发送草稿仍会恢复。在已有会话里跟进发送时，如果新任务缓冲还带着这份发送里没有的附件，不会整份清掉。
- **第一次 Shift+Enter 就会换行**：原先存的是 `\n`，重绘却是尾部 `<br>`，WebKit 把它当成空编辑器哨兵，第一次换行看起来没反应。现在一行一个 `div`，末尾空行标 `data-composer-nl="1"`，序列化会保留换行，光标留在新行。这条路径不再用 ZWSP 占位（会拆开输入中的汉字）。
- **Windows 任务栏图标不再小一号（#650）**：`icon.ico` 按去留白后的画布生成。macOS 母版 / `.icns` 不动。
- **侧栏文件 tab 名 + 按项目隔离（#661 切片）**：未激活的文件芯片显示文件名（重名时带上一级路径）。切换项目会收起该项目的 tab。打开 Files 显示树，并用占位芯片承接真实文件，不再并排多一个无路径 tab。同一 PR 里的 CodeMirror 编辑器不在本切片。

## [0.2.20] - 2026-08-17

> **Highlight:** Grok Build-compatible custom relay; local session list/continue API; official-site installer aliases; opening a chat shows a real loading state instead of a fake empty session.
>
> **中文 · 亮点：** Grok Build 原生兼容中转；本机会话列表/续跑接口；官网安装包稳定别名；打开会话先显示加载而不是空会话。

### Added
- **Grok Build-compatible custom relay (#634, supersedes #617)**: Settings → Account → Custom providers has **Provider mode**. Generic stays on `[model.<alias>]`. **Grok Build-compatible relay** is an explicit opt-in: Responses only, save reads live `/models` and requires `supports_backend_search=true` for every selected model, ACP launches the real model id with process-scoped catalog/proxy env (no hostname special case, no official-aux auto-enable). CC Switch `grokbuild` imports honor an explicit mode; otherwise they promote only when that live catalog claim is present. Attachments stay `@path` (same as #627).
- **Composer `/workflow` and `/workflows`**: Slash palette matches Grok Build CLI. `/workflows` or bare `/workflow` opens Settings → Runtime → workflows (saved scripts + smoke/run). `/workflow <name|pause|resume|stop|save …>` is sent as a session turn so the agent/CLI host can run it. This App still has no TUI run dashboard.
- **User menu lists every saved official account (#621)**: Each row shows honest SuperGrok remaining % (never invents 0% / 100% on a failed probe). Click another account to `account_switch`; click the active row for Settings → Account. Custom-provider / signed-out cards stay as they are.
- **Local session API (list + continue, #626 first slice)**: Other apps on this machine can list Grok App chats and continue one by session id + prompt. Loopback HTTP (`GET /v1/sessions`, `POST /v1/sessions/{id}/turns`) is token-gated; CLI `--sessions` / `--session-send` talks to the same Host path and does not steal window focus. List can read the on-disk index when the app is quit; sending requires the app (or tray) and never interrupts a running turn. Settings → Runtime → Connection shows status and the token-file location (never the token).
- **External follow-ups join the composer queue while a turn is running**: If that chat is mid-turn (drawing, tools, streaming), `POST /v1/sessions/{id}/turns` returns `queued` (HTTP 202) and the prompt appears on the same follow-up strip above the composer. It sends when the turn ends. The current turn is not interrupted.
- **Install a `grok-app` terminal command from Settings**: Runtime → Connection → Session API can symlink (or write a Windows `.cmd` shim) to `~/.local/bin/grok-app` pointing at the running binary. No sudo, no shell-rc edits, will not overwrite a foreign file. New terminals still need `~/.local/bin` on `PATH`.
- **Official-site download contract**: Each tagged Release also publishes unversioned installer aliases (`Grok_mac_x64.dmg`, `Grok_windows_x64-setup.exe`, …) plus `downloads.json`. The upcoming grok-app.com buttons can pin `/releases/latest/download/…` and stay on GitHub’s CDN (no site bandwidth). Settings → About prefers those aliases when present.

**中文 · 新增**
- **Grok Build 原生兼容中转（#634，替代 #617）**：设置 → 账户 → 自定义提供商新增 **提供商模式**。通用模式仍写 `[model.<别名>]`。**Grok Build 原生兼容中转** 必须显式打开：只走 Responses，保存时读实时 `/models`，每个所选模型都要 `supports_backend_search=true`，ACP 用真实模型 id 和进程级目录/代理环境启动（不按主机名特判，也不自动打开 official-aux）。CC Switch `grokbuild` 导入尊重已写明的模式；否则只有实时目录声明了该能力才会提升。附件仍走 `@path`（与 #627 相同）。
- **输入框 `/workflow` 与 `/workflows`**：斜杠菜单对齐 Grok Build CLI。`/workflows` 或单独的 `/workflow` 打开设置 → 运行时 → 工作流（已发现脚本 + 试跑）。`/workflow <名称|pause|resume|stop|save …>` 作为会话回合发出，由 agent / CLI 托管运行。本应用仍没有终端里的运行看板。
- **头像菜单列出全部已保存官方账号（#621）**：每行显示诚实的 SuperGrok 剩余 %（探测失败不编造 0% / 100%）。点其他号走 `account_switch`；点当前号仍进设置 → 账户。自定义提供商 / 未登录卡片不变。
- **本机会话接口（列表 + 续跑，#626 第一刀）**：同一台机器上的其他应用可以列出 Grok App 会话，再用会话 ID + 提示词续跑同一条。回环 HTTP（`GET /v1/sessions`、`POST /v1/sessions/{id}/turns`）用令牌鉴权；CLI `--sessions` / `--session-send` 走同一条 Host 路径，不会抢窗口焦点。列表在应用退出后仍可读磁盘索引；发送需要应用（或托盘）在跑，且不会打断正在进行的一轮。设置 → 运行时 → 连接 显示状态和令牌文件位置（不展示令牌）。
- **会话正忙时外部跟进入输入框上方的队列**：该会话正在跑一轮（绘画、工具、流式）时，`POST /v1/sessions/{id}/turns` 回 `queued`（HTTP 202），提示词出现在同一条跟进队列条上，本轮结束后再发。当前轮不会被打断。
- **设置里可安装 `grok-app` 终端命令**：运行时 → 连接 → 会话接口会把用户级命令装到 `~/.local/bin/grok-app`（Unix 符号链接 / Windows `.cmd`），指向当前正在跑的二进制。不需要 sudo，不改 shell 启动脚本，也不会覆盖别人的同名文件。新终端仍需把 `~/.local/bin` 放进 `PATH`。
- **官网下载契约**：每个正式 Release 额外上传不带版本号的安装包别名（`Grok_mac_x64.dmg`、`Grok_windows_x64-setup.exe` 等）和 `downloads.json`。之后 grok-app.com 的按钮可以写死 `/releases/latest/download/…`，流量仍走 GitHub。设置 → 关于 在有别名时优先用它们。

### Changed
- **README Gatekeeper copy**: Official Releases from v0.2.19 are Developer ID signed and Apple-notarized. The `xattr` workaround stays for forks / older unsigned builds.
- **Assistant process vs answer**: Mid-turn speech and folded actions (explore / run / edit) live inside one **工作了** fold (collapsed by default). The conclusion stays visible below. Journal CoT stays a separate **思考了** row — not dumped into the rail or mashed into the answer.

**中文 · 变更**
- **README Gatekeeper 说明**：官方 Release 从 v0.2.19 起已签名并公证。`xattr` 仅留给 fork / 旧的未签名包。
- **助手过程与结论分开**：中间穿插的话和折叠动作（探索 / 运行 / 编辑）收进同一条「工作了」（默认收起），结论始终在下面。日记 CoT 仍是单独的「思考了」，不灌进活动轨，也不和结论挤在一起。

### Fixed
- **Opening a session no longer looks like a new empty chat**: While the journal is still on disk, the thread shows a spinner and “Loading conversation” instead of “Start chatting” plus the “agent failed to connect” banner. Journal text paints before relative-media / path-classify IPC. After HMR remount, a selected session re-opens instead of looking empty.
- **Transcript wheel over message bodies**: The 4096px inner scroller from the long-chat fix ate vertical wheel in WebKit. Drop the nested scroller; the virtual list still windows long threads. Horizontal code/table scrollers use `overflow-y: clip`.
- **Chat image previews**: Project-relative markdown images (`design-demos/shots/foo.png`) resolve from attachments instead of painting an empty alt card. A first-paint miss (file still being written, or path grant not ready) retries instead of locking the card as broken.
- **Windows file / image drop into the composer**: WebView2 cannot use HTML5 `Files` while Tauri owns the drop target. Windows builds now set `dragDropEnabled: false` and handle Explorer drops in capture-phase HTML5 (temp-file attach when `File.path` is missing). Overlay + `@path` still work.
- **Linux maximize / minimize**: Linux was decorated with no in-app caption buttons, and GTK/Wayland often no-ops `toggleMaximize`. Linux is now frameless with the same min/max/close chrome as Windows; maximize falls back to filling the monitor work area when the compositor ignores GTK.
- **Long chat / long article blanks the transcript** (community, [@y7469591](https://x.com/y7469591/status/2088917279966917116)): One huge message or spacer could exceed the WebView compositor layer and paint white (scroll also stuck). Virtualize by estimated height, split tall spacers, and cap a single message body at 4096px with inner scroll.
- **Fork no longer pins the parent chat on 连接中**: After `_x.ai/session/fork` the CLI is still hydrating parent context. Post-open `session/set_mode` used to walk every agent-mode alias (`agent` / `default` / `code` / `normal` / `Agent`) at 45s each — ~4 minutes of handshake, no `session/prompt`, both the fork and the original chat stuck on Connecting / Thinking. Fork skips that nudge (spawn already has `--permission-mode`); any later `set_mode` transport timeout aborts the remaining aliases.
- **New-session composer no longer restores the just-sent prompt (#620)**: Sending from the New session page materializes a chat and leaves the draft view, so persist-clear used to be skipped. The per-project new-session buffer is now wiped on success.
- **Telegram topic replies stay in the topic (#623)**: Inbound `message_thread_id` is kept and sent back on `sendMessage` / cards / edits. With **thread isolation** on, each topic is its own agent binding.
- **Custom Grok / vision relays can read image attachments (#618)**: Settings → Account → Custom providers has **This model can see images**. Grok / GPT-4o / Claude / Gemini names already count. Unknown relays stay text-only so DeepSeek-style APIs do not 400 on `image_url`. Vision mains keep `@path` pixels and no longer hit the `read_file` image hook.

**中文 · 修复**
- **打开会话不再先画成新空聊天**：日志还在读盘时，中间是转圈和「正在加载会话内容」，不再出现「开始对话」和「连接 Agent 失败」横幅。相对路径媒体和 path classify 不再挡住整段日志的第一帧。热更新后若会话还在、缓存没了，会重新打开而不是空会话。
- **消息正文上滚轮被吃掉**：长对话修复里的 4096px 内层滚动在 WebKit 里会吞掉纵向滚轮。去掉嵌套滚动；长对话仍由虚拟列表窗口化。代码/表格横向滚动用 `overflow-y: clip`。
- **聊天图片预览**：项目相对路径的 markdown 图（`design-demos/shots/foo.png`）会跟附件对上，不再画出一张空的 alt 卡。文件还没写完或授权还没落到的第一次失败会重试，不再把卡片锁死。
- **Windows 无法把图片/文件拖进输入框**：Tauri 接管 WebView2 拖放后 HTML5 `Files` 是空的。Windows 现在关掉原生 drop handler，改用捕获阶段 HTML5（没有 `File.path` 就存临时文件再附加）。
- **Linux 无法最大化/最小化**：以前走系统标题栏、应用内没有按钮，GTK/Wayland 上 `toggleMaximize` 经常没反应。Linux 改为与 Windows 一样的无边框自绘按钮；合成器忽略 GTK 最大化时，退化为铺满工作区。
- **长对话 / 长文章后聊天变空白、滚不动**（社区反馈 [@y7469591](https://x.com/y7469591/status/2088917279966917116)）：超高消息或占位层会撑爆 WebView 合成层。现在按预估高度虚拟化、拆开超高 spacer，单条消息正文限高 4096px 内部滚动。
- **分叉后不再把原会话卡在「连接中」**：`session/fork` 之后 CLI 还在灌父会话。以前会连试 5 个 `session/set_mode` 别名，每个等 45 秒，握手约 4 分钟，消息发不出去，分叉和原会话一起停在连接中/思考中。分叉后不再做这次 nudge；之后若 `set_mode` 是传输超时，立刻停掉剩余别名。
- **新建会话发送后不再把刚发出的草稿带回来（#620）**：从「新建会话」发出去会落成真实会话并离开草稿页，以前会跳过清空。成功后现在会清掉该项目的新建会话草稿。
- **Telegram 话题回复回到原话题（#623）**：入站保留 `message_thread_id`，出站 `sendMessage` / 卡片 / 编辑一并带回。打开 **按话题隔离** 后，每个 Topic 是独立 Agent 绑定。
- **自定义 Grok / 识图中转能读图片附件（#618）**：设置 → 账户 → 自定义提供商可勾 **这个模型能看图**。名称或模型 id 带 Grok / GPT-4o / Claude / Gemini 的通道本身就算。未知中转仍按纯文本，避免 DeepSeek 类接口被 `image_url` 打 400。识图主模型保留 `@path` 像素，不再被 `read_file` 读图 hook 拦住。

## [0.2.19] - 2026-08-15

> **Highlight:** SuperGrok quota auto-refresh every 10 minutes; macOS Release notarization when Apple secrets are present; first launch follows the OS language; mid-turn steer no longer flashes the transcript; composer clears as soon as the user bubble appears.
>
> **中文 · 亮点：** SuperGrok 额度每 10 分钟自动刷新；仓库配齐 Apple secrets 后 macOS Release 会公证；首次安装跟随系统语言；中途引导不再闪聊天；发送后输入框立刻清空。

### Changed
- **Official SuperGrok quota auto-refresh**: Background probe every **10 minutes**. Settings → Account, the sidebar user-menu (remaining %), tray Usage, and the usage-limit modal all follow the same snapshot. Quiet billing-only ticks (no spinner, no heatmap walk); last good numbers stay on soft-fail.
- **macOS Release signing / notarization**: When Apple Developer ID + App Store Connect API secrets are present, `release.yml` codesigns and notarizes the `.app` / `.dmg` (Hardened Runtime entitlements include microphone + camera). Forks without secrets stay unsigned.

**中文 · 变更**
- **官方 SuperGrok 额度自动刷新**：后台每 **10 分钟**拉一次。设置 → 账户、主页左下角用户面板（剩余 %）、托盘 Usage、用量限制弹层共用同一份快照。后台为静默、只刷新账单（不扫热力图）；失败时保留上次数字。
- **macOS Release 签名 / 公证**：仓库配齐 Developer ID + App Store Connect API secrets 后，`release.yml` 会对 `.app` / `.dmg` 做 codesign 与公证（Hardened Runtime 含麦克风 / 摄像头 entitlements）。未配 secrets 的 fork 仍出未签名包。

### Fixed
- **Chat no longer flashes after mid-turn steer**: Leftover Host chunks on the pre-steer assistant id no longer revive that bubble. The Worked-for rail stays a one-line header (full tool list is capped) instead of swapping collapsed ↔ hundreds of rows.
- **Composer clears as soon as the user bubble appears**: Send no longer waits for `ensureConnected` / `sessionSend` to wipe the input. A failed send puts the text back if the box is still empty; follow-up typed during a slow send is never wiped.
- **Follow system language on first launch**: New installs default `settings.locale` to **System**. Host reads macOS AppleLanguages / Windows UI language (not just `LANG=C`), so a Chinese OS opens in 简体/繁體. Existing installs that still have the factory `en` lift once to System (explicit 简体/繁體 stays). Boot splash and tray follow the same probe.
- **English token units (#613)**: Context-window chip, composer model menu, phone tools sheet, heatmap, and account call-log counts use **K / M / B** when locale is `en` (e.g. `500K`, `1M`) instead of Chinese 百/千/万. zh / zh-TW still use 万·萬 / 亿·億.

**中文 · 修复**
- **中途引导后聊天不再狂闪**：旧助手 id 上残留的 Host 分片不再把已冻结气泡重新标成 streaming。「工作了」活动轨保持一行标题（工具列表有高度上限），不会在收起和整段工具行之间来回切。
- **发送后输入框立刻清空**：用户气泡一出现就清 composer，不再等连接 / `sessionSend` 成功。发送失败且框仍空时回填原文；慢发送期间新打的字不会被清掉。
- **首次安装跟随系统语言**：新安装默认「跟随系统」。Host 读取 macOS AppleLanguages / Windows 界面语言（不再只看经常为空的 `LANG`），中文系统会直接进入简体/繁体。旧安装里仍是出厂 `en` 的一次性改成跟随系统（用户已选的中文不变）。启动页与托盘同一套探测。
- **英文 Token 单位 (#613)**：界面语言为英文时，上下文芯片、模型菜单、热力图与通话记录显示 **K / M / B**，不再混用「万 / 千 / 百」。简体/繁体仍用中文计数单位。

## [0.2.18] - 2026-08-14

> **Highlight:** TUI-parity Usage limit (`/usage`, `/cost`) with this-session spend plus heatmap Tokens / Cumulative stats; long image and tool turns no longer die at 4 hours; Windows Settings Agent tab no longer flashes a black console; chat image cards survive remount.
>
> **中文 · 亮点：** 对齐 TUI 的用量限制（`/usage` / `/cost`，含本会话花费）+ 热力图 Tokens / 累计视图；长图/工具回合不再 4 小时被掐；Windows 设置 Agent 页不再闪黑框；聊天图片卡片回合结束后仍能显示。

### Added
- **Usage limit (`/usage`, `/cost`)**: TUI-parity weekly SuperGrok bar plus this session’s token spend since start or last resume (input/cached, output/reasoning, total, cache hit, model calls, API time, cost). Also from the composer context-chip menu. Official route only for the weekly quota; custom routes stay honest.
- **Account heatmap call log Tokens column**: Each recent session row now shows billing usage (same `turn_completed` sum as the heatmap) next to context occupancy.
- **Account heatmap stats strip**: Codex-style totals — cumulative tokens, peak day, longest chat, current / longest streak — plus a **Cumulative** calendar view (running-total color).

**中文 · 新增**
- **用量限制（`/usage` / `/cost`）**：对齐 TUI 的本周 SuperGrok 额度条，加上本会话（自开始或上次续跑）的 token 花费（输入/缓存、输出/推理、合计、缓存命中、模型调用、API 时长、费用）。也可从 Composer 上下文芯片菜单打开。周额度只走官方路由；自定义路由保持诚实空态。
- **账号热力图通话记录 Tokens 列**：最近会话每一行在上下文占用旁显示计费用量（与热力图同一套 `turn_completed` 汇总）。
- **账号热力图统计条**：Codex 风格合计 — 累计 tokens、峰值日、最长聊天、当前/最长连续天数 — 以及 **累计** 日历视图（按累计总量上色）。

### Fixed
- **Long image / tool turns no longer die at 4 hours**: `session/prompt` wait is silence-only (30 minutes with no `session/update`). Fresh progress re-arms the clock; there is no absolute turn-age ceiling. Batch image jobs that were still working used to get `TURN_TIMEOUT` at 4h.
- **Windows Settings → Agent no longer flashes a black box**: Opening the Agent tab (and other similar surfaces) no longer pops a console window (`git` / `rg` / `tasklist` / `taskkill` / `reg`) and no longer paints native number/date/time inputs with the OS dark scheme. WebView2 now boots with the same light/dark theme as the page.
- **Usage modal cache > input, then empty**: Session spend only sums `turn_completed` snapshots. Cache-heavy fragments (cache > input, no `modelCalls`) are dropped so cached cannot exceed input; a real turn without `modelCalls` still counts. Totals persist in sessionStorage, and an in-flight turn says usage updates when it finishes.
- **Chat image cards no longer die after the turn ends**: Leftover remote https thumbs (web-fetch charts, etc.) first-paint from the in-memory thumb cache on journal remount. Swapping `src` mid-load used to abort the original `<img>` and lock `broken_blob` (“preview failed”). Abort / stale-src errors are ignored; a working https original is not wiped when thumb resolve returns empty.

**中文 · 修复**
- **长图 / 工具回合不再 4 小时被掐**：`session/prompt` 只按静默超时（30 分钟没有任何 `session/update`）。有新进度就重新计时，没有绝对回合年龄上限。以前还在跑的批量出图会在 4 小时拿到 `TURN_TIMEOUT`。
- **Windows 设置 → Agent 不再闪黑框**：打开 Agent 页（以及类似表面）不再弹出控制台窗口（`git` / `rg` / `tasklist` / `taskkill` / `reg`），也不再用系统深色方案画原生数字/日期/时间输入。WebView2 启动主题与页面一致。
- **用量弹层缓存大于输入然后变空**：会话花费只汇总 `turn_completed` 快照。缓存大于输入且没有 `modelCalls` 的碎片会被丢掉，避免 cached 超过 input；没有 `modelCalls` 的真实回合仍计入。合计写入 sessionStorage；进行中的回合会提示结束后再更新。
- **聊天图片卡片回合结束后不再挂掉**：journal 重挂时远程 https 缩略图先从内存缓存首屏。中途改 `src` 以前会中止原来的 `<img>` 并锁成 `broken_blob`（「预览失败」）。中止 / 过期 src 错误会被忽略；缩略图解析为空时不会抹掉还能用的 https 原图。

## [0.2.17] - 2026-08-14

> **Highlight:** Stability release — shared-process session isolation (no cross-chat history poisoning, per-session turn completion), thinking timer stays live across tool loops, chat bottom jitter gone, side-terminal Powerline/truecolor, MCP OAuth follows the selected server, and macOS no longer crashes on voice.
>
> **中文 · 亮点：** 稳定性版本——共享进程会话隔离（历史不再互灌、收尾按会话隔离）、思考计时全程在线、聊天贴底不再抖动、侧栏终端 Powerline/真彩、MCP 授权跟所选服务器走、macOS 语音不再闪退。

### Fixed
- **macOS no longer aborts on voice / media-device probe**: Info.plist now includes `NSCameraUsageDescription`. WKWebView `getUserMedia` (even mic-only) enumerates cameras; missing the key is a TCC `SIGABRT`, not a permission dialog. Live Voice also passes `video: false`.
- **Thinking timer no longer dies mid-turn or after switching chats**: Later think→tool loops stay on “思考中 / Thinking for …” (not frozen “思考了”) even after the first status sentence. Switching away and back while the agent is still running keeps `streaming` and restores the live assistant from Host state, so journal reconcile cannot paint a finished thought over a live turn. The live clock follows the turn start and resumes when the window is shown again.
- **Model / floating menu flicker** (#602): When a portal menu sits above its trigger, `maxHeight` is no longer rewritten from the already-capped rendered height (`ph + 8`). That write-back plus `ResizeObserver` grew the panel every frame.
- **Side terminal Starship / Powerline** (#603): Multi-word Nerd Font families are quoted (WebKit no longer splits them onto unpatched JetBrains Mono). The stack prefers Mono faces; xterm loads the WebGL addon so Powerline extras fill the cell. PTY spawn drops inherited `NO_COLOR` and forces truecolor.
- **MCP authorize uses the selected server** (#605): Host OAuth discovery no longer tries ChatCut's well-known metadata first. Authorizing Appwrite (or any other remote MCP) opens that provider's consent screen, not `api.chatcut.io`. ChatCut still works — its metadata is derived from its own MCP URL. Loopback success page is generic (no longer says "ChatCut").
- **Chat jitter at the bottom**: Leaving the end no longer re-pins from the 100px near band (a trackpad bounce used to snap back). Virtual-list pin snaps are not treated as a user fling, so spacer remasure cannot bounce the tail.
- **Fork / connecting send queue**: A first message after fork (or during warm-connect) no longer parks in the follow-up queue. Handshake `connecting` is not a live turn — Send goes through `ensureConnected`. Queue **Steer** becomes **Send now** when no turn is running.
- **Agent turn finish no longer drops the last stream batch**: Process crash / RPC fail now flushes the coalesced `session://stream` buffer and journal tail before clearing the live slot (answers no longer stop mid-sentence).
- **Early `prompt_complete` no longer discards a silent long tool**: Host keeps the turn deferred while tools are still open instead of force-clearing them after 3s and treating later chunks as load-replay.
- **Shared-process prompt complete is per session**: `last_update` and waiter matching no longer let chat B's stream finish or extend chat A's turn.
- **Stop / stall during Host vision no longer marks a scheduled task as run**: `send_message` returns `TURN_CANCELLED` when the turn was cleared before `session/prompt`; automations do not advance `next_run_at`.
- **YOLO / effort / proxy mid-turn actually apply after the turn**: Busy `soft_respawn` is queued; parked agents with stale `--reasoning-effort` / permission flags are dropped so the next connect cold-spawns. Fixes Grok 4.6 Extra High not taking effect (#598) and UI “Ask” while the CLI still has `--always-approve`.
- **Allow for session on write/edit tools no longer cancels the turn (#600)**: When the CLI list has no session-scoped option, Host answers with `allow-once` (and still caches session scope) instead of inventing `always-allow`.
- **Stop cancels pending tool permission** (not only ask/plan), so reconnect is not stuck on an unanswered `request_permission`.
- **Media path grant is file-exact**: `paths_classify` / `grant_path` no longer authorize the parent directory (no sibling read of e.g. `~/.ssh`).
- **Composer draft is kept until send succeeds**; send targets the viewing chat, not a stale shell session id. Text or attachments added while a slow send is in flight are never wiped by the success cleanup.
- **Changing proxy settings respawns warm agents** so the new `HTTP_PROXY` is picked up.
- **Background turns honor provider `RetryState`**: switching away no longer leaves a hung chat until the CLI idle/absolute timeout; Host applies the same abort + `NETWORK_PROVIDER` path as the focused session.
- **cwd-relative downloads (`curl -O` / `wget` without `-o`) prompt** unless YOLO — no longer assumed to write inside the project.
- **Opening another chat no longer dumps its history into a still-streaming one**: Host will not warm-reuse a CLI process that already has a mid-turn background (or live) session. The other chat cold-spawns. Idle parked / idle background reuse is unchanged.

**中文 · 修复**
- **macOS 语音/枚举媒体设备不再闪退**：`Info.plist` 补上 `NSCameraUsageDescription`。WKWebView 即使只开麦克风也会扫摄像头，缺这个 key 会被 TCC 直接 `SIGABRT`，不会弹出授权框。Live Voice 申请媒体时显式 `video: false`。
- **思考计时不再在中途或切会话后停住**：第一句正文之后的 think→tool 轮次仍显示「思考中」并继续走秒。切走再切回时保留 `streaming`，并按 Host 状态把当前助手标回直播，避免 journal 回灌把还在跑的一轮画成「思考了」。
- **模型/浮层菜单底边闪烁**（#602）：菜单在触发器上方时不再把已受 `max-height` 限制的渲染高度 `+8` 回写成新上限；避免 `ResizeObserver` 正反馈。
- **侧栏终端 Starship / Powerline**（#603）：多词 Nerd Font 族名加引号，优先 Mono 面；xterm 走 WebGL 画分隔符；PTY 去掉宿主带来的 `NO_COLOR` 并强制 truecolor。
- **MCP 授权跟所选服务器走**（#605）：OAuth 发现不再先打 ChatCut 的 well-known。给 Appwrite 等其它远程 MCP 点授权时，打开的是该服务商的登录页，而不是 `api.chatcut.io`。ChatCut 仍可用（从它自己的 MCP URL 推导元数据）。回环成功页不再写死 ChatCut。
- **聊天滚到底部抖动**：离开底部后不会因为还在 100px 近底带里就被拽回去；虚拟列表的贴底写入不再被当成用户甩动，避免 spacer 重测把尾巴弹一下。
- **分叉后发不出消息**：预热连接中的 `connecting` 不再把第一条消息当成跟进入队。握手不是进行中的回合；发送走 `ensureConnected`。无回合时队列「引导」改为「立即发送」。
- **回合结束不再丢掉最后一批流式字**：进程崩溃 / RPC 失败会先刷出合批缓冲和 journal 尾巴。
- **提前 `prompt_complete` 不再丢掉仍在跑的静默工具**：不再 3 秒后强清 open tools，后续 chunk 也不会被当成 load-replay 丢掉。
- **共享进程的收尾按会话隔离**：A 的回合不会被 B 的流续命或提前结束。
- **Stop / 准备阶段取消不再把定时任务标成已跑**：未真正派发 `session/prompt` 时返回 `TURN_CANCELLED`。
- **回合中改 YOLO / 推理强度 / 代理会在本轮结束后重生进程**：修好 Grok 4.6 极高不生效（#598）以及 UI 已是「询问」但 CLI 仍 `--always-approve`。
- **写文件等工具点「会话内允许」不再整轮取消（#600）**：没有 session 档 option 时用列表里的 `allow-once` 作答。
- **Stop 会取消未答复的工具权限**，避免重连卡在 `request_permission`。
- **媒体路径只授权该文件本身**，不再授权父目录。
- **发送失败前不丢草稿**；发送目标跟当前查看的会话，而不是过期的 shell id。发送期间新输入的文字/附件也不会被成功后的清空吞掉。
- **改代理设置会回收 warm 进程**。
- **后台回合也认 provider RetryState**：切走后不再空转到 CLI 超时，和前台一样熔断并记 `NETWORK_PROVIDER`。
- **不带 `-o` 的下载默认要批准**（YOLO 除外）。
- **打开另一条会话不再把对方历史灌进还在跑的聊天**：有回合在跑的 CLI 进程不再给别人 warm-reuse，另一条会话会单独冷启动。空闲 parked / 空闲后台的复用不变。

## [0.2.16] - 2026-08-13

> **Highlight:** Official default is Grok 4.6 with Extra High (`xhigh`); Changes / Remote IM / Voice / workbench honesty remediations; Amux/Yun effort ids match official `low`/`medium`/`high`/`xhigh`.
>
> **中文 · 亮点：** 官方默认 Grok 4.6 + 极高推理；Changes / Remote IM / Voice / 工作台诚实整改；Amux/云驿思考档与官方枚举对齐。

### Added
- **Grok 4.6 + Extra High effort**: Official catalog default is `grok-4.6` (4.5 stays selectable). Composer shows 极高/`xhigh` on 4.6; product default effort on 4.6 is **xhigh**. One-shot settings lift `grok-4.5` → `grok-4.6` and official `high` → `xhigh`. Amux/Yun presets list both models. Official aux / spawn target is `grok-4.6`.
- **Per-provider appended prompt**: The provider editor gains an **Appended prompt** box for relays that need specific instructions. It rides the CLI's `--rules` flag, so the text is *appended* to the agent's system prompt rather than replacing it (`--system-prompt-override` would drop the built-in prompt). Stored per channel in agent-home `config.toml` as `app_append_prompt` (ignored by Grok Build), merged at connect alongside session rules. Empty by default.
- **X evidence citation honesty (wallpaper lite)**: Wallpaper X gallery shows **X post** (canonical `x.com/…/status/…` open-in-browser) or **Unverified** when no status URL; empty search soft-fails with honest summary; applying an X wallpaper records a small local evidence ring (`localStorage` path + url meta, no cloud / no full MCP SaaS). Pure `xEvidenceCitation` helpers + tests; Host normalizes `postUrl`; en/zh/zh-TW.
- **Bridge resilience overview honesty**: Settings → Remote control → IM overview surfaces recovery reconnect, always-on rate-limit/backoff policy notes (8/chat · 40 global / 60s · cap 60s), sanitized last-error, and soft-fail empty states for channels/timeline during crash recovery (never invents links or events). Pure helpers in `resilience.ts` + tests; i18n en/zh/zh-TW.
- **Resources multi-tab + split tree polish**: Files workbench keeps preview | tree simultaneous when the tree is open (no stack flip on open). Multi-file tabs: close-active, dirty discard honesty (side-tab markers + confirm), max-tab soft-fail (prefer drop clean LRU; i18n notice). Tree filter / expand persist / width persist residual fixes. Pure helpers + vitest (`resourceTabs`, `resourceTree`).
- **Review / Changes empty honesty**: Classify no-repo · no-git · load-error · empty · filter-empty for Resources → Changes and Side Review (never pretends a clean tree on Host/git failure). Kind chips when workspace has mixed kinds; path deep-link opens Resources preview; open-in-editor uses default Host editor with honesty errors. Pure `resourceChangesHonesty` helpers + tests; en/zh/zh-TW.
- **Changes accept/reject/restore honesty**: File and hunk actions show honest disabled reasons when snapshots are missing; git checkout soft-fails are classified (`not_a_git_repo` / `git_not_available` / path / checkout…); batch accept/reject reports partial success and untracked wipe confirm stays on GlassModal (never `window.confirm`).
- **Default open target / open-with honesty**: Settings → Open files with lists probed editors (unavailable preferred soft-disabled + empty/preferred-missing honesty); Open Location menus put the preferred editor first with icons; Resource/Review open-in-editor uses session/global default and soft-fails with i18n copy when the editor is missing. Pure selection helpers + tests; en/zh/zh-TW.
- **Sandbox product path honesty (F4)**: Settings → Permissions surfaces App **Workspace** default vs terminal CLI **Off**, Open sandbox guide wizard CTA, disabled-off soft-empty note, Linux userns / `SANDBOX_BLOCKED` platform note, and leader ↔ non-off sandbox mutual exclusion (also on Runtime → Leader). Wizard re-wired after project trust (when global profile is Off) and from project sandbox menu. Pure helpers + en/zh/zh-TW + tests.
- **Export path honesty**: Session export menu shows clear format labels (name + extension) with **Journal** / **CLI export** badges. Markdown full-transcript download prefers `grok export` when an agent session is linked (soft-fails to local journal); other formats and copy stay journal-only. Pure path-resolution helpers + tests; en/zh/zh-TW.
- **Live Voice delegate session honesty**: Overlay restores delegated/active session chips with real titles + liveMap progress while Live Voice is open; keep-agents default stays on (opt-out cancels turns). Soft-fail mic/auth/network/cli surfaces classified toasts in addition to overlay copy. Host never records blank delegated ids. Pure helpers + tests; existing en/zh/zh-TW `voice.err.*` / `voice.center.*`.
- **Composer voice dictation honesty**: Mic always visible with insert-vs-send tips (Settings auto-send), cancel mid-stream during requesting/transcribing (not hard-disabled), empty speech / auth soft-fail toasts without sticky error chrome, auto-send blocked soft-fail when permission-gated. Pure `voiceDictation` helpers + tests; en/zh/zh-TW. No Live Voice S2S in this residual.
- **Appearance fonts (#553)**: Settings → Appearance can set UI font family and side-terminal font family/size (localStorage; terminal prefers Nerd Fonts for Starship glyphs).
- **Preferred agent apply honesty (#564)**: Settings preferred-agent and Agents & Personas console document spawn-time `--agent` apply paths — live agent soft-respawns on change; idle waits for next connect. Soft-fail when the saved name is missing from the catalog or has invalid characters. Pure `preferredAgentApply` helpers + tests; en/zh/zh-TW.
- **Remote IM CN channels honesty**: DingTalk / WeCom / Weixin deep health always soft-fails incomplete bind fields and never shows **Connected** without Bridge running **and** instance linked; Weixin locks project/session picker to text menus (§6.9); no-live-claim hints + §6 field help polish. WPS xiezuo/agentspace stay retired.
- **Memory clear scopes + dream honesty**: Memory ops center GlassModal clear for host scopes **workspace / global / all** (real `grok memory clear` flags; no `window.confirm`). Dream/watcher chips remain config-presence only — never a live “running” status. Experimental memory stays **off** by default with `--no-memory` force-disable honesty.

**中文 · 新增**
- **Grok 4.6 + 极高推理**：官方默认模型改为 `grok-4.6`（4.5 仍可选）；4.6 显示极高/`xhigh`，产品默认 **xhigh**。旧安装一次性把全局 `grok-4.5` 抬到 4.6，官方 `high` 抬到 `xhigh`。
- **按提供商追加提示词**：编辑提供商表单新增**追加提示词**输入框，用于某些中转需要的针对性指令。它走 CLI 的 `--rules` 参数，因此是**追加**到系统提示词末尾，而不是替换。按渠道存在 agent-home 的 `config.toml` 里（键名 `app_append_prompt`），连接时与会话规则一并合并。默认为空。
- **沙箱产品路径诚实说明**：设置标明 App 默认 Workspace 严于 CLI Off；打开沙箱指南；Off 空态 soft 说明；Linux userns 提示；leader 与非 Off 沙箱互斥；信任项目后/项目菜单可再次打开向导。
- **导出路径诚实徽章**：导出会话菜单显示格式名+扩展名，并标注 **会话记录 / CLI 导出**。完整 Markdown 下载在已关联 agent 时优先 `grok export`（失败回退本地记录）；其他格式与复制仅用会话记录。纯路径解析 + 测试；中英繁。
- **实时语音委派会话诚实**：叠加层恢复委派/活动会话芯片（真实标题 + liveMap 进度）；结束后默认保留 Agent（关闭则取消回合）。麦克风/鉴权/网络/CLI 软失败额外 toast 分类文案。Host 不记录空委派 id。纯 helper + 测试；沿用三语 `voice.err.*` / `voice.center.*`。
- **Composer 口述诚实性**：麦克风始终可见并标明插入/发送；转写中可取消；空语音/鉴权 soft-fail；自动发送被权限挡住时提示已插入。纯 helper + 测试；三语文案。不含 Live Voice S2S。
- **默认打开目标 / 打开方式诚实提示**：设置「打开文件方式」列出探测到的编辑器（缺失首选软禁用 + 空/缺失诚实文案）；打开位置菜单优先默认编辑器并显示图标；资源/审查「在编辑器中打开」跟随会话/全局默认，缺失时 i18n 软失败。纯选择助手 + 测试；en/zh/zh-TW。
- **Changes 接受/拒绝/还原诚实态**：内容缺失时按钮给出禁用原因；git checkout 失败分类 soft-fail；批量接受/拒绝诚实汇总部分成功；未跟踪删除确认走 GlassModal（不用 `window.confirm`）。
- **审阅 / 变更空状态诚实**：区分非仓库 · 无 git · 加载失败 · 无变更 · 筛选无结果；混合类型时显示 kind 筛选；路径可点开预览；默认编辑器打开走诚实错误。纯 helper + 测试；三语文案。
- **资源多标签 + 分栏树打磨**：文件工作台在树可见时保持「预览 | 树」并排；多文件标签关闭/脏标记/上限 soft-fail；树筛选·展开·宽度残留修复；纯函数 + 测试。
- **Bridge 韧性总览诚实态**：设置 → 远程控制 → IM 总览提供恢复期「立即重连」、始终可见的速率/退避策略说明、脱敏 last-error，以及崩溃恢复时渠道/时间线软失败空态（不伪造链路或事件）。`resilience.ts` 纯 helper + 测试；三语文案。
- **X 证据引用诚实（壁纸轻量）**：壁纸 X 画廊展示 **X 原帖**（规范 status 链接可外开）或 **未验证**；空搜索软失败；应用 X 壁纸时写入本机证据环（path + url 元数据，无云端/不做完整 MCP）。纯 `xEvidenceCitation` + 测试；Host 规范化 `postUrl`；三语文案。
- **外观字体 (#553)**：设置 → 外观 可配置界面字体与内置终端字体/字号（本机偏好；终端优先 Nerd Font 以显示 Starship 图标）。
- **首选 agent 生效路径诚实 (#564)**：设置与 Agents & Personas 控制台标明 spawn `--agent` 路径 — 已连接 soft-respawn、空闲下次连接；目录缺失/非法名称 soft-fail。纯 helper + 测试；三语文案。
- **记忆清除范围 + Dream 诚实**：操作中心 GlassModal 清除 host 作用域 **workspace / global / all**（真实 CLI 参数，不用 `window.confirm`）。Dream/Watcher 仅表示配置存在性，绝不伪造「运行中」。跨会话记忆默认关闭并强制 `--no-memory`。

### Changed
- **Bulk select is findable**: Right-click any chat → **Select** enters multi-select with that chat already ticked (and anchored for Shift-range). The **Other chats** group header gains the same hover action the **Projects** header already had.
- **Goal session chrome menu**: Chat Goal chip (active on real `goal_updated`, dashed waiting when `/goal` is on with no harness events) opens a solid menu — Open Reliability · Copy summary · Clear local timeline (in-app confirm). Extracted `GoalOrchSessionChip`; still never invents progress.

**中文 · 变更**
- **批量选择变得找得到**：右键任意会话 → **选择**，直接进入多选并勾选该会话。**其他会话**分组标题补上与**项目**标题一致的悬停操作。
- **远程 IM 国内渠道诚实态**：钉钉 / 企微 / 微信个人 缺字段 soft-fail，未关联 Bridge 不显示「已连接」；微信强制文本菜单；无在线断言提示 + §6 字段帮助。WPS 协作/数字员工保持退役。
- **Goal 会话指示菜单**：有真实 `goal_updated` 显示阶段 chip，仅 `/goal` 无事件时虚线等待态；点击打开菜单（可靠性中心 / 复制摘要 / 清除本机时间线）。仍不虚构进度。

### Fixed
- **Grok preset effort catalog**: Amux / Yun presets use the official 4.6 enum (`low` / `medium` / `high` / `xhigh`, default Extra high). Legacy saved `max` ladders on those relays remap to `xhigh`. Blank custom channels still default to `max`.
- **Changes accept/reject/restore path guard**: Accept / reject / restore never write file B using another file’s after-text. Hunk accept confirms drop-the-rest, caches the full after-text before write, and rebuilds the open diff so later hunks compose. All-dirty tabs refuse a new open instead of discarding unsaved buffers. Patch join keeps the source trailing-newline state.
- **Remote IM empty / narrowed scope**: `{allow: []}` and out-of-scope bindings no longer spawn a turn (or fall back to `$HOME`). Telegram (and other channel) validate errors strip the request URL so bot tokens stay out of the settings panel. Only `/stop` / `/help` run inline on the pump so `/account` cannot block `/stop`.
- **Memory clear fail-closed**: Workspace / all never fall back to `$HOME`; missing or non-directory cwd and unknown scope return an error (new i18n toast) and do not spawn the CLI.
- **Live Voice + dictation**: Overlay `voice://*` / `session://permission` listeners survive parent re-renders and unregister on close. Dictation auto-send follows `commit.kind === "send"` without a `setDraft` side-effect.
- **X status ids + wallpaper**: Status ids come only from pathname `status|statuses/<digits>` (TS + Rust). Query / fragment / `ftp:` / spoofed hosts are not verified. Library delete confirms via GlassModal; search/imagine over-budget kills the child.
- **Workbench dirty / deep-link**: ⌘W and bulk close honor dirty confirm. `path:line` keeps line/column. `..` segments are rejected. Unknown project is not default-trusted.
- **Effort + session core**: Official `high`→`xhigh` also migrates matching session/project rows under a new flag. Switching to a catalog without `xhigh` persists and resolves a clamped effort. Heatmap `local_usage` is off the async thread and skips old sessions. Tool `Permission denied` is not a hard-end error. Custom-route + shared mode self-heals. `append_message` load+save is atomic. AskUser clocks drop for every session on invalidate/clear.
- **Settings / workflows cleanup**: Stale provider-test epoch dropped; unknown provider keys preserved; empty key not sent as `Bearer `; abandoned plan `closed_rpc_id` set; goal “clear local timeline” is per-session; doctor export cleans temp + kills on timeout; stop-all re-enumerates busy set; duplicate task-tree ids fail closed; Workflows native `<select>` replaced with project `Select`.
- **Composer Extra High chip**: Selecting 极高/`xhigh` on grok-4.6 no longer remaps back to 高. Official route validates against the selected model's effort catalog.
- **“Thinking for N” no longer restarts on every chat switch**: The turn clock is kept per chat instead of one global value. Opening a chat now resumes its own clock.
- **Reasoning effort is remembered per chat**: Effort cascades session → project → global like permission. `settings.effort` is only the seed for chats that never picked one.
- **A draft chat no longer retunes the live one**: Changing effort before the first message keeps `sessionId: null` and does not write into the running session.
- **Permission auto-deny countdown no longer restarts**: The clock is keyed to the request (`sessionId:rpcId`), so leaving and returning resumes the countdown.
- **Remote IM Feishu/Lark MVP product loop**: host `test_connection` soft-fails restore (`missing_feishu_*` / invalid App ID / custom domain) before live tenant token; success is `feishu_tenant_token_ok` (token only, never claims WS online). Engine `/p` menus and card/text picks honor GUI project_scope whitelist (`"all_trusted"` | `{ allow: [] }`, plus legacy mode/projectIds). ACL require-@ syncs `group_reply_all` / `require_mention` on save; §6.1 `mention_map` advanced field + pure parser. Pure project-scope filter tests + feishu soft-fail unit tests.
- **App update channel honesty**: Settings → About restores full path honesty after the settings split — signed in-app vs GitHub download vs unsupported package type (Linux non-AppImage note), soft-fail error classes, idle/empty and check-failed copy. Never claims silent update on unsigned builds. Host `updater_status` reports `unsupported` when the plugin is on but the package cannot auto-update.
- **CI baseline**: `cargo fmt` drift and ESLint non-null optional-chain in `session.test.ts`.
- **Custom providers without official login (#557)**: Custom route always spawns with agent-home `GROK_HOME` (even in shared mode); activating custom also forces independent mode so session paths stay aligned.
- **Post-turn journal retry (#554 / #555)**: After a successful prompt RPC, journal reconciliation retries over a short bounded window (0/125/375/750 ms) via `spawn_blocking`, with per-session locking against the next user append.
- **Heatmap token usage (#556)**: Prefer sum of `turn_completed` usage from session `updates.jsonl` (covers tool-loop spend); fall back to signals occupancy; scan both `~/.grok` and agent-home session roots.
- **Tasks / dashboard Stop-all honesty**: Stop all is app-wide busy **sessions** (not tools in one chat); Tasks vs Dashboard confirm copy matches; empty / full-success / all-failed toasts; nested tool tree never invents subagent rows without CLI/tool signals.
- **Support zip honesty (#561)**: Restore redacted section checklist + soft-fail copy on Reliability/Doctor export (dropped during a multi-PR integrate). Host `meta.json` now includes a soft CLI probe (app + CLI versions) without inventing secrets or chat journals.
- **CLI vs ACP agentVersion skew (#563)**: Doctor/Runtime soft-warn when probed `grok --version` disagrees with the last live ACP `agentVersion` (never blocks sessions).
- **Remote IM status lights**: Sidebar `deriveStatus` no longer treats Bridge running alone as connected (requires `connectedChannels` link). Incomplete drafts (any channel) cannot show Connected.

**中文 · 修复**
- **Grok 预设思考档对齐官方**：Amux / 云驿使用官方 4.6 枚举（`low` / `medium` / `high` / `xhigh`，默认极高）。旧存档里的 `max` 档会映射为 `xhigh`。空白自定义通道仍默认 `max`。
- **Changes 跨文件写错 / hunk 还原**：accept/reject/restore 只写路径匹配的 after；逐 hunk 接受先确认、先缓存完整 after、再重建 diff。全脏标签拒绝打开新标签。补丁重组保留源文件末尾换行。
- **Remote IM 空白名单 / 泄漏**：`{allow: []}` 与过期绑定不再 spawn，也不回退 `$HOME`。渠道测试错误去掉 URL（避免 Telegram token）。消息泵仅内联 `/stop`/`/help`。
- **记忆清除 fail-closed**：workspace/all 不再回退主目录；路径缺失或未知 scope 报错且不执行 CLI。
- **Live Voice / 听写**：监听在父组件重渲染后仍有效，关闭时退订。听写自动发送只看 `commit.kind === "send"`。
- **X 证据 + 壁纸**：status id 只从 pathname 提取（前后端一致）；query/fragment/伪造 host 不验证。图库删除走 GlassModal；超时杀掉子进程。
- **工作台脏数据 / deep link**：⌘W 与批量关闭尊重脏确认；`path:line` 保留行号；拒绝 `..`；未知项目不再默认 trusted。
- **Effort / 会话核心**：存量会话与项目行再跑一次 high→xhigh；切到无 xhigh 的模型会钳制并持久化。热力图离异步线程并跳过过旧会话。工具输出 Permission denied 不再当硬错误。custom+shared 自愈。`append_message` 全程持锁。AskUser 时钟随会话清理。
- **设置 / 工作流清理**：连接测试 epoch 丢弃过期结果；未知 provider 键保留；空 key 不发 Bearer；放弃 plan 写入 closed_rpc_id；Goal 清除本机会话时间线；doctor export 超时杀进程并删临时文件；stop-all 重新枚举忙碌集；重复 task-tree id fail-closed；工作流原生 select 换成项目 Select。
- **Composer 极高档回弹**：在 grok-4.6 选极高/`xhigh` 后不再被 3 档校验打回「高」。
- **「思考中 N 秒」不再因切换会话归零**：回合计时按会话保存；打开会话恢复它自己的计时。
- **思考等级改为按会话记忆**：effort 按 会话 → 项目 → 全局 级联；`settings.effort` 只作为从未选过的会话的初始值。
- **草稿会话不再改动正在运行的会话**：首次发送前改思考等级不再写进当前活跃会话。
- **权限自动拒绝倒计时不再重置**：计时归属于请求（`sessionId:rpcId`），离开再返回接着倒数。
- **应用更新通道诚实**：设置 → 关于 在设置拆分后恢复完整路径说明 — 已签名应用内 / GitHub 下载 / 不支持的安装包类型（Linux 非 AppImage 提示）、软失败错误分类、空闲与检查失败文案；未签名构建不宣称静默更新。Host `updater_status` 在插件开启但包类型不可自动更新时返回 `unsupported`。
- **远程 IM 飞书/Lark MVP 产品闭环**：恢复测试连接 soft-fail；`/p` 与卡片选项目遵守 GUI 项目白名单；ACL 群聊需要 @ 与 `group_reply_all` 同步；§6.1 `mention_map` 高级字段；纯 helper + 单测。
- **CI 基线**：`cargo fmt` 漂移与 `session.test.ts` ESLint optional-chain 非空断言。
- **无官方登录的第三方通道 (#557)**：自定义路由 spawn 强制 agent-home；激活时亦切换独立模式以对齐会话路径。
- **回合后 journal 延迟对账 (#554 / #555)**：prompt 成功后在有界窗口内重试对账，并与下一次用户写入互斥。
- **热力图 Token 用量 (#556)**：优先汇总 `turn_completed` usage；回退 signals 上下文占用；同时扫描 `~/.grok` 与 agent-home 会话根。
- **支持包诚实导出 (#561)**：恢复可靠性中心/Doctor 脱敏清单与软失败提示；`meta.json` 增加软探测 CLI 版本（不包含密钥或完整会话记录）。
- **CLI 与 ACP agentVersion 漂移 (#563)**：Doctor/Runtime 软警告探测版与在线 agent 版本不一致（不阻断会话）。
- **任务面板 / 仪表盘「停止全部」诚实**：作用域为应用内忙碌**会话**（非单聊工具）；Tasks 与 Dashboard 确认文案对齐；空目标 / 全成功 / 全失败 toast；子代理树不在无 CLI/工具信号时编造节点。
- **远程 IM 状态灯**：侧栏仅在 Bridge 运行且实例已关联时显示「已连接」；绑定草稿不完整时不显示已连接。

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
