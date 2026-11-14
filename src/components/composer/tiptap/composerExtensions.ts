/**
 * Composer 的 ProseMirror 扩展集。
 *
 * 抽成工厂函数是为了让 `ComposerEditor` 与 headless 测试用**同一份**扩展清单：
 * 之前测试里另抄了一份，新增节点（如引用 token）时两边会静默漂移——测试通过
 * 但真实编辑器不认这个节点，或反之。
 */

import { Extension, InputRule } from "@tiptap/react";
import { findWrapping } from "@tiptap/pm/transform";
import { TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { SkillTokenNode } from "@/components/composer/tiptap/composerSkillNode";
import { RefTokenNode } from "@/components/composer/tiptap/composerRefNode";
import { ComposerGhostGuard } from "@/components/composer/tiptap/composerGhostGuard";
import { ComposerMarkdownPaste } from "@/components/composer/tiptap/composerPaste";

/**
 * 列表项内的换行语义。
 *
 * 本应用把 Enter 绑成了「发送」（`composerSendKey` 默认 `enter`），所以在列表里
 * **唯一还能用的换行手势就是 Shift+Enter**；而 StarterKit 的 HardBreak 只会插入
 * 一个软换行——光标仍停在同一项里，第二项既拿不到编号也走不出去。
 *
 * 因此在列表项内部把 Shift+Enter 改成「新起一个同级列表项」；列表外保持原有的
 * 硬换行。代价是列表项内做不出「同一项内的软换行」，这是 Enter 发送前提下的取舍。
 */

/**
 * 光标所在块是否是一个**空白**列表项。
 *
 * 「空白」= 该项只有一个空文本块（`listItem > paragraph`，段落内容为空）。
 * 不能拿 `listItem.content.size` 判空——里面那个空段落本身也有 nodeSize。
 */
function isEmptyListItem(node: { childCount: number; firstChild: { content: { size: number }; isTextblock: boolean } | null }): boolean {
  return (
    node.childCount === 1 &&
    !!node.firstChild &&
    node.firstChild.isTextblock &&
    node.firstChild.content.size === 0
  );
}

const ListLineBreak = Extension.create({
  name: "listLineBreak",
  addKeyboardShortcuts() {
    return {
      "Shift-Enter": () => {
        const { $from } = this.editor.state.selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth);
          if (node.type.name !== "listItem") continue;
          // 空白列表项再换行 = 离开列表、回到普通文本行（Word/Notion 同款）。
          // 若在这里调 splitListItem：它对空项返回 false，按键会落到 HardBreak，
          // 结果是「项里多了一个软换行、缩进还在、没有新项」——再按一次才因为该项
          // 不再为空而裂出新项，正是用户报的那个别扭行为。
          if (isEmptyListItem(node)) {
            return this.editor.commands.liftListItem("listItem");
          }
          return this.editor.commands.splitListItem("listItem");
        }
        return false;
      },
    };
  },
});

/**
 * 硬换行之后直接敲**块标记**也要生效（`- ` / `1. ` / ```` ` / `> ` / `# ` / `---`）。
 *
 * 背景：ProseMirror 的块级输入规则都锚在**段落开头**（`^\s*([-+*])\s$`、
 * `/^```([a-z]+)?[\s\n]$/` …），而 Shift+Enter 只插入一个 `hardBreak` 叶子节点，光标
 * 仍停在同一段里——于是「换行后敲标记」永远匹配不上。本应用 Enter 被绑成发送，
 * Shift+Enter 是**唯一**的换行手势，所以「先插文件引用、再换行写清单 / 贴代码块」这类
 * 常见路径会整个卡住（验收发现）。
 *
 * 做法：不为每种标记重写一套规则，而是**识别**「光标所在行以硬换行开头」这一前提，
 * 把标记文本连同那个硬换行一起删掉、在原位裂块，再按标记把新段落变成目标块——与用户
 * 在真段首敲下标记等价。标记正则与 StarterKit 各扩展逐字一致（见下表），两处语义
 * 因此不会漂移。
 */
/**
 * 叶子节点在 ProseMirror 的 `textBetween` 里写作占位符（第 4 个参数）：文本块内每个
 * 文本字符与每个叶子恰好各占 1 个位置，所以能直接把文本下标换算成文档位置。
 *
 * 注意**不要**用正则后顾去匹配硬换行：输入规则看到的是 tiptap 另拼的一份文本
 * （`getTextContentFromNodes`，硬换行在那里是 `"\n"`），而且后顾语法会让旧版 WebKit
 * （Linux 的 WebKitGTK）的正则字面量直接报错。所以统一在 handler 里拿这份文本自己
 * 判断「行首是不是硬换行」。
 */
