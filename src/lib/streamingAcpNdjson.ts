/**
 * Parse ACP-shaped NDJSON from headless `--output-format streaming-json`
 * (Grok Build CLI 0.2.117+).
 *
 * In 0.2.117+, headless `streaming-json` emits newline-delimited agent-native
 * ACP session updates (JSON-RPC `session/update` notifications and related
 * frames). This module classifies those lines for diagnostics.
 *
 * **Not** the same as:
 * - `streaming-messages-json` — separate CLI output format (message-oriented)
 * - Legacy simplified `{ type: "text" | "thought" | "end" }` NDJSON used by some
 *   older tooling / remote-bridge parsers
 *
 * Soft-gate: Host only requests `--output-format streaming-json` for this
 * ACP-shaped probe path when the CLI version is ≥ {@link STREAMING_ACP_NDJSON_MIN_CLI}.
 */

/** First CLI that documents ACP-shaped `streaming-json` NDJSON. */
export const STREAMING_ACP_NDJSON_MIN_CLI = "0.2.117" as const;

/** Headless flag value for ACP-shaped NDJSON (CLI 0.2.117+). */
export const STREAMING_ACP_NDJSON_OUTPUT_FORMAT = "streaming-json" as const;

/**
 * Distinct CLI format — **do not** conflate with streaming-json.
 * Kept here so call sites can assert separation.
 */
export const STREAMING_MESSAGES_JSON_OUTPUT_FORMAT =
  "streaming-messages-json" as const;

/** Default short probe prompt (no tools; cheap). */
export const STREAMING_ACP_NDJSON_PROBE_PROMPT =
  "Reply with exactly the word ok and nothing else.";

export type AcpNdjsonEventKind =
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "plan"
  | "available_commands_update"
  | "usage"
  | "retry_state"
  | "task_backgrounded"
  | "task_completed"
  | "background_tasks"
  | "hook"
  | "goal_updated"
  | "prompt_complete"
  | "rpc_result"
  | "rpc_error"
  | "other_session_update"
  | "non_acp"
  | "invalid"
  | "empty";

export type AcpNdjsonParsedEvent = {
  /** 1-based line number in the source text (blank lines still count). */
  line: number;
  kind: AcpNdjsonEventKind;
  /** sessionUpdate value or RPC method when known. */
  sessionUpdate: string | null;
  sessionId: string | null;
  /** Short text preview (assistant/thought chunk, error message, …). */
  preview: string | null;
  /** True when the line looks like ACP session/update (or related RPC). */
  isAcpShaped: boolean;
  raw: unknown;
};

export type AcpNdjsonTypeCount = {
  kind: AcpNdjsonEventKind;
  count: number;
};

