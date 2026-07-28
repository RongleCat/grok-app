# 自动化 / 已安排任务

**状态**：P1 UI + 本地存储 + 对话静默创建 + 应用打开时壳层轮询触发。  
**原则**：能接 Build 就接 Build；壳层做清单、表单与编排。用户对话不暴露 JSON schema。

## 产品入口（Codex 对标）

| 入口 | 行为 |
|------|------|
| 侧栏 logo 下 **新建会话** | 无项目归属的草稿会话 → 首次发送落入「其他会话」 |
| 侧栏 **已安排** | 主栏打开任务列表（`#/automations`） |
| 列表 **创建 → 用 AI 创建** | 切到无项目会话；composer 预填**自然语言**引导（不展示字段 schema） |
| 列表 **创建 → 手动创建** | 右侧表单：标题 / 指令 / 项目 / 模型 / 推理 / 频率 / 时间 / 通知 |
| Composer「+」→ 创建自动化 | 跳转已安排页 |

## 对话创建协议（静默）

1. 用户用自然语言描述「做什么 + 何时跑」。
2. 发送时 Host 给 Agent 追加**不进 journal 展示**的 setup 前缀（`wrapAutomationSetupAgentText`）。
3. Agent 用自然语言确认；收齐信息后在回复**末尾**附加唯一 fence：

````text
```grok-automation
{"title":"...","prompt":"...","frequency":"daily|weekly|weekdays|once","time":"HH:MM","weekdays":[],"enabled":true}
```
````

4. 壳层在 stream `done` 时 `extractAutomationPayload`：从气泡**剥掉 fence**，调用 `automation_create`，toast「已安排：{title}」。
5. 同一会话只 apply 一次；reload 时也会剥 fence，避免用户看到 JSON。

实现：`src/lib/automationSetup.ts` · 拦截在 `App.tsx` `tryApplyAutomationFromSession`。

## 数据

- 文件：`paths::automations_file()`（macOS 常见：`~/Library/Application Support/com.grokapp.grok-app/automations.json`）
- 浏览器兜底：`localStorage["grok-app.automations"]`
- 字段：`title` `prompt` `enabled` `projectId` `modelId` `effort` `frequency` `time` `weekdays` `notify` `lastRunAt` `nextRunAt`

## 执行

1. **Host 调度**（`automation_runner`）：进程存活期间每 30s 检查 `enabled` 且 `nextRunAt` 到期的任务（**含窗口收起到托盘**）。
2. 任一会话 mid-turn（streaming / permission / connecting / open tools）时不抢跑；空闲后下一 tick 补跑。
3. 触发：Host `session_create(scheduled)` → `connect` → `send_message`；成功 `mark_run`；`once` 后 `enabled=false`。
4. **connect 失败**：删除空壳 session；发 `automation://error`。
5. UI 监听 `automation://ran` / `automation://error` 做 toast；**不再**用 WebView `setInterval` 双触发。
6. 手动「立即执行」仍走前端 `runAutomation`。

与 Build 的 `/loop`、`scheduler_*` 可并存：用户也可在会话里让 Agent 直接调度；壳层清单是独立 SoT。

## UI 约定

- **欢迎 SuperGrok 态**：仅无 `sessionId` 的草稿空会话。
- **已有 sessionId 但无消息**：提示「此会话暂无消息…」，不显示新建页大牌。
- **删除 / 危险操作**：禁止 `window.confirm`；用应用内弹窗（见 [dialogs.md](./dialogs.md)）。`AutomationsPage` 删除确认即范例。

## Tauri 命令

- `automations_list`
- `automation_create` / `automation_update`
- `automation_set_enabled`
- `automation_mark_run`
- `automation_delete`

## 验收

- [x] 侧栏新建会话不依赖当前项目，会话出现在「其他会话」
- [x] 已安排列表 / 筛选 / 搜索 / 启停 / 删除
- [x] 手动表单创建与编辑
- [x] AI 创建入口：自然语言 seed，不暴露 JSON schema
- [x] 助手 fence 自动 `automation_create`，气泡不展示配置块
- [x] 应用打开时到期可触发（不阻塞主对话架构）
- [x] connect 失败不留空壳会话；已有空会话不伪装成新建页
- [x] 托盘收起时 Host 仍可触发（进程常驻；完全退出则暂停）
- [ ] 与 CLI scheduler 双向同步（可选 P2）
- [ ] 登录项 / 系统服务无 UI 进程（可选 P2）
