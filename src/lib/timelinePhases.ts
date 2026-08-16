/**
 * Display-layer projection: group thought + tool bursts into collapsible phases.
 *
 * Truth stays in MessageSegment[]; this only decides how the timeline renders.
 *
 * Phase boundaries (close previous work phase):
 * - content starts after thought/tool work
 * - new thought after tools (next reasoning round)
 * - turn ends (not streaming) — flush trailing work closed
 *
 * While streaming, the trailing work buffer stays "live" (expanded) until a
 * boundary closes it — merge happens at phase end, not only at final answer.
 *
 * Items inside a phase keep **stream order** (thought ↔ tool interleaved) so
 * the Grok-web activity rail can render the same cadence as the official UI.
 */

import type { MessageSegment, MessageToolSegment } from "./session";
import { hostToolFamilyKey } from "./session";
import { extractThinkingSummary } from "./thinkingSummary";
import {
  processSpeechParagraphs,
  splitAssistantAnswer,
} from "./assistantAnswerSplit";
import { classifyToolKind } from "./toolDisplay";

/** Ordered work unit inside a phase (Grok activity rail). */
export type TimelinePhaseItem =
  | { kind: "thought"; text: string }
  /** User-facing mid-turn prose (not journal CoT). */
  | { kind: "speech"; text: string }
  | { kind: "tool"; tool: MessageToolSegment };

export interface TimelinePhase {
  kind: "phase";
  /** Stable key for React: start–end segment indices. */
  id: string;
  /** Stream-ordered thought/tool items (preferred for Grok rail). */
  items: TimelinePhaseItem[];
  /** Derived convenience lists (legacy callers / title gist). */
  thoughts: string[];
  tools: MessageToolSegment[];
  startSi: number;
  endSi: number;
  /** Trailing open work while assistant still streaming. */
  live: boolean;
  errorCount: number;
  runningCount: number;
}

export type TimelineUnit =
  | TimelinePhase
  | {
      kind: "thought";
      text: string;
      si: number;
      streaming: boolean;
    }
  /** Adjacent bare thoughts merged for one collapsible Thought chrome. */
  | {
      kind: "thought-group";
      texts: string[];
      si: number;
      streaming: boolean;
    }
  | {
      kind: "tool";
      tool: MessageToolSegment;
      si: number;
    }
  | {
      kind: "content";
      text: string;
      si: number;
      streaming: boolean;
    };

function toolRunning(t: MessageToolSegment): boolean {
  if (t.streaming) return true;
  const s = (t.status || "").toLowerCase().trim();
  // Empty status with streaming=false means done/unknown — do NOT treat as
  // running (that kept work phases stuck open after the segment finished).
  if (!s) return false;
  return s === "in_progress" || s === "pending" || s === "running";
}

function toolFailed(t: MessageToolSegment): boolean {
  if (t.isError) return true;
  const s = (t.status || "").toLowerCase();
  return s === "failed" || s === "error" || s === "rejected" || s === "denied";
}

function phaseStats(tools: MessageToolSegment[]): {
  errorCount: number;
  runningCount: number;
} {
  let errorCount = 0;
  let runningCount = 0;
  for (const t of tools) {
    if (toolFailed(t)) errorCount += 1;
    if (toolRunning(t)) runningCount += 1;
  }
  return { errorCount, runningCount };
}

/**
 * Worth a collapsible phase chip (vs leaving as bare Thought / single tool row).
 * - thought + ≥1 tool
 * - ≥2 tools (with or without thought)
 */
export function isPhaseWorthy(
  thoughts: string[],
  tools: MessageToolSegment[],
): boolean {
  const hasThought = thoughts.some((t) => t.trim());
  if (tools.length >= 2) return true;
  if (hasThought && tools.length >= 1) return true;
  return false;
}

type WorkBuf = {
  items: { item: TimelinePhaseItem; si: number }[];
};

function emptyBuf(): WorkBuf {
  return { items: [] };
}

function bufThoughts(buf: WorkBuf): string[] {
  return buf.items
    .filter((x) => x.item.kind === "thought")
    .map((x) => (x.item as { kind: "thought"; text: string }).text);
}

function bufTools(buf: WorkBuf): MessageToolSegment[] {
  return buf.items
    .filter(
      (x): x is { item: { kind: "tool"; tool: MessageToolSegment }; si: number } =>
        x.item.kind === "tool",
    )
    .map((x) => x.item.tool);
}

