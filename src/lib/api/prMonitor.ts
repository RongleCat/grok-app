/** API domain: PR monitor (branch-bound PR watches + update events). */

import type { PrMonitorUpdateEvent, PrMonitorWatcherInfo } from "../prMonitor";
import { invoke, isDesktopHost, listen } from "./host";

/** Host event: a watched PR really changed (carries before/after snapshots). */
export const PR_MONITOR_UPDATE_EVENT = "pr-monitor://update";

export interface PrMonitorWatchResultDto {
  ok: boolean;
  watcher?: PrMonitorWatcherInfo | null;
  error?: string | null;
}

export interface PrMonitorUnwatchResultDto {
  ok: boolean;
  removed: boolean;
}

export interface PrMonitorPollResultDto {
  ok: boolean;
  changed: boolean;
  watcher?: PrMonitorWatcherInfo | null;
  error?: string | null;
}


export interface PrMonitorWatchInput {
  projectPath: string;
  branch: string;
  prNumber: number;
  sessionId?: string | null;
  intervalSecs?: number | null;
}

/**
 * Mount a watch for one PR on one branch.
 *
 * Desktop-only: a mirror (phone) client has no host-side poller, so it fails
 * closed instead of pretending to watch.
 */
export async function prMonitorWatch(
  input: PrMonitorWatchInput,
): Promise<PrMonitorWatchResultDto> {
  if (!isDesktopHost()) {
    return { ok: false, watcher: null, error: "desktop host required" };
  }
  return invoke<PrMonitorWatchResultDto>("pr_monitor_watch", {
    projectPath: input.projectPath,
    branch: input.branch,
    prNumber: input.prNumber,
    sessionId: input.sessionId ?? null,
    intervalSecs: input.intervalSecs ?? null,
  });
}

/** Stop watching the PR mounted for this project + branch. */
export async function prMonitorUnwatch(
  projectPath: string,
  branch: string,
): Promise<PrMonitorUnwatchResultDto> {
  if (!isDesktopHost()) return { ok: false, removed: false };
  return invoke<PrMonitorUnwatchResultDto>("pr_monitor_unwatch", {
    projectPath,
    branch,
  });
}

/** Mounted watches (host is the source of truth across UI remounts). */
export async function prMonitorList(): Promise<PrMonitorWatcherInfo[]> {
  if (!isDesktopHost()) return [];
  return invoke<PrMonitorWatcherInfo[]>("pr_monitor_list");
}

/** Poll one watch now (mount seeding / "check now"). */
export async function prMonitorPollNow(
  projectPath: string,
  branch: string,
): Promise<PrMonitorPollResultDto> {
  if (!isDesktopHost()) {
    return { ok: false, changed: false, watcher: null, error: "desktop host required" };
  }
  return invoke<PrMonitorPollResultDto>("pr_monitor_poll_now", {
    projectPath,
    branch,
  });
}

/** Drain the latest change the UI has not consumed yet (missed-event recovery). */
export async function prMonitorConsumePending(
  projectPath: string,
  branch: string,
): Promise<PrMonitorUpdateEvent | null> {
  if (!isDesktopHost()) return null;
  return invoke<PrMonitorUpdateEvent | null>("pr_monitor_consume_pending", {
    projectPath,
    branch,
  });
}

/** Scheduler snapshot (process-lifetime scope, honest about limits). */

/**
 * Subscribe to PR updates. Returns an unlisten function; a no-op when no host
 * backend exists so callers can await it unconditionally.
 */
export async function onPrMonitorUpdate(
  handler: (payload: PrMonitorUpdateEvent) => void,
): Promise<() => void> {
  return listen<PrMonitorUpdateEvent>(PR_MONITOR_UPDATE_EVENT, handler);
}
