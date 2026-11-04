# 远程控制附件文件系统（Remote Attachment Store）设计

> **状态：待评审**（评审通过后才拆票与实现）  
> **范围：远程控制双向附件**（入站：IM → App；出站：App → IM），覆盖飞书 / Lark、Telegram、Discord、Slack、微信、钉钉等渠道  
> **首个渠道适配器：** Feishu / Lark（入站下载 + 出站原生媒体发送）。store、journal 引用与 GC 与具体渠道无关。  
> **基线：** `fix/remote-im-feishu-inbound-media`（`e5ac3c20`，已实现 Feishu 入站下载到 `remote/media` 的过渡版本）  
> **实现分支：** `refactor/attachment-store`

---

## 1. 背景

远程控制当前只有 Feishu 渠道实现了入站附件下载，其他渠道仍把媒体标识（`image_key` / `file_key` 等）拼成占位文本交给 agent。出站方向在 Rust 进程内 Bridge 中尚未实现；仓库里的历史 Node bridge（`remote-bridge/`）有可参考的 Feishu 上传与路径提取实现，但未接入 App。

Feishu 入站过渡实现链路：

```
远程控制渠道事件 → 下载字节 → {app_data}/remote/media/<instance>/<uuid>.<ext>
        → prompt 追加 "@/绝对路径"
        → journal 同时保存 attachments:[{path}] 与正文中的 @/abs/path
        → App 历史按绝对路径预览
```

问题：

1. **会话保存的是操作系统绝对路径**，没有附件身份；换机器、移动目录、删除文件都会让引用失效。
2. **附件处理绑在具体渠道里**（`remote_im/channels/feishu.rs`），其他渠道要重复实现下载、落盘与 journal 同步。
3. **出站附件没有统一入口**：agent 产出的文件无法可靠地作为原生图片/文件回传 IM。
4. **没有面向会话的引用模型**，无法回答“这个文件还有没有会话在用”。
5. **没有垃圾回收**；唯一的清理是 Feishu 入站目录按 mtime 30 天删除，会删掉仍被历史会话引用的文件，形成死卡片。
6. **删除会话不释放附件**；归档与删除在存储层没有区别。
7. 附件本体散落在 `remote/media`，与预览缓存、缩略图缓存、agent 产物目录没有统一边界。

已有可复用能力（不重做）：

- loopback 媒体服务（`src-tauri/src/media_server.rs`）、480px 缩略图（`image_thumb.rs`）、Range 流式读取、`path_scope` 授权模型。
- 会话 journal 的 `attachments` 字段与前端 `parseAttachmentsFromContent` / `paths_classify` 兼容层。
- 远程 IM 的下载 worker、ACL / 群 @ 门槛、现有单文件 50 MB 与每聊天 200 MB/60s 预算（`remote_im/channels/feishu.rs`；本次单文件上限提升到 100 MB）。
- 历史 Node bridge 的出站能力：路径提取、Feishu 图片/文件上传、原生消息发送、失败降级（`remote-bridge/src/feishu/{media,upload,outbound}.ts`）。

---

## 2. 目标与非目标

### 2.1 目标

| # | 目标 |
|---|------|
| G1 | 远程控制入站附件统一进入 Host 侧 **AttachmentStore**，由 UUID 标识；渠道只负责下载，store 与 GC 保持渠道无关 |
| G2 | 会话 journal 只保存附件引用 `{id, name, kind, size}`，不保存绝对路径、不保存附件本体 |
| G3 | 引用驱动垃圾回收：无任何会话引用即可回收；归档会话的引用保留 |
| G4 | 删除会话 / rewind 只移除引用，由 GC 回收对象；不在删除路径上直接删文件 |
| G5 | 给 agent 的 `@/abs/path` 在发送时由 store 物化，不写入 journal |
| G6 | 前端按附件 ID 取流（缩略图 / 原图），不再接触 store 内部绝对路径 |
| G7 | **出站附件**：agent 产出的本地文件经统一提取、校验、**入库后以 store 对象为唯一交付来源**，由渠道适配器从 store 读取并上传为原生图片/文件消息；assistant 行保存附件引用 |
| G8 | 删除 `remote/media` 过渡目录与 30 天按时间清理；现有数据只有两张测试图，不做迁移 |
| G9 | 保持旧 journal（仅 path）可读，兼容 Composer 与 agent 产物的既有路径语义 |

### 2.2 非目标（明确不在本 Spec）

- Composer 粘贴 / 文件选择产生的 `attachments/paste` 附件。
- Agent 生成但**没有回传 IM** 的图片 / 视频 / 文件（仍留在 CLI 会话树，按路径引用）。
- 其他渠道（Telegram / Discord / Slack / 微信 / 钉钉）的入站下载与出站上传实现；本 Spec 只定义契约并交付 Feishu 适配器。
- 文件预览体验优化：离屏懒加载、媒体可见带、10 MB 缓存准入、缩略图/封面磁盘缓存预算。  
  这些归入独立的「文件预览」Spec，本设计只保留按 ID 取流的接口。
