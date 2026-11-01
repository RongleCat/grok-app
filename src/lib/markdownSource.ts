/**
 * Markdown 源码扫描与展示解码。
 *
 * 序列化器会给字面文本加防御性转义（`\#` / `1\.`），tiptap-markdown 的 text
 * 序列化器还会把 `<` `>` 写成 HTML 实体。这些在 draft / 提示词里是必要的：
 * 再解析时仍是字面文本。但用户气泡直接展示源码，转义和实体就成了噪音。
 *
 * 所有转换只作用于围栏代码块与行内代码之外；代码里的反斜杠是用户原样输入的。
 */

/** 行首的围栏记号。序列化器只产出顶格 ``` / ~~~。 */
function fenceCharAt(md: string, i: number): "`" | "~" | null {
  if (i > 0 && md[i - 1] !== "\n") return null;
  if (md.startsWith("```", i)) return "`";
  if (md.startsWith("~~~", i)) return "~";
  return null;
}

function consumeFence(md: string, i: number, ch: "`" | "~"): number {
  const fence = ch.repeat(3);
  const lineEnd = md.indexOf("\n", i);
  if (lineEnd === -1) return md.length;
  let j = lineEnd + 1;
  while (j < md.length) {
    if ((j === 0 || md[j - 1] === "\n") && md.startsWith(fence, j)) {
      let k = j + fence.length;
      while (k < md.length && (md[k] === " " || md[k] === "\t")) k += 1;
      if (k === md.length || md[k] === "\n") {
        return md[k] === "\n" ? k + 1 : k;
      }
    }
    const next = md.indexOf("\n", j);
    if (next === -1) return md.length;
    j = next + 1;
  }
  return md.length;
}

/** 成对的行内反引号（含 `` ` `` 的多反引号形式）。未闭合则返回 null。 */
function consumeInlineCode(md: string, i: number): number | null {
  let n = 0;
  while (i + n < md.length && md[i + n] === "`") n += 1;
  if (n === 0) return null;
  const closer = "`".repeat(n);
  const close = md.indexOf(closer, i + n);
  if (close === -1) return null;
  return close + n;
}

/**
 * 把 `md` 拆成「代码」与「正文」两类片段，只对正文调用 `transform`。
 *
 * 代码片段（围栏块、行内代码）按原样保留；正文按扫描顺序拼接后一次交给
 * `transform`，避免正则被片段边界切断。
 */
export function transformOutsideCode(
  md: string,
  transform: (plain: string) => string,
): string {
  let i = 0;
  let out = "";
  let plain = "";
  const flush = () => {
    if (!plain) return;
    out += transform(plain);
    plain = "";
  };
  while (i < md.length) {
    const fence = fenceCharAt(md, i);
    if (fence) {
      flush();
      const end = consumeFence(md, i, fence);
      out += md.slice(i, end);
      i = end;
      continue;
    }
    const inlineEnd = md[i] === "`" ? consumeInlineCode(md, i) : null;
    if (inlineEnd != null) {
      flush();
      out += md.slice(i, inlineEnd);
      i = inlineEnd;
      continue;
    }
    plain += md[i];
    i += 1;
  }
  flush();
  return out;
}

/**
 * 还原展示态的防御性转义：`\#` → `#`、`1\.` → `1.`、`&gt;` → `>`。
 *
 * 只处理序列化器会产出的形式（ASCII 标点转义与 `&lt;` / `&gt;` 实体），
 * 用户输入的其他反斜杠组合保持原样。代码块 / 行内代码内部不处理。
 */
export function decodeMarkdownDisplayText(text: string): string {
  return transformOutsideCode(text, (plain) =>
    plain
      .replace(/\\([\\`*_[\]~#.+\-!>(){}|=])/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}

/**
 * 用户气泡的换行还原：输入框里每个 `\n` 都是硬换行（编辑器 `breaks: true`）。
 *
 * react-markdown 按 CommonMark 把段内单个换行当软换行，HTML 里会并成一行，气泡
 * 因此和编辑器不一致。这里在渲染前给正文行尾补两个空格，把段内换行变成 CommonMark
 * 硬换行；空行不补，围栏与行内代码保持原样。
 */
export function hardenUserLineBreaks(markdown: string): string {
  return transformOutsideCode(markdown, (plain) =>
    plain
      .split("\n")
      .map((line, index, lines) =>
        index < lines.length - 1 && line.trim() ? `${line}  ` : line,
      )
      .join("\n"),
  );
}
