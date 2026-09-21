# Issues / PRs triage — 2026-09-20

> **基线：** `origin/main` = **v0.2.36** (`2b47ea11`)。  
> **本机：** `fix/session-workspace-inherit-and-cli-delete` = PR **#1237**（CI 四平台绿，MERGEABLE）。  
> **对齐：** [maintain.md](../llm-wiki/maintain.md) · [catalog.md](../llm-wiki/catalog.md) · [2026-09-18-community-features-research.md](./2026-09-18-community-features-research.md)

---

## 0. 一句话结论

| 桶 | 内容 | 动作 |
|---|---|---|
| **立刻合** | PR **#1237**（Fixes #1233 #1236） | 功能逻辑修复，CI 绿，可 squash-merge |
| **本轮修（P1）** | #1241 权限策略名不副实 · #1238 LaTeX 分隔符 · #1239 macOS 到底后跳历史 | 各开独立分支，先回归测试再改 |
| **回复即可（P2）** | #1240 卡巴斯基误报 | 文档 + 排除项；不能靠改业务代码「杀毒」 |
| **已有方案、等拍板（P2）** | #1232 项目级多根 · #1234 主窗口双栏 · #1235 列宽滑杆 | 见 9-18 调研；#1235 产品里已有四档宽度 |

本轮 **0 个 P0**。没有社区 PR 要审（只有维护者 #1237）。

---

## 1. 库存（拉单时刻）

### 1.1 OPEN Issue（9）

| # | 标题 | 作者 | 标签（本轮已对齐） | 桶 |
|---|------|------|-------------------|----|
| **1241** | 替我审批/自动仍对每条 shell 弹权限 | LanyXiaosheng | bug · p1 · area:session | **C 我们修** |
| **1240** | 卡巴斯基拦截 | league7114-beep | documentation · p2 · windows | **D 回复 / 签名拍板** |
| **1239** | macOS 滚到聊天底部后视口跳回历史消息 | Aaashair | bug · p1 · macos · area:session | **C 我们修** |
| **1238** | Windows 上 LaTeX 仍显示为原始 TeX | lihengyu-svg | bug · p1 · windows · area:session | **C 我们修** |
| **1236** | 共享模式删除后 Import 复活 | Marty-G1tHub | bug · p1 · windows | **A #1237 关** |
| **1235** | 大屏对话两边空白 | yunwei1237 | enhancement · p2 · triage | **B 拍板**（已有四档宽度） |
| **1234** | 拖拽拆分对话框 | yunwei1237 | enhancement · p2 · triage | **B 拍板** |
| **1233** | 附加根写入失败 | RaymondCJY | bug · p1 · macos | **A #1237 关** |
| **1232** | 一个项目配置多个目录 | zxyzxy123123 | enhancement · p2 · area:session | **B 拍板**（方案 B 已写） |

### 1.2 OPEN PR（1）

| PR | 主题 | +/− | 关 Issue | CI | mergeable | 政策 |
|----|------|-----|----------|----|-----------|------|
| **#1237** | 新聊天继承附加根；删除停 ACP + tombstone，Import 不再复活 | 714 / 28 · 30 files | **#1233 #1236** | 四平台 SUCCESS | CLEAN | **Auto-path：功能逻辑，可 squash** |

`AppWorkbench.tsx` 只多了一行归档确认文案（`sidebar.archiveCliHint`），无新 `useState`。CHANGELOG 已写在 `## [Unreleased]`。

---

## 2. PR #1237 — 先合

**Why 合：** 两张 P1 的根因都在 Host，不是 UI 重做。

- **#1233：** 附加根写在「绑过 workspace 的旧聊天」上通，**同项目新聊天没有 `workspaceId`**，spawn 落到内置 `GROK_SANDBOX=workspace`，Seatbelt 拦住附加目录。#1237 让未绑定行继承项目 workspace；Fork 拷绑定；「从本会话解除」写哨兵 `"-"`，重连不再绑回去。
- **#1236：** 归档不复活（索引里还挂着 `agentSessionId`）。真正复活的是 **App 删除只丢 journal**。#1237：先停 live/background/parked ACP → 删 CLI 目录 → tombstone；`import_all` 跳过 tombstone、`CLI xxxxxxxx` stub、System32 / `workspaces/general`。归档仍只藏 App 侧栏（文案已写明）。

