/**
 * @vitest-environment jsdom
 *
 * 粘贴策略回归：
 * - Markdown 源码（`code` / `pre` 包壳、多行块级记号）按块级解析；
 * - 普通文字与编辑器自己的 slice 保持原样（块级记号不做提升）；
 * - 带语义的 HTML 保持 HTML 解析，链接 / 粗体不丢失；
 * - 尾随换行不再变成 hardBreak（行尾右方向键不会走进空白行）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { Slice } from "@tiptap/pm/model";
import { buildComposerExtensions } from "@/components/composer/tiptap/composerExtensions";
import { normalizeSerializedMarkdown } from "@/lib/composerMarkdown";
import {
  normalizePastedMarkdown,
  planPastedMarkdown,
} from "@/components/composer/tiptap/composerPaste";

let editor: Editor | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  host?.remove();
  host = null;
});

function makeEditor(content = ""): Editor {
  host = document.createElement("div");
  document.body.appendChild(host);
  return new Editor({
    element: host,
    extensions: buildComposerExtensions({ showPlaceholderWhenEditable: false }),
    content,
    editable: true,
  });
}

/** 最小剪贴板事件：只实现粘贴路径实际读取的两个 MIME。 */
function pasteEvent(plain: string, html?: string): ClipboardEvent {
  // jsdom 没有 ClipboardEvent；粘贴路径只读取 clipboardData，用 Event 承载即可。
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (type: string) => {
        if (type === "text/plain") return plain;
        if (type === "text/html") return html ?? "";
        return "";
      },
    },
  });
  return event as unknown as ClipboardEvent;
}

function dispatchPaste(ed: Editor, plain: string, html?: string): boolean {
  const event = pasteEvent(plain, html);
  const handled = ed.view.someProp("handlePaste", (f) =>
    f(ed.view, event, Slice.empty),
  );
  return !!handled;
}

/** 走 ProseMirror 的完整粘贴管线：HTML 分支、库的 clipboardTextParser 都会被覆盖。 */
function dispatchRealPaste(ed: Editor, plain: string, html?: string): void {
  ed.view.dom.dispatchEvent(pasteEvent(plain, html));
}

function blockTypes(ed: Editor): string[] {
  const names: string[] = [];
  ed.state.doc.forEach((node) => names.push(node.type.name));
  return names;
}

function markdownOf(ed: Editor): string {
  const raw = (ed.storage as { markdown?: { getMarkdown?: () => unknown } })
    .markdown?.getMarkdown?.();
  return typeof raw === "string" ? raw : "";
}

function hasHardBreak(ed: Editor): boolean {
  let found = false;
  ed.state.doc.descendants((node) => {
    if (node.type.name === "hardBreak") found = true;
    return !found;
  });
  return found;
}

describe("normalizePastedMarkdown", () => {
  it("统一 CRLF 并去掉首尾空行", () => {
    expect(normalizePastedMarkdown("\n\n第一行\r\n第二行\r\n\n")).toBe(
      "第一行\n第二行",
    );
  });

  it("保留中间的换行与行尾空格", () => {
    expect(normalizePastedMarkdown("a  \nb\n")).toBe("a  \nb");
  });

  it("保留最后一行的尾随空格（行内粘贴的正文）", () => {
    expect(normalizePastedMarkdown("big ")).toBe("big ");
    expect(normalizePastedMarkdown("big \n")).toBe("big ");
  });

  it("全空白粘贴归一化为空串", () => {
    expect(normalizePastedMarkdown(" \n\t\n")).toBe("");
  });
});