- 远程 URL 附件（`https://…`）的本地化。
- 附件加密、跨设备同步、多用户共享。

---

## 3. 术语

| 术语 | 含义 |
|------|------|
| **AttachmentStore** | Host 内的附件文件系统与元数据索引 |
| **blob / 附件对象** | store 中一份实际文件，按 sha256 内容寻址，多个上传可共享 |
| **attachment / 上传记录** | 一次上传的元数据行，由 UUIDv7 标识；会话引用的是 attachment id |
| **attachment id** | UUIDv7，会话引用上传记录的唯一标识；时间有序，改善索引局部性 |
| **reference / 引用** | 会话 journal 中 `attachments[].id` |
| **materialize** | 把 id 解析为 agent 可读的绝对路径，仅用于当次 prompt |
| **outbound attachment** | agent 产出并要回传 IM 的本地文件；入库后以同一 AttachmentRef 表达 |
| **mark-and-sweep** | 扫描所有 journal 标记引用，再回收未标记对象 |
| **宽限期（grace）** | 新对象在无引用状态下仍保留的时间，避免写入与 journal 提交竞态 |

---

## 4. 架构

```
入站                                          出站
┌──────────────────────────┐        ┌──────────────────────────────┐
│ 渠道适配器（Feishu 首发）│        │ 渠道适配器（Feishu 首发）    │
│ 下载 → put_bytes         │        │ upload(AttachmentRef)        │
└────────────┬─────────────┘        └──────────────▲───────────────┘
             │ AttachmentId                        │
             ▼                                     │
┌──────────────────────────────────────────────┐   │
│ AttachmentStore（Host Rust）                  │───┘
│  blobs/<sha256>/<safe-name>                   │
│  index.sqlite                                 │
│  put_bytes / put_file / metadata              │
│  materialize / open_range / gc                │
└────────────┬──────────────────▲──────────────┘
             │ 引用（uuid）      │ 入库（outbound）
             ▼                  │
┌──────────────────────────────┐│
│ 会话 journal（messages.json）││
│  user:      入站 refs        ││
│  assistant: 出站 refs        ││
└────────────┬─────────────────┘│
             │ materialize(id)  │
             ▼                  │
      Grok CLI  @/abs/path      │
             │ 回复中的本地路径 │
             └──────────────────┘
```

建议代码落点：

| 模块 | 位置 |
|------|------|
| Store 接口 / 对象读写 | `src-tauri/src/attachments/store.rs` |
| SQLite 索引 | `src-tauri/src/attachments/index.rs` |
| GC | `src-tauri/src/attachments/gc.rs` |
| 媒体端点 | `src-tauri/src/media_server.rs`（新增按 ID 路由） |
| 远程入站写入 | `src-tauri/src/remote_im/channels/feishu.rs` |
| 出站路径提取 | `src-tauri/src/remote_im/outbound_media.rs`（新增） |
| 出站渠道上传 | `src-tauri/src/remote_im/channels/feishu.rs` + `remote_im/outbound.rs` |
| 会话同步 | `src-tauri/src/remote_im/engine.rs`、`app_sessions.rs` |
| 数据模型 | `src-tauri/src/store.rs` |
| 前端取流 | `src/lib/attachments.ts`、`imageSrc.ts`、`imageThumbClient.ts` |

---

## 5. 数据模型

### 5.1 磁盘布局

```
{app_data}/attachments/store/
  index.sqlite
  blobs/
    <sha256>/
      <sanitized-name>
  staging/
    <uuid>.part
```

- **blob 按内容寻址**：同一文件的多次上传共享一个 `blobs/<sha256>/` 目录，不重复保存。
- 每次上传仍然生成一个新的 **UUIDv7 attachment 行**（别名），会话引用的是 attachment id；文件名、来源、会话归属按上传分别记录。
- 文件名取首个上传的原文件名（去除路径分隔符、控制字符，长度上限 80），为空时用 `attachment.<ext>`；后续重复上传在 attachment 行保留自己的展示名。
- 写入流程：流式写入 `staging/<uuid>.part` 并增量计算 sha256 → 校验大小 → 命中已有 blob 则丢弃临时文件并只插入 attachment 行；否则 flush → rename 到 blob 目录 → 插入 blob + attachment 行。
- 权限 0600 / 0700；拒绝符号链接；所有路径由 store 生成，不接受外部传入的 store 内部路径。

### 5.2 SQLite 索引

