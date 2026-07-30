/**
 * Hooks trigger debug — parse + ring-buffer last N hook outcomes for
 * Settings → Extensions → Hooks “Recent activity”.
 *
 * Sources (in priority order when present):
 * 1. Host `session://hook` payloads (ACP `hook_execution` / `hook_annotation`)
 * 2. Agent stderr lines that mention hooks
 * 3. Tool events / stream snippets with `hookSpecificOutput` or hook failures
 *
 * Session-scoped in-memory only (cleared when the app process restarts).
 * All detail strings are redacted before storage / UI.
 */

import { redact } from "./redact";

/** Default ring size for recent hook outcomes. */
export const HOOK_ACTIVITY_MAX = 30;

/** Max characters kept in a detail line after redaction. */
export const HOOK_DETAIL_MAX = 160;

export type HookActivityOutcome = "ok" | "fail" | "skip" | "info";

export type HookActivitySource = "host" | "stderr" | "tool" | "stream";

export type HookActivityRecord = {
  id: string;
  /** Lifecycle event type (SessionStart, PreToolUse, …) or short label. */
  type: string;
  outcome: HookActivityOutcome;
  /** Epoch ms when recorded (local). */
  atMs: number;
  /** Short redacted detail for the list row. */
  detail: string;
  source: HookActivitySource;
  toolName?: string;
  hookName?: string;
};

export type HostHookPayload = {
  sessionId?: string | null;
  kind?: string | null;
  eventName?: string | null;
  event_name?: string | null;
  toolName?: string | null;
  tool_name?: string | null;
  hookName?: string | null;
  hook_name?: string | null;
  status?: string | null;
  ok?: boolean | null;
  detail?: string | null;
  message?: string | null;
  text?: string | null;
  reason?: string | null;
  /** Nested ACP update or run entries. */
  update?: unknown;
  hooks?: unknown;
  runs?: unknown;
  entries?: unknown;
  [key: string]: unknown;
};

export type ToolHookSignal = {
  title?: string | null;
  kind?: string | null;
  status?: string | null;
  detail?: string | null;
  path?: string | null;
  toolCallId?: string | null;
};

// ── Redaction / formatting ──────────────────────────────────────────────────

