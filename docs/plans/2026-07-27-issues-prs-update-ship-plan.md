# Issues / PRs 清理 · 修复合并 · 新功能 · 自动更新 完整方案

> **日期：** 2026-07-27  
> **基线：** `main` @ v0.1.8（`9688b62` 附近）  
> **范围：** 当前 GitHub Issues / Open PRs 分流、修复优先级、功能批整合策略、Tauri + GitHub Release 自动更新路线、日常开发与发版闭环  
> **对齐：** [maintain.md](../llm-wiki/maintain.md) · [release.md](../llm-wiki/release.md) · [remote-im.md](../llm-wiki/remote-im.md) · [P0-能力矩阵 L08](../P0-能力矩阵.md)

---

## 0. 一句话结论

| 维度 | 现状 | 动作 |
|------|------|------|
| **Issues** | 仅 2 个 OPEN，均为真实日用 bug | 立刻打标 + 进 **0.1.9 热修** |
| **社区小 PR** | #131–#133 文档、#134 侧栏 busy | 可直接审并 merge |
| **功能大 PR 批** | #151–#160 全部 **CONFLICTING**；前身 #135–#150 **CLOSED 未 merge** | **禁止逐个硬合**；改「主题切片 + 基于最新 main 重开 / 本地 integrate」 |
| **自动更新** | L08 仅 **半成品**：能查 Release，**不**装、**不**用 `tauri-plugin-updater` | 分 **三档**推进；当前不启用静默 updater |
| **发版** | 流程健康（tag → CI → 多端资产 + SHA256SUMS） | 热修走 patch；功能批走 minor 或下一 patch 分批 |

---

## 1. 当前库存盘点（2026-07-27）

### 1.1 Open Issues

| # | 标题 | 建议标签 | 优先级 | 根因线索（代码） |
|---|------|----------|--------|------------------|
| **#162** | Win11 0.1.8 新建项目时大量无效 cmd 弹窗 | `bug` `priority:p0` `platform:windows` `area:session` | **P0** | 多处 `Command::new` 未统一走 `process_util::apply_no_window_*`；新建项目会连打 CLI 探测 / PATH / 编辑器 / 代理探测，Windows GUI 子进程会闪 console |
| **#161** | LINE UI「已连线」但 8081 无监听 | `bug` `priority:p0` `platform:macos` `area:session`（或新增 `area:remote-im`） | **P0** | ① UI 写死 `127.0.0.1:**8081**`（`RemoteImChannelPanel.tsx`），Rust 默认端口 **8082**（`line.rs`）；② 「已连接」= 凭证校验 / Bridge 状态，**≠** webhook listener 已 bind；③ `channel_secret` 未做签名校验（`let _ = channel_secret`） |

Closed 近期：#128 等已在 0.1.8 一带合入，无需再开。

### 1.2 Open PRs（14）

#### A. 可快合（小、MERGEABLE）

| PR | 作者 | 内容 | 决策 |
|----|------|------|------|
| **#134** | tisrop | 会话 stop 后侧栏 busy 未清除 | **优先审 merge**（真实 UX bug，+tests） |
| **#131** | lunar-me | providers.md 语法 | 合或 batch docs |
| **#132** | lunar-me | SPIKE-ACP 用词 | 合或 batch docs |
| **#133** | lunar-me | git-worktrees.md 缺动词 | 合或 batch docs |

#### B. 功能批（sonnemusk #151–#160）— 全部 CONFLICTING

| PR | 主题 | 体量 | 与前身关系 |
|----|------|------|------------|
| #151 | trust-sandbox（path_scope / CSP / media） | +478 | 叠 #135–#138 等已关未合 PR |
| #152 | remote-security（allow_from / webhook / mirror RO） | +483 | 叠 #139–#141 |
| #153 | desktop-shell（安全开 URL / secrets 原子写） | +65 | 叠 #142/#144 |
| #154 | composer-control（model/effort 失败可见） | +74 | 叠 #145 |
| #155 | diagnostics（error deck / CLI trust） | +198 | 叠 #146/#147 |
| #156 | session-data modes | +68 | 叠 #148 |
| **#157** | **app-update 平台安装包下载** | +133 | 叠 #149；**L08 第二档** |
| #158 | windows-dayuse 验收 + safe links | +119 | 叠 #142/#150 |
| #159 | remote-im ready（ACL + webhook GUI） | +262 | 与 #152 重叠，需去重 |
| #160 | resource-workbench | +324 | 依赖 #151 path_scope |

