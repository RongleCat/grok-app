# Grok Build 对齐：模型 / 推理 / 权限 / 模式

源码：`src/lib/grokCatalog.ts`（静态兜底）、`src-tauri/src/models_catalog.rs`、`src-tauri/src/agent_prefs.rs`。

## 模型

**UI 只展示官方真正可用的模型。服务商是后端渠道，只在设置 → 账户 → 自定义提供商切换。**

| 来源 | 说明 |
|------|------|
| `models_cache.json` | CLI 官方目录 |
| 静态兜底 | `grok-4.6`（默认）+ `grok-4.5` |

探测：`scripts/probe-models.sh`。Host：`models_list_available`。

Spawn 顺序（CLI 0.2.x）：

```text
grok --permission-mode <mode> agent --model <id> --reasoning-effort <e> [--always-approve] stdio
```

Flags **必须在** `stdio` 之前。连接后 `session/set_model` 再对齐一次。

## 推理强度（effort）

CLI `models_cache.json` 每模型可带 `info.reasoning_efforts: [{id,value,label,description,default}]`。Host 经 `AvailableModel.reasoningEfforts`（`isDefault`）下发。

Composer **UI 阶梯**统一为 4 档（低 → 高）：**低 / 中 / 高 / 极高**。  
3 档模型（Grok 4.5）不展示「极高」；4 档官方模型（Grok 4.6）展示极高并 spawn `xhigh`。选中后映射为该模型真实 spawn / `reasoning_effort` 值。

| UI 阶梯 | Grok 4.5 spawn | Grok 4.6 spawn | Grok 自定义(4档) | DeepSeek spawn |
|---------|----------------|----------------|------------------|----------------|
| 低 | `low` | `low` | `low` | `low` |
| 中 | `medium` | `medium` | `medium` | `high` |
| 高 | `high` | `high` | `high` | `xhigh` |
| 极高 | —（不展示） | `xhigh` | `max` | `max` |

解析顺序（真实可选值）：

1. **自定义通道 active** → 该提供商的 `efforts`（`app_efforts`）
2. 否则官方 catalog 的 `reasoningEfforts`（**以 CLI `models_cache` / `isDefault` 为准**）
3. 再回退：`grok-4.6` → `GROK_4_6_EFFORTS`（`low` · `medium` · `high` · `xhigh`，默认 **xhigh**）；其余 → `GROK_BUILD_EFFORTS`（`low` · `medium` · `high`，默认 **high**）

自定义通道默认档（`GROK_CHANNEL_EFFORTS`，点「恢复 Grok 默认」得到）：`low` · `medium` · `high` · `max`——4 档，`max` 映射极高 UI 槽（catalog kind `tier4`）。官方 `GROK_BUILD_EFFORTS` 仍为 3 档。

展示标签走 UI 阶梯 i18n（`effort.low|medium|high|xhigh`），不直接用上游 id 文案。

Spawn：`--reasoning-effort <spawnId>`。Host **透传** catalog / 通道 id（含 `max` 等），不硬白名单仅 low/medium/high。切换通道时按阶梯对齐（极高在 3 档上钳到「高」）。中途修改：soft-disconnect agent → 下一条消息重连。无 `session/set_effort` RPC。

**产品默认（4.6）：** 官方冷启动与未设 prefs 时 model = **grok-4.6**、effort = **xhigh**。CLI cache 可能同时把 `xhigh` 和 `high` 标成 default，Host/前端归一为 **xhigh**。用户可在 Composer 降为 high/medium/low 以缩短 TTFT。旧安装若全局 model 仍为历史产品默认 `grok-4.5`，`load_settings` 一次性抬到 `grok-4.6`；官方路由上旧 effort `high` 一次性抬到 `xhigh`（显式 low/medium/max 不动）。旧 effort `medium` 仍一次性抬到 high（3 档兜底）。

**Apply honesty（UI）**：纯 helper `src/lib/modelEffortApply.ts`。Composer 改模型 / 推理后 toast + 菜单 footer 说明生效路径：

| 控制 | 无 live Agent | Live Agent |
|------|---------------|------------|
| 模型 | `next_message`（下条消息 spawn） | `session/set_model` → `immediate_rpc`；不支持则 `soft_respawn` |
| 推理 | `next_message` | `soft_respawn`（无 set_effort） |

不得静默失败：prefs / set_model 错误经 `classifyModelEffortError` 分类 toast。

### 连接加速（Host）

| 手段 | 说明 |
|------|------|
| （非默认压 effort） | CLI 1.0 默认 **high**；要更快请用户在 Composer 选 medium/low，不要用产品默认偷偷降档 |
| `grok --no-auto-update agent … stdio` | 跳过启动时更新检查 |
| 进程复用 | 同 cwd + effort + YOLO 标志时，切会话只 `session/load\|new`，不 respawn CLI |
| 打开会话预热 | `openSession` 后台 `session_connect`，首发跳过冷启动 |

## 会话模式（mode）— 产品态

