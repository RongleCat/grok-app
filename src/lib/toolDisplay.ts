/**
 * Lightweight tool display registry — shared by turn activity + tasks panel.
 * Summaries only; live mid-stream still prefers Host title via toolStepDisplayTitle.
 */

import { stripAnsi } from "./ansi";

export type ToolDisplayKind =
  | "bash"
  | "read"
  | "edit"
  | "search"
  | "browse"
  | "subagent"
  | "fallback";

export interface ToolDisplayInfo {
  kind: ToolDisplayKind;
  /** Short i18n-neutral label (English token; UI may map). */
  shortLabel: string;
  /** One-line summary for lists. */
  summary: string;
  /** File/dir basename when the tool acted on a path (typed label companion). */
  pathBase?: string;
  /** True when this kind is "gathering context" (read/list/search/browse). */
  isContext: boolean;
}

function lower(s: string | null | undefined): string {
  return (s || "").toLowerCase().trim().replace(/-/g, "_");
}

function clip(s: string, max = 56): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Recover kind when Host journal left kind empty (common for completed tools).
 * Grok CLI call ids often encode the tool: `ws_…` web search, `…web_fetch…`, etc.
 */
export function inferKindFromToolCallId(
  toolCallId: string | null | undefined,
): string | null {
  const s = (toolCallId || "").toLowerCase();
  if (!s) return null;
  if (
    s.startsWith("ws_") ||
    s.includes("_ws_") ||
    /web_search|websearch|web_keyword|web_semantic|x_search|x_keyword/.test(s)
  ) {
    return "web_search";
  }
  if (
    /web_fetch|webfetch|open_page|browse_page|web_browse|open_url|fetch_url/.test(
      s,
    )
  ) {
    return "web_fetch";
  }
  if (/run_terminal|bash|shell/.test(s)) return "run_terminal_command";
  if (/read_file|read_/.test(s)) return "read_file";
  if (/search_replace|str_replace|write|edit/.test(s)) return "search_replace";
  if (/spawn_subagent|subagent/.test(s)) return "spawn_subagent";
  return null;
}

/** Web page open / fetch — Grok shows "Browsed host/path" with a globe. */
export function isBrowseToolKind(
  kind: string | null | undefined,
  title?: string | null,
  toolCallId?: string | null,
): boolean {
  const inferred = inferKindFromToolCallId(toolCallId);
  const k = lower(kind || inferred);
  const t = lower(title);
  const blob = `${k} ${t}`;
  // ACP uses kind "fetch" / title "Fetch: https://…" / "web_fetch"
  return /web_fetch|webfetch|open_page|browse_page|browse|web_open|open_url|fetch_url|web_browse|\bfetch\b|^fetch:/.test(
    blob,
  );
}

/** Pure search tools (not browse) — Grok collapses consecutive into "Ran N searches". */
export function isSearchToolKind(
  kind: string | null | undefined,
  title?: string | null,
  toolCallId?: string | null,
): boolean {
  if (isBrowseToolKind(kind, title, toolCallId)) return false;
  // Host official-aux X pre-search is a single chip, not "Ran N searches".
  const id = (toolCallId || "").toLowerCase();
  if (id.startsWith("host-x") || id.startsWith("host-vision")) return false;
  const t = (title || "").toLowerCase();
  if (/搜索\s*x\s*信息|识别图片内容/.test(t)) return false;
  return classifyToolKind(kind, title, toolCallId) === "search";
}

