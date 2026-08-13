# Agent 核心交互链路稳定性排查（发送 · 流式 · 路径解析 · 任务 · 会话隔离）

> 日期：2026-08-13 · 范围：从「聊天输入框 → 流式输出 → 路径解析 → 任务处理 → 会话隔离」这条与 Grok Build CLI（ACP over stdio）交互的核心链路出发，围绕**权限 / 网络 / 授权 / 进程生命周期**这些「小毛病」体验问题做的一次全量代码级排查。
>
> **整改（同日）**：P0-1～P0-6 与 #600 / #598 以及一批高信号 P1 已落地，见下方「已落地」。剩余 P1/P2 仍是诊断项。
>
> 方法：五条链路并行深读源码 + 全量测试模拟（前端 `pnpm test` 5414 passed / 后端 `cargo test` 1169 passed）。所有 P0 与关键 P1 已回到 HEAD 代码逐条人工复核。下文「已落地」为同日整改记录。
>
> 严重度口径：**P0** = 数据丢失 / 访问控制 / 核心功能静默失效；**P1** = 明显错误 UX / 长时间卡死 / 静默误配；**P2** = 边缘、诊断、次要体验。

## 自动化基线（本次实跑）

| 套件 | 结果 | 备注 |
| --- | --- | --- |
| `pnpm test`（vitest） | **5414 passed / 6 skipped**，2 个套件加载失败 | 失败仅因本机缺 `canvas.node` 原生模块（`sessionExportImage.*`），非代码问题 |
| `cargo test`（全量并行） | **1169 passed / 1 failed / 1 ignored** | 唯一失败 `media_server::tests::missing_file_is_404_not_403` 是**测试并行竞态**（见附录 T1），单独重跑 + 整个 `media_server` 模块单跑均通过 |

> 结论：仓库当前是绿的。下述问题都是**逻辑 / 竞态 / 边界**层面的隐患，测试覆盖不到或本就是「按当前设计通过」的坑。

---

## 架构速览（便于对照）

**发送链路（composer → CLI）**
1. UI `send()` → `executeSend`（`AppWorkbench.tsx`）：先乐观渲染 user 气泡 + 空 streaming assistant，置 `sendInFlight` / `sendEpoch`。
2. `ensureConnected` → Tauri `session_connect`（在 Host `connect_lock` 下 park/unpark/冷启动）。
3. `sessionSend` → Rust `SessionManager::send_message`（`session_manager/turn.rs`）。
4. `connect_lock` 内：`ensure_promptable_session`（live / background 原地 / parked→bg|focus），开 turn（置 `prompt_in_flight`、FSM Streaming），**先**写 user journal 行。
5. 可选 Host vision / `prepare_agent_prompt`（**仍持锁**），再 `tokio::spawn(acp.prompt_for)`。
6. ACP stdio `session/prompt` 等待：空闲 600s / 绝对 4h；早到的 `_x.ai/session/prompt_complete` + 3s 静默兜底。
7. 流 / 工具事件 → live 或 background；收尾靠 PromptComplete / #522 RPC-Ok heal / stall 看门狗。
8. 前端队列 Ready 时自动 flush；ghost heal 在 Host 从未进入 mid-turn 时（~45s）清掉纯乐观「Thinking…」。

**流式链路**：`AcpClient` 解 `session/update` → `handle_acp_event`（live/bg/drop）→ 追加 `stream_buf`、节流写 `messages.json`、合批进 `pending_stream_emit`（~40ms/600 字）→ `session://stream` IPC。前端 `StreamCoalescer`（~60–104ms）→ `sessionTranscriptStore` → 虚拟列表 + stick-to-bottom；journal reconcile / rehydrate 补截断尾巴。

**权限门**：CLI 反向 RPC `session/request_permission`（及 `exit_plan_mode` / `ask_user_question`）→ Host 建 `scope_key` 跑 `may_auto_allow/deny` → 自动放行或存**单个** pending gate 并 emit `session://permission` → UI 按 sessionId parking，仅 viewing 时显示 → 用户操作 `session_resolve_permission/_plan/_ask_user` → 写回**该会话自己的** ACP 子进程 → 清 pending。进程死亡 / recycle → `session://permissions_invalidated`。

**进程/网络**：`AcpClient::spawn_with_home` 起 `grok … agent … stdio`；`GROK_HOME` = 共享 `~/.grok` 或独立 `~/.grok-app/agent-home`（自定义路由强制独立）。`proxy::apply_to_tokio_command` 注入 `HTTP(S)_PROXY`/`ALL_PROXY`/`NO_PROXY`。子进程 `kill_on_drop(true)`，stderr ring。live/background/parked 池（默认 8，30 分钟空闲回收）。

**路径解析 + 媒体**：前端扫描助手/工具文本（`attachments.ts` / `pathNormalize.ts` / `sessionPathMap.ts`）→ Host `paths_classify` / `fs_resolve_path` 解析确认 → loopback axum `127.0.0.1:0`（`media_server.rs`，per-process token + `path_scope` 白名单）投递；`media://` 仅冷启动兜底。

