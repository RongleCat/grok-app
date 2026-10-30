# Spec — Markdown 档纯文本粘贴（⌥⇧⌘V / Ctrl+Alt+V）

- 日期：2026-10-30
- 关联：ADR 0006、`docs/llm-wiki/composer-markdown.md`、上游 #1397 / PR #1398（普通粘贴的解析规则）

## Problem Statement

Markdown 档（TipTap）为了"粘贴的 Markdown 源码要成立"，会把剪贴板里看起来像源码的内容解析成
标题、列表、围栏。用户复制一段**要被当成文本**的内容时就失去了控制：粘贴 `**测试**` 得到粗体，
粘贴 `## 标题` 得到标题，粘贴 `- 项` 得到列表项；粘贴后继续输入还会继承粗体。

现在没有任何"按字面量粘贴"的手势，用户只能先粘贴、再逐段改回纯文本。

## Solution

Markdown 档新增一个纯文本粘贴手势：

- macOS：`⌥⇧⌘V`（系统的"粘贴并匹配样式"键）
- Windows / Linux：`Ctrl+Alt+V`

按下后，剪贴板文本按字面量插入当前选区：Markdown 记号不解析，光标处的标记不继承，多行按硬换行
落位（与 Shift+Enter 一致），撤销一步回到粘贴前。代码块内行为保持原样，Windows 上的超大文本仍
走 `.txt` 附件分支。

内置档（legacy）本来就把剪贴板当纯文本插入，因此这一手势在那一档是空操作。

## User Stories

1. As a macOS user, I want `⌥⇧⌘V` to paste the clipboard literally, so that a Markdown example stays text.
2. As a Windows or Linux user, I want `Ctrl+Alt+V` to do the same, so that the gesture exists on my platform.
3. As a user pasting `**测试**`, I want the asterisks kept, so that the content reads as written.
4. As a user pasting `## 标题`, I want the two hashes kept, so that a heading line stays literal.
5. As a user pasting `- 项`, I want the dash kept, so that a bullet example does not become a list item.
6. As a user who keeps typing after a literal paste, I want plain text, so that no bold or italic leaks from the pasted markers.
7. As a user pasting several lines, I want the line breaks preserved as hard breaks, so that the layout matches the source.
8. As a user pasting text with a selection active, I want the selection replaced in one step.
9. As a user who mispastes, I want one undo to restore the document before the paste.
10. As a user inside a code block, I want the gesture to behave exactly like a normal paste, so that nothing changes in the code path.
11. As a Windows user pasting an enormous string, I want it attached as a `.txt` file, so that the editor does not freeze.
12. As a user with an empty clipboard, I want nothing to happen.
13. As a user pasting a lone URL literally, I want it as text, so that no inline URL chip appears.
14. As a user who switched to the built-in editor, I want normal paste behavior unchanged.
15. As a user who reloads the draft, I want the literal text to come back unchanged, so that the editor and the user bubble agree.
16. As a user pressing the chord outside the composer, I want no effect, so that other fields and panels are untouched.
17. As a user pasting text that ends with a trailing newline, I want the clipboard terminator dropped, so that no empty line appears.
18. As a user pasting blank lines between paragraphs, I want the blank lines kept as blank lines, so that the paste is faithful.

## Implementation Decisions

### Gesture and trigger

- The gesture is owned by the Markdown composer extension, not by the native menu or the app-wide
  shortcut catalog. Reason and rejected alternatives: ADR 0006.
- Platform chord selection is a pure helper (`⌥⇧⌘V` on macOS, `Ctrl+Alt+V` elsewhere) so it can be
  unit-tested without an editor.
- The handler answers synchronously so the keydown is consumed; the clipboard read is asynchronous.
- The chord must not be added to `GLOBAL_MOD_SHORTCUT_IDS`, and must not collide with Live Voice
  (`⌘⇧V` / `Ctrl+Shift+V`).

