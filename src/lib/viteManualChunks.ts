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
  if (
    rest.startsWith("react-markdown/") ||
    rest.startsWith("remark-gfm/") ||
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