**会话隔离**：每个 App 会话一份 UI journal（`{app_data}/sessions/<id>/`）+ 可选 CLI agent id（`{GROK_HOME}/sessions/<encoded-cwd>/<agentSessionId>/`）；Host 一进程一会话（live/background/parked），ACP 事件按 `process_id` + stamped `agentSessionId` 路由；前端 `messagesOwnerSessionId` / `viewFocus` epoch / `openSessionGen` 三道防跨聊天污染。

---

## P0 —— 数据丢失 / 访问控制 / 核心功能静默失效

### P0-1　进程崩溃 / 退出时丢弃流合批缓冲 → 回答被截断
- **位置**：`src-tauri/src/session_manager/events.rs:853-895`（live `ProcessExited`）、`events_bg.rs:525-558`（background）。对照正确做法 `stream.rs:290-297`（`flush_pending_stream_emit_done`）、`stream.rs:352`、`stream.rs:572`。
- **触发**：agent/CLI 在流式中途崩溃或被杀（网络导致 fatal、OOM、被回收）。
- **根因**：`ProcessExited` 分支清了 tools、`prompt_in_flight`、`deferred_prompt_complete`、`streaming_message_id`，但**从不调用 `flush_pending_stream_emit_done`**。最后 ~40ms / 600 字仍在 `pending_stream_emit` 里，被直接丢弃。`force_end` / deferred finish 都会 flush，唯独 exit 路径不 flush。
- **症状**：气泡停在半句；重开会话可能因 journal 节流也没落盘而同样截断。
- **确认**：已 grep 全部 `flush_pending_stream_emit*` 调用点，两个 `ProcessExited` 分支确实没有。

### P0-2　`connect_lock` 全程覆盖 Host vision/prepare，且「turn 已失效」时 Host 返回 Ok 而不发 prompt → 前端假流式 + 任务被误判「已执行」
- **位置**：`turn.rs:306-337`（prepare 后 `still_this_turn` 检查，任一不满足即 `return Ok(snapshot)` 而**不发 `session/prompt`**）；前端 `AppWorkbench.tsx:7837-7861`（不读返回 state，直接投 `streaming`）。
- **触发**：发送带 Host vision / 长 prepare 的一轮；用户在 prepare 期间按 Stop（或 stall 清了这轮）。
- **根因**：user journal 行与 turn 开启发生在 prepare **之前**（`turn.rs:152-164`）。取消清了 `prompt_in_flight` / turn id；prepare 回来后 `still_this_turn=false`，Host 返回 **Ok** 但没派发 prompt。前端从不读这个返回值，仍把 liveMap 置 streaming。ghost heal 可能 45s 后清掉 UI，但**磁盘已留下孤儿 user 行**。
- **连锁到任务（真正的 P0）**：`automation_runner.rs:409-420` 把任意 `send_message` Ok 当作「已触发」，随即 `mark_automation_run` 推进 `next_run_at` / once 任务置 disabled。→ **定时任务其实没跑，却被标记为已跑并推进/关闭**。
- **确认**：`turn.rs:310-337` 的 skip-prompt-return-Ok 分支属实；`automation_runner.rs:410` 只 `map_err`，Ok 即视为成功。

### P0-3　早到 `prompt_complete` 后强清 open tools → 后续真实 chunk 被当 load-replay 丢弃
- **位置**：`stream.rs:304-348`（`try_finish_deferred_prompt_complete`，`#453` 强清 `open_tool_ids`）；replay gate `stream.rs:116-133`、`events.rs:138-147`；兜底计时 `acp_client.rs:1995-2011`。
- **触发**：agent 先发 `prompt_complete`，然后跑一个**长时间静默**的工具（无 `session/update`）。
- **根因**：兜底在 agent 静默 **3s** 后释放 RPC（心跳**不**刷新 `last_update_at`）；此时 `prompt_in_flight=false`，`try_finish_deferred_prompt_complete` 会**清空所有 `open_tool_ids`** 并收尾。之后真正到达的 chunk 命中 `is_session_load_replay(true)` 被丢；background 路径甚至 warn「lost chunk」。
- **症状**：回答截断 / 卡「思考中」直到 reconcile 或切会话；`#522` 同类。
- **确认**：`stream.rs:334-344` 的强清逻辑与 warn 属实；replay gate 只看 `!prompt_in_flight`。

### P0-4　进程级共享 `last_update_at` + 宽松 `pending_prompt_matches` → 多会话串扰（早收尾 / 迟收尾 / 卡死）
- **位置**：`acp_client.rs:288`（单个 `last_update_at`）、`1987-2038`、`2491-2530`；匹配 `2035-2038`（`(Some(_), None) => true`、`(None, _) => true`）。
- **触发**：共享进程多会话（warm 复用同一 CLI）；或事件缺 `sessionId`。
- **根因**：一个 `AcpClient`（一进程）只有一个 `last_update_at`，兜底 grace 与 prompt 空闲超时都用它。会话 A 的早 `prompt_complete` 会被 B 的持续流一直续命；A 的空闲超时被 B 的更新扭曲。缺 sid 的 `prompt_complete` 可能完成**另一个** waiter。
- **症状**：多聊天并发时回答被提前截断、或迟迟不收尾、或卡 busy。

