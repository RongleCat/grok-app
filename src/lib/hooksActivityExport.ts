/**
 * Hooks activity export — pure helpers for redacted JSON/text download
 * and clipboard summary from the local recent-activity ring.
 *
 * Never invents rows. Re-redacts every free-form field before export.
 * Soft-fails empty / clipboard / download without claiming success.
 * No DOM / Tauri side effects — callers own clipboard and downloads.
 */

import { redact } from "./redact";
import {
  HOOK_ACTIVITY_MAX,
  HOOK_DETAIL_MAX,
  parseHookActivityRecord,
  type HookActivityOutcome,
  type HookActivityRecord,
  type HookActivitySource,
} from "./hooksDebug";

/** Soft max rows in a single export (UI ring is smaller; allow headroom). */
export const HOOKS_ACTIVITY_EXPORT_MAX = 100;

/** Cap free-form type / detail / name fields so exports never carry multi-kb dumps. */
export const HOOKS_ACTIVITY_EXPORT_FIELD_MAX = 200;

/** One row in a hooks activity export file (known fields only; re-redacted). */
export type HooksActivityExportRow = {
  id: string;
  type: string;
  outcome: HookActivityOutcome;
  /** Epoch ms when recorded (local). */
  atMs: number;
  /** ISO timestamp for human readability. */
  at: string;
  detail: string;
  source: HookActivitySource;
  toolName?: string;
  hookName?: string;
};

/** Echo of filters used to select rows (never free-form secrets). */
export type HooksActivityExportFilter = {
  outcome: "all" | HookActivityOutcome;
};

/**
 * Redacted hooks activity export (download / clipboard).
 * Structured fields only — details re-run through {@link redact}.
 */
export type HooksActivityExport = {
  kind: "hooks_activity";
  generatedAt: string;
  source: "hooks_activity";
  count: number;
  /** True when input had more rows than the soft max cap. */
  truncated: boolean;
  summary: {
    ok: number;
    fail: number;
    skip: number;
    info: number;
    total: number;
  };
  filter: HooksActivityExportFilter;
  rows: HooksActivityExportRow[];
};

/**
 * Planned export payload for UI: redacted JSON + text, empty honesty,
 * safe filenames. Never invents rows when input is empty.
 */
export type HooksActivityExportPlan = {
  empty: boolean;
  count: number;
  truncated: boolean;
  snapshot: HooksActivityExport;
  /** Pretty JSON body (always valid; empty plan still has count 0). */
  json: string;
  /** Plain-text summary. Empty when nothing honest to export. */
  text: string;
  filenameJson: string;
  filenameText: string;
};

/** Soft-fail kinds for copy / download. */
export type HooksExportErrorKind =
  | "empty"
  | "clipboard"
  | "download"
  | "other";

export type HooksExportChannel = "copy" | "download";

export type HooksExportOutcome =
  | { ok: true; channel: HooksExportChannel }
  | {
      ok: false;
      kind: HooksExportErrorKind;
      channel: HooksExportChannel;
    };

const OUTCOMES = new Set<string>(["ok", "fail", "skip", "info"]);

