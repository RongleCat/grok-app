# 应用内弹窗与浮层控件（禁止系统默认样式）

**强制**：Tauri WebView 下 **`window.confirm` / `window.prompt` / `window.alert` 不可靠**（常无对话框、恒为 false、或阻塞异常）。  
用户确认、输入、危险操作 **必须** 使用应用内弹窗，禁止再引入浏览器原生对话框。

**强制（UI 控件）**：禁止依赖 **系统 / 浏览器默认** 的下拉、选择器、右键菜单外观。下拉菜单、Select、右键菜单、浮层面板 **必须** 复用项目内已完成的组件与 CSS，不得裸用原生 `<select>` / 系统菜单 / 未铺底的透明面板。

## 禁止：系统默认组件样式

产品 UI **不得** 露出 OS / WebView 默认控件观感（macOS/Windows 原生下拉、默认蓝高亮、系统字体菜单等）。新建或改动交互时：

| 需求 | **必须用** | **禁止** |
|------|------------|----------|
| 表单单选 / 设置下拉 | `Select`（`src/components/Select.tsx`）+ `.c-select` / `.c-select__menu` | 裸 `<select>`、无样式原生 option 列表 |
| Composer 芯片菜单（模型 / 权限 / 项目 / worktree） | `ComposerModelMenu` 等 + `.cmm__pop` | 自造 dropdown + 系统样式 |
| 右键 / 行操作菜单 | `ContextMenu` + `.menu-panel` + context 材质 | 浏览器默认 context menu 承载业务操作 |
| 打开位置 / 附件菜单 | `OpenLocationButton` 等既有模式 + `.open-loc-menu` / `.att-menu` | 新写一套无共享 class 的浮层 |
| 确认 / 输入 / 业务对话框 | `GlassModal` / `setAppDialog` / `.modal` | `window.confirm` / `prompt` / `alert` |
| 搜索 / 斜杠 / 自动化侧栏 | `.search-panel` / `.slash-palette` / `.auto-panel` | 临时 `div` 无面板 class |

**存量例外**：若代码里仍有少量原生 `<select>`（历史遗留），**新代码不得仿效**；改到该处时迁到 `Select` 或同区域既有菜单。

## 禁止：下拉 / 浮层面板全透明、无背景

**根因（必读）**：裸 class **`.menu-panel` 只提供布局**（圆角 / pad / 字号），**不自带背景**。只写 `className="menu-panel"` 而不挂材质类时，面板会变成 **全透明**，选项字浮在聊天 / 侧栏内容上——**明确禁止**。

### 正确材质挂载

新浮层 **必须** 至少满足其一：

1. **实心上下文菜单**（右键 / 行操作 / 位置菜单）  
   - class：`menu-panel` **且** 属于 context 族（如 `context-menu` / `ctx-menu` / `att-menu` / `open-loc-menu` / `auto-row__menu` …），或组件已包好的 `ContextMenu`。  
   - 背景：`var(--menu-context-bg)` + `var(--menu-context-border)` + `var(--menu-context-shadow)`（见 `sidebar.part3.css` / `tokens.css`）。

2. **玻璃 / 应用内 pop**（composer 芯片、Select 菜单、斜杠等）  
   - class：已在 glass 列表中的选择器（`.cmm__pop`、`.c-select__menu`、`.composer-plus`、`.slash-palette`、`.user-menu__pop`、`.search-panel`、`.modal` 等）。  
   - 背景：`var(--glass-surface)` + border + shadow（无 backdrop 时回落 solid）。

3. **区域专用已验收面板**  
   - 若既有模块已为 `.menu-panel.xxx` 写了完整 surface（如 `.sw-plus-menu`），**复用该 class**，不要另起透明壳。环境信息钉板是 `.sw-env-menu`，不是 dropdown `menu-panel`。

### 禁止写法

| 错误 | 后果 |
|------|------|
| 仅 `className="menu-panel"`，无 context / glass / 专用 surface | 全透明，文字叠在下层 |
| `background: transparent` / 未设置 background 的自定义 pop | 同上 |
| 用半透明色却无足够不透明度，导致正文穿透可读 | 层叠混乱、不可读 |
| 复制 DOM 结构却漏拷贝材质 CSS | 真机上「只有字没有板」 |

**验收**：浅色 / 深色主题下，打开任意下拉或菜单，面板底必须 **不透明或足够遮挡** 下层内容，选项行不得直接叠在聊天气泡 / 侧栏文字上。

## 禁止：内容层叠错误

浮层必须 **盖住** 正确区域，且自身不被错误裁切或穿透：

