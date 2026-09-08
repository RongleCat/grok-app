# 壁纸 PR 批次整合审查

日期：2026-09-08。结论：发现 **3 个 P2 问题**，以 **4 条确定性测试**复现。现有测试及 CI 通过，但没有覆盖这些交互时序。建议先修复问题，再将整合版本作为完整体验交付。

## 整合基线与范围

- 源项目 `RongleCat/grok-app` 的 `main`：`5bd68ace1b73d9d7a99c0426b898172a6f93f201`；审查结束前再次查询，未变化。
- 已获取源项目和 fork 更新，在独立分支 `review/wallpaper-pr-batch-20260908` 整合，代码提交为 `e64b881c14260a5da77de425f2959ab2eecb06c1`。
- 整合包含源头已经合入的批次，以及 #1116 `db5b7798`、#1117 `3bf99982`，无合并冲突。
- 保留原开发工作区及其他任务的未提交修改。没有在 GitHub 合并、关闭 PR 或发布审查评论。
- 审查按功能链路覆盖：X/Responses 的取消和追加、独立图片来源与预取、Grok Saved 隔离桥接、原图预览、收藏与本地目录、来源历史、生成与结果审计、主题上下文与菜单。
- 本次是代码、契约和自动化整合审查；没有重新运行七来源真实登录、远端搜索和实际生成的完整桌面验收。

## 确认的问题

### R1 / P2：加载更多覆盖期间完成的收藏和本地路径

