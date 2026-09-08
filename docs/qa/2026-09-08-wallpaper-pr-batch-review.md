# 壁纸 PR 批次整合审查

日期：2026-09-08 至 2026-09-09。结论：审查发现 **3 个 P2 时序/状态问题**，桌面实测另发现 **1 个 P2 本地缩略图问题**。四项均已在审查分支修复，并由确定性回归测试覆盖；全量前端测试、类型检查、Lint、Rust 检查和 Windows 测试清单均通过。

## 整合基线与范围

- 源项目 `RongleCat/grok-app` 的 `main` 已更新到 `1a84652a`，并完整合入独立分支 `review/wallpaper-pr-batch-20260908`；合并提交为 `76d7306b`，无冲突。
- 当前源头已经包含 #1116、#1117 和 #1118；本审查分支在这一基线上追加四项问题修复，没有重写源头提交历史。
- 保留原开发工作区及其他任务的未提交修改。没有在 GitHub 合并、关闭 PR 或发布审查评论。
- 审查按功能链路覆盖：X/Responses 的取消和追加、独立图片来源与预取、Grok Saved 隔离桥接、原图预览、收藏与本地目录、来源历史、生成与结果审计、主题上下文与菜单。
- 本次完成代码、契约、自动化整合审查和本地图库桌面实测；没有重新运行七来源真实登录、远端搜索和实际生成的完整端到端验收。

## 确认并修复的问题

### R1 / P2：加载更多覆盖期间完成的收藏和本地路径