```sql
CREATE TABLE IF NOT EXISTS blobs (
  sha256      TEXT PRIMARY KEY,   -- 内容地址
  rel_path    TEXT NOT NULL,      -- blobs/<sha256>/<name>，相对 store 根
  size        INTEGER NOT NULL,
  kind        TEXT NOT NULL,      -- image | file | audio | video
  created_at  INTEGER NOT NULL    -- Unix 秒
);

CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,   -- UUIDv7（每次上传一个，重复内容也生成新 id）
  sha256      TEXT NOT NULL REFERENCES blobs(sha256),
  name        TEXT NOT NULL,      -- 该次上传的展示名
  kind        TEXT NOT NULL,
  origin      TEXT NOT NULL,      -- remote:feishu / outbound:feishu / …
  instance_id TEXT,
  session_id  TEXT,               -- 出站：产生该文件的 App 会话；入站可后填
  message_id  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_sha ON attachments(sha256);
CREATE INDEX IF NOT EXISTS idx_attachments_created ON attachments(created_at);
CREATE INDEX IF NOT EXISTS idx_blobs_created ON blobs(created_at);
```

去重语义：

- 相同 sha256 的第二次及以后上传：**不新建 blob**，只插入新的 attachment 行（新 UUIDv7）。会话引用、删除、GC 都以 attachment id 为单位。
- 单会话 512 MB 额度按**唯一 blob 的物理大小**计算：同一文件被上传两次只计一次；展示层的逻辑大小可另算，但不影响额度。
- blob 的删除取决于是否还有 attachment 行引用它；删掉一个重复上传的 UUID 不会删除仍被其他 UUID 引用的文件。

UUIDv7 的收益：主键按时间近似单调，SQLite B-tree 插入集中在右侧，减少页分裂；attachment 目录/记录也天然按创建时间排序，便于排查。UUIDv7 含毫秒时间戳，可接受；不作为安全随机数使用。

依赖：`uuid` crate 增加 `v7` feature（当前已有 `v4`、`serde`），生成使用 `Uuid::now_v7()`。

单进程访问；`PRAGMA journal_mode=WAL`、`busy_timeout`。索引只描述 blob 与 attachment，不维护引用计数；引用以 journal 为唯一真相源（见 §7）。

### 5.3 会话引用

`MessageAttachmentStored` 扩展（保持向后兼容）：

```rust
pub struct MessageAttachmentStored {
    /// 新附件：store UUID；旧数据 / 远程 URL 为 None
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// 旧数据 / 远程 URL 使用；store 引用时为空
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub path: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_dir: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}
```

解析优先级：

1. `id` 存在 → 走 store；`path` 忽略。
2. `id` 缺失、`path` 是本地绝对路径 → 旧数据兼容路径。
3. `id` 缺失、`path` 是 `http(s)://` → 远程 URL 附件（不进入 GC）。
4. `is_dir = true` → 目录卡片，不进入 store。

新 journal 示例：

```json
{
  "role": "user",
  "content": "这张报错图怎么处理？",
  "attachments": [
    { "id": "8f0c…", "name": "error.png", "kind": "image", "size": 184320 }
  ]
}
```

出站 assistant 行：

```json
{
  "role": "assistant",
  "content": "已生成图表。",
  "attachments": [
    { "id": "c41a…", "name": "chart.png", "kind": "image", "size": 52310 }
  ]
}
```

会话元数据：

```rust
pub struct SessionMeta {
    // …
    /// 远程控制渠道名（feishu / lark / telegram…）；None 表示非远程会话。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_im: Option<String>,
}
```

`sync_turn_to_app` 在远程 turn 首次落到某会话时设置并持久化 `remote_im`；GC 只扫描该字段非空的会话。

### 5.4 展示文本与 agent prompt 分离

远程消息新增两个概念：

- `display_text`：用户在 IM 里真正输入的文字，写入 journal `content`；纯媒体消息为空。
- `agent_prompt`：发送给 Grok CLI 的文本，由 `display_text` + 附件引导语 + `materialize(id)` 生成的 `@/abs/path` 行组成，**不落库**。

因此：

- 新 journal 的 `content` 不再包含 `@/abs/path`。
- 旧 journal 继续保留 `@path`，由现有 `parseAttachmentsFromContent` 兼容读取；本次不做 journal 重写（见 §9）。
- 纯媒体消息允许 `content` 为空，但 `attachments` 非空时必须继续进入 agent turn（当前 `engine.rs` 会在空 content 时直接 return，需要调整）。

---

## 6. 关键流程

### 6.1 远程入站写入

