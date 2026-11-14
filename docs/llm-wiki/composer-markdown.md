# Markdown 输入框的粘贴规则

Markdown 档使用 TipTap；内置编辑器不受本规则影响。存储、发送、用户消息气泡继续使用既有契约，不在粘贴修复中改写。

## 实现

- `src/components/composer/tiptap/composerPaste.ts`：来源判定、块级/行内插入、粘贴后的标记状态。
- `src/lib/markdownLineStart.ts`：识别多行 Markdown 源码中的行首块级标记。
- `src/components/composer/tiptap/composerExtensions.ts`：注册插件。

## 来源判定

剪贴板同时含 HTML 和纯文本时，ProseMirror 优先解析 HTML；tiptap-markdown 的纯文本解析通常只处理行内结构。插件只接管可以判为 Markdown 源码的情况，避免把普通网页文字改成标题、列表。

| 来源 | 行为 |
|------|------|
| HTML 带 `data-pm-slice` | 交回 ProseMirror，保留编辑器自己的列表、代码块等结构 |
| `code` / `pre` 源码包壳，可含高亮 `span`，内容与纯文本一致 | 用 Markdown 扩展的 `insertContentAt` 按块解析，保留标题、围栏及代码语言 |
| 无语义包壳或无 HTML，多行且有块级标记 | 按块解析 |
| 无语义包壳或无 HTML，其他情况 | 按行内解析；单行 `# 话题`、`- 一句话` 等保持字面量 |
| 语义 HTML，如标题、列表、链接、粗体 | 交回 ProseMirror，保留 HTML 语义 |

包壳判定比较时忽略空白差异；带样式或 class 的普通 `span` 按语义 HTML 处理。源码包壳必须覆盖整份纯文本，正文中的局部行内代码不能触发接管。

行内解析若产生块级标签，或单行内容没有被行内标记完整覆盖，按字面文本插入。例如 `**测试**` 解析为粗体，`a _b_ c` 保持普通文字。多行普通段落保留中间换行。

## 标记、撤销与兼容路径

粘贴内容以粗体、斜体等标记结尾时，清空 `storedMarks`，后续输入恢复为无格式文本。插件自己的插入完成后清理；ProseMirror 处理语义 HTML 或自身 slice 后，通过带 `paste` metadata 的事务清理。

接管的粘贴使用独立历史分组，一次撤销仅回退本次粘贴，保留紧邻的先前输入。

- Shift 粘贴继续走 ProseMirror 的 `preferPlain` 路径，不接管；Shift+Insert 保持普通粘贴。
- 选区任一端在代码块内时，不接管；代码内容交给 ProseMirror 的 `inCode` 路径。
- 文件、图片、超大 Windows 文本附件和整段 URL chip 仍由 `ComposerEditorTiptap` 的前置 `editorProps.handlePaste` 处理，顺序不变。
- 不注册额外快捷键，不改 Live Voice 或 IME 的键盘路由。
- CRLF 统一为 LF；普通 Markdown 粘贴去掉首尾空行，保留中间换行及最后一行的尾随空格。文本转换钩子也作用于库的纯文本路径。

## 库边界

插件复用 tiptap-markdown 0.9.0 的 parser 和 `insertContentAt`；行内解析使用 `{ inline: true }`，随后用 ProseMirror `DOMParser.parseSlice` 插入。不要把解析后的 HTML 再交给关闭 HTML 的 Markdown parser，否则 HTML 标签会被当作正文。

Shift 状态来自 prosemirror-view 1.42.3 的内部 `view.input.shiftKey`；`lastKeyCode === 45` 是 Shift+Insert 的例外。升级库时需核对这一内部字段及原始 paste 管线。

## 验证

`composerPaste.test.ts` 覆盖真实 DOM paste 管线：浏览器 `code` 包壳标题、围栏及语言、多行块级源码、普通单行标记、语义 HTML、编辑器自身 slice、粘贴后输入、行中插入、Shift 路径和独立撤销。既有 composer、草稿、IME、文件剪贴板与 URL 测试验证相邻路径。