**关键事实：**

- CI 对多数 PR 曾报 4 绿，但 **mergeable=CONFLICTING**（main 已前进，含 0.1.8 热修）。
- #140–#150 **全部 CLOSED 且 `mergedAt=null`** → 内容**不在 main**，不能当「已合」关 Issue。
- 多 PR 重复改：`build.rs` / `windows-app-manifest.xml` / `ci.yml` / `errorDeck.test.ts` → **串行 rebase 必炸**，必须主题切片或 monorepo integrate 分支。

### 1.3 自动更新现状（L08）

| 能力 | 状态 | 落点 |
|------|------|------|
| 查 GitHub `releases/latest` | ✅ | `src-tauri/src/app_update.rs` + Settings About |
| API 限流 HTML 回退 | ✅ | 同上 |
| 打开 Release 页 | ✅ | `openExternalUrl` |
| 按平台选资产并下载 | ❌（在 #157） | 未入 main |
| `tauri-plugin-updater` 静默安装 | ❌ | `tauri.conf.json` 无 `plugins.updater`；`release.yml` `includeUpdaterJson: false` |
| Updater 签名密钥 | ❌ | 无 `TAURI_SIGNING_*` secrets（且空值会弄挂 build） |
| OS 代码签名 / 公证 | ❌ | 与 updater 签名是**两件事**（见开源诊断 NEW-06） |

`app_update.rs` 顶部注释已写明产品立场：**未签名社区构建 + 无 signing secrets → 静默 updater 不可靠**，先走「有新版本 → 打开/下载安装包」。

---

## 2. Issues 清理 SOP

### 2.1 立刻（今天，无需写代码）

```bash
# 打标（示例）
gh issue edit 162 --add-label "bug,priority:p0,platform:windows"
gh issue edit 161 --add-label "bug,priority:p0,platform:macos,from:community"
# 可选：写首评「已复现线索 / 目标进 0.1.9」
```

| 动作 | 说明 |
|------|------|
| 补标签 | 按 maintain.md 词汇表：type + priority + platform + area |
| 首评 | 写清根因假设 + 目标版本，避免用户重复开 Issue |
| 不关 Issue | 修复合并后用 `Fixes #162` 自动关 |

### 2.2 日常 triage（维持）

```text
New Issue
  → type + platform + area + priority:p0|p1|p2
  → P0：当日开 fix 分支或挂进当前热修里程碑
  → P1：进下一 patch
  → P2：backlog / good first issue
  → 重复 → duplicate + 关
```

社区 X/群反馈：转 Issue 并打 `from:community`（maintain.md）。

---

## 3. PR 清理与合并策略

### 3.1 总原则

1. **main 为唯一真相**；Open PR 不代表已交付。  
2. **冲突功能批不逐个 Merge**，避免半合状态与重复 manifest。  
3. **小而正确的修优先**（#134、docs）。  
4. 合入后：CHANGELOG Unreleased → 删远程分支 → `git fetch --prune`（branch hygiene）。  
5. 已关未合的 #135–#150：在对应主题真正落地后 **comment + 保持 closed**（或 label `superseded` 说明），不要重新 open 一堆僵尸 PR。

### 3.2 轨道 A — 热修 / 社区小 PR（本周前半）

**顺序：**

```text
1) #134 侧栏 busy settle
2) #131 + #132 + #133 文档（可 squash 或连合）
3) #162 Windows cmd 闪窗（新分支 fix/win-no-console）
4) #161 LINE 端口 + 状态语义（新分支 fix/line-webhook-listen）
5) 需要时 cherry-pick 功能批中「已可独立」的安全小切片（见轨道 B 切片表）
→ tag v0.1.9
```

