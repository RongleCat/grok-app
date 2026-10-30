/**
 * @vitest-environment jsdom
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { buildComposerExtensions } from "@/components/composer/tiptap/composerExtensions";
import {
  docPosForEditorTextOffset,
  editorTextBeforePos,
  editorTextOffsetForDocPos,
  isStoredMarkdownEmpty,
  locateSlashRangeInMarkdown,
  markdownOffsetForDocPos,
  normalizeSerializedMarkdown,
} from "./composerMarkdown";

/**
 * 与 ComposerEditor 共用同一份扩展清单（`buildComposerExtensions`）。
 * 之前这里另抄了一份，新增原子节点时两边会静默漂移。
 */
function makeEditor(content: string): Editor {
  return new Editor({
    extensions: buildComposerExtensions({ showPlaceholderWhenEditable: false }),
    content,
    editable: false,
  });
}

function markdownOf(editor: {
  // tiptap-markdown augments storage at runtime; Storage type stays empty.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storage: any;
}): string {
  const raw = editor.storage?.markdown?.getMarkdown?.();
  return normalizeSerializedMarkdown(typeof raw === "string" ? raw : "");
}

describe("Markdown serialization (TipTap composer)", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("round-trips headings, bold, code blocks and lists", () => {
    // Arrange
    const source = "# Title\n\nplain **bold** text\n\n```js\nconst a = 1;\n```\n\n- one\n- two";
    // Act
    editor = makeEditor(source);
    const out = markdownOf(editor);
    // Assert
    expect(out).toBe(source);
  });

  it("段内硬换行的字面块记号在存储态被转义", () => {
    // Arrange —— Shift+Enter 换行后逐行粘进来的字面文本
    editor = makeEditor("");
    const { schema } = editor.state;
    const lines = [
      "# trending topic",
      "1. 这不是清单",
      "- 今天去超市买菜",
      "---",
      "===",
      "| a | b |",
    ];
    const children = lines.flatMap((line, i) =>
      i === 0
        ? [schema.text(line)]
        : [schema.nodes.hardBreak.create(), schema.text(line)],
    );
    editor.view.dispatch(editor.state.tr.replaceWith(1, 1, children));

    // Act
    const out = markdownOf(editor);

    // Assert —— 气泡再解析时保持字面量，不会变成标题 / 列表 / 表格
    expect(out).toBe(
      [
        "\\# trending topic",
        "1\\. 这不是清单",
        "\\- 今天去超市买菜",
        "\\---",
        "\\===",
        "\\| a | b |",
      ].join("\n"),
    );
  });

  it("代码块带上语言栏属性，且不影响 markdown 往返", () => {
    // Arrange
    const source = "```ts\nconst a = 1;\n```";

    // Act
    editor = makeEditor(source);
    const pre = editor.view.dom.querySelector("pre");

    // Assert —— CSS 用 content: attr(data-language) 渲染语言栏
    expect(pre?.getAttribute("data-language")).toBe("ts");
    expect(markdownOf(editor)).toBe(source);
  });

  it("没写语言的围栏不加语言栏属性", () => {
    // Arrange / Act
    editor = makeEditor("```\nplain\n```");
    const pre = editor.view.dom.querySelector("pre");

    // Assert
    expect(pre?.hasAttribute("data-language")).toBe(false);
  });

  it("keeps soft lines via hard breaks (breaks: true)", () => {
    // Arrange
    const source = "line1\nline2";
    // Act
    editor = makeEditor(source);
    const out = markdownOf(editor);
    // Assert：反解析后仍是两行
    expect(out).toBe(source);
  });

  it("parses legacy [[skill:name]] tokens into the doc and serializes them back", () => {
    // Arrange：旧会话 draft 格式（纯文本 + token）
    const legacy = "[[skill:review]]\n请检查这段逻辑";
    // Act
    editor = makeEditor(legacy);
    const doc = editor.state.doc;
    const tokens: Array<{ kind: string; name: string }> = [];
    doc.descendants((node: { type: { name: string }; attrs: Record<string, unknown> }) => {
      if (node.type.name === "skillToken") {
        tokens.push({
          kind: String(node.attrs.kind),
          name: String(node.attrs.name),
        });
      }
    });
    const out = markdownOf(editor);
    // Assert
    expect(tokens).toEqual([{ kind: "skill", name: "review" }]);
    expect(out).toBe(legacy);
  });

  it("round-trips plugin tokens inline with text", () => {
    // Arrange
    const stored = "before [[plugin:deploy]] after";
    // Act
    editor = makeEditor(stored);
    const out = markdownOf(editor);
    // Assert
    expect(out).toBe(stored);
  });

  it("keeps malformed token-looking text as escaped plain text", () => {
    // Arrange：名字含空格 → 不构成合法 token，按字面量保留并转义
    const stored = "look at [[skill:bro ken]]";
    // Act
    editor = makeEditor(stored);
    const out = markdownOf(editor);
    // Assert
    expect(out).toBe("look at \\[\\[skill:bro ken\\]\\]");
  });
});

