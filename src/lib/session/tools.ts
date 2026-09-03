import { currentTurnHasEndMarker } from "../endOfTurn";
import { bashArgFromToolTitle, inferKindFromToolCallId } from "../toolDisplay";
import type {
  ChatMessage,
  ContextCompactMeta,
  ContextCompactPayload,
  MessageSegment,
  MessageToolSegment,
  ToolEventPayload,
  TurnMarkerPayload,
} from "./types";
import {
  appendContentToSegments,
  buildSegmentsFromLegacy,
  compactMessageSegments,
  deriveFieldsFromSegments,
  ensureSegments,
  hostToolFamilyKey,
  isGenericToolLabel,
} from "./segments";

export function applyContextCompact(
  messages: ChatMessage[],
  payload: ContextCompactPayload,
): ChatMessage[] {
  const id = payload.messageId || `compact-${Date.now()}`;
  if (messages.some((m) => m.id === id)) return messages;
  const trigger = (payload.trigger || "auto").toLowerCase();
  const meta: ContextCompactMeta = {
    trigger: trigger === "manual" ? "manual" : trigger === "auto" ? "auto" : trigger,
    tokensBefore: payload.tokensBefore,
    tokensAfter: payload.tokensAfter,
    summaryPreview: payload.summaryPreview,
    note: payload.note,
  };
  const now = new Date().toISOString();
  const compactRow: ChatMessage = {
    id,
    role: "tool",
    content: payload.content || "context_compact",
    marker: "context_compact",
    compactMeta: meta,
    createdAt: now,
  };

  // Mid-turn compact must stay a timeline anchor. Live tools / stream chunks
  // upsert into the current-turn assistant; if we only append the banner after
  // that assistant, later segments still render above it and cards pile at the
  // composer. Freeze the bubble that already arrived, keep its id on a fresh
  // streaming continuation after the banner so applyToolEvent / applyStreamChunk
  // bind below the compact (#855).
  const aIdx = findCurrentTurnAssistantIndex(messages);
  if (aIdx < 0) return [...messages, compactRow];
  const asst = messages[aIdx]!;
  if (!asst.streaming && aIdx !== messages.length - 1) {
    return [...messages, compactRow];
  }
  const frozen: ChatMessage = {
    ...asst,
    id: `${asst.id}__precompact_${id}`,
    streaming: false,
  };
  const continuation: ChatMessage = {
    id: asst.id,
    role: "assistant",
    content: "",
    streaming: true,
    createdAt: now,
    segments: [],
  };
  return [
    ...messages.slice(0, aIdx),
    frozen,
    compactRow,
    continuation,
    ...messages.slice(aIdx + 1),
  ];
}

/** Prefer human call text: title → detail → path → prev → kind (never bare "tool"). */
export function resolveToolDisplayTitle(
  payload: {
    title?: string | null;
    kind?: string | null;
    detail?: string | null;
    path?: string | null;
  },
  prevContent?: string | null,
): string {
  const title = (payload.title || "").trim();
  if (title && !isGenericToolLabel(title)) return title;
  const detail = (payload.detail || "").trim();
  const isStatusDetail =
    /^(done|ok|failed|unavailable|识别完成|识别失败|搜索完成|搜索失败|\d+\s*image)/i.test(
      detail,
    );
  // Prefer previous good title over short host status chips.
  const prev = (prevContent || "").trim();
  if (
    prev &&
    !isGenericToolLabel(prev) &&
    !prev.startsWith("tool_step|") &&
    isStatusDetail
  ) {
    return prev;
  }
  if (detail && !isStatusDetail) return detail;
  const path = (payload.path || "").trim();
  if (path) return path;
  if (prev && !isGenericToolLabel(prev) && !prev.startsWith("tool_step|")) {
    return prev;
  }
  if (detail) return detail;
  const kind = (payload.kind || "").trim();
  if (kind && !isGenericToolLabel(kind)) {
    return kind.replace(/[_./]+/g, " ").trim();
  }
  // Empty → UI hides the line until a real title arrives (no "tool" flash).
  return "";
}

/** Index of the current-turn assistant to attach live tools into (prefer streaming). */
export function findCurrentTurnAssistantIndex(
  messages: ChatMessage[],
): number {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }
  let lastAsst = -1;
  for (let i = lastUser + 1; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== "assistant" || m.isError) continue;
    if (m.streaming) return i;
    lastAsst = i;
  }
  return lastAsst;
}

/** Build a tool segment from a live/persisted tool row fields. */
export function toolSegmentFromFields(fields: {
  toolCallId: string;
  title: string;
  toolKind?: string;
  status: string;
  detail?: string;
  path?: string;
  input?: string;
  output?: string;
  meta?: import("../toolPresentation").ToolPresentationMeta;
  streaming?: boolean;
  isError?: boolean;
  createdAt?: string;
}): MessageToolSegment {
  return {
    kind: "tool",
    toolCallId: fields.toolCallId,
    title: fields.title,
    toolKind: fields.toolKind,
    status: fields.status,
    detail: fields.detail,
    path: fields.path,
    input: fields.input,
    output: fields.output,
    meta: fields.meta,
    streaming: !!fields.streaming,
    isError: !!fields.isError,
    createdAt: fields.createdAt,
  };
}

/**
 * Insert or update a tool segment on an assistant segment timeline.
 * New tools append (true stream order); status updates mutate in place.
 */