/** Collapse Host vision/X duplicates inside a work buffer before paint. */
function dedupeHostToolsInBuf(buf: WorkBuf): WorkBuf {
  const seen = new Map<string, number>(); // family → item index
  const items: WorkBuf["items"] = [];
  for (const entry of buf.items) {
    if (entry.item.kind !== "tool") {
      items.push(entry);
      continue;
    }
    const tool = entry.item.tool;
    const fam = hostToolFamilyKey(tool.toolCallId, tool.toolKind, tool.title);
    if (!fam) {
      items.push(entry);
      continue;
    }
    const prevIdx = seen.get(fam);
    if (prevIdx == null) {
      seen.set(fam, items.length);
      items.push(entry);
      continue;
    }
    // Keep richer / completed tool at the earlier slot.
    const prev = items[prevIdx]!;
    if (prev.item.kind !== "tool") {
      items.push(entry);
      continue;
    }
    const a = prev.item.tool;
    const b = tool;
    const aLen = (a.detail || "").length;
    const bLen = (b.detail || "").length;
    const aRun = a.streaming || /in_progress|pending|running/i.test(a.status || "");
    const bRun = b.streaming || /in_progress|pending|running/i.test(b.status || "");
    const preferB = (!bRun && aRun) || bLen > aLen;
    if (preferB) {
      items[prevIdx] = entry;
    }
  }
  return { items };
}

function bufStartSi(buf: WorkBuf): number {
  return buf.items[0]?.si ?? 0;
}

function bufEndSi(buf: WorkBuf): number {
  let end = 0;
  for (const t of buf.items) end = Math.max(end, t.si);
  return end;
}

function bufEmpty(buf: WorkBuf): boolean {
  return buf.items.length === 0;
}

function bufHasTools(buf: WorkBuf): boolean {
  return buf.items.some((x) => x.item.kind === "tool");
}

/**
 * Project segments into display units with phase collapsing.
 */
export function buildTimelineUnits(
  segs: MessageSegment[],
  options: { streaming?: boolean } = {},
): TimelineUnit[] {
  const streaming = !!options.streaming;
  const out: TimelineUnit[] = [];
  let buf = emptyBuf();

  const emitBare = (b: WorkBuf, live: boolean) => {
    for (const entry of b.items) {
      if (entry.item.kind === "thought") {
        const text = entry.item.text;
        if (!text.trim() && !(live && streaming)) continue;
        const isLastThought =
          entry ===
          b.items.filter((x) => x.item.kind === "thought").slice(-1)[0];
        const hasTools = bufHasTools(b);
        out.push({
          kind: "thought",
          text,
          si: entry.si,
          streaming:
            live && streaming && isLastThought && !hasTools,
        });
      } else if (entry.item.kind === "tool") {
        out.push({ kind: "tool", tool: entry.item.tool, si: entry.si });
      }
    }
  };

  const flush = (live: boolean) => {
    if (bufEmpty(buf)) return;
    buf = dedupeHostToolsInBuf(buf);
    const thoughts = bufThoughts(buf);
    const tools = bufTools(buf);
    if (isPhaseWorthy(thoughts, tools)) {
      const startSi = bufStartSi(buf);
      const endSi = bufEndSi(buf);
      const stats = phaseStats(tools);
      const items: TimelinePhaseItem[] = buf.items.map((x) => x.item);
      out.push({
        kind: "phase",
        // Stable key: startSi never changes while a phase grows; endSi does
        // (every appended segment), which used to remount the block and reset
        // the user's expand/collapse mid-stream. Keep the key stable so
        // manual toggles survive segment growth.
        id: `p-${startSi}`,
        items,
        thoughts: thoughts.filter((t) => t.trim()),
        tools,
        startSi,
        endSi,
        live,
        errorCount: stats.errorCount,
        // After the turn ends, ignore stuck wire "running" statuses so the UI
        // never keeps a finished message on "Working for …".
        runningCount: streaming ? stats.runningCount : 0,
      });
    } else {
      emitBare(buf, live);
    }
    buf = emptyBuf();
  };

  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si]!;
    if (seg.kind === "content") {
      // Content closes any prior work phase (merge at phase end, not turn end).
      flush(false);
      out.push({
        kind: "content",
        text: seg.text,
        si,
        streaming: streaming && si === segs.length - 1,
      });
      continue;
    }
    if (seg.kind === "thought") {
      // New thought after tools → previous tool burst is a closed phase.
      if (bufHasTools(buf)) {
        flush(false);
      }
      buf.items.push({ item: { kind: "thought", text: seg.text }, si });
      continue;
    }
    // tool
    buf.items.push({ item: { kind: "tool", tool: seg }, si });
  }

  // Trailing work: live while streaming, closed when turn finished.
  flush(streaming);

  // Fix streaming flag on trailing bare thought when live phase wasn't used.
  if (streaming && out.length) {
    const last = out[out.length - 1]!;
    if (last.kind === "thought" || last.kind === "thought-group") {
      last.streaming = true;
    }
  }

  // One collapsible work block per assistant message — a long agent turn with
  // interleaved think/tool bursts (no body text between) must NOT render as a
  // stack of tiny “Worked for 1s” headers. Content still splits phases.
  return coalesceAdjacentThoughts(mergeAdjacentPhases(out));
}