1. 渠道适配器流式下载到 `store/staging/<uuid>.part`，同时增量计算 sha256；超过 **100 MB** 单文件上限立即中止并删除临时文件。
2. 媒体 worker 把 `StagedAttachment { temp_path, name, kind, size, sha256 }` 交给 engine。
3. engine 解析当前 App 会话，计算该会话已引用的唯一 blob 总大小；按 sha256 判断新文件是否新增物理占用，并把本回合已提交的增量计入；超过 **512 MB** 则拒绝、删除临时文件并写入可见失败说明。
4. 未超限则 `store.commit_staged(...)`：命中已有 sha256 时丢弃临时文件，只插入新的 attachment 行；否则把临时文件 rename 为 blob 并插入 blob + attachment 行。
5. 得到 `AttachmentRef { id, name, kind, size }`；`IncomingMessage { content: display_text, attachments: refs }` 交给 engine 构建 prompt。
6. engine 构建 `agent_prompt`：`display_text` + 每个 ref 的 `materialize(id)` 路径；发送给 `grok -p`。
7. `sync_turn_to_app` 写入 journal：用户行 `content = display_text`，`attachments = refs`；不再解析 prompt 中的 `@path`。

失败处理：

- 单文件下载失败或超过 100 MB：不写 journal 引用；删除临时文件；在 `agent_prompt` 中加入单行失败说明，由 agent 告知用户重新发送。
- 单会话超过 512 MB：拒绝本次新增附件，保留已有附件；删除临时文件并写入可见失败说明。
- store 写入失败：同上，错误进日志，不产生悬挂引用。
- 全部附件失败且 `display_text` 为空：允许以失败说明作为 `agent_prompt`，避免消息被静默丢弃。

### 6.2 前端取流

- `AttachmentRef` 有 `id` 时，前端生成：
  `http://127.0.0.1:{port}/v1/attachment/{id}?t={token}&variant=thumb|original`
- Host 解析 id → store 路径 → 复用现有缩略图 / Range 流逻辑。
- 返回 404 时前端降级为缺失附件（沿用现有 `media.err.missingPath`）。
- 绝对路径解析逻辑保留给旧数据与 agent 产物；远程新数据不再走路径端点。

> 本 Spec 只交付“按 ID 取流”的接口与最小前端适配；离屏懒加载、10 MB 缓存、磁盘缓存预算由文件预览 Spec 负责。

### 6.3 预览与 agent 的关系

- agent 需要通过 `materialize(id)` 拿到稳定绝对路径；该路径在对象生命周期内不变。
- 对象被 GC 后，历史 journal 的引用会变成缺失；前端在历史加载时按现有 `paths_classify` 语义隐藏卡片（后续文件预览 Spec 可提供“已回收”墓碑态）。

### 6.4 远程出站（App → IM）

触发约定：

- 远程 agent 的规则中追加一条出站约定：为用户创建了要回传的文件时，把**绝对路径单独写一行**（沿用历史 Node bridge 的 `MEDIA_OUTBOUND_RULE` 语义）。
- 解析器只接受“独立成行的本地绝对路径”，支持 markdown 图片/文件链接；不把正文中偶然出现的路径当作附件。
- 每条回复最多 16 个出站文件；按路径去重；目录、不可读文件、超出渠道上限的文件跳过并记录。

流程：

1. `grok_agent::run_turn` 返回最终文本。
2. `outbound_media::extract(text)` → `(display_text, Vec<LocalPath>)`。
3. 对每个路径校验：存在、regular file、位于允许根（项目 workdir、app data、store、temp、agent home）、大小符合渠道限制。
4. `store.put_file(origin = "outbound:<channel>", name, kind, src)` → `AttachmentRef`。
5. `OutboundRouter::send_media(instance_id, chat_id, reply_to, ref)`：
   - Feishu：图片 ≤10 MB 走 `/open-apis/im/v1/images` + `msg_type=image`；其他或超限走 `/open-apis/im/v1/files`（≤30 MB）+ `file` / `audio` / `media`，失败时降级为 `file`。
   - 其他渠道：返回 `Unsupported`，由 Bridge 发送文本降级说明。
6. 先发送 `display_text`（已移除成功上传的路径行），再逐个发送原生媒体；发送失败时追加一条文本说明（文件名 + 错误分类），不吞掉失败。
7. `sync_turn_to_app` 写入 assistant 行：`content = display_text`，`attachments = 出站 refs`。
8. GC 将 assistant 行引用计入 Mark；删除会话后出站对象才可回收。

边界：

- **store 对象是出站文件的唯一交付来源**：`send_media` 从 store 读取字节并上传；assistant 行保存 `AttachmentRef`。原路径只用于导入，不进入 journal，因此不会出现“会话用绝对路径、store 副本没人引用”的情况。
- 出站导入前同样检查 512 MB 会话额度；同一回复内连续导入时，本回合已提交的物理增量计入检查；相同 sha256 只计一次。
- 源文件保留在原位置，供 agent 后续继续使用；store 中是独立副本。上传与 App 历史预览都使用 store 副本，源文件被移动或删除不影响已发送内容。
- 出站成功 → assistant ref 保留对象；出站失败 → 对象暂无引用，宽限期后由 GC 回收，同时发送可见的失败说明。
- 同一回复中文本与媒体的顺序：文本先、媒体后；媒体作为对应用户消息的 reply。
- 出站失败不回滚已发送的文本；失败说明必须可见。