describe("planPastedMarkdown 的 HTML 判定", () => {
  it("无语义包壳按纯文本处理", () => {
    expect(planPastedMarkdown("## 标题\n", "<div>## 标题</div>").plan).toBe(
      "inline",
    );
    expect(planPastedMarkdown("a\nb\n", "<div>a<br>b</div>").plan).toBe(
      "inline",
    );
    expect(planPastedMarkdown("## 标题", '<meta charset="utf-8">').plan).toBe(
      "inline",
    );
    expect(planPastedMarkdown("## 标题", "   ").plan).toBe("inline");
  });

  it("带语义的 HTML 不接管", () => {
    expect(
      planPastedMarkdown("粗体", "<div><strong>粗体</strong></div>").plan,
    ).toBe("none");
    expect(planPastedMarkdown("标题", "<h2>标题</h2>").plan).toBe("none");
    expect(
      planPastedMarkdown("红", '<div><span style="color:red">红</span></div>')
        .plan,
    ).toBe("none");
    expect(planPastedMarkdown("少了 一段", "<div>少了</div>").plan).toBe(
      "none",
    );
  });

  it("code / pre 包壳按块级解析", () => {
    expect(planPastedMarkdown("a", "<pre><code>a</code></pre>").plan).toBe(
      "block",
    );
    expect(
      planPastedMarkdown("## **标题**", "<code>## **标题**</code>").plan,
    ).toBe("block");
    expect(
      planPastedMarkdown(
        "const a = 1;",
        '<pre><code><span class="hljs-keyword">const</span> a = 1;</code></pre>',
      ).plan,
    ).toBe("block");
  });

  it("正文里的行内代码与语义标签不算源码包壳", () => {
    expect(
      planPastedMarkdown(
        "参见 npm run build 命令",
        "<p>参见 <code>npm run build</code> 命令</p>",
      ).plan,
    ).toBe("none");
    expect(
      planPastedMarkdown(
        "文档",
        '<pre><code><a href="https://example.com">文档</a></code></pre>',
      ).plan,
    ).toBe("none");
  });

  it("data-pm-slice 交还给 ProseMirror", () => {
    expect(
      planPastedMarkdown("- hello", '<p data-pm-slice="1 1 []">- hello</p>')
        .plan,
    ).toBe("none");
    expect(planPastedMarkdown("- hello", "<p>- hello</p>").plan).toBe("inline");
  });
});

describe("planPastedMarkdown", () => {
  it("code 包壳按块级解析", () => {
    expect(
      planPastedMarkdown("## **标题**", "<code>## **标题**</code>").plan,
    ).toBe("block");
  });

  it("单行普通文字按行内解析", () => {
    expect(
      planPastedMarkdown("# trending topic", "<div># trending topic</div>")
        .plan,
    ).toBe("inline");
    expect(planPastedMarkdown("**测试**", null).plan).toBe("inline");
  });

  it("多行块级源码按块级解析", () => {
    expect(planPastedMarkdown("```js\nconst a = 1;\n```", null).plan).toBe(
      "block",
    );
    expect(
      planPastedMarkdown("## 标题\n\n正文", "<div>## 标题<br><br>正文</div>")
        .plan,
    ).toBe("block");
  });

  it("返回归一化后的 Markdown 源码", () => {
    expect(planPastedMarkdown("\n\n**测试**\n", null)).toEqual({
      plan: "inline",
      markdown: "**测试**",
    });
  });

  it("带语义的 HTML 不接管", () => {
    expect(
      planPastedMarkdown(
        "- Docs now",
        '<ul><li><a href="https://example.com">Docs</a> <strong>now</strong></li></ul>',
      ),
    ).toEqual({ plan: "none", markdown: null });
  });

  it("空粘贴不接管", () => {
    expect(planPastedMarkdown("\n\n", "<div></div>")).toEqual({
      plan: "none",
      markdown: null,
    });
  });
});

