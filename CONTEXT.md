# CONTEXT — Grok App

词汇表：写作、评审、Issue 与测试命名使用这里的词。产品规则见 `docs/llm-wiki/`，决策见
`docs/adr/`。

## 输入框（Composer）

用户写消息的编辑区。两套实现并存（ADR 0004），由 `AppSettings.composerEditor` 选择：

- **内置档（legacy）** — 上游的 contenteditable：纯文本 + `<br>` + 不可编辑的 skill / plugin
  chip。默认档。
- **Markdown 档（TipTap / WYSIWYG）** — ProseMirror 文档模型，显示解析后的结构，存储态与发送
  内容始终是 Markdown 源码。

## Markdown 档的文档形态

- **硬换行（hardBreak）** — 段内换行，Shift+Enter 产生；序列化为 `\\\n`。发送前
  `normalizeSerializedMarkdown()` 会给它后面的行补行首转义。
- **草稿（draft）** — 输入框落盘 / 回读的 Markdown 源码；再解析回编辑器与用户气泡都依赖它。
- **用户气泡（user bubble）** — 聊天里用户消息，按 Markdown 渲染，转义字段还原为字面量。

## 粘贴

- **粘贴判定（paste plan）** — `block` / `inline` / `none` 三档，决定 `text/plain` 按块级
  Markdown、只按行内记号、还是交给 ProseMirror 的 HTML 解析。规则见
  `docs/llm-wiki/composer-markdown.md`。
- **纯文本粘贴（literal paste）** — 把剪贴板文本按字面量放进文档：不解析 Markdown 记号，不
  继承光标处的标记；多行按硬换行落位。与"普通粘贴"是两种手势，不是两种判定。
- **源码包壳（source wrapper）** — 浏览器把 Markdown 源码包进 `code` / `pre` 时形成的
  `text/html`；判定为 Markdown 源码的依据之一。
- **超大粘贴（huge paste）** — Windows 上超过阈值的长文本改挂 `.txt` 附件，避免编辑器卡死。

## 相关

- 引用 token（ref token）、skill token：见 ADR 0003 与 `docs/llm-wiki/composer-markdown.md`。
