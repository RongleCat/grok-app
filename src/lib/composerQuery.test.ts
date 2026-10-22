/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { buildComposerExtensions } from "@/components/composer/tiptap/composerExtensions";
import { queryRangeBeforeCaret } from "./composerQuery";

function makeEditor(content: string): Editor {
  return new Editor({
    extensions: buildComposerExtensions({ showPlaceholderWhenEditable: false }),
    content,
    editable: false,
  });
}

/** 首个文本块的内容区间（PM position），用于把光标放到块末。 */
function firstTextblock(doc: ProseMirrorNode): { start: number; end: number } {
  let range = { start: 0, end: 0 };
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      range = { start: pos + 1, end: pos + 1 + node.content.size };
      return false;
    }
    return true;
  });
  return range;
}

describe("queryRangeBeforeCaret", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("定位普通段落里的 @query", () => {
    // Arrange —— 文本起点 PM 1，"看 @atF" 里 @ 在下标 2
    editor = makeEditor("看 @atF");
    // Act / Assert
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "@"),
    ).toEqual({ from: 3, to: 7, query: "atF" });
  });

  it("列表项内用文档位置，而不是 Markdown 源码位置", () => {
    // Arrange —— Markdown 是 `- 文件 @`（@ 在源码下标 4），文档里段落在
    // listItem 内、内容起点是 3，@ 落在文档位置 6
    editor = makeEditor("- 文件 @");
    // Act / Assert
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "@"),
    ).toEqual({ from: 6, to: 7, query: "" });
  });

  it("标题内同样成立", () => {
    // Arrange —— "# Title @x"：标题内容起点 1，@ 在文本下标 6
    editor = makeEditor("# Title @x");
    // Act / Assert
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "@"),
    ).toEqual({ from: 7, to: 9, query: "x" });
  });

  it("@ 位于行首（块起点）也算触发", () => {
    // Arrange
    editor = makeEditor("@x");
    // Act / Assert
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "@"),
    ).toEqual({ from: 1, to: 3, query: "x" });
  });

  it("@ 前是空白才算触发", () => {
    // Arrange
    editor = makeEditor("foo @x");
    // Act / Assert
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "@"),
    ).toEqual({ from: 5, to: 7, query: "x" });
  });

  it("拒绝 user@host —— @ 前是字母", () => {
    // Arrange
    editor = makeEditor("user@host");
    // Act / Assert
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "@"),
    ).toBeNull();
  });

  it("空 query 仍然命中（刚打出 @）", () => {
    // Arrange
    editor = makeEditor("@");
    // Act / Assert
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "@"),
    ).toEqual({ from: 1, to: 2, query: "" });
  });

  it("光标前的 query 不被其后的原子节点截断", () => {
    // Arrange —— 光标停在既有的引用 chip 之前：query 只取到光标
    editor = makeEditor("在 @atF[[file:/repo/x.ts]] 后");
    // Act / Assert —— 文本 "在 @atF" 占 1..7
    expect(queryRangeBeforeCaret(editor.state.doc, 7, "@")).toEqual({
      from: 3,
      to: 7,
      query: "atF",
    });
  });

  it("光标在原子节点之后时 query 终止（占位字符）", () => {
    // Arrange —— 光标在 chip 之后，前缀里出现占位字符
    editor = makeEditor("在 @atF[[file:/repo/x.ts]] 后");
    // Act / Assert
    expect(queryRangeBeforeCaret(editor.state.doc, 8, "@")).toBeNull();
  });

  it("原子节点紧跟 @ 时不算触发边界", () => {
    // Arrange —— "在 [[file:…]]@atF"：@ 前是 chip（占位字符，不是空白）
    editor = makeEditor("在 [[file:/repo/x.ts]]@atF");
    // Act / Assert
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "@"),
    ).toBeNull();
  });

  it("软换行（Shift+Enter）后打 @ 仍算触发，位置映射仍是一对一", () => {
    // Arrange —— `breaks: true` 下 "line1\n@ab" 解析成段落里
    // text("line1") + hardBreak + text("@ab")；它在 textBetween 里必须算换行
    // （空白）而不是原子占位符，否则 @ 前不是空白、面板不会出现。
    editor = makeEditor("line1\n@ab");
    const doc = editor.state.doc;
    // 段落内容起点 1 → 'l'=1 … hardBreak=6 → '@'=7, 'a'=8, 'b'=9, 块末=10
    const { start, end } = firstTextblock(doc);
    expect(start).toBe(1);
    expect(end).toBe(10);

    // Act
    const range = queryRangeBeforeCaret(doc, end, "@");

    // Assert —— from 落在 '@' 上，说明 hardBreak 只占一个位置
    expect(range).toEqual({ from: 7, to: 10, query: "ab" });
  });

  it("软换行后刚打出 @ 也算触发（空 query）", () => {
    // Arrange
    editor = makeEditor("line1\n@");
    const doc = editor.state.doc;

    // Act
    const range = queryRangeBeforeCaret(doc, firstTextblock(doc).end, "@");

    // Assert
    expect(range?.query).toBe("");
  });

  it("空白终止 query：不换行空格（U+00A0）也算", () => {
    // Arrange —— 旧实现里 `"@ \u00a0"` 必须终止补全，否则面板会以空 query 常驻
    editor = makeEditor("说 @\u00a0");
    const doc = editor.state.doc;

    // Act
    const range = queryRangeBeforeCaret(doc, firstTextblock(doc).end, "@");

    // Assert
    expect(range).toBeNull();
  });

  it("query 内含 @ 不终止（与 slash 的字符集一致）", () => {
    // Arrange —— 旧 '@' 正则把 @ 排除在 query 外，新规则对齐 slash 的 [^\s]*
    editor = makeEditor("@a@b");
    const doc = editor.state.doc;

    // Act
    const range = queryRangeBeforeCaret(doc, firstTextblock(doc).end, "@");

    // Assert
    expect(range).toEqual({ from: 1, to: 5, query: "a@b" });
  });

  it("slash 用同一套规则", () => {
    // Arrange
    editor = makeEditor("run /rev");
    // Act / Assert
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "/"),
    ).toEqual({ from: 5, to: 9, query: "rev" });
  });

  it("slash 前是字母不算触发", () => {
    // Arrange
    editor = makeEditor("a/rev");
    // Act / Assert
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "/"),
    ).toBeNull();
  });

  it("光标前没有 trigger 时返回 null", () => {
    // Arrange
    editor = makeEditor("plain text");
    // Act / Assert
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "@"),
    ).toBeNull();
  });

  it("全角 ＠ 与半角 @ 打开同一段文件查询", () => {
    editor = makeEditor("看 ＠atF");
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "@"),
    ).toEqual({ from: 3, to: 7, query: "atF" });
    editor.destroy();
    editor = makeEditor("user＠host");
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "@"),
    ).toBeNull();
  });

  it("全角 ／ 与半角 / 打开同一段斜杠查询", () => {
    editor = makeEditor("run ／rev");
    expect(
      queryRangeBeforeCaret(editor.state.doc, firstTextblock(editor.state.doc).end, "/"),
    ).toEqual({ from: 5, to: 9, query: "rev" });
  });

  it("光标不在文本块内时返回 null", () => {
    // Arrange —— 空文档的光标 0 落在 doc 上，不是文本块
    editor = makeEditor("");
    // Act / Assert
    expect(queryRangeBeforeCaret(editor.state.doc, 0, "@")).toBeNull();
  });
});
