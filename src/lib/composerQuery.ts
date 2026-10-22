/**
 * 光标前的 `${trigger}query` 检测，坐标为 **ProseMirror 文档位置**（ADR 0003）。
 *
 * 取代过去「序列化 Markdown → lastIndexOf 搜索 `@query`」的字符串法：查询区间
 * 直接由文档与选区算出，插入时可用同一组位置做一次 transaction，不再需要
 * Markdown / DOM / 手搓文本三套坐标之间换算。
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** 光标前的 `${trigger}query` 区间；`from`/`to` 是 ProseMirror 文档位置（`to` 独占）。 */
export type ComposerQueryRange = { from: number; to: number; query: string };

/**
 * 原子节点在内联文本里的占位字符（OBJECT REPLACEMENT CHARACTER）。
 *
 * `textBetween` 用同一个字符替换每个 leaf 原子节点，使返回字符串的下标与
 * 父节点内的 PM position 一一对应（每个字符 / 原子各占一个位置）。
 */
const ATOM_LEAF = "￼";

/**
 * `textBetween` 的 leaf 文本：**硬换行算换行**，其余叶子用占位字符。
 *
 * 软换行（Shift+Enter 产生的 `hardBreak`）是空白，必须能作为 `${trigger}` 的
 * 边界 —— 否则「软换行后紧接着打 @」会因为前一个字符是占位符而被判成不触发。
 * 它同样是单个字符，位置映射仍是一对一。
 */
export function composerLeafText(leaf: ProseMirrorNode): string {
  return leaf.type.name === "hardBreak" ? "\n" : ATOM_LEAF;
}

/**
 * 取光标前同一文本块内、位于光标之前的 `${trigger}query` 区间。
 *
 * 规则（与 slash 同构）：
 * - 光标必须落在文本块内，否则返回 null；
 * - `trigger` 必须位于下标 0 或紧跟空白之后（`user@host` 这类前面是字母的不算）；
 * - `query` 是 trigger 之后到光标之间的非空白、非占位字符；遇到空白或原子节点即终止。
 *
 * 无合法 trigger 时返回 null。只用到光标之前的内容，因此 `@atF[[file:…]]`
 * （光标停在既有 chip 前）仍能识别出 `atF`。
 */
export function queryRangeBeforeCaret(
  doc: ProseMirrorNode,
  caretPos: number,
  trigger: "@" | "/",
): ComposerQueryRange | null {
  if (caretPos < 0 || caretPos > doc.content.size) return null;
  const $from = doc.resolve(caretPos);
  if (!$from.parent.isTextblock) return null;

  const before = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    composerLeafText,
  );
  // 独占结尾的锚点保证 query 一直延伸到光标；`[^\s￼]*` 使其在空白或原子
  // 节点处终止。左起首个合法匹配必然是唯一匹配：两个合法 trigger 之间不可能
  // 既无空白又都满足边界条件。
  // 全角 ＠ / ／ 与半角等宽，折叠后文档位置仍指向原来的那个字符。
  const folded = before.replace(/\uFF20/g, "@").replace(/\uFF0F/g, "/");
  const escaped = trigger === "@" ? "@" : "\\/";
  const m = new RegExp(`(^|\\s)${escaped}([^\\s\\uFFFC]*)$`, "u").exec(folded);
  if (!m) return null;

  const start = m.index + m[1]!.length;
  return {
    from: $from.start() + start,
    to: $from.start() + $from.parentOffset,
    query: m[2]!,
  };
}
