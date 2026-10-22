/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, render } from "@testing-library/react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  MARKDOWN_CHAT_LEAF_COMPONENTS,
  MARKDOWN_CHAT_REHYPE_PLUGINS,
  MARKDOWN_CHAT_REMARK_PLUGINS,
  MarkdownChat,
} from "./MarkdownChat";
import { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS } from "@/lib/markdownMath";
import { FILE_PATH_CARD_BASENAME_STORAGE_KEY } from "@/lib/filePathCardPref";
import { resetFilePathResolveCacheForTests } from "@/lib/filePathResolveCache";
import { saveOutputMotionPref } from "@/lib/outputMotionPref";
import {
  STREAM_REVEAL_MAX_CHARS,
  STREAM_REVEAL_MAX_SPANS,
} from "@/lib/streamRenderPolicy";

afterEach(() => {
  cleanup();
  saveOutputMotionPref(true);
  window.localStorage.removeItem(FILE_PATH_CARD_BASENAME_STORAGE_KEY);
  resetFilePathResolveCacheForTests();
});

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

  it("renders \\[ \\] display and \\( \\) inline TeX", () => {
    const block = renderToStaticMarkup(
      <MarkdownChat>{"\\[ I=\\int_1^2 x^2 \\, dx \\]"}</MarkdownChat>,
    );
    expect(block).toContain("katex");
    const inline = renderToStaticMarkup(
      <MarkdownChat>{"Energy is \\(E=mc^2\\)."}</MarkdownChat>,
    );
    expect(inline).toContain("katex");
  });

  it("renders a one-line bracket TeX formula like Grok often emits", () => {
    const html = renderToStaticMarkup(
      <MarkdownChat>
        {"[ I=\\int_1^2\\frac{x^2}{2}\\mathrm{d}x. ]"}
      </MarkdownChat>,
    );
    expect(html).toContain("katex");
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

  it("does not put a pathMap absolute on the chip when as-written is on", () => {
    resetFilePathResolveCacheForTests();
    window.localStorage.setItem(FILE_PATH_CARD_BASENAME_STORAGE_KEY, "0");
    const written = "src/lib/filePathCardPref.ts";
    const abs =
      "/Users/yangzongru/Documents/CodeGitHub/grok-app/src/lib/filePathCardPref.ts";
    const html = renderToStaticMarkup(
      <MarkdownChat
        projectPath="/Users/yangzongru/Documents/CodeGitHub/grok-app"
        imagePathMap={{ [written]: abs }}
      >
        {`See \`${written}\`.`}
      </MarkdownChat>,
    );
    expect(html).toContain("file-path-card");
    expect(html).toMatch(
      new RegExp(
        `file-path-card__name[^>]*>${written.replace(/\./g, "\\.")}<`,
      ),
    );
    expect(html).not.toMatch(
      /file-path-card__name[^>]*>\/Users\/yangzongru/,
    );
  });
});

