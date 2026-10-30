/**
 * 粘贴测试共用的 headless 编辑器与事件工具。
 *
 * 拆出来是为了让"粘贴判定"与"纯文本手势"各占一个测试文件，同时避免两处各抄
 * 一份编辑器装配与剪贴板事件。
 */
import { Editor } from "@tiptap/react";
import type { Content } from "@tiptap/react";
import { Slice } from "@tiptap/pm/model";
import { buildComposerExtensions } from "@/components/composer/tiptap/composerExtensions";
import type { ComposerPasteOptions } from "@/components/composer/tiptap/composerPaste";

/** 装配一个 headless 编辑器；调用方负责销毁编辑器并移除 host。 */
export function createComposerEditor(
  opts: { content?: Content; paste?: ComposerPasteOptions } = {},
): { editor: Editor; host: HTMLDivElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: buildComposerExtensions({
      showPlaceholderWhenEditable: false,
      plainTextPaste: opts.paste,
    }),
    content: opts.content ?? "",
    editable: true,
  });
  return { editor, host };
}

/** 最小剪贴板事件：只实现粘贴路径实际读取的两个 MIME。 */
export function pasteEvent(plain: string, html?: string): ClipboardEvent {
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

/** 直接调用插件的 `handlePaste`，返回是否被接管。 */
export function dispatchPaste(
  ed: Editor,
  plain: string,
  html?: string,
): boolean {
  const event = pasteEvent(plain, html);
  const handled = ed.view.someProp("handlePaste", (f) =>
    f(ed.view, event, Slice.empty),
  );
  return !!handled;
}

/** 走 ProseMirror 的完整粘贴管线：HTML 分支、库的 clipboardTextParser 都会被覆盖。 */
export function dispatchRealPaste(
  ed: Editor,
  plain: string,
  html?: string,
): void {
  ed.view.dom.dispatchEvent(pasteEvent(plain, html));
}

/** ProseMirror 的 `preferPlain` 来自内部 input 状态，类型里没有暴露。 */
export function setShiftPaste(ed: Editor): void {
  (ed.view as unknown as { input: { shiftKey: boolean } }).input.shiftKey = true;
}

/** 顶层块节点的类型名，按文档顺序。 */
export function blockTypes(ed: Editor): string[] {
  const names: string[] = [];
  ed.state.doc.forEach((node) => names.push(node.type.name));
  return names;
}

/** 序列化后的 Markdown 草稿。 */
export function markdownOf(ed: Editor): string {
  const raw = (ed.storage as { markdown?: { getMarkdown?: () => unknown } })
    .markdown?.getMarkdown?.();
  return typeof raw === "string" ? raw : "";
}

export function hasHardBreak(ed: Editor): boolean {
  let found = false;
  ed.state.doc.descendants((node) => {
    if (node.type.name === "hardBreak") found = true;
    return !found;
  });
  return found;
}

/** 按下纯文本粘贴和弦，等异步剪贴板读完。 */
export async function pressPlainPaste(
  ed: Editor,
  opts: { repeat?: boolean; mac?: boolean } = {},
): Promise<void> {
  const mac = opts.mac ?? false;
  ed.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", {
      // macOS 的 Option 会把 key 映射成 "√"，物理键仍靠 code 识别。
      key: mac ? "√" : "v",
      code: "KeyV",
      ctrlKey: !mac,
      metaKey: mac,
      altKey: true,
      shiftKey: mac,
      repeat: opts.repeat ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 光标放到文档末尾；不走 `focus` 以免 jsdom 缺布局 API。 */
export function caretAtEnd(ed: Editor): void {
  ed.commands.setTextSelection(ed.state.doc.content.size);
}