**#134 审查要点：**

- [ ] `sessionLiveStore` 单测覆盖 stop 后 busy 清零  
- [ ] 不误清其他 live session  
- [ ] `pnpm test` / typecheck  

**#162 实施要点：**

- 审计所有 `Command::new` / `tokio::process::Command`：  
  `acp_client` · `cli_probe` · `cli_install` · `cli_update` · `account` · `editors` · `extensions` · `agent_memory` · `proxy` 探测 · `remote_im/grok_agent`  
- 统一 `process_util::apply_no_window_std` / `apply_no_window_tokio`  
- 禁止用 `cmd /C start ...` 开 URL 时留下可见 console（与 #142/#153 主题对齐）  
- 验收：Win11 新建项目 / 打开会话 / Doctor 探测 **零闪窗**

**#161 实施要点：**

| 项 | 做法 |
|----|------|
| 端口单一真相 | 默认端口与 UI / cloudflared 提示同源（建议 **统一 8082** 或统一 8081，写进 options + i18n 动态插值，禁止硬编码） |
| 状态机 | `configured`（有凭证）≠ `listening`（bind 成功）≠ `connected`（端到端可收） |
| UI | listener 未起来时 **禁止绿灯「已连接」**；显示 bind 错误 / 实际 `127.0.0.1:port` |
| 运行时 | Bridge start 时确认 LINE `run()` task 存活；bind 失败写 `lastError` |
| 安全 | 补 LINE `X-Line-Signature` 校验（#152/#159 有现成方向，可先热修最小实现） |
| 验收 | `lsof -iTCP:<port>` 有监听；cloudflared 不 502；私讯能进 Bridge |

### 3.3 轨道 B — 功能批 #151–#160 整合（本周后半 → 下一版）

#### 推荐方式：**主题切片 integrate，而非 10 个 PR 串行 rebase**

```text
origin/main
    └─ integrate/hardening-0.2   （维护者本地或 worktree）
         ├─ slice-1 trust + resource   （#151 核心 + #160 去重）
         ├─ slice-2 remote security    （#152 + #159 去重，含 LINE/allow_from）
         ├─ slice-3 desktop shell      （#153 + #158 的 opener 部分）
         ├─ slice-4 session UX         （#154 + #156）
         ├─ slice-5 diagnostics        （#155）
         └─ slice-6 app-update L08-B   （#157）
```

每 slice：

1. 从最新 `main` 开分支（或 re-apply 原 PR diff）。  
2. `pnpm typecheck && pnpm test && cd src-tauri && cargo test`。  
3. 独立 PR 或同一 integrate PR 的有序 commit。  
4. 原 sonnemusk PR 评论「landed via #xxx / integrate」后 **close**。  
5. 重复的 `windows-app-manifest.xml` / `build.rs` **只保留一份**最终形态。

#### 切片优先级（安全 > 日用 > 体验）

| 顺序 | Slice | 来源 PR | 用户价值 | 风险 |
|------|-------|---------|----------|------|
| 1 | desktop opener + secrets 原子写 | #153（+ #158 链接） | Win 登录/文档不裂 URL；密钥不截断 | 低 |
| 2 | remote-im fail-closed + LINE | #152/#159 + **#161 热修** | 远程控权安全；LINE 真能用 | 中 |
| 3 | path_scope / CSP / media | #151 | 本地文件信任边界 | 中高 |
| 4 | resource workbench | #160 | 依赖 path_scope | 中 |
| 5 | error deck + CLI trust | #155 | 首跑可行动诊断 | 中 |
| 6 | model/effort + session modes | #154/#156 | 设置语义闭合 | 低 |
| 7 | **app-update 下载安装包** | **#157** | L08 第二档 | 低 |
| 8 | windows day-use 文档/验收 | #158 文档部分 | 可延后 | 低 |

#### 明确 **不要** 在 0.1.x 做的

- 一次性 merge 全部 10 个冲突 PR  
- 在未生成 updater 密钥前打开 `includeUpdaterJson: true`  
- 用空的 `APPLE_*` / `TAURI_SIGNING_*` 填进 CI（已踩坑）

