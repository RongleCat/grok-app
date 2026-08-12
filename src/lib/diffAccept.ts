/**
 * Diff accept / reject / restore helpers for the Changes panel.
 * Pure functions: parse unified diffs, apply or reverse hunks, and
 * decide when reject needs untracked wipe confirmation or git checkout.
 */

/** One unified-diff hunk (@@ … @@ body). */
export interface UnifiedHunk {
  /** 1-based old-file start line (0 for pure additions). */
  oldStart: number;
  oldCount: number;
  /** 1-based new-file start line (0 for pure deletions). */
  newStart: number;
  newCount: number;
  /** Body lines including leading ' ', '+', or '-'. */
  lines: string[];
  /** Original header without leading @@ markers trimmed. */
  header: string;
}

export interface ParsedUnifiedDiff {
  /** Best-effort path from --- / +++ headers. */
  filePath: string | null;
  hunks: UnifiedHunk[];
}

export type PatchApplyOk = { ok: true; content: string };
export type PatchApplyErr = { ok: false; error: string };
export type PatchApplyResult = PatchApplyOk | PatchApplyErr;

/** Workspace / session change kinds that matter for reject safety. */
export type DiffAcceptFileKind =
  | "modified"
  | "added"
  | "deleted"
  | "untracked"
  | "renamed"
  | "copied"
  | "typechange"
  | "conflict"
  | "ignored"
  | "unknown";

/** True when rejecting would delete an untracked (or pure-added) file. */
export function needsUntrackedWipeConfirm(
  kind: string | null | undefined,
): boolean {
  const k = (kind || "").toLowerCase().trim();
  return k === "untracked" || k === "added";
}

/**
 * Prefer `git checkout` / restore for reject when the project is a git repo
 * and the file is not an untracked wipe that still needs explicit confirm.
 * Callers still pass `confirmUntracked` into the host for untracked paths.
 */
export function preferGitCheckoutReject(
  hasGitRepo: boolean,
  kind?: string | null,
): boolean {
  if (!hasGitRepo) return false;
  const k = (kind || "").toLowerCase().trim();
  // Conflicts: soft-fail at host; still allow attempt
  if (k === "ignored") return false;
  return true;
}

/** Whether we have enough content to restore agent "after" state. */
export function canRestoreAfter(
  after: string | null | undefined,
): after is string {
  return typeof after === "string";
}

/** Whether we can write a full-file accept (keep after content). */
export function canAcceptWithContent(
  after: string | null | undefined,
): after is string {
  return typeof after === "string";
}

/** Whether we can reject by rewriting before content (no git). */
export function canRejectWithBefore(
  before: string | null | undefined,
): before is string {
  return typeof before === "string";
}

/**
 * Normalize line endings and split into lines without a trailing empty
 * element from a final newline (same semantics as sessionChanges).
 */
