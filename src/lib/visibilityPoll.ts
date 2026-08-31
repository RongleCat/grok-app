/**
 * Visibility-aware background polling policy.
 *
 * Hidden windows (minimized / covered / another Space) should not burn
 * foreground work: interval ticks are skipped while hidden and a refresh is
 * requested once when the window becomes visible again. Tauri windows report
 * `document.visibilityState` reliably, so no native listeners are needed.
 */

/** Whether a tick may run right now (window actually visible). */
export function shouldPollTickVisible(
  visibilityState: string | null | undefined,
): boolean {
  return visibilityState !== "hidden";
}

export type VisibilityPollSchedule = {
  tick: () => void;
  /** Can a tick run? Defaults to `document.visibilityState !== "hidden"`. */
  isVisible?: () => boolean;
  /** Subscribe to visibility changes. Defaults to `visibilitychange`. */
  addListener?: (handler: () => void) => void;
  removeListener?: (handler: () => void) => void;
  setIntervalFn?: (handler: () => void, ms: number) => unknown;
  clearIntervalFn?: (id: unknown) => void;
};

export type VisibilityPollHandle = {
  dispose: () => void;
};

/**
 * Interval that pauses while the window is hidden.
 *
 * - Interval stays scheduled (cheap); ticks no-op while hidden.
 * - On becoming visible, `tick()` fires once immediately so data caught up
 *   during the pause refreshes right away (the next interval beat may be a
 *   full period away).
 * - In-flight refreshes stay the caller's concern (reqId guards upstream).
 */
export function startVisibilityPoll(
  opts: VisibilityPollSchedule,
): VisibilityPollHandle {
  const isVisible =
    opts.isVisible ??
    (() =>
      typeof document === "undefined" ||
      document.visibilityState !== "hidden");
  const addListener =
    opts.addListener ??
    ((handler: () => void) => {
      document.addEventListener("visibilitychange", handler);
    });
  const removeListener =
    opts.removeListener ??
    ((handler: () => void) => {
      document.removeEventListener("visibilitychange", handler);
    });
  const setIntervalFn =
    opts.setIntervalFn ??
    ((handler: () => void, ms: number) => window.setInterval(handler, ms));
  const clearIntervalFn =
    opts.clearIntervalFn ?? ((id: unknown) => window.clearInterval(id as number));

  const onInterval = () => {
    if (isVisible()) opts.tick();
  };
  const onVisibility = () => {
    if (isVisible()) opts.tick();
  };

  const intervalId = setIntervalFn(onInterval, 1000);
  addListener(onVisibility);

  return {
    dispose() {
      clearIntervalFn(intervalId);
      removeListener(onVisibility);
    },
  };
}
