/**
 * Reactive subscription to the model output motion master switch.
 * The settings page notifies through a custom event after writing the
 * preference; subscribers re-render from it.
 */
import { useEffect, useState } from "react";
import {
  loadOutputMotionPref,
  OUTPUT_MOTION_CHANGE_EVENT,
} from "@/lib/outputMotionPref";

/** Returns whether output motion is enabled and re-renders on preference
 * changes. */
export function useOutputMotionEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => loadOutputMotionPref());
  useEffect(() => {
    const sync = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      setEnabled(
        typeof detail === "boolean" ? detail : loadOutputMotionPref(),
      );
    };
    const syncFromStorage = () => setEnabled(loadOutputMotionPref());
    window.addEventListener(OUTPUT_MOTION_CHANGE_EVENT, sync);
    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener(OUTPUT_MOTION_CHANGE_EVENT, sync);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);
  return enabled;
}