export function splitPatchLines(text: string): string[] {
  if (text === "") return [];
  const parts = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function joinPatchLines(lines: string[]): string {
  if (lines.length === 0) return "";
  return lines.join("\n") + "\n";
}

const HUNK_HEADER_RE =
  /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s@@/;

/**
 * Parse a unified diff into hunks. Ignores file headers and binary markers.
 * Returns empty hunks when nothing parseable is found (caller soft-fails).
 */
export function parseUnifiedDiff(diff: string): ParsedUnifiedDiff {
  const raw = (diff || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n");
  let filePath: string | null = null;
  const hunks: UnifiedHunk[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const rest = line.slice(4).trim();
      // Prefer +++ b/path
      if (line.startsWith("+++ ") && rest && rest !== "/dev/null") {
        filePath = rest.replace(/^[ab]\//, "");
      } else if (
        !filePath &&
        line.startsWith("--- ") &&
        rest &&
        rest !== "/dev/null"
      ) {
        filePath = rest.replace(/^[ab]\//, "");
      }
      i++;
      continue;
    }

    const m = line.match(HUNK_HEADER_RE);
    if (!m) {
      i++;
      continue;
    }

    const oldStart = Number(m[1]);
    const oldCount = m[2] != null ? Number(m[2]) : 1;
    const newStart = Number(m[3]);
    const newCount = m[4] != null ? Number(m[4]) : 1;
    const header = line;
    i++;
    const body: string[] = [];
    while (i < lines.length) {
      const b = lines[i] ?? "";
      if (b.startsWith("@@")) break;
      if (b.startsWith("diff ") || b.startsWith("--- ") || b.startsWith("+++ ")) {
        break;
      }
      // Body: ' ', '+', '-', or '\' (No newline at end of file).
      // Do not treat bare empty strings (EOF split residue) as context — that
      // injects a phantom equal line and breaks apply.
      if (
        b.startsWith(" ") ||
        b.startsWith("+") ||
        b.startsWith("-") ||
        b.startsWith("\\")
      ) {
        body.push(b);
        i++;
        continue;
      }
      break;
    }
    hunks.push({
      oldStart,
      oldCount,
      newStart,
      newCount,
      lines: body,
      header,
    });
  }

  return { filePath, hunks };
}

function hunkOldLines(hunk: UnifiedHunk): string[] {
  const out: string[] = [];
  for (const l of hunk.lines) {
    if (l.startsWith("\\")) continue;
    if (l.startsWith("-") || l.startsWith(" ")) {
      out.push(l.slice(1));
    }
  }
  return out;
}

function hunkNewLines(hunk: UnifiedHunk): string[] {
  const out: string[] = [];
  for (const l of hunk.lines) {
    if (l.startsWith("\\")) continue;
    if (l.startsWith("+") || l.startsWith(" ")) {
      out.push(l.slice(1));
    }
  }
  return out;
}

/**
 * Apply ordered hunks to the original text (forward patch).
 * Hunks must match the original at their oldStart positions.
 */
export function applyHunks(
  original: string,
  hunks: readonly UnifiedHunk[],
): PatchApplyResult {
  if (!hunks.length) {
    return { ok: true, content: original };
  }
  const src = splitPatchLines(original);
  // Work on a mutable list; apply from bottom so line numbers stay valid
  const ordered = hunks.slice().sort((a, b) => b.oldStart - a.oldStart);
  let lines = src.slice();

  for (const hunk of ordered) {
    const oldLines = hunkOldLines(hunk);
    const newLines = hunkNewLines(hunk);

    if (hunk.oldCount === 0 || oldLines.length === 0) {
      // Pure insertion. oldStart 0 or 1 both mean "at beginning" for empty files;
      // otherwise insert before 1-based line oldStart+1 (i.e. index oldStart).
      const insertAt =
        lines.length === 0
          ? 0
          : Math.min(lines.length, Math.max(0, hunk.oldStart));
      lines = [
        ...lines.slice(0, insertAt),
        ...newLines,
        ...lines.slice(insertAt),
      ];
      continue;
    }

    // oldStart is 1-based
    const start = Math.max(0, hunk.oldStart - 1);

    if (start + oldLines.length > lines.length) {
      return {
        ok: false,
        error: `hunk apply failed: old range past EOF (${hunk.header})`,
      };
    }
    for (let i = 0; i < oldLines.length; i++) {
      if (lines[start + i] !== oldLines[i]) {
        return {
          ok: false,
          error: `hunk apply failed: context mismatch at line ${start + i + 1}`,
        };
      }
    }
    lines = [
      ...lines.slice(0, start),
      ...newLines,
      ...lines.slice(start + oldLines.length),
    ];
  }

  // Preserve "no trailing newline" only when original had none and result empty?
  // Always end text files with newline when non-empty (same as joinPatchLines).
  return { ok: true, content: joinPatchLines(lines) };
}

/**
 * Reverse-apply hunks (undo a forward patch on content that already has it).
 * Useful for rejecting selected hunks without git.
 */
export function reverseHunks(
  current: string,
  hunks: readonly UnifiedHunk[],
): PatchApplyResult {
  // Reverse of a hunk: swap +/- and use newStart as the match position
  const reversed: UnifiedHunk[] = hunks.map((h) => {
    const lines = h.lines.map((l) => {
      if (l.startsWith("+")) return "-" + l.slice(1);
      if (l.startsWith("-")) return "+" + l.slice(1);
      return l;
    });
    return {
      oldStart: h.newStart,
      oldCount: h.newCount,
      newStart: h.oldStart,
      newCount: h.oldCount,
      lines,
      header: h.header + " (reverse)",
    };
  });
  return applyHunks(current, reversed);
}

/** Apply full unified patch text to original file content. */
export function applyUnifiedPatch(
  original: string,
  patch: string,
): PatchApplyResult {
  const parsed = parseUnifiedDiff(patch);
  if (parsed.hunks.length === 0) {
    // Empty / unparseable patch: treat as no-op only when patch is blank
    if (!(patch || "").trim()) {
      return { ok: true, content: original };
    }
    return { ok: false, error: "no hunks in unified patch" };
  }
  return applyHunks(original, parsed.hunks);
}

/**
 * Accept only selected hunks (by index into `hunks`). Other hunks stay
 * unapplied — result is original with selected forward hunks applied.
 */
export function applySelectedHunks(
  original: string,
  hunks: readonly UnifiedHunk[],
  selectedIndices: readonly number[],
): PatchApplyResult {
  const set = new Set(selectedIndices);
  const picked = hunks.filter((_, i) => set.has(i));
  if (picked.length === 0) {
    return { ok: true, content: original };
  }
  return applyHunks(original, picked);
}

/**
 * Reject selected hunks from content that already includes the full patch.
 * Keeps unselected hunks applied.
 */
export function rejectSelectedHunks(
  currentWithAll: string,
  hunks: readonly UnifiedHunk[],
  rejectIndices: readonly number[],
): PatchApplyResult {
  const set = new Set(rejectIndices);
  const picked = hunks.filter((_, i) => set.has(i));
  if (picked.length === 0) {
    return { ok: true, content: currentWithAll };
  }
  return reverseHunks(currentWithAll, picked);
}

/**
 * Decide the host action for a full-file reject.
 * - git: use git_checkout_file (confirmUntracked when wipe needed)
 * - write_before: rewrite before snapshot via apply_file_patch
 * - delete: remove untracked without git (still needs confirm)
 * - unavailable: soft-fail
 */
export type RejectPlan =
  | { mode: "git"; confirmUntracked: boolean }
  | { mode: "write_before"; content: string }
  | { mode: "delete"; confirmUntracked: true }
  | { mode: "unavailable"; reason: string };

export function planFileReject(opts: {
  hasGitRepo: boolean;
  kind?: string | null;
  before?: string | null;
  /** File exists on disk (false → nothing to wipe). */
  fileExists?: boolean;
}): RejectPlan {
  const kind = (opts.kind || "").toLowerCase().trim();
  const untrackedWipe = needsUntrackedWipeConfirm(kind);

  if (opts.hasGitRepo) {
    return {
      mode: "git",
      confirmUntracked: untrackedWipe,
    };
  }

  if (untrackedWipe) {
    if (opts.fileExists === false) {
      return { mode: "unavailable", reason: "file already absent" };
    }
    return { mode: "delete", confirmUntracked: true };
  }

  if (canRejectWithBefore(opts.before)) {
    return { mode: "write_before", content: opts.before };
  }

  return {
    mode: "unavailable",
    reason: "no git repo and no before snapshot",
  };
}

/**
 * Decide the host action for a full-file accept / restore.
 * Accept and restore both write the "after" content when available.
 */
export type AcceptPlan =
  | { mode: "write_after"; content: string }
  | { mode: "keep_current" }
  | { mode: "unavailable"; reason: string };

export function planFileAccept(opts: {
  after?: string | null;
  /** When true, disk already matches intent — no write needed. */
  alreadyApplied?: boolean;
}): AcceptPlan {
  if (opts.alreadyApplied) {
    return { mode: "keep_current" };
  }
  if (canAcceptWithContent(opts.after)) {
    return { mode: "write_after", content: opts.after };
  }
  // No snapshot: accepting means keep working tree as-is
  return { mode: "keep_current" };
}

export function planFileRestore(opts: {
  after?: string | null;
}): AcceptPlan {
  if (canRestoreAfter(opts.after)) {
    return { mode: "write_after", content: opts.after };
  }
  return { mode: "unavailable", reason: "no after snapshot to restore" };
}

// ─── Batch accept / reject (session or file scope) ─────────────────────────

export type BatchDiffAction = "accept" | "reject";
export type BatchDiffScope = "session" | "file" | "hunks";

export type BatchFileSkipReason =
  | "already_decided"
  | "conflict"
  | "unavailable"
  | "empty_path"
  | "no_remaining";

/** One file considered by a batch plan (pure; no I/O). */
export type BatchFileInput = {
  path: string;
  name?: string;
  kind?: string | null;
  after?: string | null;
  before?: string | null;
  /** Prior accept/reject badge for this path in the Changes UI. */
  decision?: "accepted" | "rejected" | null;
  /** Disk presence; false → skip untracked wipe. Default assumed true. */
  fileExists?: boolean;
};

export type BatchFileRunAction =
  | { action: "accept"; plan: AcceptPlan }
  | { action: "reject"; plan: RejectPlan; needsUntrackedConfirm: boolean };

export type BatchFilePlanEntry = {
  path: string;
  name: string;
  kind: string | null;
  outcome:
    | { kind: "run"; run: BatchFileRunAction }
    | { kind: "skip"; reason: BatchFileSkipReason; detail?: string };
};

export type BatchDiffPlan = {
  action: BatchDiffAction;
  scope: BatchDiffScope;
  entries: BatchFilePlanEntry[];
  /** Files the host should process (includes those needing untracked confirm). */
  run: BatchFilePlanEntry[];
  skipped: BatchFilePlanEntry[];
  /** Subset of `run` that still need wipe confirm before delete/checkout. */
  needsUntrackedConfirm: BatchFilePlanEntry[];
  runCount: number;
  skipCount: number;
  untrackedConfirmCount: number;
  canRun: boolean;
};

export type BatchResultStatus = "ok" | "soft_fail" | "skipped" | "error";

export type BatchDiffResultItem = {
  path: string;
  name: string;
  status: BatchResultStatus;
  reason?: string;
};

export type BatchDiffSummary = {
  action: BatchDiffAction;
  ok: number;
  softFail: number;
  skipped: number;
  error: number;
  total: number;
  items: BatchDiffResultItem[];
};

/** True when kind is a merge conflict — batch skips these (soft). */
export function isConflictKind(kind?: string | null): boolean {
  return (kind || "").toLowerCase().trim() === "conflict";
}

/** Skip when the UI already recorded the same decision for this path. */
export function isAlreadyDecided(
  decision: "accepted" | "rejected" | null | undefined,
  action: BatchDiffAction,
): boolean {
  if (!decision) return false;
  return (
    (action === "accept" && decision === "accepted") ||
    (action === "reject" && decision === "rejected")
  );
}

function entryName(item: BatchFileInput): string {
  const n = (item.name || "").trim();
  if (n) return n;
  const p = (item.path || "").replace(/\\/g, "/");
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] || p || "?";
}

/**
 * Indices of hunks not yet resolved (for file-scoped “accept/reject all remaining”).
 * When `resolvedIndices` is empty, every hunk is remaining.
 */
export function remainingHunkIndices(
  totalHunks: number,
  resolvedIndices: readonly number[] = [],
): number[] {
  const n = Math.max(0, Math.floor(totalHunks));
  if (n === 0) return [];
  const done = new Set(
    resolvedIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < n),
  );
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!done.has(i)) out.push(i);
  }
  return out;
}