### P0-5　YOLO / `--always-approve` 关不掉：mid-turn 切「询问」后旧进程仍放行
- **位置**：`control.rs:36-50`（`soft_respawn` 在 `live_session_is_busy` 时直接 `return` 不杀）、`control.rs:386-401`（`apply_permission_policy` 立即改 `s.policy` 再 soft_respawn）；spawn flag 在 `acp_client.rs:1447-1448`。
- **触发**：一轮流式进行中，用户把权限从 YOLO 切到「询问」。
- **根因**：`s.policy` 立刻更新，但 `soft_respawn` 因 busy 跳过，不杀进程；CLI 仍带 spawn 时的 `--always-approve` / `bypassPermissions`。Host 策略与 CLI flag **发散**，直到某次成功 respawn。catalog 文档声称 mid-turn 变更会 soft-respawn（含 YOLO 降级），实际被 busy 短路。
- **症状**：UI 显示「询问」，工具却继续无提示执行到本轮结束，信任被打破。
- **确认**：两处代码属实；`live_session_is_busy` 覆盖 Streaming 即会跳过。

### P0-6　`paths_classify` / `fs_resolve_path` 对任意存在路径授权（且授的是父目录）→ 本地任意读放大
- **位置**：`commands/fs.rs:492-494`（`if exists { grant_path(pb) }`，**无**项目/白名单校验）；`path_scope.rs:74-94`（`grant_path` 对文件授的是**父目录**）；`fs_browser.rs:780-787, 945-974`（`fs_resolve_path`/`open_path_smart` 同样存在即 grant）。历史加载入口 `AppWorkbench.tsx:4514-4519`。
- **触发**：打开一个 journal attachments 含 `~/.ssh/id_rsa`（或任意桌面路径）的会话 → 历史加载调 `pathsClassify` → 之后 loopback 媒体服务器可服务该**父目录下的兄弟文件**。
- **根因**：与结构化 attach 的 `prepare_media_attachment_path`（有白名单）不同，classify/resolve 路径只判「存在」就 `grant_path`，而 `grant_path` 授父目录。
- **威胁模型**：需要拿到 media token（`?t=`）或主 webview XSS；属于「本地任意读放大」，非远程直接可利。
- **确认**：`fs.rs:492-494` 与 `path_scope.rs:76-83`（file → parent）均属实。

---

## P1 —— 明显错误 UX / 长时间卡死 / 静默误配

### 发送 / 连接 / 队列

| 编号 | 位置 | 症状 & 根因 |
| --- | --- | --- |
| P1-1 | `AppWorkbench.tsx:8038`、`21544`（`send()` / voice 恒传 `targetSessionId: session.sessionId`） | **跨聊天误投**。`executeSend` 只有在 `targetSessionId === undefined` 时才用 `resolveComposerSendSessionId`（`viewFocus.ts:66-74` 优先 viewing 修复 openSession 竞态）。而 `send()` 总是显式传 shell id，把这道修复短路了。切到 B 但 shell 还指 A 时发送 → 落到 A。**注**：`executeSend` 内部又用 `resolveComposerSendSessionId` 兜了一层，实际误投窗口比标题窄，但显式传 shell id 与修复初衷相悖。 |
| P1-2 | `turn.rs:152-164`（append 在 prepare 前）；回滚仅在缺 ACP 时清 flag（`405-416`） | **孤儿 user 气泡**：prompt 从未派发（P0-2）时 journal 已写。重载后多出用户气泡；ghost heal 又把文本还原到 composer → 二次发送**重复 user 轮**。 |
| P1-3 | `AppWorkbench.tsx:8029-8038`（`clearComposerAfterSubmit` 先于 `executeSend`）；失败仅 `failStrip`（`7891-7895`） | **发送失败后草稿丢失且不回填**。乐观清空无条件发生，失败路径不像 ghost heal 那样把文本放回，用户得重打。 |
| P1-4 | `AppWorkbench.tsx:7614-7615`；`useSendQueue.ts:233,302` | **进程级 `sendInFlightRef` 挡住并发发送**。A 的 `ensureConnected`/send 很慢时，B 的 Send / 队列 flush 直接 no-op（`return false`），与 Host 多会话 demote+spawn 的设计矛盾。 |
| P1-5 | `useSendQueue.ts:264-270`（`setHold(true)`）、`289-297`（仅 streaming/permission 清） | **队列 flush 失败后 hold 永久粘住**。连接失败 → toast → 会话回到 Ready → 自动 flush 再也不重试，直到手动 resume。 |
| P1-6 | `AppWorkbench.tsx:7368-7384` | **`ensureConnected` 等别的连接可丢发送**。A 连接在飞，B 的发送等待；若 120s 后 A 仍在连 → 返回 `null` → `failStrip`。外部连接饿死本目标。 |
| P1-7 | `turn.rs:56-58` `_focus_guard` 持到 `~565` | **`connect_lock` 覆盖整个 vision/prepare**。一个会话 prepare 几分钟，其它会话的 connect/send 全被串行阻塞，UI 看着像卡死。 |
| P1-8 | `AppWorkbench.tsx:7837-7850`；`session.ts:1878-1889`（`isSessionNotLiveError` 字符串分类） | **CONNECT_FAILED 重试可能重复派发**。首个 `session_send` 已开 turn / 写 journal，随后 IPC/错误被分类为「无 live agent」→ 强连 + 第二次 `sessionSend`。重试假设首调是纯拒绝，但 Host 可能已持久化。 |

