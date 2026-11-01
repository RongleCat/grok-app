# 输入框 Markdown 档（TipTap）· 粘贴与闭合记号

设置里可把输入框切到 **Markdown 档**（WYSIWYG）。存储态与发送内容始终是 Markdown
源码，编辑器里显示的是解析后的结构。这篇记录该档的粘贴规则：既让粘进来的 Markdown
源码成立，也不把普通文字改写成标题 / 列表（"闭合记号只剩字面量 / 行尾多出一条空白行"
同样在这里收口）。

## 源码

| 位置 | 作用 |
|------|------|
| `src/components/composer/tiptap/ComposerEditorTiptap.tsx` | 编辑器实例、文件 / 图片 / URL chip 的粘贴前置分支 |
| `src/components/composer/tiptap/composerExtensions.ts` | 扩展清单（内置档与 headless 测试共用） |
| `src/components/composer/tiptap/composerPaste.ts` | 粘贴归一化 + 来源判定 + 行内 / 块级插入 |
| `src/lib/markdownLineStart.ts` | 行首块级记号的识别与转义（粘贴判定与序列化共用） |
| `src/lib/composerMarkdown.ts` | 序列化归一化（防御性转义、硬换行、caret 换算） |
| `src/lib/markdownSource.ts` | 代码感知扫描、展示态还原、气泡硬换行 |

## 粘贴判定

剪贴板通常同时带 `text/html` 与 `text/plain`。ProseMirror 只要看到 `text/html`
就走 HTML 解析，而 tiptap 的 paste rule 只识别**行内**记号（`**` / `` ` `` / `~~`），
块级记号（`#` / ```` ``` ```` / `- ` / `> `）不在其中。`planPastedMarkdown()` 按
"来源像不像 Markdown 源码"决定解析粒度：

| `text/html` | `text/plain` | 粒度 | 结果 |
|-------------|--------------|------|------|
| 带 `data-pm-slice` | 任意 | `none` | 本编辑器自己的内容，交给 ProseMirror 恢复 slice（列表项、代码块不丢） |
| 只有 `code` / `pre` 包壳（可含高亮 `span`），且包壳文本与纯文本一致 | 任意 | `block` | 浏览器里复制的 Markdown 源码：标题、围栏、列表都成立 |
| 无语义包壳（`div` / `p` / `br` / 无样式 `span`）或无 HTML | 多行且含块级记号 | `block` | 按块级 Markdown 解析 |
| 同上 | 其余 | `inline` | 只解析行内记号；`# ` / `- ` / `> ` / `---` 保持字面量 |
| 带语义标签（`strong` / `h1`-`h6` / `a` / 表格 …） | 任意 | `none` | 保持 HTML 解析，链接与粗体不丢 |

判据细节：

- `data-pm-slice`：出现即认定是本编辑器写出的剪贴板。
- 源码包壳：所有标签只能是包壳 / 高亮 `span` / `code` / `pre`，且 `code` / `pre`
  的文本与纯文本完全一致（忽略空白）。页面里"正文 + 行内代码"不会命中，因为
  `code` 只覆盖片段。
- `looksLikeMarkdownBlockSource()`：至少两行，且有一行以块级记号开头（标题、围栏、
  列表、引用、表格行、分隔线、setext 下划线）。单行 `# 话题` / `- 一句话` 与普通
  句子无法区分，一律按字面量。
- 纯文本包壳：标签无语义 + 文本一致（比较时忽略一切空白，`<br>` / `<div>` 的换行
  不会造成误判）。

`inline` 档有两个退回字面量的条件：

- markdown-it 仍把单行文本提升成块（`# ` / `- ` / `> ` / `---`），插入前检测到
  块级标签就按纯文本插入；
- 单行内容没有整段被行内记号覆盖（`a _b_ c`），说明是正文而不是 Markdown 源码。

多行普通段落保留换行（`breaks: true` 下是软换行），不做块级提升。

## 用户气泡的展示

存储态与提示词保留 Markdown 源码：字面文本会被序列化器转义（`\*` / `\#` / `1\.`），
`<` `>` 写成 `&gt;` / `&lt;`。`normalizeSerializedMarkdown()` **保留**这些转义：
draft 再解析回编辑器、气泡渲染 Markdown 时都靠它区分字面文本与真实记号；
去掉转义会让字面 `#` 变成标题、字面 `*` 变成斜体。

**段内硬换行**（Shift+Enter）的行需要额外补转义：序列化器只在文本块开头把
`atBlockStart` 置为 true，`hardBreak` 序列化成 `\\\n` 之后仍属于同一段，`#` / `-` /
`1.` / `=` / `|` 不会被转义。草稿再解析时（气泡、agent、回退后的编辑器）会把这类行
当成标题 / 列表 / 分隔线 / 表格，编辑器与气泡因此显示不一致。
`normalizeSerializedMarkdown()` 对 `\\\n` 之后的行补行首转义（`\#` / `\-` / `\>` /
`1\.` / `\===` / `\|`）；记号判定与转义共用 `src/lib/markdownLineStart.ts`，围栏与
行内代码不受影响。

