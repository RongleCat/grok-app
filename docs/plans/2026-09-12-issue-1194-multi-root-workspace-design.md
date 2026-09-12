# Issue #1194：多项目空间 / 多选文件夹跨项目写入设计

## 拍板记录（2026-09-12）

- **选定方案：B**（主项目 + 附加可读/可写根，CLI capability 硬门槛）。Codex CLI 设计；铁柱确认。
- 开放问题按**偏安全默认**落定（未逐项另选时）：
  1. shared 可写 profile → **C**：v1 shared 永远只读/引用用户配置；先只在 **independent** 开放 App 管理的可写 profile。
  2. extra root 默认能力 → **A**：加入即只读；写须逐根打开并通过 smoke test。
  3. 持久化 → **A**：独立 `workspaces.json`；项目可被多个 workspace 引用。
  4. 写能力失败 → **A**：聊天仍可用，锁定跨根写，提供修复/重试。
- 下一步：按里程碑 MVP-0（只读多根声明）开工；不提前做 Codex 式一等 Workspace（方案 C）。

## 现状与约束

Issue #1194 的目标是让用户在一次聊天里选择多个文件夹，并让 Agent 能跨项目读写。按要求尝试执行了 `gh issue view 1194 --repo RongleCat/grok-app --comments`，但本机 GitHub API 请求被代理 `127.0.0.1:7890` 拒绝，未能取得 issue 的已有分诊评论；以下判断以 issue 描述、仓库代码、仓库 wiki 和本机 Grok Build 权限手册为准。

仓库当前有三层容易混淆的“空间”概念：

- 侧栏 **Spaces** 只是项目分组，不是文件系统根目录。
- `Project` 是 `projects.json` 中的一个本地或 SSH 文件夹，带 `trusted`、项目权限策略和项目 sandbox 覆盖。
- `SessionMeta` 只有一个 `project_id`；连接时解析出一个 session cwd，ACP 进程也以一个 spawn cwd 启动。

关键实现事实：

- `Project` 当前字段是 `id/name/path/trusted/path_ok`，外加项目级权限、sandbox、worktree 和 SSH 属性；没有 roots 数组。
- `SessionMeta` 当前只有一个 `project_id`，没有 workspace/root 引用。
- `AcpClient` 的 `--sandbox` 是进程级 flag。非 `off` profile 的写根锁定在进程启动 cwd；不能把一个已启动的 sandbox 进程热复用到另一个项目 cwd。
- `workspace` profile 的语义是“读全盘，写 CWD、`~/.grok` 和临时目录”；它天然支持同一 CWD 子树内的多个项目，但不支持任意 sibling / 跨盘目录。仅使用这个内置 profile 时，CLI 读取范围仍是全盘，不能宣称未声明根被 CLI 拒绝。
- Grok Build 支持 `~/.grok/sandbox.toml` 或项目 `.grok/sandbox.toml` 中的自定义 profile，使用 `read_write` 增加具体目录；这不是当前 App 的 spawn flag 能直接表达的路径列表。
- CLI 权限与 OS sandbox 是两层独立机制。`permissions.additionalDirectories` 在本机手册中明确写为“parsed but not supported”。App 不能仅扩展自己的 path allowlist 就假装 CLI Agent 获得了额外写权限。
- `path_scope` 已经把所有可信项目根加入 Host 文件访问 allowlist；但 `permission::is_outside_project` 和 session allow cache 仍按单一 project root 判断，项目外路径默认不会被 session allow 覆盖。
- 默认 `session_data_mode=shared` 使用 `~/.grok`，App 不得改写用户的 `~/.grok/config.toml` 或 `sandbox.toml`。Independent 模式才允许 App 管理自己的 agent-home 配置。
- 现有 UI 已有 `ComposerProjectMenu`、项目右键菜单、`GlassModal` / portal 菜单和设置搜索注册表；`AppWorkbench`、`App.tsx` 有增长冻结，新状态应放在 domain hook / lib / Host 模块。

权限手册还要求：sandbox 在进程启动时一次性生效且不可放宽；恢复会话不能改变保存的 sandbox；项目配置和 hooks 的加载需要 folder trust；`deny` 永远优先于 `allow`。

## 设计原则