### 流式 / 收尾

| 编号 | 位置 | 症状 & 根因 |
| --- | --- | --- |
| P1-9 | `process.rs:213-228`（`release_failed_turn_markers` 置 `pending_stream_emit=None` 无 flush） | provider/RPC 失败时最后几个 token 丢失（P0-1 同类，失败路径版）。 |
| P1-10 | `useSessionHostEvents.ts:778-785`（`chunk.done` 立即投 `state:"ready"`） | **前端 done 抢先置 Ready**，而 Host 可能仍在 deferred complete + open tools（FSM Streaming）。侧栏显示空闲/未读、stall 横幅被清、尾 token 门控异常。 |
| P1-11 | `streamLateToken.ts:25-63`；`useSessionHostEvents.ts:734-748` | **`shouldApplyLateStreamText` 可能丢真实尾段**：聚焦 host 且 assistant 已有非空 body 且 `streaming:false` → return false，被 settle 的 partial body 挡住结尾。且用的是 `messagesBySessionRef`，可能与已绘制 store 短暂不一致。 |
| P1-12 | `useSessionHostEvents.ts:472-516`；`sessionTranscriptStore.ts:167-186` | **空 streaming 壳残留**：Ready 时先 flush coalescer 再清 streaming；漏 `done` / 后台转前台 / content 节流可留下空壳。ghost heal 只清**空**壳（45s + Host idle），不管 partial 粘滞流。 |
| P1-13 | `cli_sessions.rs:1280-1309, 1548-1574`；FE `upgradeMessagesFromJournal:2276-2340` | **journal reconcile 重复气泡**：cover 用 exact/contains/prefix，空白或 thought-vs-body 分裂不匹配 → `Missing` → 新 UUID 行。前端 upgrade 按长度/id 补但不总能合并多余行。post-turn 0/125/375/750ms 重试可与新发送竞争。 |
| P1-14 | `stream.rs:90-108`（`resolve_turn_event_route`）；`events.rs:107-114` | **≥2 个 busy background 且事件缺 sid → Drop**：`busy_bg` 多匹配返回 `TurnEventRoute::Drop`，无缓冲无重试，静默丢 chunk/tool（依赖 CLI 是否 stamp sid）。 |

### 权限 / 授权 / 账号

| 编号 | 位置 | 症状 & 根因 |
| --- | --- | --- |
| P1-15 | `turn.rs:769-868`（stop 只 `take()` ask/plan）；`AppWorkbench.tsx:12220-12226` | **Stop 取消 ask/plan 反向 RPC，但不取消 permission**。UI 清了横幅，agent 可能仍坐在未答的 `request_permission` 上；下次 reconnect/send 看着卡或报困惑的 cancel/auth 错误。 |
| P1-16 | `process.rs:213-227`、`live_session_is_busy:173-175`、`stream.rs:614-616`、`watchdog.rs:85-87` | **失败/heal/busy 判定漏了 pending permission**：多处只看 FSM 或 plan/ask id，与 recycle invalidation（**含** permission）不一致 → Approve 可能残留 / soft-respawn 在 permission RPC 仍开时推进。 |
| P1-17 | `events.rs:393-397`；`events_bg.rs:262-267`；`types.rs:200-207` | **单 pending-permission 槽被覆盖**：一次只存一个 `pending_permission_rpc_id`。两个工具接近同时请求批准 → 第一个 Approve 消失，或答了一个另一个永远挂着。 |
| P1-18 | `control.rs:601-685`（用 client `rpc_id` 应答，匹配才清） | **`resolve_permission` 写 stdin 前不校验 `rpc_id == pending`**：陈旧/幽灵 Approve（recycle 竞态、双击、错 map）可用任意 id 写进活进程 → CLI「unknown」/取消轮/放行错工具。plan/ask 至少 peek 了 pending id。 |
| P1-19 | `control.rs:386-398`（只改 `inner` live）；bg 用 `s.policy`（`events_bg.rs:189`） | **策略变更只作用于 live 焦点会话**：改全局/会话权限时另一个后台会话仍用旧 auto-allow/deny（含 YOLO），直到其进程死亡。 |
| P1-20 | `agent_prefs.rs:54-65`（仅独立模式写）；`catalog.md:174-178` | **共享模式 YOLO 泄漏**：App 显示「询问」但 `~/.grok` 里 `yolo=true` / `permission_mode=always-approve` 时，CLI 仍读共享 config，提示比 UI 暗示的少。文档已记，仍是产品陷阱。 |
| P1-21 | `acp_client.rs:2635-2673`（`cached_token` 失败后软继续）；`classify_rpc_error:4957-4979` | **authenticate 软失败 → mid-turn AUTH_FAILED**：连接看着 OK，第一个工具调用才报 auth_kind=none。`read_auth_profile` 可能仍显示已登录（读 `~/.grok`）。握手不 fail-closed，靠后续 RPC 分类 + 登录后 recycle。 |
| P1-22 | `permission.rs:413-434`（`dests.is_empty() → true`） | **下载空目标即 auto-allow 假设 cwd=项目**：`wget`/`curl -O`（无 `-o`）在 agent cwd ≠ 项目根时也被自动批准，非 YOLO 也会写到项目外且无提示。 |
| P1-23 | `AppWorkbench.tsx:14339-14375`；`AskUserModal.tsx:114+`；`gateClock.ts` | **auto-deny/ask-user 超时只在横幅/弹窗挂载时走**：开了「30s 后自动拒绝」，切走到后台权限 toast → 计时不启动，请求不会自动拒绝直到重开，轮次可能挂到 CLI 超时。计时是 React effect 而非 Host 侧截止时间。 |