/** Classify a raw tool kind / title into a display bucket. */
export function classifyToolKind(
  kind: string | null | undefined,
  title?: string | null,
  toolCallId?: string | null,
): ToolDisplayKind {
  const inferred = inferKindFromToolCallId(toolCallId);
  const k = lower(kind || inferred);
  const t = lower(title);
  const blob = `${k} ${t} ${lower(toolCallId)}`;
  if (
    /bash|shell|terminal|execute|run_terminal|command/.test(blob) ||
    k === "run" ||
    k === "execute"
  ) {
    return "bash";
  }
  if (/subagent|spawn_agent|spawn_subagent|\bagent\b/.test(blob)) {
    return "subagent";
  }
  if (
    /search_replace|str_replace|write|edit|apply_patch|create_file|multi_edit|notebook_edit/.test(
      blob,
    ) ||
    (k.includes("edit") && !k.includes("read"))
  ) {
    return "edit";
  }
  // Browse before generic search (web_fetch must not become "search").
  if (isBrowseToolKind(kind || inferred, title, toolCallId)) {
    return "browse";
  }
  // Host vision side-channel — never collapse into "Ran 1 search".
  if (
    k === "vision" ||
    /host[-_]?vision|识图|识别图片|recogniz(e|ing)\s*image|image\s*descri/i.test(
      blob,
    )
  ) {
    return "read";
  }
  // Host often persists titles like "Web search:" / "X search:" with empty kind.
  // Call ids `ws_…` also mark web search when kind/title were lost on journal.
  // Exclude host-vision ids even if title mentions "search".
  if (/host[-_]?vision/.test(lower(toolCallId))) {
    return "read";
  }
  if (
    /grep|glob|search|find_files|web_search|web_keyword|web_semantic|x_search|x_keyword|x_semantic|\bweb search\b|\bx search\b|^ws_/.test(
      blob,
    )
  ) {
    return "search";
  }
  if (/^read\b|read_file|list_dir|list_directory|ls\b|glob/.test(blob)) {
    return "read";
  }
  if (k.includes("read") || k.includes("list")) return "read";
  return "fallback";
}

export function isContextToolKind(
  kind: string | null | undefined,
  title?: string | null,
  toolCallId?: string | null,
): boolean {
  const c = classifyToolKind(kind, title, toolCallId);
  return c === "read" || c === "search" || c === "browse";
}

export function toolShortLabel(kind: ToolDisplayKind): string {
  switch (kind) {
    case "bash":
      return "Run command";
    case "read":
      return "Read file";
    case "edit":
      return "Edit file";
    case "search":
      return "Search";
    case "browse":
      return "Browse";
    case "subagent":
      return "Subagent";
    default:
      return "Tool";
  }
}

/** i18n message key for a typed tool label (localized at render time). */
export function toolBucketLabelKey(kind: ToolDisplayKind): string {
  switch (kind) {
    case "bash":
      return "chat.tool.bash";
    case "read":
      return "chat.tool.read";
    case "edit":
      return "chat.tool.edit";
    case "search":
      return "chat.tool.search";
    case "browse":
      return "chat.tool.browse";
    case "subagent":
      return "chat.tool.agent";
    default:
      return "chat.tool.generic";
  }
}

/** Label key honoring the machine tool name (folder for `list_dir`, …). */
export function toolLabelKeyFor(
  toolKind: string | null | undefined,
  bucket: ToolDisplayKind,
): string {
  const k = (toolKind || "").toLowerCase();
  if (k.includes("list_dir") || k.includes("list_directory") || k === "ls") {
    return "chat.tool.list";
  }
  return toolBucketLabelKey(bucket);
}

/**
 * Friendly display name for an otherwise-unrecognized machine tool name.
 *
 * Used so internal CLI tools (`enter_plan_mode`, `exit_plan_mode`, …) and any
 * future tool without a typed bucket still tell the user what ran, instead of
 * the bare generic “工具”.
 */
export function humanizeToolKind(
  toolKind: string | null | undefined,
): string | undefined {
  const k = (toolKind || "").trim();
  if (!k || k.toLowerCase() === "tool") return undefined;
  // Known acronyms keep their casing; everything else is title-cased so short
  // verbs like “run” don’t become “RUN”.
  const ACRONYMS = new Set(["api", "url", "uri", "mcp", "lsp", "css", "html", "json", "xml", "sql", "cli", "tls", "dns", "x"]);
  const words = k.replace(/[_-]+/g, " ").trim().split(/\s+/);
  return words
    .map((w) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower === "x" ? "X" : lower.toUpperCase();
      return w[0]!.toUpperCase() + w.slice(1);
    })
    .join(" ");
}

