# 壁纸 PR 批次整合审查

日期：2026-09-08 至 2026-09-09。结论：审查发现 **5 个 P2 状态、渲染或可观测性问题**，并确认 **1 个 P1 界面拆分遗漏**；其中可观测性问题也是拆 PR 时漏带旧实现所致。六项恢复与修复已在同一审查分支完成验证，结果以本报告“验证证据”为准。

## 整合基线与范围

- 源项目 `RongleCat/grok-app` 的 `main` 已更新到 `1a84652a`，并完整合入独立分支 `review/wallpaper-pr-batch-20260908`；合并提交为 `76d7306b`，无冲突。
- 当前源头已经包含 #1116、#1117 和 #1118；本审查分支在这一基线上追加六项问题修复与恢复，没有重写源头提交历史。
- 保留原开发工作区及其他任务的未提交修改。没有在 GitHub 合并、关闭 PR 或发布审查评论。
- 审查按功能链路覆盖：X/Responses 的取消和追加、独立图片来源与预取、Grok Saved 隔离桥接、原图预览、收藏与本地目录、来源历史、生成与结果审计、主题上下文与菜单。
- 本次完成代码、契约、自动化整合审查和本地图库桌面实测；没有重新运行七来源真实登录、远端搜索和实际生成的完整端到端验收。

## 分支拆分遗漏更正

先前结论把“功能提交已经进入当前分支”错误等同于“原优化链完整进入当前分支”。Git 历史已经证明这个判断不成立：

- 新版壁纸入口与来源页优化始于 `159f5a46`（2026-09-01 11:00，`feat(wallpaper): add remote search and streamline source picker`），随后由 `43cc8056`、`5316d898`、`a7ae0e0a`、`ee014d48` 和 `d9a2ea49` 等提交继续完成分页位置、稳定网格、来源导航、紧凑署名与工作区精简。
- 当前审查分支于 2026-09-08 21:55 从 `feat/wallpaper-preview-polish` 创建；该基线来自 `upstream/main`，`159f5a46` 及其 UI 优化链从未成为当前分支祖先。
- 9 月 7–8 日分批 PR 只重新挑入了搜索、Provider、Grok Saved、图库、预览和生成等功能提交，没有把上述 UI 优化链映射进新分支。当前分支仍显示的四个入口按钮可追溯到 8 月 25 日的 `53a70b1c`，不是最近同步源头时才被删除。

因此，这是拆分整合遗漏，不是新出现的普通布局 bug。遗漏的用户可见契约包括：外观卡的统一“寻找壁纸”入口、按卡片宽度换行的预览布局、位于 X 搜索行内的路由选择、精简说明文案、始终可见的七来源导航、结果末尾的加载更多、分页不重排的稳定网格、原比例缩略图和紧凑来源署名。恢复时只把这些契约映射到当前重构后的组件，不整体 cherry-pick 旧分支，避免覆盖后来已经修复的请求取消、分页状态、本地媒体和 Viewer 生命周期。

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

### R5 / P1：分批 PR 漏掉已完成的壁纸界面优化链

位置：[AppearanceSection.tsx](../../src/components/settings/AppearanceSection.tsx)、[WallpaperSourceTabs.tsx](../../src/components/WallpaperSourceTabs.tsx)、[WallpaperSourceGallery.tsx](../../src/components/WallpaperSourceGallery.tsx)、`settings.part3.css` 与 `settings.part4.css`。

触发：从 `upstream/main` 基线拆分功能 PR 时，只按后端能力和组件功能挑选提交，没有建立“原计划用户可见契约”的核对清单。后续合入的功能组件继续使用旧入口和较窄弹窗，因此自动测试能证明搜索链存在，却无法证明用户此前确认过的页面仍存在。

实测：外观卡重新出现四个来源按钮，窄卡片把预览压成竖条；X 路由占据外观卡；来源弹窗只有 860px，激活末尾来源时 `scrollIntoView` 把前面的来源滚出视野；加载更多位于筛选区与结果之间，分页结果使用平衡分栏并重排旧卡；来源署名占用多行。

修复：恢复统一入口和卡片宽度换行；把路由选择收回 X 搜索行；弹窗扩展到 1440px 上限；七来源宽屏一行、窄屏分组换行且禁止程序化滚动；加载更多位于结果滚动区末尾；分页来源使用稳定网格和原始媒体比例；Provider 署名压成一行并保留可访问的精确链接。收尾对照同时恢复 Openverse 专属占位词、X 渠道保存错误、署名区标签和通用加载文案的 15 语言契约。新增组件测试和 CSS/源码契约门禁，防止功能测试再次掩盖界面链遗漏。

### R6 / P2：Responses 回退只显示总耗时，无法判断慢在哪段

位置：[wallpaper_x_search.rs](../../src-tauri/src/wallpaper_x_search.rs)、[wallpaperXSearch.ts](../../src/lib/wallpaperXSearch.ts) 及各语言 `settings-ui.ts`。

触发：选择 Responses 预览后网络失败并回退 Grok Build CLI。当前结果只显示“已回退 CLI · 84.9 秒”，无法判断是 Responses 等待过久，还是 CLI 搜索本身耗时。

归属：分段耗时曾由旧优化链的 `b9f65d6b` 实现，但拆分 PR 时只带入搜索路由和总耗时字段，没有映射 `responsesDurationMs`、`cliDurationMs` 及对应展示纯函数。