function skipEntry(
  item: BatchFileInput,
  reason: BatchFileSkipReason,
  detail?: string,
): BatchFilePlanEntry {
  return {
    path: item.path || "",
    name: entryName(item),
    kind: item.kind ?? null,
    outcome: { kind: "skip", reason, detail },
  };
}

/** Plan one file for batch accept (skip conflict / already accepted). */
export function planBatchFileAccept(item: BatchFileInput): BatchFilePlanEntry {
  const path = (item.path || "").trim();
  if (!path) return skipEntry(item, "empty_path");
  if (isConflictKind(item.kind)) {
    return skipEntry(item, "conflict", "merge conflict");
  }
  if (isAlreadyDecided(item.decision, "accept")) {
    return skipEntry(item, "already_decided");
  }
  const plan = planFileAccept({ after: item.after });
  if (plan.mode === "unavailable") {
    return skipEntry(item, "unavailable", plan.reason);
  }
  return {
    path,
    name: entryName(item),
    kind: item.kind ?? null,
    outcome: {
      kind: "run",
      run: { action: "accept", plan },
    },
  };
}

/** Plan one file for batch reject (skip conflict / already rejected; flag wipe). */
export function planBatchFileReject(
  item: BatchFileInput,
  opts?: { hasGitRepo?: boolean },
): BatchFilePlanEntry {
  const path = (item.path || "").trim();
  if (!path) return skipEntry(item, "empty_path");
  if (isConflictKind(item.kind)) {
    return skipEntry(item, "conflict", "merge conflict");
  }
  if (isAlreadyDecided(item.decision, "reject")) {
    return skipEntry(item, "already_decided");
  }
  const plan = planFileReject({
    hasGitRepo: !!opts?.hasGitRepo,
    kind: item.kind,
    before: item.before,
    fileExists: item.fileExists,
  });
  if (plan.mode === "unavailable") {
    return skipEntry(item, "unavailable", plan.reason);
  }
  const needsUntrackedConfirm =
    (plan.mode === "git" && plan.confirmUntracked) ||
    (plan.mode === "delete" && plan.confirmUntracked) ||
    needsUntrackedWipeConfirm(item.kind);
  return {
    path,
    name: entryName(item),
    kind: item.kind ?? null,
    outcome: {
      kind: "run",
      run: { action: "reject", plan, needsUntrackedConfirm },
    },
  };
}

