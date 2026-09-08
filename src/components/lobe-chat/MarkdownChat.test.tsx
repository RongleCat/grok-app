/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  MARKDOWN_CHAT_LEAF_COMPONENTS,
  MARKDOWN_CHAT_REHYPE_PLUGINS,
  MARKDOWN_CHAT_REMARK_PLUGINS,
  MarkdownChat,
} from "./MarkdownChat";
import { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS } from "@/lib/markdownMath";

afterEach(cleanup);

describe("MarkdownChat", () => {
  it("keeps a stable remarkPlugins array", () => {
    expect(MARKDOWN_CHAT_REMARK_PLUGINS).toBe(MARKDOWN_REMARK_PLUGINS);
    expect(MARKDOWN_CHAT_REHYPE_PLUGINS).toBe(MARKDOWN_REHYPE_PLUGINS);
    expect(MARKDOWN_CHAT_REMARK_PLUGINS[0]).toBe(remarkGfm);
    expect(MARKDOWN_CHAT_REMARK_PLUGINS[1]).toBe(remarkMath);
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

  it("resets find occurrence indices when the same components map paints more text", () => {
    const { rerender, container } = render(
      <MarkdownChat findQuery="foo" findActiveOccurrence={0}>
        {"foo"}
      </MarkdownChat>,
    );
    expect(container.querySelectorAll("[data-find-mark='current']")).toHaveLength(
      1,
    );
    rerender(
      <MarkdownChat findQuery="foo" findActiveOccurrence={0}>
        {"foo and foo"}
      </MarkdownChat>,
    );
    const currents = container.querySelectorAll("[data-find-mark='current']");
    expect(currents).toHaveLength(1);
    expect(currents[0]?.textContent).toBe("foo");
    expect(container.querySelectorAll("[data-find-mark]")).toHaveLength(2);
  });

  it("renders inline and display LaTeX with KaTeX", () => {
    const inline = renderToStaticMarkup(
      <MarkdownChat>{"Energy is $E=mc^2$."}</MarkdownChat>,
    );
    expect(inline).toContain("katex");
    expect(inline).toContain("E");
    const block = renderToStaticMarkup(
      <MarkdownChat>{"$$\n\\int_0^1 x\\,dx\n$$"}</MarkdownChat>,
    );
    expect(block).toContain("katex");
    expect(block).toContain("katex-display");
  });

  it("routes mermaid fences to MermaidBlock chrome", () => {
    const html = renderToStaticMarkup(
      <MarkdownChat>
        {"```mermaid\nflowchart LR\n  A-->B\n```"}
      </MarkdownChat>,
    );
    expect(html).toContain("chat-mermaid");
    expect(html).toContain("flowchart LR");
  });
});