### 3.4 关 PR 话术模板

```text
Thanks — this work is being re-landed against current main as part of
integrate/<slice> (see docs/plans/2026-07-27-issues-prs-update-ship-plan.md).
Closing this PR to avoid conflict noise; credit remains in the integrate PR.
```

---

## 4. 自动更新完整方案（Tauri × GitHub Release）

### 4.1 目标分层（对齐 L08 / 项目需求 P1）

| 档 | 名称 | 用户体验 | 前置条件 | 目标版本 |
|----|------|----------|----------|----------|
| **A** | 发现更新 | Settings → 检查；有新版本打开 Release | 无 | ✅ 已在 main |
| **B** | 引导安装 | 按 OS/arch 选 dmg/setup/AppImage；浏览器或系统下载；展示 SHA256 | Release 资产命名稳定；#157 | **0.1.9 / 0.2.0** |
| **C** | 应用内更新 | 下载 → 校验签名 → 提示重启安装 | `tauri-plugin-updater` + minisign 密钥 + CI 产 `latest.json` | **证书/密钥就位后** |
| **D** | 静默/后台 | 可选自动下载；仍需用户确认安装 | 档 C + 产品开关 + 崩溃回滚策略 | 更后 |

**当前产品默认：停在 A，尽快到 B；C 不作为 0.1.x 阻塞。**

### 4.2 档 B — 平台安装包下载（落地 #157 思路）

**行为：**

1. `app_check_update` 返回 `updateAvailable` + `assetNames` + `htmlUrl`（已有）。  
2. 扩展：`recommendedAsset`（名 + browser_download_url），按：

| OS | Arch | 匹配规则（建议） |
|----|------|------------------|
| macOS | aarch64 | `*aarch64*.dmg` / `*aarch64-apple*` |
| macOS | x86_64 | `*x64*.dmg` 且非 arm |
| Windows | x64 | `*-setup.exe` 优先，其次 `*portable*.zip` |
| Linux | x64 | `*.AppImage` 优先，其次 `.deb` / `.rpm` |

3. UI：`检查更新` → 有更新时 **「下载本机安装包」** + **「打开发布页」**。  
4. 下载：优先 `openExternalUrl(assetUrl)`（简单、复用系统下载器）；进阶再用 Tauri `http` + 进度条 + 与 `SHA256SUMS` 比对。  
5. i18n 文案明确：**不会静默替换当前 App**（与档 C 区分）。

**CI 侧（已有，保持）：**

- tag `v*` → `release.yml` 四平台  
- `includeUpdaterJson: false`（档 B 阶段保持 false）  
- `checksums` job 上传 `SHA256SUMS`

**验收：**

- [ ] 0.1.8 客户端对 mock 更高 tag 显示下载按钮  
- [ ] mac arm / win 能匹配到正确资产名  
- [ ] 无匹配时仅「打开发布页」  
- [ ] `cargo test` `app_update::` 覆盖 semver + asset pick

### 4.3 档 C — 真·Tauri Updater + GitHub Release

#### 架构

```text
CI (tag vX.Y.Z)
  → tauri build (各 target)
  → 用 TAURI_SIGNING_PRIVATE_KEY 签名更新包
  → 上传 .dmg / .msi|nsis / .AppImage …
  → 生成/更新 latest.json（或 static endpoint）
  → GitHub Release assets

App (runtime)
  → plugins.updater.endpoints = [
      "https://github.com/RongleCat/grok-app/releases/latest/download/latest.json"
    ]
  → pubkey = 内嵌公钥（tauri.conf）
  → check() → download_and_install() → relaunch
```

#### 一次性密钥（人类操作）

```bash
# 本地生成（勿提交私钥）
npm run tauri signer generate -w ~/.tauri/grok-app.key
# 公钥 → tauri.conf.json plugins.updater.pubkey
# 私钥 → GitHub Secrets: TAURI_SIGNING_PRIVATE_KEY
# 口令 → TAURI_SIGNING_PRIVATE_KEY_PASSWORD（若有）
```

#### 配置变更清单