export type AcpNdjsonSummary = {
  totalLines: number;
  nonEmptyLines: number;
  parsedEvents: number;
  acpShapedCount: number;
  nonAcpCount: number;
  invalidCount: number;
  emptyCount: number;
  /** Counts by kind, sorted by count desc then kind asc. */
  typeCounts: AcpNdjsonTypeCount[];
  sessionIds: string[];
  /** Joined assistant text from agent_message_chunk previews. */
  assistantText: string;
  /** Joined thought text from agent_thought_chunk previews. */
  thoughtText: string;
  events: AcpNdjsonParsedEvent[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/** Keep interior/trailing spaces (stream chunks often end with `"Hello "`). */
function rawStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return v.length ? v : null;
}

function asSessionId(obj: Record<string, unknown>): string | null {
  return str(obj.sessionId) ?? str(obj.session_id);
}

/** Extract plain text from ACP content blocks / common fields. */
function extractTextPreview(obj: Record<string, unknown>): string | null {
  const content = obj.content;
  if (typeof content === "string") return content.length ? content : null;
  if (isRecord(content)) {
    const t = rawStr(content.text) ?? rawStr(content.data);
    if (t != null) return t;
  }
  return (
    rawStr(obj.text) ??
    rawStr(obj.data) ??
    rawStr(obj.message) ??
    rawStr(obj.reason) ??
    null
  );
}

function normalizeSessionUpdateKind(raw: string): AcpNdjsonEventKind {
  const k = raw.trim();
  const lower = k.toLowerCase();
  switch (lower) {
    case "agent_message_chunk":
      return "agent_message_chunk";
    case "agent_thought_chunk":
    case "thought":
      return "agent_thought_chunk";
    case "tool_call":
      return "tool_call";
    case "tool_call_update":
      return "tool_call_update";
    case "plan":
      return "plan";
    case "available_commands_update":
      return "available_commands_update";
    case "retry_state":
      return "retry_state";
    case "task_backgrounded":
      return "task_backgrounded";
    case "task_completed":
      return "task_completed";
    case "background_tasks":
      return "background_tasks";
    case "hook_execution":
    case "hook_annotation":
    case "hookexecution":
    case "hookannotation":
      return "hook";
    case "goal_updated":
    case "goalupdated":
      return "goal_updated";
    case "tokens_used":
    case "usage":
    case "token_usage":
    case "tokenusage":
    case "context_usage":
    case "contextusage":
    case "turn_usage":
    case "turnusage":
    case "compaction":
    case "compaction_completed":
    case "context_compact":
    case "auto_compact":
    case "compaction_checkpoint":
      return "usage";
    default:
      return "other_session_update";
  }
}

/**
 * Detect legacy / non-ACP simplified streaming lines
 * (`{ type: "text"|"thought"|"end"|"error" }`).
 */
export function isLegacySimplifiedStreamLine(
  obj: Record<string, unknown>,
): boolean {
  if (obj.sessionUpdate != null || obj.session_update != null) return false;
  if (obj.method != null) return false;
  if (obj.update != null && isRecord(obj.update)) return false;
  const typeRaw = str(obj.type) ?? str(obj.event);
  if (!typeRaw) return false;
  const t = typeRaw.toLowerCase();
  return (
    t === "text" ||
    t === "thought" ||
    t === "thinking" ||
    t === "reasoning" ||
    t === "assistant" ||
    t === "content" ||
    t === "end" ||
    t === "result" ||
    t === "done" ||
    t === "error" ||
    t === "max_turns_reached"
  );
}

function parseUpdateObject(
  update: Record<string, unknown>,
  sessionId: string | null,
  line: number,
  raw: unknown,
): AcpNdjsonParsedEvent {
  const su =
    str(update.sessionUpdate) ??
    str(update.session_update) ??
    str(update.kind) ??
    "";
  const kind = su ? normalizeSessionUpdateKind(su) : "other_session_update";
  return {
    line,
    kind,
    sessionUpdate: su || null,
    sessionId: sessionId ?? asSessionId(update),
    preview: extractTextPreview(update),
    isAcpShaped: true,
    raw,
  };
}

/**
 * Parse a single NDJSON line into a classified ACP event.
 * Blank → empty; invalid JSON → invalid; non-ACP shapes → non_acp.
 */
export function parseAcpNdjsonLine(
  line: string,
  lineNumber = 1,
): AcpNdjsonParsedEvent {
  const trimmed = line.trim();
  if (!trimmed) {
    return {
      line: lineNumber,
      kind: "empty",
      sessionUpdate: null,
      sessionId: null,
      preview: null,
      isAcpShaped: false,
      raw: null,
    };
  }

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed) as unknown;
  } catch {
    return {
      line: lineNumber,
      kind: "invalid",
      sessionUpdate: null,
      sessionId: null,
      preview: trimmed.slice(0, 120),
      isAcpShaped: false,
      raw: trimmed,
    };
  }

  if (!isRecord(obj)) {
    return {
      line: lineNumber,
      kind: "non_acp",
      sessionUpdate: null,
      sessionId: null,
      preview: null,
      isAcpShaped: false,
      raw: obj,
    };
  }

  // JSON-RPC error response
  if (obj.error != null && (obj.id != null || obj.jsonrpc != null)) {
    const err = isRecord(obj.error) ? obj.error : {};
    return {
      line: lineNumber,
      kind: "rpc_error",
      sessionUpdate: null,
      sessionId: asSessionId(obj),
      preview: str(err.message) ?? str(obj.message) ?? "rpc error",
      isAcpShaped: true,
      raw: obj,
    };
  }

  const method = str(obj.method);

  // JSON-RPC session/update notification
  if (
    method === "session/update" ||
    method === "session.update" ||
    method?.endsWith("/session/update")
  ) {
    const params = isRecord(obj.params) ? obj.params : obj;
    const sessionId = asSessionId(params) ?? asSessionId(obj);
    const update = isRecord(params.update)
      ? params.update
      : isRecord(params)
        ? params
        : obj;
    return parseUpdateObject(update, sessionId, lineNumber, obj);
  }

  // Prompt-complete style notifications
  if (
    method === "_x.ai/session/prompt_complete" ||
    method === "session/prompt_complete" ||
    method?.endsWith("prompt_complete")
  ) {
    const params = isRecord(obj.params) ? obj.params : obj;
    return {
      line: lineNumber,
      kind: "prompt_complete",
      sessionUpdate: method,
      sessionId: asSessionId(params) ?? asSessionId(obj),
      preview: str(params.stopReason) ?? str(params.stop_reason),
      isAcpShaped: true,
      raw: obj,
    };
  }

  // Other JSON-RPC methods (initialize result-style notifications, etc.)
  if (method) {
    // Bare method with update payload still counts as ACP-shaped session traffic
    if (isRecord(obj.params) && isRecord(obj.params.update)) {
      return parseUpdateObject(
        obj.params.update,
        asSessionId(obj.params) ?? asSessionId(obj),
        lineNumber,
        obj,
      );
    }
    return {
      line: lineNumber,
      kind: "other_session_update",
      sessionUpdate: method,
      sessionId: asSessionId(obj) ??
        (isRecord(obj.params) ? asSessionId(obj.params) : null),
      preview: null,
      isAcpShaped: true,
      raw: obj,
    };
  }

  // JSON-RPC result (response to session/prompt etc.)
  if (obj.result != null && (obj.id != null || obj.jsonrpc != null)) {
    const result = isRecord(obj.result) ? obj.result : {};
    return {
      line: lineNumber,
      kind: "rpc_result",
      sessionUpdate: null,
      sessionId: asSessionId(result) ?? asSessionId(obj),
      preview: str(result.stopReason) ?? str(result.stop_reason),
      isAcpShaped: true,
      raw: obj,
    };
  }

  // Bare params: { sessionId, update: { sessionUpdate, ... } }
  if (isRecord(obj.update)) {
    return parseUpdateObject(
      obj.update,
      asSessionId(obj),
      lineNumber,
      obj,
    );
  }

  // Bare update object: { sessionUpdate: "...", content: ... }
  if (obj.sessionUpdate != null || obj.session_update != null) {
    return parseUpdateObject(obj, asSessionId(obj), lineNumber, obj);
  }

  // Legacy simplified stream — explicitly non-ACP for this diagnostic surface
  if (isLegacySimplifiedStreamLine(obj)) {
    return {
      line: lineNumber,
      kind: "non_acp",
      sessionUpdate: str(obj.type) ?? str(obj.event),
      sessionId: asSessionId(obj),
      preview: extractTextPreview(obj),
      isAcpShaped: false,
      raw: obj,
    };
  }

  return {
    line: lineNumber,
    kind: "non_acp",
    sessionUpdate: null,
    sessionId: asSessionId(obj),
    preview: extractTextPreview(obj),
    isAcpShaped: false,
    raw: obj,
  };
}

