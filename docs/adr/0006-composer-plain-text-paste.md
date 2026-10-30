# ADR 0006 — Markdown 档的纯文本粘贴走编辑器快捷键，不建原生菜单项

- 状态：已采纳
- 日期：2026-10-30
- 关联：ADR 0002（编辑器内核）、ADR 0004（双实现并存）、`docs/llm-wiki/composer-markdown.md`

## 背景

Markdown 档会把看起来像 Markdown 源码的剪贴板内容解析成标题 / 列表 / 围栏。用户需要一个
"按字面量粘贴"的覆盖手势，例如粘贴 `## 标题` 时保留两个井号。

交接稿提出的手势是 `⇧⌘V`（当作 macOS 的 Paste and Match Style）。核对后三处都不成立：

1. **`⇧⌘V` 已被占用。** `src/lib/shortcuts.ts` 把 `⌘ ⇧ V` / `Ctrl Shift V` 给了
   **实时语音（liveVoice）**，且它属于 `GLOBAL_MOD_SHORTCUT_IDS`，在输入框聚焦时同样生效。
2. **macOS 的标准键是 `⌥⇧⌘V`。** Safari 与 WKWebView 没有 `⇧⌘V` 这个粘贴手势；按下它不会
   派发 `paste` 事件（ProseMirror issue #1304，2022-08-02；同帖引用
   apple.stackexchange.com/questions/444228）。Tauri 在 macOS 上用 WKWebView。
3. **Tauri 没有预定义的"Paste and Match Style"。** `tauri::menu::PredefinedMenuItem` 只有
   `paste`（docs.rs/tauri 2.9.5）；muda 的对应请求 `tauri-apps/muda#83` 仍未实现。要做菜单项
   就得自建 item、自己读剪贴板，并为 16 个 locale 补菜单标签（原生菜单不能读前端 catalog，
   见 `src-tauri/src/tray_i18n.rs`）。

WebView 侧还有一条限制：原生菜单项命中快捷键后不会再向页面派发 `paste` 事件，前端只剩两条路
——由 Rust 读剪贴板后经 IPC 下发，或由前端在 keydown 里读剪贴板。两者都要绕开 paste 管线自带
的大文本挂附件与代码块判断。

## 决策

1. **手势**：macOS 用 `⌥⇧⌘V`（系统标准的无格式粘贴键），Windows / Linux 用 `Ctrl+Alt+V`。
   两者都不在快捷键目录里（目录默认拒绝 Alt 组合），也不与 WebView 的原生粘贴重叠。
2. **只做编辑器内快捷键**，不加原生菜单项、不加快捷键目录行。理由：本次只服务 Markdown 档，
   菜单项会额外引入 Rust 事件通道与 16 个 locale 的原生标签；快捷键落在编辑器扩展里，可以
   直接复用 headless 编辑器测试。
3. **剪贴板读取**复用现有 `clipboard_read_text` 命令（`src/lib/api/fs.ts` 的
   `clipboardReadText()`）。WebView 的 `navigator.clipboard` 在 Linux 上经常为空，这是仓库
   已有的结论。
4. **文档形态**：多行按行插入 `hardBreak`，与 Shift+Enter 的编辑模型一致，序列化为 `\\\n`
   后由 `normalizeSerializedMarkdown()` 统一补行首转义。代码块内改为插入含 `\n` 的单个文本
   节点——代码块不允许 `hardBreak`，而 `whitespace: "pre"` 会原样渲染换行。
5. **一次事务**：替换选区、插入内容、清空 `storedMarks` 合并进同一个 transaction，撤销一步回到
   粘贴前。
6. **超大文本**沿用 `shouldSpillHugePlainText()` + `hugePlainTextToFile()`：与 `⌘V` 的
   Windows 分支一致，改挂 `.txt` 附件。

## 后果

- 快捷键不可发现。`docs/llm-wiki/composer-markdown.md` 记录判定表与手势；等确有需求再补菜单项。
- 若以后补原生菜单项，**只能有一个入口绑定该组合键**。Electron 生态出现过菜单 accelerator 与
  Chromium 原生粘贴叠加、导致粘贴两次的事故（pingdotgg/t3code#11955）：accelerator 命中时
  必须让菜单项独占用该键。
- 内置档（legacy）本来就把剪贴板当纯文本插入，所以本手势在那一档是空操作，行为不变。

## 参考

- ProseMirror issue #1304 — Command-Shift-V doesn't work on Safari（2022-08-02）。
- Apple StackExchange 444228 — Cmd+Shift+V not working in Safari。
- tauri-apps/muda#83 — More native menu items（Paste and Match Style 仍未提供）。
- docs.rs/tauri 2.9.5 — `PredefinedMenuItem` 与 `MenuItem::set_accelerator`。
