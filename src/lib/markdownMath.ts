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

/** Skip remark-math + KaTeX when the source has no math delimiters. */
export function sourceHasMath(src: string): boolean {
  if (!src) return false;
  return /\$\$|\$[^$\n]|\\\[|\\\(/.test(src);
}