function assembleBatchPlan(
  action: BatchDiffAction,
  scope: BatchDiffScope,
  entries: BatchFilePlanEntry[],
): BatchDiffPlan {
  const run = entries.filter((e) => e.outcome.kind === "run");
  const skipped = entries.filter((e) => e.outcome.kind === "skip");
  const needsUntrackedConfirm = run.filter(
    (e) =>
      e.outcome.kind === "run" &&
      e.outcome.run.action === "reject" &&
      e.outcome.run.needsUntrackedConfirm,
  );
  return {
    action,
    scope,
    entries,
    run,
    skipped,
    needsUntrackedConfirm,
    runCount: run.length,
    skipCount: skipped.length,
    untrackedConfirmCount: needsUntrackedConfirm.length,
    canRun: run.length > 0,
  };
}

/** Build a session- or file-scoped batch accept plan. */
export function planBatchAccept(
  files: readonly BatchFileInput[],
  opts?: { scope?: BatchDiffScope },
): BatchDiffPlan {
  const entries = files.map((f) => planBatchFileAccept(f));
  return assembleBatchPlan("accept", opts?.scope ?? "session", entries);
}

/** Build a session- or file-scoped batch reject plan. */
export function planBatchReject(
  files: readonly BatchFileInput[],
  opts?: { hasGitRepo?: boolean; scope?: BatchDiffScope },
): BatchDiffPlan {
  const entries = files.map((f) =>
    planBatchFileReject(f, { hasGitRepo: opts?.hasGitRepo }),
  );
  return assembleBatchPlan("reject", opts?.scope ?? "session", entries);
}

