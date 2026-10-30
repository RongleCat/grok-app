/**
 * @vitest-environment jsdom
 *
 * 纯文本粘贴手势回归：
 * - 和弦按平台区分（macOS ⌥⇧⌘V、其他 Ctrl+Alt+V），物理键识别；
 * - 剪贴板文本按字面量插入：不解析 Markdown、不带标记、多行按硬换行；
 * - 代码块、空剪贴板、超大文本、异步期间的文档 / 光标变化各有分支；
 * - Shift+粘贴交回 ProseMirror 的纯文本路径。
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import type { Content } from "@tiptap/react";
import { normalizeSerializedMarkdown } from "@/lib/composerMarkdown";
import { LONG_ASSISTANT_SPILL_CHARS } from "@/lib/longAssistantSpill";
import { isPlainTextPasteKey } from "@/components/composer/tiptap/composerPaste";
import type { ComposerPasteOptions } from "@/components/composer/tiptap/composerPaste";
import {
  blockTypes,
  caretAtEnd,
  createComposerEditor,
  dispatchPaste,
  dispatchRealPaste,
  hasHardBreak,
  markdownOf,
  pressPlainPaste,
  setShiftPaste,
} from "@/components/composer/tiptap/composerPasteTestUtils";

let editor: Editor | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  host?.remove();
  host = null;
});

function makeEditor(content: Content = ""): Editor {
  const created = createComposerEditor({ content });
  host = created.host;
  return created.editor;
}

/** 纯文本粘贴用：注入平台与剪贴板读取器。 */
function makeLiteralEditor(
  options: ComposerPasteOptions,
  content: Content = "",
): Editor {
  const created = createComposerEditor({ content, paste: options });
  host = created.host;
  return created.editor;
}

