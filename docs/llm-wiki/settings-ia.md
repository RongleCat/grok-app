# Settings IA（设置页信息架构）

Agent / 贡献者维护设置 UI 时**必读**。目标：层次清晰、可搜可跳、加设置不腐烂。

## 架构

| 层 | 位置 | 职责 |
|----|------|------|
| Registry | `src/lib/settingsCatalog.ts` | 一级导航、页内 tab、可搜条目、hash 解析 |
| Shell | `src/components/SettingsPage.tsx` | 左栏 + 搜索命中列表 + 分 section 内容 |
| 路由 | `App.tsx` hash | `#/settings/{section}[/{tab}]` |

## 一级导航（固定 9 项，禁止双登记）

个人：`general` · `appearance` · `account` · `archived`  
系统：`extensions` · `runtime` · `remote_im`（展示名「远程控制」）· `shortcuts` · `about`

**不要**再往 `SETTINGS_NAV` 塞重复 `runtime`。

## 页内 Tab

| Section | Tabs |
|---------|------|
| general | `composer` · `permissions` · `agent`（含 experimental memory、memory browser、**memory embedding 0.2.117**） · `app` |
| appearance | `theme`（主题：浅深色 / 皮肤 / 背景）· `interface`（界面：聊天展示） |
| account | `official` · `providers` · `extras`（「拓展」：官方工具注入开关） |
| extensions | `plugins` · `mcp` · `skills` · `agents` · `hooks`（**无** `market` / `apps`；`#/settings/extensions/market` → `plugins` 可安装目录锚点） |
| runtime | `cli` · `connection` · `network` · `pool` · `tools` · `privacy` |
| remote_im（远程控制） | `im`（IM 通信）· `mirror`（手机镜像） |
| 其余 | 无 tab（单页） |

默认 tab 见 `SETTINGS_NAV[].defaultTab`。

## 深链

```
#/settings/general                  → general/composer
#/settings/extensions/mcp           → 扩展 · MCP
#/settings/runtime/tools            → CLI · 诊断
#/settings/runtime/tools?pr=42      → 诊断 · PR hub（可选高亮 PR #42；ship 成功「在 PR 中心打开」）
#/settings/runtime/privacy          → CLI · 隐私中心
#/settings/account/providers        → 自定义提供商
#/settings/account/extras           → 拓展（官方工具注入 / 扩展 MCP）
#/settings/remote_im                → 远程控制 · IM 通信
#/settings/remote_im/mirror         → 远程控制 · 手机镜像
#/settings/appearance               → appearance/theme
#/settings/appearance/interface     → 外观 · 界面（聊天展示）
```

- 仅 section 的旧链**永远有效**（落到 default tab）。
- 未知 tab → default tab，不白屏。
- 构建：`buildSettingsHash`；解析：`parseSettingsHash`。

## 搜索与跳转

1. 用户输入 → `searchSettingsEntries` 匹配 label/desc/keywords（中英）。
2. 左栏筛 section + 展示命中列表（路径：`扩展 · MCP`）。
3. 点击命中 → `section + tab` + `scrollIntoView(anchorId)` + 短暂 `is-search-hit`。

## 管理面 vs 诊断面

| 面 | 放哪 | 说明 |
|----|------|------|
| 管理 Skills/MCP/Plugins/Hooks/Agents + 插件页内目录 | **扩展** | 可写开关、安装、移除；无独立市场 Tab |
| 只读 project inspect 摘要 | **运行时 · 诊断** | 保留；文案链到扩展 |
| CLI 路径 / ACP / 进程池 / Doctor / Managed setup / Privacy center | **运行时** | 不进扩展 |
| 本机会话列表 + 按 id 续跑（#626 第一刀） | **运行时 · 连接** | `runtime.sessionApi`；见 [session-api.md](./session-api.md) |

## 新增设置 — 强制清单

每次加用户可见设置项：

1. **UI** 落在正确 section/tab，控件带稳定 `id={anchorId}`。  
2. **`SETTINGS_ENTRIES` 登记**：`id` · `section` · `tab?` · `anchorId` · `labelKey` · `descKeys?` · `keywords?`。  
3. **i18n**：`messages.ts` en + zh，以及 `zh-tw.ts` 同步。  
4. **禁止**只改 UI 不登记（搜索会漏）。  
5. **慎加一级菜单**：跨产品域才加；否则优先页内 tab。  
6. **不改坏读写**：只动展示/导航时勿改 `settings_get/set` 字段语义与扩展 API 行为。  
7. 跑 `settingsCatalog.test.ts`（invariants + 搜索样例）。

## 相关

- 计划：`docs/plans/2026-07-26-settings-ia-reorg.md`
- i18n：`docs/llm-wiki/i18n.md`
- 账户分栏：`docs/llm-wiki/account.md`
- 插件市场：`docs/llm-wiki/plugins-marketplace.md`