---

## 7. 引用与垃圾回收

### 7.1 引用真相源

**journal 是唯一真相源。** 不维护增量 refcount 表，避免 journal 与索引双写不一致。

Mark 阶段只扫描**远程控制会话**，不遍历全部本地会话：

1. 读取 `sessions_index.json`，选出 `remoteIm` 非空的会话（`remoteIm` 存渠道名，如 `feishu`）。
2. 只读取这些会话的 `messages.json`，收集 user / assistant / tool 行的 `attachments[].id`。
3. 包含 `archived = true` 的远程会话。
4. 进行中的 turn 可能刚写入对象、尚未写 journal：由宽限期覆盖。

`remoteIm` 的写入：

- `sync_turn_to_app` 在远程 turn 首次落到某会话时设置 `remoteIm = channel` 并持久化；本地创建的会话被远程继续时同样补上。
- 旧会话一次性 backfill：user 行以 `[Remote IM ·` 开头的会话补写 `remoteIm`；本次重构前不存在 store 对象，因此 backfill 只用于后续一致性。
- 找不到标记但 journal 含 store id 属于异常：GC 报告并跳过该对象（不删除），避免误回收。

安全性说明：

- store 对象只由远程控制（`origin = remote:* / outbound:*`）创建；Composer 与 agent 产物不进入 store，因此非远程会话不会引用 store id。
- 若未来 store 扩展到 Composer，需要重新评估 Mark 范围；届时改为扫描所有含 `attachments[].id` 的会话。

### 7.2 Sweep

分两步删除，避免误删共享 blob：

1. **attachment 行**：`id` 不在 Mark 集合中，且 `created_at < now - 24h` → 删除该行。
2. **blob**：没有任何 attachment 行再引用该 sha256，且 `created_at < now - 24h` → 删除 blob 目录与 blob 行。

注意：

- 删除一个重复上传的 attachment 行不会删除仍被其他 attachment 行引用的 blob。
- 新上传在 GC 期间插入 attachment 行：宽限期覆盖；Sweep 在事务中重新检查 blob 的引用数。
- `origin` 只接受 `remote:*` / `outbound:*`；其他 origin 跳过并报告，避免未来 store 扩展时误删。
- `rel_path` 必须位于 store 根内（防越界）。删除目录时只删 store 根下的 canonical 路径，不跟随符号链接。

### 7.3 触发时机

| 触发 | 行为 |
|------|------|
| 永久删除会话 / rewind / 批量删除 | 防抖 30s 后执行一次 |
| App 空闲（无进行中 turn） | 启动后延迟执行，最多每 24h 一次 |
| 手动诊断 | Host 命令 `attachments_gc`（供 Doctor / 测试） |

GC 与 journal 写并发：使用 Host 内单例 `tokio::sync::Mutex` 串行化 GC；Mark 逐文件读取使用现有 journal 锁；宽限期吸收“对象已建、引用未落盘”的窗口。

### 7.4 归档 / 删除 / Fork / Rewind

| 操作 | 引用变化 | GC 影响 |
|------|----------|---------|
| 归档 | 不变 | 仍计入 Mark，不回收 |
| 取消归档 | 不变 | 同上 |
| 永久删除会话 | journal 删除，引用消失 | 下次 GC 回收 |
| Fork 会话 | 复制 journal 引用 | 同一对象被两个会话引用，直到都删除 |
| Rewind / truncate | 被截断行的引用消失 | 下次 GC 回收 |
| 删除项目 | 会话保留，引用不变 | 不回收 |

**归档不等于删除**：归档只改列表过滤字段，不影响附件对象与引用。

### 7.5 移除旧清理

- 删除 `feishu.rs` 的 30 天 mtime prune。
- P3 启动时删除 `remote/media` 过渡目录。
- `support_bundle::reset_app_data` 增加 `attachments/store`，并移除 `remote/media` 条目。

---

## 8. 远程控制渠道接口

渠道适配器只负责“从平台下载字节并给出名称/类型”，不直接操作文件系统；store、journal 引用与 GC 与渠道无关。Feishu 是首个适配器，其他渠道后续接入时不需要改 store。

适配器契约：

