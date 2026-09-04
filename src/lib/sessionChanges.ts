/**
 * Session change / diff panel helpers (L06).
 * Pure functions for path normalize, edit-tool detection, and change list merge.
 */

import type { ChatMessage, ToolEventPayload } from "@/lib/session";
import { isToolStepMessage, parseToolStepContent } from "@/lib/session";

/** One file touched by write/edit tools in a session. */
export interface SessionFileChange {
  /** Normalized absolute or project-relative path (merge key). */
  path: string;
  /** Basename for list rows. */
  name: string;
  /** Last edit tool kind (write, search_replace, …). */
  toolKind: string;
  /** Last known tool status (completed, failed, in_progress…). */
  status: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
  /** Last tool call id that touched this path. */
  toolCallId?: string;
  /** Optional before content from tool payload (old_string / previous). */
  before?: string;
  /** Optional after content from tool payload (new_string / contents). */
  after?: string;
  /** Human label from the tool title when useful. */
  title?: string;
}

/** Stable empty list so `?? []` does not bust transcript row memos. */
export const EMPTY_SESSION_FILE_CHANGES: SessionFileChange[] = [];

export type SessionChangeEvent = ToolEventPayload & {
  before?: string | null;
  after?: string | null;
  updatedAt?: string;
  /** Call argument — used when Host omits `path` on write/edit (#998). */
  input?: string | null;
};

/** Normalize path separators and strip trailing slashes (except roots). */
export function normalizePath(path: string): string {
  let p = (path || "").trim().replace(/\\/g, "/");
  if (!p) return "";
  // Collapse // (but keep leading // for UNC? we treat as local paths)
  p = p.replace(/\/{2,}/g, "/");
  // Windows drive: restore "C:/" style after collapse
  if (/^[a-zA-Z]:\//.test(p) === false && /^[a-zA-Z]:/.test(p)) {
    p = p[0]! + ":" + (p.slice(2).startsWith("/") ? p.slice(2) : "/" + p.slice(2));
  }
  // Strip trailing slash except bare "/" or "C:/"
  if (p.length > 1 && p.endsWith("/")) {
    if (!/^[a-zA-Z]:\/$/.test(p)) {
      p = p.replace(/\/+$/, "");
    }
  }
  return p;
}

export function pathBaseName(path: string): string {
  const n = normalizePath(path);
  if (!n) return "";
  const parts = n.split("/").filter(Boolean);
  return parts[parts.length - 1] || n;
}

/**
 * Relative path under project root when possible; otherwise normalized absolute.
 */
export function pathRelativeToProject(
  path: string,
  projectPath: string | null | undefined,
): string {
  const abs = normalizePath(path);
  if (!abs) return "";
  const root = normalizePath(projectPath || "");
  if (!root) return abs;
  if (abs === root) return ".";
  const prefix = root.endsWith("/") ? root : root + "/";
  if (abs.startsWith(prefix)) return abs.slice(prefix.length);
  // Case-insensitive match on macOS-ish roots
  if (abs.toLowerCase().startsWith(prefix.toLowerCase())) {
    return abs.slice(prefix.length);
  }
  return abs;
}

/**
 * Tools that mutate files — aligned with Host `is_edit_tool` + common Grok Build names.
 */
export function isEditToolKind(kind: string | null | undefined): boolean {
  const t = (kind || "").toLowerCase().trim();
  if (!t) return false;
  if (
    t === "search_replace" ||
    t === "write" ||
    t === "edit" ||
    t === "apply_patch" ||
    t === "str_replace" ||
    t === "strreplace" ||
    t === "create_file" ||
    t === "delete_file" ||
    t === "notebook_edit" ||
    t === "editnotebook" ||
    t === "multi_edit" ||
    t === "multiedit"
  ) {
    return true;
  }
  return (
    t.includes("edit") ||
    t.includes("write") ||
    t.includes("replace") ||
    t.includes("patch")
  );
}

/** True when status means the tool finished (success or fail). */
export function isTerminalToolStatus(status: string | null | undefined): boolean {
  const s = (status || "").toLowerCase();
  return (
    s === "completed" ||
    s === "failed" ||
    s === "error" ||
    s === "cancelled" ||
    s === "canceled"
  );
}