const EXTRA_SENSITIVE =
  /\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[^\s"',;]{6,}/gi;

/** Collapse whitespace, redact secrets, truncate for UI. */
export function redactHookDetail(
  text: string | null | undefined,
  maxLen: number = HOOK_DETAIL_MAX,
): string {
  let s = String(text ?? "")
    .replace(/\u001b\[[0-9;]*m/g, "") // strip ANSI
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  s = redact(s);
  s = s.replace(EXTRA_SENSITIVE, "$1=[REDACTED]");
  // Avoid dumping full stdin JSON envelopes into the list.
  if (s.length > maxLen) {
    s = `${s.slice(0, Math.max(1, maxLen - 1))}…`;
  }
  return s;
}

/** Normalize lifecycle event names to a short stable label. */
export function normalizeHookEventType(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  if (!t) return "Hook";
  // snake / kebab / camel → Pascal-ish display
  const cleaned = t
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  if (!cleaned) return "Hook";
  // Known events keep canonical PascalCase when recognizable
  const compact = cleaned.replace(/\s+/g, "").toLowerCase();
  const known: Record<string, string> = {
    sessionstart: "SessionStart",
    sessionend: "SessionEnd",
    userpromptsubmit: "UserPromptSubmit",
    pretooluse: "PreToolUse",
    posttooluse: "PostToolUse",
    posttoolusefailure: "PostToolUseFailure",
    permissiondenied: "PermissionDenied",
    stop: "Stop",
    stopfailure: "StopFailure",
    notification: "Notification",
    subagentstart: "SubagentStart",
    subagentstop: "SubagentStop",
    precompact: "PreCompact",
    postcompact: "PostCompact",
  };
  if (known[compact]) return known[compact];
  // Title-case words for unknowns
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

export function outcomeFromStatus(
  status: string | null | undefined,
  ok?: boolean | null,
): HookActivityOutcome {
  if (typeof ok === "boolean") return ok ? "ok" : "fail";
  const s = String(status ?? "").trim().toLowerCase();
  if (!s) return "info";
  if (
    s === "ok" ||
    s === "success" ||
    s === "succeeded" ||
    s === "completed" ||
    s === "allow" ||
    s === "allowed"
  ) {
    return "ok";
  }
  if (
    s === "fail" ||
    s === "failed" ||
    s === "error" ||
    s === "denied" ||
    s === "deny" ||
    s === "block" ||
    s === "blocked" ||
    s === "timeout" ||
    s === "timed_out" ||
    s === "timedout"
  ) {
    return "fail";
  }
  if (s === "skip" || s === "skipped" || s === "disabled") return "skip";
  return "info";
}

function outcomeFromNestedStatus(value: unknown): HookActivityOutcome | null {
  if (value == null) return null;
  if (typeof value === "string") return outcomeFromStatus(value);
  if (typeof value === "boolean") return value ? "ok" : "fail";
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    // Internally tagged: { Success: ... } | { Failed: ... } | { Skipped: ... }
    const keys = Object.keys(o);
    if (keys.length === 1) {
      const k = keys[0]!.toLowerCase();
      if (k === "success" || k === "ok") return "ok";
      if (k === "failed" || k === "fail" || k === "error") return "fail";
      if (k === "skipped" || k === "skip") return "skip";
    }
    if ("ok" in o && typeof o.ok === "boolean") return o.ok ? "ok" : "fail";
    if (typeof o.status === "string") return outcomeFromStatus(o.status);
    if (typeof o.type === "string") return outcomeFromStatus(o.type);
  }
  return null;
}

function strField(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

let _seq = 0;
function nextId(prefix: string): string {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq}`;
}

// ── Host payload parser ─────────────────────────────────────────────────────

/**
 * Parse a Host `session://hook` payload (or raw ACP hook update) into records.
 * Returns [] when the payload is not hook-related / empty.
 */
export function parseHostHookPayload(
  payload: unknown,
  nowMs: number = Date.now(),
): HookActivityRecord[] {
  if (payload == null) return [];
  if (typeof payload === "string") {
    const rec = parseHookLogLine(payload, nowMs);
    return rec ? [rec] : [];
  }
  if (typeof payload !== "object") return [];

  const root = payload as HostHookPayload;
  // Nested `update` (full session/update) preferred when present
  const updateObj =
    root.update && typeof root.update === "object"
      ? (root.update as Record<string, unknown>)
      : (root as Record<string, unknown>);

  const kindRaw =
    strField(updateObj, "sessionUpdate", "session_update", "kind") ||
    (typeof root.kind === "string" ? root.kind : "") ||
    "";
  const kind = kindRaw.toLowerCase();

  const eventName =
    strField(
      updateObj,
      "eventName",
      "event_name",
      "hookEventName",
      "hook_event_name",
    ) ||
    (typeof root.eventName === "string" ? root.eventName : undefined) ||
    (typeof root.event_name === "string" ? root.event_name : undefined);

  const toolName =
    strField(updateObj, "toolName", "tool_name") ||
    (typeof root.toolName === "string" ? root.toolName : undefined) ||
    (typeof root.tool_name === "string" ? root.tool_name : undefined);

  const topDetail =
    strField(
      updateObj,
      "detail",
      "message",
      "text",
      "reason",
      "additionalContext",
      "additional_context",
    ) ||
    (typeof root.detail === "string" ? root.detail : undefined) ||
    (typeof root.message === "string" ? root.message : undefined) ||
    (typeof root.text === "string" ? root.text : undefined) ||
    (typeof root.reason === "string" ? root.reason : undefined);

  // Per-run entries when present
  const runs =
    (Array.isArray(updateObj.hooks) && updateObj.hooks) ||
    (Array.isArray(updateObj.runs) && updateObj.runs) ||
    (Array.isArray(updateObj.entries) && updateObj.entries) ||
    (Array.isArray(root.hooks) && root.hooks) ||
    (Array.isArray(root.runs) && root.runs) ||
    (Array.isArray(root.entries) && root.entries) ||
    null;

  if (runs && runs.length > 0) {
    const out: HookActivityRecord[] = [];
    for (const raw of runs) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as Record<string, unknown>;
      const hookName = strField(e, "name", "hookName", "hook_name", "command", "url");
      const entryEvent =
        strField(e, "eventName", "event_name", "hookEventName") || eventName;
      const oc =
        outcomeFromNestedStatus(e.status) ??
        outcomeFromNestedStatus(e.result) ??
        outcomeFromNestedStatus(e.outcome) ??
        (typeof e.ok === "boolean" ? (e.ok ? "ok" : "fail") : null) ??
        outcomeFromStatus(
          strField(e, "status", "state", "result"),
          typeof e.ok === "boolean" ? e.ok : undefined,
        );
      const detailParts = [
        hookName,
        strField(e, "detail", "message", "reason", "error", "stderr"),
        toolName ? `tool ${toolName}` : undefined,
      ].filter(Boolean);
      out.push({
        id: nextId("host"),
        type: normalizeHookEventType(entryEvent || kind || "Hook"),
        outcome: oc === "info" && kind.includes("annotation") ? "info" : oc,
        atMs: nowMs,
        detail: redactHookDetail(detailParts.join(" · ") || topDetail || kind),
        source: "host",
        toolName: toolName || undefined,
        hookName: hookName || undefined,
      });
    }
    if (out.length) return out;
  }

  // Single summary record
  const isHookKind =
    kind.includes("hook") ||
    !!eventName ||
    !!topDetail ||
    typeof root.ok === "boolean" ||
    !!root.status;

  if (!isHookKind && !kind) return [];

  let outcome: HookActivityOutcome =
    outcomeFromStatus(
      typeof root.status === "string" ? root.status : strField(updateObj, "status"),
      typeof root.ok === "boolean" ? root.ok : undefined,
    ) ?? "info";

  if (kind.includes("annotation") && outcome === "info") {
    // Annotation text often encodes fail/deny
    const low = String(topDetail || "").toLowerCase();
    if (
      low.includes("fail") ||
      low.includes("error") ||
      low.includes("denied") ||
      low.includes("block") ||
      low.includes("timeout")
    ) {
      outcome = "fail";
    } else if (low.includes("skip") || low.includes("disabled")) {
      outcome = "skip";
    } else if (
      low.includes("success") ||
      low.includes("allow") ||
      low.includes("ok")
    ) {
      outcome = "ok";
    }
  }

  // Ignore empty non-hook noise
  if (!eventName && !topDetail && !kind.includes("hook") && outcome === "info") {
    return [];
  }

  const typeLabel = normalizeHookEventType(
    eventName || (kind.includes("annotation") ? "Annotation" : kind || "Hook"),
  );

  return [
    {
      id: nextId("host"),
      type: typeLabel,
      outcome,
      atMs: nowMs,
      detail: redactHookDetail(
        topDetail ||
          [toolName ? `tool ${toolName}` : "", kind.replace(/_/g, " ")]
            .filter(Boolean)
            .join(" · ") ||
          typeLabel,
      ),
      source: "host",
      toolName: toolName || undefined,
      hookName:
        (typeof root.hookName === "string" && root.hookName) ||
        (typeof root.hook_name === "string" && root.hook_name) ||
        undefined,
    },
  ];
}

// ── Log / stderr line parser ────────────────────────────────────────────────

const HOOK_LOG_RE =
  /\bhooks?\b|hookSpecificOutput|hook_event|PreToolUse|PostToolUse|SessionStart|UserPromptSubmit|StopFailure|hook_execution|hook_annotation/i;

/** True when a free-form string is likely about hooks (not e.g. webhook). */
export function isHookRelatedText(text: string | null | undefined): boolean {
  const s = String(text ?? "");
  if (!s.trim()) return false;
  // Avoid common false positives (webhook, fishing hook metaphors rare in logs)
  if (/\bwebhook\b/i.test(s) && !/\bhooks?\b/i.test(s.replace(/webhook/gi, ""))) {
    return false;
  }
  return HOOK_LOG_RE.test(s);
}

/**
 * Parse a single agent/log/stderr line into a hook activity row.
 * Returns null when the line is not hook-related.
 */
export function parseHookLogLine(
  line: string | null | undefined,
  nowMs: number = Date.now(),
): HookActivityRecord | null {
  const raw = String(line ?? "").trim();
  if (!raw || !isHookRelatedText(raw)) return null;

  const low = raw.toLowerCase();
  let outcome: HookActivityOutcome = "info";
  if (
    low.includes("failed") ||
    low.includes("fail ") ||
    low.includes("error") ||
    low.includes("denied") ||
    low.includes("timeout") ||
    low.includes("timed out") ||
    low.includes("blocked by") ||
    low.includes("not found") ||
    low.includes("not executable") ||
    low.includes("invalid")
  ) {
    outcome = "fail";
  } else if (low.includes("skipped") || low.includes("disabled")) {
    outcome = "skip";
  } else if (
    low.includes("success") ||
    low.includes("loaded from") ||
    low.includes("allow") ||
    low.includes("completed")
  ) {
    outcome = "ok";
  }

  // Try to extract event type from common phrases
  let type = "Hook";
  const eventMatch = raw.match(
    /\b(SessionStart|SessionEnd|UserPromptSubmit|PreToolUse|PostToolUseFailure|PostToolUse|PermissionDenied|StopFailure|SubagentStart|SubagentStop|PreCompact|PostCompact|Notification|Stop)\b/i,
  );
  if (eventMatch) {
    type = normalizeHookEventType(eventMatch[1]);
  } else if (/hook annotation/i.test(raw)) {
    type = "Annotation";
  } else if (/hook.?execution/i.test(raw)) {
    type = "Execution";
  } else if (/loaded from/i.test(raw)) {
    type = "Load";
  }

  const nameMatch =
    raw.match(/hook\s+'([^']+)'/i) ||
    raw.match(/hook\s+"([^"]+)"/i) ||
    raw.match(/hook\s+`([^`]+)`/i);

  return {
    id: nextId("log"),
    type,
    outcome,
    atMs: nowMs,
    detail: redactHookDetail(raw),
    source: "stderr",
    hookName: nameMatch?.[1],
  };
}

// ── Tool / stream signal parser ─────────────────────────────────────────────

/**
 * When a tool event title/detail mentions hooks (deny, hookSpecificOutput,
 * failure), surface a short activity row. Ignores unrelated tools.
 */
export function parseToolHookSignal(
  tool: ToolHookSignal | null | undefined,
  nowMs: number = Date.now(),
): HookActivityRecord | null {
  if (!tool) return null;
  const blob = [tool.title, tool.kind, tool.detail, tool.path]
    .filter(Boolean)
    .join("\n");
  if (!isHookRelatedText(blob)) return null;

  // Prefer structured hookSpecificOutput when present
  const detail = tool.detail || tool.title || "";
  let type = "Hook";
  let outcome = outcomeFromStatus(tool.status);
  let extractedDetail = detail;

  const jsonMatch = detail.match(/\{[\s\S]*hookSpecificOutput[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const hso = parsed.hookSpecificOutput;
      if (hso && typeof hso === "object") {
        const h = hso as Record<string, unknown>;
        const en = strField(h, "hookEventName", "hook_event_name", "eventName");
        if (en) type = normalizeHookEventType(en);
        const ctx = strField(
          h,
          "additionalContext",
          "additional_context",
          "reason",
          "message",
        );
        if (ctx) extractedDetail = ctx;
      }
      if (typeof parsed.decision === "string") {
        const d = parsed.decision.toLowerCase();
        if (d === "deny" || d === "block") outcome = "fail";
        else if (d === "allow") outcome = "ok";
      }
    } catch {
      // keep free-form detail
    }
  }

  if (type === "Hook") {
    const em = blob.match(
      /\b(SessionStart|PreToolUse|PostToolUse|Stop|StopFailure|UserPromptSubmit)\b/i,
    );
    if (em) type = normalizeHookEventType(em[1]);
  }

  if (outcome === "info") {
    const low = blob.toLowerCase();
    if (
      low.includes("fail") ||
      low.includes("denied") ||
      low.includes("error") ||
      low.includes("block")
    ) {
      outcome = "fail";
    } else if (low.includes("skip")) {
      outcome = "skip";
    }
  }

  return {
    id: nextId("tool"),
    type,
    outcome,
    atMs: nowMs,
    detail: redactHookDetail(extractedDetail || tool.title || type),
    source: "tool",
    toolName: tool.kind || tool.title || undefined,
  };
}

// ── Ring buffer store ───────────────────────────────────────────────────────

type Listener = (records: readonly HookActivityRecord[]) => void;

let _records: HookActivityRecord[] = [];
const _listeners = new Set<Listener>();
let _max = HOOK_ACTIVITY_MAX;

function notify(): void {
  const snap = _records.slice();
  for (const l of _listeners) {
    try {
      l(snap);
    } catch {
      // listener errors must not break the store
    }
  }
}

/** Test / advanced: change ring capacity (clamped). */
export function setHookActivityMax(n: number): void {
  _max = Math.max(1, Math.min(200, Math.floor(n) || HOOK_ACTIVITY_MAX));
  if (_records.length > _max) {
    _records = _records.slice(0, _max);
    notify();
  }
}

export function listHookActivities(): readonly HookActivityRecord[] {
  return _records.slice();
}

export function clearHookActivities(): void {
  if (_records.length === 0) return;
  _records = [];
  notify();
}

/** Push one or many records (newest first). Dedupes identical type+detail within 1s. */
export function pushHookActivity(
  input: HookActivityRecord | HookActivityRecord[] | null | undefined,
): void {
  if (input == null) return;
  const list = Array.isArray(input) ? input : [input];
  if (!list.length) return;

  let changed = false;
  for (const rec of list) {
    if (!rec || !rec.type) continue;
    const detail = redactHookDetail(rec.detail);
    const next: HookActivityRecord = {
      ...rec,
      detail,
      type: rec.type.trim() || "Hook",
      atMs: rec.atMs > 0 ? rec.atMs : Date.now(),
    };
    // Cheap de-dupe: same type + detail within 1s of newest
    const head = _records[0];
    if (
      head &&
      head.type === next.type &&
      head.detail === next.detail &&
      head.outcome === next.outcome &&
      Math.abs(head.atMs - next.atMs) < 1000
    ) {
      continue;
    }
    _records = [next, ..._records].slice(0, _max);
    changed = true;
  }
  if (changed) notify();
}

/**
 * Ingest a Host / stderr / tool signal; only mutates store when a hook record
 * is successfully parsed.
 */
export function ingestHostHookPayload(
  payload: unknown,
  nowMs: number = Date.now(),
): HookActivityRecord[] {
  const recs = parseHostHookPayload(payload, nowMs);
  if (recs.length) pushHookActivity(recs);
  return recs;
}

export function ingestHookLogLine(
  line: string | null | undefined,
  nowMs: number = Date.now(),
): HookActivityRecord | null {
  const rec = parseHookLogLine(line, nowMs);
  if (rec) pushHookActivity(rec);
  return rec;
}

export function ingestToolHookSignal(
  tool: ToolHookSignal | null | undefined,
  nowMs: number = Date.now(),
): HookActivityRecord | null {
  const rec = parseToolHookSignal(tool, nowMs);
  if (rec) pushHookActivity(rec);
  return rec;
}

export function subscribeHookActivities(listener: Listener): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/** Compact local time for activity rows. */
export function formatHookActivityTime(
  atMs: number,
  locale?: string,
): string {
  if (!atMs || atMs <= 0) return "";
  try {
    return new Date(atMs).toLocaleTimeString(locale || undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return new Date(atMs).toISOString().slice(11, 19);
  }
}

/** Outcome badge label (English fallback; UI should prefer i18n). */
export function hookOutcomeLabel(outcome: HookActivityOutcome): string {
  switch (outcome) {
    case "ok":
      return "ok";
    case "fail":
      return "fail";
    case "skip":
      return "skip";
    default:
      return "info";
  }
}

/** Reset module state (tests). */
export function __resetHookActivityStoreForTests(): void {
  _records = [];
  _listeners.clear();
  _max = HOOK_ACTIVITY_MAX;
  _seq = 0;
}
