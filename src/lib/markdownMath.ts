/**
 * Shared remark/rehype plugins for chat + preview markdown.
 * GFM + KaTeX ($…$ / $$…$$ and \(…\) / \[…\]).
 */

import type { Options } from "react-markdown";
// Email autolink is patched in patches/mdast-util-gfm-autolink-literal@2.0.1.patch.
// Upstream's lookbehind throws on macOS 12 WKWebView (#1347).
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/**
 * KaTeX styles load with the first markdown processor instead of from
 * main.tsx — keeps ~30KB of @font-face CSS (plus fonts) off the boot
 * critical path. The plugin's transformer is a no-op; the import fires on
 * attach, and repeat mounts hit the module cache. Typed loosely because
 * unified's Plugin type is not a direct dependency.
 */
const rehypeKatexCssLoader = () => {
  void import("katex/dist/katex.min.css");
  return () => undefined;
};

export const MARKDOWN_REMARK_PLUGINS_GFM: NonNullable<Options["remarkPlugins"]> =
  [remarkGfm];

export const MARKDOWN_REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [
  remarkGfm,
  remarkMath,
];

export const MARKDOWN_REHYPE_PLUGINS_NO_MATH: NonNullable<
  Options["rehypePlugins"]
> = [];

export const MARKDOWN_REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [
  rehypeKatexCssLoader,
  [
    rehypeKatex,
    {
      throwOnError: false,
      errorColor: "#c44",
      strict: "ignore",
      output: "html",
      trust: false,
    },
  ],
];

/**
 * CommonMark treats `\[` as an escaped `[`, so remark-math never sees
 * display TeX. Grok (and other Chinese models) also emit one-line
 * `[ \int ... ]`. Rewrite those to `$` / `$$` before parse (#1238).
 */
const LATEX_HINT =
  /\\(?:int|sum|prod|frac|sqrt|mathrm|mathbf|operatorname|begin|end|left|right|bigl|bigr|Bigl|Bigr|cdot|times|alpha|beta|gamma|pi|theta|infty|partial|nabla|leq|geq|neq|to|rightarrow)|[_^]\s*\{/;

/**
 * One rewrite pass of math normalization. `pattern` must be a global regex;
 * `rewrite` receives the full match and the captured body and returns the
 * replacement (returning `full` keeps the text unchanged).
 *
 * The stream-reveal offset mapping
 * (`streamReveal.mapOffsetsThroughNormalization`) reuses this table, so the
 * rewrite order and implementation have a single source.
 */
export type MarkdownMathRewrite = {
  pattern: RegExp;
  rewrite: (full: string, body: string) => string;
};

export const MARKDOWN_MATH_REWRITES: readonly MarkdownMathRewrite[] = [
  { pattern: /\\\[([\s\S]+?)\\\]/g, rewrite: (_full, body) => `$$${body}$$` },
  { pattern: /\\\(([\s\S]+?)\\\)/g, rewrite: (_full, body) => `$${body}$` },
  {
    pattern: /^[ \t]*\[(?!\s*$)(?![^\]]+\]\()([^\n]+)\][ \t]*$/gm,
    rewrite: (full, body) => (LATEX_HINT.test(body) ? `$$${body}$$` : full),
  },
];

export type MarkdownMathRewriteMatch = {
  start: number;
  end: number;
  replacement: string;
};

/**
 * Runs one rewrite and returns the before / after offset pairs (`start` /
 * `end` are pre-rewrite coordinates). Matches `String.prototype.replace`
 * global semantics so normalization and offset mapping can share it.
 */
export function applyMarkdownMathRewrite(
  src: string,
  rewrite: MarkdownMathRewrite,
): { text: string; matches: MarkdownMathRewriteMatch[] } {
  // Clone the regex: a global regex reuses lastIndex, so state must not leak
  // across calls.
  const pattern = new RegExp(rewrite.pattern.source, rewrite.pattern.flags);
  const matches: MarkdownMathRewriteMatch[] = [];
  let out = "";
  let cursor = 0;
  for (const match of src.matchAll(pattern)) {
    const full = match[0];
    const start = match.index ?? cursor;
    const replacement = rewrite.rewrite(
      full,
      (match[1] as string | undefined) ?? "",
    );
    out += src.slice(cursor, start);
    out += replacement;
    cursor = start + full.length;
    if (replacement !== full) {
      matches.push({ start, end: cursor, replacement });
    }
  }
  out += src.slice(cursor);
  return { text: out, matches };
}

export function normalizeMarkdownMath(src: string): string {
  if (!src) return src;
  return MARKDOWN_MATH_REWRITES.reduce(
    (acc, rewrite) => applyMarkdownMathRewrite(acc, rewrite).text,
    src,
  );
}

/** Skip remark-math + KaTeX when the source has no math delimiters. */
export function sourceHasMath(src: string): boolean {
  if (!src) return false;
  if (/\$\$|\$[^$\n]|\\\[|\\\(/.test(src)) return true;
  return LATEX_HINT.test(src) && /^[ \t]*\[[^\n]+\][ \t]*$/m.test(src);
}