/**
 * File-scoped remaining-hunks plan. When no indices remain, returns canRun false.
 * Accept = apply selected hunks onto before; reject = reverse them from after.
 */
export type BatchHunksPlan =
  | {
      ok: true;
      action: BatchDiffAction;
      indices: number[];
      /** Content to write when apply succeeds. */
      content: string;
    }
  | {
      ok: false;
      reason: BatchFileSkipReason | "apply_failed";
      detail?: string;
    };

export function planBatchRemainingHunks(opts: {
  action: BatchDiffAction;
  hunks: readonly UnifiedHunk[];
  /** Already resolved hunk indices (empty → all remaining). */
  resolvedIndices?: readonly number[];
  before?: string | null;
  after?: string | null;
}): BatchHunksPlan {
  const indices = remainingHunkIndices(
    opts.hunks.length,
    opts.resolvedIndices ?? [],
  );
  if (indices.length === 0) {
    return { ok: false, reason: "no_remaining" };
  }
  if (opts.action === "accept") {
    if (typeof opts.before !== "string") {
      return {
        ok: false,
        reason: "unavailable",
        detail: "hunk accept needs before snapshot",
      };
    }
    const r = applySelectedHunks(opts.before, opts.hunks, indices);
    if (!r.ok) {
      return { ok: false, reason: "apply_failed", detail: r.error };
    }
    return { ok: true, action: "accept", indices, content: r.content };
  }
  if (typeof opts.after !== "string") {
    return {
      ok: false,
      reason: "unavailable",
      detail: "hunk reject needs after snapshot",
    };
  }
  const r = rejectSelectedHunks(opts.after, opts.hunks, indices);
  if (!r.ok) {
    return { ok: false, reason: "apply_failed", detail: r.error };
  }
  return { ok: true, action: "reject", indices, content: r.content };
}

/** Aggregate host results into a soft-fail summary. */
export function summarizeBatchResults(
  action: BatchDiffAction,
  items: readonly BatchDiffResultItem[],
): BatchDiffSummary {
  let ok = 0;
  let softFail = 0;
  let skipped = 0;
  let error = 0;
  for (const it of items) {
    if (it.status === "ok") ok++;
    else if (it.status === "soft_fail") softFail++;
    else if (it.status === "skipped") skipped++;
    else error++;
  }
  return {
    action,
    ok,
    softFail,
    skipped,
    error,
    total: items.length,
    items: items.slice(),
  };
}

/** Vars for i18n summary strings: ok / fail / skipped / total. */
export function batchSummaryVars(summary: BatchDiffSummary): {
  ok: string;
  fail: string;
  skipped: string;
  total: string;
} {
  return {
    ok: String(summary.ok),
    fail: String(summary.softFail + summary.error),
    skipped: String(summary.skipped),
    total: String(summary.total),
  };
}

// ─── Action gates (honest disabled reasons) ────────────────────────────────

