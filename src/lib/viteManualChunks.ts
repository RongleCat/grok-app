/**
 * Vite `manualChunks` matcher. Only vite.config.ts should import this.
 * Windows module ids use backslash — normalize before matching.
 */
export function vendorManualChunk(id: string): string | undefined {
  const n = id.replace(/\\/g, "/");
  const marker = "/node_modules/";
  const at = n.lastIndexOf(marker);
  if (at < 0) return;
  const rest = n.slice(at + marker.length);

  // React core gets its own chunk: manual chunks opt out of Rollup's auto
  // splitting, so a feature vendor chunk that also holds react-dom becomes a
  // static dependency of every shell that uses JSX — entry included (this is
  // what forced the 533KB tiptap chunk into the boot preload list).
  if (
    rest.startsWith("react/") ||
    rest.startsWith("react-dom/") ||
    rest.startsWith("react-is/") ||
    rest.startsWith("scheduler/")
  ) {
    return "framework";
  }
  if (rest.startsWith("@xterm/") || rest.startsWith("xterm/")) {
    return "xterm";
  }
  if (
    rest.startsWith("@tiptap/") ||
    rest.startsWith("tiptap-markdown/") ||
    rest.startsWith("prosemirror-")
  ) {
    return "tiptap";
  }
  // Keep CodeMirror + style-mod + lezer in one chunk so StyleModule /
  // HighlightStyle tag identity stay single-instance after code-splitting.
  if (
    rest.startsWith("@codemirror/") ||
    rest.startsWith("@lezer/") ||
    rest.startsWith("style-mod/") ||
    rest.startsWith("crelt/") ||
    rest.startsWith("w3c-keyname/")
  ) {
    return "codemirror";
  }
  if (
    rest.startsWith("react-markdown/") ||
    rest.startsWith("remark-gfm/") ||
    rest.startsWith("remark-math/") ||
    rest.startsWith("rehype-katex/") ||
    rest.startsWith("katex/") ||
    rest.startsWith("remark-parse/") ||
    rest.startsWith("remark-rehype/") ||
    rest.startsWith("micromark/") ||
    rest.startsWith("micromark-") ||
    rest.startsWith("mdast-util-") ||
    rest.startsWith("unist-util-") ||
    rest.startsWith("hast-util-") ||
    rest.startsWith("unified/") ||
    rest.startsWith("vfile/") ||
    rest.startsWith("vfile-message/") ||
    rest.startsWith("property-information/") ||
    rest.startsWith("comma-separated-tokens/") ||
    rest.startsWith("space-separated-tokens/") ||
    rest.startsWith("decode-named-character-reference/") ||
    rest.startsWith("character-entities") ||
    rest.startsWith("ccount/") ||
    rest.startsWith("escape-string-regexp/") ||
    rest.startsWith("trim-lines/") ||
    rest.startsWith("longest-streak/") ||
    rest.startsWith("zwitch/") ||
    rest.startsWith("markdown-table/") ||
    rest.startsWith("devlop/") ||
    rest.startsWith("estree-util-") ||
    rest.startsWith("html-url-attributes/") ||
    rest.startsWith("mdast-util-to-hast/") ||
    rest.startsWith("mdast-util-to-string/")
  ) {
    return "markdown";
  }
}