1. **能力诚实**：UI 只展示 CLI 已验证能执行的读/写能力。CLI 不支持时，额外根只能显示为只读或 `context_only`，不能由 App 自己绕过 CLI。
2. **单一权限语义**：复用 Grok Build 的 `--permission-mode`、`--sandbox`、`--trust` 和 `[permission]` 规则；App 只维护“本次会话声明了哪些根”，不引入第二套永久授权协议。
3. **最小范围**：额外根按目录声明，拒绝 `..`、符号链接逃逸、重复根、文件路径和隐式父目录扩大；SSH 根和本地根不能混在同一个 workspace 中。
4. **可恢复**：workspace 配置变化必须导致新进程或 soft-respawn；已有 turn 不改变其进程级写边界。
5. **可审计**：每次 spawn 的日志/Doctor 信息包含 workspace id、根数量、effective sandbox profile 和能力状态，不记录 token 或完整敏感路径内容。
6. **不膨胀 AppWorkbench**：状态放到 `useMultiRootWorkspace`、`src/lib/multiRootWorkspace.ts`、Host store/commands 和独立弹窗组件，入口只传回 domain callback。

## 方案比较

### A. 父目录当项目

**用户感知**：引导用户把多个仓库放到同一个父目录，在侧栏添加这个父目录作为一个项目；聊天 cwd 设为父目录，Agent 通过相同的 workspace sandbox 写入其子目录。也可以继续保留子目录项目，但跨项目聊天选择父项目。

**CLI sandbox / trust 对齐**：完全使用现有 `grok agent stdio`、`--sandbox workspace` 和一个 cwd。父目录必须作为受信项目，`--trust` 的含义不变。只要所有目标目录是父目录的后代，CLI 的 CWD 写边界就覆盖它们；读取仍是全盘，这是该方案的安全代价。

**App 改动面**：几乎只有文档、首次添加项目时的引导和错误提示；现有 `projects.json`、`SessionMeta.project_id`、spawn 逻辑均可复用。

**风险**：信任和写权限会扩大到父目录下的所有子目录，容易把不相关仓库、密钥或下载目录一并纳入；目录位于不同父目录或不同磁盘时不可用；用户仍会认为“多选文件夹”没有真正实现。

**实现成本**：S。

### B. 主项目 + 附加可读/可写根（推荐 v1）

**用户感知**：聊天仍有一个主项目和主 cwd；用户在“Workspace roots”面板中添加若干附加目录，并逐项选择 `只读` 或 `可写`。Composer 显示 `主项目 + N 个根` 芯片，发送前显示实际能力（例如“2 个根可读、1 个根可写”）。

**CLI sandbox / trust 对齐**：

- 读：内置 `workspace` profile 会读全盘，因此只能作为 `context_only`（上下文声明），不能作为“未声明根拒绝”的证明。要真正收窄读取范围，必须使用以 `strict` 为基础、以 `read_only` 列出 extra roots 的自定义 profile。
- 写：只有在 CLI 探测到一个真实存在且可加载的自定义 profile 时才开放。profile 应以 `strict` 为基础，并用 `read_only = [...]` / `read_write = [...]` 列出主根和 extra roots；仍由 CLI 的 OS sandbox 执行。App 传递现有 `--sandbox <profile>`，不发送不存在的 `--additional-directory`。
- shared 模式：App 不写 `~/.grok`。用户可在主项目 `.grok/sandbox.toml` 或自己的 `~/.grok/sandbox.toml` 中维护 profile，App 只读取、验证和引用；若 profile 不可验证，写开关禁用并显示只读。
- independent 模式：App 可以在自己的 `agent-home/sandbox.toml` 生成带稳定 hash 名称的 profile，并在 spawn 时引用；仍需 CLI 版本/启动探测成功，失败即只读或拒绝启动写 workspace。
- `--trust` 仍只信任主项目。附加根默认为 data-only：不会因为加入 workspace 而加载该目录的 `.grok/config.toml`、`.claude/settings.json`、hooks 或 skills。若未来要支持附加项目指令，必须另做显式的逐根 trust 流程。

**App 改动面**：中等。新增 workspace domain 类型、Host 能力探测和 spawn 参数、会话 meta、权限 scope union、根目录管理弹窗；项目列表和主项目选择保持不变。需要为设置搜索注册一个入口，但不应把完整根管理塞进设置页。

**风险**：自定义 profile 的来源和优先级必须清楚；shared 模式不能自动落盘配置，用户可能看到“已添加但只读”；profile 变更与正在运行的进程存在时序问题；额外根过多会扩大模型可见信息面。必须限制根数量、拒绝符号链接逃逸并在恢复会话时重新校验快照。

**实现成本**：M（只读声明）到 L（shared/independent 都能验证和管理可写 profile）。

### C. Codex 式 Workspace 多根一等对象

**用户感知**：侧栏出现独立的 Workspace 列表；Workspace 下有多个 Project，任何新聊天先选择 Workspace，再选择主项目。Workspace 是可分享、可重命名、可复制的产品对象。

