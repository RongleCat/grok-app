/**
 * Markdown 行首块级记号：粘贴来源判定与序列化防歧义共用同一份规则。
 *
 * 两处需求不同、规则必须同步：
 * - 粘贴判定要知道一段纯文本像不像 Markdown 源码；
 * - 序列化归一化要让硬换行后的行在再解析时保持字面量。
 *
 * 规则分开维护时两侧已经漂移过（setext `===` 与表格 `|` 漏转义），因此集中在这里。
 */

/** 行首块级记号，允许至多 3 个缩进空格。 */
const BLOCK_START_PATTERNS = [
  /^ {0,3}#{1,6}(?:[ \t]|$)/, // ATX 标题
  /^ {0,3}(?:```|~~~)/, // 围栏
  /^ {0,3}>/, // 引用
  /^ {0,3}[-*+][ \t]/, // 无序列表
  /^ {0,3}\d{1,9}[.)][ \t]/, // 有序列表
  /^ {0,3}\|/, // 表格行
  /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/, // 分隔线
  /^ {0,3}=+[ \t]*$/, // setext 下划线
];

/** 该行以 Markdown 块级记号开头。 */
function isMarkdownBlockStart(line: string): boolean {
  return BLOCK_START_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * 纯文本是否像一段 Markdown 块级源码：至少两行，且有一行以块级记号开头。
 *
 * 多行普通段落（例如网页上的两句话）不含块级记号，仍按行内处理；单行
 * `# 话题` / `- 一句话` 与普通句子无法区分，按字面量处理。
 */
export function looksLikeMarkdownBlockSource(markdown: string): boolean {
  const lines = markdown.split("\n");
  return lines.length >= 2 && lines.some(isMarkdownBlockStart);
}

/**
 * 让一行在再解析时保持字面量：在行首块级记号前补反斜杠。
 *
 * `#` / `-` / `+` / `>` / `|` / `=` 都是可转义标点；有序列表转义分隔符
 * （`1\.`），转义数字会让反斜杠显示出来。分隔线逐个转义：只转义第一个字符
 * 会留下可以和后文配对的 `**`。
 */
export function escapeMarkdownLineStart(line: string): string {
  if (!isMarkdownBlockStart(line)) return line;
  const indent = /^ {0,3}/.exec(line)?.[0] ?? "";
  const rest = line.slice(indent.length);
  const ordered = /^(\d{1,9})([.)])(?:[ \t]|$)/.exec(rest);
  if (ordered) {
    return `${indent}${ordered[1]}\\${rest.slice(ordered[1].length)}`;
  }
  if (/^[*_]/.test(rest)) {
    return `${indent}${rest.replace(/([*_])/g, "\\$1")}`;
  }
  return `${indent}\\${rest}`;
}