/**
 * Merge consecutive `phase` units (nothing but work between them) into a
 * single phase so one turn shows ONE collapsed “Worked for Ns” with the full
 * activity rail, instead of N per-burst headers. Content units are untouched
 * and always split phases.
 */
export function mergeAdjacentPhases(units: TimelineUnit[]): TimelineUnit[] {
  const out: TimelineUnit[] = [];
  for (const u of units) {
    if (u.kind !== "phase") {
      out.push(u);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && prev.kind === "phase") {
      // Stable key: keep the first phase's id (startSi never changes while the
      // message grows); endSi extends so history duration spans all tools.
      out[out.length - 1] = {
        ...prev,
        items: [...prev.items, ...u.items],
        thoughts: [...prev.thoughts, ...u.thoughts],
        tools: [...prev.tools, ...u.tools],
        endSi: u.endSi,
        live: prev.live || u.live,
        errorCount: prev.errorCount + u.errorCount,
        runningCount: prev.runningCount + u.runningCount,
      };
      continue;
    }
    out.push(u);
  }
  return out;
}

/**
 * Merge consecutive bare `thought` units into one `thought-group` so the UI
 * can show a single collapsible “Thought for Ns” instead of N separate rows.
 * Phases already bundle their own thoughts — leave them alone.
 */
export function coalesceAdjacentThoughts(
  units: TimelineUnit[],
): TimelineUnit[] {
  const out: TimelineUnit[] = [];
  for (const u of units) {
    if (u.kind !== "thought") {
      out.push(u);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev?.kind === "thought-group") {
      if (u.text.trim() || u.streaming) {
        prev.texts.push(u.text);
      }
      if (u.streaming) prev.streaming = true;
      continue;
    }
    if (prev?.kind === "thought") {
      const texts = [prev.text];
      if (u.text.trim() || u.streaming) texts.push(u.text);
      out[out.length - 1] = {
        kind: "thought-group",
        texts,
        si: prev.si,
        streaming: !!(prev.streaming || u.streaming),
      };
      continue;
    }
    out.push(u);
  }
  // Normalize single-item groups back? Keep as group for uniform render, or
  // leave as thought when only one — single thought stays `thought`.
  return out.map((u) => {
    if (u.kind === "thought-group" && u.texts.length === 1) {
      return {
        kind: "thought" as const,
        text: u.texts[0]!,
        si: u.si,
        streaming: u.streaming,
      };
    }
    return u;
  });
}

/**
 * After the first answer fragment, later think→tool loops still need a live
 * “思考中” row. Timeline units already mark the trailing thought/phase live;
 * when the last unit is finished content or a closed phase, paint a trailing
 * thinking placeholder until the next thought/tool arrives.
 *
 * Empty timelines stay on the existing empty-shell placeholder.
 */
export function shouldShowTrailingLiveThinking(
  units: TimelineUnit[],
  opts: { messageStreaming: boolean; hasRunningTool: boolean },
): boolean {
  if (!opts.messageStreaming || opts.hasRunningTool) return false;
  if (units.length === 0) return false;
  const last = units[units.length - 1]!;
  if (
    (last.kind === "thought" || last.kind === "thought-group") &&
    last.streaming
  ) {
    return false;
  }
  if (last.kind === "phase" && last.live) return false;
  return true;
}

/** One-line title pieces for a phase trigger (caller localizes). */
export function phaseTitleModel(phase: TimelinePhase): {
  gist: string | null;
  stepCount: number;
  errorCount: number;
  running: boolean;
  live: boolean;
} {
  const joined = phase.thoughts.join("\n\n");
  return {
    gist: extractThinkingSummary(joined),
    stepCount: phase.tools.length,
    errorCount: phase.errorCount,
    running: phase.live && phase.runningCount > 0,
    live: phase.live,
  };
}

function lastContentIndex(units: TimelineUnit[]): number {
  for (let i = units.length - 1; i >= 0; i--) {
    if (units[i]!.kind === "content") return i;
  }
  return -1;
}

function speechItemsFromText(text: string): TimelinePhaseItem[] {
  return processSpeechParagraphs(text).map((t) => ({
    kind: "speech" as const,
    text: t,
  }));
}