| 文件 | 变更 |
|------|------|
| `src-tauri/Cargo.toml` | `tauri-plugin-updater` |
| `src-tauri/tauri.conf.json` | `plugins.updater`：`pubkey` + `endpoints`；`bundle.createUpdaterArtifacts` |
| `src-tauri/src/lib.rs` | `.plugin(tauri_plugin_updater::Builder::new().build())` |
| `.github/workflows/release.yml` | `includeUpdaterJson: true`；注入非空 signing env |
| `src/components/SettingsPage.tsx` | 有签名更新时走 plugin；失败回退档 B |
| `docs/llm-wiki/release.md` | 补充 updater 发版检查项 |
| `docs/P0-能力矩阵.md` | L08 → 分档勾选 |

#### 与 OS 代码签名的关系（勿混淆）

| 机制 | 解决什么 | 不解决什么 |
|------|----------|------------|
| **Tauri updater minisign** | 更新包未被篡改 | SmartScreen / Gatekeeper |
| **Windows Authenticode** | SmartScreen 信誉 | 自动更新通道 |
| **Apple Developer ID + notarization** | Gatekeeper | Windows |

档 C 可在 **无** Authenticode/公证时上线，但用户仍可能被系统拦截安装；README 继续写 `xattr` / SmartScreen 说明。

#### 档 C 风险与缓解

| 风险 | 缓解 |
|------|------|
| 私钥泄漏 | 仅 Secrets；轮换密钥需发「强制网页下载」过渡版 |
| 半包更新 | 校验完整后再 install；失败保留旧版 |
| 绿色版 portable | updater 主要服务安装版；portable 仍走档 B |
| 代理环境 | 复用 `proxy::apply_to_reqwest` / 系统代理（与 NEW-02 一致） |

#### 档 C 验收

- [ ] 预发 prerelease tag 客户端能 check 到更新  
- [ ] 签名错误的包被拒绝  
- [ ] 断网 / 限流有可读错误（error deck）  
- [ ] 更新后 `CARGO_PKG_VERSION` 与 About 一致  
- [ ] 无密钥的 fork 构建仍可运行（updater disable 或仅档 B）

### 4.4 档 D（可选，不排期）

- 设置项：`自动检查`（默认开）/ `自动下载`（默认关）  
- 启动后空闲检查（节流 24h）  
- 与 CLI 的 `grok` 自更新 **分离**（App 已对 agent 使用 `--no-auto-update`）

---

## 5. 修复 · 合并 · 新功能 完整工作流

### 5.1 三条并行轨道

```text
        ┌──────────── 轨道 A：热修 / 社区 ────────────┐
Issues ─┤  #162 #161 #134 docs → v0.1.9               │
        └────────────────────────────────────────────┘
        ┌──────────── 轨道 B：硬化功能批 ────────────┐
PRs ────┤  integrate slices → v0.2.0（或 0.1.10+）   │
        └────────────────────────────────────────────┘
        ┌──────────── 轨道 C：产品新功能 ────────────┐
Roadmap ┤  L 矩阵 / Remote IM / 会话 UX …            │
        │  必须从最新 main 拉分支；禁止堆在冲突 PR 上 │
        └────────────────────────────────────────────┘
```

### 5.2 单任务开发闭环（所有轨道共用）

```text
1. Issue / 设计一页纸（大功能走 docs/plans 或 llm-wiki）
2. 分支：fix/… · feat/… · 基于 origin/main
3. 实现 + 单测；i18n en+zh；无 window.confirm
4. 本地：pnpm typecheck && pnpm test && cargo test
5. PR：关联 Fixes #n；CI 绿
6. 审查清单（maintain.md）
7. squash/merge → 删分支 → CHANGELOG [Unreleased]
8. 一批可交付 → release-tag.sh → 看 Release 资产
```

### 5.3 新功能准入（避免再次出现「10 个冲突 PR」）

