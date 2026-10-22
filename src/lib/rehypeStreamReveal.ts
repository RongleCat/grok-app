/**
 * rehype plugin: splits live-tail text nodes into inline spans on model chunk
 * boundaries, revealed by a mount-triggered CSS animation (ADR 0006).
 *
 * Only text nodes carrying `position` are touched; block structure is
 * unchanged and text content is preserved character for character. Spans stay
 * `display: inline` and the reveal only animates opacity — `inline-block`
 * would stop long chunks from wrapping and would re-flow the tail when spans
 * are removed as streaming ends.
 */

import { splitTextNodeByChunkEnds } from "./streamReveal";

export type StreamRevealOptions = {
  /** Cumulative chunk end offsets in normalized-source coordinates (whole
   * message, not the tail fragment). */
  chunkEnds: readonly number[];
  /** Animation threshold frozen at mount, same coordinates as `chunkEnds`. */
  revealFrom: number;
  /** Chunk end position (whole-source coordinates) → in-batch stagger index. */
  indices: ReadonlyMap<number, number>;
  /**
   * Where the tail fragment starts inside the whole painted source, usually
   * the stable prefix length. HAST `position` is fragment-local, so both
   * boundaries and the animation threshold have to subtract it.
   */
  sourceOffset?: number;
};

type Offset = { offset?: number | null } | null | undefined;

type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start?: Offset; end?: Offset } | null;
};

type HastParent = { children?: HastNode[] };

/** Subtrees are never split: code blocks, SVG and MathML/KaTeX layout must
 * not be broken apart. */
const SKIP_TAGS = new Set(["pre", "svg", "math", "annotation"]);

/** KaTeX output is marked by class, so skip it even when no `math` ancestor
 * wraps the MathML. */
function hasKatexClass(node: HastNode): boolean {
  const raw = node.properties?.className;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/\s+/)
      : [];
  return list.some(
    (token) => typeof token === "string" && token.startsWith("katex"),
  );
}

function textNode(value: string): HastNode {
  return { type: "text", value };
}

function revealSpan(text: string, animate: boolean, index: number): HastNode {
  return {
    type: "element",
    tagName: "span",
    properties: {
      "data-reveal": animate ? "1" : "0",
      style: `--reveal-i:${index}`,
    },
    children: [textNode(text)],
  };
}

type RevealContext = {
  chunkEnds: number[];
  revealFrom: number;
  indexOf: (end: number) => number;
  skip: boolean;
};

function rewriteTextNode(node: HastNode, ctx: RevealContext): HastNode[] | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return null;
  const value = node.value ?? "";
  if (!value || end <= start) return null;
  // Whitespace-only nodes have nothing to animate; keep them as-is (and avoid
  // meaningless spans).
  if (!/\S/.test(value)) return null;

  const segments = splitTextNodeByChunkEnds({
    value,
    start,
    end,
    chunkEnds: ctx.chunkEnds,
    revealFrom: ctx.revealFrom,
    indexOf: ctx.indexOf,
  });
  if (!segments.length) return null;

  return segments.map((segment) =>
    revealSpan(segment.text, segment.animate, segment.index),
  );
}

function rewriteChildren(parent: HastParent, ctx: RevealContext): void {
  if (!parent.children?.length) return;
  const next: HastNode[] = [];
  for (const child of parent.children) {
    if (child.type === "element") {
      const skip =
        ctx.skip ||
        (typeof child.tagName === "string" && SKIP_TAGS.has(child.tagName)) ||
        hasKatexClass(child);
      rewriteChildren(child, { ...ctx, skip });
      next.push(child);
      continue;
    }
    if (child.type !== "text" || ctx.skip) {
      next.push(child);
      continue;
    }
    const replaced = rewriteTextNode(child, ctx);
    if (replaced) next.push(...replaced);
    else next.push(child);
  }
  parent.children = next;
}

/**
 * Plugin factory. With no boundaries (history / not streaming) it wraps
 * nothing, so the same markdown component never rebuilds text nodes when the
 * toggle changes.
 */
export function rehypeStreamReveal(options: StreamRevealOptions) {
  const sourceOffset = options.sourceOffset ?? 0;
  const chunkEnds = options.chunkEnds.map((end) => end - sourceOffset);
  const revealFrom = options.revealFrom - sourceOffset;
  const { indices } = options;
  // Sort once: markdown syntax makes text nodes end between chunk boundaries,
  // and those nodes borrow the index of the "next known boundary" to keep the
  // in-batch 24ms stagger increasing.
  const knownEnds = [...indices.keys()].sort((a, b) => a - b);
  const indexOf = (end: number): number => {
    const target = end + sourceOffset;
    const exact = indices.get(target);
    if (exact != null) return exact;
    const next = knownEnds.find((candidate) => candidate > target);
    return next == null ? 0 : (indices.get(next) ?? 0);
  };

  return (tree: HastParent): void => {
    if (!chunkEnds.length) return;
    rewriteChildren(tree, { chunkEnds, revealFrom, indexOf, skip: false });
  };
}