export function upsertToolInSegments(
  segs: MessageSegment[],
  tool: MessageToolSegment,
): MessageSegment[] {
  const next = segs.map((s) =>
    s.kind === "tool" ? { ...s } : { ...s },
  ) as MessageSegment[];
  let si = next.findIndex(
    (s) => s.kind === "tool" && s.toolCallId === tool.toolCallId,
  );
  // Same Host family (live uuid vs journal uuid) → update in place, never append.
  if (si < 0) {
    const fam = hostToolFamilyKey(tool.toolCallId, tool.toolKind, tool.title);
    if (fam) {
      si = next.findIndex(
        (s) =>
          s.kind === "tool" &&
          hostToolFamilyKey(s.toolCallId, s.toolKind, s.title) === fam,
      );
    }
  }
  if (si >= 0) {
    const prev = next[si] as MessageToolSegment;
    // Never wipe a good title with empty/generic.
    const title =
      (tool.title && !isGenericToolLabel(tool.title) ? tool.title : "") ||
      prev.title;
    const detail =
      (tool.detail || "").length >= (prev.detail || "").length
        ? tool.detail || prev.detail
        : prev.detail || tool.detail;
    next[si] = {
      ...prev,
      ...tool,
      // Keep the first stable host id so React keys stay put.
      toolCallId: prev.toolCallId || tool.toolCallId,
      title,
      detail,
      path: tool.path || prev.path,
      // Status-only ticks must not wipe a known call argument.
      input: tool.input || prev.input,
      meta: tool.meta || prev.meta,
      toolKind: tool.toolKind || prev.toolKind,
    };
    return next;
  }
  next.push({ ...tool });
  return next;
}

