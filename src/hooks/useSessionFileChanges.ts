/**
 * Per-session file-change records (Review panel / dirty-chip data source).
 *
 * Writers: the host-event layer (`session://tool` batch apply via ctx) and
 * journal hydration (`host.hydrate.applyOpenResult` + Review seeding).
 * Readers: chat stage, resources aside, and the dirty-chip summary — all
 * through `changesFor`, which owns the empty-list fallback.
 *
 * Extracted from AppWorkbench (WP: knowledge hiding — the host only routes
 * writers and readers; the record shape and fallback are this hook's business).
 */
import { useCallback, useState } from "react";
import {
  EMPTY_SESSION_FILE_CHANGES,
  type SessionFileChange,
} from "@/lib/sessionChanges";

export function useSessionFileChanges() {
  const [sessionChangesById, setSessionChangesById] = useState<
    Record<string, SessionFileChange[]>
  >({});

  /** Changes recorded for a session; empty list when none recorded. */
  const changesFor = useCallback(
    (sessionId: string | null | undefined): SessionFileChange[] =>
      sessionId
        ? (sessionChangesById[sessionId] ?? EMPTY_SESSION_FILE_CHANGES)
        : EMPTY_SESSION_FILE_CHANGES,
    [sessionChangesById],
  );

  return { sessionChangesById, setSessionChangesById, changesFor };
}
