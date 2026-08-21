import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import remarkGfm from "remark-gfm";
import {
  MARKDOWN_CHAT_LEAF_COMPONENTS,
  MARKDOWN_CHAT_REMARK_PLUGINS,
  MarkdownChat,
} from "./MarkdownChat";

describe("MarkdownChat", () => {
  it("keeps a stable remarkPlugins array", () => {
    expect(MARKDOWN_CHAT_REMARK_PLUGINS).toEqual([remarkGfm]);
    expect(MARKDOWN_CHAT_REMARK_PLUGINS[0]).toBe(remarkGfm);
  });

  it("reuses module-level leaf components when find is off", () => {
    expect(MARKDOWN_CHAT_LEAF_COMPONENTS.p).toBe(
      MARKDOWN_CHAT_LEAF_COMPONENTS.p,
    );
    expect(MARKDOWN_CHAT_LEAF_COMPONENTS.pre).toBeDefined();
    expect(MARKDOWN_CHAT_LEAF_COMPONENTS.hr).toBeDefined();
  });

  it("turns http links into path cards and keeps inline code", () => {
    const html = renderToStaticMarkup(
      <MarkdownChat>
        {"See [docs](https://example.com/path) and `code`."}
      </MarkdownChat>,
    );
    expect(html).toContain("file-path-card--url");
    expect(html).toContain("example.com");
    expect(html).toContain("chat-md__inline-code");
    expect(html).toContain("code");
  });

  it("highlights find hits in string leaves", () => {
    const html = renderToStaticMarkup(
      <MarkdownChat findQuery="please">
        {"Hello please stay."}
      </MarkdownChat>,
    );
    expect(html).toContain("please");
  });
});