| 规则 | 做法 |
|------|------|
| **Portal 到 `document.body`** | 下拉 / 右键 / 浮层优先 `createPortal(..., document.body)`，避免被 `overflow: hidden` 父级裁切（参考 `Select`、`ContextMenu`、`useFloatingMenu`）。 |
| **定位用 floating 工具** | 优先 `useFloatingMenu` / `clampContextMenuPos`，处理视口边缘、翻转、宽度匹配；禁止写死坐标导致菜单飞出屏幕或压住错误区域。 |
| **z-index 分层** | 沿用既有档位（toast / modal / menu 各自区间）；新浮层不要随意 `z-index: 99999` 压过 modal，也不要用过低值沉到聊天层下。 |
| **点击穿透** | 面板需可接收点击；必要时 `onMouseDown={(e) => e.stopPropagation()}`（`Select` 已示范），避免点选项时被外层当作「点外部关闭」或拖动。 |
| **与原生 WebView 叠层** | 若浮层可能盖住内嵌 webview，走 `useFloatingMenu` 已接的 native cover 路径，不要手写半截遮罩。 |
| **多菜单互斥** | 同时只应有一个业务菜单打开（打开 A 关 B）；子菜单用 `ContextMenu` 的 `children` flyout，不要平行叠两个全透明兄弟面板。 |

**验收**：打开菜单时下层内容不可误点；关闭后无残留透明点击热区；与 modal 同开时 modal 仍可操作或菜单先关（与现网一致）。

## 视觉：复用现有面板样式

**不强制** 毛玻璃 / 半透明浮层。新浮层 **优先复用** 应用内已有面板样式，与邻近控件保持一致：

| 场景 | 优先样式 | 参考 |
|------|----------|------|
| Composer 芯片菜单（模型 / 权限 / 项目） | `.cmm__pop` + `.cmm__opt` / `.cmm__section` | `ComposerModelMenu`、`ComposerProjectMenu` |
| 右键 / 行操作 / 位置菜单 | 实心 `.menu-panel` + context tokens（`--menu-context-*`） | `ContextMenu`、`OpenLocationButton` |
| 表单 / 设置下拉 | `Select` + `.c-select` / `.c-select__menu` | `Select.tsx`、`AppearanceSection`、`RuntimeSection` |
| 确认 / 输入 / 业务对话框 | `.modal` · `GlassModal` · `setAppDialog` | `App.tsx`、`GlassModal` |
| 搜索 / 侧栏表单 / 斜杠 | 现有 `.search-panel` / `.auto-panel` / `.slash-palette` | 对应组件 |

布局 token（圆角、pad、item 间距）仍可用 `--menu-*` / `--modal-*`；材质以**该区域既有实现**为准，不要为「统一毛玻璃」另起一套。

**可选**：存量仍有 `.glass-surface` / `--glass-*`（部分 modal、历史浮层）。新代码不要求套用；也**不要**再写「浮层禁止不透明底」之类规则——**有底、可读、可点** 才是硬要求。

## 公共壳：`GlassModal`

业务对话框可用公共壳（名字历史遗留，不代表必须毛玻璃）：

```tsx
import { GlassModal } from "@/components/GlassModal";

<GlassModal
  open={open}
  onClose={onClose}
  title={tr("…")}
  size="sm" | "md" | "lg"   // 420 / 480 / 560
  closeLabel={tr("common.close")}
  footer={
    <>
      <button type="button" className="btn btn--ghost" onClick={onClose}>
        {tr("common.cancel")}
      </button>
      <button type="button" className="btn btn--solid" onClick={onSave}>
        {tr("common.save")}
      </button>
    </>
  }
>
  {/* 业务内容 */}
</GlassModal>
```

结构：`.overlay` → `.modal.glass-modal[--sm|--md|--lg]` → `header.modal-head` + body + `.modal-actions`。

存量也可用同一 DOM/CSS（不强制立刻迁组件）：

```html
<div class="overlay">
  <div class="modal app-dialog" role="dialog">…</div>
</div>
```

## 首选：App 级 `appDialog`（`src/App.tsx`）

工作台内主流程（项目 / 会话重命名、YOLO 二次确认等）使用：

```ts
setAppDialog({
  kind: "confirm",
  title: tr("…"),
  message: tr("…", { name }),
  confirmLabel: tr("…"), // optional
  danger: true,          // optional → 危险按钮样式
  onConfirm: () => { void doSomething(); },
});

// 或输入
setAppDialog({
  kind: "prompt",
  title: tr("…"),
  initial: current,
  placeholder: tr("…"),
  onSubmit: (value) => { void rename(value); },
});
```

- 渲染：`createPortal` → `.app-dialog-overlay` + `.modal.app-dialog`。  
- 文案：全部走 `src/i18n/`（见 [i18n.md](./i18n.md)）。  
- **禁止** 在 `onConfirm` / `onSubmit` 里再套 `window.confirm`。

