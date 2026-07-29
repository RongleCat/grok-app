/**
 * One-click collapse of expanded tool phases / thinking blocks in chat.
 * Dispatched on `window`; TimelinePhaseBlock + Thinking listen and force closed.
 */

/** Window event name — keep stable for any external listeners/tests. */
export const COLLAPSE_ALL_ACTIVITY_EVENT = "grok:collapse-all-activity";

/** Fire collapse-all for the current chat transcript. */
export function dispatchCollapseAllActivity(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(COLLAPSE_ALL_ACTIVITY_EVENT));
  } catch {
    /* ignore */
  }
}
