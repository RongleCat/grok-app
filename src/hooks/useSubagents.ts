/**
 * Subscribe the Tasks panel to subagent telemetry.
 *
 * Selection only — the `session://subagent` subscription itself lives app-level
 * in `useSessionHostEvents`, so runs that start before the panel opens are
 * still there when it does.
 */
import { useSyncExternalStore } from "react";
import { subagentStore } from "@/lib/subagentStore";
import type { SubagentRun } from "@/lib/session/subagents";

/** Merged subagent runs for `sessionId` (empty when none / no session). */
export function useSubagents(
  sessionId: string | null | undefined,
): readonly SubagentRun[] {
  useSyncExternalStore(
    subagentStore.subscribe,
    subagentStore.getSnapshot,
  );
  return subagentStore.list(sessionId);
}