/** 硬换行在下面这份文本里的占位符。 */
const DOC_LEAF = "\uFFFC";
/** 其它叶子（引用 chip、技能 chip 等）：同样占 1 个位置，但不能当成换行。 */
const DOC_LEAF_OTHER = "\uFFFD";

/** 叶子节点按类型给占位符：位置换算 1:1，同时能区分「换行」与「chip」。 */
function leafPlaceholder(node: { type: { name: string } }): string {
  return node.type.name === "hardBreak" ? DOC_LEAF : DOC_LEAF_OTHER;
}

/**
 * 把裂块出来的空段落变成目标块。
 *
 * 返回 `ok: false` 表示 schema 不允许（本次输入退回纯文本）；`caret` 用于叶子块
 * （分割线）——那里没有可落光标的位置，必须显式给出新段落里的落点，不能靠
 * `Selection.near()` 去猜（它会选中分割线本身，下一次按键就把分割线替换掉）。
 */
type BlockApplyResult = { ok: boolean; caret?: number };
type BlockApply = (
  tr: Transaction,
  /** 新段落内部（内容起点）的文档位置。 */
  pos: number,
  match: RegExpMatchArray,
) => BlockApplyResult;

/** 包一层：`- ` / `1. ` 起列表，`> ` 起引用块。 */
function wrapBlock(
  name: string,
  attrsOf?: (match: RegExpMatchArray) => Record<string, unknown>,
): BlockApply {
  return (tr, pos, match) => {
    const type = tr.doc.type.schema.nodes[name];
    if (!type) return { ok: false };
    const $pos = tr.doc.resolve(pos);
    const blockRange = $pos.blockRange();
    const wrapping =
      blockRange && findWrapping(blockRange, type, attrsOf?.(match) ?? {});
    if (!blockRange || !wrapping) return { ok: false };
    tr.wrap(blockRange, wrapping);
    return { ok: true };
  };
}

/** 换块类型：代码块 / 标题。 */
function setBlockType(
  name: string,
  attrsOf?: (match: RegExpMatchArray) => Record<string, unknown>,
): BlockApply {
  return (tr, pos, match) => {
    const type = tr.doc.type.schema.nodes[name];
    if (!type) return { ok: false };
    tr.setBlockType(pos, pos, type, attrsOf?.(match) ?? {});
    return { ok: true };
  };
}

/**
 * 用整块节点替换那个空段落，并在其后补一个空段落：分割线。
 *
 * 不调 `replaceWith`：它挂的是 FitStep，拟合发生在 dispatch 时，handler 里读到的
 * 文档还不是最终形态（看不到它补出来的尾段），光标只能靠猜。这里用
 * delete + insert 把最终形态直接写死，落点因此是确定的。
 */
function replaceBlockWith(name: string): BlockApply {
  return (tr, pos) => {
    const type = tr.doc.type.schema.nodes[name];
    const paragraph = tr.doc.type.schema.nodes.paragraph;
    if (!type || !paragraph) return { ok: false };
    const paragraphStart = pos - 1;
    tr.delete(paragraphStart, paragraphStart + 2);
    tr.insert(paragraphStart, type.create());
    // 叶子块之后必须有可键入的文本块（与标准规则留下的形状一致）
    tr.insert(paragraphStart + 1, paragraph.create());
    return { ok: true, caret: paragraphStart + 2 };
  };
}

/**
 * 支持的块标记。正则与 StarterKit 各扩展**逐字一致**（含它把 em dash 也当分隔线的
 * 写法），避免「段首能起、换行后不能起」这类不一致。
 */