/** True when any assistant in the list already inlines this toolCallId. */
export function isToolInlinedInAssistants(
  messages: ChatMessage[],
  toolCallId: string,
  opts?: { toolKind?: string | null; title?: string | null },
): boolean {
  const id = toolCallId.trim();
  if (!id) return false;
  const fam = hostToolFamilyKey(id, opts?.toolKind, opts?.title);
  for (const m of messages) {
    if (m.role !== "assistant" || !m.segments?.length) continue;
    for (const s of m.segments) {
      if (s.kind !== "tool") continue;
      if (s.toolCallId === id) return true;
      // Host vision/X: live uuid and journal uuid are the same chip.
      if (
        fam &&
        hostToolFamilyKey(s.toolCallId, s.toolKind, s.title) === fam
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Journal rows for the visible transcript (virtual list / paint).
 *
 * Drops tool_step rows already woven into an assistant timeline — keeping them
 * as 0-height spacers still inflated itemCount past the virtualize threshold
 * (e.g. 1 user + 1 assistant + 64 inlined tools → 66 ≥ 48), which thrashed
 * spacers near the bottom and fought stick-to-bottom (flash-snap on scroll).
 */
export function filterTranscriptMessages(
  messages: ChatMessage[],
): ChatMessage[] {
  if (!messages.length) return messages;
  let anyInlined = false;
  let anyHostInlined = false;
  for (const m of messages) {
    if (m.role !== "assistant" || !m.segments?.length) continue;
    for (const s of m.segments) {
      if (s.kind !== "tool") continue;
      anyInlined = true;
      if (hostToolFamilyKey(s.toolCallId, s.toolKind, s.title)) {
        anyHostInlined = true;
      }
    }
  }
  return messages.filter((m) => {
    if (!isToolStepMessage(m)) return true;
    const tcid = toolCallIdOf(m);
    const title = toolStepDisplayTitle(m) || m.content;
    const fam = hostToolFamilyKey(tcid, m.toolKind, title);
    // Host vision/X: never paint a standalone row when already on an assistant.
    if (fam && anyHostInlined) return false;
    if (fam && isToolInlinedInAssistants(messages, tcid, {
      toolKind: m.toolKind,
      title,
    })) {
      return false;
    }
    if (!anyInlined) return true;
    if (!tcid) return true;
    return !isToolInlinedInAssistants(messages, tcid, {
      toolKind: m.toolKind,
      title,
    });
  });
}

/** Resolve stable toolCallId from a tool_step row. */
export function toolCallIdOf(m: ChatMessage): string {
  const fromField = (m.toolCallId || "").trim();
  if (fromField) return fromField;
  if (m.id.startsWith("tool-")) return m.id.slice(5);
  return m.id;
}

function toolSegmentFromMessageRow(row: ChatMessage): MessageToolSegment | null {
  if (!isToolStepMessage(row)) return null;
  const tcid = toolCallIdOf(row);
  if (!tcid) return null;
  const status = (row.toolStatus || "completed").toLowerCase();
  // Re-parse the journal body early: the persisted `kind` (machine tool name
  // like `read_file` / `enter_plan_mode`) lives here, and `row.toolKind` is
  // empty for history-loaded rows. Without this fallback, replayed tools lost
  // their typed icon/label and collapsed to bare “工具”.
  const raw = (row.content || "").trim();
  const parsed = raw.startsWith("tool_step|") ? parseToolStepContent(raw) : null;
  const toolKind =
    (row.toolKind || "").trim() ||
    (parsed?.kind || "").trim() ||
    inferKindFromToolCallId(tcid) ||
    undefined;
  // Prefer field detail; if content still has full tool_step body, re-parse
  // (App maps title-only into content and used to keep only first detail line).
  let detail = row.toolDetail;
  let path = row.toolPath;
  let input = row.toolInput;
  let output = row.toolOutput;
  if (parsed) {
    if (parsed.detail && (!detail || parsed.detail.length > detail.length)) {
      detail = parsed.detail;
    }
    if (parsed.path && !path) path = parsed.path;
    if (parsed.input && !input) input = parsed.input;
    if (parsed.output && !output) output = parsed.output;
  }
  return toolSegmentFromFields({
    toolCallId: tcid,
    title: toolStepDisplayTitle(row) || row.content || tcid,
    toolKind,
    status,
    detail,
    path,
    input,
    output,
    meta: row.toolMeta,
    streaming: false,
    isError: !!row.isError || status === "failed" || status === "error",
    createdAt: row.createdAt,
  });
}

/**
 * Place journal tools into a legacy [thought…, content…] timeline.
 * Host often finalizes the assistant row *before* appending tool_step rows, and
 * assistant.createdAt is often *after* tool timestamps — so tools must not sit
 * only after the answer. Prefer: thoughts → tools → content for journals that
 * never stored live interleave. If segments already contain tools, upsert
 * every turn tool (status updates for known ids + append missing) and keep
 * stream order. Skipping status updates when a later tool appeared left the
 * first reads spinning in 工作中 while bash was already running.
 */
export function mergeToolsIntoAssistantSegments(
  segs: MessageSegment[],
  tools: MessageToolSegment[],
): MessageSegment[] {
  if (!tools.length) return compactMessageSegments(segs);
  const existingIds = new Set(
    segs
      .filter((s): s is MessageToolSegment => s.kind === "tool")
      .map((s) => s.toolCallId),
  );
  const existingFamilies = new Set(
    segs
      .filter((s): s is MessageToolSegment => s.kind === "tool")
      .map((s) => hostToolFamilyKey(s.toolCallId, s.toolKind, s.title))
      .filter((k): k is string => !!k),
  );
  const missing = tools.filter((t) => {
    if (existingIds.has(t.toolCallId)) return false;
    const fam = hostToolFamilyKey(t.toolCallId, t.toolKind, t.title);
    if (fam && existingFamilies.has(fam)) return false;
    return true;
  });

  const alreadyHasTools = segs.some((s) => s.kind === "tool");
  if (alreadyHasTools) {
    // Always upsert the full turn tool list: completed journal rows must
    // settle live in_progress segments even when a newer tool is missing.
    let next = segs;
    for (const t of tools) next = upsertToolInSegments(next, t);
    return compactMessageSegments(next);
  }

  // Legacy journal reconstruction: tools between reasoning and answer.
  const thoughts = segs.filter(
    (s): s is { kind: "thought"; text: string } => s.kind === "thought",
  );
  const contents = segs.filter(
    (s): s is { kind: "content"; text: string } => s.kind === "content",
  );
  const rest = segs.filter((s) => s.kind !== "thought" && s.kind !== "content");
  return compactMessageSegments([
    ...thoughts,
    ...rest,
    ...missing,
    ...contents,
  ]);
}

/**
 * Finished-turn hygiene only: clear leftover tool `streaming` flags.
 *
 * Live think → tool → body → think loops must stay in stream order after the
 * turn ends. Flattening to thought* → tool* → content* was the 0.2.21 jumble
 * (next-round thinking under a still-open tool fold). Journals without stored
 * interleave still get thought → tools → content from
 * {@link mergeToolsIntoAssistantSegments}.
 */
export function reorderSegmentsToHistoryLayout(
  segs: MessageSegment[],
): MessageSegment[] {
  if (!segs.length) return segs;
  let changed = false;
  const next: MessageSegment[] = segs.map((s) => {
    if (s.kind === "tool" && s.streaming) {
      changed = true;
      return { ...s, streaming: false };
    }
    return s;
  });
  return changed ? compactMessageSegments(next) : segs;
}

/**
 * After journal reload (and on every transcript paint), stitch turn tool_step
 * rows into the turn assistant.
 *
 * Collects tools anywhere in the user-turn window (before or after the assistant
 * row — Host journal is often U → A → tools). Rebuilds display order as
 * thought → tools → content when segments have no live tool interleave yet.
 *
 * Finished assistants that already interleave thought/tool/body keep that
 * stream order (turn-end must not jump to a mashed thought→tools→content).
 */
export function weaveToolsIntoAssistantSegments(
  messages: ChatMessage[],
): ChatMessage[] {
  if (!messages.length) return messages;
  // History turn folding: merge per-fragment assistant rows of one turn into
  // a single message (final fragment as body, earlier ones folded). Runs
  // before tool weaving so multi-assistant turns become single-assistant.
  messages = mergeAssistantFragments(messages);
  // Keep history row identity so memoized transcript rows survive stream ticks.
  // Only assistants we actually rewrite are replaced below.
  const out = messages.slice();

  // Walk by user turns so tools before/after assistant all attach to that turn.
  let i = 0;
  while (i < out.length) {
    // Advance to a turn start (user) or orphan prefix.
    if (out[i]!.role !== "user" && i === 0) {
      // Orphan non-user prefix — handle as one synthetic turn below via window.
    }

    let turnStart = i;
    if (out[i]!.role === "user") {
      turnStart = i + 1;
    } else if (i > 0) {
      i += 1;
      continue;
    }

    let turnEnd = turnStart;
    while (turnEnd < out.length && out[turnEnd]!.role !== "user") {
      turnEnd += 1;
    }

    // Assistants in this turn (non-error).
    const asstPositions: number[] = [];
    for (let k = turnStart; k < turnEnd; k++) {
      const m = out[k]!;
      if (m.role === "assistant" && !m.isError) asstPositions.push(k);
    }

    // Tools in this turn, stable journal order (array order; not createdAt).
    const turnTools: MessageToolSegment[] = [];
    const seenTool = new Set<string>();
    for (let k = turnStart; k < turnEnd; k++) {
      const row = out[k]!;
      if (!isToolStepMessage(row)) continue;
      const seg = toolSegmentFromMessageRow(row);
      if (!seg || seenTool.has(seg.toolCallId)) continue;
      seenTool.add(seg.toolCallId);
      turnTools.push(seg);
    }

    if (asstPositions.length === 1 && turnTools.length) {
      const aIdx = asstPositions[0]!;
      const asst = out[aIdx]!;
      const segs = mergeToolsIntoAssistantSegments(
        ensureSegments(asst),
        turnTools,
      );
      const derived = deriveFieldsFromSegments(segs);
      out[aIdx] = { ...asst, ...derived, segments: segs };
    } else if (asstPositions.length > 1 && turnTools.length) {
      // Multi-assistant turn: assign tools after each assistant until next asst.
      for (let ai = 0; ai < asstPositions.length; ai++) {
        const aIdx = asstPositions[ai]!;
        const nextAsst =
          ai + 1 < asstPositions.length
            ? asstPositions[ai + 1]!
            : turnEnd;
        const sliceTools: MessageToolSegment[] = [];
        const seen = new Set<string>();
        for (let k = aIdx + 1; k < nextAsst; k++) {
          const row = out[k]!;
          if (!isToolStepMessage(row)) continue;
          const seg = toolSegmentFromMessageRow(row);
          if (!seg || seen.has(seg.toolCallId)) continue;
          seen.add(seg.toolCallId);
          sliceTools.push(seg);
        }
        // Also tools before the first assistant in the turn → first assistant.
        if (ai === 0) {
          for (let k = turnStart; k < aIdx; k++) {
            const row = out[k]!;
            if (!isToolStepMessage(row)) continue;
            const seg = toolSegmentFromMessageRow(row);
            if (!seg || seen.has(seg.toolCallId)) continue;
            seen.add(seg.toolCallId);
            sliceTools.unshift(seg);
          }
        }
        if (!sliceTools.length) continue;
        const asst = out[aIdx]!;
        const segs = mergeToolsIntoAssistantSegments(
          ensureSegments(asst),
          sliceTools,
        );
        const derived = deriveFieldsFromSegments(segs);
        out[aIdx] = { ...asst, ...derived, segments: segs };
      }
    }

    i = turnEnd > i ? turnEnd : i + 1;
  }

  // Turn-end hygiene: drop leftover tool streaming flags. Do not flatten
  // live interleave — that destroyed think → tool → body → think cycles.
  for (let k = 0; k < out.length; k++) {
    const m = out[k]!;
    if (m.role !== "assistant" || m.isError || m.streaming) continue;
    const segs = m.segments?.length ? m.segments : ensureSegments(m);
    const nextSegs = reorderSegmentsToHistoryLayout(segs);
    // Same array reference ⇒ already history-shaped and had segments.
    if (nextSegs === segs && m.segments?.length) continue;
    const derived = deriveFieldsFromSegments(nextSegs);
    out[k] = { ...m, ...derived, segments: nextSegs };
  }
  return out;
}

/**
 * Pick which assistant fragment becomes the visible body for a multi-row turn.
 *
 * Default product rule: last non-empty fragment is the deliverable (CLI status
 * notes → final answer). Override when a richer earlier row supersedes the
 * last — common after mid-turn journal reconcile injects a short mid-status
 * row while the host stream buffer already holds the full concatenated answer.
 * Without this, end-of-turn UI shows only "正在生成…" while the real answer is
 * collapsed into leadFragments (or only appears after a session remount).
 */
export function pickAssistantFragmentCarrierIdx(
  messages: ChatMessage[],
  asstIdx: number[],
): number {
  let lastNonEmpty = -1;
  let longest = -1;
  let longestLen = -1;
  for (let k = asstIdx.length - 1; k >= 0; k--) {
    const idx = asstIdx[k]!;
    const c = (messages[idx]?.content ?? "").trim();
    if (!c) continue;
    if (lastNonEmpty < 0) lastNonEmpty = idx;
    if (c.length > longestLen) {
      longestLen = c.length;
      longest = idx;
    }
  }
  const fallback =
    lastNonEmpty >= 0 ? lastNonEmpty : asstIdx[asstIdx.length - 1]!;
  if (longest < 0 || longest === fallback) return fallback;

  const lastC = (messages[fallback]?.content ?? "").trim();
  const longC = (messages[longest]?.content ?? "").trim();
  // Longest already contains the last note, or is substantially richer (full
  // stream buffer vs a short mid-status reconcile row).
  if (
    (lastC.length > 0 && longC.includes(lastC)) ||
    longC.length >= lastC.length + 80
  ) {
    return longest;
  }
  return fallback;
}

/**
 * History turn folding: the grok CLI writes one `assistant` row per
 * intermediate status fragment (and reconcile may add them individually), so
 * a single logical answer can reload as several one-line bubbles. Merge every
 * assistant row of a user turn into one message:
 *
 * - `content` = best fragment body (last non-empty, unless a richer earlier
 *   row supersedes it — see {@link pickAssistantFragmentCarrierIdx})
 * - `leadFragments` = other fragments — rendered as a collapsed strip, not
 *   as body text (matches Claude/Cursor history folding)
 * - thoughts from every fragment are kept (phases joined), tool rows are left
 *   in place so `weaveToolsIntoAssistantSegments` attaches them
 *
 * Live streaming rows and error rows are never merged; turns with a single
 * assistant row pass through untouched.
 */
export function mergeAssistantFragments(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length < 2) return messages;
  const out: ChatMessage[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i]!;
    if (m.role === "assistant" && !m.isError && m.streaming) {
      // Live row + a later finished fragment in the same turn (early
      // stream-done) painted 工作中 above a frozen 工作了 + copy/retry.
      let j = i + 1;
      const finishedIdx: number[] = [];
      while (j < messages.length && messages[j]!.role !== "user") {
        const mm = messages[j]!;
        if (mm.role === "assistant" && !mm.isError && !mm.streaming) {
          finishedIdx.push(j);
        }
        j += 1;
      }
      if (finishedIdx.length === 0) {
        out.push(m);
        i += 1;
        continue;
      }
      const extraBodies: string[] = [];
      const extraThoughts: string[] = [];
      let segs = ensureSegments(m);
      for (const idx of finishedIdx) {
        const f = messages[idx]!;
        const body = (f.content ?? "").trim();
        if (body && !(m.content ?? "").includes(body)) extraBodies.push(body);
        if (f.thought?.trim()) extraThoughts.push(f.thought.trim());
        const fsegs =
          f.segments?.length
            ? f.segments
            : buildSegmentsFromLegacy(f.content, f.thought, f.thoughtPhases);
        for (const s of fsegs) {
          // Answer text is merged once via extraBlock / f.content below.
          // Appending each content segment here AND extraBlock doubled
          // mid-turn prose when a finished fragment had several content
          // parts (thought/tools interleaved).
          if (s.kind === "content") continue;
          segs.push(s.kind === "tool" ? { ...s } : { kind: "thought", text: s.text });
        }
      }
      const extraBlock = extraBodies.join("\n\n");
      const content = extraBlock
        ? `${m.content || ""}${m.content?.trim() ? "\n\n" : ""}${extraBlock}`
        : m.content;
      if (extraBlock && extraBodies.every((b) => !segs.some((s) => s.kind === "content" && s.text.includes(b)))) {
        segs = appendContentToSegments(segs, extraBlock);
      }
      const thoughts = [m.thought?.trim(), ...extraThoughts].filter(Boolean);
      out.push({
        ...m,
        content,
        thought: thoughts.length ? thoughts.join("\n\n⟪phase⟫\n\n") : m.thought,
        segments: compactMessageSegments(segs),
        streaming: true,
      });
      for (let k = i + 1; k < j; k++) {
        const row = messages[k]!;
        if (row.role === "assistant" && !row.isError && !row.streaming) continue;
        out.push(row);
      }
      i = j;
      continue;
    }
    if (m.role !== "assistant" || m.isError || m.streaming) {
      out.push(m);
      i += 1;
      continue;
    }
    // Collect all assistant rows of this user turn (bounded by the next user
    // row); fragments are separated by tool rows, so group by turn not run.
    let j = i;
    const asstIdx: number[] = [];
    while (j < messages.length && messages[j]!.role !== "user") {
      const mm = messages[j]!;
      if (mm.role === "assistant" && !mm.isError && !mm.streaming) {
        asstIdx.push(j);
      }
      j += 1;
    }
    if (asstIdx.length <= 1) {
      out.push(m);
      i += 1;
      continue;
    }
    const carrierIdx = pickAssistantFragmentCarrierIdx(messages, asstIdx);
    const carrier = messages[carrierIdx]!;
    const carrierBody = (carrier.content ?? "").trim();

    const leads: string[] = [];
    const thoughts: string[] = [];
    const segs: MessageSegment[] = [];
    for (const idx of asstIdx) {
      const f = messages[idx]!;
      const body = (f.content ?? "").trim();
      // Skip lead notes that are already fully present in the carrier body
      // (stream-concat row often already includes mid-status lines).
      if (idx !== carrierIdx && body && !carrierBody.includes(body)) {
        leads.push(body);
      }
      if (f.thought?.trim()) thoughts.push(f.thought.trim());
      // Keep thought segments from every fragment; drop their content segments
      // (earlier ones are folded into leadFragments, the final one is re-added
      // as the body). Tools are woven by weaveToolsIntoAssistantSegments.
      const fsegs =
        f.segments?.length
          ? f.segments
          : buildSegmentsFromLegacy(f.content, f.thought, f.thoughtPhases);
      for (const s of fsegs) {
        if (s.kind === "content") continue;
        segs.push(s.kind === "tool" ? { ...s } : { kind: "thought", text: s.text });
      }
    }
    if (carrier.content.trim()) {
      segs.push({ kind: "content", text: carrier.content });
    }
    const merged: ChatMessage = {
      ...carrier,
      content: carrier.content,
      leadFragments: leads.length ? leads : undefined,
      thought: thoughts.length ? thoughts.join("\n\n⟪phase⟫\n\n") : carrier.thought,
      segments: segs.length ? segs : carrier.segments,
    };
    out.push(merged);
    // Re-emit the turn's remaining rows (tools, context rows…), skipping the
    // assistant rows already folded into the carrier — tools stay in place so
    // the weave pass attaches them in stream order.
    for (let k = i + 1; k < j; k++) {
      const row = messages[k]!;
      if (row.role === "assistant" && !row.isError && !row.streaming) continue;
      out.push(row);
    }
    i = j;
  }
  return out;
}

/**
 * Pull current-turn tool_step rows into an assistant's segments when missing.
 * Tools that appear *before* the assistant message are prepended; later tools append.
 * Keeps live order when the agent runs tools before the first stream token.
 */
export function syncTurnToolsIntoAssistant(
  messages: ChatMessage[],
  aIdx: number,
): ChatMessage[] {
  if (aIdx < 0 || aIdx >= messages.length) return messages;
  const asst = messages[aIdx]!;
  if (asst.role !== "assistant" || asst.isError) return messages;

  let lastUser = -1;
  for (let i = aIdx - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }

  let segs = ensureSegments(asst);
  const have = new Set(
    segs
      .filter((s): s is MessageToolSegment => s.kind === "tool")
      .map((s) => s.toolCallId),
  );
  const pre: MessageToolSegment[] = [];
  const post: MessageToolSegment[] = [];

  for (let i = lastUser + 1; i < messages.length; i++) {
    if (i === aIdx) continue;
    const m = messages[i]!;
    if (m.role === "user") break;
    if (m.role === "assistant" && i > aIdx) break;
    if (!isToolStepMessage(m)) continue;
    const tcid =
      (m.toolCallId || "").trim() ||
      (m.id.startsWith("tool-") ? m.id.slice(5) : m.id);
    if (!tcid || have.has(tcid)) continue;
    const title = toolStepDisplayTitle(m) || m.content || tcid;
    const fam = hostToolFamilyKey(tcid, m.toolKind, title);
    // Skip host-family rows already inlined under another toolCallId.
    if (
      fam &&
      segs.some(
        (s) =>
          s.kind === "tool" &&
          hostToolFamilyKey(s.toolCallId, s.toolKind, s.title) === fam,
      )
    ) {
      continue;
    }
    const status = (m.toolStatus || "completed").toLowerCase();
    const toolSeg = toolSegmentFromFields({
      toolCallId: tcid,
      title,
      toolKind: m.toolKind,
      status,
      detail: m.toolDetail,
      path: m.toolPath,
      input: m.toolInput,
      output: m.toolOutput,
      meta: m.toolMeta,
      streaming: !!m.streaming,
      isError: !!m.isError || status === "failed" || status === "error",
      createdAt: m.createdAt,
    });
    have.add(tcid);
    if (i < aIdx) pre.push(toolSeg);
    else post.push(toolSeg);
  }

  if (!pre.length && !post.length) return messages;
  segs = compactMessageSegments([...pre, ...segs, ...post]);
  const derived = deriveFieldsFromSegments(segs);
  const copy = messages.slice();
  copy[aIdx] = { ...asst, ...derived, segments: segs };
  return copy;
}

/** Upsert a tool activity row by toolCallId; also pin into assistant timeline. */
export function applyToolEvent(
  messages: ChatMessage[],
  payload: ToolEventPayload,
): ChatMessage[] {
  const tcid = (payload.toolCallId || "").trim();
  if (!tcid) return messages;
  const status = (payload.status || "in_progress").toLowerCase();
  const running =
    status === "in_progress" ||
    status === "pending" ||
    status === "running" ||
    status === "";
  const id = `tool-${tcid}`;
  const now = new Date().toISOString();
  const idx = messages.findIndex(
    (m) => m.id === id || m.toolCallId === tcid,
  );
  const prev = idx >= 0 ? messages[idx]! : null;
  const title = resolveToolDisplayTitle(payload, prev?.content);
  const parentId = (payload.parentId || "").trim() || undefined;
  const hostFam = hostToolFamilyKey(tcid, payload.kind, title);
  // Prefer longer detail (stream accumulation) over short status chips.
  const prevDetail = (prev?.toolDetail || "").trim();
  const nextDetail = (payload.detail || "").trim();
  const statusy =
    /^(done|ok|failed|unavailable|识别完成|识别失败|搜索完成|搜索失败|working…|正在识别…|正在搜索…)$/i.test(
      nextDetail,
    );
  const mergedDetail =
    nextDetail && (!statusy || nextDetail.length >= prevDetail.length)
      ? nextDetail
      : nextDetail || prevDetail || undefined;
  const mergedTitle =
    title ||
    (prev
      ? resolveToolDisplayTitle(
          {
            title: prev.content,
            kind: prev.toolKind,
            detail: prev.toolDetail,
            path: prev.toolPath,
          },
          prev.content,
        )
      : "") ||
    // Keep empty when only generic "tool" — live UI hides placeholder chips.
    // Never fall back to raw toolCallId (would show "t-gen" / uuid noise).
    "";
  const toolKind = payload.kind || prev?.toolKind || undefined;
  const toolPath = payload.path?.trim() || prev?.toolPath || undefined;
  // Status-only ticks omit input; keep the first non-empty call argument.
  const toolInput =
    (payload.input || "").trim() || prev?.toolInput || undefined;
  // Tool output arrives on the terminal tick; never let a later sparse tick
  // erase it, and prefer the longer body when the host streams in chunks.
  const prevOutput = (prev?.toolOutput || "").trim();
  const nextOutput = (payload.output || "").trim();
  const toolOutput =
    (nextOutput.length >= prevOutput.length ? nextOutput : prevOutput) ||
    undefined;
  const isError = status === "failed" || status === "error";
  // Explicit Host presentation meta wins; otherwise keep the previous row's
  // meta so a later sparse tick never wipes the typed card.
  const toolMeta = payload.meta || prev?.toolMeta || undefined;

  // Host vision / X: **only** live on the assistant timeline. A separate
  // tool_step row + inlined segment was painting "搜索 X 信息" twice.
  // Disk journal still written by Host; reload weaves from journal.
  if (hostFam) {
    let copy = messages.slice();
    // Drop any standalone host-family tool rows (this id or same family).
    copy = copy.filter((m) => {
      if (!isToolStepMessage(m)) return true;
      const mid = toolCallIdOf(m);
      if (mid === tcid || m.id === id) return false;
      const fam = hostToolFamilyKey(
        mid,
        m.toolKind,
        toolStepDisplayTitle(m) || m.content,
      );
      return fam !== hostFam;
    });
    const aIdx = findCurrentTurnAssistantIndex(copy);
    if (aIdx < 0) {
      // No assistant yet (rare race): keep a single ephemeral tool row.
      const nextRow: ChatMessage = {
        id,
        role: "tool",
        content: mergedTitle,
        toolCallId: tcid,
        toolKind,
        toolStatus: status || "in_progress",
        toolDetail: mergedDetail,
        toolPath,
        toolInput,
        toolOutput,
        toolMeta,
        toolParentId: parentId,
        streaming: running,
        marker: "tool_step",
        createdAt: prev?.createdAt || now,
        isError,
      };
      return [...copy, nextRow];
    }
    const asst = copy[aIdx]!;
    const toolSeg = toolSegmentFromFields({
      toolCallId: tcid,
      title: mergedTitle,
      toolKind,
      status: status || "in_progress",
      detail: mergedDetail,
      path: toolPath,
      input: toolInput,
      output: toolOutput,
      meta: toolMeta,
      streaming: running,
      isError,
      createdAt: prev?.createdAt || now,
    });
    const segs = compactMessageSegments(
      upsertToolInSegments(ensureSegments(asst), toolSeg),
    );
    const derived = deriveFieldsFromSegments(segs);
    copy[aIdx] = { ...asst, ...derived, segments: segs };
    return copy;
  }

  const nextRow: ChatMessage = {
    id,
    role: "tool",
    content: mergedTitle,
    toolCallId: tcid,
    toolKind,
    toolStatus: status || "in_progress",
    toolDetail: mergedDetail,
    toolPath,
    toolInput,
    toolOutput,
    toolMeta,
    toolParentId: parentId,
    streaming: running,
    marker: "tool_step",
    createdAt: now,
    isError,
  };

  let copy: ChatMessage[];
  if (idx < 0) {
    copy = [...messages, nextRow];
  } else {
    copy = messages.slice();
    copy[idx] = {
      ...prev!,
      ...nextRow,
      createdAt: prev!.createdAt || now,
      content: mergedTitle,
      toolDetail: mergedDetail,
      toolPath: toolPath || prev!.toolPath,
      toolInput: toolInput || prev!.toolInput,
      toolOutput: toolOutput || prev!.toolOutput,
      toolMeta: toolMeta || prev!.toolMeta,
      toolKind: toolKind || prev!.toolKind,
      toolParentId: parentId || prev!.toolParentId,
    };
  }

  // Embed into the current-turn assistant so the UI can render true timeline order.
  const aIdx = findCurrentTurnAssistantIndex(copy);
  if (aIdx < 0) return copy;
  const asst = copy[aIdx]!;
  const row = idx < 0 ? nextRow : copy[idx]!;
  const toolSeg = toolSegmentFromFields({
    toolCallId: tcid,
    title: mergedTitle || row.content || "",
    toolKind: row.toolKind,
    status: row.toolStatus || status,
    detail: row.toolDetail,
    path: row.toolPath,
    input: row.toolInput,
    output: row.toolOutput,
    meta: row.toolMeta,
    streaming: running,
    isError: !!row.isError,
    createdAt: row.createdAt || prev?.createdAt || now,
  });
  const segs = compactMessageSegments(
    upsertToolInSegments(ensureSegments(asst), toolSeg),
  );
  const derived = deriveFieldsFromSegments(segs);
  copy = copy.slice();
  copy[aIdx] = {
    ...asst,
    ...derived,
    segments: segs,
  };
  return copy;
}

export function applyTurnMarker(
  messages: ChatMessage[],
  payload: TurnMarkerPayload,
): ChatMessage[] {
  const id = payload.messageId || `marker-${Date.now()}`;
  if (messages.some((m) => m.id === id)) return messages;
  // Local Stop already painted a chip; Host `turn_marker` must not add a twin.
  if (currentTurnHasEndMarker(messages)) {
    const frozen = messages.map((m) =>
      m.streaming ? { ...m, streaming: false } : m,
    );
    return frozen.some((m, i) => m !== messages[i]) ? frozen : messages;
  }
  const marker = payload.marker || "turn_cancelled";
  const reason = (payload.reason || "cancelled").toLowerCase();
  // Match Host journal: user_stop is a neutral stop chip (not an error row).
  const isError =
    marker === "turn_cancelled" &&
    reason !== "user_stop" &&
    reason !== "cancelled" &&
    reason !== "canceled";
  return [
    ...messages.map((m) =>
      m.streaming ? { ...m, streaming: false } : m,
    ),
    {
      id,
      role: "tool",
      content: payload.content || marker,
      marker,
      toolStatus: payload.reason || "cancelled",
      createdAt: new Date().toISOString(),
      isError,
    },
  ];
}

/** True for journal / live tool_step activity rows. */
export function isToolStepMessage(m: ChatMessage): boolean {
  if (m.marker === "tool_step") return true;
  if (m.role !== "tool") return false;
  const c = (m.content || "").trim();
  if (c.startsWith("tool_step|") || c.startsWith("tool_step")) return true;
  // Live rows often store the human title only; id / toolCallId still mark them.
  if (m.toolCallId?.trim()) return true;
  if (m.id.startsWith("tool-")) return true;
  return false;
}

/** Failed / rejected tool_step that must stay visible in the transcript. */
export function isFailedToolStepMessage(m: ChatMessage): boolean {
  if (!isToolStepMessage(m)) return false;
  if (m.isError) return true;
  const status = (m.toolStatus || "").toLowerCase().trim();
  if (
    status === "failed" ||
    status === "error" ||
    status === "rejected" ||
    status === "denied"
  ) {
    return true;
  }
  if (m.content?.startsWith("tool_step|")) {
    const p = parseToolStepContent(m.content);
    const s = (p?.status || "").toLowerCase();
    return s === "failed" || s === "error" || s === "rejected";
  }
  return false;
}

/**
 * Latest tool in the current turn (after last user message).
 * Prefer a still-running tool; else the most recent tool row.
 */
export function pickLatestTurnTool(
  messages: ChatMessage[],
): ChatMessage | null {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }
  const from = lastUser + 1;
  let latest: ChatMessage | null = null;
  let latestRunning: ChatMessage | null = null;
  for (let i = from; i < messages.length; i++) {
    const m = messages[i]!;
    if (!isToolStepMessage(m)) continue;
    latest = m;
    if (m.streaming) latestRunning = m;
  }
  return latestRunning || latest;
}

/**
 * Only a still-running tool in the current turn, with a real display title.
 * Used for mid-stream one-line UI: show call text while running; hide when done
 * or while we only have a placeholder (no "tool" flash).
 */
export function pickRunningTurnTool(
  messages: ChatMessage[],
): ChatMessage | null {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }
  let latestRunning: ChatMessage | null = null;
  for (let i = lastUser + 1; i < messages.length; i++) {
    const m = messages[i]!;
    if (!isToolStepMessage(m)) continue;
    if (m.streaming) latestRunning = m;
  }
  if (!latestRunning) return null;
  // Hide until we have real call text (avoids "tool" → content → blank flicker).
  if (!toolStepDisplayTitle(latestRunning)) return null;
  return latestRunning;
}