修复：Host 分别记录 Responses 与 CLI 阶段耗时，并在成功、失败、取消、缓存和追加路径上保持字段语义一致；缓存命中会清除旧阶段耗时。前端恢复统一的路由摘要、回退原因和进度映射，未知原因显示“其他原因”，不再误报为兼容协议变化。回退状态现在明确显示两段耗时和总耗时。该改动只增加观测信息，不改变搜索、缓存、回退条件或调用次数。

## 验证证据

| 检查 | 本次结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm typecheck` | 通过 |
| 修复后全量 `pnpm test` | 630 文件、7346 测试通过 |
| `pnpm lint` | 通过 |
| `pnpm build:ui` | 通过；Vite 保留大 chunk 提示，不是本次新确认缺陷 |
| `check-code-quality-gates.py --mode final` | PASS；千行文件数量 80，已到当前门禁上限 |
| `publish-website-downloads.py --self-test` | 3 项通过 |
| #1116 当前提交的 GitHub CI | frontend、Rust Windows/Linux/macOS 全通过，run 34231031103 |
| #1117 当前提交的 GitHub CI | frontend、Rust Windows/Linux/macOS 全通过，run 34233678512 |
| `cargo fmt --all -- --check` | 通过 |
| `cargo clippy --all-targets -- -D warnings` | 通过 |
| Windows manifest harness | 1837 通过、0 失败、1 忽略 |
| 直接 `cargo test` | 本机进程加载被 `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND` 阻塞，未进入断言；仓库 CI 使用的 manifest/PATH harness 可正常执行同一测试集 |
| 新增回归 | R1-R3 的 4 条原始复现和 R4 的本地 Provider 渲染测试均通过；相关定向回归 14/14 通过 |
| 桌面实测 | Windows 开发版可正常进入外观和来源弹窗；七来源完整可见，X 路由位于搜索行；Web/Openverse 可切换，Openverse 占位词正确；本地图库 118 项可显示，原先成批失败的 Pexels/Openverse 本地图片恢复；另以 1159/820/480px 三档浏览器视口确认导航与内容无横向溢出 |

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
| `159f5a46` 至 `d9a2ea49` 界面优化链 | 拆分时漏带；R5 已在审查分支按当前组件结构恢复，不能再归类为未交付 WIP |
| `b9f65d6b` 分段耗时 | 拆分时漏带；R6 已按当前 Host 与前端协议恢复，不改变搜索路由 |

相关变更的 UI 审核信息：

| PR | 页面与用户可见变化 | 风险与审核边界 |
| --- | --- | --- |
| #1116 | 外观→寻找壁纸、独立主题编辑器、全局图片/视频预览；缩略图先开，按需升级原图，失败可重试，分页期间继续浏览 | 全局 Viewer 复用面较广；R2 已修，仍需窄窗口、键盘/触摸和视频实机验收 |
| #1117 | 主题提供器、外观热更新及左下角主题菜单；悬停后点击不再反向关闭菜单，上下文身份保持稳定 | 自动回归通过；正式交付前仍需真实热更新与两个入口验证 |

两条 PR 均已由源项目合入。本次没有代替维护者创建新 PR、发布审查评论或做远端合并决定；六项修复集中为一批审查后续差异，避免继续拆成碎片 PR。

## 计划完整性与技术债

“已有代码分批送审”与“整个壁纸优化计划完成”应分开记录。当前整合不能宣称以下目标已经验收完成：

- X 自动预取下一批：当前代码在一次显式追加成功后清空 continuation；Provider/Web/Saved 的预取不能代替它。
- 原优化计划后续：视频实际尺寸与时长、目录保存失败后找回作品、可恢复删除、另存为与打开目录、批量操作、更多筛选、500 项性能和固定质量对照。开发工作区的计划仍将这些列为后续批次；本次整合没有包含相应后续完整交付。
- 原工作区中的界面优化链已经确认属于拆分遗漏并恢复；其他仅存在于开发工作区的实验、计划与未完成后续仍需逐项核对，不能再用“WIP”笼统排除，也不能未经验证直接算作已交付。
- `WallpaperSourceModal` 仍集中管理跨来源状态；本次已经补齐分页合并、请求取消和应用内删除失效规则，但长期应把共享的媒体身份与生命周期契约继续收敛，避免再靠页面级协调扩张。
- 应用内删除的失效路径已修复；如果用户直接在资源管理器中删除缓存文件，已恢复的来源历史仍缺少一次文件存在性探测，这是独立的低优先级健壮性项。
- 相册计划文档仍使用早期 Slice 1 交付表述，而 Host/UI 已经合入；验收台账需要按当前代码更新，避免后续交接误判。

未列为缺陷：隐藏 Provider 预取结束后旧 progressiveItems 自动露出的疑点，在真实 Remote hook 中会随完成清空，未得到证实；目录写失败向调用者报错有现有明确测试，本轮不将其直接归为预览损坏缺陷。

更正后的结论是：R5 与 R6 均由 Git 分支拆分漏带已完成提交造成；R1–R4 则来自分页、Viewer、跨来源历史与图库渲染分支之间的状态衔接。逐项映射旧优化链后未再发现第三条已完成的运行时契约被整体漏掉；这个判断同时依赖提交谱系、用户可见契约和回归测试，不能只看功能符号是否存在。独立优化计划及尚未覆盖的真实服务验收仍应继续。