```rust
/// 渠道适配器下载完成后交给 engine 的暂存附件。
pub struct StagedRemoteAttachment {
    pub channel: String,          // feishu | lark | telegram | discord | …
    pub instance_id: String,
    pub message_id: String,
    pub name: String,
    pub kind: AttachmentKind,
    pub temp_path: PathBuf,       // store/staging/<uuid>.part
    pub size: u64,
    pub sha256: String,
}

pub struct NewAttachment {
    pub name: String,
    pub kind: AttachmentKind,
    pub origin: String,              // 例如 remote:feishu / outbound:feishu
    pub instance_id: Option<String>,
    pub session_id: Option<String>,
    pub message_id: Option<String>,
    pub bytes: Vec<u8>,
}

pub struct NewAttachmentFile {
    pub name: String,
    pub kind: AttachmentKind,
    pub origin: String,
    pub session_id: Option<String>,
    pub source: PathBuf,             // 已在允许根内、已校验
}

pub struct StagedAttachment {
    pub temp_path: PathBuf,
    pub name: String,
    pub kind: AttachmentKind,
    pub size: u64,
    pub sha256: String,
}

pub struct NewAttachmentMeta {
    pub origin: String,
    pub instance_id: Option<String>,
    pub session_id: Option<String>,
    pub message_id: Option<String>,
}

pub struct AttachmentRef {
    pub id: String,
    pub name: String,
    pub kind: AttachmentKind,
    pub size: u64,
}

impl AttachmentStore {
    pub fn put_bytes(&self, input: NewAttachment) -> Result<AttachmentRef, StoreError>;
    pub fn commit_staged(
        &self,
        staged: StagedAttachment,
        meta: NewAttachmentMeta,
    ) -> Result<AttachmentRef, StoreError>;
    pub fn put_file(&self, input: NewAttachmentFile) -> Result<AttachmentRef, StoreError>;
    pub fn metadata(&self, id: &str) -> Result<AttachmentMeta, StoreError>;
    pub fn materialize(&self, id: &str) -> Result<PathBuf, StoreError>;
    pub fn open_range(&self, id: &str, start: u64, len: u64) -> Result<Vec<u8>, StoreError>;
    pub fn session_usage(&self, session_id: &str) -> Result<u64, StoreError>;
    pub fn gc(&self, now: SystemTime) -> Result<GcReport, StoreError>;
}
```

出站渠道契约：

```rust
impl OutboundRouter {
    /// 渠道原生媒体发送；不支持的渠道返回 Unsupported。
    pub async fn send_media(
        &self,
        instance_id: &str,
        chat_id: &str,
        reply_to: Option<&str>,
        attachment: &AttachmentRef,
    ) -> Result<(), SendMediaError>;
}
```

渠道接入顺序：

| 渠道 | 入站现状 | 出站现状 | 本 Spec |
|------|----------|----------|---------|
| Feishu / Lark | 已下载，落 `remote/media` | 未实现（Node 参考实现） | 入站改 `commit_staged`；出站实现 `send_media`，作为首个适配器 |
| Telegram / Discord / Slack | 只传文本或占位符 | 未实现 | 契约预留，后续单独接入 |
| 微信 / 钉钉 / 其他 | 只传占位符 | 未实现 | 契约预留，后续单独接入 |

约束：

- 附件 id 只接受 UUIDv7（同时校验标准 UUID 格式）；未知 id 返回 not-found，不做路径回退。
- `materialize` 返回的路径必须在 store 根下；拒绝符号链接。
- 单文件上限 **100 MB**；类型判断沿用现有扩展名 + magic bytes 逻辑；写入必须流式处理，不整文件读入内存。
- 单会话附件总量上限 **512 MB**，按唯一 blob 的物理大小计算（同一 sha256 只计一次）；新增前检查，超限拒绝。
- sha256 去重：相同内容只保留一个 blob，每次上传生成新的 attachment id；`session_usage` 按 sha256 去重求和。
- store 上限与渠道上限分离：入站 Feishu 资源接口最大 100 MB；出站 Feishu 上传 API 当前为图片 ≤10 MB、文件 ≤30 MB，适配器在导入前检查并在超限时给出可见说明；如需 100 MB 出站，另接飞书分片上传。
- 出站 `put_file` 只接受已通过允许根与大小校验的路径；store 内部只做读取与复制，不跟随符号链接。
- 失败不得产生索引孤儿：先写临时文件，成功后再插入索引；插入失败删除临时文件。

---

## 9. 过渡数据清理（不做数据迁移）

现有 `{app_data}/remote/media/` 只有两张相同的测试图片，删除无损失。本次采用干净切换，不实现通用迁移器：

1. P1 起新附件只写 AttachmentStore；`remote/media` 停止写入。
2. 删除 Feishu 的 30 天 mtime prune。
3. 一次性清理 `{app_data}/remote/media/`（启动时删除该目录；目录内的测试文件不导入）。
4. 旧 journal 中指向已删除路径的 `attachments` / `@path` 行按现有规则处理：文件缺失 → 历史加载时 `paths_classify` 丢弃卡片；不做 journal 重写。
5. `reset_app_data` 增加 `attachments/store`，移除 `remote/media` 条目。

保留的兼容性：