| App | 作用 |
|-----|------|
| `agent` | 默认编码 agent |
| `plan` | 计划模式（ACP `session/set_mode`） |
| `ask` | 询问 / 偏只读协作 |

实现：

1. 连接成功后 `session/set_mode`（尝试 `plan` / `ask` / `agent` 等候选 modeId）。  
2. 中途切换：优先 `set_mode`；失败则 soft-respawn。  
3. 按 `composerPrefsScope` 记忆。

## 后台等待（headless，CLI 0.2.117+）

首轮 agent turn 结束后，无头 `grok -p` 默认可等待后台 bash/monitor 与后台子代理完成。

| App 设置 | Spawn | 说明 |
|----------|-------|------|
| `backgroundWaitPolicy: "wait"`（默认） | 省略 flag | CLI 默认等待（自带超时） |
| `backgroundWaitPolicy: "no_wait"` | top-level `--no-wait-for-background` | 首轮结束即退出 |
| `backgroundWaitPolicy: "timeout"` + `backgroundWaitTimeoutSec` | top-level `--background-wait-timeout N` | N 钳制 **1–3600**（默认 600） |

- 纯 helper：`src/lib/backgroundWaitPolicy.ts`；Host：`acp_client::background_wait_spawn_flags*`。
- **Soft-fail**：CLI &lt; 0.2.117 或版本不可解析时省略非默认 flag（避免 clap 拒识导致 AGENT_CRASHED）。
- 生效路径：Remote IM headless、壁纸搜索 headless、ACP `agent stdio` 顶层（效果仍以 headless 语义为主；stdio 下 flag 可接受但主要无操作）。
- 更改后 soft-respawn（`settings_spawn`）。设置：Settings → General → Agent。
## 部分流式事件（headless，CLI 0.2.117+）

`--include-partial-messages` 仅在 `--output-format streaming-messages-json` 时生效，输出增量 `stream_event`（text/thinking delta）。

| App 设置 | Spawn | 说明 |
|----------|-------|------|
| `includePartialMessages: false`（默认） | 省略 flag；Remote IM 用 `streaming-json` | CLI 默认整消息 |
| `includePartialMessages: true` | `--output-format streaming-messages-json` + `--include-partial-messages` | 仅 CLI ≥ 0.2.117；更旧 soft-fail（保持 streaming-json、省略 flag） |

- 纯 helper：`src/lib/partialStream.ts`；Host：`acp_client::include_partial_messages_spawn_flags*` / `resolve_headless_stream_for_partial`。
- **Apply-path honesty**：`src/lib/partialStreamHonesty.ts` — `resolvePartialStreamApplyEffect` → `active` | `soft_omit` | `idle_off` | `host_only`；Settings 开关下按 CLI 版本显示 soft-omit / active 提示（应用内 ACP 聊天不发明 token 流）。
- **Soft-fail**：CLI &lt; 0.2.117 或版本不可解析时省略 flag，不切换 format。
- 生效路径：Remote IM headless（`grok -p`）；壁纸等仍用 `json` 时不会发 flag（纯 helper 按 format 门控）。
- 设置：Settings → Runtime → Pool。

## 内置工具 allowlist / denylist

| App 设置 | Spawn | 说明 |
|----------|-------|------|
| `disableWebSearch` | top-level `--disable-web-search` | 移除 `web_search` / `web_fetch` |
| `allowedTools: string[]` | top-level `--tools a,b` | 逗号分隔 tool id **allowlist**；空 = 省略（CLI 默认全部） |
| `disallowedTools: string[]` | top-level `--disallowed-tools a,b` | 逗号分隔 tool id **denylist** |

**并存规则：**

- 两者皆空 + 未关网页搜索 → CLI 默认（全部工具）。
- `allowedTools` 非空 → 仅允许列出的工具；`disallowedTools` 若也非空仍会从该集合中移除。
- 网页开关不写入 `disallowedTools` 数组，但 UI 把 web 工具视为已覆盖；纯 helper `effectiveDisallowedTools` 可合并展示。

常见芯片：`web_search` · `web_fetch` · `run_terminal_command`（caution）· `search_replace` · `write` · `Agent` · `spawn_subagent`；另支持 freeform 逗号列表。

更改后 soft-respawn（`settings_spawn`）。源码：`src/lib/allowedTools.ts`、`src/lib/disallowedTools.ts`、Host `AppSettings.allowed_tools` / `disallowed_tools`、`acp_client::allowed_tools_spawn_flags` / `disallowed_tools_spawn_flags`。

## 权限（含 YOLO）与 CLI `--permission-mode`

CLI enum（`grok --help`）：`default | acceptEdits | auto | dontAsk | bypassPermissions | plan`。

纯映射：`src/lib/permissionModeMap.ts`（前端）与 `src-tauri/src/acp_client.rs`（`cli_permission_mode` / `resolve_cli_permission_mode`）。

