# 自动化 / 已安排任务

**状态**：P1 UI + 本地存储 + 对话静默创建 + 应用打开时壳层轮询触发。  
**原则**：能接 Build 就接 Build；壳层做清单、表单与编排。用户对话不暴露 JSON schema。

## 产品入口（Codex 对标）

| 入口 | 行为 |
|------|------|
| 侧栏 logo 下 **新建会话** | 无项目归属的草稿会话 → 首次发送落入「默认工作区」 |
| 侧栏 **已安排** | 主栏打开任务列表（`#/automations`） |
| 列表 **创建 → 用 AI 创建** | 切到无项目会话；composer 预填**自然语言**引导（不展示字段 schema） |
| 列表 **创建 → 手动创建** | 右侧表单：标题 / 指令 / 项目 / 模型 / 推理 / 频率 / 时间 / 通知 |
| Composer「+」→ 创建自动化 | 跳转已安排页 |

## 对话创建协议（静默）

1. 用户用自然语言描述「做什么 + 何时跑」。
2. 发送时 Host 给 Agent 追加**不进 journal 展示**的 setup 前缀（`wrapAutomationSetupAgentText`），仅当：
   - 侧栏 **用 AI 创建** 进入的会话（sticky `automationSetupSessionsRef`），或
   - 当前用户正文 `looksLikeScheduleIntent`（明确时间/周期；**排除**「禁止定时」与纯角色/目标模式长文），且**未**开 Composer Goal。
3. Agent 用自然语言确认；收齐信息后在回复**末尾**附加唯一 fence：

````text
```grok-automation
{"title":"...","prompt":"...","frequency":"daily|weekly|weekdays|once","time":"HH:MM","weekdays":[],"enabled":true}
```
````

4. 壳层在 stream `done` 时 `extractAutomationPayload`：从气泡**剥掉 fence**。
5. **自动**落库当 `shouldAutoApplyAutomationFence`：显式 AI 创建会话、近期像真实排程，**或**像在改已有任务（改路径/提示词/覆盖）；toast 区分「已创建 / 已更新」。
6. **默认 upsert**（非纯 create）：按 fence 可选 `id`，否则同 title（规范化）取 `updatedAt` 最新一条 → `automation_update`；无匹配 → `automation_create`。禁止对话再发 fence  silently 堆出同名第二份。
7. **否则**（意外 fence，如角色卡 /goal 误路由）：应用内确认（非 `window.confirm`）；取消则不落库。手动表单创建路径不变。
8. 同一消息 id / payload 只处理一次；reload 时也会剥 fence，避免用户看到 JSON。
9. **Apply 不止 stream `done`**：当前正在看的会话在 turn → ready、journal rehydrate、deferred reconcile、以及 Host `session://journal_reconciled` 后也必须再跑 `tryApplyAutomationFromSession`。

实现：`src/lib/automationSetup.ts` · 拦截在 `AppWorkbench.tsx` `tryApplyAutomationFromSession` · Host 事件在 `useSessionHostEvents.ts`。

**与 Goal 分流**：Goal = 有限目标干完即停；已安排 = 闹钟。勿把会话原则当成定时任务。

## 数据

- 文件：`paths::automations_file()`（macOS 常见：`~/Library/Application Support/com.grokapp.grok-app/automations.json`）
- 浏览器兜底：`localStorage["grok-app.automations"]`
- 字段：`title` `prompt` `enabled` `projectId` `modelId` `effort` `frequency` `time` `weekdays` `notify` `lastRunAt` `nextRunAt`

## 执行

1. **Host 调度**（`automation_runner`）：**进程存活**期间每 30s 检查 `enabled` 且 `nextRunAt` 到期的任务。**不依赖主窗口可见**（托盘-only / `--start-in-tray` 均可）。
2. 任一会话 mid-turn（streaming / permission / connecting / open tools）时不抢跑；空闲后下一 tick 补跑。
3. 触发：Host `session_create(scheduled)` → `connect` → `send_message`；成功 `mark_run`；`once` 后 `enabled=false`。
4. **connect 失败**：删除空壳 session；发 `automation://error`。
5. UI 监听 `automation://ran` / `automation://error` 做 toast，并写入**本地运行历史** ring；**不再**用 WebView `setInterval` 双触发。
6. 手动「立即执行」仍走前端 `runAutomation`（同样记录 ok / error / skipped）。

