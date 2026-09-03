/**
 * Project phase items into Grok.com activity steps (visual + label model).
 *
 * Reference (official web):
 *   💡 short thought title
 *   🔍 Ran N searches
 *   🌐 Browsed host/path/
 *   🌐 Searched web for {query}          … 10 results  [favicons]
 *   ○  Compiling …
 */

import type { MessageToolSegment } from "./session";
import { extractThinkingSummary } from "./thinkingSummary";
import {
  classifyToolKind,
  isBrowseToolKind,
  isContextToolKind,
  isSearchToolKind,
  summarizeToolDisplay,
  toolInputDisplay,
  toolPathBase,
  type ToolDisplayKind,
} from "./toolDisplay";
import {
  resolveToolPresentation,
  toolBucketForCard,
} from "./toolPresentation";

export type GrokActivityStep =
  | {
      /** User-facing mid-turn prose inside 工作了 (not journal CoT). */
      type: "speech";
      key: string;
      text: string;
    }
  | {
      type: "thought";
      key: string;
      summary: string | null;
      streaming: boolean;
      text: string;
    }
  | {
      type: "bash-group";
      key: string;
      count: number;
      failed: boolean;
      running: boolean;
      children: GrokActivityStep[];
    }
  | {
      type: "edit-group";
      key: string;
      count: number;
      failed: boolean;
      running: boolean;
      children: GrokActivityStep[];
    }
  | {
      type: "search-group";
      key: string;
      count: number;
      failed: boolean;
      running: boolean;
    }
  | {
      /**
       * Mixed context-gathering burst (reads + searches) collapsed like zCode’s
       * “探索 · N 次搜索, M 个文件”. Expandable to the individual tool rows.
       * Browse tools keep their own “Browsed …” row and are NOT folded in.
       */
      type: "explore-group";
      key: string;
      searches: number;
      reads: number;
      failed: boolean;
      running: boolean;
      /** Child steps rendered when the group is expanded. */
      children: GrokActivityStep[];
    }
  | {
      /** Individual web search with query string (official: “Searched web for …”). */
      type: "web-search";
      key: string;
      query: string;
      resultCount?: number;
      /** Domains for tiny favicon chips (optional). */
      resultDomains?: string[];
      failed: boolean;
      running: boolean;
    }
  | {
      type: "browse";
      key: string;
      url: string;
      failed: boolean;
      running: boolean;
    }
  | {
      type: "tool";
      key: string;
      summary: string;
      /** Display bucket (bash/read/edit/search/browse/…) → icon + i18n label. */
      bucket: ToolDisplayKind;
      /** Specific call detail (target file / command / query) for the label. */
      inputLabel?: string;
      /** File/dir base name when the tool acted on a path (companion text). */
      pathBase?: string;
      /** Stable Host title (vision/X side-channels) — shown verbatim. */
      hostTitle?: string;
      failed: boolean;
      running: boolean;
      tool: MessageToolSegment;
    };

export type GrokPhaseItem =
  | { kind: "thought"; text: string }
  | { kind: "speech"; text: string }
  | { kind: "tool"; tool: MessageToolSegment };

function toolRunning(t: MessageToolSegment): boolean {
  if (t.streaming) return true;
  const s = (t.status || "").toLowerCase().trim();
  if (!s) return false;
  return s === "in_progress" || s === "pending" || s === "running";
}

/**
 * Step pulse only while the assistant turn is still streaming. After turn end,
 * stuck wire statuses must not keep individual steps animated as running.
 */
function stepRunning(
  t: MessageToolSegment,
  messageStreaming: boolean,
): boolean {
  return messageStreaming && toolRunning(t);
}

function toolFailed(t: MessageToolSegment): boolean {
  if (t.isError) return true;
  const s = (t.status || "").toLowerCase();
  return s === "failed" || s === "error" || s === "rejected" || s === "denied";
}