describe("MarkdownChat stream reveal", () => {
  const revealFlags = (root: HTMLElement): string[] =>
    Array.from(root.querySelectorAll("[data-reveal]")).map(
      (node) => node.getAttribute("data-reveal") ?? "",
    );
  const revealIndexes = (root: HTMLElement): string[] =>
    Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]")).map(
      (node) => node.style.getPropertyValue("--reveal-i"),
    );

  it("does not animate text that was already there on mount", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <MarkdownChat streaming chunkEnds={[6, 12]}>
          {"Hello world."}
        </MarkdownChat>,
      );
      expect(revealFlags(container)).toEqual(["0", "0"]);

      rerender(
        <MarkdownChat streaming chunkEnds={[6, 12, 16]}>
          {"Hello world. Yes"}
        </MarkdownChat>,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(revealFlags(container)).toEqual(["0", "0", "1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not animate the first chunk painted at mount", () => {
    const { container } = render(
      <MarkdownChat streaming chunkEnds={[6]}>
        {"Hello "}
      </MarkdownChat>,
    );

    expect(revealFlags(container)).toEqual(["0"]);
  });

  it("does not replay a single-chunk thought after a remount", () => {
    const first = render(
      <MarkdownChat streaming chunkEnds={[6]}>
        {"Hello "}
      </MarkdownChat>,
    );
    first.unmount();

    const second = render(
      <MarkdownChat streaming chunkEnds={[6]}>
        {"Hello "}
      </MarkdownChat>,
    );

    expect(revealFlags(second.container)).toEqual(["0"]);
  });

  it("keeps the stagger progression through inline formatting", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <MarkdownChat streaming chunkEnds={[]}>
          {""}
        </MarkdownChat>,
      );
      rerender(
        <MarkdownChat streaming chunkEnds={[6, 14, 20]}>
          {"Hello **bold** world"}
        </MarkdownChat>,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });

      const spans = Array.from(
        container.querySelectorAll<HTMLElement>("[data-reveal]"),
      );
      expect(spans.map((span) => span.textContent)).toEqual([
        "Hello ",
        "bold",
        " world",
      ]);
      expect(spans.map((span) => span.style.getPropertyValue("--reveal-i"))).toEqual(
        ["0", "1", "2"],
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reveals only the chunk that arrived after the mount threshold", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <MarkdownChat streaming chunkEnds={[6]}>
          {"Hello "}
        </MarkdownChat>,
      );
      expect(revealFlags(container)).toEqual(["0"]);

      rerender(
        <MarkdownChat streaming chunkEnds={[6, 12]}>
          {"Hello world."}
        </MarkdownChat>,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(revealFlags(container)).toEqual(["0", "1"]);
      expect(container.textContent).toBe("Hello world.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a revealed span animated across later parse ticks", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <MarkdownChat streaming chunkEnds={[6]}>
          {"Hello "}
        </MarkdownChat>,
      );
      rerender(
        <MarkdownChat streaming chunkEnds={[6, 12]}>
          {"Hello world."}
        </MarkdownChat>,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(revealFlags(container)).toEqual(["0", "1"]);

      rerender(
        <MarkdownChat streaming chunkEnds={[6, 12, 16]}>
          {"Hello world. Yes"}
        </MarkdownChat>,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });

      const spans = Array.from(
        container.querySelectorAll<HTMLElement>("[data-reveal]"),
      );
      expect(spans.map((span) => span.textContent)).toEqual([
        "Hello ",
        "world.",
        " Yes",
      ]);
      // The already-playing span must not be switched back to static or
      // re-staggered while its animation is still running.
      expect(spans[1]?.getAttribute("data-reveal")).toBe("1");
      expect(spans[1]?.style.getPropertyValue("--reveal-i")).toBe("0");
      expect(spans[2]?.getAttribute("data-reveal")).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("staggers several chunks painted in one tick in order", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <MarkdownChat streaming chunkEnds={[]}>
          {""}
        </MarkdownChat>,
      );
      rerender(
        <MarkdownChat streaming chunkEnds={[6, 12]}>
          {"Hello world."}
        </MarkdownChat>,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(revealFlags(container)).toEqual(["1", "1"]);
      expect(revealIndexes(container)).toEqual(["0", "1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not split settled or finding text", () => {
    const settled = render(
      <MarkdownChat chunkEnds={[6, 12]}>{"Hello world."}</MarkdownChat>,
    );
    expect(revealFlags(settled.container)).toEqual([]);
    settled.unmount();

    const finding = render(
      <MarkdownChat streaming findQuery="world" chunkEnds={[6, 12]}>
        {"Hello world."}
      </MarkdownChat>,
    );
    expect(revealFlags(finding.container)).toEqual([]);
  });

  it("does not split streaming text without chunk boundaries", () => {
    const { container } = render(
      <MarkdownChat streaming>{"Hello world."}</MarkdownChat>,
    );

    expect(revealFlags(container)).toEqual([]);
  });

  it("keeps a long single chunk in one inline span", () => {
    const source = Array.from({ length: 120 }, () => "word").join(" ");
    const { container } = render(
      <MarkdownChat streaming chunkEnds={[source.length]}>
        {source}
      </MarkdownChat>,
    );

    const spans = container.querySelectorAll<HTMLElement>("[data-reveal]");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.textContent).toBe(source);
    // Inline span: no display override (inline-block would stop wrapping).
    expect(spans[0]?.style.getPropertyValue("display")).toBe("");
  });

  it("splits prose and inline code but never fenced code", () => {
    const source = "Intro text.\n\n```ts\nconst answer = 1;\n```\n\nRun `npm test` now.";
    const { container } = render(
      <MarkdownChat streaming chunkEnds={[source.length]}>
        {source}
      </MarkdownChat>,
    );

    expect(container.querySelectorAll("pre [data-reveal]")).toHaveLength(0);
    expect(container.querySelectorAll("p [data-reveal]").length).toBeGreaterThan(0);
    expect(container.querySelector("code code")).toBeNull();
    const inline = container.querySelector(".chat-md__inline-code");
    expect(inline?.querySelector("[data-reveal]")?.textContent).toBe("npm test");
  });

  it("keeps an entity-decoded node in one piece", () => {
    const source = "Fish &amp; chips";
    const { container } = render(
      <MarkdownChat streaming chunkEnds={[4, source.length]}>
        {source}
      </MarkdownChat>,
    );

    const spans = container.querySelectorAll("[data-reveal]");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.textContent).toBe("Fish & chips");
  });

  it("never splits the KaTeX subtree", () => {
    const source = "Use $x$ here.";
    const { container } = render(
      <MarkdownChat streaming chunkEnds={[source.length]}>
        {source}
      </MarkdownChat>,
    );

    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelectorAll(".katex [data-reveal]")).toHaveLength(0);
  });

  it("leaves the stable prefix unwrapped", () => {
    const head = "A".repeat(2500);
    const source = `${head}\n\nTail sentence.`;
    const { container } = render(
      <MarkdownChat streaming chunkEnds={[source.length]}>
        {source}
      </MarkdownChat>,
    );

    const paragraphs = Array.from(container.querySelectorAll("p"));
    expect(paragraphs[0]?.querySelectorAll("[data-reveal]")).toHaveLength(0);
    expect(paragraphs[0]?.textContent).toBe(head);
    expect(paragraphs[1]?.querySelector("[data-reveal]")?.textContent).toBe(
      "Tail sentence.",
    );
  });

  it("wraps only the streaming tail so prefix containers never animate", () => {
    const head = "A".repeat(2400);
    const source = `${head}\n\n\`\`\`ts\nconst answer = 1;\n\`\`\`\n\nTail sentence.`;
    const { container, unmount } = render(
      <MarkdownChat streaming chunkEnds={[source.length]}>
        {source}
      </MarkdownChat>,
    );

    const tail = container.querySelector(".chat-md__stream-tail--live");
    expect(tail).not.toBeNull();
    const code = container.querySelector(".chat-code");
    expect(code?.classList.contains("chat-md-enter")).toBe(true);
    // Finished code blocks land in the stable prefix, outside the tail scope.
    expect(tail?.querySelector(".chat-code")).toBeNull();
    expect(code?.textContent).toContain("const answer = 1;");
    expect(tail?.textContent).toContain("Tail sentence.");

    unmount();
    const settled = render(
      <MarkdownChat chunkEnds={[source.length]}>{source}</MarkdownChat>,
    );
    const settledTail = settled.container.querySelector(".chat-md__stream-tail");
    expect(settledTail).not.toBeNull();
    expect(
      settledTail?.classList.contains("chat-md__stream-tail--live"),
    ).toBe(false);
    expect(settled.container.querySelector(".chat-code")).not.toBeNull();
    settled.unmount();
  });

  it("settles visible text when motion is re-enabled mid-stream", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <MarkdownChat streaming chunkEnds={[6]}>
          {"Hello "}
        </MarkdownChat>,
      );
      // Text present at mount stays static (frozen threshold).
      expect(revealFlags(container)).toEqual(["0"]);

      act(() => saveOutputMotionPref(false));
      expect(revealFlags(container)).toEqual(["0"]);

      rerender(
        <MarkdownChat streaming chunkEnds={[6, 12]}>
          {"Hello world."}
        </MarkdownChat>,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(revealFlags(container)).toEqual(["0", "0"]);

      act(() => saveOutputMotionPref(true));
      expect(revealFlags(container)).toEqual(["0", "0"]);

      rerender(
        <MarkdownChat streaming chunkEnds={[6, 12, 18]}>
          {"Hello world. Yes"}
        </MarkdownChat>,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(revealFlags(container)).toEqual(["0", "0", "1"]);
      expect(container.textContent).toBe("Hello world. Yes");
    } finally {
      vi.useRealTimers();
    }
  });

  /** Long body with no markdown syntax, exact character length. */
  const longProse = (length: number): string =>
    `${"word ".repeat(Math.ceil(length / 5) + 1).slice(0, length - 1)}z`;

  it("reveals chunks for a reply under the char cap", () => {
    const source = longProse(STREAM_REVEAL_MAX_CHARS - 1);
    const { container } = render(
      <MarkdownChat streaming chunkEnds={[1000, source.length]}>
        {source}
      </MarkdownChat>,
    );

    expect(
      container.querySelectorAll("[data-reveal]").length,
    ).toBeGreaterThan(0);
    expect(container.textContent).toBe(source);
  });

  it("falls back to plain markdown past the char cap", () => {
    const source = longProse(STREAM_REVEAL_MAX_CHARS);
    const { container } = render(
      <MarkdownChat streaming chunkEnds={[1000, source.length]}>
        {source}
      </MarkdownChat>,
    );

    expect(container.querySelectorAll("[data-reveal]")).toHaveLength(0);
    expect(container.textContent).toBe(source);
    expect(container.querySelector(".chat-md__stream-tail")).not.toBeNull();
  });

  it("falls back to plain markdown over the span budget", () => {
    const words = Array.from(
      { length: STREAM_REVEAL_MAX_SPANS + 5 },
      () => "ab",
    );
    const source = words.join(" ");
    // Each chunk ends after "ab ": 3i + 2.
    const ends = words.map((_, i) => i * 3 + 2);
    const { container } = render(
      <MarkdownChat streaming chunkEnds={ends}>
        {source}
      </MarkdownChat>,
    );

    expect(container.querySelectorAll("[data-reveal]")).toHaveLength(0);
    expect(container.textContent).toBe(source);
  });

  it("keeps a degraded reply degraded on later shorter updates", () => {
    vi.useFakeTimers();
    try {
      const longSource = longProse(STREAM_REVEAL_MAX_CHARS);
      const { container, rerender } = render(
        <MarkdownChat streaming chunkEnds={[longSource.length]}>
          {longSource}
        </MarkdownChat>,
      );
      expect(container.querySelectorAll("[data-reveal]")).toHaveLength(0);

      const short = "Hello world.";
      rerender(
        <MarkdownChat streaming chunkEnds={[6, short.length]}>
          {short}
        </MarkdownChat>,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(container.querySelectorAll("[data-reveal]")).toHaveLength(0);
      expect(container.textContent).toBe(short);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a code fence normally when reveal is degraded", () => {
    const words = Array.from(
      { length: STREAM_REVEAL_MAX_SPANS + 5 },
      () => "ab",
    );
    const source = `${words.join(" ")}\n\n\`\`\`ts\nconst answer = 1;\n\`\`\``;
    const ends = [...words.map((_, i) => i * 3 + 2), source.length];
    const { container } = render(
      <MarkdownChat streaming chunkEnds={ends}>
        {source}
      </MarkdownChat>,
    );

    const code = container.querySelector(".chat-code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("const answer = 1;");
    expect(container.querySelectorAll("[data-reveal]")).toHaveLength(0);
  });
});