function capField(
  raw: string | null | undefined,
  max: number = HOOKS_ACTIVITY_EXPORT_FIELD_MAX,
): string {
  if (typeof raw !== "string") return "";
  let s = redact(raw)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  // Extra secret-ish key=value patterns (same spirit as hooksDebug).
  s = s.replace(
    /\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[^\s"',;]{6,}/gi,
    "$1=[REDACTED]",
  );
  if (s.length > max) {
    s = `${s.slice(0, Math.max(1, max - 1))}…`;
  }
  return s;
}

function isoFromMs(atMs: number): string {
  if (!atMs || atMs <= 0 || !Number.isFinite(atMs)) return "";
  try {
    return new Date(atMs).toISOString();
  } catch {
    return "";
  }
}

function normalizeOutcomeFilter(
  raw: string | null | undefined,
): HooksActivityExportFilter["outcome"] {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (OUTCOMES.has(s)) return s as HookActivityOutcome;
  return "all";
}

function toExportRow(rec: HookActivityRecord): HooksActivityExportRow {
  const detail = capField(rec.detail, HOOK_DETAIL_MAX);
  const type = capField(rec.type, 80) || "Hook";
  const id = capField(rec.id, 80) || "unknown";
  const toolName = capField(rec.toolName, 120);
  const hookName = capField(rec.hookName, 160);
  return {
    id,
    type,
    outcome: rec.outcome,
    atMs: rec.atMs > 0 ? rec.atMs : 0,
    at: isoFromMs(rec.atMs),
    detail,
    source: rec.source,
    ...(toolName ? { toolName } : {}),
    ...(hookName ? { hookName } : {}),
  };
}

/**
 * Build a redacted export snapshot from activity rows.
 * Prefer filtered rows from the UI. Never invents data.
 * Empty input → count 0 snapshot (caller soft-fails; no throw).
 */
export function buildHooksActivityExport(
  rows: readonly HookActivityRecord[] | null | undefined,
  opts?: {
    nowMs?: number;
    max?: number;
    generatedAt?: string;
    outcomeFilter?: string | null;
  },
): HooksActivityExport {
  const maxRaw = opts?.max ?? HOOKS_ACTIVITY_EXPORT_MAX;
  const max =
    typeof maxRaw === "number" && Number.isFinite(maxRaw) && maxRaw > 0
      ? Math.min(500, Math.floor(maxRaw))
      : HOOKS_ACTIVITY_EXPORT_MAX;
  const generatedAt =
    opts?.generatedAt ??
    new Date(opts?.nowMs ?? Date.now()).toISOString();
  const filter: HooksActivityExportFilter = {
    outcome: normalizeOutcomeFilter(opts?.outcomeFilter),
  };

  const list = Array.isArray(rows) ? rows : [];
  const out: HooksActivityExportRow[] = [];
  const seen = new Set<string>();
  let truncated = false;

  for (const raw of list) {
    const parsed = parseHookActivityRecord(raw);
    if (!parsed) continue;
    if (seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    if (out.length >= max) {
      truncated = true;
      continue;
    }
    out.push(toExportRow(parsed));
  }

  let ok = 0;
  let fail = 0;
  let skip = 0;
  let info = 0;
  for (const row of out) {
    if (row.outcome === "ok") ok += 1;
    else if (row.outcome === "fail") fail += 1;
    else if (row.outcome === "skip") skip += 1;
    else info += 1;
  }

  return {
    kind: "hooks_activity",
    generatedAt,
    source: "hooks_activity",
    count: out.length,
    truncated,
    summary: {
      ok,
      fail,
      skip,
      info,
      total: out.length,
    },
    filter,
    rows: out,
  };
}

/** Pretty JSON for client download (known fields only; already redacted). */
export function serializeHooksActivityExport(
  snapshot: HooksActivityExport,
): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Plain-text export body (clipboard / .txt).
 * Accepts either a snapshot or raw activity rows.
 * Empty → empty string so UI can soft-fail without inventing activity.
 */
export function formatHooksActivityExportText(
  rowsOrSnapshot:
    | readonly HookActivityRecord[]
    | HooksActivityExport
    | null
    | undefined,
  opts?: {
    nowMs?: number;
    max?: number;
    generatedAt?: string;
    outcomeFilter?: string | null;
  },
): string {
  const snapshot: HooksActivityExport =
    rowsOrSnapshot &&
    typeof rowsOrSnapshot === "object" &&
    !Array.isArray(rowsOrSnapshot) &&
    (rowsOrSnapshot as HooksActivityExport).kind === "hooks_activity"
      ? (rowsOrSnapshot as HooksActivityExport)
      : buildHooksActivityExport(
          rowsOrSnapshot as readonly HookActivityRecord[] | null | undefined,
          opts,
        );

  if (!snapshot || snapshot.count === 0 || snapshot.rows.length === 0) {
    return "";
  }

  const s = snapshot.summary;
  const f = snapshot.filter;
  const header = [
    "# Hooks activity export (redacted)",
    `generatedAt: ${snapshot.generatedAt}`,
    `filter: outcome=${f.outcome}`,
    `summary: total=${s.total} ok=${s.ok} fail=${s.fail} skip=${s.skip} info=${s.info}${
      snapshot.truncated ? " truncated=true" : ""
    }`,
    "",
  ];

  const blocks = snapshot.rows.map((row, i) => {
    const lines = [
      `### ${i + 1}/${snapshot.count}`,
      `[${row.outcome.toUpperCase()}] ${row.type}`,
      `id: ${row.id}`,
      `source: ${row.source}`,
      `at: ${row.at || String(row.atMs || "")}`,
    ];
    if (row.hookName) lines.push(`hook: ${row.hookName}`);
    if (row.toolName) lines.push(`tool: ${row.toolName}`);
    if (row.detail) {
      lines.push("");
      lines.push(row.detail);
    }
    return lines.join("\n");
  });

  const body = [...header, blocks.join("\n\n")].join("\n");
  return redact(body).trim() + "\n";
}

/** Soft-empty: nothing honest to export. */
export function hooksActivityExportIsEmpty(
  snapshot: HooksActivityExport | HooksActivityExportPlan | null | undefined,
): boolean {
  if (!snapshot) return true;
  if ("empty" in snapshot && typeof snapshot.empty === "boolean") {
    return snapshot.empty || snapshot.count === 0;
  }
  const s = snapshot as HooksActivityExport;
  return !s.count || s.count === 0 || !s.rows || s.rows.length === 0;
}

/** Filesystem-safe download basename (no extension). */
export function hooksActivityExportBasename(
  generatedAt?: string | null,
): string {
  const stamp = (generatedAt ?? new Date().toISOString())
    .slice(0, 19)
    .replace(/[:T]/g, "-")
    .replace(/[^0-9A-Za-z._-]/g, "");
  return `grok-app-hooks-activity-${stamp || "export"}`;
}

export function hooksActivityExportJsonFilename(
  generatedAt?: string | null,
): string {
  return `${hooksActivityExportBasename(generatedAt)}.json`;
}

export function hooksActivityExportTextFilename(
  generatedAt?: string | null,
): string {
  return `${hooksActivityExportBasename(generatedAt)}.txt`;
}

/**
 * Plan a redacted export from activity rows.
 * Returns JSON + text + empty honesty for soft-fail UI.
 * Soft max rows via {@link HOOKS_ACTIVITY_EXPORT_MAX} (overridable).
 */
export function planHooksActivityExport(
  rows: readonly HookActivityRecord[] | null | undefined,
  opts?: {
    nowMs?: number;
    max?: number;
    generatedAt?: string;
    outcomeFilter?: string | null;
  },
): HooksActivityExportPlan {
  const snapshot = buildHooksActivityExport(rows, opts);
  const empty = snapshot.count === 0;
  const json = serializeHooksActivityExport(snapshot);
  const text = empty ? "" : formatHooksActivityExportText(snapshot);
  return {
    empty,
    count: snapshot.count,
    truncated: snapshot.truncated,
    snapshot,
    json,
    text,
    filenameJson: hooksActivityExportJsonFilename(snapshot.generatedAt),
    filenameText: hooksActivityExportTextFilename(snapshot.generatedAt),
  };
}

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const code =
      typeof (err as Error & { code?: unknown }).code === "string"
        ? String((err as Error & { code?: string }).code)
        : "";
    return `${code} ${err.message} ${err.name}`.trim();
  }
  if (typeof err === "object") {
    const o = err as { code?: unknown; message?: unknown; reason?: unknown };
    const parts = [o.code, o.message, o.reason]
      .filter((x) => x != null && String(x).trim())
      .map(String);
    if (parts.length) return parts.join(" ");
  }
  return String(err);
}