**不合进去的：** #1232 项目级默认多根 UI；#1234 拆栏；#1235 列宽滑杆。

**落地后：** squash-merge `--delete-branch` → 关 #1233 #1236 → 本地删 `fix/session-workspace-inherit-and-cli-delete`。不发版也可以，等 P1 修完再打 patch。

---

## 3. #1241 替我审批 / 自动 — P1

### 用户在做什么

截图（不是「替我审批」芯片，是 **「自动」**）：默认工作区、**没有项目**，优化电脑性能，一条条 PowerShell（`Get-ChildItem F:\AppData\SogouInput\...`）弹出「允许一次 / 会话内允许 / 拒绝」。用户觉得选了宽松策略还在手动点。

### 根因（代码已对上，不是「CLI 没接到 flag」）

| 产品档 | 文案承诺 | 实际 |
|---|---|---|
| **替我审批** `allow_for_session` | 「仅高风险操作需批准」 | CLI 仍是 `--permission-mode default`（和 **请求批准** 一样）。Host **不会**主动代点。只有用户点过「会话内允许」且 **同一 scope_key 命中缓存** 才自动放行。 |
| **自动** `auto` | 「减少弹窗，安全检查后自动放行」 | CLI 会带 `--permission-mode auto`。Agent 若仍发 `session/request_permission`，Host **当成 Ask**（`may_auto_allow` 里 `Auto` 不会放行 shell）。 |
| **完全访问** `always_approve` | 不询问 | 这才是 YOLO（`bypassPermissions` + `--always-approve`）。 |

另外两刀让「会话内允许」也像没开：

1. **scope_key 按命令前缀**（shell 常是可执行文件名）。对 `Write-Host ...` 点「会话内允许」，下一条 `Get-Process` 仍弹。所以会「一直在手动审批」。
2. **无项目 / 默认工作区 + 项目外路径**（截图是搜狗输入法目录）。`may_auto_allow`：项目外路径除 YOLO 外永不自动（§17.3）。

### 方案（要拍板选一条）

| | A. 只改文案 | B. 会话内按工具族记住（推荐最小刀） | C. 策略档真正代批 |
|---|---|---|---|
| 行为 | 说明 替我审批 ≠ 完全访问；无项目跑系统命令仍问 | `allow_for_session` 下「会话内允许」缓存 `run_terminal_command:*`（工具族），不是每一条命令一个 key | Host 对非高风险 **直接** `allow_session`，不再等第一次点击。高风险（项目外写入、破坏性、无项目乱扫盘）仍弹 |
| 截图那条 Sogou `Get-ChildItem` | 仍弹（诚实） | 点一次该工具族后不再弹 | 若把「默认工作区只读列举」当低风险则不弹；写入 / 改服务仍弹 |
| 风险 | 用户仍觉得没用 | 同会话任意 shell 被记住，需排除破坏性 | 接近 YOLO，要写清高风险表 |
| 成本 | S | S/M | M |

**推荐 B + 文案修正**，C 要你点头。

- 文案：`policy.allow_for_sessionDesc` 改成「本会话记住已允许的工具；项目外写入等仍会问」。`policy.autoDesc` 写明「CLI 自动检查后若仍要批，应用里还是会问」。
- 设置 / 权限条加一句：不要项目、要扫全盘 → 用 **完全访问**。
- 不把 `allow_for_session` 映射成 `bypassPermissions`（那是 YOLO，已有双确认）。

### 文件（若做 B）