位置：[useWallpaperProviderController.ts](../../src/hooks/useWallpaperProviderController.ts#L375)，快照建立于第 320 行，覆盖发生在第 375–376 行。

触发：Web、Openverse 或 Pexels 已有结果，点击加载更多，在等待下一页时收藏一张现有图片或完成原图下载，最后分页返回。控制器在请求开始时保存 `initialItems`，完成时用这份旧快照覆盖当前列表。

实测：分页前 `favorite=false`；等待期间已改为 `favorite=true` 并写入 `localPath`；分页完成后重新变成 `favorite=false`，路径丢失。目录本身仍保存正确值，但 UI 会显示错误收藏状态；再次点击可能重复收藏。旧条目已有 metadata 时，目录补全 hook 不会重新查询来纠正它。

归属：#1097 的 Provider 分页/预取实现，与 #1115 的收藏和来源恢复集成后暴露。#1116 进一步明确翻页期间卡片可交互。

修复方向：用最新列表进行函数式追加，保留已有条目的收藏、metadata 和 localPath；统计文案也从同一份合并结果计算。当前本地库分页已有类似的保留本地修改处理，可统一契约。

### R2 / P2：关闭预览不取消原图，新预览等待旧下载

位置：[ImageViewer.tsx](../../src/components/ImageViewer.tsx#L99)，并发限制在第 241 行；配套回调见 [useWallpaperItemPreview.ts](../../src/hooks/useWallpaperItemPreview.ts#L220)。

触发：打开两个尚未完成的远程原图，关闭预览，再打开另一张图片。`close()` 只清空去重集合和等待项、更新内部代次，没有取消已经启动的 Host 请求；`activeOriginalLoadsRef` 只能等旧任务结束后递减。

实测：新预览缩略图已经显示，但新的原图 loader 调用次数仍为 0；只有旧下载返回后才开始。真实 Lightbox 与壁纸弹窗集成测试进一步确认：点击 Close 后，Host 的单项取消和全部取消接口调用次数都为 0。

同一来源下关闭 Viewer 也不会使壁纸回调的 `sourceGenerationRef` 失效，所以旧下载仍可写回卡片路径/metadata。Viewer 内部拒收旧 slide，并不等于 Host 取消或调用方状态隔离。

归属：#1116 的懒加载原图和统一 Viewer；影响发现来源和 Grok Saved 预览。全局 Viewer 是共享组件，应同时回归聊天图片、独立主题编辑器入口。

修复方向：原图任务持有可取消的请求标识/AbortSignal，关闭或替换画廊时取消对应任务并使调用方副作用失效。不要仅清零计数，否则旧请求仍运行，新请求可能突破总并发限制；也不宜取消无关的收藏下载或生成源图任务。

### R3 / P2：删除本地缓存后，其他来源历史仍使用失效路径

位置：[WallpaperSourceModal.tsx](../../src/components/WallpaperSourceModal.tsx#L744)；来源恢复见第 552 行；本地路径直接返回见 [wallpaperSourceMedia.ts](../../src/lib/wallpaperSourceMedia.ts#L40)。

触发：搜索来源中的图片已经下载或收藏，在本地库删除该文件，随后切回原来源并预览、应用或用作视频源图。删除回调只更新本地库和当前列表，没有按 localPath 清理其他来源历史中的同一文件引用。

实测：删除成功并从本地库消失后，切回 Web 仍恢复旧 localPath；再次打开预览不会调用远程下载接口。`ensureLocalWallpaperMedia` 直接接受这条已失效路径，后续媒体读取会失败，也没有退回仍然有效的远程 URL。

归属：#1115 的来源历史、收藏/目录与原有本地删除操作的集成缺口。

修复方向：成功删除后，按文件身份同步失效所有来源历史、选中项和生成源图引用；远程卡片可清除 localPath/metadata 后重新下载，本地独有卡片应移除。恢复历史时也需要处理文件被外部删除的情况。

## 验证证据

| 检查 | 本次结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm typecheck` | 通过 |
| 原有全量 `pnpm test` | 625 文件、7312 测试通过 |
| `pnpm lint` | 通过 |
| `pnpm build:ui` | 通过；Vite 保留大 chunk 提示，不是本次新确认缺陷 |
| `check-code-quality-gates.py --mode final` | PASS；千行文件数量 80，已到当前门禁上限 |
| `publish-website-downloads.py --self-test` | 3 项通过 |
| #1116 当前提交的 GitHub CI | frontend、Rust Windows/Linux/macOS 全通过，run 34231031103 |
| #1117 当前提交的 GitHub CI | frontend、Rust Windows/Linux/macOS 全通过，run 34233678512 |
| Rust 整合树 | 与 upstream/main 完全相同：`3d7628113bf7143116d33041a005ac37f7790f76`；本次未重跑 Rust 编译测试，采用上述同代码 CI 证据 |
| 新增问题复现 | 4 条测试到达断言并失败；对应 3 个问题，不是加载环境失败 |
| 复现补丁类型检查 | 应用四项复现测试后 `pnpm typecheck` 通过 |
| 测试补丁回滚后 | 产品源码和原有测试与整合提交无差异 |

复现补丁：[regressions.patch](evidence/wallpaper-pr-review-20260908/regressions.patch)。结果摘录：[results.txt](evidence/wallpaper-pr-review-20260908/results.txt)。补丁只新增测试及相关 fixture，不修改产品实现，也不把预期失败包装成通过。

在干净的整合分支根目录执行以下步骤，可重现四项失败。先检查补丁，再应用；运行结束后反向应用恢复测试文件。

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
| #1093–#1099 凭据、Provider、Web 与预取 | 已合入；R1 需要修复 |
| #1102–#1103 Grok Saved | 已合入；R2 影响其统一原图预览 |
| #1104–#1106 本地目录与分页 | 已合入；本地库自身分页已保留并发收藏修改 |
| #1108–#1111 | 原 PR 已关闭，内容由已合入的 #1115 承接；不是以关闭状态判断内容丢失。R1/R3 属于与这部分能力集成后的问题 |
| #1112 Windows CI 工具路径 | 已合入，当前 Windows CI 通过 |
| #1116 `feat(wallpaper): 统一媒体预览并按需加载原图` | OPEN，CI 4/4；建议先修 R2，再验收预览交互 |
| #1117 `fix(frontend): 修复外观热更新卡顿与主题菜单竞态` | OPEN，CI 4/4；本轮没有发现该补丁独有的新缺陷 |

开放 PR 的 UI 审核信息：

| PR | 页面与用户可见变化 | 风险与审核边界 |
| --- | --- | --- |
| #1116 | 外观→寻找壁纸、独立主题编辑器、全局图片/视频预览；缩略图先开，按需升级原图，失败可重试，分页期间继续浏览 | 全局 Viewer 复用面较广；R2 未修，仍需窄窗口、键盘/触摸和视频实机验收 |
| #1117 | 主题提供器、外观热更新及左下角主题菜单；悬停后点击不再反向关闭菜单，上下文身份保持稳定 | 自动回归通过；正式交付前仍需真实热更新与两个入口验证 |

两条 PR 的 hold 提示在描述中；未将其描述为已设置 GitHub 标签。本次没有代替维护者做远端合并决定。

建议修复粒度：R1 与 R3 合并成一批“媒体状态一致性”修复；R2 在 #1116 上补齐取消生命周期。不要再为每个小测试拆一个 PR。

## 计划完整性与技术债

“已有代码分批送审”与“整个壁纸优化计划完成”应分开记录。当前整合不能宣称以下目标已经验收完成：

- X 自动预取下一批：当前代码在一次显式追加成功后清空 continuation；Provider/Web/Saved 的预取不能代替它。
- 原优化计划后续：视频实际尺寸与时长、目录保存失败后找回作品、可恢复删除、另存为与打开目录、批量操作、更多筛选、500 项性能和固定质量对照。开发工作区的计划仍将这些列为后续批次；本次整合没有包含相应后续完整交付。
- 原工作区保留的三个 UI WIP 以及独立优化任务需单独核对和验收，不能把“未进入本批”写成“丢码”，也不能直接当作已交付。
- `WallpaperSourceModal` 仍集中管理跨来源状态；多个 hook 各自维护代次、取消和文件引用，R1–R3 表明它们之间缺少共同的失效规则。应随上述修复收敛，而不是另起大规模重写。
- 相册计划文档仍使用早期 Slice 1 交付表述，而 Host/UI 已经合入；验收台账需要按当前代码更新，避免后续交接误判。

未列为缺陷：隐藏 Provider 预取结束后旧 progressiveItems 自动露出的疑点，在真实 Remote hook 中会随完成清空，未得到证实；目录写失败向调用者报错有现有明确测试，本轮不将其直接归为预览损坏缺陷。

没有证据把上述问题归因于 Git 拆分把文件丢了。确认的问题来自分页、Viewer 与跨来源历史之间的生命周期/状态衔接；独立优化计划和实机验收仍应继续。