/**
 * Merge one write/edit tool event into the session change list (upsert by path).
 * Non-edit tools and empty paths are ignored.
 */
/**
 * Prefer explicit `path`; otherwise promote a single-line file path from
 * `input` (Host write/edit often put the target only on input).
 */
export function resolveSessionChangePath(event: {
  path?: string | null;
  input?: string | null;
}): string {
  const direct = normalizePath(event.path || "");
  if (direct) return direct;
  const candidate = String(event.input || "").trim();
  if (
    !candidate ||
    candidate.includes("\n") ||
    candidate.includes("://") ||
    /\s(-{1,2}[A-Za-z]|&&|\||;)/.test(candidate)
  ) {
    return "";
  }
  const base = candidate.split(/[/\\]/).pop() || "";
  const looksAbs =
    candidate.startsWith("/") ||
    candidate.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(candidate);
  const looksRelFile =
    !candidate.startsWith("-") &&
    (candidate.includes("/") ||
      candidate.includes("\\") ||
      candidate.startsWith(".")) &&
    /\.[\w]{1,12}$/.test(base);
  if (!looksAbs && !looksRelFile) return "";
  if (!/\.[\w]{1,12}$/.test(base) && looksAbs) {
    // Absolute path without extension still counts (dirs / extensionless files).
    return normalizePath(candidate);
  }
  if (!/\.[\w]{1,12}$/.test(base)) return "";
  return normalizePath(candidate);
}

export function mergeSessionChange(
  list: SessionFileChange[],
  event: SessionChangeEvent,
): SessionFileChange[] {
  const kind = (event.kind || "").trim();
  if (!isEditToolKind(kind)) return list;

  const path = resolveSessionChangePath(event);
  if (!path) return list;

  const status = (event.status || "in_progress").toLowerCase() || "in_progress";
  const updatedAt = event.updatedAt || new Date().toISOString();
  const name = pathBaseName(path);
  const before =
    typeof event.before === "string" && event.before.length > 0
      ? event.before
      : undefined;
  const after =
    typeof event.after === "string" && event.after.length > 0
      ? event.after
      : undefined;
  const title = (event.title || "").trim() || undefined;
  const toolCallId = (event.toolCallId || "").trim() || undefined;

  const idx = list.findIndex((c) => normalizePath(c.path) === path);
  if (idx < 0) {
    // Newest first
    return [
      {
        path,
        name,
        toolKind: kind,
        status,
        updatedAt,
        toolCallId,
        before,
        after,
        title,
      },
      ...list,
    ];
  }

  const prev = list[idx]!;
  const next: SessionFileChange = {
    ...prev,
    toolKind: kind || prev.toolKind,
    status: status || prev.status,
    updatedAt,
    toolCallId: toolCallId || prev.toolCallId,
    // Keep prior before if a later event only has after (e.g. write with contents)
    before: before ?? prev.before,
    after: after ?? prev.after,
    title: title || prev.title,
    name: name || prev.name,
  };
  const copy = list.slice();
  copy[idx] = next;
  // Most recently touched first
  copy.splice(idx, 1);
  return [next, ...copy];
}

/** Rebuild change list from persisted / live tool_step messages (chronological). */
export function sessionChangesFromMessages(
  messages: ChatMessage[],
): SessionFileChange[] {
  let list: SessionFileChange[] = [];
  for (const m of messages) {
    // Standalone tool_step rows.
    if (isToolStepMessage(m)) {
      const parsed = m.content?.startsWith("tool_step|")
        ? parseToolStepContent(m.content)
        : null;
      const kind = m.toolKind || parsed?.kind || "";
      if (!isEditToolKind(kind)) continue;
      const path = normalizePath(m.toolPath || parsed?.path || "");
      if (!path) continue;
      list = mergeSessionChange(list, {
        toolCallId: m.toolCallId,
        title: parsed?.title || m.content,
        kind,
        status: m.toolStatus || parsed?.status || "completed",
        path,
        detail: m.toolDetail || parsed?.detail,
        updatedAt: m.createdAt,
      });
      continue;
    }
    // Assistant-woven tool segments (common live path; #998 empty Review).
    if (m.role !== "assistant" || !m.segments?.length) continue;
    for (const seg of m.segments) {
      if (seg.kind !== "tool") continue;
      const kind = seg.toolKind || "";
      if (!isEditToolKind(kind)) continue;
      const path = resolveSessionChangePath({
        path: seg.path,
        input: seg.input,
      });
      if (!path) continue;
      list = mergeSessionChange(list, {
        toolCallId: seg.toolCallId,
        title: seg.title,
        kind,
        status: seg.status || "completed",
        path,
        detail: seg.detail,
        updatedAt: seg.createdAt || m.createdAt,
      });
    }
  }
  return list;
}

