import { useCallback } from "react";
import type { Automation } from "@/lib/automations";
import { recordAutomationRun } from "@/lib/automationRunHistory";

/**
 * Shared failure path for "Run now": surface the message in the composer and
 * append one run-history entry. Returns `false` so callers can `return`.
 */
export function useAutomationRunFailure(
  setLocalError: (message: string) => void,
): (auto: Automation, error: string) => false {
  return useCallback(
    (auto: Automation, error: string) => {
      setLocalError(error);
      recordAutomationRun({
        scheduleId: auto.id,
        name: auto.title,
        outcome: "error",
        source: "run_now",
        error,
      });
      return false;
    },
    [setLocalError],
  );
}

/** Record a skipped run when another run is already in flight. */
export function recordAutomationBusySkip(auto: Automation): false {
  recordAutomationRun({
    scheduleId: auto.id,
    name: auto.title,
    outcome: "skipped",
    source: "run_now",
    error: "busy",
  });
  return false;
}
