import type { ChatMessage, MessageSegment, MessageToolSegment } from "./types";

/** True for placeholder labels we never want as live UI text. */
export function isGenericToolLabel(s: string | undefined | null): boolean {
  const t = (s || "").trim().toLowerCase();
  return (
    !t ||
    t === "tool" ||
    t === "tools" ||
    t === "工具" ||
    t === "unknown" ||
    t === "function"
  );
}
export function splitThoughtPhases(thought: string | undefined | null): string[] {
  if (!thought?.trim()) return [];
  return thought
    .split(/\n\n⟪phase⟫\n\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const THOUGHT_PHASE_JOIN = "\n\n⟪phase⟫\n\n";

/** Sync legacy thought / content / thoughtPhases fields from a segment timeline. */
export function deriveFieldsFromSegments(segments: MessageSegment[]): {
  content: string;
  thought: string | undefined;
  thoughtPhases: string[] | undefined;
} {
  const thoughts = segments
    .filter((s): s is { kind: "thought"; text: string } => s.kind === "thought")
    .map((s) => s.text)
    .filter((t) => t.trim());
  const content = segments
    .filter((s): s is { kind: "content"; text: string } => s.kind === "content")
    .map((s) => s.text)
    .join("");
  return {
    content,
    thought: thoughts.length ? thoughts.join(THOUGHT_PHASE_JOIN) : undefined,
    thoughtPhases: thoughts.length ? thoughts : undefined,
  };
}

/** Host side-channel family: at most one vision + one X chip per turn. */
export function hostToolFamilyKey(
  toolCallId: string | null | undefined,
  toolKind?: string | null,
  title?: string | null,
): string | null {
  const id = (toolCallId || "").toLowerCase();
  const kind = (toolKind || "").toLowerCase();
  const t = (title || "").toLowerCase();
  if (
    id.startsWith("host-vision") ||
    kind === "vision" ||
    /识别图片|recogniz(e|ing)\s*image|image\s*descri/i.test(t)
  ) {
    return "host-vision";
  }
  // Title alone is enough — kind may be empty after journal remap.
  if (
    id.startsWith("host-x") ||
    /搜索\s*x\s*信息|搜索\s*x\b|search(ing)?\s*(on\s*)?x\b|\bx\s*search\b/i.test(
      t,
    ) ||
    (kind === "search" && /(?:^|\s)x(?:\s|$)|twitter|推特/i.test(t))
  ) {
    return "host-x";
  }
  return null;
}

function preferRicherTool(
  a: MessageToolSegment,
  b: MessageToolSegment,
): MessageToolSegment {
  const aDetail = (a.detail || "").length;
  const bDetail = (b.detail || "").length;
  const aDone = !toolSegmentLooksRunning(a);
  const bDone = !toolSegmentLooksRunning(b);
  // Prefer completed over in-progress when both exist.
  let pick: MessageToolSegment;
  if (aDone !== bDone) pick = aDone ? a : b;
  else if (bDetail !== aDetail) pick = bDetail > aDetail ? b : a;
  else pick = b;
  const other = pick === a ? b : a;
  // Never drop a known call argument / captured output when coalescing rows.
  return {
    ...pick,
    input: pick.input || other.input,
    path: pick.path || other.path,
    meta: pick.meta || other.meta,
    output:
      (pick.output || "").length >= (other.output || "").length
        ? pick.output || other.output
        : other.output,
  };
}

function toolSegmentLooksRunning(t: MessageToolSegment): boolean {
  if (t.streaming) return true;
  const s = (t.status || "").toLowerCase();
  return s === "in_progress" || s === "pending" || s === "running" || !s;
}

/**
 * Compact a segment timeline for display / persistence hygiene:
 * - drop empty thought/content pieces
 * - merge adjacent same-kind text segments (spurious "new" thought phases after
 *   empty assistant ticks used to create back-to-back 思考 2 / 思考 3 rows)
 * - keep tool steps; coalesce duplicate toolCallId updates in place
 * - coalesce Host vision/X family (same title twice → one row)
 */
export function compactMessageSegments(
  segments: MessageSegment[],
): MessageSegment[] {
  const out: MessageSegment[] = [];
  for (const raw of segments) {
    if (raw.kind === "tool") {
      const existingById = out.findIndex(
        (s) => s.kind === "tool" && s.toolCallId === raw.toolCallId,
      );
      if (existingById >= 0) {
        const prev = out[existingById] as MessageToolSegment;
        const title =
          (raw.title && !isGenericToolLabel(raw.title) ? raw.title : "") ||
          prev.title;
        const mergedDetail =
          (raw.detail || "").length >= (prev.detail || "").length
            ? raw.detail || prev.detail
            : prev.detail || raw.detail;
        out[existingById] = {
          ...prev,
          ...raw,
          title,
          detail: mergedDetail,
          path: raw.path || prev.path,
          // Coalesce must not wipe a known call argument.
          input: raw.input || prev.input,
          meta: raw.meta || prev.meta,
          // …nor the captured output (terminal tick carries it; later sparse
          // status ticks would otherwise blank the expand body).
          output:
            (raw.output || "").length >= (prev.output || "").length
              ? raw.output || prev.output
              : prev.output,
          toolKind: raw.toolKind || prev.toolKind,
        };
        continue;
      }
      // Host side-channel: only one vision / one X row even if toolCallIds differ
      // (live + journal weave race used to paint "识别图片内容" twice).
      const family = hostToolFamilyKey(raw.toolCallId, raw.toolKind, raw.title);
      if (family) {
        const existingFamily = out.findIndex(
          (s) =>
            s.kind === "tool" &&
            hostToolFamilyKey(s.toolCallId, s.toolKind, s.title) === family,
        );
        if (existingFamily >= 0) {
          const prev = out[existingFamily] as MessageToolSegment;
          out[existingFamily] = preferRicherTool(prev, raw);
          continue;
        }
      }
      out.push({ ...raw });
      continue;
    }
    if (!raw.text.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.kind === raw.kind) {
      if (raw.kind === "thought" && last.kind === "thought") {
        // Preserve a readable break between formerly split phases.
        last.text = `${last.text.replace(/\s+$/, "")}\n\n${raw.text.replace(/^\s+/, "")}`;
      } else if (raw.kind === "content" && last.kind === "content") {
        last.text += raw.text;
      }
      continue;
    }
    out.push({ kind: raw.kind, text: raw.text });
  }
  return out;
}

export function buildSegmentsFromLegacy(
  content: string,
  thought?: string | null,
  thoughtPhases?: string[] | null,
): MessageSegment[] {
  const phases = (
    thoughtPhases?.length ? thoughtPhases : splitThoughtPhases(thought)
  )
    .map((p) => p.trim())
    .filter(Boolean);
  const body = content ?? "";
  // Journal only stores joined thought + body — not true interleave order.
  // Stacking every phase *before* the body avoids the classic reload bug where
  // multi-phase markers rendered as "answer … then 思考 2 / 思考 3" at the end.
  // Live `segments` still interleave thought ↔ content while streaming.
  const segs: MessageSegment[] = [];
  if (phases.length === 1) {
    segs.push({ kind: "thought", text: phases[0]! });
  } else if (phases.length > 1) {
    // One collapsible block on reload (phases already separated by blank lines).
    segs.push({ kind: "thought", text: phases.join("\n\n") });
  }
  if (body) segs.push({ kind: "content", text: body });
  return segs;
}

/**
 * True when the `content` field is just leaked CoT — the real answer is
 * still missing. Used so we do not paint thought text as the body, and so
 * late answer tokens are not treated as post-turn replay.
 */
export function contentLooksLikeThought(
  content: string | null | undefined,
  thought: string | null | undefined,
): boolean {
  const c = (content ?? "").trim();
  const t = (thought ?? "").trim();
  if (!c || !t) return false;
  return c === t;
}

/**
 * Live rows can hold the final answer on `content` while `segments` still
 * only has thought (heal copied the field; stream never opened a content
 * segment). Paint uses segments, so the thought looks like the reply until
 * remount rebuilds from fields.
 */
export function syncContentIntoSegments(
  segs: MessageSegment[],
  content: string | null | undefined,
  thought?: string | null,
): MessageSegment[] {
  const body = content ?? "";
  if (!body.trim()) return segs;
  if (contentLooksLikeThought(body, thought)) return segs;
  // Live interleave can have several content pieces. Never fold the joined
  // `content` field over them (that mashed "hello " + "world" into one).
  if (segs.some((s) => s.kind === "content" && s.text.trim())) return segs;
  return compactMessageSegments([...segs, { kind: "content", text: body }]);
}

/** Prefer live segments; otherwise reconstruct from legacy fields. */
export function messageSegments(m: ChatMessage): MessageSegment[] {
  if (m.segments?.length) {
    return syncContentIntoSegments(
      compactMessageSegments(m.segments),
      m.content,
      m.thought,
    );
  }
  return buildSegmentsFromLegacy(m.content, m.thought, m.thoughtPhases);
}

export function ensureSegments(prev: ChatMessage): MessageSegment[] {
  if (prev.segments?.length) {
    return syncContentIntoSegments(
      prev.segments.map((s) => ({ ...s })),
      prev.content,
      prev.thought,
    );
  }
  return buildSegmentsFromLegacy(prev.content, prev.thought, prev.thoughtPhases);
}

export function appendThoughtToSegments(
  segs: MessageSegment[],
  text: string,
  _phaseHint: string,
): MessageSegment[] {
  if (!text) return segs;
  const last = segs[segs.length - 1];
  // New thought block only after body (or at start). Never open a second
  // adjacent thought — host `thoughtPhase: "new"` after empty assistant ticks
  // used to produce trailing 思考 2 / 思考 3 rows under the answer.
  if (!last || last.kind !== "thought") {
    segs.push({ kind: "thought", text });
  } else {
    last.text += text;
  }
  return segs;
}

export function appendContentToSegments(
  segs: MessageSegment[],
  text: string,
): MessageSegment[] {
  if (!text) return segs;
  const last = segs[segs.length - 1];
  if (last?.kind === "content") {
    last.text += text;
  } else {
    segs.push({ kind: "content", text });
  }
  return segs;
}
