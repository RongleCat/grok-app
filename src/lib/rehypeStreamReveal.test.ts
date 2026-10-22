import { describe, expect, it } from "vitest";
import { rehypeStreamReveal } from "./rehypeStreamReveal";

type TestNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: TestNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

function text(value: string, start?: number, end?: number): TestNode {
  return {
    type: "text",
    value,
    ...(start == null || end == null
      ? {}
      : { position: { start: { offset: start }, end: { offset: end } } }),
  };
}

function el(
  tagName: string,
  children: TestNode[],
  properties: Record<string, unknown> = {},
): TestNode {
  return { type: "element", tagName, properties, children };
}

function root(children: TestNode[]): TestNode {
  return { type: "root", children };
}

function spans(node: TestNode): TestNode[] {
  const found: TestNode[] = [];
  const walk = (n: TestNode) => {
    if (n.type === "element" && n.properties?.["data-reveal"] != null) {
      found.push(n);
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return found;
}

function plainText(node: TestNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(plainText).join("");
}

describe("rehypeStreamReveal", () => {
  it("wraps text by chunk boundary and keeps the text byte-identical", () => {
    const tree = root([el("p", [text("Hello world.", 0, 12)])]);

    rehypeStreamReveal({
      chunkEnds: [6, 12],
      revealFrom: 0,
      indices: new Map([
        [6, 0],
        [12, 1],
      ]),
    })(tree);

    const wrapped = spans(tree);
    expect(wrapped.map((n) => plainText(n))).toEqual(["Hello ", "world."]);
    expect(wrapped.map((n) => n.properties?.["data-reveal"])).toEqual(["1", "1"]);
    expect(wrapped.map((n) => n.properties?.style)).toEqual([
      "--reveal-i:0",
      "--reveal-i:1",
    ]);
    expect(plainText(tree)).toBe("Hello world.");
    // Spans stay inline: no display override is emitted by the plugin.
    expect(tree.children?.[0]?.children?.[0]?.properties?.style).not.toMatch(
      /display/,
    );
  });

  it("marks chunks at or before the threshold as static", () => {
    const tree = root([el("p", [text("Hello world.", 0, 12)])]);

    rehypeStreamReveal({
      chunkEnds: [6, 12],
      revealFrom: 6,
      indices: new Map([[12, 0]]),
    })(tree);

    expect(spans(tree).map((n) => n.properties?.["data-reveal"])).toEqual([
      "0",
      "1",
    ]);
  });

  it("reuses stagger indexes across repeated transforms of the same tail", () => {
    const indices = new Map([
      [6, 0],
      [12, 1],
    ]);
    const options = { chunkEnds: [6, 12], revealFrom: 0, indices };

    const first = root([el("p", [text("Hello world.", 0, 12)])]);
    rehypeStreamReveal(options)(first);
    const second = root([el("p", [text("Hello world.", 0, 12)])]);
    rehypeStreamReveal(options)(second);

    expect(spans(second).map((n) => n.properties)).toEqual(
      spans(first).map((n) => n.properties),
    );
  });

  it("continues the stagger index across sibling blocks", () => {
    const tree = root([
      el("p", [text("alpha", 0, 5)]),
      el("p", [text("beta", 5, 9)]),
    ]);

    rehypeStreamReveal({
      chunkEnds: [5, 9],
      revealFrom: 0,
      indices: new Map([
        [5, 0],
        [9, 1],
      ]),
    })(tree);

    expect(spans(tree).map((n) => n.properties?.style)).toEqual([
      "--reveal-i:0",
      "--reveal-i:1",
    ]);
  });

  it("leaves whitespace-only text nodes untouched", () => {
    const tree = root([
      el("p", [text("a", 0, 1), text("   ", 1, 4), text("b", 4, 5)]),
    ]);

    rehypeStreamReveal({
      chunkEnds: [1, 4, 5],
      revealFrom: 0,
      indices: new Map([
        [1, 0],
        [4, 1],
        [5, 2],
      ]),
    })(tree);

    const paragraph = tree.children?.[0];
    expect(paragraph?.children?.map((n) => n.type)).toEqual([
      "element",
      "text",
      "element",
    ]);
    expect(paragraph?.children?.[1]?.value).toBe("   ");
    expect(plainText(tree)).toBe("a   b");
  });

  it("borrows the next known chunk index when a node ends inside formatted text", () => {
    // `Hello **bold** world`: text nodes end at 6 / 12 / 20, chunk ends 6/14/20.
    const tree = root([
      el("p", [
        text("Hello ", 0, 6),
        el("strong", [text("bold", 8, 12)]),
        text(" world", 14, 20),
      ]),
    ]);

    rehypeStreamReveal({
      chunkEnds: [6, 14, 20],
      revealFrom: 0,
      indices: new Map([
        [6, 0],
        [14, 1],
        [20, 2],
      ]),
    })(tree);

    expect(spans(tree).map((n) => plainText(n))).toEqual([
      "Hello ",
      "bold",
      " world",
    ]);
    expect(spans(tree).map((n) => n.properties?.style)).toEqual([
      "--reveal-i:0",
      "--reveal-i:1",
      "--reveal-i:2",
    ]);
    expect(plainText(tree)).toBe("Hello bold world");
  });

  it("keeps the stagger progression across inline code", () => {
    // `Run `npm test` now`: code text covers the backticks [4,14), value length 8.
    const tree = root([
      el("p", [
        text("Run ", 0, 4),
        el("code", [text("npm test", 4, 14)]),
        text(" now", 14, 18),
      ]),
    ]);

    rehypeStreamReveal({
      chunkEnds: [6, 14, 18],
      revealFrom: 0,
      indices: new Map([
        [6, 0],
        [14, 1],
        [18, 2],
      ]),
    })(tree);

    expect(spans(tree).map((n) => plainText(n))).toEqual([
      "Run ",
      "npm test",
      " now",
    ]);
    expect(spans(tree).map((n) => n.properties?.style)).toEqual([
      "--reveal-i:0",
      "--reveal-i:1",
      "--reveal-i:2",
    ]);
    expect(plainText(tree)).toBe("Run npm test now");
  });

  it("falls back to zero when no known chunk end is past the boundary", () => {
    const tree = root([el("p", [text("tail", 0, 4)])]);

    rehypeStreamReveal({
      chunkEnds: [4],
      revealFrom: 0,
      indices: new Map([[4, 0]]),
    })(tree);

    expect(spans(tree).map((n) => n.properties?.style)).toEqual([
      "--reveal-i:0",
    ]);
  });

  it("skips fenced code, svg, math and KaTeX subtrees", () => {
    const tree = root([
      el("pre", [el("code", [text("const x = 1;", 0, 12)])]),
      el("svg", [text("vector", 0, 6)]),
      el("span", [text("katex glyph", 0, 11)], { className: ["katex"] }),
      el("math", [text("x", 0, 1)]),
      el("p", [text("prose", 13, 18)]),
    ]);

    rehypeStreamReveal({
      chunkEnds: [18],
      revealFrom: 0,
      indices: new Map([[18, 0]]),
    })(tree);

    const wrapped = spans(tree);
    expect(wrapped).toHaveLength(1);
    expect(plainText(wrapped[0]!)).toBe("prose");
    expect(tree.children?.[0]?.children?.[0]?.children?.[0]?.type).toBe("text");
  });

  it("subtracts the stable-prefix offset from boundaries and threshold", () => {
    const tree = root([el("p", [text("tail", 0, 4)])]);

    rehypeStreamReveal({
      chunkEnds: [10, 14],
      revealFrom: 10,
      indices: new Map([[14, 0]]),
      sourceOffset: 10,
    })(tree);

    expect(spans(tree).map((n) => n.properties?.["data-reveal"])).toEqual([
      "1",
    ]);
    expect(spans(tree).map((n) => n.properties?.style)).toEqual([
      "--reveal-i:0",
    ]);
  });

  it("leaves nodes untouched without chunk boundaries or positions", () => {
    const withPositions = root([el("p", [text("plain", 0, 5)])]);
    rehypeStreamReveal({
      chunkEnds: [],
      revealFrom: 0,
      indices: new Map(),
    })(withPositions);
    expect(withPositions.children?.[0]?.children?.[0]?.type).toBe("text");

    const withoutPositions = root([el("p", [text("plain")])]);
    rehypeStreamReveal({
      chunkEnds: [5],
      revealFrom: 0,
      indices: new Map([[5, 0]]),
    })(withoutPositions);
    expect(withoutPositions.children?.[0]?.children?.[0]?.type).toBe("text");
  });
});