/** Short base name of a tool path (for “Read file · main.ts” companion text). */
export function toolPathBase(path?: string | null): string | undefined {
  const p = (path || "").trim().replace(/\\/g, "/");
  if (!p) return undefined;
  const parts = p.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || p;
  return last.length > 64 ? `${last.slice(0, 63)}…` : last;
}

/**
 * Specific tool-call detail for the activity rail — derived from the recorded
 * call argument (`input`: target file / command / query / url), with noisy
 * bits filtered:
 * - read / edit / list → file/dir base name
 * - bash → first simple command, whitespace collapsed, clipped
 * - search / browse → the query / url, clipped
 */
export function toolInputDisplay(
  input: string | null | undefined,
  bucket: ToolDisplayKind,
): string | undefined {
  const v = (input || "").trim();
  if (!v) return undefined;
  if (bucket === "bash") {
    // Multi-line scripts often start with a comment or env assignment; prefer
    // the first line that looks like real work for the activity rail.
    const lines = v
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const meaningful =
      lines.find((l) => !l.startsWith("#") && !/^[A-Za-z_][\w]*=/.test(l)) ||
      lines.find((l) => !l.startsWith("#")) ||
      lines[0] ||
      v;
    const first = meaningful.split(/[;|&]\s*/)[0]?.trim() || meaningful;
    const one = first.replace(/\s+/g, " ").trim();
    return one.length > 44 ? `${one.slice(0, 43)}…` : one;
  }
  if (bucket === "search" || bucket === "browse") {
    return v.length > 48 ? `${v.slice(0, 47)}…` : v;
  }
  // Path-like (read / edit / list): last segment.
  const p = v.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = p.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || p;
  return last.length > 40 ? `${last.slice(0, 39)}…` : last;
}

/**
 * Recover a shell command snippet from CLI titles like `Execute \`ls\`` when
 * the structured `input` field was lost (legacy multi-line journals).
 */
export function bashArgFromToolTitle(
  title: string | null | undefined,
): string | undefined {
  const t = (title || "").trim();
  if (!t) return undefined;
  const closed = t.match(
    /^(?:Execute|Run(?:\s+Command)?)\s*`([\s\S]+?)`\s*$/i,
  );
  if (closed?.[1]?.trim()) return closed[1].trim();
  const open = t.match(/^(?:Execute|Run(?:\s+Command)?)\s*`([\s\S]+)/i);
  if (open?.[1]?.trim()) return open[1].replace(/`\s*$/, "").trim() || undefined;
  return undefined;
}

/**
 * Human summary for a tool row.
 * Prefer path basename / detail snippet over bare kind.
 */
export function summarizeToolDisplay(input: {
  kind?: string | null;
  title?: string | null;
  detail?: string | null;
  path?: string | null;
  toolCallId?: string | null;
  input?: string | null;
}): ToolDisplayInfo {
  const kind =
    input.kind || inferKindFromToolCallId(input.toolCallId) || input.kind;
  const bucket = classifyToolKind(kind, input.title, input.toolCallId);
  const path = (input.path || "").trim();
  const title = (input.title || "").trim();
  let summary = "";
  // Strip trailing colon noise from Host titles ("Web search:", "X search:").
  const cleanTitle = title.replace(/:+\s*$/, "").trim();
  // Host side-channel: always prefer stable title over stream body / status.
  const hostSide = /host[-_]?(vision|x)/i.test(lower(input.toolCallId));
  const pathBase = toolPathBase(path);
  // Specific call detail (target file / command / query) beats the generic
  // type label; raw tool OUTPUT stays in expand detail only.
  const specific = toolInputDisplay(input.input, bucket);
  if (specific) {
    summary = specific;
  } else if (bucket === "bash") {
    summary = toolShortLabel(bucket);
  } else if (hostSide && cleanTitle && !/^tool$/i.test(cleanTitle)) {
    summary = clip(cleanTitle);
  } else if (pathBase) {
    summary = pathBase;
  } else if (bucket === "read") {
    summary = toolShortLabel(bucket);
  } else if (bucket === "edit") {
    summary = toolShortLabel(bucket);
  } else if (bucket === "subagent") {
    summary = toolShortLabel(bucket);
  } else if (
    cleanTitle &&
    !/^tool$/i.test(cleanTitle) &&
    (bucket === "search" || bucket === "browse")
  ) {
    summary = clip(cleanTitle);
  } else if (cleanTitle && !/^tool$/i.test(cleanTitle)) {
    summary = clip(cleanTitle);
  } else if (input.kind && !/^tool$/i.test(input.kind)) {
    summary = clip(input.kind.replace(/[_./]+/g, " "));
  } else {
    summary = toolShortLabel(bucket);
  }
  return {
    kind: bucket,
    shortLabel: toolShortLabel(bucket),
    summary,
    pathBase,
    isContext:
      bucket === "read" || bucket === "search" || bucket === "browse",
  };
}

