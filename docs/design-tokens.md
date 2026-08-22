# Grok App · Design Tokens 草案

> 对齐 [`参考图.png`](./参考图.png)：**极深暗色、低对比分隔、克制高亮、圆角无边框壳**。  
> 亮色为同构 token 推断，禁止只改 `--bg` 漏组件。  
> 实现建议：CSS 变量（或 Tailwind theme 映射）+ `data-theme="dark|light"` 挂在 `document.documentElement`。

---

## 1. 设计原则

1. **克制**：少装饰、少渐变、少高饱和色块；信息靠层级与间距。  
2. **低噪声分隔**：用 1px 微弱边框或 4–8% 白/黑叠加，不用粗分割线。  
3. **内容优先**：对话区最亮（暗色里相对抬一层），侧栏更沉。  
4. **状态色语义唯一**：成功/警告/危险/信息各一套，明暗同语义。  
5. **组件全覆盖**：切换主题时按钮、输入、chip、列表、空状态、对话框、权限条、设置表单、滚动条、代码块、tooltip **全部**走 token。  
6. **窗口原生感**：无系统标题栏；圆角；阴影轻；mac 交通灯 / Win 自绘窗控。

---

## 2. 布局度量（与参考图骨架）

| Token | 值 | 说明 |
|-------|-----|------|
| `--radius-window` | `12px` | 主窗口圆角（Win 可略收） |
| `--radius-lg` | `10px` | 卡片、对话框 |
| `--radius-md` | `8px` | 输入框、列表行 hover 底 |
| `--radius-sm` | `6px` | chip、小按钮 |
| `--radius-full` | `9999px` | 头像、圆点状态 |
| `--space-1` … `--space-8` | `4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 px` | 间距阶梯 |
| `--sidebar-width` | `268px` | 左栏默认（可拖 200–420，与 `SIDEBAR_DEFAULT_WIDTH` 一致） |
| `--tree-rail-pad` | `10px` | 侧栏 nav / 会话列表共用左右内边距（图标列原点） |
| `--tree-l1-gutter` | `--space-5`（20px） | 一级箭头 + New session 等图标槽 |
| `--tree-l1-gutter-touch` | `44px` | 手机抽屉里只加宽 L1 箭头命中区 |
| `--tree-l2-pad` / `--tree-l2-icon` / `--tree-l2-gap` | `--space-1` / `--space-4` / `6px` | 项目行：左垫 + 文件夹图标 + 间距 |
| `--tree-text-inset` | 三者之和 | 项目名与会话标题左缘 |
| `--aside-width` | `300px` | 右栏默认（可拖 240–420；可折叠 0） |
| `--titlebar-height` | `40px` | 可拖拽顶区 |
| `--input-min-height` | `52px` | 底部输入区最小高度 |
| `--control-height` | `32px` | 工具条控件高度 |
| `--font-sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` | UI 字体 |
| `--font-mono` | `ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace` | 代码 |
| `--text-xs` / `sm` / `md` / `lg` | `12 / 13 / 14 / 16 px` | 字号 |
| `--leading-tight` / `normal` | `1.35 / 1.55` | 行高 |
| `--shadow-window` | 见主题表 | 窗口投影 |
| `--motion-fast` / `normal` | `120ms` / `200ms` | 过渡（含侧栏项目列表开合）；尊重 `prefers-reduced-motion` |
| `--motion-pane` / `--motion-pane-ease` | `320ms` / `cubic-bezier(0.22, 1, 0.36, 1)` | 左右分栏 / 底栏开合（无过冲）；设置页与工作台直接切换，不使用该 token。分栏 token **不**随 `prefers-reduced-motion` 清零 |

**栏宽持久化：** `layout.sidebarWidth` / `layout.asideWidth` / `layout.asideCollapsed` 写入 App 配置。

---

## 3. 色板 · Dark（主视觉，贴合参考图采样）

参考图主底约 `#0d0d0d`–`#151515`，几乎无彩色大面积；强调色建议 **冷灰白 + 极低饱和蓝**（行动）与 **橙色**（警告/信任/权限），避免金色与赛博霓虹。