位置：[useWallpaperProviderController.ts](../../src/hooks/useWallpaperProviderController.ts#L375)，快照建立于第 320 行，覆盖发生在第 375–376 行。

触发：Web、Openverse 或 Pexels 已有结果，点击加载更多，在等待下一页时收藏一张现有图片或完成原图下载，最后分页返回。控制器在请求开始时保存 `initialItems`，完成时用这份旧快照覆盖当前列表。

实测：分页前 `favorite=false`；等待期间已改为 `favorite=true` 并写入 `localPath`；分页完成后重新变成 `favorite=false`，路径丢失。目录本身仍保存正确值，但 UI 会显示错误收藏状态；再次点击可能重复收藏。旧条目已有 metadata 时，目录补全 hook 不会重新查询来纠正它。

归属：#1097 的 Provider 分页/预取实现，与 #1115 的收藏和来源恢复集成后暴露。#1116 进一步明确翻页期间卡片可交互。

修复：分页结果通过函数式更新追加到最新列表，不再用请求开始前的快照覆盖状态。回归测试在下一页未完成时修改已有卡片的收藏和 `localPath`，确认分页完成后修改仍保留且新卡片正常追加。

### R2 / P2：关闭预览不取消原图，新预览等待旧下载

位置：[ImageViewer.tsx](../../src/components/ImageViewer.tsx#L99)，并发限制在第 241 行；配套回调见 [useWallpaperItemPreview.ts](../../src/hooks/useWallpaperItemPreview.ts#L220)。

触发：打开两个尚未完成的远程原图，关闭预览，再打开另一张图片。`close()` 只清空去重集合和等待项、更新内部代次，没有取消已经启动的 Host 请求；`activeOriginalLoadsRef` 只能等旧任务结束后递减。

实测：新预览缩略图已经显示，但新的原图 loader 调用次数仍为 0；只有旧下载返回后才开始。真实 Lightbox 与壁纸弹窗集成测试进一步确认：点击 Close 后，Host 的单项取消和全部取消接口调用次数都为 0。

同一来源下关闭 Viewer 也不会使壁纸回调的 `sourceGenerationRef` 失效，所以旧下载仍可写回卡片路径/metadata。Viewer 内部拒收旧 slide，并不等于 Host 取消或调用方状态隔离。

归属：#1116 的懒加载原图和统一 Viewer；影响发现来源和 Grok Saved 预览。全局 Viewer 是共享组件，应同时回归聊天图片、独立主题编辑器入口。

修复：Viewer 为每个原图任务持有 `AbortController`，关闭、换画廊和卸载时只取消自己拥有的请求并立即释放并发槽。远程 Provider 按 `requestId` 精确取消；Grok Saved 同 URL 的多个消费者共享一次传输，只有最后一个消费者退出才取消 Host 请求，避免误杀收藏或其他预览。

### R3 / P2：删除本地缓存后，其他来源历史仍使用失效路径

位置：[WallpaperSourceModal.tsx](../../src/components/WallpaperSourceModal.tsx#L744)；来源恢复见第 552 行；本地路径直接返回见 [wallpaperSourceMedia.ts](../../src/lib/wallpaperSourceMedia.ts#L40)。

触发：搜索来源中的图片已经下载或收藏，在本地库删除该文件，随后切回原来源并预览、应用或用作视频源图。删除回调只更新本地库和当前列表，没有按 localPath 清理其他来源历史中的同一文件引用。

实测：删除成功并从本地库消失后，切回 Web 仍恢复旧 localPath；再次打开预览不会调用远程下载接口。`ensureLocalWallpaperMedia` 直接接受这条已失效路径，后续媒体读取会失败，也没有退回仍然有效的远程 URL。

归属：#1115 的来源历史、收藏/目录与原有本地删除操作的集成缺口。

修复：成功删除后按 Windows 路径等价规则同步失效所有来源历史、选择状态和图生视频/改图源；仍有远程原始 URL 的卡片清除本地字段并允许重新下载，本地独有卡片直接移除。

### R4 / P2：本地图库把已下载的 Provider 图片再次当作远程缩略图

位置：[WallpaperSourceGallery.tsx](../../src/components/WallpaperSourceGallery.tsx#L234)。

触发：在“壁纸库”查看来源为 Pexels 或 Openverse 的已下载图片。卡片虽然已有 `localPath`，渲染分支仍只根据 `item.source` 选中 `WallpaperProviderThumbnail`，于是把本地条目送进远程缩略图请求路径。批量请求失败后，卡片统一显示“无法下载该图片”。

实测：118 项本地图库中，Pexels/Openverse 卡片成批失败，而 X/Imagine 本地卡片正常，说明不是媒体端点或图库目录整体故障。

修复：Provider 远程缩略图只在在线来源页启用；进入本地图库后统一通过本地媒体端点读取 `localPath`。新增组件回归测试明确断言本地 Provider 项不会挂载远程缩略图组件。开发版桌面刷新后，原先失败的 Pexels/Openverse 卡片均恢复显示。

## 验证证据

| 检查 | 本次结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm typecheck` | 通过 |
| 修复后全量 `pnpm test` | 627 文件、7329 测试通过 |
| `pnpm lint` | 通过 |
| `pnpm build:ui` | 通过；Vite 保留大 chunk 提示，不是本次新确认缺陷 |
| `check-code-quality-gates.py --mode final` | PASS；千行文件数量 80，已到当前门禁上限 |
| `publish-website-downloads.py --self-test` | 3 项通过 |
| #1116 当前提交的 GitHub CI | frontend、Rust Windows/Linux/macOS 全通过，run 34231031103 |
| #1117 当前提交的 GitHub CI | frontend、Rust Windows/Linux/macOS 全通过，run 34233678512 |
| `cargo fmt --all -- --check` | 通过 |
| `cargo clippy --all-targets -- -D warnings` | 通过 |
| Windows manifest harness | 1836 通过、0 失败、1 忽略 |
| 直接 `cargo test` | 本机进程加载被 `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND` 阻塞，未进入断言；仓库 CI 使用的 manifest/PATH harness 可正常执行同一测试集 |
| 新增回归 | R1-R3 的 4 条原始复现和 R4 的本地 Provider 渲染测试均通过；相关定向回归 14/14 通过 |
| 桌面实测 | 本地图库 118 项可显示；原先成批失败的 Pexels/Openverse 本地图片恢复 |

R1-R3 的修复前复现补丁：[regressions.patch](evidence/wallpaper-pr-review-20260908/regressions.patch)。结果摘录：[results.txt](evidence/wallpaper-pr-review-20260908/results.txt)。补丁只新增测试及相关 fixture，不修改产品实现，也不把预期失败包装成通过。R4 来自桌面实测，随后直接加入产品修复和组件回归测试。

在修复前的整合提交 `e64b881c` 上执行以下步骤，可重现 R1-R3 的四条失败。先检查补丁，再应用；运行结束后反向应用恢复测试文件。

```powershell
git apply --check docs/qa/evidence/wallpaper-pr-review-20260908/regressions.patch
git apply docs/qa/evidence/wallpaper-pr-review-20260908/regressions.patch
pnpm exec vitest run src/components/ImageViewer.test.tsx src/components/WallpaperSourceModal.viewer.integration.test.tsx src/hooks/useWallpaperProviderController.test.tsx src/components/WallpaperSourceModal.library.test.tsx -t "review:"
git apply --reverse --check docs/qa/evidence/wallpaper-pr-review-20260908/regressions.patch
git apply --reverse docs/qa/evidence/wallpaper-pr-review-20260908/regressions.patch
```

## 批次状态与后续顺序

| 批次 | 当前状态与审查结论 |
| --- | --- |
| #1074、#1076–#1084 基础修复 | 已合入源头；整合验证覆盖相关已有测试 |
| #1085–#1092 X/Responses、追加与缩略图 | 已合入；功能存在。X 当前仍为一次显式追加，没有自动持续预取 |
| #1093–#1099 凭据、Provider、Web 与预取 | 已合入；R1 已在审查分支修复 |
| #1102–#1103 Grok Saved | 已合入；R2 已在审查分支修复 |
| #1104–#1106 本地目录与分页 | 已合入；本地库自身分页已保留并发收藏修改 |
| #1108–#1111 | 原 PR 已关闭，内容由已合入的 #1115 承接；不是以关闭状态判断内容丢失。R1/R3 属于集成后的问题，现已修复 |
| #1112 Windows CI 工具路径 | 已合入，当前 Windows CI 通过 |
| #1116 `feat(wallpaper): 统一媒体预览并按需加载原图` | 已合入源头；R2 的取消生命周期已在审查分支补齐 |
| #1117 `fix(frontend): 修复外观热更新卡顿与主题菜单竞态` | 已合入源头；自动回归未发现该补丁独有的新缺陷 |

相关变更的 UI 审核信息：

| PR | 页面与用户可见变化 | 风险与审核边界 |
| --- | --- | --- |
| #1116 | 外观→寻找壁纸、独立主题编辑器、全局图片/视频预览；缩略图先开，按需升级原图，失败可重试，分页期间继续浏览 | 全局 Viewer 复用面较广；R2 已修，仍需窄窗口、键盘/触摸和视频实机验收 |
| #1117 | 主题提供器、外观热更新及左下角主题菜单；悬停后点击不再反向关闭菜单，上下文身份保持稳定 | 自动回归通过；正式交付前仍需真实热更新与两个入口验证 |

两条 PR 均已由源项目合入。本次没有代替维护者创建新 PR、发布审查评论或做远端合并决定；四项修复集中为一批审查后续提交，避免继续拆成碎片 PR。

## 计划完整性与技术债

“已有代码分批送审”与“整个壁纸优化计划完成”应分开记录。当前整合不能宣称以下目标已经验收完成：

- X 自动预取下一批：当前代码在一次显式追加成功后清空 continuation；Provider/Web/Saved 的预取不能代替它。
- 原优化计划后续：视频实际尺寸与时长、目录保存失败后找回作品、可恢复删除、另存为与打开目录、批量操作、更多筛选、500 项性能和固定质量对照。开发工作区的计划仍将这些列为后续批次；本次整合没有包含相应后续完整交付。
- 原工作区保留的三个 UI WIP 以及独立优化任务需单独核对和验收，不能把“未进入本批”写成“丢码”，也不能直接当作已交付。
- `WallpaperSourceModal` 仍集中管理跨来源状态；本次已经补齐分页合并、请求取消和应用内删除失效规则，但长期应把共享的媒体身份与生命周期契约继续收敛，避免再靠页面级协调扩张。
- 应用内删除的失效路径已修复；如果用户直接在资源管理器中删除缓存文件，已恢复的来源历史仍缺少一次文件存在性探测，这是独立的低优先级健壮性项。
- 相册计划文档仍使用早期 Slice 1 交付表述，而 Host/UI 已经合入；验收台账需要按当前代码更新，避免后续交接误判。

未列为缺陷：隐藏 Provider 预取结束后旧 progressiveItems 自动露出的疑点，在真实 Remote hook 中会随完成清空，未得到证实；目录写失败向调用者报错有现有明确测试，本轮不将其直接归为预览损坏缺陷。

没有证据把上述问题归因于 Git 拆分把文件丢了。确认的问题来自分页、Viewer、跨来源历史与图库渲染分支之间的状态衔接；已发现问题均有对应修复和回归，独立优化计划及尚未覆盖的真实服务验收仍应继续。
