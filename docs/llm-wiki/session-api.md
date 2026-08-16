# Local session API（列表 + 续跑）

#626 第一刀。给**同一台机器上的外部应用**列 Grok App 会话，再用 **App session id + 提示词**续跑**同一条**。

不是 Remote IM，也不是自动化新建会话。

## 范围（做了 / 不做）

| 做 | 不做 |
|----|------|
| 列出 App 会话（磁盘 `sessions_index`） | 用此接口**新建**会话 |
| `session id + prompt` 续跑同一条 | 打断正在进行的一轮 |
| 回环 HTTP + 同路径 CLI | 无鉴权 / 监听非 loopback |
| 发送需要 App 或托盘在跑 | 应用退出后排队落盘再补发 |
| 该会话正在跑一轮（绘画 / 工具 / 流式）→ **入跟进队列**，GUI 队列条同步 | 把会话 `mode` 当成 mock 传给 `connect` |

## 身份

- **session id** = Grok App session id（侧栏「复制会话 ID」）。默认**不是** CLI agent session id。见 [session-continuity.md](./session-continuity.md)。
- 列表字段：`id` · `title` · `projectId` · `projectName` · `updatedAt` · `archived` · `pinned`。

## HTTP（仅 127.0.0.1，token 门）

App 启动后 Host 绑定 `127.0.0.1:0`，把 `{url, token, pid}` 写到：

`{app_data}/session-api.json`（unix `0600`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/health` | 探活 |
| GET | `/v1/sessions?include_archived=` | 列表 |
| POST | `/v1/sessions/{id}/turns` | 续跑。body：`{ "prompt", "idempotencyKey"? }` |

鉴权：`Authorization: Bearer <token>` 或 `x-grok-token`。设置页**永不展示 token**，只给「打开令牌文件位置」。

续跑结果 `status`：

| status | HTTP | 含义 |
|--------|------|------|
| `turn_started` | 200 | 已 `connect` + `send_message`，同一条 App session |
| `queued` | 202 | 该会话正在跑一轮（绘画 / 工具 / 流式）。提示词进入**同一条** composer 跟进队列；Host 发 `session://send_queue`，主窗口队列条立刻显示。**不打断**当前轮，本轮结束后自动发送 |
| `busy` | 409 | 保留：无法入队时的冲突（正常路径走 `queued`） |
| `not_found` | 404 | 没有这条 App session |
| `app_not_running` | 503 | 没有在跑的 Host（CLI 侧） |
| `error` | 400 | 空 prompt / 项目未信任 / 连接失败等 |

`idempotencyKey` 命中则回放上次结果（磁盘 cap 200）。

## CLI（不抢焦点）

必须在 `tauri::Builder` **之前**拦截，避免 `single-instance` 把主窗口拉到前台。

```text
grok-app --sessions
grok-app --sessions --include-archived
grok-app --session-send <session-id> --prompt "…"
grok-app --session-send <session-id> --prompt-file ./note.md
grok-app --session-send <session-id> --prompt "…" --idempotency-key k1
```

- `--sessions`：优先打回环；没有 App 则读磁盘索引。
- `--session-send`：必须有正在跑的 App（或托盘）。否则 `app_not_running`，exit 2。正在跑一轮时回 `queued`（exit 0），不抢窗口、不打断。
- 二进制名随安装变化（macOS `.app` 内可执行文件 / Windows exe）。设置页用 `grok-app` 作示意。

## Host 路径

`src-tauri/src/session_api.rs`

1. `prepare_send`：会话必须已在索引里；绑定项目须 `trusted` + `path_ok`；cwd 优先 `worktree_path`。
2. `dispatch_turn`：若 `session_turn_busy`（含绘画 / 工具 / `prompt_in_flight`）→ `enqueue_while_busy`，fanout `session://send_queue`，**不** `connect` 抢槽。空闲才 `connect` + `send_message`。
3. 发送竞态仍 `still running` / `task_already_running` → 同样入队，不回硬 `busy`。
4. 主窗口 `useSendQueue(acceptExternal)` 把事件 merge 进现有跟进队列（`source: external`）；副窗口不听，避免双发。

## Settings

**运行时 → 连接** · `runtime.sessionApi` · 锚点 `settings-anchor-sessionApi`。

只读状态 + 令牌文件路径 + 打开位置。新条目必须进 `settingsCatalog`。

## 后续（本切片不做）

- 外部创建新会话
- 退出后磁盘队列 drain
- interrupt 模式
- 回执 / 完整 transcript 拉取
