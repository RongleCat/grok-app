/**
 * Keep a popover mounted through its exit transition so open/close is not a
 * hard cut. Enter is gated one frame after mount (and optional `ready`) so
 * the first painted frame uses the closed styles.
 */

import { useLayoutEffect, useState } from "react";
import { prefersReducedMotion } from "@/lib/paneSplitMotion";

/** Matches `--motion-normal` (tokens.css). */
export const OPEN_PRESENCE_MS = 200;

export type OpenPresenceState = {
  mounted: boolean;
  entered: boolean;
};

export type OpenPresenceEvent =
  | { type: "open" }
  | { type: "enter-frame" }
  | { type: "close"; reducedMotion: boolean }
  | { type: "exit-done" };

export function reduceOpenPresence(
  prev: OpenPresenceState,
  event: OpenPresenceEvent,
): OpenPresenceState {
  switch (event.type) {
    case "open":
      return { mounted: true, entered: false };
    case "enter-frame":
      return prev.mounted ? { mounted: true, entered: true } : prev;
    case "close":
      if (event.reducedMotion || !prev.mounted) {
        return { mounted: false, entered: false };
      }
      return { mounted: true, entered: false };
    case "exit-done":
      return prev.entered ? prev : { mounted: false, entered: false };
  }
}

function readReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return prefersReducedMotion(
    window.matchMedia("(prefers-reduced-motion: reduce)"),
  );
}

/**
 * @param open  Desired open state from the trigger.
 * @param ready Extra gate (e.g. floating menu settled) before the enter class.
 */
export function useOpenPresence(
  open: boolean,
  ready = true,
  durationMs = OPEN_PRESENCE_MS,
): OpenPresenceState {
  const [state, setState] = useState<OpenPresenceState>({
    mounted: open,
    // Deep-link / first paint already on this view: do not fade from hidden.
    entered: open && ready,
  });

  if (open && !state.mounted) {
    setState({ mounted: true, entered: false });
  }

  useLayoutEffect(() => {
    const reduced = readReducedMotion() || durationMs <= 0;

    if (!open) {
      setState((prev) => reduceOpenPresence(prev, { type: "close", reducedMotion: reduced }));
      if (reduced) return;
      const t = window.setTimeout(() => {
        setState((prev) => reduceOpenPresence(prev, { type: "exit-done" }));
      }, durationMs);
      return () => window.clearTimeout(t);
    }

    if (!ready) {
      setState((prev) =>
        prev.entered ? { mounted: true, entered: false } : prev,
      );
      return;
    }

    if (reduced) {
      setState({ mounted: true, entered: true });
      return;
    }

    const id = window.requestAnimationFrame(() => {
      setState((prev) => reduceOpenPresence(prev, { type: "enter-frame" }));
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, ready, durationMs]);

  return state;
}