- 旧 journal 的 `{path}` 附件（Composer、agent 产物、旧远程测试行）继续可读。
- 远程 URL 附件继续走 `path`。
- 不引入迁移清单、`.bak` 或幂等重跑逻辑。

---

## 10. 安全

- store 路径由 UUID 生成；`id` 严格 UUID 校验，拒绝 `..`、`/`、`\`、URL 编码绕过。
- 打开对象时校验规范化路径仍在 store 根内；拒绝符号链接与非常规文件。
- 写入 0600；目录 0700。
- 预览端点沿用 loopback token + 主窗口 Origin 校验，不暴露绝对路径。
- 附件内容按原样保存，**不做脱敏、转码或内容改写**；避免复杂化，也避免破坏用户上传的文件。
- 日志只记录 id、origin、kind、size 与错误分类；不把附件正文或二进制写入日志。
- 出站路径校验：必须存在、regular file、规范化后位于允许根（项目 workdir、app data、store、temp、agent home）；拒绝目录、符号链接与系统路径。
- 出站大小：Feishu 图片 ≤10 MB、文件 ≤30 MB；其他渠道按适配器定义。超限时跳过并发送文本说明。
- GC 只删除 store 根内、索引存在的对象目录；不跟随符号链接。

---

## 11. 可观测性

- `attachments: put`（id、origin、kind、size、耗时）
- `attachments: materialize`（id、命中/缺失）
- `attachments: outbound`（路径、id、渠道、上传字节、失败分类）
- `attachments: gc`（扫描会话数、标记对象数、删除对象数、释放字节、跳过年轻对象、错误数）
- `attachments: cleanup`（删除 `remote/media` 的结果）
- 错误通过现有 `tracing` 上报，不静默吞掉。

---

## 12. 测试策略

### 12.1 Host

- Store：put → metadata → materialize → open_range 往返；UUIDv7 生成与时间有序性；重复 id 冲突；100 MB 流式上限（101 MB 拒绝，不整文件读入内存）；路径穿越 / 符号链接拒绝。
- 去重：相同 sha256 上传两次 → 1 个 blob + 2 个 attachment id；删除一个 attachment 行后 blob 仍存在；再次上传仍复用该 blob。
- 会话额度：重复内容只计一次；新增后超过 512 MB 拒绝；删除引用后额度下降。
- Journal：新 ref 序列化/反序列化；旧 `{path}` 兼容；`id` 优先于 `path`；缺失字段默认值。
- GC（注入时钟）：
  - 活跃会话引用保留；
  - 归档会话引用保留；
  - 删除会话后超过宽限期回收；
  - Fork 两个会话共享对象，删一个不回收；
  - Rewind 截断后回收；
  - 24h 内无引用对象不回收；
  - 远程 URL 引用不受影响；
  - **只 Mark `remoteIm` 会话**：本地会话即使出现 store id 也不参与 Mark，GC 报告异常并跳过该对象；
  - 两个 UUID 指向同一 blob：删除一个未标记 alias 不删 blob，另一个仍被引用时保留。 
- 远程链路（fixture）：渠道事件 → 下载到 staging → 会话额度校验 → commit → journal id → prompt 含 materialize 路径。
- 出站：路径提取（独立成行、markdown 链接、去重、16 个上限）；允许根与大小校验；`put_file` 后删除源文件仍能从 store 上传；Feishu 上传 fixture（图片 / 超限降级文件 / 4xx）；失败文本降级；assistant refs 写入 journal。
- 过渡清理：启动时删除 `remote/media`；旧 path 行缺失后不影响其他会话加载。

### 12.2 前端

- `AttachmentRef` 含 `id` 时生成 `/v1/attachment/<id>` URL；含 `path` 时保持旧逻辑。
- 历史加载：id 缺失对象降级为缺失附件；旧 path 行仍可读。
- 不新增缓存/懒加载测试（文件预览 Spec 负责）。

### 12.3 回归

- `cargo test`、`cargo clippy --all-targets -- -D warnings`、`cargo fmt --check`、`pnpm test`、`pnpm typecheck`。
- 真实飞书手工验证：发图 → App 显示 → agent 读到；删除会话 → GC 报告；归档会话仍显示。

---

## 13. 分期

| 阶段 | 内容 | 验收 |
|------|------|------|
| P1 | AttachmentStore + SQLite 索引 + **100 MB 单文件 / 512 MB 单会话 / sha256 去重** + Feishu 入站写入 + journal refs + prompt materialize + 按 ID 取流（最小前端适配） | 新 Feishu 入站附件只落 store；journal 只有 id；重复文件只存一份；超限拒绝；App 可显示；agent 可读 |
| P2 | Feishu 出站：路径提取、`put_file`、原生图片/文件上传、失败降级、assistant refs | agent 生成的文件在 IM 里显示为原生附件；失败可见；App 历史显示附件 |
| P3 | GC（mark-sweep、宽限期、触发时机）+ 删除/rewind 集成 + 归档语义 | 删除会话后回收；归档不回收；Fork 不误删 |
| P4 | 删除 `remote/media` 过渡目录 + 移除 30 天 prune + reset 集成 + 文档与 ADR | 旧测试附件不再落盘；reset 清理 store；文档同步 |

---

## 14. 验收标准

1. 远程控制发送图片/文件后，磁盘只新增 `attachments/store/blobs/<sha256>/…`，不再写入 `remote/media`。
2. 新会话 journal 的 user 行只含 `{id, name, kind, size}`，不含绝对路径；`content` 不含 `@path`。
3. 发送给 agent 的 prompt 含 `materialize(id)` 路径，agent 能读取图片内容。
4. App 历史通过 `/v1/attachment/<id>` 显示缩略图 / 原图；不暴露 store 绝对路径。
5. 单文件 100 MB 上限生效；超过时拒绝并给出可见说明。
6. 单会话唯一 blob 总量 512 MB 上限生效；重复上传只计一次物理大小。
7. 相同内容上传两次只保存一份 blob，但生成两个不同 UUID；删除其中一个引用不影响另一个。
8. agent 在回复中给出的本地文件路径被上传为 IM 原生图片/文件；assistant 行保存 refs；失败有可见说明。
9. 归档会话的附件不被 GC；删除会话后，附件在宽限期后被回收。
10. Fork 会话共享对象；删除其中一个会话不回收仍被另一个引用的对象。
11. 旧 journal（仅 path）与远程 URL 附件继续可用。
12. `remote/media` 目录被删除；旧测试附件不再产生新文件；清理可重复执行。
13. 全部 Host / 前端测试、lint、类型检查通过。

---

## 15. 不在本 Spec 的后续项

以下需求已确认归入「文件预览」独立 Spec：

- 仅加载进入视窗（或可见带）的媒体；
- 超过 10 MB 的文件不进入全分辨率预览缓存；
- 缩略图 / 视频封面磁盘缓存的总量与 LRU；
- 大图解码内存上限；
- 缺失附件的“已回收”墓碑态与用户清理入口。

本设计只保证按 ID 取流的接口稳定，供后续预览优化直接复用。

---

## 16. 已确认决策与待确认项

2026-11-04 与用户确认：

1. journal 为唯一引用真相源；扫描式 mark-sweep；24h 宽限期。
2. 新远程消息不再持久化 `@path`；prompt 发送时临时物化。
3. 不做数据迁移；现有 `remote/media` 只有两张测试图，直接删除，干净切换。
4. P1 包含最小前端按 ID 取流适配（仅显示，不做懒加载/缓存预算）。
5. 远程控制**出站附件（App → IM）属于本 Spec**，纳入远程文件管理。
6. 附件 ID 使用 **UUIDv7**，改善 SQLite 主键与对象目录的索引局部性。
7. 出站文件以 **store 对象为唯一交付来源**：`send_media` 从 store 读取；assistant 行保存引用；原路径只用于导入，不进入 journal。
8. GC Mark **只扫描 `remoteIm` 非空的远程控制会话**；本地会话不参与，异常引用跳过并报告。
9. 附件内容原样保存，**不做脱敏**、转码或内容改写。
10. 单文件上限 **100 MB**，写入流式处理。
11. 单会话附件总量上限 **512 MB**，按唯一 blob 物理大小计算。
12. sha256 去重：相同内容只保存一份 blob，每次上传生成不同 UUID；重复上传各自可独立删除。

出站设计（2026-11-04 用户跳过选择，默认采纳推荐方案；评审可调整）：

- A1 出站文件先 `put_file` 入库，再由渠道上传；assistant 行保存 AttachmentRef。
- A2 触发方式：agent 回复中的独立绝对路径，沿用历史 Node bridge 契约。
- A3 成功上传后从展示文本中移除路径行，改为附件引用。
- A4 渠道范围：Feishu 首发；其他渠道只预留契约与文本降级。

待确认：本文档拆成哪些纵向切片、每个切片的验收标准与依赖顺序。

---

## 17. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-11-04 | 初稿：范围收敛为远程控制入站附件；文件预览优化移出 |
| 2026-11-04 | 背景泛化为所有远程控制渠道；移除数据迁移，改为删除测试数据与过渡目录 |
| 2026-11-04 | 纳入远程控制出站附件（App → IM）；补充出站流程、存储与安全约束 |
| 2026-11-04 | 评审修订：UUIDv7；出站以 store 为唯一交付来源；Mark 只扫描 remoteIm 会话；取消附件脱敏 |
| 2026-11-04 | 评审修订：单文件 100 MB；单会话 512 MB；sha256 去重（blob 共享，UUID 区分上传） |
