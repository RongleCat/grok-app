/** Markdown 粘贴来源的行首块级记号。 */

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