### Clipboard access

- Reuse the existing `clipboard_read_text` command through `clipboardReadText()`; it already returns an
  empty string on non-Tauri hosts and on failures.
- The reader is injected into the composer extension options so headless tests can supply a fake; the
  production wiring uses the IPC-backed reader.

### Insertion

- One transaction replaces the selection, inserts the literal content, and clears `storedMarks`, so
  undo is a single step and typing after the paste is plain.
- Normalization matches normal paste: CRLF becomes LF, leading and trailing blank lines are dropped
  (a trailing newline is the clipboard terminator), whitespace-only input is a no-op.
- Outside code blocks, lines are joined with `hardBreak` nodes. Inside code blocks, the text is inserted
  as one text node containing `\n`, because `code_block` has no inline `hardBreak` slot and renders
  newlines itself.
- The literal path inserts plain text nodes only: no marks, no ref/URL chip, no Markdown parsing.
- Windows oversized pastes keep using the existing spill threshold and `.txt` attachment path; the
  spill callback is injected from the component that already owns the attachment handler.
- The existing `transformPastedText` normalization and the normal `⌘V` plan are untouched.

### Documentation

- `docs/llm-wiki/composer-markdown.md` gains one row in the decision table (gesture → literal) and a
  short section on the chord, the hard-break shape, and the code-block exception.
- ADR 0006 records why the native menu item was rejected; `CONTEXT.md` defines "literal paste".

## Testing Decisions

A good test here drives the real editor through the real key event and asserts external behavior:
the document text and node types, the marks on the following input, the serialized draft, and the undo
stack. It should not assert internal helper call order.

**Seams (please confirm):**

1. **Headless editor seam (existing)** — `buildComposerExtensions()` + a real `KeyboardEvent` dispatched
   on the editor DOM, the same seam `composerPaste.test.ts` uses for real paste events. This covers the
   chord → clipboard → insert path end to end, with a fake clipboard reader injected through extension
   options.
2. **Pure helper seam (new, tiny)** — the platform → chord mapping, tested directly.
3. **Component wiring seam** — covered by one assertion that the production extension options pass the
   attachment spill callback; no new React-level test unless wiring proves non-trivial.

**Cases:**

- Literal insert of `**测试**`, `## 标题`, `- 项` — text preserved, no marks on the following character.
- Multi-line paste — hard-break nodes between lines; blank line preserved as an empty line.
- Selection replacement — one transaction, one undo restores the previous document.
- Code block — normal literal insert with `\n`, no `hardBreak`.
- Empty / whitespace-only clipboard — no transaction, no undo entry.
- Oversized text on Windows — spill callback receives a `.txt` file, editor untouched.
- Serialization — `getMarkdown()` plus the normalizing step keeps the pasted markers escaped so the
  draft and the user bubble show the same literal text.

Prior art: `src/components/composer/tiptap/composerPaste.test.ts` (real paste dispatch, mark-state and
serialization assertions).

## Out of Scope

- A native **Edit → Paste as Plain Text** menu item and its 16-locale label.
- A row in Settings → Keyboard / the shortcut catalog.
- Any change to the built-in (legacy) editor, which already inserts clipboard text literally.
- Changes to the normal-paste decision table (`block` / `inline` / `none`) shipped by PR #1398.
- Rich-text / HTML stripping in the legacy editor.
- Mobile / non-desktop platforms.

## Further Notes

- Serialization already escapes block markers at line starts, including lines after `\\\n`
  (`normalizeSerializedMarkdown()`); the literal path relies on that, so the draft and the user bubble
  keep showing text instead of headings.
- The chord is intentionally the macOS "Paste and Match Style" combination. It is free in this app:
  the shortcut matcher rejects Alt chords unless the user remaps one.
- If a native menu item is added later, only one surface may bind the chord; a menu accelerator plus a
  webview keydown produces a double paste (see ADR 0006 references).