## 子页面 / 独立面板

若组件拿不到 `setAppDialog`（如 `AutomationsPage`）：

1. **优先**：通过 props 回调把确认上抛到 `App`（`onRequestConfirm`），由 `appDialog` 统一处理。  
2. **可接受**：组件内用同一套 DOM/CSS 自建确认（`createPortal` + `overlay` / `modal app-dialog`），或 `GlassModal`。  
3. 参考：`AutomationsPage` 删除确认（禁止 `window.confirm`）。

## 浮层清单（改样式时勿漏）

| 类型 | 选择器 / 组件 |
|------|----------------|
| App 确认/输入 | `.modal.app-dialog` · `setAppDialog` |
| Compact keep-note / Doctor / Status / MCP | `setAppDialog` prompt · `.modal` · `GlassModal` · `DoctorModal` |
| 文件详情 | `.modal.file-path-details` |
| 搜索面板 | `.search-panel` |
| 模型 / 权限 / 项目 / 用户 / 斜杠 / + | `.cmm__pop` · `.menu-panel` · `.slash-palette` · `.composer-plus` |
| 上下文 / 附件 / 打开位置 / Select | `.ctx-menu` · `.att-menu` · `.open-loc-menu` · `.c-select__menu` |
| 自动化表单侧栏 / 行菜单 | `.auto-panel` · `.auto-row__menu` |
| Toast / 权限条 / 拖放卡 | `.app-toast` · `.perm-bar` · `.drop-overlay__card` |
| 左栏 | `.sidebar` |

## 禁止清单

| API / 模式 | 状态 |
|------------|------|
| `window.confirm(...)` | **禁止** |
| `window.prompt(...)` | **禁止** |
| `window.alert(...)` | **禁止**（用户可见错误用 toast / error banner / 应用内 dialog） |
| `confirm` / `prompt` 全局别名 | **禁止** |
| 裸 `<select>` / 系统默认下拉观感（新代码） | **禁止** — 用 `Select` 或既有 `.cmm__*` / 菜单组件 |
| 仅 `menu-panel`、无材质 class / 无 `background` | **禁止** — 全透明叠层 |
| 浮层无 portal、被父级裁切或 z-index 沉底 | **禁止** — 层叠错误 |
| 业务操作依赖浏览器默认右键菜单 | **禁止** — 用 `ContextMenu` |

存量调用发现即改（搜索 `window.confirm`、`window.prompt`、裸 `<select`、仅 `menu-panel` 无 surface）。

## 验收

- [ ] 新增删除 / 信任 / 危险开关等路径均有应用内确认，无 `window.confirm`。  
- [ ] 确认框文案中英键齐全。  
- [ ] Tauri 真机：点确认执行、点取消/遮罩关闭、无「无反应」。  
- [ ] 危险操作（删除任务、YOLO、移除项目）使用 `danger` 样式并写清后果。  
- [ ] 新浮层与同区域既有面板（`.cmm__pop` / 有材质的 `.menu-panel` / `.modal` / `Select`）观感一致。  
- [ ] **无系统默认** select / 菜单样式。  
- [ ] **无全透明** 下拉 / 右键面板（深浅主题均有可读底）。  
- [ ] **无层叠问题**：portal、z-index、点击不穿透、不误裁切。

## 相关源码

- `src/components/GlassModal.tsx` — 公共对话框壳  
- `src/components/Select.tsx` — 自定义下拉（portal + `useFloatingMenu`）  
- `src/components/ContextMenu.tsx` — 统一右键 / 行菜单  
- `src/lib/floatingMenu.ts` — 视口定位、防裁切、native webview cover  
- `src/App.tsx` — `AppDialog` 类型、`setAppDialog`、portal 渲染  
- `src/styles/tokens.css` — `--menu-*` / `--menu-context-*` / `--modal-*` / 可选 `--glass-*`  
- `src/styles/sidebar.part3.css` — glass 列表 vs 实心 context 菜单材质（**勿只挂裸 `.menu-panel`**）  
- `src/styles/app.css` — modal / menu / cmm 入口聚合  
- `src/components/ComposerModelMenu.tsx` / `ComposerProjectMenu.tsx` — composer 芯片菜单范例  
- `src/components/StatusModal.tsx` / `McpStatusModal.tsx` — GlassModal 范例（MCP 弹窗可跳转 Settings → Extensions）
- `src/components/ExtensionsPanel.tsx` — Settings → Extensions 全页技能 / MCP 管理  
- `src/components/AutomationsPage.tsx` — 子页面自建删除确认范例  
- `src/i18n/messages.ts` — `common.cancel` / `common.confirm` / `common.close` 等  