- `src-tauri/src/permission.rs`：`may_auto_allow` / `SessionAllowCache` / shell `scope_key`
- `src-tauri/src/session_manager/control.rs`：写入缓存的粒度
- `src/lib/permissionModeMap.ts` + `docs/llm-wiki/catalog.md`（策略表诚实）
- `src/i18n/messages/*/features.ts`（15 语言同一 key）
- 回归：`permission.rs` 里已有 `AllowForSession` 测试，补「同工具不同命令」

**不要**改 `App.tsx` / `AppWorkbench.tsx` 加状态。Composer 芯片已在 `ComposerModelMenu`。

---

## 4. #1238 LaTeX — P1（不是从零做公式）

### 用户在做什么

- 0.2.36 / Win10。助手气泡里是灰底原始 TeX：`[ I=\int_1^2\int_{\sqrt{...}} ... ]`
- 第二张图是 **Cherry Studio 的「渲染设置」**（`$...$` / 数学公式 / 用户消息 Markdown），不是 Grok App。
- 第三张是三周前关的 **#932**：0.2.27 已用 KaTeX 渲染 `$` / `$$` / `\(...\)` / `\[...\]`。

产品里公式渲染 **已经有**。0.2.35 还修过「KaTeX CSS 与 JS 同版本」并只打 woff2 字体。

### 根因（待测试钉死，优先这两条）

1. **分隔符不是 `$`。** 截图是方括号包着整段公式。模型常写 `\[...\]`；CommonMark 会把 `\[` 当成转义 `[`，画出来就是 `[ I=\int ... ]`。现有测试只保证 `$E=mc^2$` 和 `$$...$$` 出 `.katex`，**没有**把 `\[...\]` 打进 `MarkdownChat`。
2. **助手把公式放进代码块 / 灰底 pre**，KaTeX 故意不进 fence。

不是 Win10 缺 woff2：缺字会看到 KaTeX 空盒子，不会整段 TeX 源码。

### 方案

| | A. 修 `\[` / `\(` 解析（推荐先做） | B. 兼容 `[ tex ]` 一行公式（Cherry 习惯） | C. 加渲染开关 |
|---|---|---|---|
| 行为 | `MarkdownChat` / `MarkdownBody` 对 `\[...\]` `\(...\)` 出 `.katex` | 单独一行、里面有 `\int`/`\frac` 的 `[...]` 当 display math | 设置里学 Cherry 做开关 |
| 成本 | S | S/M，误伤 markdown 链接 | 不需要，助手 Markdown 本来就开 |

**推荐 A，必要时加 B。** 用户消息继续不渲染 Markdown（产品规则）。不要做 Cherry 那套开关。

### 文件

- 先写失败测试：`src/components/lobe-chat/MarkdownChat.test.tsx`（`\[ I=\int ... \]`、`\(x^2\)`）
- `src/lib/markdownMath.ts`（`sourceHasMath`、remark 插件顺序 / micromark math）
- 若 CSS 动态 import 在 Win 上偶发失败：核对 `rehypeKatexCssLoader`，不要把 `katex.min.css` 重新挂回 `main.tsx` 除非测试证明首屏必需

---

## 5. #1239 macOS 到底后跳回历史 — P1

### 用户在做什么

MacBook、0.2.36、CLI 1.0.34。把长会话滚到最底，视口 **突然上跳，停在某条历史消息**。全屏/窗口都有。Windows 没有。  
不是已关的 #646（触控板拖离底部被拽回）。

### 最像的机制

虚拟列表在贴底时按 `scrollTop` 开窗；macOS WKWebView 弹性滚动 / 小数 DPR 会让 **pin 窗口和真实 scrollTop 错位**，下一次 commit 把视口映射到中间某行。Host 里已有注释：高度为 0 的 WebView 会把 pin 窗写到全文，聚焦后落到中段。

已有缓解：`overflow-anchor: none`、`overscroll-behavior: none`、设置 → 外观 → **对话滚动优化**（`appearance.chatVirtualScroll`）可关。

### 方案