| 规则 | 说明 |
|------|------|
| 一 PR 一主题 | 禁止「安全 + UI + CI manifest」大杂烩 |
| 共享脚手架先合 | `windows-app-manifest` / CSP 地基单独先合 |
| 48h 内 rebase | 冲突超过 2 天未处理 → 维护者 integrate 或 close |
| 依赖写清 | 如 #160 depends on #151 path_scope |
| 文档 | 用户可见行为 → `docs/llm-wiki` 或 `docs/features`；发版进 CHANGELOG |

### 5.4 发版节奏建议

| 版本 | 内容 | 触发 |
|------|------|------|
| **v0.1.9** | #162 #161 #134 + 可选 opener/secrets 小切片 + CHANGELOG | P0 修完即发 |
| **v0.1.10** | 档 B 更新下载 + remote-im 安全默认 | slice 1–2+7 |
| **v0.2.0** | trust sandbox + resource + diagnostics 整包 | slice 3–6 稳后 |
| **v0.x + updater** | 档 C | 密钥与 CI 验证后单独小版本 |

流程仍只认 [release.md](../llm-wiki/release.md)：三处 version + CHANGELOG 章节 + tag + CI。

---

## 6. 两周执行清单（可勾选）

### Week 1 — 止血与清理

- [ ] Issue #162 #161 打标 + 里程碑 `v0.1.9`
- [ ] Merge #134；merge #131–#133
- [ ] 修复 #162（全路径 `CREATE_NO_WINDOW`）
- [ ] 修复 #161（端口统一 + 状态语义 + bind 错误上浮）
- [ ] 在 #151–#160 下评论 integrate 计划；避免贡献者继续基于旧 tip 推
- [ ] tag **v0.1.9**，验证四平台 Release + SHA256SUMS
- [ ] `git fetch --prune`；删已合远程分支

### Week 2 — 硬化与更新档 B

- [ ] integrate slice-1 desktop shell（opener + secrets）
- [ ] integrate slice-2 remote security（与 #161 不重复）
- [ ] 落地 #157 思路 → 档 B 安装包下载
- [ ] 视稳定度 tag **v0.1.10** 或并入 0.2.0 准备
- [ ] 人类决策：是否采购代码签名 / 生成 Tauri updater 密钥（档 C 开关）

### Backlog（不阻塞上述）

- [ ] path_scope + resource workbench  
- [ ] diagnostics 全量  
- [ ] L 矩阵其余：托盘增强、导出 MD、MCP GUI…  
- [ ] 档 C updater  
- [ ] Authenticode / Apple 公证（商业决策）

---

## 7. 角色分工

| 角色 | 职责 |
|------|------|
| **维护者 / 集成 Agent** | 热修、integrate 切片、发版、关冲突 PR |
| **功能 Agent** | 只从最新 main 开主题分支；不叠在 #151–#160 上 |
| **人类** | Secrets（签名密钥、Apple/Win 证书）、Workflow 写权限、是否上档 C |
| **社区** | 小 docs / good first issue；大功能先开 Issue 讨论 |

---

## 8. 成功标准

1. **Open Issues = 0 P0**（#161 #162 关闭或有明确 workaround + 修复 PR）。  
2. **Open PR 列表干净**：无长期 CONFLICTING 僵尸；功能批要么 landed 要么 closed 并指向 integrate。  
3. **用户更新路径清晰**：About 能发现新版本；档 B 能下到对应安装包；档 C 有书面开关条件。  
4. **发版可重复**：任意 Agent 只读 `release.md` 即可 ship。  
5. **Windows 日用**：无 cmd 风暴；链接可点；SmartScreen 说明诚实。  
6. **Remote IM LINE**：绿灯 ⇒ 本机 webhook 真监听；文档端口与代码一致。

---

## 9. 相关命令速查

```bash
# 库存
gh issue list --state open
gh pr list --state open

# 热修后发版
pnpm typecheck && pnpm test
cd src-tauri && cargo test
# 写 CHANGELOG ## [0.1.9]
./scripts/release-tag.sh 0.1.9 --push

# 分支卫生
git fetch --prune origin
gh pr list --state merged --limit 20
```

---

## 10. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-27 | 初版：基于 open #161/#162、PR #131–#134/#151–#160、app_update 与 release.yml 实态 |