describe("isPlainTextPasteKey", () => {
  function key(
    init: KeyboardEventInit & { key?: string },
  ): KeyboardEvent {
    return new KeyboardEvent("keydown", { key: "v", ...init });
  }

  it("macOS 只认 ⌥⇧⌘V", () => {
    expect(
      isPlainTextPasteKey(
        key({ key: "v", code: "KeyV", metaKey: true, altKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe(true);
    // Option 把 key 映射成 "√" 时仍按物理键识别。
    expect(
      isPlainTextPasteKey(
        key({ key: "√", code: "KeyV", metaKey: true, altKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe(true);
    expect(
      isPlainTextPasteKey(
        key({ key: "v", code: "KeyV", metaKey: true, altKey: true }),
        "mac",
      ),
    ).toBe(false);
    expect(
      isPlainTextPasteKey(
        key({ key: "v", code: "KeyV", ctrlKey: true, altKey: true }),
        "mac",
      ),
    ).toBe(false);
  });

  it("Windows / Linux 只认 Ctrl+Alt+V", () => {
    expect(
      isPlainTextPasteKey(
        key({ key: "v", code: "KeyV", ctrlKey: true, altKey: true }),
        "win",
      ),
    ).toBe(true);
    // 非拉丁布局上 key 可能是别的字符，物理键仍是 V。
    expect(
      isPlainTextPasteKey(
        key({ key: "м", code: "KeyV", ctrlKey: true, altKey: true }),
        "win",
      ),
    ).toBe(true);
    expect(
      isPlainTextPasteKey(
        key({ key: "v", code: "KeyV", ctrlKey: true, altKey: true, shiftKey: true }),
        "linux",
      ),
    ).toBe(true);
    expect(
      isPlainTextPasteKey(
        key({ key: "v", code: "KeyV", metaKey: true, altKey: true }),
        "win",
      ),
    ).toBe(false);
    expect(
      isPlainTextPasteKey(
        key({ key: "c", code: "KeyC", ctrlKey: true, altKey: true }),
        "win",
      ),
    ).toBe(false);
  });
});

describe("纯文本粘贴（字面量）", () => {
  /** 文档里的行内节点顺序，用于断言硬换行。 */
  function inlineTypes(ed: Editor): string[] {
    const names: string[] = [];
    ed.state.doc.descendants((node) => {
      if (node.isInline) names.push(node.type.name);
      return true;
    });
    return names;
  }

  it("Markdown 记号按字面量插入，粘贴后输入不带标记", async () => {
    // Arrange
    const ed = makeLiteralEditor(
      {
        platform: "win",
        readClipboardText: async () => "**测试**\n## 标题\n- 项",
      },
      "开头",
    );
    editor = ed;
    caretAtEnd(ed);

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(ed.state.doc.textContent).toContain("**测试**");
    expect(ed.state.doc.textContent).toContain("## 标题");
    expect(ed.state.doc.textContent).toContain("- 项");
    expect(hasHardBreak(ed)).toBe(true);
    expect(blockTypes(ed)).toEqual(["paragraph"]);
    expect(inlineTypes(ed)).toEqual([
      "text",
      "hardBreak",
      "text",
      "hardBreak",
      "text",
    ]);

    const { from } = ed.state.selection;
    ed.view.dispatch(ed.state.tr.insertText("X", from, from));
    const lastText = ed.state.doc.lastChild?.lastChild;
    expect(lastText?.text).toContain("X");
    expect(lastText?.marks ?? []).toEqual([]);
  });

  it("多行与空行都按硬换行落位", async () => {
    // Arrange
    const ed = makeLiteralEditor({
      platform: "win",
      readClipboardText: async () => "a\n\nb\n",
    });
    editor = ed;
    caretAtEnd(ed);

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(inlineTypes(ed)).toEqual([
      "text",
      "hardBreak",
      "hardBreak",
      "text",
    ]);
    expect(markdownOf(ed)).toContain("a\\\n\\\nb");
  });

  it("选中文本被替换，撤销一步回到粘贴前", async () => {
    // Arrange
    const ed = makeLiteralEditor(
      { platform: "win", readClipboardText: async () => "X\nY" },
      "abc",
    );
    editor = ed;
    caretAtEnd(ed);
    ed.commands.selectAll();

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(ed.state.doc.textContent).toBe("XY");
    ed.commands.undo();
    expect(ed.state.doc.textContent).toBe("abc");
  });

  it("代码块内按含换行的文本插入，不使用 hardBreak", async () => {
    // Arrange
    const ed = makeLiteralEditor(
      { platform: "win", readClipboardText: async () => "a\nb" },
      {
        type: "doc",
        content: [{ type: "codeBlock", content: [{ type: "text", text: "c" }] }],
      },
    );
    editor = ed;
    caretAtEnd(ed);

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(hasHardBreak(ed)).toBe(false);
    expect(ed.state.doc.textContent).toBe("ca\nb");
    expect(markdownOf(ed)).toContain("a\nb");
  });

  it("空剪贴板不产生事务", async () => {
    // Arrange
    const ed = makeLiteralEditor(
      { platform: "win", readClipboardText: async () => "  \n\t" },
      "abc",
    );
    editor = ed;
    caretAtEnd(ed);
    const before = ed.state.doc;

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(ed.state.doc.eq(before)).toBe(true);
  });

  it("代码块内纯空白剪贴板不产生事务", async () => {
    // Arrange
    const ed = makeLiteralEditor(
      { platform: "win", readClipboardText: async () => "  \n\t" },
      {
        type: "doc",
        content: [{ type: "codeBlock", content: [{ type: "text", text: "c" }] }],
      },
    );
    editor = ed;
    const before = ed.state.doc;

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(ed.state.doc.eq(before)).toBe(true);
  });

  it("长按重复的 keydown 不会重复粘贴", async () => {
    // Arrange
    const ed = makeLiteralEditor(
      { platform: "win", readClipboardText: async () => "X" },
      "abc",
    );
    editor = ed;
    caretAtEnd(ed);

    // Act
    await pressPlainPaste(ed, { repeat: true });

    // Assert
    expect(ed.state.doc.textContent).toBe("abc");
  });

  it("macOS 上的 ⌥⇧⌘V 走同一条落笔路径", async () => {
    // Arrange
    const ed = makeLiteralEditor(
      { platform: "mac", readClipboardText: async () => "**测试**" },
      "abc",
    );
    editor = ed;
    caretAtEnd(ed);

    // Act
    await pressPlainPaste(ed, { mac: true });

    // Assert
    expect(ed.state.doc.textContent).toBe("abc**测试**");
  });

  it("等待剪贴板期间文档被替换则不落笔", async () => {
    // Arrange
    let ed: Editor;
    ed = makeLiteralEditor(
      {
        platform: "win",
        readClipboardText: async () => {
          ed.commands.setContent("换了");
          return "X";
        },
      },
      "abc",
    );
    editor = ed;

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(ed.state.doc.textContent).toBe("换了");
  });

  it("等待剪贴板期间光标移动则落到当前选区", async () => {
    // Arrange
    let ed: Editor;
    ed = makeLiteralEditor(
      {
        platform: "win",
        readClipboardText: async () => {
          ed.commands.setTextSelection(1);
          return "X";
        },
      },
      "abc",
    );
    editor = ed;
    caretAtEnd(ed);

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(ed.state.doc.textContent).toBe("Xabc");
  });

  it("选区跨进代码块时不落笔", async () => {
    // Arrange
    const ed = makeLiteralEditor(
      { platform: "win", readClipboardText: async () => "X\nY" },
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "abc" }] },
          { type: "codeBlock", content: [{ type: "text", text: "code" }] },
        ],
      },
    );
    editor = ed;
    ed.commands.setTextSelection({ from: 2, to: 7 });
    const before = ed.state.doc;

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(ed.state.doc.eq(before)).toBe(true);
  });

  it("整段 URL 保持文本，不生成引用 chip", async () => {
    // Arrange
    const ed = makeLiteralEditor({
      platform: "win",
      readClipboardText: async () => "https://example.com/a",
    });
    editor = ed;
    caretAtEnd(ed);

    // Act
    await pressPlainPaste(ed);

    // Assert
    let hasRefToken = false;
    ed.state.doc.descendants((node) => {
      if (node.type.name === "refToken") hasRefToken = true;
      return true;
    });
    expect(ed.state.doc.textContent).toBe("https://example.com/a");
    expect(hasRefToken).toBe(false);
  });

  it("跨段落选区被一个段落替换", async () => {
    // Arrange
    const ed = makeLiteralEditor(
      { platform: "win", readClipboardText: async () => "A\nB" },
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "第一段" }] },
          { type: "paragraph", content: [{ type: "text", text: "第二段" }] },
        ],
      },
    );
    editor = ed;
    ed.commands.selectAll();

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(blockTypes(ed)).toEqual(["paragraph"]);
    expect(hasHardBreak(ed)).toBe(true);
    expect(ed.state.doc.textContent).toBe("AB");
  });

  it("撤销只回退粘贴，不并掉紧邻的输入", async () => {
    // Arrange
    const ed = makeLiteralEditor(
      { platform: "win", readClipboardText: async () => "X" },
      "abc",
    );
    editor = ed;
    caretAtEnd(ed);
    ed.view.dispatch(ed.state.tr.insertText("d"));

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(ed.state.doc.textContent).toBe("abcdX");
    ed.commands.undo();
    expect(ed.state.doc.textContent).toBe("abcd");
  });

  it("Windows 超大文本交给附件出口，不插入编辑器", async () => {
    // Arrange
    const spilled: File[] = [];
    const big = "x".repeat(LONG_ASSISTANT_SPILL_CHARS + 1);
    const ed = makeLiteralEditor(
      {
        platform: "win",
        readClipboardText: async () => big,
        spillPlainText: (file) => spilled.push(file),
      },
      "abc",
    );
    editor = ed;
    caretAtEnd(ed);

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(spilled).toHaveLength(1);
    expect(spilled[0].name.endsWith(".txt")).toBe(true);
    expect(ed.state.doc.textContent).toBe("abc");
  });

  it("非 Windows 的超大文本正常插入", async () => {
    // Arrange
    const spilled: File[] = [];
    const big = "x".repeat(LONG_ASSISTANT_SPILL_CHARS + 1);
    const ed = makeLiteralEditor(
      {
        platform: "linux",
        readClipboardText: async () => big,
        spillPlainText: (file) => spilled.push(file),
      },
      "abc",
    );
    editor = ed;
    caretAtEnd(ed);

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(spilled).toHaveLength(0);
    expect(ed.state.doc.textContent.startsWith("abc")).toBe(true);
    expect(ed.state.doc.textContent.length).toBeGreaterThan(big.length);
  });

  it("字面量粘贴在草稿里保留行首转义", async () => {
    // Arrange
    const ed = makeLiteralEditor({
      platform: "win",
      readClipboardText: async () => "intro\n## 标题\n**测试**",
    });
    editor = ed;
    caretAtEnd(ed);

    // Act
    await pressPlainPaste(ed);

    // Assert
    expect(markdownOf(ed)).toContain("\\*\\*测试\\*\\*");
    expect(normalizeSerializedMarkdown(markdownOf(ed))).toContain(
      "intro\n\\## 标题",
    );
  });
});

