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

function runLength(src: string, i: number, ch: string): number {
  let n = 0;
  while (i + n < src.length && src[i + n] === ch) n += 1;
  return n;
}

function lineEndAt(src: string, i: number): number {
  if (src[i] === "\r") return src[i + 1] === "\n" ? i + 2 : i + 1;
  if (src[i] === "\n") return i + 1;
  return i;
}

function isFenceLineEnd(src: string, i: number): boolean {
  return i >= src.length || src[i] === "\n" || src[i] === "\r";
}

/** Opening fence at a line start, or null. `end` is just past that line. */
function fenceOpen(
  src: string,
  i: number,
): { marker: string; len: number; end: number } | null {
  if (!(i === 0 || src[i - 1] === "\n" || src[i - 1] === "\r")) return null;
  let j = i;
  let spaces = 0;
  while (spaces < 3 && src[j] === " ") {
    spaces += 1;
    j += 1;
  }
  const marker = src[j];
  if (marker !== "`" && marker !== "~") return null;
  const len = runLength(src, j, marker);
  if (len < 3) return null;
  let k = j + len;
  while (k < src.length && src[k] !== "\n" && src[k] !== "\r") {
    // A backtick fence whose info string contains ` is not a fence.
    if (marker === "`" && src[k] === "`") return null;
    k += 1;
  }
  return { marker, len, end: lineEndAt(src, k) };
}

function fenceClose(
  src: string,
  from: number,
  marker: string,
  len: number,
): number | null {
  let i = from;
  while (i < src.length) {
    if (i === 0 || src[i - 1] === "\n" || src[i - 1] === "\r") {
      let j = i;
      let spaces = 0;
      while (spaces < 3 && src[j] === " ") {
        spaces += 1;
        j += 1;
      }
      if (src[j] === marker) {
        const run = runLength(src, j, marker);
        let k = j + run;
        while (src[k] === " " || src[k] === "\t") k += 1;
        if (run >= len && isFenceLineEnd(src, k)) return lineEndAt(src, k);
      }
    }
    i += 1;
  }
  return null;
}

function inlineCodeEnd(src: string, from: number, len: number): number | null {
  let i = from;
  while (i < src.length) {
    if (src[i] !== "`") {
      i += 1;
      continue;
    }
    const run = runLength(src, i, "`");
    if (run === len) return i + run;
    i += run;
  }
  return null;
}

/** Fenced and inline code spans. An unclosed fence runs through the end. */
function codeSpans(src: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < src.length) {
    const fence = fenceOpen(src, i);
    if (fence) {
      const close = fenceClose(src, fence.end, fence.marker, fence.len);
      const end = close ?? src.length;
      spans.push({ start: i, end });
      i = end;
      continue;
    }
    if (src[i] === "`") {
      const len = runLength(src, i, "`");
      const close = inlineCodeEnd(src, i + len, len);
      if (close != null) {
        spans.push({ start: i, end: close });
        i = close;
        continue;
      }
    }
    i += 1;
  }
  return spans;
}

function startsOnLine(src: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = src[index - 1];
  return prev === "\n" || prev === "\r";
}

function rewriteMathChunk(chunk: string, atLineStart: boolean): string {
  if (!chunk) return chunk;
  // A chunk that begins mid-line must not let `^` treat that cut as a new line.
  const body = atLineStart ? chunk : `\u0000${chunk}`;
  let out = body.replace(/\\\[([\s\S]+?)\\\]/g, (_m, inner: string) => `$$${inner}$$`);
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, inner: string) => `$${inner}$`);
  out = out.replace(
    /^[ \t]*\[(?!\s*$)(?![^\]]+\]\()([^\n]+)\][ \t]*$/gm,
    (full, inner: string) => (LATEX_HINT.test(inner) ? `$$${inner}$$` : full),
  );
  return atLineStart ? out : out.slice(1);
}

function chunkHasMath(chunk: string, atLineStart: boolean): boolean {
  if (!chunk) return false;
  const body = atLineStart ? chunk : `\u0000${chunk}`;
  if (/\$\$|\$[^$\n]|\\\[|\\\(/.test(body)) return true;
  return LATEX_HINT.test(body) && /^[ \t]*\[[^\n]+\][ \t]*$/m.test(body);
}

/** Text outside fenced and inline code, in order. */
function outsideCode(src: string): Array<{ text: string; atLineStart: boolean }> {
  const spans = codeSpans(src);
  const parts: Array<{ text: string; atLineStart: boolean }> = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      parts.push({
        text: src.slice(cursor, span.start),
        atLineStart: startsOnLine(src, cursor),
      });
    }
    cursor = span.end;
  }
  if (cursor < src.length) {
    parts.push({
      text: src.slice(cursor),
      atLineStart: startsOnLine(src, cursor),
    });
  }
  return parts;
}

export function normalizeMarkdownMath(src: string): string {
  if (!src) return src;
  const spans = codeSpans(src);
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += rewriteMathChunk(src.slice(cursor, span.start), startsOnLine(src, cursor));
    out += src.slice(span.start, span.end);
    cursor = span.end;
  }
  out += rewriteMathChunk(src.slice(cursor), startsOnLine(src, cursor));
  return out;
}

/** Skip remark-math + KaTeX when the source has no math delimiters. */
export function sourceHasMath(src: string): boolean {
  if (!src) return false;
  return outsideCode(src).some((part) => chunkHasMath(part.text, part.atLineStart));
}