describe("editor-text space mapping", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  beforeEach(() => {
    // Arrange：两段文本 + 一个 skill token
    editor = makeEditor("one two\n\n[[skill:foo]] tail");
  });

  it("maps offsets to doc positions (text and token lengths)", () => {
    // Act / Assert
    const doc = editor!.state.doc;
    // offset 0 → 首段文本起点（PM position 1：0 在首块之前）
    expect(docPosForEditorTextOffset(doc, 0)).toBe(1);
    // "one two" 末尾（7 个字符，文本起点为 1 → 终点为 8）
    expect(docPosForEditorTextOffset(doc, 7)).toBe(8);
    // token 起点在编辑器文本空间位于 "\n\n" 之后（7 + 2 = 9）
    expect(docPosForEditorTextOffset(doc, 9)).toBe(10);
    expect(docPosForEditorTextOffset(doc, 999)).toBe(doc.content.size);
  });

  it("maps doc positions back to editor-text offsets", () => {
    // Act / Assert
    const doc = editor!.state.doc;
    expect(editorTextOffsetForDocPos(doc, 1)).toBe(0);
    expect(editorTextOffsetForDocPos(doc, 8)).toBe(7);
    expect(editorTextOffsetForDocPos(doc, doc.content.size)).toBe(
      7 + 2 + "[[skill:foo]]".length + 1 + "tail".length,
    );
  });

  it("maps a caret to stored markdown, including marks the editor text drops", () => {
    editor?.destroy();
    editor = makeEditor("**bold** tail");
    const doc = editor.state.doc;
    const serialize = (node: typeof doc) => {
      const raw = (
        editor!.storage as {
          markdown?: { serializer?: { serialize?: (n: typeof doc) => string } };
        }
      ).markdown?.serializer?.serialize?.(node);
      if (typeof raw !== "string") throw new Error("serializer missing");
      return raw;
    };
    const end = doc.content.size;
    expect(markdownOffsetForDocPos(doc, end, serialize)).toBe(
      "**bold** tail".length,
    );
    expect(editorTextOffsetForDocPos(doc, end)).toBeLessThan(
      "**bold** tail".length,
    );
  });

  it("builds the caret prefix for slash detection", () => {
    // Act
    const doc = editor!.state.doc;
    const prefix = editorTextBeforePos(doc, doc.content.size);
    // Assert：token 以存储形式出现，段落间为空行
    expect(prefix).toBe("one two\n\n[[skill:foo]] tail");
  });
});