/** Host/path for Grok "Browsed …" — keep trailing slash when present in source. */
export function extractBrowseUrl(tool: MessageToolSegment): string {
  // "Fetch: https://…" titles from ACP tool_call_update
  const titleFetch = (tool.title || "").match(
    /^fetch:\s*(https?:\/\/\S+)/i,
  );
  const candidates = [
    tool.path,
    tool.detail,
    titleFetch?.[1],
    tool.title,
  ]
    .map((x) => (x || "").trim())
    .filter(Boolean);
  for (const c of candidates) {
    const http = c.match(/https?:\/\/[^\s)\]"'<>]+/i);
    if (http) {
      try {
        const raw = http[0]!.replace(/[.,;]+$/, "");
        const u = new URL(raw);
        // Official shows host + path, often with trailing slash
        let path = u.pathname || "/";
        if (path !== "/" && !path.endsWith("/") && raw.endsWith("/")) {
          path += "/";
        }
        // Prefer trailing slash for directory-like paths (Grok web style)
        if (path !== "/" && !path.includes(".") && !path.endsWith("/")) {
          path += "/";
        }
        return `${u.host}${path === "/" ? "/" : path}`;
      } catch {
        return http[0]!
          .replace(/^https?:\/\//i, "")
          .replace(/[.,;]+$/, "");
      }
    }
    const bare = c.match(
      /(?:^|\s)([a-z0-9][-a-z0-9.]*\.[a-z]{2,}(?:\/[^\s)\]"'<>]*)?)/i,
    );
    if (bare?.[1]) return bare[1];
  }
  const title = (tool.title || "").trim();
  if (title && !/^tool$/i.test(title) && !/^web search:?$/i.test(title)) {
    return title;
  }
  return "page";
}

/** Pull search query from title/detail (Host often: "Web search: q" or detail=q). */
export function extractSearchQuery(tool: MessageToolSegment): string | null {
  const title = (tool.title || "").trim();
  const detail = (tool.detail || "").trim();
  // "Web search: foo bar" / "Web search:foo"
  const fromTitle = title.match(
    /^(?:web\s*search|search|x\s*search)\s*[:：]\s*(.+)$/i,
  );
  if (fromTitle?.[1]?.trim()) return fromTitle[1].trim();
  // Title is the query itself (not generic)
  if (
    title &&
    !/^tool$/i.test(title) &&
    !/^web\s*search:?$/i.test(title) &&
    !/^search$/i.test(title)
  ) {
    return title;
  }
  // First non-URL line of detail
  if (detail) {
    for (const line of detail.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      if (/^https?:\/\//i.test(t)) continue;
      if (/^\d+\s*results?/i.test(t)) continue;
      return t;
    }
  }
  return null;
}

export function extractSearchResultCount(
  tool: MessageToolSegment,
): number | undefined {
  const blob = `${tool.detail || ""}\n${tool.title || ""}`;
  const m = blob.match(/(\d+)\s*results?/i);
  if (m) return Number(m[1]);
  return undefined;
}

/** Domains mentioned in detail (for favicon chips). */
export function extractResultDomains(
  tool: MessageToolSegment,
  max = 3,
): string[] {
  const blob = tool.detail || "";
  const found: string[] = [];
  const re = /https?:\/\/([^/\s)\]"'<>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) && found.length < max) {
    const host = m[1]!.toLowerCase().replace(/^www\./, "");
    if (!found.includes(host)) found.push(host);
  }
  return found;
}

function toolOneLine(tool: MessageToolSegment): string {
  const display = summarizeToolDisplay({
    kind: tool.toolKind,
    title: tool.title,
    detail: tool.detail,
    path: tool.path,
    input: tool.input,
    toolCallId: tool.toolCallId,
  });
  return display.summary || tool.title || tool.toolKind || tool.toolCallId;
}

/**
 * Split a joined thought blob into multiple short phase titles when the host
 * used phase markers (⟪phase⟫) or blank-line separated headings.
 */
export function splitThoughtForActivity(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  // Host multi-phase separator seen in journals
  if (/⟪\s*phase\s*⟫/i.test(raw) || /\n-{3,}\n/.test(raw)) {
    return raw
      .split(/⟪\s*phase\s*⟫|\n-{3,}\n/i)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return [raw];
}

/**
 * Flatten interleaved phase items into Grok display steps.
 */
export function buildGrokActivitySteps(
  items: GrokPhaseItem[],
  options: { live?: boolean; messageStreaming?: boolean } = {},
): GrokActivityStep[] {
  return buildStepsInternal(items, options, true);
}

/** Two consecutive read/search context tools are worth a zCode-style “探索” row. */
const EXPLORE_GROUP_MIN = 2;

function buildStepsInternal(
  items: GrokPhaseItem[],
  options: { live?: boolean; messageStreaming?: boolean },
  grouping: boolean,
): GrokActivityStep[] {
  const live = !!options.live;
  const messageStreaming = !!options.messageStreaming;
  const steps: GrokActivityStep[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i]!;
    if (item.kind === "speech") {
      if (item.text.trim()) {
        steps.push({
          type: "speech",
          key: `sp-${i}`,
          text: item.text,
        });
      }
      i += 1;
      continue;
    }
    if (item.kind === "thought") {
      const parts = splitThoughtForActivity(item.text);
      const toolsAfter = items.slice(i + 1).some((x) => x.kind === "tool");
      const isLastThoughtBurst =
        !toolsAfter &&
        (i === items.length - 1 ||
          items.slice(i + 1).every((x) => x.kind === "thought" && !x.text.trim()));

      if (!parts.length) {
        steps.push({
          type: "thought",
          key: `th-${i}`,
          summary: null,
          streaming: live && messageStreaming && isLastThoughtBurst,
          text: item.text,
        });
      } else {
        parts.forEach((part, pi) => {
          const streaming =
            live &&
            messageStreaming &&
            isLastThoughtBurst &&
            pi === parts.length - 1;
          steps.push({
            type: "thought",
            key: `th-${i}-${pi}`,
            summary: extractThinkingSummary(part),
            streaming,
            text: part,
          });
        });
      }
      i += 1;
      continue;
    }

    const tool = item.tool;
    const hostId = (tool.toolCallId || "").toLowerCase();
    const isHostVision =
      hostId.startsWith("host-vision") ||
      (tool.toolKind || "").toLowerCase() === "vision";
    const isHostX = hostId.startsWith("host-x");

    // Host side-channels: one stable title row (never "Searched web for …").
    // Prefer title over stream detail so the phase rail does not show two
    // "识别图片内容" lines (title + detail first line).
    if (isHostVision || isHostX) {
      const title = (tool.title || "").trim();
      steps.push({
        type: "tool",
        key: tool.toolCallId || `host-${i}`,
        summary:
          title ||
          (isHostVision ? "识别图片内容" : isHostX ? "搜索 X 信息" : toolOneLine(tool)),
        bucket: classifyToolKind(tool.toolKind, tool.title, tool.toolCallId),
        inputLabel: toolInputDisplay(tool.input, classifyToolKind(tool.toolKind, tool.title, tool.toolCallId)),
        pathBase: toolPathBase(tool.path),
        hostTitle: title || undefined,
        failed: toolFailed(tool),
        running: stepRunning(tool, messageStreaming),
        tool,
      });
      i += 1;
      continue;
    }

    // Mixed context-gathering burst (reads + searches, browse excluded) →
    // zCode-style “探索 · N 次搜索, M 个文件”. Pure-search runs keep their own
    // “Ran N searches” path; only fold when the run mixes kinds or is reads.
    if (grouping) {
      let runEnd = i;
      while (runEnd < items.length) {
        const it = items[runEnd]!;
        if (it.kind !== "tool") break;
        const t = it.tool;
        if (isBrowseToolKind(t.toolKind, t.title, t.toolCallId)) break;
        if (!isContextToolKind(t.toolKind, t.title, t.toolCallId)) break;
        const hid = (t.toolCallId || "").toLowerCase();
        if (hid.startsWith("host-vision") || hid.startsWith("host-x")) break;
        runEnd += 1;
      }
      const runLen = runEnd - i;
      const runIsPureSearch =
        runLen > 0 &&
        items
          .slice(i, runEnd)
          .every(
            (it) =>
              it.kind === "tool" &&
              isSearchToolKind(
                it.tool.toolKind,
                it.tool.title,
                it.tool.toolCallId,
              ),
          );
      if (runLen >= EXPLORE_GROUP_MIN && !runIsPureSearch) {
        let searches = 0;
        let reads = 0;
        let failed = false;
        let running = false;
        for (let k = i; k < runEnd; k++) {
          const t = (items[k] as { kind: "tool"; tool: MessageToolSegment }).tool;
          if (isSearchToolKind(t.toolKind, t.title, t.toolCallId)) searches += 1;
          else reads += 1;
          if (toolFailed(t)) failed = true;
          if (stepRunning(t, messageStreaming)) running = true;
        }
        const children = buildStepsInternal(
          items.slice(i, runEnd),
          options,
          false,
        );
        steps.push({
          type: "explore-group",
          key: `explore-${i}`,
          searches,
          reads,
          failed,
          running,
          children,
        });
        i = runEnd;
        continue;
      }
    }

    // Consecutive bash / edit bursts → one folded action row (mock: 运行了 N /
    // 编辑了 N). Singles stay individual so a lone command is still a tool row.
    if (grouping) {
      const bucket = classifyToolKind(tool.toolKind, tool.title, tool.toolCallId);
      if (bucket === "bash" || bucket === "edit") {
        let runEnd = i;
        while (runEnd < items.length) {
          const it = items[runEnd]!;
          if (it.kind !== "tool") break;
          if (
            classifyToolKind(
              it.tool.toolKind,
              it.tool.title,
              it.tool.toolCallId,
            ) !== bucket
          ) {
            break;
          }
          runEnd += 1;
        }
        if (runEnd - i >= 2) {
          let failed = false;
          let running = false;
          for (let k = i; k < runEnd; k++) {
            const t = (items[k] as { kind: "tool"; tool: MessageToolSegment })
              .tool;
            if (toolFailed(t)) failed = true;
            if (stepRunning(t, messageStreaming)) running = true;
          }
          steps.push({
            type: bucket === "bash" ? "bash-group" : "edit-group",
            key: `${bucket}-${i}`,
            count: runEnd - i,
            failed,
            running,
            children: buildStepsInternal(items.slice(i, runEnd), options, false),
          });
          i = runEnd;
          continue;
        }
      }
    }

    // Browse page — prefer explicit presentation meta (DSH seam), else derive.
    if (isBrowseToolKind(tool.toolKind, tool.title, tool.toolCallId)) {
      const presentation = resolveToolPresentation(
        {
          toolCallId: tool.toolCallId,
          toolKind: tool.toolKind,
          title: tool.title,
          input: tool.input,
          path: tool.path,
          detail: tool.detail,
        },
        tool.meta,
      );
      steps.push({
        type: "browse",
        key: tool.toolCallId || `browse-${i}`,
        url: extractBrowseUrl(tool) || presentation.query || "page",
        failed: toolFailed(tool),
        running: stepRunning(tool, messageStreaming),
      });
      i += 1;
      continue;
    }

    // Web search — typed card facts win over string re-parsing (log replay).
    if (isSearchToolKind(tool.toolKind, tool.title, tool.toolCallId)) {
      const presentationOf = (t: MessageToolSegment) =>
        resolveToolPresentation(
          {
            toolCallId: t.toolCallId,
            toolKind: t.toolKind,
            title: t.title,
            input: t.input,
            path: t.path,
            detail: t.detail,
          },
          t.meta,
        );
      const query = presentationOf(tool).query ?? extractSearchQuery(tool);
      // Consecutive searches without per-query text → collapse "Ran N searches"
      // Single search WITH query → "Searched web for …"
      // Peek consecutive
      let count = 1;
      let failed = toolFailed(tool);
      let running = stepRunning(tool, messageStreaming);
      let j = i + 1;
      const queries: string[] = query ? [query] : [];
      while (j < items.length) {
        const n = items[j]!;
        if (n.kind !== "tool") break;
        if (!isSearchToolKind(n.tool.toolKind, n.tool.title, n.tool.toolCallId))
          break;
        if (isBrowseToolKind(n.tool.toolKind, n.tool.title, n.tool.toolCallId))
          break;
        count += 1;
        const q = presentationOf(n.tool).query ?? extractSearchQuery(n.tool);
        if (q) queries.push(q);
        if (toolFailed(n.tool)) failed = true;
        if (stepRunning(n.tool, messageStreaming)) running = true;
        j += 1;
      }

      // If every search has a query and count is small, emit individual rows
      // (matches official interleave of Searched web for …). Otherwise group.
      if (queries.length === count && count >= 1 && count <= 3) {
        for (let k = 0; k < count; k++) {
          const t =
            k === 0
              ? tool
              : (items[i + k] as { kind: "tool"; tool: MessageToolSegment }).tool;
          const p = presentationOf(t);
          steps.push({
            type: "web-search",
            key: t.toolCallId || `ws-${i}-${k}`,
            query: queries[k]!,
            resultCount: p.resultCount ?? extractSearchResultCount(t),
            resultDomains: p.resultDomains ?? extractResultDomains(t),
            failed: toolFailed(t),
            running: stepRunning(t, messageStreaming),
          });
        }
      } else if (count === 1 && query) {
        const p = presentationOf(tool);
        steps.push({
          type: "web-search",
          key: tool.toolCallId || `ws-${i}`,
          query,
          resultCount: p.resultCount ?? extractSearchResultCount(tool),
          resultDomains: p.resultDomains ?? extractResultDomains(tool),
          failed,
          running,
        });
      } else {
        steps.push({
          type: "search-group",
          key: `search-${i}`,
          count,
          failed,
          running,
        });
      }
      i = j;
      continue;
    }

    const presentation = resolveToolPresentation(
      {
        toolCallId: tool.toolCallId,
        toolKind: tool.toolKind,
        title: tool.title,
        input: tool.input,
        path: tool.path,
        detail: tool.detail,
      },
      tool.meta,
    );
    const bucket =
      presentation.card === "generic"
        ? classifyToolKind(tool.toolKind, tool.title, tool.toolCallId)
        : toolBucketForCard(presentation.card);
    steps.push({
      type: "tool",
      key: tool.toolCallId || `tool-${i}`,
      summary: toolOneLine(tool),
      bucket,
      inputLabel: toolInputDisplay(tool.input, bucket),
      pathBase: presentation.pathBase ?? toolPathBase(tool.path),
      failed: toolFailed(tool),
      running: stepRunning(tool, messageStreaming),
      tool,
    });
    i += 1;
  }

  return steps;
}

export function phaseItemsFromLegacy(
  thoughts: string[],
  tools: MessageToolSegment[],
): GrokPhaseItem[] {
  const items: GrokPhaseItem[] = [];
  for (const t of thoughts) {
    if (t.trim()) items.push({ kind: "thought", text: t });
  }
  for (const tool of tools) {
    items.push({ kind: "tool", tool });
  }
  return items;
}