const BLOCK_MARKERS: readonly { find: RegExp; apply: BlockApply }[] = [
  { find: /^\s*([-+*])\s$/, apply: wrapBlock("bulletList") },
  {
    find: /^\s*(\d+)\.\s$/,
    apply: wrapBlock("orderedList", (m) => ({ start: Number(m[1]) || 1 })),
  },
  {
    find: /^```([a-z]+)?[\s\n]$/,
    apply: setBlockType("codeBlock", (m) => ({ language: m[1] ?? null })),
  },
  {
    find: /^~~~([a-z]+)?[\s\n]$/,
    apply: setBlockType("codeBlock", (m) => ({ language: m[1] ?? null })),
  },
  { find: /^\s*>\s$/, apply: wrapBlock("blockquote") },
  {
    find: /^(#{1,3})\s$/,
    apply: setBlockType("heading", (m) => ({ level: m[1].length })),
  },
  {
    find: /^(?:---|—-|___\s|\*\*\*\s)$/,
    apply: replaceBlockWith("horizontalRule"),
  },
];

function blockAfterBreakRules(): InputRule[] {
  return [
    new InputRule({
      // 每个字符都过一遍：标记可能是「标记 + 空格」（`- `），也可能自成一体（`---`）
      find: /([\s\S])$/,
      handler: ({ state, match }) => {
        const typed = match[1] ?? "";
        const $from = state.selection.$from;
        if (!$from.parent.isTextblock) return null;
        // 光标之前（不含刚敲下的那一下）的这份文本里，叶子各占 1 个位置
        const before = $from.parent.textBetween(
          0,
          $from.parentOffset,
          null,
          leafPlaceholder,
        );
        const breakIndex = before.lastIndexOf(DOC_LEAF);
        if (breakIndex < 0) return null;
        const breakPos = $from.start() + breakIndex;
        // 用文档本身确认一次：正文里手打的 U+FFFC 不该被当成换行
        if (state.doc.nodeAt(breakPos)?.type.name !== "hardBreak") return null;
        // 当前行（不含换行，含刚敲下的那一下）——与标准规则在段首看到的是同一串
        const line = before.slice(breakIndex + 1) + typed;
        const marker = BLOCK_MARKERS.find((m) => m.find.test(line));
        const markerMatch = marker ? line.match(marker.find) : null;
        if (!marker || !markerMatch) return null;

        const tr = state.tr;
        tr.delete(breakPos, $from.pos); // 去掉硬换行与标记（刚敲的那一下并未入库）
        tr.split(breakPos); // 在原位裂块：标记所在的那一行成为新段落
        // 裂块后 breakPos 是两个段落之间的边界：+1 是段落的开标记，+2 才是内容起点
        const pos = breakPos + 2;
        if (!marker.apply(tr, pos, markerMatch)) return null;
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
        // 不必返回 transaction：tiptap 检查上面这个 tr 的 steps 后统一 dispatch
      },
    }),
  ];
}

const BlockAfterBreak = Extension.create({
  name: "blockAfterBreak",
  addInputRules() {
    return blockAfterBreakRules();
  },
});

export type ComposerExtensionOptions = {
  /** 空文档时显示的占位符。 */
  placeholder?: string;
  /** 是否在可编辑时显示占位符（测试用 headless 编辑器通常为 false）。 */
  showPlaceholderWhenEditable?: boolean;
};
/**
 * 代码块的语言栏数据源：把节点的 `language` 镜像成 DOM 上的 `data-language`。
 *
 * 用装饰器加**属性**，而不是自定义 NodeView：编辑器的存储态序列化会遍历 DOM
 * （`draftDoc.serializeEditorDomWalk`），NodeView 里多出来的语言栏元素会被当成
 * 正文；装饰器不进文档模型，markdown 往返、光标坐标都不受影响。
 *
 * 语言文本本身已由 tiptap 的 codeBlock 渲染成 `<code class="language-js">`，
 * 这里只是让 CSS 能用 `content: attr(data-language)` 把它显示出来
 * （对齐聊天侧 `.chat-code__lang`，输入框不提供复制按钮）。
 */
const CodeBlockLanguageLabel = Extension.create({
  name: "codeBlockLanguageLabel",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("codeBlockLanguageLabel"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "codeBlock") return;
              const language = String(node.attrs.language ?? "").trim();
              if (!language) return;
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  "data-language": language,
                }),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

/** 构建 composer 使用的扩展数组。 */
export function buildComposerExtensions(opts: ComposerExtensionOptions = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: false },
    }),
    SkillTokenNode,
    RefTokenNode,
    ListLineBreak,
    BlockAfterBreak,
    ComposerGhostGuard,
    ComposerMarkdownPaste,
    CodeBlockLanguageLabel,
    Placeholder.configure({
      placeholder: opts.placeholder ?? "",
      showOnlyWhenEditable: opts.showPlaceholderWhenEditable ?? true,
    }),
    Markdown.configure({
      html: false,
      // breaks: 保证 Shift+Enter 硬换行在 "line1\nline2" 序列化下可回解析。
      breaks: true,
      linkify: false,
      transformPastedText: true,
      transformCopiedText: false,
    }),
  ];
}
