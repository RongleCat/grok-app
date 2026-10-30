/**
 * Markdown（TipTap）输入框的粘贴策略。
 *
 * 剪贴板带 `text/html` 时 ProseMirror 一律走 HTML 解析：纯文本包壳里的块级记号
 * （`#` / ```` ``` ```` / `- `）会退化成字面量。库自带的纯文本路径是行内解析，
 * 同样压平块级记号。
 *
 * 本扩展按"来源像不像 Markdown 源码"分三档处理，普通文字保持原样：
 * - `block`：`code` / `pre` 包壳，或多行且含块级记号，按块级 Markdown 解析；
 * - `inline`：其余包壳 / 无 HTML 文本，只解析行内记号，块级记号保持字面量；
 * - `none`：本编辑器自己的 slice 与带语义的富文本 HTML，交给 ProseMirror 解析。
 *
 * 判定规则、例外与所用库 API 见 docs/llm-wiki/composer-markdown.md。
 */

import { Extension } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { looksLikeMarkdownBlockSource } from "@/lib/markdownLineStart";

/** `doc.body` 内不携带语义的标签。 */
const NEUTRAL_TAGS = new Set(["META", "TITLE", "DIV", "P", "BR", "SPAN"]);

/** Markdown 源码包壳：浏览器把源码包在行内 `code` 或 `pre` 里。 */
const SOURCE_TAGS = new Set(["PRE", "CODE"]);

/** 行内记号在 HTML 里对应的标签；它们都算"有标记覆盖"。 */
const MARK_TAGS = "strong,em,code,s,del,a,mark,u";

/** 行内解析结果里出现的块级标签，说明 markdown-it 已把文本提升成块。 */
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "PRE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "HR",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TD",
  "TH",
]);

/**
 * 行首的块级记号由 `@/lib/markdownLineStart` 统一维护：粘贴判定和序列化防歧义
 * 必须用同一份规则，否则会像 setext `===` / 表格 `|` 那样漂移。
 */

/** 比较用文本：忽略一切空白差异。 */
function comparableText(text: string): string {
  return text.replace(/\s+/g, "");
}

/** 统一 CRLF，并去掉剪贴板自带的首尾空行；全空白粘贴归一化为空串。 */
export function normalizePastedMarkdown(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/\n(?:[ \t]*\n)*[ \t]*$/, "");
  return normalized.trim() ? normalized : "";
}

/** 供粘贴判定使用的单次解析结果；导出包装会重新解析，因此不对外暴露。 */
type ClipboardHtml = {
  elements: Element[];
  text: string;
  hasOwnSlice: boolean;
};

function parseClipboardHtml(html: string): ClipboardHtml {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return {
    elements: Array.from(doc.body.querySelectorAll("*")),
    text: doc.body.textContent ?? "",
    hasOwnSlice: doc.body.querySelector("[data-pm-slice]") !== null,
  };
}

/** 元素里是否存在包壳之外的标签。 */
function hasElementsOutside(
  elements: Element[],
  isWrapper: (element: Element) => boolean,
): boolean {
  return elements.some((element) => !isWrapper(element));
}

/** 纯文本包壳：无语义标签；带 style / class 的 `span` 视为有语义。 */
function isPlainWrapperElement(element: Element): boolean {
  if (!NEUTRAL_TAGS.has(element.tagName)) return false;
  if (element.tagName !== "SPAN") return true;
  return !element.hasAttribute("style") && !element.hasAttribute("class");
}

/** 源码包壳：允许外观标签、高亮 `span` 与 `code` / `pre`。 */
function isSourceWrapperElement(element: Element): boolean {
  return (
    NEUTRAL_TAGS.has(element.tagName) ||
    element.tagName === "SPAN" ||
    SOURCE_TAGS.has(element.tagName)
  );
}

/**
 * `text/html` 是否只是 `text/plain` 的包壳。
 *
 * 标签无语义、且文本内容与纯文本一致才算包壳；判据细节见
 * docs/llm-wiki/composer-markdown.md。
 */
function isPlainWrapper(parsed: ClipboardHtml, plain: string): boolean {
  if (hasElementsOutside(parsed.elements, isPlainWrapperElement)) return false;
  const htmlText = comparableText(parsed.text);
  if (!htmlText) return comparableText(plain).length > 0;
  return htmlText === comparableText(plain);
}

/**
 * `text/html` 是否只是 Markdown 源码的 `code` / `pre` 包壳。
 *
 * 浏览器把 Markdown 源码渲染成行内 `code` 时，`text/plain` 才是用户复制的原文；
 * 代码高亮器会在 `code` 里塞 `span`，因此外观标签不算语义。要求包壳内的文本与
 * 纯文本完全一致，页面里"正文 + 行内代码"不会被误判成源码。
 */
function isMarkdownSource(parsed: ClipboardHtml, plain: string): boolean {
  if (hasElementsOutside(parsed.elements, isSourceWrapperElement)) return false;
  const sourceText = comparableText(plain);
  return parsed.elements.some(
    (element) =>
      SOURCE_TAGS.has(element.tagName) &&
      comparableText(element.textContent ?? "") === sourceText,
  );
}

/** 这次粘贴按哪种粒度解析 `text/plain`。 */
export type ComposerPastePlan = "block" | "inline" | "none";

/** 粘贴判定结果：粒度 + 归一化后的 Markdown 源码。 */
export type PastedMarkdown = {
  plan: ComposerPastePlan;
  /** `plan === "none"` 时为 `null`，这次粘贴交给 ProseMirror 的 HTML 解析。 */
  markdown: string | null;
};

