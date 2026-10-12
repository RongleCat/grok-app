/** API domain: PR monitor (a session's PR watches and the host's wakes). */

import type { PrMonitorStateEvent, PrMonitorWakeEvent } from "../prMonitor";
import { invoke, isDesktopHost, listen } from "./host";

/** The host pushes a session's watch rows after any change to them. */
export const PR_MONITOR_STATE_EVENT = "pr-monitor://state";
/** The host pushes one wake's outcome (queued / delivered / settled / failed). */
export const PR_MONITOR_WAKE_EVENT = "pr-monitor://wake";

export interface PrMonitorWatchResultDto {
  ok: boolean;
  error?: string | null;
}

export interface PrMonitorUnwatchResultDto {
  ok: boolean;
  removed: boolean;
}

export interface PrMonitorWatchInput {
  sessionId: string;
  projectPath: string;
  prNumber: number;
  intervalSecs?: number | null;
}

/**
 * Mount a watch for one PR of this session's project.
 *
 * Desktop-only: a mirror (phone) client has no host-side poller, so it fails
 * closed instead of pretending to watch.
 */
export async function prMonitorWatch(
  input: PrMonitorWatchInput,
): Promise<PrMonitorWatchResultDto> {
  if (!isDesktopHost()) {
    return { ok: false, error: "desktop host required" };
  }
  return invoke<PrMonitorWatchResultDto>("pr_monitor_watch", {
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    prNumber: input.prNumber,
    intervalSecs: input.intervalSecs ?? null,
  });
}

/** Stop watching one PR. */
export async function prMonitorUnwatch(
  sessionId: string,
  prNumber: number,
): Promise<PrMonitorUnwatchResultDto> {
  if (!isDesktopHost()) return { ok: false, removed: false };
  return invoke<PrMonitorUnwatchResultDto>("pr_monitor_unwatch", {
    sessionId,
    prNumber,
  });
}

/**
 * The watches one session holds, as the host sees them.
 *
 * Read once when the client subscribes: after that the host pushes every change,
 * so the client never polls for watch state.
 */
export async function prMonitorState(
  sessionId: string,
): Promise<PrMonitorStateEvent> {
  if (!isDesktopHost()) return { sessionId, watches: [] };
  return invoke<PrMonitorStateEvent>("pr_monitor_state", { sessionId });
}

/** Subscribe to a session's watch rows. Returns an unlisten function. */
export async function onPrMonitorState(
  handler: (payload: PrMonitorStateEvent) => void,
): Promise<() => void> {
  return listen<PrMonitorStateEvent>(PR_MONITOR_STATE_EVENT, handler);
}

/** Subscribe to wake outcomes. Returns an unlisten function. */
export async function onPrMonitorWake(
  handler: (payload: PrMonitorWakeEvent) => void,
): Promise<() => void> {
  return listen<PrMonitorWakeEvent>(PR_MONITOR_WAKE_EVENT, handler);
}