1. **先请报告者关掉「对话滚动优化」** 看是否消失 → 能区分虚拟列表 vs 贴底锁。
2. 本地：长会话 + 虚拟开，触控板滚到硬底，看 `useChatMessageVirtualizer` 是否在 pin 时仍按错误 `scrollTop` 开窗。
3. 修：贴底时窗口 **只跟 tail**（已有 `pinToBottom`，查谁在硬底仍走 escaped 分支）；硬底后忽略一次弹性回弹（现有 rebound 逻辑偏 WebView2）。
4. 回归：`stickToBottom` + `useChatMessageVirtualizer` 测「at hard bottom → height commit 不把 scrollTop 映射到中间」。

**不要**为这张票重做滚动物理。先确认虚拟列表开关，再动 `src/hooks/useChatMessageVirtualizer.ts` / `src/hooks/useStickToBottom.ts` / `src/lib/stickToBottom.ts`。

---

## 6. #1240 卡巴斯基 — P2（不能当功能做）

未签名的社区 Windows 包（Tauri + sidecar CLI）会被启发式杀毒标毒。README 只写了 SmartScreen，没写 Kaspersky。应用里加排除项也拦不住驱动层拦截。

| 能做 | 不能做 |
|---|---|
| Issue 回复：SHA256SUMS、排除安装目录与 `%LOCALAPPDATA%` 里的 grok-app、向卡巴斯基提交误报 | 改业务代码让卡巴斯基闭嘴 |
| README 加一小节「第三方杀毒误报」 | 假装有病毒要修 |
| 若仓库已有 `WINDOWS_CERTIFICATE`：Release 走 Authenticode（`docs/BUILD.md`） | 没有 OV/EV 证书就无法从根上消 SmartScreen / 卡巴 |

**等拍板：** 是否买 / 启用 Windows 代码签名。未签名就保持「校验哈希 + 排除项」诚实路径。

---

## 7. 已调研、本轮不动（P2）

详见 [2026-09-18-community-features-research.md](./2026-09-18-community-features-research.md)。#1237 合入后：

| Issue | 现状 | 下一刀（需拍板） |
|---|---|---|
| **#1235** 大屏空白 | **设置 → 外观 → 界面 → 对话阅读宽度** 已有 窄/中/宽/全宽 | 只补发现性，或再加百分比滑杆。建议先让报告者选「宽/全宽」，不要第二套宽度系统 |
| **#1232** 项目多目录 | 会话级附加根 + #1237 同项目新聊天会继承 | 方案 B：`Project.defaultWorkspaceId` + 项目右键「默认附加根」。Shared 仍不改 `~/.grok` |
| **#1234** 拆栏 | 已有独立会话窗口 + 系统 Snap | v1 最多主窗口左右两栏；不做 2×2、不做应用内仿 Win11 Snap |

---

## 8. 执行顺序（你点头后）

```text
1. squash-merge #1237 → 关 #1233 #1236 → 删已合分支
2. #1241 B：权限缓存粒度 + 文案（独立 PR，Fixes #1241）
3. #1238 A：`\[` / `\(` 回归测试 + 解析（独立 PR，Fixes #1238）
4. #1239：先用虚拟滚动开关定性，再修 pin 窗口（独立 PR，Fixes #1239）
5. #1240：Issue 回复 + README 杀毒误报（可跟 1238 或单独 docs PR）
6. 三张 P1 合完再考虑 patch（0.2.37），CHANGELOG 只写 Unreleased
```

**并行：** 2 与 3 不撞文件，可两个 worktree。4 碰滚动，不要和 3 同时改 `ConversationThread`。

**冻结：** 新状态不要进 `App.tsx` / `AppWorkbench.tsx`。UI 字符串走 `src/i18n/`。弹窗继续 `setAppDialog`，禁止 `window.confirm`。

---

## 9. 需要你拍板的三问

1. **#1237** 现在 squash-merge？
2. **#1241** 走 B（工具族会话缓存 + 改文案），还是 C（非高风险直接代批）？
3. **#1232 / #1234 / #1235** 继续挂，还是指定其中一张进下一轮功能？