| Token | Dark 值 | 用途 |
|-------|---------|------|
| `--bg-app` | `#0d0d0d` | 窗口最底层 |
| `--bg-sidebar` | `#101010` | 左栏 |
| `--bg-main` | `#151515` | 对话主区 |
| `--bg-aside` | `#101010` | 右栏 |
| `--bg-elevated` | `#1a1a1a` | 浮层卡片、弹出菜单 |
| `--bg-overlay` | `rgba(0,0,0,0.55)` | 模态遮罩 |
| `--bg-hover` | `rgba(255,255,255,0.05)` | 列表/按钮 hover |
| `--bg-active` | `rgba(255,255,255,0.08)` | 选中会话行 |
| `--bg-input` | `#121212` | 输入框底 |
| `--bg-code` | `#0a0a0a` | 代码块 |
| `--border-subtle` | `rgba(255,255,255,0.06)` | 默认分隔 |
| `--border-strong` | `rgba(255,255,255,0.12)` | 聚焦环外框、重要分割 |
| `--border-focus` | `rgba(140,170,255,0.55)` | focus-visible |
| `--text-primary` | `rgba(255,255,255,0.92)` | 主文 |
| `--text-secondary` | `rgba(255,255,255,0.58)` | 次文、时间戳 |
| `--text-tertiary` | `rgba(255,255,255,0.38)` | 占位、禁用 |
| `--text-inverse` | `#0d0d0d` | 浅底按钮上的字 |
| `--accent` | `#8aa4ff` | 主行动（链接、主按钮弱填充） |
| `--accent-muted` | `rgba(138,164,255,0.14)` | 主按钮浅底 / chip |
| `--accent-hover` | `#a0b6ff` | hover |
| `--success` | `#3ecf8e` | 成功、已连接 |
| `--success-muted` | `rgba(62,207,142,0.14)` | |
| `--warning` | `#f0993d` | 警告、信任、权限待批（橙，非金） |
| `--warning-muted` | `rgba(240,153,61,0.16)` | 权限条 / 信任条背景 |
| `--warning-fg` | `#1a1008` | 橙色实心按钮上的字 |
| `--danger` | `#f07178` | 错误、拒绝、关闭悬停 |
| `--danger-muted` | `rgba(240,113,120,0.14)` | |
| `--info` | `#6cb6ff` | 信息提示 |
| `--info-muted` | `rgba(108,182,255,0.14)` | |
| `--scrollbar-thumb` | `rgba(255,255,255,0.14)` | |
| `--scrollbar-track` | `transparent` | |
| `--shadow-window` | `0 16px 48px rgba(0,0,0,0.55)` | |
| `--shadow-pop` | `0 8px 28px rgba(0,0,0,0.45)` | 菜单/对话框 |

---

## 4. 色板 · Light（同构推断）

原则：侧栏略灰、主区更白；边框用黑 6–12%；强调色略降明度保证对比 ≥ WCAG AA（正文）。

| Token | Light 值 | 用途 |
|-------|----------|------|
| `--bg-app` | `#e8e8ea` | 窗口外沿/侧衬 |
| `--bg-sidebar` | `#f3f3f5` | 左栏 |
| `--bg-main` | `#fafafa` | 对话主区 |
| `--bg-aside` | `#f3f3f5` | 右栏 |
| `--bg-elevated` | `#ffffff` | 浮层 |
| `--bg-overlay` | `rgba(20,20,24,0.40)` | |
| `--bg-hover` | `rgba(0,0,0,0.04)` | |
| `--bg-active` | `rgba(0,0,0,0.07)` | |
| `--bg-input` | `#ffffff` | |
| `--bg-code` | `#f0f0f2` | |
| `--border-subtle` | `rgba(0,0,0,0.07)` | |
| `--border-strong` | `rgba(0,0,0,0.12)` | |
| `--border-focus` | `rgba(70,100,220,0.55)` | |
| `--text-primary` | `rgba(0,0,0,0.88)` | |
| `--text-secondary` | `rgba(0,0,0,0.55)` | |
| `--text-tertiary` | `rgba(0,0,0,0.36)` | |
| `--text-inverse` | `#ffffff` | |
| `--accent` | `#3d5fd9` | |
| `--accent-muted` | `rgba(61,95,217,0.10)` | |
| `--accent-hover` | `#2f4fc4` | |
| `--success` | `#1a9f63` | |
| `--success-muted` | `rgba(26,159,99,0.12)` | |
| `--warning` | `#e07020` | 橙（非金） |
| `--warning-muted` | `rgba(224,112,32,0.12)` | |
| `--warning-fg` | `#ffffff` | 橙色实心按钮上的字 |
| `--danger` | `#d13b45` | |
| `--danger-muted` | `rgba(209,59,69,0.10)` | |
| `--info` | `#2a7ed4` | |
| `--info-muted` | `rgba(42,126,212,0.10)` | |
| `--scrollbar-thumb` | `rgba(0,0,0,0.18)` | |
| `--scrollbar-track` | `transparent` | |
| `--shadow-window` | `0 12px 40px rgba(0,0,0,0.12)` | |
| `--shadow-pop` | `0 8px 24px rgba(0,0,0,0.10)` | |

---

## 5. 组件映射（禁止硬编码色值）