/**
 * 决定粘贴的解析粒度。
 *
 * 顺序即优先级：`data-pm-slice`（本编辑器的内容）→ `code` / `pre` 源码包壳 →
 * 无语义包壳 → 带语义的富文本。块级提升只发生在明确的 Markdown 源码上。
 */
export function planPastedMarkdown(
  plain: string,
  html: string | null,
): PastedMarkdown {
  const markdown = normalizePastedMarkdown(plain);
  if (!markdown) return { plan: "none", markdown: null };
  if (html) {
    const parsed = parseClipboardHtml(html);
    if (parsed.hasOwnSlice) return { plan: "none", markdown: null };
    if (isMarkdownSource(parsed, plain)) return { plan: "block", markdown };
    if (!isPlainWrapper(parsed, plain)) return { plan: "none", markdown: null };
  }
  const plan = looksLikeMarkdownBlockSource(markdown) ? "block" : "inline";
  return { plan, markdown };
}

/** tiptap-markdown 在运行时挂到 `storage.markdown` 上的解析器（只取用到的部分）。 */
type MarkdownParserStorage = {
  markdown?: {
    parser?: {
      parse?: (
        markdown: string,
        options?: { inline?: boolean },
      ) => string;
    };
  };
};

/**
 * 粘贴内容以标记结尾时，光标落在标记范围内，`marks()` 仍是粗体 / 斜体。
 * 返回清空 `storedMarks` 的事务，让粘贴后的输入回到纯文本。
 */
function trailingMarksReset(state: EditorState): Transaction | null {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock || !$from.marks().length) return null;
  return state.tr.setStoredMarks([]);
}

/** 行内解析结果里是否出现块级标签。 */
function containsBlockTags(container: HTMLElement): boolean {
  return Array.from(container.querySelectorAll("*")).some((el) =>
    BLOCK_TAGS.has(el.tagName),
  );
}

/**
 * 行内解析结果是否整段都带标记（例如 `**测试**`、`` `code` ``）。
 *
 * 混在普通句子里的 `_斜体_` / `**粗体**` 说明这是正文而不是 Markdown 源码，
 * 保持字面量，避免"粘贴网页文字后下划线消失"。
 */
function isFullyMarked(container: HTMLElement): boolean {
  const all = comparableText(container.textContent ?? "");
  if (!all) return false;
  const outermost = Array.from(container.querySelectorAll(MARK_TAGS)).filter(
    (el) => el.parentElement?.closest(MARK_TAGS) === null,
  );
  const marked = comparableText(
    outermost.map((el) => el.textContent ?? "").join(""),
  );
  return marked === all;
}

/** 按字面量插入纯文本，不继承光标处的标记。 */
function insertPlainText(editor: Editor, text: string): boolean {
  const { from, to } = editor.state.selection;
  editor.view.dispatch(
    editor.state.tr.replaceWith(from, to, editor.schema.text(text)),
  );
  return true;
}

/**
 * 行内 Markdown 插入：解析成行内 HTML，再用 schema 转成 slice 替换选区。
 *
 * 不能走 `insertContentAt`：库会把它再次当作 Markdown 解析，而本编辑器关闭了
 * `html`，标签会变成字面量。这里与库的 `clipboardTextParser` 使用同一套 API。
 * 解析结果出现块级结构或单行内容混有正文时，退回字面量。
 */
function insertInlineMarkdown(editor: Editor, markdown: string): boolean {
  const parser = (editor.storage as MarkdownParserStorage).markdown?.parser;
  if (!parser?.parse) return false;
  const inlineHtml = parser.parse(markdown, { inline: true });
  const container = new DOMParser().parseFromString(inlineHtml, "text/html")
    .body;
  if (
    containsBlockTags(container) ||
    (!markdown.includes("\n") && !isFullyMarked(container))
  ) {
    return insertPlainText(editor, markdown);
  }
  const { $from } = editor.state.selection;
  const slice = ProseMirrorDOMParser.fromSchema(editor.schema).parseSlice(
    container,
    { preserveWhitespace: true, context: $from },
  );
  if (!slice.content.size) return false;
  editor.view.dispatch(editor.state.tr.replaceSelection(slice));
  return true;
}

/** 剪贴板粘贴：按来源决定解析粒度；所有纯文本粘贴先归一化。 */
export const ComposerMarkdownPaste = Extension.create({
  name: "composerMarkdownPaste",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("composerMarkdownPaste"),
        appendTransaction(transactions, _oldState, newState) {
          // 只有 ProseMirror 自己处理的粘贴（HTML 回退路径）带 `paste` meta。
          if (!transactions.some((tr) => tr.getMeta("paste"))) return null;
          return trailingMarksReset(newState);
        },
        props: {
          transformPastedText(text: string) {
            return normalizePastedMarkdown(text);
          },
          handlePaste(view: EditorView, event: ClipboardEvent) {
            const { selection } = view.state;
            if (
              selection.$from.parent.type.spec.code ||
              selection.$to.parent.type.spec.code
            ) {
              return false;
            }
            const data = event.clipboardData;
            if (!data) return false;
            const plain = data.getData("text/plain");
            const html = data.getData("text/html");
            const { plan, markdown } = planPastedMarkdown(plain, html);
            if (plan === "none" || !markdown) return false;

            const parser = (editor.storage as MarkdownParserStorage).markdown
              ?.parser;
            if (!parser?.parse) return false;
            const inserted =
              plan === "block"
                ? editor.commands.insertContentAt(
                    { from: selection.from, to: selection.to },
                    markdown,
                  )
                : insertInlineMarkdown(editor, markdown);
            if (!inserted) return false;

            const reset = trailingMarksReset(editor.state);
            if (reset) editor.view.dispatch(reset);
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});