**CLI sandbox / trust 对齐**：只有 Grok Build CLI 原生支持多根参数、每根 trust 和每根 read/write capability 后才可完整对齐。当前 CLI 没有已知的 ACP/CLI `additionalDirectories` 能力，不能靠现有 `--sandbox` 完成任意多根写入；在原生能力出现前只能降级为 B 的用户界面。

**App 改动面**：大。需要 Workspace store、侧栏第二层树、session 路由、项目移动、worktree、远程项目、导入/恢复和权限 scope 全部升级；还会明显触碰 AppWorkbench 冻结边界。

**风险**：CLI/App 状态漂移、老会话恢复歧义、不同 workspace 间权限缓存泄漏、SSH/本地混合语义复杂；若 CLI 没有对应协议，产品会产生“看起来支持、实际不能写”的信任损失。

**实现成本**：L/XL。

### D. 共同祖先的显式 Workspace envelope

**用户感知**：用户先选择一个明确的 Workspace 目录，再从其子目录勾选多个项目。Workspace 是“父目录当项目”的可发现、可管理版本，项目仍保留独立名称、trust 和会话分组。

**CLI sandbox / trust 对齐**：spawn cwd 固定为用户明确选择的 Workspace 目录，使用现有 `workspace` profile；session/new 的逻辑 cwd 仍可指向主项目。它不支持不在该目录下的根，也不自动计算到 `/` 或 home 根，避免意外扩大写边界。

**App 改动面**：比 A 大、比 B 小到中等：要新增 Workspace envelope 和 spawn cwd/会话 cwd 分离，调整进程复用 key、路径权限 scope 和 UI。若 Workspace 目录本身含有不相关内容，仍有父目录扩大风险。

**风险**：进程 sandbox 的写根是 Workspace 目录，而不是主项目，必须修复 warm reuse、Doctor 展示和 trust 语义；用户选错父目录会获得过宽写权限；不适用于真正跨父目录的需求。

**实现成本**：M/L。

## 推荐方案：B，能力门控的多根 Workspace

推荐 B 作为 v1。它直接回应“跨项目读写”的使用场景，同时把 CLI 当前不支持的部分暴露为能力状态；A 可作为立即可用的引导，D 可作为以后针对同一父目录场景的优化。C 留给 Grok Build CLI 有原生多根协议之后。v1 的“多根已生效”只指 custom profile 通过验证；没有该 profile 时产品明确处于上下文声明或只读降级态。

### 产品定义

**Workspace 是一次会话可访问的根目录声明；Project 是侧栏中的主目录对象；Session 绑定一个主 Project，并可引用一个 Workspace（Workspace 的主根默认就是该 Project）。**

附加根不是新的侧栏项目，不继承其项目指令，也不改变原有项目列表排序和 Space 分组。

### 权限模型

每个 workspace root 有以下字段：

- `role`: `primary` 或 `extra`。
- `access`: `read` 或 `write`。
- `trust`: 主项目沿用现有项目 trust；extra root 只有 `data_only` 状态，不因加入而加载其配置、hooks、skills。
- `canonical_path`、`path_ok`、`ssh_alias`（v1 只允许本地 extra root）。

边界规则：

1. 默认只允许主项目读写；extra root 默认只读。App/Host 对未声明路径默认拒绝；Agent 进程只有在 custom profile enforcement 生效时才具备同样的 OS 级拒绝，否则必须在 UI 上标记为 `context_only`，不能暗示已隔离。
2. 选择 `write` 前，主项目必须 trusted、extra root 必须存在且 canonicalize 成目录，并且 CLI capability 必须显示 `extra_write=active`。
3. session permission cache 的“项目外”判断改为“workspace 外”判断：session allow 可以覆盖 workspace 内的声明根，但不能覆盖 workspace 外路径。这样仍是 Grok Build 的同一 allow/ask/deny 层，只是 root 集合从一个变成显式 union。
4. `deny` 规则、组织 managed rules 和 CLI sandbox deny 永远优先。`always_approve` 也不把未声明根加入 workspace；它只能沿用 CLI 对已声明边界的行为。
5. 任何符号链接解析后逃出声明根、根被删除、路径变成文件、路径包含 `..` 逃逸或本地/SSH 混用，立即降级为只读并要求重新确认。
6. trust 升级分两步：先信任主项目（现有确认对话），再由 Workspace 面板确认“将这些 extra roots 作为数据目录开放”。不提供“一键信任所有项目配置”的动作。

### CLI 对齐与诚实降级

当前 CLI 可以直接表达的只有：