### 网络 / 进程生命周期

| 编号 | 位置 | 症状 & 根因 |
| --- | --- | --- |
| P1-24 | `events_bg.rs:751-754`（`_ =>` 忽略 stderr/retry/other）；对照 live `events.rs:989-1074` | **后台轮忽略 `RetryState`，无 Host 熔断**：切走后中转/DNS 挂了，后台会话没有 abort + `NETWORK_PROVIDER`，会一直「运行」到 CLI 耗尽重试 / 空闲超时（~10 分钟空闲 / 4h 绝对）。后台降级很常见。 |
| P1-25 | `relay_stream_proxy.rs:448-464`（`Err(e) => break;` 无错误帧） | **中转 sanitize 代理吞掉流中途上游错误**：mid-SSE 连接重置/DNS 抖动时，非流路径返回 502 JSON，流路径只是关流。CLI 收不到结构化失败 → 挂「思考中」或诡异 fatal。 |
| P1-26 | `events.rs:853-885`（`fsm.crash("Agent process exited")`）；`acp_client.rs:1674-1679`（EOF `code:None`） | **CLI 崩溃统一显示「Agent process exited」而非网络**：退出码从不 `wait`，ProcessExited 忽略 stderr 分类。即便 stderr 是 502/reset，用户也只看到崩溃/`agent_exit` chip。 |
| P1-27 | `commands/settings.rs:199-284`（soft_respawn 触发条件**不含** `proxy_*`）；spawn 注入 `acp_client.rs:1484-1486` | **改代理设置不回收 warm 进程**：改完 Manual proxy / System→None，warm live/parked CLI 仍带旧 `HTTP_PROXY`，轮次持续失败直到回收/空闲杀。**已确认**：`settings.rs` 的 `need_soft_respawn` 列表里没有任何 proxy 字段。 |
| P1-28 | `proxy.rs:465-472`（坏 manual → Inherit）、`497-506`（PAC 未解析 → Inherit + warn） | **无效手动代理 / 未解析 PAC 静默回退直连**：设置看着「已配置」，流量绕过代理 → auth/timeout 失败但聊天里无代理提示。 |
| P1-29 | `acp_client.rs:3361-3366`（`child.kill()` 非进程组）；对照 `leader.rs:664-695` / `serve.rs:387-400` | **`AcpClient::kill` 不是进程组杀**：嵌套 `agent`/工具在 Host kill 后存活 → 孤儿进程、卡端口、池计数与现实不符。leader/serve 用 setsid/taskkill 树。 |
| P1-30 | `leader.rs:647-662`（只设 PATH/HOME，无 proxy 注入） | **leader spawn 跳过代理注入**：`use_leader` 且在公司代理后，leader 连不上网，挂载的 agents 看着「坏了」。 |
| P1-31 | `acp_client.rs:1602-1607`（`std::net::TcpStream::connect` 无超时） | **阻塞式 TCP ACP 连接跑在 Tokio worker 上**：坏 `acp_server_addr` / 黑洞主机会在连接期卡住一个运行时 worker。其它探测都用了 `timeout`。 |
| P1-32 | `official_aux.rs:270-283`；`models_aux.rs:900-914`（`cmd.output()` 后事后判 `elapsed > timeout` 只 warn） | **headless official/aux「超时」不杀挂死 CLI**：vision/search 侧信道网络挂起时 Host 线程阻塞到进程退出，超时只记日志（ACP 路径有真正的 `tokio::time::timeout`）。 |
| P1-33 | `relay_stream_proxy.rs:162-195`（`LISTEN_PORT` 只设一次，serve 错误只 log） | **sanitize 代理监听死亡是进程级永久故障**：loopback serve 挂了后，providers 仍指 `127.0.0.1:{port}/r/…` → 所有被 sanitize 的中转 502 直到重启 app。无健康检查/重启。 |
| P1-34 | `acp_client.rs:5082-5138`；`providers.rs:885-907`（`max_retries` 抬到 12） | **硬传输 abort 关键词不全 → 长「思考」**：`timed out` / `proxy connect` / `socks handshake` 等措辞不在硬传输列表 → 等到软下限（~8/12）或 15。fail-fast 是子串匹配，中转乱造措辞；软 stall 从不自动取消。 |