/**
 * Classify a thrown value into a stable export soft-fail kind.
 * Prefer explicit `code` over free-form text.
 * Kinds: empty | clipboard | download | other.
 */
export function classifyHooksExportError(err: unknown): HooksExportErrorKind {
  if (err == null || err === "") return "other";

  const code =
    typeof err === "object" &&
    err != null &&
    typeof (err as { code?: unknown }).code === "string"
      ? String((err as { code: string }).code).trim().toLowerCase()
      : "";

  if (
    code === "empty" ||
    code === "empty_view" ||
    code === "nothing" ||
    code === "no_rows"
  ) {
    return "empty";
  }
  if (code === "clipboard" || code === "clipboard_failed") return "clipboard";
  if (
    code === "download" ||
    code === "download_failed" ||
    code === "download-failed" ||
    code === "write_failed" ||
    code === "save_failed"
  ) {
    return "download";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";
  if (
    s.includes("nothing to export") ||
    s.includes("no activity") ||
    s.includes("empty view") ||
    s.includes("no rows") ||
    /^empty(\s+error)?$/.test(s.trim()) ||
    s.trim() === "error: empty"
  ) {
    return "empty";
  }
  if (
    s.includes("clipboard") ||
    s.includes("write text") ||
    s.includes("copy failed") ||
    s.includes("notallowed") ||
    s.includes("permission denied")
  ) {
    return "clipboard";
  }
  if (
    s.includes("download") ||
    s.includes("save failed") ||
    s.includes("write failed") ||
    s.includes("createobjecturl") ||
    s.includes("blob")
  ) {
    return "download";
  }
  return "other";
}

/**
 * Resolve copy/download outcome for toast honesty.
 * Empty plans always soft-fail as `empty` (never claim success).
 */
export function resolveHooksExportOutcome(opts: {
  channel: HooksExportChannel;
  empty: boolean;
  /** For copy: false when clipboard API failed without throwing. */
  copyOk?: boolean;
  /** Thrown error from clipboard / download path. */
  error?: unknown;
}): HooksExportOutcome {
  const channel = opts.channel === "download" ? "download" : "copy";
  if (opts.empty) {
    return { ok: false, kind: "empty", channel };
  }
  if (opts.error != null) {
    return {
      ok: false,
      kind: classifyHooksExportError(opts.error),
      channel,
    };
  }
  if (channel === "copy" && opts.copyOk === false) {
    return { ok: false, kind: "clipboard", channel };
  }
  return { ok: true, channel };
}

/**
 * i18n message key for an export outcome (success or soft-fail).
 * Keys must exist under `ext.hooks.activity.*` in messages.
 */
export function hooksExportOutcomeMessageKey(
  outcome: HooksExportOutcome,
):
  | "ext.hooks.activity.exportCopied"
  | "ext.hooks.activity.exportDownloaded"
  | "ext.hooks.activity.exportEmpty"
  | "ext.hooks.activity.exportCopyFailed"
  | "ext.hooks.activity.exportDownloadFailed"
  | "ext.hooks.activity.exportFailed" {
  if (outcome.ok) {
    return outcome.channel === "download"
      ? "ext.hooks.activity.exportDownloaded"
      : "ext.hooks.activity.exportCopied";
  }
  switch (outcome.kind) {
    case "empty":
      return "ext.hooks.activity.exportEmpty";
    case "clipboard":
      return "ext.hooks.activity.exportCopyFailed";
    case "download":
      return "ext.hooks.activity.exportDownloadFailed";
    default:
      return "ext.hooks.activity.exportFailed";
  }
}

/** Re-export ring size for callers that want a sensible default cap. */
export { HOOK_ACTIVITY_MAX };
