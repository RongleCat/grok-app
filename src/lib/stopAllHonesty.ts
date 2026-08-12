/**
 * Stop-all scope honesty (Tasks panel + Agent dashboard).
 *
 * Product truth:
 * - **Stop all** targets **busy App sessions** (stream / permission / connecting)
 *   via Host `sessionStop` — app-wide, not “kill every tool in this chat”.
 * - Composer / Escape Stop is **current session only** (`StopScope: "current"`).
 * - Per-tool kill is not available over ACP (`tasks.noKill`).
 * - Dashboard multi-select uses a different path (stop selected ∩ stoppable).
 *
 * Pure helpers — no I/O. UI translates returned message keys via `t()`.
 */

import { sanitizeSessionIdForLabel } from "./multiWindow";

/** Where the Stop-all control lives (wording differs; action is the same). */
export type StopAllSurface = "tasks" | "dashboard";

/**
 * What Stop all actually stops. Fixed product truth — never “tools in one chat”.
 */
export type StopAllScopeKind = "app_busy_sessions";

/** Plan before confirm / invoke. Empty → soft-fail toast, no dialog. */
export type StopAllPlan =
  | { kind: "empty" }
  | { kind: "ready"; sessionIds: string[]; count: number };

/** Dialog copy keys for confirm (caller interpolates `{n}` on message). */
export type StopAllDialogKeys = {
  titleKey: string;
  messageKey: string;
  confirmKey: string;
};

/** Outcome toast after parallel `sessionStop` attempts. */
export type StopAllResultToast =
  | { kind: "empty"; messageKey: string }
  | { kind: "done"; messageKey: string; vars: { n: string } }
  | {
      kind: "partial";
      messageKey: string;
      vars: { ok: string; fail: string };
    }
  | { kind: "all_failed"; messageKey: string; vars: { fail: string } };

/** Product scope for Stop all (always app busy sessions). */
export function stopAllScopeKind(): StopAllScopeKind {
  return "app_busy_sessions";
}

/**
 * Deduplicate + sanitize busy session ids for Stop all.
 * Empty input → `{ kind: "empty" }` (honest no-op; UI should toast, not invent).
 */
export function planStopAllBusySessions(
  busySessionIds: readonly string[] | null | undefined,
): StopAllPlan {
  const sessionIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of busySessionIds ?? []) {
    const id = sanitizeSessionIdForLabel(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    sessionIds.push(id);
  }
  if (sessionIds.length === 0) return { kind: "empty" };
  return { kind: "ready", sessionIds, count: sessionIds.length };
}

/**
 * Confirm dialog keys per surface.
 *
 * - **tasks** — clarifies app-wide sessions (not tools in this chat).
 * - **dashboard** — clarifies app-wide, not filtered list / selection only.
 */
export function stopAllDialogKeys(surface: StopAllSurface): StopAllDialogKeys {
  if (surface === "dashboard") {
    return {
      titleKey: "dashboard.stopAllTitle",
      messageKey: "dashboard.stopAllConfirm",
      confirmKey: "dashboard.stopAll",
    };
  }
  return {
    titleKey: "tasks.activity.stopAllTitle",
    messageKey: "tasks.activity.stopAllConfirm",
    confirmKey: "tasks.activity.stopAll",
  };
}

/** Button label key (Tasks vs dashboard wording). */
export function stopAllButtonLabelKey(surface: StopAllSurface): string {
  return surface === "dashboard"
    ? "dashboard.stopAll"
    : "tasks.activity.stopAll";
}

/** Tooltip / title key for the Stop-all control. */
export function stopAllButtonTitleKey(surface: StopAllSurface): string {
  return surface === "dashboard"
    ? "dashboard.stopAllTitle"
    : "tasks.activity.stopAllTitle";
}

/**
 * Map stop batch results to a toast payload.
 * Never reports success when nothing was attempted or everything failed.
 */
export function stopAllResultToast(
  ok: number,
  fail: number,
): StopAllResultToast {
  const o = Number.isFinite(ok) ? Math.max(0, Math.floor(ok)) : 0;
  const f = Number.isFinite(fail) ? Math.max(0, Math.floor(fail)) : 0;
  if (o === 0 && f === 0) {
    return { kind: "empty", messageKey: "tasks.activity.stopAllEmpty" };
  }
  if (o > 0 && f === 0) {
    return {
      kind: "done",
      messageKey: "tasks.activity.stopAllDone",
      vars: { n: String(o) },
    };
  }
  if (o === 0 && f > 0) {
    return {
      kind: "all_failed",
      messageKey: "tasks.activity.stopAllAllFailed",
      vars: { fail: String(f) },
    };
  }
  return {
    kind: "partial",
    messageKey: "tasks.activity.stopAllPartial",
    vars: { ok: String(o), fail: String(f) },
  };
}

/**
 * Empty-plan toast when Stop all has no busy targets.
 * Distinct from stop soft-fail on a single session.
 */
export function stopAllEmptyMessageKey(): string {
  return "tasks.activity.stopAllEmpty";
}