### 运行历史（observable，非假 daemon 日志）

- **SoT**：前端 `localStorage` ring（`grok.automationRunHistory`，max ~50），纯 helpers：`src/lib/automationRunHistory.ts`。
- **写入时机**：Host 事件 `automation://ran` / `automation://error`（进程存活期间观察到的触发）；以及 UI「立即执行」返回 ok / error / skipped。
- **字段**：`id` · `scheduleId` · `name` · `at` · `outcome`（`ok|error|skipped`）· 脱敏 `error` · `source`（`host|run_now|unknown`）。
- **诚实**：完全退出后**不会**虚构离线触发；空列表是 soft-fail 空态，不是「后台什么都没发生过」的宣称。
- **UI**：`AutomationsPage` **Inbox** 审阅队列（outcome chips + 搜索 + 未读 / 打开会话 / 软 Run now）+ GlassModal 清空（禁止 `window.confirm`）。纯 helpers：`automationsInbox.ts`。

### 托盘与「退出后」诚实模型（AUTO-RUNNER + AUTO-HEADLESS-LITE + A2 one-shot）

| 能力 | 行为 | 不是 |
|------|------|------|
| `automation_runner` | 进程内 30s tick；托盘隐藏窗口仍触发 | 独立守护进程 / 无 UI 调度器 |
| **Keep tray for schedules**（`keepTrayForSchedules`，默认 on） | 有启用任务时，关窗仍 hide→tray（即使 `closeToTray` 关） | 完全退出后仍跑 |
| Close to tray | 关窗常驻托盘 | 同上 |
| **macOS LaunchAgent helper**（可选） | 用户开启后：在 app data 生成脚本+plist，安装用户级 LaunchAgent；登录启动完整 App；**仅崩溃**后 KeepAlive 重启（`SuccessfulExit=false`） | headless daemon；正常 Quit 不强制拉起 |
| **One-shot fire helper**（A2） | CLI：`grok-app --fire-due-schedules`（或 `GROK_FIRE_DUE_SCHEDULES=1`）；助手脚本 `fire-due-schedules.sh`（与 LaunchAgent 文件同目录，**不**作为 KeepAlive 安装）。启动后 hide→tray，经既有 `fire_due_once` 路径最多触发 **一个**到期任务，回合空闲（软超时）后 **exit 0** | KeepAlive 常驻 daemon；连续 30s tick；自动 YOLO 批准 |
| Launch at login | 系统登录项重启 App | 同上 |

**AUTO-HEADLESS-LITE / A2（诚实 UI，无假 daemon）**

| 表面 | 内容 |
|------|------|
| 诚实矩阵 | 托盘/窗口 · 完全退出 · LaunchAgent · **One-shot** 四行产品真相（`automationsHonestyMatrix`） |
| 调度状态行 | Host 是否 running、`lastTickAt`、暂停/风险原因（`deriveAutomationsRunnerSurface`：`process_bound` / `close_exits` / `awaiting_tick` / …）— **UI 在 ⚙ 弹窗，非列表首屏** |
| One-shot 说明 | 托盘驻留 vs 完全退出后一次性触发；flag / 脚本名；soft-fail 无到期 / CLI 缺失（`automationsOneShotHelperSurface`）— **折叠在 ⚙ → 高级** |
| LaunchAgent 失败 | 安装/卸载/Reveal **soft-fail**：`GlassModal` + 明细；开关保持上次成功状态；文案重申非守护进程 |

**One-shot 结果 kind**（`FireDueOutcome.kind`，稳定契约）：`fired` · `none_due` · `busy` · `error` · `already_claimed`。

命令：`automation_runner_status` · `schedules_launch_agent_status` / `_set_enabled` / `_reveal_helper`。  
实现：`automation_runner.rs`（`fire_due_once` / `start_oneshot`）· `schedules_launch_agent.rs`（生成 `fire-due-schedules.sh`）· `AutomationsPage` 背景面板 · `src/lib/automationsHeadlessHonesty.ts`。

与 Build 的 `/loop`、`scheduler_*` 可并存：用户也可在会话里让 Agent 直接调度；壳层清单是独立 SoT。

