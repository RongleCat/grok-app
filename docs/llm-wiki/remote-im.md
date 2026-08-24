# 远程控制 · IM 通信功能设计文档（GUI 配置 · 全渠道 · Grok Build）

> **文档类型：** 功能设计 / 产品规格（实现前单一事实来源）  
> **状态：** Rust 进程内多渠道 Bridge · `/p`/`/r` 控制平面（App sessions_index）· 飞书/钉钉卡片选项目会话 · 微信 ilink 扫码+长轮询 · **不** spawn Node/agent-connect  

> **对齐：** [cc-connect](https://github.com/chenhg5/cc-connect) 已适配 IM 能力与 `config.example.toml` 字段  
> **产品：** Grok App 设置 → **远程控制** 内可视化配置；本机 Bridge × **仅 Grok Build（ACP）**  
> **IA：** 设置一级导航展示名为「远程控制」（section id 仍为 `remote_im`）；页内 tab：`im`（IM 通信，本文）· `mirror`（手机镜像，见 PR #95 / `MirrorConnectPanel`）  
> **原则：** **零 CLI 主路径** — 绑定、扫码、启停、ACL、Doctor 全部 GUI；禁止要求用户手写 TOML

### 手机镜像公网隧道

- 启动手机镜像时优先使用宿主机 `PATH` 中的 `cloudflared`。
- 若宿主机未安装 `cloudflared`，自动检测 Docker daemon，并通过官方 `cloudflare/cloudflared:latest` 镜像创建 Quick Tunnel；无需挂载 Cloudflare 凭证。
- macOS / Windows 容器通过 `host.docker.internal:<动态端口>` 访问仅监听本机的镜像主机；Linux 使用 host network，继续保持回环地址。
- App 负责容器命名、日志就绪检测和停止清理；“停止主机”或正常退出时会强制移除本次容器，异常终止产生的同前缀残留会在下次启动隧道前清理。
- 可用 `GROK_MIRROR_CLOUDFLARED_IMAGE` 覆盖镜像；`GROK_MIRROR_NO_TUNNEL=1` 仍用于仅本机测试。
- HTTP **默认只绑 `127.0.0.1`**。把链接里的回环地址换成局域网 IP **不会**让手机连上。设置 → 远程控制 → 手机镜像里显式打开「允许同一 Wi-Fi」后才绑 `0.0.0.0`，复制/二维码改用探测到的局域网 IPv4。默认关闭（token 门控仍在，但 HTTP 未加密）。也可用 `GROK_MIRROR_ALLOW_LAN=1`。

---

## 目录

1. [产品目标与边界](#1-产品目标与边界)  
2. [信息架构与页面布局](#2-信息架构与页面布局)  
3. [通用能力与全局配置 GUI](#3-通用能力与全局配置-gui)  
4. [控制平面（IM 内命令 · 与渠道无关）](#4-控制平面im-内命令--与渠道无关)  
5. [绑定与扫码 — 统一交互模式](#5-绑定与扫码--统一交互模式)  
6. [分渠道配置项 GUI 规格](#6-分渠道配置项-gui-规格)  
7. [Grok Build 对接](#7-grok-build-对接)  
8. [数据模型与落盘](#8-数据模型与落盘)  
9. [Bridge 与 App 集成](#9-bridge-与-app-集成)  
10. [安全、i18n、对话框](#10-安全i18n对话框)  
11. [分期与验收](#11-分期与验收)  
12. [组件与代码落点](#12-组件与代码落点)  
13. [附录：cc-connect 对照表](#13-附录cc-connect-对照表)

---

## 1. 产品目标与边界

### 1.1 目标

| # | 目标 |
|---|------|
| G1 | 设置 → **远程控制** → **IM 通信**：侧栏选渠道，右侧可视化绑定/配置（对齐现有 Settings 风格） |
| G2 | **覆盖 cc-connect 全部 IM 渠道**（见 §6），字段与行为可映射其 options |
| G3 | 扫码创建 / 粘贴凭证 / 测试连接 / 启停 Bridge **全 GUI** |
| G4 | 远程消息进入 **Grok Build ACP**；项目仅限 App 已信任项目 |
| G5 | 交互：`/p` 选项目 → 新会话；`/r` 恢复历史会话（卡片或编号菜单） |
| G6 | 中英文 i18n；无 `window.confirm`；密钥脱敏 |

### 1.2 非目标（首版）

- 多 Agent（Claude/Codex…）  
- 在 App 内做完整 IM 聊天室  
- 用户手写 / 直接编辑 `config.toml` 作为主路径  
- 公网多租户中继 SaaS  

### 1.3 与 cc-connect 的关系

| cc-connect | 本产品 |
|------------|--------|
| 手写 TOML + CLI setup | **GUI 表单 + 扫码 Modal** |
| 多 Agent type | **仅 Grok Build** |
| `/dir` 任意路径 | **禁止**；项目多选自 App `projects.json` |
| 独立 session 库为主 | **App sessions_index 为真相源** + remote binding |
| 能力矩阵 / 平台细节 | **对齐并实现** |

---

## 2. 信息架构与页面布局

### 2.1 复用现有设置页骨架

```
┌ settings-page ──────────────────────────────────────────────────┐
│ settings-page__nav（一级）     │ settings-page__content            │
│  · 返回 App                    │  settings-page__main              │
│  · 搜索                        │                                   │
│  · 个人：通用/外观/账号/归档   │  【远程 IM 时：二级布局见下】      │
│  · 系统：扩展 / 远程 IM / 运行时 / 关于                             │
└────────────────────────────────────────────────────────────────────┘
```

- 新增 `SettingsSectionId = "remote_im"`  
- 路由：`#/settings/remote_im` · `#/settings/remote_im/:channelId` · `#/settings/remote_im/:channelId/:instanceId`  
- 样式：继承 `.settings-page__*`；二级用 `.rim-layout` / `.rim-sidebar` / `.rim-panel`

### 2.2 远程 IM 二级布局（主路径）

```
┌─ rim-layout ─────────────────────────────────────────────────────┐
│ rim-sidebar (~210px)          │ rim-panel（可滚动）               │
│                               │                                   │
│ ● Bridge 总览                 │  ← 选中后右侧内容切换             │
│ ── 国内 ──                    │                                   │
│   飞书 / Lark        ●绿      │                                   │
│   钉钉               ○灰      │                                   │
│   企业微信                    │                                   │
│   微信个人                    │                                   │
│   WPS 协作                    │                                   │
│   微博                        │                                   │
│   QQ 官方 / OneBot            │                                   │
│ ── 海外 ──                    │                                   │
│   Telegram / Slack / Discord  │                                   │
│   Matrix / LINE               │                                   │
│ ── 其他 ──                    │                                   │
│   WPS 数字员工（可选）        │                                   │
└───────────────────────────────┴───────────────────────────────────┘
```

| 侧栏项 | 右侧展示 |
|--------|----------|
| Bridge 总览 | 运行状态、启停、总开关、全局安全、已连接摘要 |
| 某渠道 | 该渠道 **绑定表单 + ACL + 项目范围 + 交互 + Doctor + 危险区** |
| 未实现渠道 | 「即将支持」说明 + 能力标签，表单 disabled |

侧栏行：图标 + 名称 + **状态点**（绿连接 / 黄已配置未连 / 灰未配置 / 红错误）+ 可选实例数角标。  
交互：对齐 `.settings-page__nav-item` 的 hover / `is-active`。

### 2.3 渠道右侧面板通用结构

自上而下固定区块顺序（所有渠道一致，专有字段只在「绑定」段变化）：

1. **页头**：渠道名 · 连接方式徽章 · 状态文案 · 实例下拉 · 「添加实例」  
2. **绑定凭证**（扫码 / 粘贴分段）  
3. **连接选项**（渠道专有 advanced）  
4. **访问控制 ACL**  
5. **项目范围**  
6. **交互与展示**  
7. **诊断 Doctor**  
8. **危险区**（断开 / 删除凭证 → 应用内 Modal）

主操作按钮（页头或绑定区底部）：

- **测试连接**  
- **保存并连接**（validate → 写 secret → Bridge reload → 状态灯更新）

---

## 3. 通用能力与全局配置 GUI

### 3.1 Bridge 总览页（侧栏第一项）

| GUI 控件 | 类型 | 说明 | 默认 |
|----------|------|------|------|
| 启用远程控制 | Toggle | 关：停 Bridge、不随 App 启动 | 关（用户首次打开引导开启） |
| 运行状态 | Status badge | 运行中 / 已停止 / 错误 | — |
| 启动 / 停止 / 重启 | Button group | Attached 生命周期 | — |
| 打开日志 | Button | 应用内日志面板或 reveal 文件 | — |
| 生命周期 | Radio | 随 App 启停 / 后台常驻 | 随 App |
| 允许远程 YOLO | Toggle | 关时远程强制 ask 阶梯 | **关** |
| 默认仅响应私聊提示 | Lead text | 引导各渠道勾选 | — |
| 已连接渠道 | List | 点击跳转侧栏对应渠道 | — |
| 最近错误 | Callout | 一条可复制摘要 | — |

### 3.2 所有渠道共用的 ACL 区块

| GUI 标签 | 字段 | 控件 | 默认 | 说明 |
|----------|------|------|------|------|
| 允许的用户 | `allow_from` | Text（支持 `*` 或逗号分隔 ID） | `*` + 警告文案 | 对齐 cc-connect；说明发 `/whoami` |
| 允许的群/会话 | `allow_chat` | Text 可选 | 空=不限（或 `*`） | 群 chat_id 列表 |
| 群聊需要 @ | `require_mention` / 反义 `group_reply_all` | Checkbox | 需要 @ = true | UI：☑ 群聊需要 @机器人 |
| 仅群聊 | `group_only` | Checkbox | false | 忽略私聊 |
| 管理员 | `admin_from` | Text | 空=无特权 | 远程危险命令（默认产品关闭 `/shell`） |
| 群内共享会话 | `share_session_in_channel` | Checkbox | false | 群内所有人同一 agent 会话 |

### 3.3 项目范围（替代 cc-connect 任意 work_dir）

| GUI | 控件 | 说明 |
|-----|------|------|
| 全部已信任项目 | Radio | 默认；`/p` 列出 App 全部 trusted projects |
| 白名单 | Radio + 多选 chip | 仅勾选的 `projectId` 可被远程绑定 |

**不提供** 任意路径输入框。

### 3.4 交互与展示（共用）

| GUI | 字段 | 选项 | 默认 |
|-----|------|------|------|
| 项目/会话选择方式 | `presenter` | 自动（优先卡片）/ 强制文本菜单 | 自动 |
| 进度展示 | `progress_style` | legacy / compact / card（渠道支持才显示） | compact 或渠道默认 |
| 入站表情 | `reaction_emoji` | Text 或「无」 | 渠道默认 |
| 完成表情 | `done_emoji` | Text 或「无」 | 无 |

### 3.5 全局远程命令能力（与 App 策略）

| 能力 | 首版 | GUI 位置 |
|------|------|----------|
| `/p` `/r` `/new` `/status` `/context` `/compact` `/help` `/stop` `/whoami` `/account` `/quota` `/switch` | ✅ | 总览说明 + 帮助文案；上下文用量与压缩；账号列表含剩余额度 |
| `/model` `/mode` 远程改模型 | 二期 | 总览高级 |
| `/shell` `/cron` | 默认关 | 总览高级 + admin_from |

---

## 4. 控制平面（IM 内命令 · 与渠道无关）

| 命令 | 行为 |
|------|------|
| `/start` `/help` | 欢迎与命令帮助（Telegram 首开默认发 `/start`） |
| `/p` `/project` | 项目列表：A 档卡片 / Telegram Inline Keyboard / C 档编号菜单 |
| `/p <名\|序号>` | 直接绑定项目 → **mode=new** |
| `/r` `/resume` | 当前项目历史会话列表（App sessions_index；Telegram 可点按钮恢复） |
| `/r <序号>` | 绑定会话 → **mode=resume** |
| `/new` | 清 session 绑定，保持项目，mode=new |
| `/status` | 项目、cwd、mode、session、chatKey |
| `/context` | 当前会话上下文用量；优先 agent 上报值，否则明确标记为 `~` 估算值 |
| `/compact [备注]` | 在当前 agent session 执行上下文压缩；结果与压缩标记同步回 App 会话 |
| `/account` `/accounts` `/quota` | 列出已保存 Grok 账号 + SuperGrok 剩余额度（`★` 为当前） |
| `/account <序号\|标签>` `/switch <n>` | 切换活动账号（写 `~/.grok/auth.json` + agent-home，软断桌面 ACP） |
| `/stop` | 中断 turn |
| `/whoami` | 平台 user id |
| `0` / 取消 | 退出编号选择模式 |

Telegram：启动 / 测试连接时 `setMyCommands` 注册上表到原生 **`/` 菜单**；`/p`、`/r`、`/account` 的结果使用 Inline Keyboard 原生展示与选择（见 §6.5）。

规则：

1. 选项目后直接说话 = **新 Grok 会话**（写 App index，`source=remote:<channel>`）  
2. `/r` 选定后说话 = **load agentSessionId**  
3. 未绑项目拒绝 agent turn  
4. 选择模式中数字不进 Grok  

---

## 5. 绑定与扫码 — 统一交互模式

### 5.1 绑定分段控件（所有支持扫码的渠道）

```
[ 扫码创建 ]  [ 粘贴凭证 ]     ← segmented control
```

| 模式 | UI 元素 | 结果 |
|------|---------|------|
| **扫码创建** | 二维码区域 · 步骤条 · 倒计时刷新 · 「我已完成」轮询状态 | 回填 app_id/secret 或 token 到 secrets，表单只读展示脱敏 |
| **粘贴凭证** | 必填输入框（password 型）· 显示/隐藏 · 可选「从剪贴板解析 id:secret」 | 校验格式 → 保存 |

**主路径禁止** 提示用户去跑 `cc-connect feishu setup` 等命令。  
Doctor 折叠区可提供「复制调试命令」给高级用户。

### 5.2 扫码能力矩阵（GUI 是否提供扫码 Tab）

| 渠道 | 扫码创建 | 粘贴凭证 | 说明 |
|------|:------:|:--------:|------|
| 飞书 / Lark | ✅ | ✅ | 对齐 `feishu setup` / `bind`；OpenClaw/飞书一键建应用能力可封装 |
| 微信个人 | ✅ | ✅（token） | 对齐 `weixin setup` 扫码 |
| 钉钉 | ⚠️ 二期 | ✅ | 首版粘贴 Client ID/Secret；二期接官方 dws/扫码若可用 |
| 微博 | ⚠️ 可选 | ✅ | cc-connect 有 CLI 引导，GUI 以粘贴为主 |
| 其余 | — | ✅ | 仅粘贴 |

### 5.3 绑定流程状态机（GUI）

```
未配置 → 填写/扫码 → 测试连接(可选) → 保存并连接
       → Bridge 加载实例 → 状态灯绿
       → 失败：inline error + Doctor 建议
```

删除凭证：`GlassModal` 确认 → 清 secrets + 停该实例连接。

### 5.4 多实例

- 页头 **实例** Select：`默认` / 用户备注名  
- **添加实例**：新建空表单，备注名必填  
- 每实例独立 credentialsRef、ACL、enable  

---

## 6. 分渠道配置项 GUI 规格

下列字段与 **cc-connect `[projects.platforms.options]`** 对齐；GUI 标签用中英 i18n。

**控件图例：** `T` Text · `P` Password · `Tg` Toggle · `Cb` Checkbox · `Sel` Select · `Num` Number · `Scan` 扫码区 · `Help` 帮助链

---

### 6.1 飞书 `feishu` / Lark `lark`

| 属性 | 值 |
|------|-----|
| 连接 | WebSocket 长连接 · **无需公网** |
| 侧栏分组 | 国内（Lark 可标「国际」） |
| 扫码 | ✅ |

#### 绑定区

| GUI 标签 | 字段 | 控件 | 必填 | 默认 |
|----------|------|------|:----:|------|
| App ID | `app_id` | T | ✅ | — |
| App Secret | `app_secret` | P | ✅ | — |
| 域名 | `domain` | Sel：飞书 `open.feishu.cn` / Lark `open.larksuite.com` / 自定义 T | | 飞书 |
| （Lark Webhook 高级）端口 | `port` | T | | 仅 webhook |
| 回调路径 | `callback_path` | T | | 仅 webhook |
| Encrypt Key | `encrypt_key` | P | | 仅 webhook |

绑定模式：扫码创建 | 粘贴（支持 `cli_xxx:secret` 一键拆分）

#### 连接与会话选项

| GUI 标签 | 字段 | 控件 | 默认 |
|----------|------|------|------|
| 启用交互卡片 | `enable_feishu_card` | Tg | true |
| 群聊需要 @ | 反义 `group_reply_all` | Cb | 需要 @ |
| 仅群聊 | `group_only` | Cb | false |
| 群内共享会话 | `share_session_in_channel` | Cb | false |
| 话题隔离会话 | `thread_isolation` | Cb | false |
| 回复时引用用户消息 | `reply_to_trigger` | Cb | true |
| 进度样式 | `progress_style` | Sel: legacy/compact/card | legacy 或 compact |
| 入站表情 | `reaction_emoji` | T 或「无」 | OnIt |
| 完成表情 | `done_emoji` | T 或「无」 | 无 |
| 多图合批窗口 ms | `image_batch_window_ms` | Num | 500 |

`resolve_mentions` / `mention_map` are **not** shown. Host does not consume them yet; leftover option keys in saved configs are ignored (no false-promise GUI).

#### ACL / 项目 / 交互

见 §3.2–3.4。`allow_from` = open_id；`allow_chat` = 群 chat_id。

#### 设置页引导文案（步骤条，只读）

1. 开放平台创建企业自建应用  
2. 启用机器人 + 长连接 + 订阅 `im.message.receive_v1` **与** `card.action.trigger`（缺后者则 `/p` 卡片按钮无效，只能回序号）  
3. 发布版本 · 可用性  
4. 在此扫码或粘贴凭证  

---

### 6.2 钉钉 `dingtalk`

| 属性 | 值 |
|------|-----|
| 连接 | **Stream** · 无需公网 |
| 扫码 | 首版 ❌（粘贴）；二期 ✅ |

| GUI 标签 | 字段 | 控件 | 必填 | 默认 |
|----------|------|------|:----:|------|
| Client ID (AppKey) | `client_id` | T | ✅ | — |
| Client Secret | `client_secret` | P | ✅ | — |
| 允许用户 | `allow_from` | T | | `*` |
| 群内共享会话 | `share_session_in_channel` | Cb | | false |
| 入站表情 | `reaction_emoji` | T/无 | | 🤔Thinking |
| 完成表情 | `done_emoji` | T/无 | | 无 |
| 启用 AI/互动卡片 | `enable_ai_card`（产品字段） | Tg | | true |

引导：开放平台 → 机器人 → **Stream 模式** → 权限 → 发布。

---

### 6.3 WPS 协作 `wps-xiezuo`

| 连接 | WebSocket · 无需公网 |

| GUI 标签 | 字段 | 控件 | 必填 | 默认 |
|----------|------|------|:----:|------|
| App ID | `app_id` | T | ✅ | — |
| App Secret | `app_secret` | P | ✅ | — |
| API Base URL | `base_url` | T | | `https://openapi.wps.cn` |
| 允许用户 | `allow_from` | T | | `*` |
| 清理思考/工具行 | `clean_reply` | Cb | | false |

---

### 6.4 WPS 数字员工 `wps-agentspace`（可选渠道）

| GUI 标签 | 字段 | 控件 | 必填 |
|----------|------|------|:----:|
| App ID | `app_id` | T | ✅ |
| wps_sid | `wps_sid` | P | ✅ |
| 设备名称 | `device_name` | T | | cc-connect 默认 |
| 设备 UUID | `device_uuid` | T | | 空=自动 |

侧栏「其他」分组；Help：从 agentspace Cookie 取 sid。

---

### 6.5 Telegram `telegram`

| 连接 | Long Polling · 无需公网 |

| GUI 标签 | 字段 | 控件 | 必填 | 默认 |
|----------|------|------|:----:|------|
| Bot Token | `token` | P | ✅ | — |
| 允许用户 | `allow_from` | T | | `*`（未设 warn） |
| HTTP/SOCKS 代理 | `proxy` | T | | 空 |
| 代理用户名 | `proxy_username` | T | | 空 |
| 代理密码 | `proxy_password` | P | | 空 |
| 进度样式 | `progress_style` | Sel | | compact |
| 群话题隔离 | （thread 行为说明 + 可选配置） | Cb/Help | | 按 cc 默认 |

引导：@BotFather `/newbot` → 复制 token。可选「打开 BotFather 说明」外链。

#### 原生命令菜单与结果选择（Bot API）

Bridge **启动**与 **测试连接成功** 时自动调用 `setMyCommands`，在 Telegram 输入框的 **`/` 菜单** 中展示控制平面命令（与 §4 对齐）：

| 命令 | 说明 |
|------|------|
| `/start` · `/help` | 欢迎 / 帮助 |
| `/p` · `/project` | 列/绑已信任项目 |
| `/r` · `/resume` | 列/恢复会话 |
| `/new` | 新会话（保持项目） |
| `/status` | 状态快照 |
| `/context` | 当前会话上下文用量 |
| `/compact [备注]` | 压缩当前会话上下文 |
| `/account` · `/accounts` · `/quota` · `/switch` | 账号列表与额度 / 切换账号 |
| `/whoami` | 发送者 id |
| `/stop` | 中断当前 turn |

`/p`、`/r`、`/account` 返回 Telegram 原生 Inline Keyboard：项目、会话、账号各一行按钮，每页 20 项；超过一页时提供「上一页 / 下一页」，通过 `editMessageText` 在同一条消息中刷新。文本序号输入仍可选择完整列表。选择按钮点击通过 `callback_query` 回到统一 `CardAction`，立即 `answerCallbackQuery` 结束加载状态，受理后收起键盘，避免重复执行。

实现要点：

- 默认语言（英文描述）+ `zh-hans` / `zh`（中文描述）各注册一份
- 入站解析兼容群聊形态 **`/cmd@BotUsername`** 与 `bot_command` entity
- 群聊中带 `bot_command` entity 的消息视为已 @ 机器人（满足「群聊需要 @」策略时的原生命令路径）
- Inline Keyboard callback 与普通消息使用同一 `allow_from` ACL；账号 id 必须重新从已保存账号索引校验后才允许切换
- Telegram `callback_data` 上限 64 bytes：使用 `project:<uuid>` / `session:<uuid>` / `account:<uuid>` 紧凑 action
- 分页 action 使用 `page:<project|session|account>:<0-based page>`；翻页不清空 pending，文本序号仍按完整列表解析

---

### 6.6 Slack `slack`

| 连接 | Socket Mode · 无需公网 |

| GUI 标签 | 字段 | 控件 | 必填 |
|----------|------|------|:----:|
| Bot Token (`xoxb-`) | `bot_token` | P | ✅ |
| App Token (`xapp-`) | `app_token` | P | ✅ |
| 允许用户 | `allow_from` | T | |

引导步骤条：创建 App → Socket Mode → 事件 → Install → 双 Token。

---

### 6.7 Discord `discord`

| 连接 | Gateway · 无需公网 |

| GUI 标签 | 字段 | 控件 | 必填 | 默认 |
|----------|------|------|:----:|------|
| Bot Token | `token` | P | ✅ | — |
| 允许用户 | `allow_from` | T | | `*` |
| 线程隔离会话 | `thread_isolation` | Cb | | false |
| 进度样式 | `progress_style` | Sel | | compact |
| 特权 Intent 提示 | — | Callout 只读 | | Message Content Intent 必开 |

---

### 6.8 企业微信 `wecom`

| 连接 | **模式二选一**：WebSocket（推荐）/ Webhook（需公网） |

#### 模式选择

| GUI | 控件 |
|-----|------|
| 连接模式 | Radio：`websocket` \| `webhook` |

#### WebSocket 模式字段

| GUI 标签 | 字段 | 控件 | 必填 |
|----------|------|------|:----:|
| Bot ID | `bot_id` | T | ✅ |
| Bot Secret | `bot_secret` | P | ✅ |
| 允许用户 | `allow_from` | T | |
| API Base（可选） | `api_base_url` | T | |
| 代理 | `proxy` | T | |

#### Webhook 模式字段

| GUI 标签 | 字段 | 控件 | 必填 |
|----------|------|------|:----:|
| Corp ID | `corp_id` | T | ✅ |
| Corp Secret | `corp_secret` | P | ✅ |
| Agent ID | `agent_id` | T | ✅ |
| Callback Token | `callback_token` | P | ✅ |
| EncodingAESKey | （若需要） | P | |
| 本地端口 | `port` | Num | | 8081 |
| 回调路径 | `callback_path` | T | | `/wecom/callback` |
| 公网 URL 提示 | — | Callout + 复制建议 cloudflared 命令（**辅助**，非主路径强制终端） | |
| 启用 Markdown | `enable_markdown` | Tg | | true |

---

### 6.9 微信个人号 `weixin`（ilink）

| 连接 | HTTP 长轮询 · 无需公网 |
| 扫码 | ✅ 主路径 |

| GUI 标签 | 字段 | 控件 | 必填 | 默认 |
|----------|------|------|:----:|------|
| Token | `token` | P / 扫码回填 | ✅ | — |
| Base URL | `base_url` | T 高级 | | ilink 默认 |
| CDN Base | `cdn_base_url` | T 高级 | | 默认 |
| 允许用户 | `allow_from` | T | | 建议非 `*` |
| 账号 ID | `account_id` | T | | default |
| Route Tag | `route_tag` | T | | 空 |
| 长轮询超时 ms | `long_poll_timeout_ms` | Num | | 35000 |
| 代理 | `proxy` | T | | 空 |
| 绑定群 chat_id | `chat_id` | T 可选 | | 空=全部；群须 `@chatroom` |

**扫码 UI：** 调 Bridge/本地 setup 接口出码 → 手机微信扫 → 成功写 token。  
对齐 cc-connect `weixin setup` / OpenClaw 流程。  
**Presenter 强制默认文本菜单**（无回调卡片）。

---

### 6.10 QQ OneBot `qq`（NapCat 等）

| 连接 | 正向 WebSocket（依赖用户自建） |

| GUI 标签 | 字段 | 控件 | 必填 |
|----------|------|------|:----:|
| WebSocket URL | `ws_url` / `url` | T | ✅ |
| Access Token | `token` | P | |
| 允许用户 | `allow_from` | T | |

Callout：社区桥、风险自负。

---

### 6.11 QQ 官方机器人 `qqbot`

| 连接 | 官方 WebSocket |

| GUI 标签 | 字段 | 控件 | 必填 |
|----------|------|------|:----:|
| App ID | `app_id` | T | ✅ |
| App Secret | `app_secret` | P | ✅ |
| Intents | `intents` | 多选 Cb 或说明默认含 INTERACTION | |
| 允许用户 | `allow_from` | T | |

---

### 6.12 Matrix `matrix`

| 连接 | /sync 长轮询 · 无需公网 |

| GUI 标签 | 字段 | 控件 | 必填 | 默认 |
|----------|------|------|:----:|------|
| Homeserver URL | `homeserver` | T | ✅ | — |
| Access Token | `access_token` | P | ✅ | — |
| User ID | `user_id` | T | | 可自动探测 |
| Device ID | `device_id` | T | | |
| 允许用户 | `allow_from` | T | | `*` |
| 自动加入房间 | `auto_join` | Cb | | true |
| 自动 SAS 验证 | `auto_verify` | Cb | | true |
| Cross-signing 密码 | `cross_signing_password` | P | | 空 |
| 房间共享会话 | `share_session_in_channel` | Cb | | false |
| 群内回复全部消息 | `group_reply_all` | Cb | | false |
| 代理 | `proxy` | T | | 空 |

---

### 6.13 微博 `weibo`

| 连接 | WebSocket · 无需公网 |

| GUI 标签 | 字段 | 控件 | 必填 | 默认 |
|----------|------|------|:----:|------|
| App ID | `app_id` | T | ✅ | — |
| App Secret | `app_secret` | P | ✅ | — |
| 允许用户 | `allow_from` | T | | `*` |
| Token 端点 | `token_endpoint` | T 高级 | | 平台默认 |
| WS 端点 | `ws_endpoint` | T 高级 | | 平台默认 |

绑定：粘贴为主；可选「引导配置」Wizard（逐步说明，仍 GUI）。

---

### 6.14 LINE `line`

| 连接 | **Webhook · 需要公网 URL** |

| GUI 标签 | 字段 | 控件 | 必填 |
|----------|------|------|:----:|
| Channel Secret | `channel_secret` | P | ✅ |
| Channel Access Token | `access_token` / `channel_access_token` | P | ✅ |
| Webhook 本地端口 | `port` | Num | |
| 回调路径 | `callback_path` | T | |
| 公网说明 | — | **强 Callout**：需隧道；提供「推荐 cloudflared」复制片段（辅助） | |

---

## 7. Grok Build 对接

| 项 | 规格 |
|----|------|
| Agent | 仅 Grok Build CLI / ACP（`--resume` + `GROK_HOME=agent-home`） |
| work_dir | 仅 App 信任项目 path。`{ allow: [] }` / 未知 scope **不**回退 `$HOME`，自由文本不 spawn，回复「没有可用项目，请 /p」 |
| 新会话 | IM 首轮后写入 `sessions_index` + `sessions/<id>/messages.json`；标题取自首条用户消息 |
| 继续 | 绑定 `agentSessionId`；每轮 append user/assistant 到 App journal |
| 恢复 | `/r` 读 `sessions_index`；`--resume` 用 `agentSessionId` |
| 侧栏同步 | 写盘后 emit `session://index_changed`，App 刷新会话列表 |
| 权限 | 受「允许远程 YOLO」总闸 |
| 飞书渲染 | 含 Markdown 时用 interactive 卡片 `schema 2.0` markdown 元素（非 plain text） |
| 媒体 | 按渠道能力入站/出站；路径防穿越 |
| 并发 | 复用 App maxConcurrentAgents |

---

## 8. 数据模型与落盘

```
~/.grok-app/
  remote/
    channels.json       # 实例元数据（无明文 secret）
    bindings.json       # chatKey → project/session
    bridge.pid
    logs/bridge.log
  projects.json
  sessions_index.json
  sessions/<id>/
  secrets.json | Keychain  # credentialsRef
```

```ts
// channels.json 单实例
{
  id: string;
  channel: RemoteChannelId;
  name: string;
  enabled: boolean;
  credentialsRef: string;
  options: Record<string, unknown>; // §6 字段
  acl: { allowFrom: string; allowChat?: string; requireMention?: boolean; groupOnly?: boolean; adminFrom?: string };
  projectScope: "all_trusted" | { allow: string[] };
  presenter: "auto" | "text_only";
}
```

---

## 9. Bridge 与 App 集成

| 模式 | 默认 |
|------|------|
| Attached：App 启停 Bridge | ✅ |
| Detached：后台常驻 | 高级选项 |

IPC（localhost + token）：status / start / stop / reload channel / test connection / logs / events。

---

## 10. 安全、i18n、对话框

- Secret：遮罩、不进 git、日志 redact  
- 删除/断开/开 YOLO/后台常驻：`GlassModal` / `setAppDialog`  
- 文案：`createT` · keys 前缀 `settings.remoteIm.*` · `remoteIm.channel.<id>.*`  
- 图标：遵守 icons.md  

---

## 11. 分期与验收

| Phase | 范围 |
|-------|------|
| **P0** | 布局骨架 + Bridge 总览空态 + i18n + 渠道侧栏全列表（未实现灰态） |
| **P1** | 飞书/Lark：扫码+粘贴 GUI、ACL、项目范围、连接、/p /r 卡片 |
| **P2** | 钉钉粘贴、企微 WS、微信个人扫码+文本菜单 |
| **P3** | Telegram / Discord / Slack / Matrix |
| **P4** | QQ / 微博 / WPS / LINE + Webhook 隧道辅助 |
| **P5** | 钉钉扫码二期、消息双向合并、Detached |

**验收 S1：** 任意已实现渠道可在 **不打开终端** 的情况下完成绑定并显示绿点。

---

## 12. 组件与代码落点

| 模块 | 路径建议 |
|------|----------|
| 设置分区 | `SettingsPage` + `remote_im` |
| 布局 | `RemoteImLayout.tsx` |
| 总览 | `RemoteImOverview.tsx` |
| 渠道面板 | `RemoteImChannelPanel.tsx` |
| 绑定 | `RemoteImBindForm.tsx`（scan \| paste） |
| 字段 schema | `src/lib/remoteIm/channelSchemas.ts`（每渠道字段驱动表单） |
| Host | `src-tauri/src/remote_im/` |
| **内置 Bridge** | **Rust 进程内** `src-tauri/src/remote_im/`（飞书 WS / Telegram / Discord / Slack 等；**不** spawn Node / agent-connect） |
| 样式 | `app.css` `.rim-*` |
| 规则 | **本文** |

表单采用 **schema 驱动**：新增渠道 = 加 schema + 适配器，少写重复 JSX。

---

## 13. 附录：cc-connect 对照表

| cc-connect | GUI |
|------------|-----|
| `[[projects.platforms]] type=` | 侧栏渠道 + 实例 |
| `[projects.platforms.options]` | 右侧表单字段 §6 |
| `feishu setup` / `bind` | 扫码 Tab / 粘贴 Tab |
| `weixin setup` | 微信扫码区 |
| `allow_from` / `allow_chat` | ACL 区块 |
| `share_session_in_channel` | Checkbox |
| `thread_isolation` | Checkbox |
| `progress_style` | Select |
| `reaction_emoji` / `done_emoji` | Text 或无 |
| `proxy` | Text（Telegram/Matrix/企微等） |
| 手写 work_dir | **项目多选**（无任意路径） |
| `cc-connect start/status/doctor` | Bridge 总览按钮 |

---

## 14. 待决 / Phase 5 开放问题

| 项 | 现状 | 待决 |
|----|------|------|
| Detached 默认 | GUI 可选；默认 Attached | 是否默认后台常驻 |
| 速率限制 / 崩溃恢复 | **RIM-RESILIENCE**：看门狗指数退避重连（上限 60s）；入站回合软限速（每会话 8 / 全局 40 / 60s）诚实回复；总览 recovery 卡 + status 字段 | 可调默认值 / 出站 API 429 细粒度 |
| agent-connect 配置迁移 | CLI：`grok-remote-bridge migrate from-agent-connect` | GUI 一键导入可选 |
| 钉钉扫码 | 首版粘贴；扫码 Tab 无官方能力时保持降级 | 官方 API 可用后再开 |
| 真机 Bridge | **Rust in-process**（`remote_im/channels/*`） | 长尾渠道协议深化；`remote-bridge/` Node 仅作历史参考 |

---

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-25 | 功能设计定稿：全渠道 GUI 字段、绑定/扫码、二级侧栏布局、与 cc-connect 对齐 |
| 2026-07-25 | App 落地：Settings 二级布局 + schema 全渠道表单 + mock Bridge + `/p` `/r` 控制平面；§14 待决 |
| 2026-07-25 | **agent-connect 迁入**：`remote-bridge/` 内置；Host **永不** PATH 查找外部 agent-connect；数据目录 `~/.grok-app/remote/bridge-data` |
| 2026-07-25 | **全渠道 Rust 重写**：Host 进程内 Tokio 运行时；飞书长连接 / Telegram 长轮询 / Discord Gateway / Slack Socket Mode；无 Node 子进程 |
| 2026-07-31 | **RIM-RESILIENCE**：Bridge 崩溃恢复退避、入站软限速诚实文案、总览 recovery 状态（`resilience.ts` + Host `resilience.rs`） |

---

*实现以本文为准；字段增补时同步改 §6 与 `channelSchemas.ts`。*
