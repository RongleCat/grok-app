/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { buildComposerExtensions } from "./composerExtensions";
import { dispatchRealPaste, setShiftPaste } from "./composerPasteTestUtils";

const mounted: Editor[] = [];
afterEach(() => {
  for (const editor of mounted.splice(0)) {
    const host = editor.view.dom.parentElement;
    editor.destroy();
    host?.remove();
  }
});

function codeEditor(withPastePlugin: boolean): Editor {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    // main 的扩展清单与当前分支仅差这个插件；移除它可直接比较旧行为。
    extensions: buildComposerExtensions({ showPlaceholderWhenEditable: false })
      .filter((extension) => withPastePlugin || extension.name !== "composerMarkdownPaste"),
    content: "```js\nbeforeafter\n```",
  });
  editor.commands.setTextSelection(7);
  mounted.push(editor);
  return editor;
}

describe("代码块原始剪贴板空白", () => {
  const raw = "\n  keep\n\n";
  const expected = `before${raw}after`;

  it("main 的原始管线保留首尾空行与缩进", () => {
    const editor = codeEditor(false);
    dispatchRealPaste(editor, raw);
    expect(editor.state.doc.firstChild?.textContent).toBe(expected);
  });

  it.each([false, true])("新插件保持代码块原文，Shift=%s", (shift) => {
    const editor = codeEditor(true);
    if (shift) setShiftPaste(editor);
    dispatchRealPaste(editor, raw, "<pre><code>\n  keep\n\n</code></pre>");
    expect(editor.state.doc.firstChild?.textContent).toBe(expected);
    expect(editor.state.doc.firstChild?.attrs.language).toBe("js");
  });
});
