# GlassModal 遮盖内置浏览器原生层设计

## 问题

打开内置浏览器侧栏后，再打开会话队列的消息编辑弹窗，浏览器页面会盖在弹窗和背景遮罩之上。弹窗右半部分被浏览器遮住，用户无法查看或操作其中的控件。

复现步骤：

1. 打开一个会话，并保持右侧的内置浏览器可见。
2. 向当前会话的发送队列添加一条消息。
3. 点击该队列消息的“编辑”。
4. 可以看到浏览器页面覆盖了弹窗及其背景遮罩。

## 根因

`QueueEditModal` 通过公共组件 `GlassModal` 渲染。该弹窗已经正确 Portal 到 `document.body`，并使用了项目约定的弹窗 `z-index`，但内置浏览器实际是 Tauri 创建的原生子 WebView。原生子 WebView 绘制在主 DOM WebView 之上，因此无论把 DOM 弹窗的 CSS `z-index` 调到多高，都无法盖住它。

项目已有解决该边界问题的 `nativeWebviewCover` 引用计数协议。`EmbeddedBrowser` 订阅该协议：只要存在 cover token，就临时隐藏原生浏览器表面。浮动菜单、设置页导航、面板动画以及 `ThemeEditorModal` 已经使用这套协议；公共 `GlassModal` 尚未接入，因此所有标准 `GlassModal` 弹窗都可能遇到同类遮挡问题。

## 需求

- 每个处于打开状态的 `GlassModal` 必须申请一个原生 WebView cover token。
- 弹窗关闭或卸载时，必须准确释放自己申请的 token。
- 多个弹窗同时存在时，必须等最后一个弹窗释放 token 后才能恢复浏览器。
- 弹窗打开和关闭期间必须保留内置浏览器实例、URL、历史记录和页面状态，只改变原生表面的可见性。
- 现有焦点陷阱、Escape 关闭、点击遮罩关闭、Portal、样式和 `GlassModal` 公共 props 必须保持不变。
- 队列编辑弹窗必须通过公共 `GlassModal` 自动获得该行为，不能增加队列专用补丁。
- 不得向 `App.tsx` 或 `AppWorkbench.tsx` 添加新状态。
- 本次不需要新增任何用户可见文案或 i18n key。

## 设计

在 `GlassModal` 中增加一个与现有焦点管理 effect 生命周期一致的 `useEffect`：

1. `open` 为 `false` 时不做任何处理。
2. `open` 变为 `true` 时调用 `acquireNativeWebviewCover()`。
3. 将幂等的 release 函数直接作为 effect cleanup 返回。

`nativeWebviewCover` 已经负责引用计数和事件分发。`EmbeddedBrowser` 已经会在 cover 生效时调用 `hide()`，并在 cover 深度归零后通过既有可见性同步逻辑恢复同一个 WebView。因此无需修改 CSS、浏览器命令或队列状态。

该逻辑应该放在 `GlassModal`，而不是 `QueueEditModal`。真正需要维护的不变量是“DOM 弹窗必须能够显示在原生子 WebView 之上”，`GlassModal` 才是负责这一公共不变量的正确边界。

## 已考虑方案

### 仅处理队列弹窗

在 `QueueEditModal` 内申请 cover token。它能修复本次报告的路径，但其他 `GlassModal` 仍会遇到同类问题，而且会把底层原生层知识复制到业务组件中。因此不采用。

### 提高弹窗 z-index

把 `.overlay` 的层级调到浏览器之上。原生子 WebView 不参与 DOM 的 stacking context，这种修改无法修复问题。因此不采用。

### 全局观察弹窗 DOM

通过 MutationObserver 或全局 overlay 注册表推断何时隐藏原生表面。这会引入时序竞争，并把行为绑定到 CSS class 约定。直接使用组件生命周期更简单、明确且可预测。因此不采用。

## 测试策略

为 `QueueEditModal` 新增 jsdom 组件测试。测试使用用户实际触发的队列编辑入口，同时验证公共 cover 协议：

- 队列弹窗关闭时，cover 深度保持为零；
- 打开队列弹窗时，会申请一个 cover token；
- 关闭或卸载弹窗时，会释放该 token；
- 同时打开两个队列弹窗时会分别增加深度，关闭其中一个不能提前恢复浏览器。

在修改生产代码之前，新增的回归测试必须先在当前上游实现上按预期失败。现有 `nativeWebviewCover` 单元测试继续负责验证幂等引用计数和订阅事件。

实现后的验证范围：

- 新增的队列弹窗回归测试；
- 现有原生 cover 和弹窗组件测试；
- 完整 Vitest 测试套件；
- TypeScript 类型检查；
- ESLint 零警告检查；
- UI 生产构建；
- Tauri 真机验证：打开内置浏览器后，背景遮罩覆盖整个工作台，队列编辑弹窗完整可见且可操作；关闭弹窗后，浏览器恢复到原页面，页面状态不丢失。

## 非目标

- 不把内置浏览器重构为 iframe。
- 不在弹窗打开和关闭时销毁或重建浏览器 WebView。
- 不修改弹窗外观、尺寸、文案或键盘行为。
- 不顺带重构未使用 `GlassModal` 的其他临时浮层。
- 不修改原生 cover 协议及其引用计数实现。