/** Last N non-empty lines of tool detail (expanded activity). */
export function toolDetailTail(
  detail: string | null | undefined,
  maxLines = 8,
): string {
  if (!detail?.trim()) return "";
  const lines = detail.replace(/\r\n/g, "\n").split("\n");
  const kept = lines.filter((l, i) => l.trim() || i === lines.length - 1);
  if (kept.length <= maxLines) return kept.join("\n");
  return kept.slice(-maxLines).join("\n");
}

/** Minimal tool fields needed for primary label / expand body. */
export type ToolLabelSource = {
  toolCallId?: string | null;
  toolKind?: string | null;
  title?: string | null;
  input?: string | null;
  path?: string | null;
  detail?: string | null;
  /** Real tool output (ACP `content[]`) — the expand body when present. */
  output?: string | null;
};

/** i18n translator — accepts message keys used by chat.tool.* / chat.browsed. */
export type ToolLabelTr = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/**
 * One-line primary label for a tool step (phase rail + bare TimelineToolRow).
 * Never includes stdout/detail body — only type + call args (or host title).
 */
export function resolveToolPrimaryLabel(
  tool: ToolLabelSource,
  tr: ToolLabelTr,
): string {
  const hostVision =
    (tool.toolCallId || "").toLowerCase().startsWith("host-vision") ||
    (tool.toolKind || "").toLowerCase() === "vision";
  const hostX = (tool.toolCallId || "").toLowerCase().startsWith("host-x");
  if (hostVision || hostX) {
    const title = (tool.title || "").trim();
    if (title) return title;
    return (
      summarizeToolDisplay({
        kind: tool.toolKind,
        title: tool.title,
        detail: tool.detail,
        path: tool.path,
        toolCallId: tool.toolCallId,
        input: tool.input,
      }).summary || tr("chat.tool.generic")
    );
  }
  if (isBrowseToolKind(tool.toolKind, tool.title, tool.toolCallId)) {
    const url = browseUrlForPrimaryLabel(tool);
    return tr("chat.browsed", { url });
  }
  if (isSearchToolKind(tool.toolKind, tool.title, tool.toolCallId)) {
    return tr("chat.ranSearch");
  }
  const bucket = classifyToolKind(
    tool.toolKind,
    tool.title,
    tool.toolCallId,
  );
  // Fallback bucket + a real machine tool name (e.g. enter_plan_mode) → show a
  // humanized name instead of the bare generic “工具”. The generic label is the
  // last resort, only when we truly know nothing about the tool.
  let summary =
    bucket === "fallback"
      ? humanizeToolKind(tool.toolKind) || tr(toolLabelKeyFor(tool.toolKind, bucket))
      : tr(toolLabelKeyFor(tool.toolKind, bucket));
  const specific =
    toolInputDisplay(tool.input, bucket) ||
    (bucket === "bash"
      ? toolInputDisplay(bashArgFromToolTitle(tool.title), bucket)
      : undefined);
  if (specific) {
    summary += ` · ${specific}`;
  } else {
    const pathBase = toolPathBase(tool.path);
    if (pathBase) summary += ` · ${pathBase}`;
  }
  return summary;
}

