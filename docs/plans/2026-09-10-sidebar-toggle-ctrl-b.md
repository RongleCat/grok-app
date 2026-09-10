# Ctrl+B 左侧栏展开/收起响应优化

**日期**：2026-09-10  
**基线**：`main` @ `2b43acbb`（`feat(session): show a recent-chat list while holding Ctrl+Tab (#1127)`）  
**来源**：Ctrl+B 侧栏「响应慢」诊断（快捷键本身无 debounce；慢在 host 重渲染 + in-flow `width` 插值）  
**执行位置**：worktree `D:/code/grok-app-sidebar-toggle-ctrl-b` · 分支 `perf/sidebar-toggle-ctrl-b`  
**状态**：WP-A/B/C 已实施、未开 PR、不 merge `main`（`zzzzz` 前禁止）

`.husky/post-checkout` 不存在（无 symlink 步骤）。`android/capacitor.settings.gradle` 不存在，`skip-worktree` 跳过。

---

## 1. 问题

桌面按 Ctrl+B（或顶栏 PaneToggle）展开/收起左栏，体感慢。拖分隔条跟手，说明 **不是 WebView 画不出侧栏**，是 click/shortcut 这条路径重。

对号：

| 体感 | 层 |
|------|----|
| 按下过一会儿才动 | L1 输入延迟：`setLayout` 在 `AppWorkbench` 纤维上，约 1.3 万行 / 289 hook 先跑完才提交宽度 |
| 立刻动但滑 ~1/3 秒 | L2 设计时长：`--motion-pane: 320ms` |
| 滑动掉帧 | L3 布局动画：in-flow 同时 tween `width/min-width/max-width/flex-basis`，chat 列每帧 reflow（Win WebView2 尤差） |
| 展开比收起卡 | L4 展开多 `ensureWindowFitsLayout`（连续 Tauri `isFullscreen` / `isMaximized` / `innerSize` / `scaleFactor`，不够再 `setSize`） |

快捷键路径无排队：`keydown` capture → `toggleSidebar` → `openSidebarPane` / `closeSidebarPane`。不要去改 `matchGlobalShortcut`。

---

## 2. 已落地（不要重做）

这些已经在 `main` 或平行分支里，本刀只借用，不另起炉灶：

- **窄窗 overlay**：`resolveWorkbenchPaneOverlay` — 挤不下时 `transform`，不插值 flex。
- **拖拽不走 React**：`applyLiveSplitWidth` + `.is-resizing { transition: none }`。Ctrl+B 应对齐「先改 used size、后 reconcile」。
- **底栏终端已 snap**：`perf/bottom-terminal-snap` 思路；左栏不要再给 `.bt` 加 pane motion。
- **未合并参考**（勿直接 cherry-pick 整个 AppWorkbench 大 diff）：`fix/narrow-ctrl-b-window-size` @ `35841009` 的 `windowFitWouldGrow` / `shouldFitWindowOnSidebarOpen`。窄窗 overlay 后仍应用 JS `innerWidth` 判断跳过 Tauri fit。

---

## 3. 约束（不可破）

- AGENTS.md §7：App shell + `AppWorkbench` 合计行数只降不升。禁止往 host 加 `useState` / 大功能块。新逻辑进 `useWorkbenchLayout` / `src/lib/*`。
- 新文件 <1000 行。i18n 走 `createT`；无 `window.confirm` / `prompt` / `alert`。
- **WKWebView 合同**（`src/lib/paneSplitMotion.test.ts` 锁死，改行为必须改测试并写明平台理由）：
  - `.sidebar--hidden` 禁止 `width: 0 !important`（硬切掉 transition）。
  - 禁止用 `.workbench--sidebar-motion .sidebar` 开关 `transition`（blur 层重建闪缝）。
  - in-flow Mac 侧栏禁止 `backdrop-filter`；禁止 motion 期 `contain`。
- 拖拽跟手、窄窗 overlay、右栏 overlay、phone drawer 行为不变。
- 一次一个 worktree。禁止 merge `main`，除非用户明确说。

---

## 4. 否决