- `--permission-mode <mode>` / `--always-approve`：继续由现有策略映射处理。
- `--sandbox workspace|read-only|strict|devbox`：继续由现有 profile 处理。
- 自定义 profile 的 `read_write`：通过真实的 `sandbox.toml` 让 CLI 处理，而不是 App 自己拦截 shell。

当前 CLI **不能**直接表达的内容：

- ACP `session/new` 没有“附加写目录”参数。
- `permissions.additionalDirectories` 在本机手册中明确不支持。
- App 不能把多个根拼进 `--sandbox` 或 `--rules`，也不能把 Host 的 `path_scope` 当作 Agent 进程的 OS 权限。

因此，能力探测应返回 `none | context_only | enforced_read | extra_write_active | blocked`：

- `none`：旧 CLI 或 profile 未知；隐藏可写选项，允许普通单项目会话。
- `context_only`：App 可以记录和展示多根，内置 `workspace` 可能让 Agent 读到更多目录；不宣称未声明根被 CLI 拒绝，extra write 关闭。
- `enforced_read`：已验证 `strict` custom profile、`read_only`/`read_write` 覆盖所有声明根，且未声明根读写 smoke test 失败。
- `extra_write_active`：在 `enforced_read` 基础上，已验证 profile 存在、CLI 接受 `--sandbox`、profile 的 `read_write` 包含全部 write roots，并完成每个根的临时目录写入/删除 smoke test。
- `blocked`：profile 语法、权限或平台能力失败；显示原因，不静默切到 `off`。

shared 模式下，App 只读用户配置，不修改 `~/.grok`。若用户没有可验证 profile，产品明确显示“可读，不能跨项目写入”，并提供打开配置位置/复制示例的动作。independent 模式可以由 Host 在 agent-home 写入 App 管理的 profile，但也必须经过同一探测和 soft-respawn；不能因为能写配置文件就声称 CLI 已执行成功。

### UI 入口

采用三个轻量入口，复用现有 portal/modal 和 i18n：

1. **新建聊天的 ComposerProjectMenu**：在主项目列表下增加 `Workspace roots…`；当前没有 workspace 时只显示主项目。
2. **项目右键菜单**：`Add to workspace` / `Manage workspace roots`，打开同一个 `MultiRootWorkspaceModal`。
3. **Settings → General → Permissions**：增加一条只负责默认行为和能力说明的卡片（例如“新聊天默认继承最近 workspace”），根目录管理仍在 modal 完成。必须在 `src/lib/settingsCatalog/entries/general.ts` 注册稳定 id、anchor、描述和搜索关键词，15 个语言目录保持 key lockstep。

弹窗必须提供：根列表、读/写开关、路径存在状态、trust/data-only 标签、CLI 能力 banner、移除/恢复操作、写能力验证结果和“下次连接生效”提示。使用 `GlassModal`/现有 panel CSS，不使用原生 select、confirm、prompt 或透明菜单。

所有交互状态（打开、添加中、验证中、busy、失败、空列表、取消、soft-respawn）放在 `useMultiRootWorkspace` 和 modal 组件中；`AppWorkbench` 只接收 `workspaceId`、`onWorkspaceChange` 等回调。

### 数据模型与存储

建议增加独立的 `workspaces.json`，避免把大量路径数组塞进全局 settings：

```json
{
  "version": 1,
  "workspaces": [
    {
      "id": "ws_<uuid>",
      "name": "Web stack",
      "primaryProjectId": "<project-id>",
      "roots": [
        { "path": "/repo/app", "role": "primary", "access": "write" },
        { "path": "/repo/shared", "role": "extra", "access": "read" }
      ],
      "profileRef": "app-workspace-<hash>",
      "capability": "context_only",
      "updatedAt": "..."
    }
  ]
}
```

- `projects.json`：保持现有 Project 记录不变；可选增加 `workspaceIds` 反向索引时必须迁移安全，不能把 workspace membership 当作侧栏 Space membership。
- `SessionMeta`：增加可选 `workspace_id`、`workspace_root_snapshot`、`workspace_capability`。snapshot 用于恢复时发现根已变更并要求重新验证；旧会话字段缺失时按单项目行为。
- `AppSettings`：只放 `multi_root_workspace_enabled`、`workspace_default_access`、最近 workspace id 等小偏好；这些新设置必须进 `settingsCatalog`。不在 settings 存完整路径列表，也不存 token/profile 内容。
- shared 模式 profile 来源记为 `user_managed`；independent 模式记为 `app_managed`，并记录 hash/mtime 供 Doctor 检查。