/**
 * Stable reasons a Changes accept/reject/restore/hunk control is disabled.
 * UI maps via {@link diffActionDisabledMessageKey}; null reason → enabled.
 */
export type DiffActionDisabledReason =
  | "need_project"
  | "need_tauri"
  | "busy"
  | "no_after_snapshot"
  | "no_before_snapshot"
  | "no_reject_path"
  | "conflict"
  | "already_accepted"
  | "already_rejected"
  | "no_remaining"
  | "no_hunks";

export type DiffActionGate = {
  disabled: boolean;
  /** Present only when disabled. */
  reason: DiffActionDisabledReason | null;
};

export type DiffFileActionGates = {
  accept: DiffActionGate;
  reject: DiffActionGate;
  restore: DiffActionGate;
};

export type DiffHunkActionGates = {
  accept: DiffActionGate;
  reject: DiffActionGate;
  acceptAll: DiffActionGate;
  rejectAll: DiffActionGate;
};

function enabledGate(): DiffActionGate {
  return { disabled: false, reason: null };
}

function disabledGate(reason: DiffActionDisabledReason): DiffActionGate {
  return { disabled: true, reason };
}

/**
 * File-level accept / reject / restore availability.
 *
 * - Accept stays enabled when `after` is missing (keep working tree / mark accepted).
 * - Restore requires a session (or remembered) after snapshot.
 * - Reject needs git checkout path, delete plan, or a before snapshot.
 */
export function planFileActionGates(opts: {
  hasProject: boolean;
  isTauri: boolean;
  busy?: boolean;
  hasGitRepo?: boolean;
  kind?: string | null;
  after?: string | null;
  before?: string | null;
  decision?: "accepted" | "rejected" | null;
  fileExists?: boolean;
}): DiffFileActionGates {
  if (!opts.hasProject) {
    const g = disabledGate("need_project");
    return { accept: g, reject: g, restore: g };
  }
  if (!opts.isTauri) {
    const g = disabledGate("need_tauri");
    return { accept: g, reject: g, restore: g };
  }
  if (opts.busy) {
    const g = disabledGate("busy");
    return { accept: g, reject: g, restore: g };
  }

  let accept = enabledGate();
  let reject = enabledGate();
  let restore = enabledGate();

  if (isConflictKind(opts.kind)) {
    accept = disabledGate("conflict");
    reject = disabledGate("conflict");
  } else if (opts.decision === "accepted") {
    accept = disabledGate("already_accepted");
  }

  if (opts.decision === "rejected" && !isConflictKind(opts.kind)) {
    reject = disabledGate("already_rejected");
  }

  if (!isConflictKind(opts.kind) && reject.reason == null) {
    const plan = planFileReject({
      hasGitRepo: !!opts.hasGitRepo,
      kind: opts.kind,
      before: opts.before,
      fileExists: opts.fileExists,
    });
    if (plan.mode === "unavailable") {
      reject = disabledGate("no_reject_path");
    }
  }

  if (!canRestoreAfter(opts.after)) {
    restore = disabledGate("no_after_snapshot");
  }

  return { accept, reject, restore };
}

/**
 * Hunk-level gates. Accept needs before + hunks; reject needs after + hunks.
 * Batch “all remaining” additionally needs remaining count > 0.
 */
export function planHunkActionGates(opts: {
  hasProject: boolean;
  isTauri: boolean;
  busy?: boolean;
  hunkCount: number;
  remainingCount?: number;
  before?: string | null;
  after?: string | null;
}): DiffHunkActionGates {
  if (!opts.hasProject) {
    const g = disabledGate("need_project");
    return { accept: g, reject: g, acceptAll: g, rejectAll: g };
  }
  if (!opts.isTauri) {
    const g = disabledGate("need_tauri");
    return { accept: g, reject: g, acceptAll: g, rejectAll: g };
  }
  if (opts.busy) {
    const g = disabledGate("busy");
    return { accept: g, reject: g, acceptAll: g, rejectAll: g };
  }

  const n = Math.max(0, Math.floor(opts.hunkCount));
  if (n === 0) {
    const g = disabledGate("no_hunks");
    return { accept: g, reject: g, acceptAll: g, rejectAll: g };
  }

  const remaining =
    opts.remainingCount != null
      ? Math.max(0, Math.floor(opts.remainingCount))
      : n;

  let accept = enabledGate();
  let reject = enabledGate();
  if (!canRejectWithBefore(opts.before)) {
    accept = disabledGate("no_before_snapshot");
  }
  if (!canRestoreAfter(opts.after)) {
    reject = disabledGate("no_after_snapshot");
  }

  let acceptAll = accept.disabled
    ? accept
    : remaining === 0
      ? disabledGate("no_remaining")
      : enabledGate();
  let rejectAll = reject.disabled
    ? reject
    : remaining === 0
      ? disabledGate("no_remaining")
      : enabledGate();

  return { accept, reject, acceptAll, rejectAll };
}