### 会话隔离

| 编号 | 位置 | 症状 & 根因 |
| --- | --- | --- |
| P1-35 | `control.rs:256-370`（尤其 `310-313` vs `325-349`）；`commands/settings.rs:182-196` | **切换 GROK_HOME 只清 live 的 `agentSessionId`**：独立↔共享翻转时 recycle 杀进程，但 `sessions_index` 里 parked/background 会话仍指向旧 home 的 agent id → 重连 `session/load` 打到错的 home → 失败/新建/bootstrap，极端情况错误 resume。文档声称 data-root 变更会清 live id，实际只 `take()` live meta 到盘，parked/bg map 直接丢弃不清持久化 id。 |
| P1-36 | `store.rs:1457-1523, 743-747`；`store_lock.rs:40-71` | **`sessions_index` RMW 非事务**：两个 App 实例（或 App + 快速 meta 更新）load-mutate-save，锁只包最终写字节（3s `LOCK_BUSY`）→ 经典 lost-update。JSON 损坏 → `read_json_recover` 隔离为空 `[]` → **侧栏会话消失**直到备份恢复。 |
| P1-37 | `events.rs:716-721`；`events_bg.rs:408-413`；对照 `store.rs:1866-1877`（`append_message` 有锁 RMW） | **工具 journal upsert 与无锁 `save_messages` 竞争**：流 `append_message` 与工具 upsert（load→mutate→save）并发 → 同一聊天丢工具行或丢流刷新。upsert 路径不在 `with_exclusive_lock` 内跨 load+save。 |
| P1-38 | `agent_home_config.rs:43-56`；`cli_sessions.rs:4-5` | **共享 GROK_HOME 下 App + 终端撞同一 agent 会话**：共享模式里终端 Grok Build 和 App 同时 resume 同一 `agentSessionId` → `chat_history` / ACP 状态互相竞争。UI journal 分开但 agent 上下文/工具会撞。跨进程无会话锁。 |
| P1-39 | `paths.rs:156-198`；`cli_sessions.rs:175-181, 255-267` | **encoded-cwd 身份碰撞 / 大小写**：同一项目不同字符串形式（`/Users/Me` vs `/Users/me`）→ 不同 percent-encoded 目录；`normalize_cwd_path` 只为匹配 lowercase，不用于落盘编码 → 重复 CLI 会话树 / 错误「最新」选择。符号链接 cwd 同理。 |

---

## P2 —— 边缘 / 诊断 / 次要体验

**流式渲染**
- P2-1 `useChatMessageVirtualizer.ts` / `useStickToBottom.ts:194-320`：虚拟列表高度估算→实测校正与 stick-to-bottom 争抢，长 markdown / 媒体流式时滚动跳动。
- P2-2 `stream_emit.rs:42-61` + `streamCoalesce.ts:62-80`：Host 保**首个** thought_phase、前端偏好**最新**，双层合批（40ms + 60–104ms）叠加延迟 →「思考 2/3」artifact、慢机首屏卡顿。
- P2-3 `session.ts:2738-2750`：done+空文本显式**保留**空 streaming 壳（为 steer），无后续 token 时卡到 Ready/ghost heal。
- P2-4 `sessionTranscriptStore.ts:162-186`：非结构增长用 leading+trailing 节流，末批可能非结构 → 文本短暂冻结再跳。

**stall / 看门狗**
- P2-5 `watchdog.rs:59-70,129-150`；`useSessionHostEvents.ts:1344-1352`：后台/未聚焦聊天软 stall 误判**漏报**——Host 发了但前端非 viewing 忽略，切过去要等下个软窗口（默认 600s）。
- P2-6 `tool_heartbeat.rs:15-42`：>3h 开着的工具心跳停止 → 之后静默计入 stall → 软 stall **误报**。
- P2-7 `watchdog.rs:80-83`：heal/stall 都要求 FSM==Streaming，早期路径 FSM 与 `prompt_in_flight`/前端 desync 时卡 busy 却无 stall UI。
- P2-8 `watchdog.rs:180-233`：`HardEnded` 分支是**死代码**（tick 只返回 Healed/SoftStall），前端仍监听 → 维护性/虚假可靠性。

**权限 / 账号（次要）**
- P2-9 `events.rs:287-292` + `permission.rs:96-126`：shell「本会话允许」scope_key 在 `path_target` 空时用**标题**而非命令 → 缓存怪 key，下条相似命令不复用。
- P2-10 `permission.rs:63-80`：`is_edit_tool` 用 `contains("edit"|"write"|"replace")` 子串 → AcceptEdits 下过度放行意外工具名。
- P2-11 `turn.rs:606-678`：interject/steer 同样只取消 ask/plan，不取消 permission → 有开着的工具权限时 interject 看着接受了但轮次仍阻塞。
- P2-12 `acp_client.rs:4930-4948` + `supergrok_quota.rs`：mid-turn 配额/计费错误靠字符串分类，Settings 配额组件可能仍显示 stale「unknown」。
- P2-13 `remote_im/config.rs:187-199` → `grok_agent:1097`：Remote IM 的 `allow_remote_yolo` 是独立于 App chip 的开关，易误解为「App 权限模式」。
- P2-14 前端权限/ask_user map 全在内存（`AppWorkbench.tsx:2214+`），仅 plan chrome 持久化 → **重启丢 mid-approval 门**，agent 可能仍等到超时。