describe("normalizeSerializedMarkdown", () => {
  it("keeps defensive escapes and normalizes hard breaks", () => {
    expect(normalizeSerializedMarkdown("say \\*star\\*")).toBe("say \\*star\\*");
    expect(normalizeSerializedMarkdown("\\# trending topic")).toBe(
      "\\# trending topic",
    );
    expect(normalizeSerializedMarkdown("line1\\\nline2")).toBe("line1\nline2");
    const fenced = "```js\nconst r = /\\\\/;\n```";
    expect(normalizeSerializedMarkdown(fenced)).toBe(fenced);
    const inline = "use `const r = /\\\\/;` here";
    expect(normalizeSerializedMarkdown(inline)).toBe(inline);
    const continued = "```\na\\\nb\n```";
    expect(normalizeSerializedMarkdown(continued)).toBe(continued);
  });

  it("strips WebKit caret ghosts from the serialized draft", () => {
    // Arrange —— WebKit 可能在末尾写入 ZWSP / 对象替换符
    const raw = "hello\uFFFC\u200B";

    // Act / Assert
    expect(normalizeSerializedMarkdown(raw)).toBe("hello");
  });

  it("硬换行后的行首块级记号补转义", () => {
    // Arrange —— 序列化器只在文本块开头转义，`\\\n` 之后的行原样输出
    const raw = [
      "\\# trending topic",
      "1. 这不是清单",
      "- 今天去超市买菜",
      "> 不是引用",
      "a \\_b\\_ c",
      "## \\*\\*标题\\*\\*",
      "---",
      "===",
      "| a | b |",
    ].join("\\\n");

    // Act
    const out = normalizeSerializedMarkdown(raw);

    // Assert —— 再解析（气泡 / agent / 回退）仍是字面文本
    expect(out).toBe(
      [
        "\\# trending topic",
        "1\\. 这不是清单",
        "\\- 今天去超市买菜",
        "\\> 不是引用",
        "a \\_b\\_ c",
        "\\## \\*\\*标题\\*\\*",
        "\\---",
        "\\===",
        "\\| a | b |",
      ].join("\n"),
    );
  });

  it("硬换行后的普通文字与序号数字不受影响", () => {
    expect(normalizeSerializedMarkdown("line1\\\nline2")).toBe("line1\nline2");
    expect(normalizeSerializedMarkdown("x\\\n1.5 倍")).toBe("x\n1.5 倍");
    expect(normalizeSerializedMarkdown("x\\\n+5 元")).toBe("x\n+5 元");
  });
});

describe("locateSlashRangeInMarkdown", () => {
  it("finds the trailing slash query after whitespace", () => {
    expect(locateSlashRangeInMarkdown("do it /rev", "rev")).toEqual({
      start: 6,
      end: 10,
    });
  });

  it("finds mid-document queries only at token boundaries", () => {
    expect(locateSlashRangeInMarkdown("a /rev b", "rev")).toEqual({
      start: 2,
      end: 6,
    });
    // "a/rev"：/ 前不是空白 → 不是 slash token
    expect(locateSlashRangeInMarkdown("a/rev", "rev")).toBeNull();
  });

  it("returns null when the query is absent", () => {
    expect(locateSlashRangeInMarkdown("plain text", "rev")).toBeNull();
  });

  it("stops at the caret when the same query appears later", () => {
    const md = "/review earlier /review";
    expect(locateSlashRangeInMarkdown(md, "review", "/review".length)).toEqual({
      start: 0,
      end: 7,
    });
    expect(locateSlashRangeInMarkdown(md, "review")).toEqual({
      start: md.lastIndexOf("/review"),
      end: md.length,
    });
  });
});

describe("isStoredMarkdownEmpty", () => {
  it("treats whitespace-only drafts as empty but keeps tokens non-empty", () => {
    expect(isStoredMarkdownEmpty("")).toBe(true);
    expect(isStoredMarkdownEmpty(" \n \n")).toBe(true);
    expect(isStoredMarkdownEmpty("[[skill:a]]")).toBe(false);
    expect(isStoredMarkdownEmpty("hi")).toBe(false);
  });
});

// ── 内联引用 token 的往返与坐标 ─────────────────────────────────────