describe("Shift+粘贴", () => {
  it("交回 ProseMirror 的纯文本路径", () => {
    // Arrange
    editor = makeEditor();
    setShiftPaste(editor);

    // Act
    const handled = dispatchPaste(editor, "## 标题\n", "<div>## 标题</div>");

    // Assert
    expect(handled).toBe(false);
  });

  it("真实管线按纯文本插入，不解析 Markdown", () => {
    // Arrange
    editor = makeEditor();
    setShiftPaste(editor);

    // Act —— 普通粘贴会拆成标题，Shift 粘贴不应解析块级记号
    dispatchRealPaste(editor, "## 标题\n\n正文", "<div>## 标题<br><br>正文</div>");

    // Assert
    expect(blockTypes(editor)).not.toContain("heading");
    expect(editor.state.doc.textContent).toContain("## 标题");
    expect(editor.state.doc.textContent).toContain("正文");
  });

  it("Shift+Insert 不当作纯文本粘贴", () => {
    // Arrange
    editor = makeEditor();
    setShiftPaste(editor);
    (
      editor.view as unknown as { input: { lastKeyCode: number } }
    ).input.lastKeyCode = 45;

    // Act
    const handled = dispatchPaste(editor, "## 标题\n", "<div>## 标题</div>");

    // Assert
    expect(handled).toBe(true);
  });
});