/** i18n key for a disabled-reason gate (stable; add strings in workspace.ts). */
export function diffActionDisabledMessageKey(
  reason: DiffActionDisabledReason,
): string {
  switch (reason) {
    case "need_project":
      return "changes.needProject";
    case "need_tauri":
      return "changes.needTauri";
    case "busy":
      return "changes.actionBusy";
    case "no_after_snapshot":
      return "changes.disabled.noAfterSnapshot";
    case "no_before_snapshot":
      return "changes.disabled.noBeforeSnapshot";
    case "no_reject_path":
      return "changes.disabled.noRejectPath";
    case "conflict":
      return "changes.disabled.conflict";
    case "already_accepted":
      return "changes.disabled.alreadyAccepted";
    case "already_rejected":
      return "changes.disabled.alreadyRejected";
    case "no_remaining":
      return "changes.batchNothingRemaining";
    case "no_hunks":
      return "changes.disabled.noHunks";
  }
}

/** Tip label: disabled reason when gated, otherwise the normal tip key. */
export function diffActionTip(
  gate: DiffActionGate,
  enabledTipKey: string,
): { messageKey: string; disabled: boolean } {
  if (gate.disabled && gate.reason) {
    return {
      messageKey: diffActionDisabledMessageKey(gate.reason),
      disabled: true,
    };
  }
  return { messageKey: enabledTipKey, disabled: false };
}

// ─── Git checkout soft-fail classification ─────────────────────────────────

/**
 * Host `git_checkout_file` / `delete_project_file` failure kinds.
 * Soft kinds may fall back to writing the before snapshot when present.
 */
export type GitCheckoutFailKind =
  | "needs_untracked_confirm"
  | "not_a_git_repo"
  | "git_not_available"
  | "path_denied"
  | "path_not_found"
  | "untracked_dir"
  | "checkout_failed"
  | "delete_failed"
  | "other";

function checkoutReasonText(reason: string | null | undefined): string {
  return (reason || "").trim().toLowerCase();
}

/**
 * Classify a Host checkout/delete result. Returns null when `ok` and no
 * untracked confirm is required. Never invents success.
 */
export function classifyGitCheckoutFailure(res: {
  ok?: boolean;
  needsUntrackedConfirm?: boolean;
  reason?: string | null;
  action?: string | null;
}): GitCheckoutFailKind | null {
  if (res.needsUntrackedConfirm) return "needs_untracked_confirm";
  if (res.ok) return null;

  const r = checkoutReasonText(res.reason);
  if (!r) return "other";

  if (
    r.includes("untracked file requires confirm") ||
    r.includes("requires confirm")
  ) {
    return "needs_untracked_confirm";
  }
  if (r.includes("not a git") || r.includes("not a git repository")) {
    return "not_a_git_repo";
  }
  if (
    r.includes("git not available") ||
    r === "git not available" ||
    r.includes("git binary") ||
    r.includes("no git")
  ) {
    return "git_not_available";
  }
  if (
    r.includes("path not allowed") ||
    r.includes("outside project") ||
    r.includes("escapes project") ||
    r.includes("not under project")
  ) {
    return "path_denied";
  }
  if (
    r.includes("path not found") ||
    r.includes("no such file") ||
    r.includes("empty path") ||
    r.includes("file already absent")
  ) {
    return "path_not_found";
  }
  if (
    r.includes("refusing to delete untracked directory") ||
    r.includes("untracked directory")
  ) {
    return "untracked_dir";
  }
  if (r.includes("delete untracked") || r.startsWith("delete ")) {
    return "delete_failed";
  }
  if (
    r.includes("git checkout") ||
    r.includes("checkout failed") ||
    r.includes("git restore") ||
    r.includes("did not match") ||
    r.includes("pathspec")
  ) {
    return "checkout_failed";
  }
  return "other";
}

/** Soft kinds where writing the before snapshot is a safe fallback. */
export function canFallbackToBeforeWrite(
  kind: GitCheckoutFailKind | null,
): boolean {
  return kind === "not_a_git_repo" || kind === "git_not_available";
}

