# ADR 0006 — 远程控制附件使用内容寻址 store 与引用驱动 GC

- 状态：已采纳
- 日期：2026-11-04

## 背景

远程控制第一版把入站媒体直接写到 `{app_data}/remote/media/<instance>/`，再把绝对路径拼进 prompt 与 journal。它带来四个问题：

- journal 保存 OS 绝对路径，换机器或移动目录即失效；
- 没有附件身份，无法回答“还有没有会话在用”；
- 飞书入站目录按 mtime 30 天清理，会删掉仍被历史会话引用的文件；
- 出站附件没有统一入口，agent 产出的文件无法可靠回传 IM。

## 决策

1. **内容寻址 blob + 每次上传一个 UUIDv7 attachment 行**
   - `blobs(sha256 PRIMARY KEY)` 只保存一份实际文件；
   - `attachments(id UUIDv7 PRIMARY KEY, sha256 FK, name, kind, origin, session_id, message_id, created_at)` 记录每次上传；
   - 相同内容多次上传共享 blob，但保留不同 UUID，删除一个引用不影响其他引用。
2. **journal 只保存引用**：`attachments: [{id, name, kind, size}]`；给 Grok CLI 的 `@/abs/path` 在发送时物化，不落库。
3. **引用驱动 GC**：Mark 只扫描 `remoteIm` 非空的会话（包含归档），收集 attachment id；Sweep 先删超过 24h 宽限期的无引用 attachment 行，再删没有任何 alias 的 blob。journal 是唯一真相源，不维护增量 refcount。任一远程 journal 读取/解析失败时 GC 中止，避免把读取失败的会话误判为无引用；同时清扫崩溃遗留的 blob 目录与 staging 文件。
4. **归档不是删除**：归档会话继续参与 Mark；永久删除会话/rewind 后由 GC 收敛。
5. **出站以 store 为唯一交付来源**：agent 回复中的独立绝对路径先入库，再由渠道从 store 读取并上传；assistant 行保存成功上传的引用。
6. **预览按 UUID**：`/v1/attachment/<id>` 由 Host 解析，不向 WebView 暴露 store 路径。
7. **限额**：单文件 100 MB；单会话唯一 blob 总量 512 MB；同一 turn 的入站与出站增量合并计算。Feishu 出站仍受平台 10 MB（图片）/30 MB（文件）限制。
8. **不做附件脱敏/转码**：内容原样保存，避免破坏用户上传内容。
9. **失败说明只进 agent prompt**：journal 的 user content 只保留用户真正输入的文字；工具/系统失败由 agent 回复或 assistant 行表达。

## 影响

- `remote/media` 过渡目录停止写入并在启动时清理；30 天按时间清理被移除。
- 旧 journal 的 `path` 附件继续按原逻辑读取；仅远程控制新数据使用 UUID 引用。
- 预览缓存优化（离屏懒加载、10 MB 缓存准入、磁盘缓存预算）归独立文件预览 Spec；本 ADR 只保证按 ID 取流接口。
- GC 只扫描远程会话，本地 Composer / agent 产物不进入 store；未来若扩展 store 范围，需要重新评估 Mark 范围。
- `attachments_gc` 提供 Host 诊断入口；删除会话/rewind 后防抖执行，启动后最多每 24h 一次。