/** Split multi-line NDJSON (and optional multi-object paste) into lines. */
export function splitNdjsonText(text: string): string[] {
  if (text == null) return [];
  return String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
}

/** Parse an entire NDJSON blob. */
export function parseAcpNdjsonText(text: string): AcpNdjsonParsedEvent[] {
  const lines = splitNdjsonText(text);
  return lines.map((line, i) => parseAcpNdjsonLine(line, i + 1));
}

/** Aggregate type counts + text extracts from parsed events. */
export function summarizeAcpNdjson(
  events: readonly AcpNdjsonParsedEvent[],
): AcpNdjsonSummary {
  const counts = new Map<AcpNdjsonEventKind, number>();
  const sessionIds = new Set<string>();
  let acpShapedCount = 0;
  let nonAcpCount = 0;
  let invalidCount = 0;
  let emptyCount = 0;
  let nonEmptyLines = 0;
  let assistantText = "";
  let thoughtText = "";

  for (const ev of events) {
    counts.set(ev.kind, (counts.get(ev.kind) ?? 0) + 1);
    if (ev.kind === "empty") {
      emptyCount += 1;
      continue;
    }
    nonEmptyLines += 1;
    if (ev.kind === "invalid") invalidCount += 1;
    else if (ev.isAcpShaped) acpShapedCount += 1;
    else nonAcpCount += 1;
    if (ev.sessionId) sessionIds.add(ev.sessionId);
    if (ev.kind === "agent_message_chunk" && ev.preview) {
      assistantText += ev.preview;
    }
    if (ev.kind === "agent_thought_chunk" && ev.preview) {
      thoughtText += ev.preview;
    }
  }

  const typeCounts: AcpNdjsonTypeCount[] = [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));

  return {
    totalLines: events.length,
    nonEmptyLines,
    parsedEvents: nonEmptyLines,
    acpShapedCount,
    nonAcpCount,
    invalidCount,
    emptyCount,
    typeCounts,
    sessionIds: [...sessionIds].sort(),
    assistantText,
    thoughtText,
    events: [...events],
  };
}

/** One-shot: text → summary. */
export function summarizeAcpNdjsonText(text: string): AcpNdjsonSummary {
  return summarizeAcpNdjson(parseAcpNdjsonText(text));
}

/**
 * Human-readable clipboard summary (no secrets; previews truncated).
 */