| 方案 | 否决原因 |
|------|----------|
| 给 `WorkbenchSidebar` / `WorkbenchMain` 套 `memo` 当主修复 | host 仍跑 289 个 hook；host JSX 大量 inline 回调会打穿 memo |
| 全局把 `--motion-pane` 改 0 / 砍到 80ms | 掩盖 L1；Mac 硬切回潮；底栏/右栏共用 token |
| 始终 overlay、永远不把栏收回 flex | 宽窗 chat 宽度不还；与 overlay「窄窗 fallback」语义冲突 |
| motion 期 `contain: strict` / 给 in-flow 加 blur | 测试明确禁止；Mac 缝闪 |
| 把 `layout` 再抬进 `App.tsx` | 违反 growth freeze；重渲染边界只是上移一层 |
| 重写 AppWorkbench 为 LayoutProvider 当本 PR 主 diff | 正确长期方向（§7 WP-E），但和动画/fit 缠在一起无法回滚 |

---

## 5. 锁定方案

目标：**第一帧侧栏 used size 已变，且不依赖 `AppWorkbench` commit**。动画不再用 320ms flex 插值拖着 chat 列（至少 Windows）。

### WP-A — 同步 paint 接缝（和 B/C 同一提交，不单独发布）

在 `openSidebarPane` / `closeSidebarPane` 里、`setLayout` 之前：

1. `queryWorkbenchSplitPane("sidebar")`（已有）写成下一帧的 `paneSplitSizeStyle(0 | openW, "x")`。
2. `classList.toggle("sidebar--hidden" | "sidebar--collapsed", nextCollapsed)`，与 React 最终 class 一致，避免 commit 时 class 互殴 restart transition。
3. `saveLayout` 立刻写（不要等 transition 的 updater）；`setLayout` 用 `startTransition`，让 host reconcile 让出首帧。
4. **不要**在 handler 里 `beginPaneSplitMotion` 再让 `usePaneSplitMotion` 因 key 变化 `end` 掉同一个 token（会提前 `flushDeferred`，virtualizer/xterm 在动画中爆发）。Motion token 仍由 hook 在 commit 时 begin。接受最多 1 帧 RO。

单测（jsdom）：调用 close/open 后，在 `act` flush 之前断言 sidebar 节点 width/min/max/flexBasis 已是目标值。

### WP-B — 展开跳过无用 Tauri fit

纯函数（可放 `src/lib/windowFit.ts`，从 `35841009` 收回思路，不搬 AppWorkbench 旧 diff）：

- `windowFitTargetWidth(layout)` / `windowFitWouldGrow(viewportWidth, layout)`
- `openSidebarPane`：已 overlay → 不 fit（现状）；`!windowFitWouldGrow(window.innerWidth, projected)` → **不** `await ensureWindowFitsLayout`（现状：宽窗每次仍打 4 次 IPC，即使 `growWindowTo` 最终 return null）
- 真要长宽时仍走现有 `fitWindowThenClampAside`；aside 已折叠则 then 里不要第二次 `setLayout`

测试：`windowFit.test.ts` + `useWorkbenchLayout` 源码合同（`paneOverlay.test.ts` 已在读该文件）断言 `windowFitWouldGrow` / overlay 早退。

### WP-C — Windows：flex 尺寸一帧到位，内容淡出（L2/L3）

Mac 继续 in-flow width 插值（WKWebView 合同）。Windows / 无 vibrancy 平台：

```css
.platform-win .sidebar:not(.is-resizing),
.platform-linux .sidebar:not(.is-resizing) {
  /* 保留 border-color / opacity / filter；不要 width/min/max/flex-basis */
}
```

- `.sidebar__clip` 已有 `opacity` transition，收起仍淡出，避免「内容被压扁」。
- used size 一帧到位 → chat 只 reflow **一次**，不再跟 320ms。
- `.workbench--sidebar-motion .main__top { padding-left }` 可保留，只动 40px 顶栏，不带动正文。
- 覆盖测试：`paneSplitMotion.test.ts` 把「`.sidebar` 必带 width transition」改成 **默认（Mac）必带**；新增 Win 选择器 **不得** width tween。拖拽 `.is-resizing` 仍 `transition: none`。