describe("reference tokens", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("round-trips a file token unchanged", () => {
    // Arrange
    const stored = "在 [[file:/repo/src/a.ts]] 中找到 xxx 逻辑";

    // Act
    editor = makeEditor(stored);

    // Assert
    expect(markdownOf(editor)).toBe(stored);
  });

  it("round-trips directory and url references", () => {
    // Arrange / Act / Assert
    editor = makeEditor("[[dir:/repo/src/components]] and [[url:https://example.com/x]]");
    expect(markdownOf(editor)).toBe(
      "[[dir:/repo/src/components]] and [[url:https://example.com/x]]",
    );
  });

  it("keeps a bracket-broken reference as escaped literal text", () => {
    // Arrange — `]` 出现在值里，无法构成 `[[kind:value]]`；按字面量保留并转义，
    // 重新解析时仍是普通文本，不会被误认成引用 token。
    const stored = "[[file:/repo/my dir/a]b.ts]]";

    // Act
    editor = makeEditor(stored);

    // Assert
    expect(markdownOf(editor)).toBe(
      "\\[\\[file:/repo/my dir/a\\]b.ts\\]\\]",
    );
  });

  it("keeps a malformed reference as escaped literal text", () => {
    // Arrange — 缺少闭合，无法构成 token，必须原样保留而不是解析成节点
    const stored = "[[file:/repo/a.ts";

    // Act
    editor = makeEditor(stored);

    // Assert
    expect(markdownOf(editor)).toBe("\\[\\[file:/repo/a.ts");
  });

  it("counts the token at its stored length in editor-text space", () => {
    // Arrange — caret 换算依赖 atom 与存储文本等长，换算错会让 slash / @ 检测漂移
    const stored = "ab [[file:/x.ts]] cd";
    editor = makeEditor(stored);

    // Act
    const beforeToken = editorTextBeforePos(editor.state.doc, 1);
    const endOfText = editorTextOffsetForDocPos(
      editor.state.doc,
      editor.state.doc.content.size,
    );
    // 往返：文本末端偏移 → PM position → 文本偏移，必须回到同一个偏移
    const docPosAtEnd = docPosForEditorTextOffset(editor.state.doc, stored.length);
    const backAgain = editorTextOffsetForDocPos(editor.state.doc, docPosAtEnd);

    // Assert
    expect(beforeToken).toBe("");
    // token 按存储形式计入（14 字符），否则末端偏移会短一截
    expect(endOfText).toBe(stored.length);
    expect(backAgain).toBe(stored.length);
  });

  it("treats a reference-only draft as non-empty", () => {
    // Arrange / Act / Assert
    expect(isStoredMarkdownEmpty("[[file:/x.ts]]")).toBe(false);
    expect(isStoredMarkdownEmpty("[[dir:/x]]")).toBe(false);
    expect(isStoredMarkdownEmpty("[[url:https://a.b]]")).toBe(false);
    expect(isStoredMarkdownEmpty("\n  \n")).toBe(true);
  });
});

describe("reference chip deletion", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  /** 找到第一个 refToken 节点的 PM position。 */
  function firstRefPos(ed: Editor): number {
    let found = -1;
    ed.state.doc.descendants((node, pos) => {
      if (found === -1 && node.type.name === "refToken") found = pos;
      return found === -1;
    });
    return found;
  }

  it("is an atomic, selectable inline node", () => {
    // Arrange — 退格整块删除依赖这两个配置；缺一就会退化成逐字编辑
    editor = makeEditor("[[file:/a.ts]]");
    const node = editor.schema.nodes.refToken;

    // Assert
    expect(node.isAtom).toBe(true);
    expect(node.spec.selectable).toBe(true);
    expect(node.isInline).toBe(true);
  });

  it("deletes the whole chip without touching the surrounding text", () => {
    // Arrange
    editor = makeEditor("在 [[file:/repo/a.ts]] 中");
    const pos = firstRefPos(editor);
    expect(pos).toBeGreaterThan(0);

    // Act
    editor.chain().setNodeSelection(pos).deleteSelection().run();

    // Assert — chip 整块消失，两侧文本原样保留
    expect(markdownOf(editor)).toBe("在  中");
    expect(firstRefPos(editor)).toBe(-1);
  });
});