function toolFamilyKey(tool: MessageToolSegment): string {
  const b = classifyToolKind(tool.toolKind, tool.title, tool.toolCallId);
  if (b === "read" || b === "search") return "explore";
  return b;
}

function speechLayout(
  items: TimelinePhaseItem[],
): "leading" | "trailing" | "mixed" | "none" {
  const flags = items.map((i) => i.kind === "speech");
  if (!flags.some(Boolean)) return "none";
  const first = flags.indexOf(true);
  const last = flags.lastIndexOf(true);
  const allSpeechInRange = flags.slice(first, last + 1).every(Boolean);
  if (!allSpeechInRange) return "mixed";
  if (first === 0) return "leading";
  if (last === flags.length - 1) return "trailing";
  return "mixed";
}

function partitionToolGroups(
  tools: MessageToolSegment[],
): MessageToolSegment[][] {
  const groups: MessageToolSegment[][] = [];
  for (const t of tools) {
    const fam = toolFamilyKey(t);
    const prev = groups[groups.length - 1];
    if (prev && toolFamilyKey(prev[0]!) === fam) prev.push(t);
    else groups.push([t]);
  }
  return groups;
}

/**
 * When process speech is a trailing (or leading) block after/before all
 * tools, place a paragraph before each tool family group — the mock’s
 * 「话 → 折叠动作 → 话」. Already-interleaved stream order is left alone.
 */
export function weaveSpeechAndTools(
  items: TimelinePhaseItem[],
): TimelinePhaseItem[] {
  const layout = speechLayout(items);
  if (layout !== "trailing" && layout !== "leading") return items;
  const speeches = items.filter(
    (i): i is { kind: "speech"; text: string } => i.kind === "speech",
  );
  const tools = items
    .filter(
      (i): i is { kind: "tool"; tool: MessageToolSegment } => i.kind === "tool",
    )
    .map((i) => i.tool);
  if (!speeches.length || !tools.length) return items;
  const groups = partitionToolGroups(tools);
  const out: TimelinePhaseItem[] = [];
  const pairs = Math.min(speeches.length, groups.length);
  for (let i = 0; i < pairs; i++) {
    out.push(speeches[i]!);
    for (const tool of groups[i]!) out.push({ kind: "tool", tool });
  }
  for (let i = pairs; i < speeches.length; i++) out.push(speeches[i]!);
  for (let i = pairs; i < groups.length; i++) {
    for (const tool of groups[i]!) out.push({ kind: "tool", tool });
  }
  return out;
}

function emitThoughtUnit(
  texts: string[],
  si: number,
  streaming: boolean,
): TimelineUnit | null {
  const cleaned = texts.map((t) => t.trim()).filter(Boolean);
  if (!cleaned.length && !streaming) return null;
  if (cleaned.length <= 1) {
    return {
      kind: "thought",
      text: cleaned[0] ?? "",
      si,
      streaming,
    };
  }
  return {
    kind: "thought-group",
    texts: cleaned,
    si,
    streaming,
  };
}

function emitWorkUnits(
  items: TimelinePhaseItem[],
  meta: {
    startSi: number;
    endSi: number;
    live: boolean;
    streaming: boolean;
  },
): TimelineUnit[] {
  const woven = weaveSpeechAndTools(items.filter((i) => i.kind !== "thought"));
  const tools = woven
    .filter(
      (i): i is { kind: "tool"; tool: MessageToolSegment } => i.kind === "tool",
    )
    .map((i) => i.tool);
  const speechCount = woven.filter((i) => i.kind === "speech").length;
  if (!woven.length) return [];
  if (speechCount === 0 && !isPhaseWorthy([], tools)) {
    return tools.map((tool, idx) => ({
      kind: "tool" as const,
      tool,
      si: meta.startSi + idx,
    }));
  }
  const stats = phaseStats(tools);
  return [
    {
      kind: "phase",
      id: `p-${meta.startSi}`,
      items: woven,
      thoughts: [],
      tools,
      startSi: meta.startSi,
      endSi: meta.endSi,
      live: meta.live,
      errorCount: stats.errorCount,
      runningCount: meta.streaming ? stats.runningCount : 0,
    },
  ];
}

function phaseItemsOf(phase: TimelinePhase): TimelinePhaseItem[] {
  if (phase.items?.length) return phase.items;
  return [
    ...phase.thoughts
      .filter((t) => t.trim())
      .map((text) => ({ kind: "thought" as const, text })),
    ...phase.tools.map((tool) => ({ kind: "tool" as const, tool })),
  ];
}