用户气泡与编辑器一致，按 Markdown 渲染：无 token 的消息直接走 `MarkdownChat`，
标题、粗体、围栏、列表都会渲染，转义由渲染器还原。带 skill / 引用 token 的消息
仍走纯文本 + chip 路径，文本段用 `decodeMarkdownDisplayText()` 还原转义。
折叠预览先经 `softCloseMarkdown()` 补齐被截断的记号 / 围栏。

输入框里的每个换行都是硬换行（编辑器 `breaks: true`），而 CommonMark 把段内单个
换行当软换行，HTML 里会并成一行。气泡渲染前 `hardenUserLineBreaks()` 给正文行尾补
两个空格，把这些换行变成 CommonMark 硬换行；空行不补，围栏与行内代码不动。
`hr` 在气泡里按设计隐藏（`MdHr` 返回 null）。

用户气泡与编辑器所见一致：`renderMermaid={false}` 让 ```mermaid 围栏保持代码块，
`showCodeCopy={false}` 隐藏代码块复制按钮（短代码多为手动输入，长代码来自剪贴板）。

## 粘贴后的标记状态

粘贴内容以标记结尾时（例如从浏览器复制的粗体），光标落在标记范围内，`marks()`
仍返回该标记，继续输入会一直是粗体。`trailingMarksReset()` 把 `storedMarks` 置空，
粘贴后的第一下输入回到纯文本。它从两个入口调用：

- 本扩展自己插入后立即调用（这条路径没有 `paste` meta）；
- `appendTransaction` 里对带 `meta: "paste"` 的事务调用（ProseMirror 的 HTML 回退路径）。

## 首尾换行

`normalizePastedMarkdown()` 统一 CRLF，并去掉开头 / 结尾的空行（保留最后一行自身的
尾随空格——行内粘贴时它是正文的一部分）：

- 末尾换行是剪贴板的行终止符，不是用户想要的新行。`breaks: true` 下它会被解析成
  `hardBreak`，段落末尾多出一行；光标在行尾按右方向键会走进这条看不见的空行。
- 中间换行保留——`breaks: true` 会把它还原成软换行，序列化为 `\\\n`，草稿归一化后
  是普通 `\n`。
- 纯文本粘贴路径通过 `transformPastedText` 归一化；带 HTML 的包壳路径在接管前归一化。

## 例外

- **代码块内**粘贴不接管（选区两端都在 `spec.code` 节点内）：正文按字面量交给
  ProseMirror 的 `inCode` 分支。`transformPastedText` 对所有文本粘贴生效，因此代码块
  内的 CRLF 与首尾空行仍会被归一化。
- 文件 / 图片 / 整段 URL 的粘贴由 `ComposerEditorTiptap` 的 `editorProps.handlePaste`
  先处理；插件按"view props 先于插件 props"的顺序只看剩余情况。
- 语言代码块的语言栏是装饰器（`data-language`），不参与文档模型。

## 库边界（升级注意）

| 步骤 | 使用的原生能力 |
|------|----------------|
| 纯文本归一化 | ProseMirror `transformPastedText` 钩子 |
| `block` 插入 | tiptap-markdown 重写的 `editor.commands.insertContentAt`（内部用库自己的 parser） |
| `inline` 插入 | 库 parser 的 `{ inline: true }` + ProseMirror `DOMParser.parseSlice`（与库的 `clipboardTextParser` 同一套 API） |
| 来源判定 | 本仓库策略（HTML 标签语义 + 文本一致 + 多行块级记号） |

tiptap-markdown 0.9.0（当前最新）只有 `transformPastedText` 一个粘贴开关；
`clipboardTextParser` 只在剪贴板**没有** `text/html` 时触发，且按行内解析。若以后版本
提供（例如 `preferPastedText` 或块级文本解析），删除 `composerPaste.ts` 里的接管逻辑、
改用该开关即可。

解析器缺失时 `handlePaste` 返回 `false`，退回 ProseMirror 的 HTML 解析——不会把
Markdown 源码当正文插进去。库升级若改掉这些 API，`composerPaste.test.ts` 会直接失败
（包括"行中粘贴 `code` 包壳标题必须还是标题"这条块级回归）。

## 回归

`src/components/composer/tiptap/composerPaste.test.ts` 覆盖：`code` 包壳标题 / 围栏代码、
多行块级源码、单行普通文字与 `a _b_ c` 保持字面量、编辑器自己的 `data-pm-slice` 粘回、
语义 HTML 的链接与粗体、粘贴后标记状态、尾随换行、多行中间换行、行中粘贴不拆段、
代码块内保持字面量。