/** Aggregate stats for the composer session-changes chip. */
export interface SessionChangesSummary {
  /** Distinct files touched in this session. */
  fileCount: number;
  /**
   * Total added lines across files that have both `before` and `after`.
   * `null` when no file has usable before/after for line stats.
   */
  addedLines: number | null;
  /** Total removed lines (same availability as `addedLines`). */
  removedLines: number | null;
  /**
   * Prefer compact `+a −d` when line stats exist; otherwise file count.
   * Never `"empty"` — callers should hide the chip when `fileCount === 0`.
   */
  mode: "files" | "diff";
}

/**
 * Count added/removed lines between two text snapshots (line-level LCS).
 * Empty strings are valid (new / deleted file).
 */
export function countLineDelta(
  before: string,
  after: string,
): { added: number; removed: number } {
  if (before === after) return { added: 0, removed: 0 };
  const a = splitLines(before);
  const b = splitLines(after);
  let added = 0;
  let removed = 0;
  for (const op of diffLines(a, b)) {
    if (op.type === "add") added++;
    else if (op.type === "delete") removed++;
  }
  return { added, removed };
}

/**
 * Per-file +/− line stats when both before and after snapshots exist.
 * Returns `null` when either side is missing (row shows no line chips).
 */
export function sessionFileLineDelta(
  change: Pick<SessionFileChange, "before" | "after">,
): { added: number; removed: number } | null {
  if (typeof change.before !== "string" || typeof change.after !== "string") {
    return null;
  }
  return countLineDelta(change.before, change.after);
}

/**
 * Summarize session file changes for the composer chip.
 * Returns `null` when there are zero changes (chip should be hidden).
 * Line totals only include files that have both before and after content.
 */
export function summarizeSessionChanges(
  changes: readonly SessionFileChange[],
): SessionChangesSummary | null {
  const fileCount = changes.length;
  if (fileCount <= 0) return null;

  let added = 0;
  let removed = 0;
  let hasLineStats = false;
  for (const c of changes) {
    const d = sessionFileLineDelta(c);
    if (d) {
      added += d.added;
      removed += d.removed;
      hasLineStats = true;
    }
  }

  if (hasLineStats) {
    return {
      fileCount,
      addedLines: added,
      removedLines: removed,
      mode: "diff",
    };
  }
  return {
    fileCount,
    addedLines: null,
    removedLines: null,
    mode: "files",
  };
}

/** Source segment of a Changes-list navigation key (`session:…` / `workspace:…`). */
export type ChangeListSource = "session" | "workspace";

/**
 * Stable key for j/k navigation and selection restore in the Changes list.
 * Format: `session:<normalizedPath>` or `workspace:<normalizedPath>`.
 */
export function changeListKey(
  source: ChangeListSource,
  path: string,
): string {
  return `${source}:${normalizePath(path)}`;
}

export type ChangeListNavDir = "next" | "prev";

/**
 * Resolve next/previous change-list key (same clamp semantics as sidebar j/k).
 * Empty list → null; missing current → first (`next`) / last (`prev`).
 */
export function nextChangeListKey(
  keys: readonly string[],
  current: string | null | undefined,
  dir: ChangeListNavDir,
): string | null {
  if (keys.length === 0) return null;
  const idx =
    current == null || current === "" ? -1 : keys.indexOf(current);
  if (dir === "next") {
    if (idx < 0) return keys[0] ?? null;
    if (idx >= keys.length - 1) return keys[keys.length - 1] ?? null;
    return keys[idx + 1] ?? null;
  }
  if (idx < 0) return keys[keys.length - 1] ?? null;
  if (idx <= 0) return keys[0] ?? null;
  return keys[idx - 1] ?? null;
}