/** i18n key for a classified checkout failure (detail still in `{reason}` when needed). */
export function gitCheckoutFailMessageKey(kind: GitCheckoutFailKind): string {
  switch (kind) {
    case "needs_untracked_confirm":
      return "changes.gitFail.needsUntrackedConfirm";
    case "not_a_git_repo":
      return "changes.gitFail.notAGitRepo";
    case "git_not_available":
      return "changes.gitFail.gitNotAvailable";
    case "path_denied":
      return "changes.gitFail.pathDenied";
    case "path_not_found":
      return "changes.gitFail.pathNotFound";
    case "untracked_dir":
      return "changes.gitFail.untrackedDir";
    case "checkout_failed":
      return "changes.gitFail.checkoutFailed";
    case "delete_failed":
      return "changes.gitFail.deleteFailed";
    case "other":
      return "changes.gitFail.other";
  }
}

/**
 * Human-facing reason string for reject soft-fail: prefer classified copy
 * via message key; callers that only have `tr` resolve the key.
 * When kind is `other` / checkout_failed, include host detail.
 */
export function formatGitCheckoutFailReason(
  kind: GitCheckoutFailKind,
  hostReason: string | null | undefined,
  tr: (key: string, vars?: Record<string, string>) => string,
): string {
  const key = gitCheckoutFailMessageKey(kind);
  const detail = (hostReason || "").trim();
  if (
    kind === "other" ||
    kind === "checkout_failed" ||
    kind === "delete_failed"
  ) {
    return tr(key, { reason: detail || kind });
  }
  return tr(key, { reason: detail });
}

// ─── Batch plan honesty ────────────────────────────────────────────────────

/** i18n key for a batch skip reason (tooltips / summary detail). */
export function batchSkipReasonMessageKey(reason: BatchFileSkipReason): string {
  switch (reason) {
    case "already_decided":
      return "changes.batchSkip.alreadyDecided";
    case "conflict":
      return "changes.disabled.conflict";
    case "unavailable":
      return "changes.batchSkip.unavailable";
    case "empty_path":
      return "changes.batchSkip.emptyPath";
    case "no_remaining":
      return "changes.batchNothingRemaining";
  }
}

/**
 * Pre-run honesty for a batch plan: whether confirm is required and why
 * empty / partial. Never claims full success when only a subset can run.
 */
export type BatchPlanHonesty = {
  canRun: boolean;
  runCount: number;
  skipCount: number;
  untrackedConfirmCount: number;
  /** When true, open GlassModal before reject (never window.confirm). */
  needsUntrackedConfirm: boolean;
  /** Partial: some files run, some skip. */
  partial: boolean;
  /** When !canRun, stable empty reason key. */
  emptyReasonKey: string | null;
  /** Short status key when canRun (optional chip). */
  readyKey: string | null;
};

export function describeBatchPlanHonesty(plan: BatchDiffPlan): BatchPlanHonesty {
  const partial = plan.runCount > 0 && plan.skipCount > 0;
  if (!plan.canRun) {
    return {
      canRun: false,
      runCount: 0,
      skipCount: plan.skipCount,
      untrackedConfirmCount: 0,
      needsUntrackedConfirm: false,
      partial: false,
      emptyReasonKey: "changes.batchNothingRemaining",
      readyKey: null,
    };
  }
  return {
    canRun: true,
    runCount: plan.runCount,
    skipCount: plan.skipCount,
    untrackedConfirmCount: plan.untrackedConfirmCount,
    needsUntrackedConfirm: plan.untrackedConfirmCount > 0,
    partial,
    emptyReasonKey: null,
    readyKey: partial
      ? "changes.batchPartialReady"
      : "changes.batchAllReady",
  };
}

/**
 * Map a reject Host result into a batch item status using classified kinds.
 * Untracked confirm → skipped (caller should have confirmed already).
 */
export function batchItemFromCheckoutFailure(
  path: string,
  name: string,
  res: {
    ok?: boolean;
    needsUntrackedConfirm?: boolean;
    reason?: string | null;
  },
): BatchDiffResultItem {
  const kind = classifyGitCheckoutFailure(res);
  if (kind == null) {
    return { path, name, status: "ok" };
  }
  if (kind === "needs_untracked_confirm") {
    return {
      path,
      name,
      status: "skipped",
      reason: "needs untracked confirm",
    };
  }
  if (canFallbackToBeforeWrite(kind)) {
    // Caller may still try before-write; mark soft_fail only if they do not.
    return {
      path,
      name,
      status: "soft_fail",
      reason: kind,
    };
  }
  return {
    path,
    name,
    status: "soft_fail",
    reason: res.reason || kind,
  };
}