describe("粘贴行为", () => {
  it("行内代码末尾换行不留下 hardBreak", () => {
    // Arrange
    editor = makeEditor();

    // Act
    expect(
      dispatchPaste(editor, "`code`\n", "<div>`code`</div>"),
    ).toBe(true);

    // Assert —— 只有一个 code 文本节点，段落末尾没有多余空行
    expect(blockTypes(editor)).toEqual(["paragraph"]);
    expect(hasHardBreak(editor)).toBe(false);
    expect(markdownOf(editor)).toBe("`code`");
  });

  it("浏览器行内代码包壳的标题按 Markdown 解析", () => {
    // Arrange
    editor = makeEditor();

    // Act —— 走完整粘贴事件，不直接调用插件属性
    dispatchRealPaste(editor, "## **标题**\n", "<code>## **标题**</code>");

    // Assert
    expect(blockTypes(editor)[0]).toBe("heading");
    expect(markdownOf(editor)).toBe("## **标题**");
  });

  it("包壳里的单行普通文字保持字面量", () => {
    // Arrange
    editor = makeEditor();

    // Act —— 网页 / 文本文件里的普通句子不应被提升成标题、列表或引用
    dispatchPaste(editor, "# trending topic\n", "<div># trending topic</div>");

    // Assert —— 记号原样留在正文里（草稿序列化时会转义，存储态仍是字面量）
    expect(blockTypes(editor)).toEqual(["paragraph"]);
    expect(editor.state.doc.textContent).toBe("# trending topic");
  });

  it.each(["- 今天去超市买菜", "* 只是一句话", "1. 这不是清单", "> 不是引用", "---"])(
    "包壳里的单行 %s 保持字面量",
    (text) => {
      // Arrange
      editor = makeEditor();

      // Act
      dispatchPaste(editor, `${text}\n`, `<div>${text}</div>`);

      // Assert
      expect(blockTypes(editor)).toEqual(["paragraph"]);
      expect(editor.state.doc.textContent).toBe(text);
    },
  );

  it("混在句子里的行内记号保持字面量", () => {
    // Arrange
    editor = makeEditor();

    // Act
    dispatchPaste(editor, "a _b_ c\n", "<div>a _b_ c</div>");

    // Assert
    expect(editor.state.doc.textContent).toBe("a _b_ c");
    expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([]);
    // 序列化器保留防御性转义，气泡渲染时才不会把字面量当成斜体。
    expect(normalizeSerializedMarkdown(markdownOf(editor))).toBe(
      "a \\_b\\_ c",
    );
  });

  it("纯文本包壳的围栏代码按 Markdown 解析", () => {
    // Arrange
    editor = makeEditor();

    // Act
    dispatchPaste(
      editor,
      "```js\nconst a = 1;\n```\n",
      "<div>```js<br>const a = 1;<br>```</div>",
    );

    // Assert
    expect(blockTypes(editor)).toContain("codeBlock");
    expect(editor.state.doc.firstChild?.attrs.language).toBe("js");
  });

  it("带语义的 HTML 不接管，交给 ProseMirror 的 HTML 解析", () => {
    // Arrange
    editor = makeEditor();

    // Act —— handlePaste 返回 false 才会继续走 HTML 解析
    expect(dispatchPaste(editor, "标题", "<h2><strong>标题</strong></h2>")).toBe(
      false,
    );

    // Assert
    expect(markdownOf(editor)).toBe("");
  });

  it("多行纯文本只保留中间换行", () => {
    // Arrange
    editor = makeEditor();

    // Act
    dispatchPaste(editor, "第一行\n第二行\n", "<div>第一行\n第二行</div>");

    // Assert
    expect(markdownOf(editor)).toBe("第一行\\\n第二行");
    expect(editor.state.doc.textContent).toBe("第一行第二行");
  });

  it("在行中粘贴行内 Markdown 不会拆段", () => {
    // Arrange
    editor = makeEditor("hello world");
    editor.commands.setTextSelection(7);

    // Act
    dispatchPaste(editor, "`x`\n", "<div>`x`</div>");

    // Assert
    expect(blockTypes(editor)).toEqual(["paragraph"]);
    expect(markdownOf(editor)).toBe("hello `x`world");
  });

  it("跨段落粘贴单行纯文本不抛错", () => {
    // Arrange
    const ed = makeEditor("第一段\n\n第二段");
    editor = ed;
    ed.commands.setTextSelection({ from: 1, to: ed.state.doc.content.size - 1 });

    // Act
    dispatchRealPaste(ed, "普通文字", "<div>普通文字</div>");

    // Assert
    expect(ed.state.doc.textContent).toContain("普通文字");
  });

  it("在行中粘贴块级 Markdown 会拆段并保留标题", () => {
    // Arrange —— 不能用 replaceSelection 的拟合路径：它会把标题压成行内文本
    editor = makeEditor("hello world");
    editor.commands.setTextSelection(7);

    // Act
    dispatchPaste(editor, "## 标题\n", "<code>## 标题</code>");

    // Assert
    expect(blockTypes(editor)).toContain("heading");
    expect(editor.state.doc.textContent).toBe("hello 标题world");
  });

  it("代码块内不接管，保持字面量粘贴", () => {
    // Arrange
    editor = makeEditor("```\ncode\n```");
    editor.commands.setTextSelection(4);

    // Act —— 返回 false 后由 ProseMirror 的 inCode 分支原样插入
    expect(
      dispatchPaste(editor, "**not bold**\n", "<div>**not bold**</div>"),
    ).toBe(false);

    // Assert
    expect(markdownOf(editor)).toBe("```\ncode\n```");
  });

  it("跨代码块的选区不接管", () => {
    // Arrange —— 选区从正文段落反向跨进代码块
    editor = makeEditor("```\ncode\n```\n\nafter");
    editor.commands.setTextSelection({ from: 10, to: 3 });

    // Act
    expect(
      dispatchPaste(editor, "## 标题\n", "<div>## 标题</div>"),
    ).toBe(false);

    // Assert —— 文档保持原样，没有被插入标题
    expect(editor.state.doc.textContent).toBe("codeafter");
  });

  it("Markdown 解析器缺失时退回 HTML 解析，不插入源码", () => {
    // Arrange —— 模拟库升级后 storage.markdown.parser 被改名 / 移除
    editor = makeEditor();
    const storage = editor.storage as {
      markdown?: { parser?: unknown };
    };
    const saved = storage.markdown?.parser;
    storage.markdown!.parser = undefined;

    try {
      // Act
      const handled = dispatchPaste(
        editor,
        "## 标题\n",
        "<div>## 标题</div>",
      );

      // Assert
      expect(handled).toBe(false);
      expect(markdownOf(editor)).toBe("");
    } finally {
      storage.markdown!.parser = saved;
    }
  });
});