// ── 回归：列表项内的换行（手工验证反馈）──────────────────────────────────────
//
// 症状：在列表里按 Shift+Enter 只插入了软换行，第二项没有编号。
// 根因：Enter 被应用绑定为「发送」，列表项里唯一可用的换行手势就是 Shift+Enter，
// 而它由 StarterKit 的 HardBreak 处理，光标仍留在同一项里。

describe("Shift+Enter inside a list item", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function listItemsOf(ed: Editor): number {
    let n = 0;
    ed.state.doc.descendants((node) => {
      if (node.type.name === "listItem") n += 1;
      return true;
    });
    return n;
  }

  function caretToEnd(ed: Editor): void {
    ed.commands.setTextSelection(ed.state.doc.content.size);
  }

  it("starts a new ordered item instead of a soft break", () => {
    // Arrange
    editor = makeEditor("1. 第一项");

    // Act
    caretToEnd(editor);
    const handled = editor.commands.keyboardShortcut("Shift-Enter");

    // Assert — 第二项要真的存在，否则用户永远写不出第二条
    expect(handled).toBe(true);
    expect(listItemsOf(editor)).toBe(2);
    expect(markdownOf(editor).startsWith("1. 第一项")).toBe(true);
  });

  it("starts a new bullet item too", () => {
    // Arrange
    editor = makeEditor("- 第一项");

    // Act
    caretToEnd(editor);
    editor.commands.keyboardShortcut("Shift-Enter");

    // Assert
    expect(listItemsOf(editor)).toBe(2);
  });

  it("keeps the hard break outside a list", () => {
    // Arrange — 列表外 Shift+Enter 仍是软换行，行为不变
    editor = makeEditor("普通段落");

    // Act
    caretToEnd(editor);
    editor.commands.keyboardShortcut("Shift-Enter");

    // Assert — 段内多出一个 hardBreak，而不是新列表项
    let hardBreaks = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "hardBreak") hardBreaks += 1;
      return true;
    });
    expect(listItemsOf(editor)).toBe(0);
    expect(hardBreaks).toBe(1);
  });
});

// ── 回归：@ 引用落点在编辑器文本空间（手工验证反馈）──────────────────────────
//
// 症状：在列表项里插入文件引用后，光标跳到行尾 / 文档末尾，而不是停在 chip 之后。
// 原因：`insertAtTokenAsRef` 的 caret 是 Markdown 源码偏移，而落点走的是编辑器
// 文本空间；列表项多出的 `- ` 让偏移整体右移，plain / list 差异由此而来。

describe("editor-text offset around a reference chip", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("round-trips offsets before and after the chip in a list item", () => {
    // Arrange — 列表项 Markdown：编辑器文本里没有 `- `，也没有末尾空格
    editor = makeEditor("- 第一个文件 [[file:/repo/a.ts]] ");
    const doc = editor.state.doc;
    const chipEnd = "第一个文件 [[file:/repo/a.ts]]".length; // 25

    // Act
    const posAtChipEnd = docPosForEditorTextOffset(doc, chipEnd);
    const posBeforeChip = docPosForEditorTextOffset(doc, 6);

    // Assert — chip 之后确实落在 chip 后，而不是文档开头或末尾
    expect(editorTextBeforePos(doc, posAtChipEnd)).toBe(
      "第一个文件 [[file:/repo/a.ts]]",
    );
    expect(editorTextOffsetForDocPos(doc, posAtChipEnd)).toBe(chipEnd);
    expect(posAtChipEnd).not.toBe(doc.content.size);
    // chip 之前的文本偏移往返一致
    expect(editorTextOffsetForDocPos(doc, posBeforeChip)).toBe(6);
    // 超过文本长度收敛到文档末端，反推得整篇编辑器文本长度
    expect(docPosForEditorTextOffset(doc, 999)).toBe(doc.content.size);
    expect(editorTextOffsetForDocPos(doc, doc.content.size)).toBe(chipEnd);
  });

  it("round-trips the chip end when the chip sits mid-sentence", () => {
    // Arrange
    editor = makeEditor("- 在 [[file:/repo/a.ts]] 里找");
    const doc = editor.state.doc;
    const chipEnd = "在 [[file:/repo/a.ts]]".length; // 21

    // Act
    const pos = docPosForEditorTextOffset(doc, chipEnd);

    // Assert — 落点在 chip 之后、后面的正文之前
    expect(editorTextBeforePos(doc, pos)).toBe("在 [[file:/repo/a.ts]]");
    expect(editorTextOffsetForDocPos(doc, pos)).toBe(chipEnd);
  });
});