| 组件 | 必须使用的 token |
|------|------------------|
| 窗口壳 | `--bg-app`, `--radius-window`, `--shadow-window` |
| 顶栏 / 拖拽区 | `--bg-sidebar` 或 `--bg-app`, `--titlebar-height`, `--border-subtle` |
| 会话列表行 | `--text-*`, `--bg-hover`, `--bg-active` |
| 用户气泡 | `--bg-elevated` + `--border-subtle`（暗色可略亮一层） |
| Agent 气泡 | 透明底 + `--text-primary`；代码用 `--bg-code` |
| 权限审批条 | `--warning-muted` 底 + `--warning` 边框/图标 |
| 主按钮 | `--accent` / `--accent-muted`；文字对比达标 |
| 危险按钮 | `--danger` / `--danger-muted` |
| 输入框 | `--bg-input`, `--border-subtle`, focus → `--border-focus` |
| Chip（模型/effort） | `--bg-hover`, `--radius-sm`, `--text-secondary` |
| 对话框 | `--bg-elevated`, `--shadow-pop`, `--radius-lg` |
| 滚动条 | `--scrollbar-*`（宽 8–10px） |
| 空状态插画区 | 线框/单色 icon，`--text-tertiary` |
| 连接状态点 | 绿 `--success` / 橙 `--warning` / 红 `--danger` / 灰 tertiary |
| 代码块 | `--font-mono`, `--bg-code`, `--text-secondary` 行号 |
| 设置表单 label | `--text-secondary`；值 `--text-primary` |
| 分割线 | `1px solid var(--border-subtle)` |

---

## 6. 窗口与平台细节

### 6.1 通用

- `decorations: false`（Tauri）；自绘圆角；透明或匹配 `--bg-app`。  
- 顶部 `--titlebar-height` 区域 `data-tauri-drag-region`。  
- 双击顶栏：最大化/还原（Win/mac 习惯对齐）。  

### 6.2 macOS

- **A01 优先：** `decorations: false` 无系统标题栏（与 §6.1 一致）。  
- 在 `decorations: false` 下，系统红黄绿交通灯**不可用**（Overlay 需 decorations）；顶栏保留 ≥ `72px` 左安全区，避免内容顶边；A02 原生交通灯需后续在不破坏无边框前提下单独 spike（或平台私有 API），P0 壳阶段以无边框为准。  
- 全屏时圆角可为 0。  

### 6.3 Windows

- 自绘 min / max / close；close hover 用 `--danger`。  
- 注意 snap、DPI 缩放、最大化时圆角收为 0。  
- hit-test：按钮区不可拖，其余顶栏可拖。  

---

## 7. 动效与可访问性

| 项 | 约定 |
|----|------|
| 主题切换 | ≤200ms 交叉淡入；允许瞬时切换若用户开了 reduced-motion |
| 面板折叠 | width/opacity；不阻塞输入 |
| Focus | 所有可交互元素 `focus-visible` 使用 `--border-focus` |
| 对比度 | 正文 `primary` on `bg-main` ≥ 4.5:1 |
| 字号 | 不小于 12px；设置内可后续加「字体缩放」P1 |

---

## 8. CSS 变量挂载示例

```css
:root,
[data-theme="dark"] {
  color-scheme: dark;
  --bg-app: #0d0d0d;
  --bg-sidebar: #101010;
  --bg-main: #151515;
  /* ... 其余 dark token ... */
}

[data-theme="light"] {
  color-scheme: light;
  --bg-app: #e8e8ea;
  --bg-sidebar: #f3f3f5;
  --bg-main: #fafafa;
  /* ... 其余 light token ... */
}

html, body, #root {
  background: var(--bg-app);
  color: var(--text-primary);
  font-family: var(--font-sans);
}
```

TypeScript 侧建议 `theme.ts` 导出同一份常量，供 Canvas/图表等非 CSS 场景复用，**单一来源**。

---

## 9. 主题验收清单（与能力矩阵 A05–A06 对应）

切换暗/亮时逐项扫：

- [ ] Onboarding 三入口  
- [ ] 左栏会话列表 + 搜索 + 新建  
- [ ] 中栏消息 / 代码块 / 工具折叠  
- [ ] 权限条  
- [ ] 底栏输入 + 附件 chip  
- [ ] 右栏（展开/折叠）  
- [ ] 设置各分区表单  
- [ ] Doctor 结果  
- [ ] 模态对话框 / 下拉菜单 / Tooltip  
- [ ] 滚动条  
- [ ] 空状态  
- [ ] 错误 Toast  

任一项硬编码色值 → **FAIL**。

---

## 10. 与参考图的关系说明

| 参考图特征 | Token 落点 |
|------------|------------|
| 近黑三栏 | `--bg-sidebar` / `--bg-main` / `--bg-aside` |
| 极弱分割 | `--border-subtle` |
| 顶区 chip/状态 | chip 组件 + `--accent-muted` |
| 无边框圆角 | `--radius-window` + Tauri decorations false |
| 低饱和 | 禁止大面积高饱和装饰；强调仅用于 CTA/状态 |

功能点可裁剪，**视觉骨架与 token 层级不改**。

---

*版本：2026-07-21 · 草案，可在视觉走查后微调数值，勿改 token 命名*