路径写入前统一走 Host canonicalize 和现有 `path_scope`；活动 workspace 的声明根以“当前 session 的临时 allowlist”加入 Host，不把 extra root 写入全局 trusted project，也不把 data-only 变成 Project trust。这层只保护 App 自己的绝对路径 API，仍不替代 CLI sandbox。日志只记录 root 数量、hash 和 capability，UI 可显示用户已选路径。

### 分阶段里程碑

#### MVP-0：基线与只读多根

验收：

- 可从新聊天/项目菜单创建 workspace，添加 1 个主根和最多 8 个本地 extra roots。
- 根列表持久化到 `workspaces.json`，旧项目/旧会话无迁移回归。
- 没有 custom profile 时状态为 `context_only`，UI 明确提示 CLI 仍可能全盘读取；不提供跨根写入。
- 有 `strict` custom profile 时进入 `enforced_read`，并验证声明根可读、未声明根不可读。
- 15 语种 i18n、settingsCatalog 注册、无原生控件/confirm/prompt。

#### MVP-1：CLI 能力探测与 shared 配置核验

验收：

- Host 能识别 CLI 版本、`--sandbox` 支持、profile 来源和 `read_only`/`read_write` 覆盖集合。
- shared 模式不修改 `~/.grok`；用户配置缺失、语法错误或覆盖不全时稳定落在 `context_only`，而不是伪装成受限只读。
- Doctor/设置展示 `none/context_only/enforced_read/extra_write_active/blocked` 和可操作原因。
- 进程复用只在 workspace id、roots hash、profile、permission、model/effort 全匹配时发生；roots 变化会 cold-spawn 或 soft-respawn。

#### v1：可验证的 extra write

验收：

- independent 模式能生成 App-owned profile；shared 模式能引用用户已有 profile。
- smoke test 证明每个 write root 可创建/删除临时文件，extra root 外的同级目录仍失败。
- CLI 与 Host 都拒绝未声明路径；`deny` 规则优先；会话中途改根不会改变当前 turn 的 OS 边界。
- 主项目、extra root、workspace 外三类路径各有自动化测试和 UI 状态。
- 恢复旧 session 时 profile/root snapshot 不匹配会要求重新验证，不会静默放宽权限。

#### 完整版：多根生态

验收：

- 支持 workspace 导出/导入（仅路径和 profile 引用，不含密钥），根目录健康检查和批量修复。
- 在 Grok Build CLI 提供原生 multi-root ACP/CLI 协议后，再考虑让 extra root 加载其项目 instructions/skills，以及 SSH remote 根。
- 与 worktree、项目移动、session fork、自动化 headless 路径有明确 workspace 继承规则和测试。

### 明确不做（v1 non-goals）

- 不把侧栏 Spaces 改造成文件系统 workspace，也不让其 membership 自动获得读写权限。
- 不支持不同 SSH host、本地目录和 remote path 混合；SSH 需要独立的远程多根协议。
- 不支持通过 App 直接改写 shared `~/.grok/config.toml` / `sandbox.toml`，不自动修改用户仓库中已跟踪的 `.grok/sandbox.toml`。
- 不实现 CLI 不存在的 `--additional-directory`、`permissions.additionalDirectories` 或 ACP 私有扩展。
- 不让 extra root 自动加载 `.grok`/`.claude` 配置、hooks、skills；不做“信任所有根”。
- 不把 `always_approve` 作为跨根能力开关；它仍受 CLI deny、Host 声明根和 sandbox profile 约束。
- 不在 AppWorkbench/App.tsx 增加大型状态块，不重做现有项目选择器、worktree 或 session 树。

### 开放问题（已落定）

1. **shared 模式可写 profile 的来源** → **C**  
   v1 shared 永远只读（可引用用户自维护的 `sandbox.toml`）；先只在 independent 模式由 App 生成可写 profile。

2. **extra root 的默认能力** → **A**  
   加入即只读；写必须逐根切换并通过 smoke test。

3. **workspace 与项目的持久关系** → **A**  
   workspace 独立存 `workspaces.json`，项目可被多个 workspace 引用。

4. **写能力失败时的产品动作** → **A**  
   保持聊天可用但锁定 extra write，提供修复/重试。

## 推荐 + 为什么

推荐 **B：主项目 + 附加可读/可写根，并以 CLI capability 为硬门槛**。它保留现有单项目 cwd、trust、worktree、SSH 和会话恢复模型，改动集中在 domain/Host/弹窗；在 CLI 已经能表达的范围内提供真实跨根写入，在 CLI 尚不支持时诚实降级为只读。A 可以马上缓解同一父目录用户，D 可以作为后续的父目录优化，而 C 在 Grok Build 没有原生多根协议前会迫使 App 发明第二套权限语义，风险和实现面都不适合作为 v1。