不在本刀把 Mac 改成 snap。若后续 Mac 同样掉帧，再开独立 PR，用 overlay-during-motion（先 `transform`，`transitionend` 再 commit in-flow），不要用 `!important:0`。

### WP-D — 不在本 worktree（结构隔离，后续）

host 不再订阅 `layout.sidebarCollapsed`：抽出 `WorkbenchSplit`（sidebar+main+aside chrome）读 layout，host 只留 `layoutRef` + 动词。这是 L1 的彻底解，行数下降，符合拆解 handoff「layout/panes 先抽」。本分支不拆，避免和 CSS 合同、fit 逻辑缠成无法 revert 的大 PR。

---

## 6. 文件

| 文件 | 动作 |
|------|------|
| `src/hooks/useWorkbenchLayout.ts` | WP-A 同步 paint + `startTransition`；WP-B 早退 fit |
| `src/lib/windowFit.ts` | `windowFitTargetWidth` / `windowFitWouldGrow` |
| `src/lib/windowFit.test.ts` | grow / 不 grow |
| `src/lib/paneDragLive.ts` | 只复用 `queryWorkbenchSplitPane`，不改拖拽 |
| `src/styles/sidebar.part1.css` | WP-C Win/Linux 去掉 in-flow width tween |
| `src/lib/paneSplitMotion.test.ts` | 平台拆分合同；禁止回退 `width:0 !important` |
| `src/hooks/usePaneSplitMotion.ts` | 原则上不改 token 生命周期；若 A 误 begin 再补 no-op |
| `src/hooks/useWorkbenchLayout` 合同（overlay/split 测试里的源码断言） | 断言 fit 早退、paint 在 `setLayout` 前 |
| `CHANGELOG.md` | 一句：Win 侧栏开关不再插值宽度；展开不再对已足够宽的窗口打 fit |
| `src/app/AppWorkbench.tsx` | **不改**（toggle 已走 hook 动词） |

不新增 `useState`。不改 `src/lib/shortcuts.ts`。

---

## 7. 实施顺序

1. WP-B 函数 + 测试（无 UI，先绿）。
2. WP-A paint + `startTransition` + jsdom 断言「act 前 width 已变」。
3. WP-C CSS + 合同测试。
4. `pnpm vitest run src/lib/windowFit.test.ts src/lib/paneSplitMotion.test.ts src/lib/paneOverlay.test.ts src/hooks/usePaneSplitMotion.test.tsx`
5. 桌面手测（本机 Win）：
   - 宽窗、会话树很长、当前会话消息很多：Ctrl+B 收/开，对比拖拽。
   - 窄窗 overlay：仍滑入，不 `setSize`。
   - 右栏开着：左栏开关不把 aside 挤没、不无故长窗。
   - 分隔条拖拽仍跟手；底栏 `` Ctrl+` `` 仍 snap。

---

## 8. 成功标准

- 宽窗 Ctrl+B：侧栏 used width 在 **当前事件栈内** 已是 0 或 open px（不先等 AppWorkbench commit）。
- 宽窗且 `innerWidth >= required+16`：展开 **0 次** `getCurrentWindow` / `setSize`。
- Win：动画期间 chat 列不跟侧栏宽度逐帧插值（Performance：Layout 次数接近 1，而不是 ~20）。
- Mac：仍 width 插值；无硬切、无缝闪。
- `AppWorkbench.tsx` 行数不增。

---

## 9. 风险

- **React commit 重启 CSS transition**：乐观 style 必须与 `sidebarPaint` + hidden class 字节级一致；比较 `paneSplitSizeStyle`。
- **`startTransition` 让 class 晚到**：所以 hidden class 也在 handler 写，不能只写 width。
- **Strict Mode 双调用 updater**：persist 已从 paint 路径提出，避免双写动画；`saveLayout` 幂等。
- **Mac 回归**：WP-C 选择器用 `.platform-win` / `.platform-linux`，不要写进裸 `.sidebar`。