## UI 约定

- **欢迎 SuperGrok 态**：仅无 `sessionId` 的草稿空会话。
- **已有 sessionId 但无消息**：提示「此会话暂无消息…」，不显示新建页大牌。
- **删除 / 危险操作**：禁止 `window.confirm`；用应用内弹窗（见 [dialogs.md](./dialogs.md)）。`AutomationsPage` 删除确认即范例。

### 已安排页信息架构（精简首屏）

主路径：**任务列表**。后台/诚实说明不常驻展开。

| 区域 | 行为 |
|------|------|
| 页头 | 标题 + 短副标题 · **状态 pill** · **⚙ 后台与调度** · `创建 ▾` |
| 风险横幅 | **仅 warn** 时一条（关窗会退出 / 无托盘保护等）；可快捷开 Keep tray 或 deep-link 设置。健康态无横幅 |
| Tab | **任务**（默认）· **收件箱**（运行审阅；未读角标） |
| 任务 Tab | 搜索 + 全部/启用/暂停 + 列表 / 空态 CTA |
| 收件箱 Tab | 观察 ring：筛选 / 打开会话 / Run now；空态短文案，不占任务首屏 |
| ⚙ GlassModal | Host 状态 · Keep tray · 登录启动链接 · LaunchAgent · **折叠「调度如何运行」**（诚实矩阵 + one-shot） |

原则：能力不删；SoT 仍在 AppSettings + Host runner；页面只做任务管理 + 风险就近修复。

**滚动（#543）**：`.auto-page` 使用 `overflow-y: auto`（禁止 `overflow: hidden` 锁死整页）。首屏大块 `flex-shrink: 0`（诚实矩阵 / LaunchAgent / one-shot 等）超出视口时必须能滚轮/触控板滑动；任务列表在仍有剩余高度时由 `.auto-page__body` 内部滚动。

## Tauri 命令

- `automations_list`
- `automation_create` / `automation_update`
- `automation_set_enabled`
- `automation_mark_run`
- `automation_delete`

## 验收

- [x] 侧栏新建会话不依赖当前项目，会话出现在「默认工作区」
- [x] 已安排列表 / 筛选 / 搜索 / 启停 / 删除
- [x] 手动表单创建与编辑
- [x] AI 创建入口：自然语言 seed，不暴露 JSON schema
- [x] 助手 fence 自动 `automation_create`，气泡不展示配置块
- [x] 应用打开时到期可触发（不阻塞主对话架构）
- [x] connect 失败不留空壳会话；已有空会话不伪装成新建页
- [x] 托盘收起时 Host 仍可触发（进程常驻；完全退出则暂停）
- [x] **诚实后台状态**（AUTO-DETACH lite）：`automationsBackgroundStatus`；有启用任务时列表页横幅说明「须应用/托盘存活」；可链到「登录时启动」；忙碌退出确认可附暂停说明。**无**独立后台 runner 二进制
- [x] **Keep tray for schedules** 设置 + 关窗策略（有启用任务时 hide→tray）
- [x] `automation_runner_status` + 已安排页背景面板（诚实文案；无假 daemon 宣称）
- [x] 可选 macOS LaunchAgent **助手**（app data 生成；登录/崩溃拉起完整 App；非 headless）
- [x] **AUTO-HEADLESS-LITE**：诚实矩阵（托盘 vs 退出 vs LaunchAgent）+ runner 状态面（last tick / paused reason）+ LaunchAgent 安装失败 GlassModal soft-fail；纯 helpers + 单测
- [x] **运行历史**：本地 ring（max ~50）观察 host 触发 + Run now；outcome 筛选 / GlassModal 清空；不发明退出后后台 fire；纯 helpers + 单测
- [x] **AUTO-HEADLESS A2 one-shot**：`--fire-due-schedules` / 助手脚本 `fire-due-schedules.sh`；`fire_due_once` 复用 runner 路径；无到期/CLI 软失败；退出码 0（非 KeepAlive）；诚实矩阵 + UI 文案；纯 helpers + 单测
- [ ] 与 CLI scheduler 双向同步（可选 P2）
- [ ] 无 UI 进程的真正 headless runner（可选 P2；当前明确不做假宣称；A2 仅为 one-shot 助手）