/** Parse a {@link changeListKey} back into source + path (best-effort). */
export function parseChangeListKey(
  key: string,
): { source: ChangeListSource; path: string } | null {
  const raw = (key || "").trim();
  if (raw.startsWith("session:")) {
    const path = normalizePath(raw.slice("session:".length));
    return path ? { source: "session", path } : null;
  }
  if (raw.startsWith("workspace:")) {
    const path = normalizePath(raw.slice("workspace:".length));
    return path ? { source: "workspace", path } : null;
  }
  return null;
}

/**
 * Minimal unified diff (Myers-ish line LCS). Good enough for preview panes;
 * large files should be truncated by the caller before calling.
 */
export function buildUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
  context = 3,
): string {
  const a = splitLines(before);
  const b = splitLines(after);
  const ops = diffLines(a, b);
  const name = filePath || "file";
  const lines: string[] = [`--- a/${name}`, `+++ b/${name}`];

  // Group into hunks with context
  type Row =
    | { t: "eq"; line: string }
    | { t: "del"; line: string }
    | { t: "add"; line: string };
  const rows: Row[] = ops.map((o) => {
    if (o.type === "equal") return { t: "eq", line: o.line };
    if (o.type === "delete") return { t: "del", line: o.line };
    return { t: "add", line: o.line };
  });

  // Mark interesting indices
  const interesting = new Set<number>();
  rows.forEach((r, i) => {
    if (r.t !== "eq") {
      for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) {
        interesting.add(j);
      }
    }
  });

  if (interesting.size === 0) {
    lines.push("@@ empty diff @@");
    return lines.join("\n");
  }

  let i = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < rows.length) {
    if (!interesting.has(i)) {
      const r = rows[i]!;
      if (r.t === "eq") {
        oldLine++;
        newLine++;
      } else if (r.t === "del") {
        oldLine++;
      } else {
        newLine++;
      }
      i++;
      continue;
    }
    // Start hunk — find run of interesting
    const start = i;
    let end = i;
    while (end + 1 < rows.length && interesting.has(end + 1)) end++;
    // Expand to include contiguous interesting block already marked

    // Count lines for hunk header
    let oldStart = oldLine;
    let newStart = newLine;
    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (let k = start; k <= end; k++) {
      const r = rows[k]!;
      if (r.t === "eq") {
        body.push(" " + r.line);
        oldCount++;
        newCount++;
      } else if (r.t === "del") {
        body.push("-" + r.line);
        oldCount++;
      } else {
        body.push("+" + r.line);
        newCount++;
      }
    }
    // Advance line counters through this hunk
    for (let k = start; k <= end; k++) {
      const r = rows[k]!;
      if (r.t === "eq") {
        oldLine++;
        newLine++;
      } else if (r.t === "del") {
        oldLine++;
      } else {
        newLine++;
      }
    }
    lines.push(
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    );
    lines.push(...body);
    i = end + 1;
  }

  return lines.join("\n");
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  // Keep empty last line semantics: trailing \n yields trailing empty string which we drop
  const parts = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

type DiffOp =
  | { type: "equal"; line: string }
  | { type: "delete"; line: string }
  | { type: "add"; line: string };

/** Classic LCS line diff (O(n*m); fine for preview-sized files). */
function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // Cap pathological sizes
  if (n * m > 2_000_000) {
    return naiveReplaceDiff(a, b);
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "equal", line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: "delete", line: a[i]! });
      i++;
    } else {
      out.push({ type: "add", line: b[j]! });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "delete", line: a[i]! });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", line: b[j]! });
    j++;
  }
  return out;
}

function naiveReplaceDiff(a: string[], b: string[]): DiffOp[] {
  const out: DiffOp[] = [];
  for (const line of a) out.push({ type: "delete", line });
  for (const line of b) out.push({ type: "add", line });
  return out;
}