/** One-line title for live tool text — empty when only a placeholder. */
export function toolStepDisplayTitle(m: ChatMessage): string {
  const fromContent = m.content?.trim() || "";
  if (
    fromContent &&
    !fromContent.startsWith("tool_step|") &&
    !isGenericToolLabel(fromContent)
  ) {
    return fromContent;
  }
  const parsed = fromContent.startsWith("tool_step|")
    ? parseToolStepContent(fromContent)
    : null;
  return resolveToolDisplayTitle(
    {
      title: parsed?.title || fromContent,
      kind: m.toolKind || parsed?.kind,
      detail: m.toolDetail || parsed?.detail,
      path: m.toolPath || parsed?.path,
    },
    fromContent,
  );
}

/**
 * Sentinel line separating the legacy `tool_step|` body from real tool output.
 * Everything before it keeps the historical layout, so old journals (which have
 * no sentinel) parse exactly as before. Mirrors `TOOL_OUTPUT_SENTINEL` in
 * `src-tauri/src/session_manager/types.rs`.
 */
export const TOOL_OUTPUT_SENTINEL = "\u0001output";

/** Parse persisted tool_step journal lines. */
export function parseToolStepContent(content: string): {
  status: string;
  kind: string;
  title: string;
  detail?: string;
  path?: string;
  input?: string;
  output?: string;
} | null {
  if (!content.startsWith("tool_step|")) return null;
  // Split real tool output off first: it is free-form multi-line stdout and
  // must never reach the positional `detail\npath` heuristic below.
  let output: string | undefined;
  const sentinelAt = content.indexOf(`\n${TOOL_OUTPUT_SENTINEL}\n`);
  if (sentinelAt >= 0) {
    output =
      content.slice(sentinelAt + TOOL_OUTPUT_SENTINEL.length + 2).trim() ||
      undefined;
    content = content.slice(0, sentinelAt);
  }
  let [header, ...rest] = content.split("\n");
  const parts = (header || "").split("|");
  // tool_step|status|kind|title
  const status = parts[1] || "completed";
  const kind = parts[2] || "";
  let title = parts.slice(3).join("|") || kind || "tool";

  // Legacy / multi-line shell titles: ACP often journals
  // `Execute \`line1\nline2...\`` so only line1 is in the header and the
  // rest of the command (and the `input:` line) sits in the body. Rejoin
  // until backticks balance (even count) or an `input:` marker.
  const execOpen =
    /^(?:Execute|Run(?:\s+Command)?)\s*`/i.test(title) &&
    !/`[^`\n]*`\s*$/.test(title);
  if (execOpen && rest.length) {
    const tickCount = (s: string) => (s.match(/`/g) || []).length;
    const joined = [title];
    let consumed = 0;
    for (let i = 0; i < rest.length; i++) {
      const line = rest[i] ?? "";
      if (line.startsWith("input:")) break;
      joined.push(line);
      consumed = i + 1;
      // Stop when Execute `…` closes (even number of backticks overall).
      if (tickCount(joined.join("\n")) % 2 === 0) break;
    }
    title = joined.join("\n").trim();
    rest = rest.slice(consumed);
  }

  // Host records the call argument (target file / command / query) as an
  // `input:` line. Prefer the first body line; also scan deeper for legacy
  // multi-line titles that pushed `input:` past the command body.
  let input: string | undefined;
  const inputIdx = rest.findIndex((l) => l.startsWith("input:"));
  if (inputIdx >= 0) {
    input = rest[inputIdx]!.slice("input:".length).trim() || undefined;
    rest = [...rest.slice(0, inputIdx), ...rest.slice(inputIdx + 1)];
  }

  // Recover from Execute `…` title text. For multi-line shell journals the
  // rejoined title often has the full script while `input:` only kept the
  // first line (comment / env assignment) — prefer the richer source.
  const fromTitle = bashArgFromToolTitle(title);
  if (fromTitle) {
    if (!input || fromTitle.length > input.length) {
      input = fromTitle;
    }
  }
  // Collapse multi-line Execute titles to a short stable label once the
  // command lives in `input` (keeps activity rail readable).
  if (input && /^(?:Execute|Run(?:\s+Command)?)\s*`/i.test(title)) {
    title = /^Execute/i.test(title) ? "Execute" : "Run Command";
  }

  // Host side-channels journal multi-line bodies (vision / X results).
  // Legacy native rows used: detail\npath (exactly 2 trailing lines, path-like).
  let detail: string | undefined;
  let path: string | undefined;
  if (rest.length === 0) {
    detail = undefined;
    path = undefined;
  } else if (rest.length === 1) {
    detail = rest[0]?.trim() || undefined;
  } else if (rest.length === 2) {
    const a = rest[0] ?? "";
    const b = (rest[1] ?? "").trim();
    const bIsPath =
      !!b &&
      (/^https?:\/\//i.test(b) ||
        b.startsWith("/") ||
        /^[A-Za-z]:[\\/]/.test(b));
    if (bIsPath && !a.includes("\n")) {
      detail = a.trim() || undefined;
      path = b;
    } else {
      detail = rest.join("\n").trim() || undefined;
    }
  } else {
    // 3+ lines: full body is detail (Host X / vision dumps).
    detail = rest.join("\n").trim() || undefined;
  }

  // Modern Host rows put the file target on `input:` (read_file / write / edit)
  // and leave legacy `path` empty. Promote a single-line absolute/home file path
  // so toolPath / session path-map / activity rail all see the real target —
  // critical when the path has spaces (article folders like `Mac Studio…`).
  if (!path && input) {
    const candidate = input.trim();
    if (
      candidate &&
      !candidate.includes("\n") &&
      !candidate.includes("://") &&
      !/\s(-{1,2}[A-Za-z]|&&|\||;)/.test(candidate) &&
      (candidate.startsWith("/") ||
        candidate.startsWith("~/") ||
        /^[A-Za-z]:[\\/]/.test(candidate)) &&
      /\.[\w]{1,12}$/.test(candidate.split(/[/\\]/).pop() || "")
    ) {
      path = candidate;
    }
  }

  return {
    status,
    kind,
    title,
    detail,
    path,
    input,
    output,
  };
}

/** Parse journal content written by Host for compact markers. */
export function parseCompactContent(
  content: string,
): ContextCompactMeta | null {
  // Structured journal only — not free-text titles containing "compact".
  if (
    content !== "context_compact" &&
    !content.startsWith("context_compact|") &&
    !content.startsWith("context_compact\n")
  ) {
    return null;
  }
  const [header, ...rest] = content.split("\n");
  const parts = (header || "").split("|").slice(1);
  const meta: ContextCompactMeta = { trigger: "auto" };
  for (const p of parts) {
    if (p === "auto" || p === "manual") meta.trigger = p;
    else if (p.startsWith("tokens:")) {
      const m = /^tokens:(\d+)->(\d+)$/.exec(p);
      if (m) {
        meta.tokensBefore = Number(m[1]);
        meta.tokensAfter = Number(m[2]);
      }
    } else if (p.startsWith("tokens_before:")) {
      meta.tokensBefore = Number(p.slice("tokens_before:".length)) || undefined;
    } else if (p.startsWith("tokens_after:")) {
      meta.tokensAfter = Number(p.slice("tokens_after:".length)) || undefined;
    } else if (p.startsWith("note:")) {
      meta.note = p.slice(5);
    }
  }
  const summary = rest.join("\n").trim();
  if (summary) meta.summaryPreview = summary;
  return meta;
}