**路径 / 媒体（次要）**
- P2-15 `path_scope.rs:23-64`：always-on roots 含 `temp_dir()` + `~/.grok` + agent home，远比「受信项目」宽。
- P2-16 `media_protocol.rs:201-371`：legacy `media://` **无 token**，只查 Origin + path_scope，且缺 Origin 时放行。
- P2-17 `media_server.rs:11-14,201-250` + `imageSrc.ts:125-132`：token 放在 `?t=` query，可能进 webview URL / 日志 / `lsof`；`tokens_equal` 只对等长做「近似」常量时间比较（`media_server.rs:475`，已确认存在）。
- P2-18 `path_scope.rs:87-92`：grant 上限 256 FIFO 淘汰，长会话多附件后旧缩略图 403 直到重新 classify。
- P2-19 `media_server.rs:333-344`：`Cache-Control: immutable` + 弱长度 ETag，同字节长原地替换后最多 7 天显示旧图。
- P2-20 `media_server.rs:429-436` / `media_protocol.rs:496-506`：短读保留预分配 buf → 文件在 stat 与 read 间被截断/增长时 body 长度错 / 尾零 → 解码坏。
- P2-21 `path_scope.rs:96-99`：`is_allowed` 用 `canonicalize().unwrap_or(path)`，符号链接替换 / 缺路径回退非规范字符串匹配存在 TOCTOU。
- P2-22 `media_server.rs:100-118`：serve task 若在启动后死亡无 Host 侧重启，预览全断。
- P2-23 `attachments.ts:242-460`：裸路径提取对含空格的 Windows 路径 / 非常见根 CJK 粘连 **漏识别**（false negative）。
- P2-24 `sessionPathMap.ts:360-371`：同名（多个 `正文.md`）路径 last-touch 胜出，短引用可能打开非引用文件却「成功」。
- P2-25 `commands/fs.rs` `paths_classify` 仍**不拒绝 `..`**（前端 `sidePathDeepLink.ts` 已折叠加固，Host 侧未做纵深防御）。
- P2-26 `media_server.rs:505`：SVG 以 `image/svg+xml` 投递，白名单内恶意 SVG 在会执行 SVG 的上下文有风险（`<img>` 场景较低）。

**会话隔离 / 进程（次要）**
- P2-27 `cli_sessions.rs:107-114,244-250`：linked `agentSessionId` 用 HashMap first-wins，两会话共用一个 agent id 时只链到第一行。
- P2-28 `paths.rs:201-214`：`find_agent_session_dir` 同 UUID 在两个 encoded-cwd 下时首个 `read_dir` 命中胜出，无 mtime 消歧。
- P2-29 `pending_quit.rs:27-45`：`app.exit(0)` 3s 后强退不做 agent 拆解，靠 `kill_on_drop`，与嵌套子进程竞争。
- P2-30 `agent_auto_wake.rs`：config-only，后台工作后的合成轮次可能看着像「卡死/复活」会话。
- P2-31 `stream.rs:50-86` + `connect.rs:1033-1097`：parked co-tenant Drop 与 live connect 竞态；任何 sid mis-stamp → 静默 Drop（安全权衡，但路由正确性依赖 CLI stamp）。文档仍提到 `rescue_parked_to_background`，生产路由实际已不调用（仅定义+测试），**文档与代码不一致**。

---

## 已落地（2026-08-13 整改）

| 条目 | 处理 |
| --- | --- |
| P0-1 / P1-9 | `ProcessExited` / `release_failed_turn_markers` 先 `flush_pending_stream_emit_done` + journal |
| P0-2 / P1-2 | prepare 后 turn 已失效返回 `TURN_CANCELLED`（自动化不再误推进）；前端静默收尾、去掉空 assistant 壳 |
| P0-3 | 不再强清仍年轻的 `open_tool_ids`；replay 门把 `deferred_prompt_complete` 当活回合 |
| P0-4 | `last_update` 按 session 记账；`pending_prompt` 不再跨 sid 宽松匹配 |
| P0-5 / #598 | busy `soft_respawn` 入队；effort/policy 改 parked/bg；unpark 校验 spawn flags |
| P0-6 | `grant_path` 只授文件本身；`paths_classify` 不授目录 |
| #600 | 无 session option 的工具用 `allow-once` 作答，Host 仍缓存 session allow |
| P1-1 / P1-3 | send 不再硬传 shell id；成功后再清草稿 |
| P1-15 / P1-16 / P1-18 | Stop 取消 permission；busy 含 pending permission；resolve 校验 rpc_id |
| P1-19 | 后台会话同步 policy |
| P1-22 | 无显式 `-o` 的下载不再默认放行 |
| P1-24 | 后台轮处理 `RetryState` 并 Host 熔断 |
| P1-27 | 代理设置变更触发 soft-respawn |