// ── 回归：空白列表项换行应回到普通文本行 ────────────────────────────────────
//
// 用户反馈：新建列表项后立刻再换行，缩进还在却没有新行；再按一次才出现新项。
// 根因是空项上 splitListItem 返回 false，按键落到 HardBreak，于是该项里多了个
// 软换行；第二次按不再为空才裂出新项。

describe("Shift+Enter on an empty list item", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function structure(ed: Editor) {
    const counts = { listItem: 0, bulletList: 0, orderedList: 0, paragraph: 0, hardBreak: 0 };
    ed.state.doc.descendants((node) => {
      if (node.type.name === "listItem") counts.listItem += 1;
      if (node.type.name === "bulletList") counts.bulletList += 1;
      if (node.type.name === "orderedList") counts.orderedList += 1;
      if (node.type.name === "paragraph") counts.paragraph += 1;
      if (node.type.name === "hardBreak") counts.hardBreak += 1;
      return true;
    });
    return counts;
  }

  function caretToEnd(ed: Editor): void {
    ed.commands.setTextSelection(ed.state.doc.content.size);
  }

  it("leaves the list instead of inserting a soft break", () => {
    // Arrange — 空的无序列表项
    editor = makeEditor("- ");
    caretToEnd(editor);

    // Act
    const handled = editor.commands.keyboardShortcut("Shift-Enter");

    // Assert — 不该留下一个缩进的空项 + 软换行
    expect(handled).toBe(true);
    const s = structure(editor);
    expect(s.hardBreak).toBe(0);
    expect(s.listItem).toBe(0);
    expect(s.bulletList).toBe(0);
  });

  it("exits an ordered list the same way", () => {
    // Arrange
    editor = makeEditor("1. ");
    caretToEnd(editor);

    // Act
    editor.commands.keyboardShortcut("Shift-Enter");

    // Assert
    const s = structure(editor);
    expect(s.orderedList).toBe(0);
    expect(s.listItem).toBe(0);
  });

  it("creates a real second item when the current item has text", () => {
    // Arrange — 非空项仍应裂出下一项（既有行为）
    editor = makeEditor("- 第一项");
    caretToEnd(editor);

    // Act
    editor.commands.keyboardShortcut("Shift-Enter");

    // Assert
    expect(structure(editor).listItem).toBe(2);
  });

  it("walks the reported flow: new item, then newline on the empty item", () => {
    // Arrange — 第一项 → 换行出新项（空）
    editor = makeEditor("- 第一项");
    caretToEnd(editor);
    editor.commands.keyboardShortcut("Shift-Enter");
    expect(structure(editor).listItem).toBe(2);

    // Act — 在空白的新项上再换行
    editor.commands.keyboardShortcut("Shift-Enter");

    // Assert — 回到普通文本行：列表只剩一项，且存在列表之外的段落
    const s = structure(editor);
    expect(s.listItem).toBe(1);
    expect(s.hardBreak).toBe(0);
    expect(s.paragraph).toBeGreaterThanOrEqual(2);
    expect(markdownOf(editor)).toContain("- 第一项");
  });
});