export function formatAcpNdjsonSummaryText(summary: AcpNdjsonSummary): string {
  const lines: string[] = [
    "Streaming ACP NDJSON summary",
    `format: ${STREAMING_ACP_NDJSON_OUTPUT_FORMAT} (ACP-shaped; not ${STREAMING_MESSAGES_JSON_OUTPUT_FORMAT})`,
    `min CLI: ${STREAMING_ACP_NDJSON_MIN_CLI}`,
    `lines: ${summary.totalLines} total · ${summary.nonEmptyLines} non-empty`,
    `acp-shaped: ${summary.acpShapedCount} · non-acp: ${summary.nonAcpCount} · invalid: ${summary.invalidCount}`,
  ];
  if (summary.sessionIds.length) {
    lines.push(`sessionIds: ${summary.sessionIds.join(", ")}`);
  }
  lines.push("types:");
  for (const row of summary.typeCounts) {
    if (row.kind === "empty") continue;
    lines.push(`  ${row.kind}: ${row.count}`);
  }
  if (summary.assistantText) {
    const preview = summary.assistantText.slice(0, 240);
    lines.push(
      `assistant preview: ${preview}${summary.assistantText.length > 240 ? "…" : ""}`,
    );
  }
  if (summary.thoughtText) {
    const preview = summary.thoughtText.slice(0, 160);
    lines.push(
      `thought preview: ${preview}${summary.thoughtText.length > 160 ? "…" : ""}`,
    );
  }
  return lines.join("\n");
}

/** Parse `0.2.117` / `grok 0.2.117` style version strings. */
export function parseCliSemver(
  raw: string | null | undefined,
): [number, number, number] | null {
  if (raw == null) return null;
  const m = String(raw).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? "0")];
}

function cmpSemver(
  a: [number, number, number],
  b: [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return 1;
    if (a[i]! < b[i]!) return -1;
  }
  return 0;
}

/**
 * `true` when CLI ≥ 0.2.117; `false` when older; `null` when unparseable
 * (callers may soft-allow or soft-deny).
 */
export function cliSupportsStreamingAcpNdjson(
  rawVersion: string | null | undefined,
): boolean | null {
  const parsed = parseCliSemver(rawVersion);
  if (!parsed) return null;
  const min = parseCliSemver(STREAMING_ACP_NDJSON_MIN_CLI)!;
  return cmpSemver(parsed, min) >= 0;
}

/**
 * Headless argv fragments for ACP-shaped streaming-json.
 * Always returns the pair (caller decides soft-gate).
 */
export function streamingAcpNdjsonOutputFormatArgs(): string[] {
  return ["--output-format", STREAMING_ACP_NDJSON_OUTPUT_FORMAT];
}

/**
 * Soft-gated output-format args: only when CLI is known ≥ 0.2.117.
 * Unparseable / older → `[]` (omit flag; avoid hard fail on old CLIs).
 */
export function streamingAcpNdjsonOutputFormatArgsSoft(
  rawCliVersion: string | null | undefined,
): string[] {
  if (cliSupportsStreamingAcpNdjson(rawCliVersion) === true) {
    return streamingAcpNdjsonOutputFormatArgs();
  }
  return [];
}

/**
 * Full headless probe argv (without binary path).
 * Soft-gated: empty output-format when CLI too old / unknown.
 */
export function streamingAcpNdjsonProbeArgs(opts: {
  prompt?: string;
  rawCliVersion?: string | null;
  alwaysApprove?: boolean;
  maxTurns?: number;
  cwd?: string | null;
}): string[] {
  const prompt = (opts.prompt ?? STREAMING_ACP_NDJSON_PROBE_PROMPT).trim() ||
    STREAMING_ACP_NDJSON_PROBE_PROMPT;
  const maxTurns = Math.max(1, Math.min(4, Math.round(opts.maxTurns ?? 1)));
  const args: string[] = [
    "--no-auto-update",
    "-p",
    prompt,
    "--max-turns",
    String(maxTurns),
  ];
  if (opts.alwaysApprove !== false) {
    args.push("--always-approve");
  }
  if (opts.cwd && opts.cwd.trim()) {
    args.push("--cwd", opts.cwd.trim());
  }
  args.push(...streamingAcpNdjsonOutputFormatArgsSoft(opts.rawCliVersion));
  return args;
}

/**
 * Whether the probe args include streaming-json (version gate passed).
 */
export function probeArgsIncludeStreamingJson(args: readonly string[]): boolean {
  const i = args.indexOf("--output-format");
  if (i < 0 || i + 1 >= args.length) return false;
  return args[i + 1] === STREAMING_ACP_NDJSON_OUTPUT_FORMAT;
}