describe("真实粘贴管线", () => {
  it("段落内粘贴单行纯文本标题时保持字面量", () => {
    // Arrange
    editor = makeEditor("hello");
    editor.commands.setTextSelection(6);

    // Act
    dispatchRealPaste(editor, "## **标题**\n");

    // Assert
    expect(blockTypes(editor)).toEqual(["paragraph"]);
    expect(editor.state.doc.textContent).toBe("hello## **标题**");
  });

  it("段落内粘贴多行 Markdown 源码时保留标题块", () => {
    // Arrange
    editor = makeEditor("hello");
    editor.commands.setTextSelection(6);

    // Act
    dispatchRealPaste(editor, "## **标题**\n\n正文\n");

    // Assert
    expect(blockTypes(editor)).toContain("heading");
    expect(markdownOf(editor)).toContain("## **标题**");
  });

  it("粘贴标题后的草稿保留标题记号", () => {
    // Arrange —— 发送时 serializeDom 走的就是这条序列化 + 归一化链路
    editor = makeEditor("hello");
    editor.commands.setTextSelection(6);

    // Act
    dispatchRealPaste(editor, "## **标题**\n\n正文\n");

    // Assert
    expect(normalizeSerializedMarkdown(markdownOf(editor))).toBe(
      "hello\n\n## **标题**\n\n正文",
    );
  });

  it("标题后粘贴围栏时生成代码块", () => {
    // Arrange —— 光标放到标题末尾，围栏接在标题后面
    editor = makeEditor("## **标题**");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    // Act
    dispatchRealPaste(editor, "```js\nconst a = 1;\n```");

    // Assert
    expect(blockTypes(editor)[0]).toBe("heading");
    expect(blockTypes(editor)).toContain("codeBlock");
    expect(editor.state.doc.child(1).attrs.language).toBe("js");
  });

  it("浏览器行内代码包壳里的围栏仍生成代码块", () => {
    // Arrange —— 浏览器把 Markdown 源码包在 <code> 里，纯文本才是真实内容
    editor = makeEditor("");

    // Act
    dispatchRealPaste(
      editor,
      "```js\nconst a = 1;\n```",
      "<code>```js<br>const a = 1;<br>```</code>",
    );

    // Assert
    expect(blockTypes(editor)).toContain("codeBlock");
    expect(markdownOf(editor)).toContain("```js");
  });

  it("语义 HTML 的链接与粗体在真实粘贴后保留", () => {
    // Arrange
    editor = makeEditor();

    // Act —— 纯文本以 "- " 开头，但 HTML 是真正的列表，不能被 Markdown 覆盖
    dispatchRealPaste(
      editor,
      "- Docs now",
      '<ul><li><a href="https://example.com">Docs</a> <strong>now</strong></li></ul>',
    );

    // Assert
    const listItem = editor.state.doc.firstChild?.firstChild;
    expect(editor.state.doc.firstChild?.type.name).toBe("bulletList");
    expect(listItem?.textContent).toBe("Docs now");
    const marks: string[] = [];
    listItem?.descendants((node) => {
      node.marks.forEach((mark) => marks.push(mark.type.name));
      return true;
    });
    expect(marks).toContain("link");
    expect(marks).toContain("bold");
  });

  it("编辑器自己复制的段落（data-pm-slice）粘回仍是段落", () => {
    // Arrange —— ProseMirror 复制时写 data-pm-slice，纯文本以 "- " 开头
    editor = makeEditor();

    // Act
    dispatchRealPaste(
      editor,
      "- hello from editor",
      '<p data-pm-slice="1 1 []">- hello from editor</p>',
    );

    // Assert
    expect(blockTypes(editor)).toEqual(["paragraph"]);
    expect(editor.state.doc.textContent).toBe("- hello from editor");
  });

  it("粘贴 Markdown 粗体后继续输入是纯文本", () => {
    // Arrange
    editor = makeEditor("");
    dispatchRealPaste(editor, "**测试**", "<div>**测试**</div>");

    // Act —— 与输入法一致：显式 from / to
    const { from } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.insertText("X", from, from));

    // Assert
    expect(markdownOf(editor)).toBe("**测试**X");
  });

  it("粘贴浏览器粗体后继续输入是纯文本", () => {
    // Arrange
    editor = makeEditor("hello");
    editor.commands.setTextSelection(6);
    dispatchRealPaste(editor, "粗体", "<b>粗体</b>");

    // Act —— 模拟粘贴后的第一下输入
    const { from } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.insertText("X", from, from));

    // Assert
    const lastText = editor.state.doc.lastChild?.lastChild;
    expect(lastText?.text).toContain("X");
    expect(lastText?.marks ?? []).toEqual([]);
  });
});

describe("transformPastedText", () => {
  it("纯文本粘贴先去掉尾随换行", () => {
    // Arrange
    const ed = makeEditor();
    editor = ed;
    let text = "`code`\n";

    // Act
    ed.view.someProp("transformPastedText", (f) => {
      text = f(text, false, ed.view);
    });

    // Assert
    expect(text).toBe("`code`");
  });
});
