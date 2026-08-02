/**
 * Toggle html[data-stream-perf] while a turn is actively streaming so CSS can
 * cut wallpaper video decode + backdrop-filter composite cost (Intel Retina).
 *
 * Signal should be true when the focused session (or live host) is streaming,
 * any assistant message has streaming=true, or busyIds covers the session.
 */

import { useEffect } from "react";

export function useStreamPerfMode(active: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    if (active) {
      root.setAttribute("data-stream-perf", "1");
    } else {
      root.removeAttribute("data-stream-perf");
    }
    return () => {
      root.removeAttribute("data-stream-perf");
    };
  }, [active]);
}