/**
 * Display contract (confirmed mock):
 * - Journal CoT → one 思考了 row (never dumped as body text).
 * - Mid-turn speech + folded tools → one 工作了 fold (default collapsed).
 * - Last-content conclusion stays visible below the fold.
 */
export function foldProcessIntoTimeline(
  units: TimelineUnit[],
  options: { streaming?: boolean } = {},
): TimelineUnit[] {
  const streaming = !!options.streaming;
  const lastCi = lastContentIndex(units);
  const hoisted: string[] = [];
  let hoistSi = 0;
  let hoistStreaming = false;
  const workItems: TimelinePhaseItem[] = [];
  let workStartSi = 0;
  let workEndSi = 0;
  let workLive = false;
  let workStarted = false;
  let answer: Extract<TimelineUnit, { kind: "content" }> | null = null;
  const suffix: TimelineUnit[] = [];
  let sawAnswerSlot = false;

  const hoistThought = (text: string, si: number, thoughtStreaming: boolean) => {
    if (!text.trim() && !thoughtStreaming) return;
    if (!hoisted.length) hoistSi = si;
    if (text.trim()) hoisted.push(text);
    if (thoughtStreaming) hoistStreaming = true;
  };

  const pushWork = (item: TimelinePhaseItem, si: number, live: boolean) => {
    if (!workStarted) {
      workStarted = true;
      workStartSi = si;
      workEndSi = si;
    }
    workItems.push(item);
    workEndSi = Math.max(workEndSi, si);
    if (live) workLive = true;
  };

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.kind === "thought") {
      if (sawAnswerSlot) suffix.push(u);
      else hoistThought(u.text, u.si, u.streaming);
      continue;
    }
    if (u.kind === "thought-group") {
      if (sawAnswerSlot) {
        suffix.push(u);
      } else {
        for (const t of u.texts) hoistThought(t, u.si, u.streaming);
      }
      continue;
    }
    if (u.kind === "tool") {
      pushWork({ kind: "tool", tool: u.tool }, u.si, false);
      continue;
    }
    if (u.kind === "phase") {
      const items = phaseItemsOf(u);
      let lastThoughtIdx = -1;
      for (let k = items.length - 1; k >= 0; k--) {
        if (items[k]!.kind === "thought") {
          lastThoughtIdx = k;
          break;
        }
      }
      const thoughtLive =
        streaming &&
        u.live &&
        lastThoughtIdx >= 0 &&
        items
          .slice(lastThoughtIdx + 1)
          .every((x) => x.kind === "thought");
      if (thoughtLive) hoistStreaming = true;
      for (const it of items) {
        if (it.kind === "thought") {
          hoistThought(it.text, u.startSi, false);
        } else {
          pushWork(it, u.startSi, u.live);
        }
      }
      if (u.live) {
        if (!workStarted) {
          workStarted = true;
          workStartSi = u.startSi;
        }
        workEndSi = Math.max(workEndSi, u.endSi);
        workLive = true;
      }
      continue;
    }
    // content
    const isLast = i === lastCi;
    // Only earlier content bodies are mid-turn chatter. The last content is
    // the conclusion slot even when tools (open Finder, screenshot) follow.
    if (!isLast) {
      for (const s of speechItemsFromText(u.text)) {
        pushWork(s, u.si, false);
      }
      continue;
    }
    const split = splitAssistantAnswer(u.text);
    const keepVisible = streaming && u.streaming && !split.cut;
    if (!keepVisible && split.process) {
      for (const s of speechItemsFromText(split.process)) {
        pushWork(s, u.si, false);
      }
    }
    sawAnswerSlot = true;
    answer = {
      kind: "content",
      text: keepVisible || !split.process ? u.text : split.answer,
      si: u.si,
      streaming: u.streaming,
    };
  }

  const out: TimelineUnit[] = [];
  const thoughtU = emitThoughtUnit(hoisted, hoistSi, hoistStreaming);
  if (thoughtU) out.push(thoughtU);
  if (workStarted) {
    out.push(
      ...emitWorkUnits(workItems, {
        startSi: workStartSi,
        endSi: workEndSi,
        live: workLive,
        streaming,
      }),
    );
  }
  if (answer) out.push(answer);
  out.push(...suffix);
  return out;
}

/** Phase projection + process/conclusion fold (what the transcript renders). */
export function buildAssistantTimeline(
  segs: MessageSegment[],
  options: { streaming?: boolean } = {},
): TimelineUnit[] {
  return foldProcessIntoTimeline(buildTimelineUnits(segs, options), {
    streaming: !!options.streaming,
  });
}