未做（仍见后文）：P1-4/5/6/7 发送队列与 `connect_lock`、P1-10～14 前端合批、P1-17 单 permission 槽、P1-20/21/23 账号与超时时钟、P1-25～34 其余网络/进程、P1-35～39 会话隔离、全部 P2。

## 高信号问题聚类（建议优先级）

| 主题 | 相关条目 | 用户可见症状 | 建议顺序 |
| --- | --- | --- | --- |
| **收尾丢数据** | P0-1, P0-3, P0-4, P1-9 | 崩溃/长工具/多会话时回答被截断、卡「思考中」 | 1（最高，直接丢答案） |
| **Stop/prepare 竞态 + 任务误判** | P0-2, P1-2, P1-3 | 假流式、孤儿气泡、**定时任务没跑却标记已跑** | 2（任务侧是数据/信任问题） |
| **权限/YOLO 与 UI 发散** | P0-5, P1-15~P1-20, P1-22 | UI 说「询问」实际仍放行；Approve 幽灵/丢门 | 3（安全信任） |
| **本地任意读放大** | P0-6, P2-15~P2-18 | 需 token/XSS 前提，但父目录 grant 面过宽 | 4（收窄 grant 到精确文件） |
| **网络失败的可见性** | P1-24~P1-28, P1-33, P1-34 | 后台轮卡死、崩溃被误报为非网络、改代理不生效 | 5（体验「小毛病」重灾区） |
| **多会话路由/发送** | P1-1, P1-4, P1-6, P1-7, P1-14, P0-4 | 跨聊天误投、并发发送被串行/丢弃 | 6 |
| **会话隔离持久化** | P1-35~P1-39, P1-13 | 切 home 后错误 resume、index lost-update、重复气泡 | 7 |

## 与既有计划的关系

`docs/plans/2026-08-13-v0.2.16-review-fix-plan.md`（批次 H：Session core）已覆盖本文若干条的近亲：H4（`append_message` RMW，对应 P1-37 的同族）、H2（"permission denied" 误报）、H6/H7（gate/ask-user 时钟清理，对应 P1-16/P1-23）。**本文新增的、v0.2.16 计划里没有的核心项**：P0-1（exit 不 flush 流缓冲）、P0-2/P0-3/P0-4（收尾竞态三连）、P0-5（YOLO mid-turn 关不掉）、P0-6（classify 父目录 grant）、P1-24（后台轮忽略 retry）、P1-27（代理变更不回收）、P1-33（sanitize 代理死亡不可恢复）、P1-35（GROK_HOME 切换只清 live id）。

## 附录

### T1 —— `cargo test` 唯一失败是测试竞态，非产品 bug
`media_server::tests::missing_file_is_404_not_403` 在全量并行跑时偶发返回 403（期望 404）。根因：`path_scope` 的 roots/grants 是进程级 `OnceLock<RwLock<…>>` 全局态（`path_scope.rs:13-21`），`media_server` 各测试用例并行修改同一全局，`grant_path` 的授权在断言前被其它用例的 `*roots().write() = Vec::new()` 之类操作影响。**证据**：单独 `cargo test --lib media_server::tests::missing_file_is_404_not_403` 通过，整模块 `cargo test --lib media_server` 也通过（9/9）。属测试隔离问题，不影响产品逻辑；若要根治可给这组测试串行化（如 `serial_test` 或共享 `Mutex`，路径同 `path_scope::tests` 里已有的 `TEST_LOCK` 模式）。

### 复核记录（P0/关键 P1 已回读源码确认）
- P0-1：grep 全部 `flush_pending_stream_emit*` 调用点，`events.rs:853-895` / `events_bg.rs:525-558` 的 `ProcessExited` 无 flush —— 属实。
- P0-2：`turn.rs:310-337` skip-prompt-return-Ok；`automation_runner.rs:410` Ok 即成功 —— 属实。
- P0-3：`stream.rs:334-344` `#453` 强清 open tools + warn；replay gate 只看 `!prompt_in_flight` —— 属实。
- P0-4：`acp_client.rs:288` 单 `last_update_at`；`2035-2038` 宽松匹配 —— 属实。
- P0-5：`control.rs:43-50` busy 时 `return`；`control.rs:386-401` 先改 policy 再 soft_respawn —— 属实。
- P0-6：`fs.rs:492-494` exists 即 grant；`path_scope.rs:76-83` file→parent —— 属实。
- P1-1：`AppWorkbench.tsx:8038`/`21544` 恒传 shell id；`executeSend:7626-7632` 仅 undefined 时用 resolve —— 属实（内部有二次兜底，窗口较窄）。
- P1-27：`settings.rs:199-284` `need_soft_respawn` 列表无 proxy 字段 —— 属实。
- P2-17：`media_server.rs:475` `tokens_equal` 仅等长近似常量时间 —— 属实。