| App ID | CLI `--permission-mode` | Agent 配置 `[ui] permission_mode` | Claude `defaultMode` | 额外 Spawn |
|--------|-------------------------|-----------------------------------|----------------------|------------|
| `ask` | `default` | `default` | `default` | `--permission-mode default` |
| `accept_edits` | `acceptEdits` | `acceptEdits` | `acceptEdits` | `--permission-mode acceptEdits` |
| `allow_for_session` | `default`（Host 会话缓存） | `default` | `default` | `--permission-mode default` |
| `auto` | `auto` | `auto` | `auto` | `--permission-mode auto` |
| `dont_ask` | `dontAsk` | `dontAsk` | `dontAsk` | `--permission-mode dontAsk` |
| `always_approve` | `bypassPermissions` | `always-approve` + `yolo=true` | `bypassPermissions` | `--permission-mode bypassPermissions` + `--always-approve` |
| （产品 mode=`plan`） | `plan`（YOLO 优先） | 不变 | 不变 | `--permission-mode plan` |

**优先级**：YOLO / `always_approve` → `bypassPermissions`；否则产品会话 mode=`plan` → `plan`；否则策略表。

### Workflow 实时日志 + Goal 会话指示（1.0 GUI）

| 面 | 行为 |
|----|------|
| Workflows Settings smoke/run | Host 边跑边 emit `workflows://run-progress` → **live** log + 已用时；若仅有最终 blob → 诚实标 **batch log**（不假 live）；空日志 / CLI 缺失 / shared 不改写 `~/.grok` 有 soft-fail 说明；可复制日志 |
| Goal 会话 chip | 有 `goal_updated` 时显示阶段/进度/摘要；Composer `/goal` 已开但无事件 → **waiting** 虚线 chip（不发明进度） |

### CLI 版本芯片与 binary skew（1.0）


| 项 | 说明 |
|----|------|
| 硬门槛 | `≥ 0.2.112`（`versionSupported`）；更旧 → setup/Doctor fail |
| 推荐线 | **`≥ 1.0.0`**（`meetsRecommended`）；更旧仍可用，Runtime · CLI 软提示升级 |
| 探测 | Host `probe_cli` → `CliProbeResult`（含 `recommendedVersion` / `agentBinarySkew`） |
| `agent` sidecar | App **只 spawn `grok`**；若 `~/.grok/bin/agent` 版本与 grok 不一致 → Doctor warn + Settings「将 agent 对齐到 grok」（`cli_repair_agent_sidecar`） |

Spawn（CLI **1.0** / 兼容 0.2.112+）示例：

```text
grok --no-auto-update --permission-mode <mode> agent [--model <id>] [--reasoning-effort <e>] [--always-approve] … stdio
```

`--permission-mode` 为 **top-level**；`--always-approve` 为 **agent** option。

**Shared 模式**（默认）：使用 `~/.grok` 作为 `GROK_HOME`，与终端 Grok Build 同一会话/配置树；App **不**改写用户 `~/.grok/config.toml`；Host 策略 + spawn flags（含 `--permission-mode` / YOLO 时的 `--always-approve`）。

**Independent 模式**：写入 `~/.grok-app/agent-home/config.toml` 与 `agent-home/.claude/settings.json`，agent 进程侧真正按策略执行；与 CLI `~/.grok` 隔离。

中途改权限：同步配置 + soft-respawn（含 YOLO 降级）。Host 在收到 `session/request_permission` 时仍按 live policy 自动放行/拒绝。

注意：读工具与部分只读 shell 在 agent 内建白名单下仍可能不弹窗（Grok Build 设计）。

**下载默认放行（Host）**：`curl -o/-O`、`wget`、`aria2c` 等把资源写到**项目目录内**的 shell，Host 在非 `dont_ask`/`deny` 策略下自动批准，避免生图后 `curl` 落盘卡在权限弹窗直至 600s 超时。项目外路径仍须审批（仅 `always_approve` 例外）。

## 偏好记忆范围

`composerPrefsScope` = `global` | `project` | `session`。

覆盖 model / effort / mode / permission。切换 chip → `composer_prefs_set` / `session_set_policy` / `session_set_model`。

## 服务商

自定义提供商 = 渠道路由。Composer **模型菜单**会聚合：

1. **官方**分组：catalog 模型（`availableModels`）
2. **每个已配置提供商**一组：列出该提供商 catalog 中的全部请求模型（`models[]`，每项含 **展示名称** + model id），**不**在菜单里拉远程 `/v1/models`

选择自定义条目会：必要时更新该通道的 active `model`，再 `providers_activate`（与 Settings → Account → Custom providers → **Use** 相同）。官方条目在当前为 custom 路由时会先切回 official，再写入 catalog `modelId` 偏好。

芯片文案：官方用 catalog label；自定义路由用 **当前选中模型的展示名称**（`models[].name`，空则回退 model id）。

Settings 提供商表单：去掉「设为默认」；支持添加多个模型（手动输入 id + 展示名称，或从「拉取模型」列表点选）。