/** URL host/path for browse primary label (no stdout). */
function browseUrlForPrimaryLabel(tool: ToolLabelSource): string {
  const titleFetch = (tool.title || "").match(/^fetch:\s*(https?:\/\/\S+)/i);
  const candidates = [tool.path, tool.detail, titleFetch?.[1], tool.title]
    .map((x) => (x || "").trim())
    .filter(Boolean);
  for (const c of candidates) {
    const http = c.match(/https?:\/\/[^\s)\]"'<>]+/i);
    if (http) {
      try {
        const raw = http[0]!.replace(/[.,;]+$/, "");
        const u = new URL(raw);
        const host = u.host || u.hostname;
        const path = u.pathname === "/" ? "" : u.pathname;
        return `${host}${path}` || raw;
      } catch {
        return http[0]!;
      }
    }
  }
  const fallback = (tool.path || tool.title || "").trim();
  return fallback || "…";
}

/** Max lines kept for a tool output body (UI scrolls inside the expand box). */
const TOOL_OUTPUT_BODY_MAX_LINES = 400;

/**
 * Trim a tool output body: keep the head (where errors and the first rows of a
 * file / listing live) and the tail, eliding the middle. Reading a 3k-line file
 * must not push 3k rows into the DOM.
 */
export function toolOutputBody(
  output: string | null | undefined,
  maxLines = TOOL_OUTPUT_BODY_MAX_LINES,
): string {
  const raw = stripAnsi(output || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+$/, "");
  if (!raw) return "";
  const lines = raw.split("\n");
  if (lines.length <= maxLines) return raw;
  const head = Math.ceil(maxLines * 0.7);
  const tail = maxLines - head;
  const elided = lines.length - head - tail;
  return [
    ...lines.slice(0, head),
    `… ${elided} more lines …`,
    ...lines.slice(lines.length - tail),
  ].join("\n");
}

/**
 * Expand body for a tool step.
 *
 * Precedence: real tool output (ACP `content[]`) wins; `detail` is only a
 * fallback for rows recorded before output capture existed (and for Host
 * side-channels, whose body *is* the detail). `command` is surfaced separately
 * so the UI can echo `$ cmd` above the output like a terminal transcript.
 */
export function toolExpandBody(
  seg: ToolLabelSource & { isError?: boolean; status?: string },
  failed: boolean,
): {
  failHint: string;
  failHintShort: string;
  detailTail: string;
  /** Full tool output (elided in the middle when very long). */
  outputBody: string;
  /** Shell command to echo above the output, when this is a bash-ish tool. */
  command: string;
  hasBody: boolean;
} {
  const failHint = failed
    ? (seg.path || seg.detail || "").trim().split("\n")[0] || ""
    : "";
  const failHintShort =
    failHint.length > 72 ? `${failHint.slice(0, 71)}…` : failHint;
  const hostSide = /^(host-vision|host-x)/i.test(seg.toolCallId || "");
  const outputBody = toolOutputBody(seg.output);
  // Detail is the call argument echoed back — showing it under a label that
  // already says the same thing is noise. Keep it only when there is no real
  // output to show (legacy rows, Host side-channels).
  const detailTail = outputBody ? "" : toolDetailTail(seg.detail, hostSide ? 24 : 8);
  const bucket = classifyToolKind(seg.toolKind, seg.title, seg.toolCallId);
  const command =
    bucket === "bash"
      ? (seg.input || bashArgFromToolTitle(seg.title) || "").trim()
      : "";
  const hasBody =
    !!failHintShort ||
    !!outputBody ||
    (!!command && !!outputBody) ||
    (!!detailTail && detailTail !== failHint && detailTail !== failHintShort);
  return {
    failHint,
    failHintShort,
    detailTail,
    outputBody,
    command,
    hasBody,
  };
}
