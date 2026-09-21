/**
 * Shared remark/rehype plugins for chat + preview markdown.
 * GFM + KaTeX ($…$ / $$…$$ and \(…\) / \[…\]).
 */

import type { Options } from "react-markdown";
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

export function normalizeMarkdownMath(src: string): string {
  if (!src) return src;
  let out = src.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `$$${body}$$`);
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body}$`);
  out = out.replace(
    /^[ \t]*\[(?!\s*$)(?![^\]]+\]\()([^\n]+)\][ \t]*$/gm,
    (full, body: string) => (LATEX_HINT.test(body) ? `$$${body}$$` : full),
  );
  return out;
}

/** Skip remark-math + KaTeX when the source has no math delimiters. */
export function sourceHasMath(src: string): boolean {
  if (!src) return false;
  if (/\$\$|\$[^$\n]|\\\[|\\\(/.test(src)) return true;
  return LATEX_HINT.test(src) && /^[ \t]*\[[^\n]+\][ \t]*$/m.test(src);
}
