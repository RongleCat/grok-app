/**
 * Workspace git dirty summary for the active project (composer chip).
 * Owns its polling lifecycle: soft poll while a project is bound, faster
 * while a turn is live, refresh on window focus, paused while hidden.
 *
 * Extracted from AppWorkbench (WP: knowledge hiding — the host only needs
 * the summary value; the poll cadence is this hook's business).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
import { startVisibilityPoll } from "@/lib/visibilityPoll";
import {
  gitDirtySummariesEqual,
  summarizeGitDirty,
  type GitDirtySummary,
} from "@/lib/workspaceGit";

export type GitStatusBranchPatch = (
  path: string,
  status: Awaited<ReturnType<typeof api.gitStatus>>,
) => void;

export function useGitDirtyStatus(opts: {
  /** Absolute path of the active project; null when none. */
  projectPath: string | null | undefined;
  /** True while a turn is streaming / awaiting permission (faster poll). */
  busy: boolean;
  /**
   * Side-channel: the same poll already fetched HEAD, so the composer
   * branch chip can be patched without another spawn.
   */
  onStatus?: GitStatusBranchPatch;
  /** Change key for busy (e.g. session id) to re-arm the poll cadence. */
  busyKey?: string | number | null;
}) {
  const { projectPath, busy, onStatus, busyKey } = opts;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  /** Null when not a repo, unavailable, clean, or no active project. */
  const [gitDirtySummary, setGitDirtySummary] = useState<GitDirtySummary | null>(
    null,
  );
  const reqRef = useRef(0);

  const refresh = useCallback(async () => {
    const path = projectPath?.trim() || null;
    if (!path || !api.isTauri()) {
      reqRef.current += 1;
      setGitDirtySummary((prev) => (prev == null ? prev : null));
      return;
    }
    const reqId = ++reqRef.current;
    try {
      const status = await api.gitStatus(path);
      if (reqId !== reqRef.current) return;
      const next = summarizeGitDirty(status);
      setGitDirtySummary((prev) =>
        gitDirtySummariesEqual(prev, next) ? prev : next,
      );
      onStatusRef.current?.(path, status);
    } catch {
      if (reqId !== reqRef.current) return;
      setGitDirtySummary((prev) => (prev == null ? prev : null));
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
    // Soft poll while a project is bound; refresh sooner on focus.
    // Faster while a turn is live — agent may `git switch` mid-session.
    // Ticks pause while the window is hidden — a minimized app has nothing
    // to paint, and `git status` is a process spawn per poll.
    const path = projectPath?.trim() || null;
    if (!path || !api.isTauri()) return;
    const intervalMs = busy ? 2000 : 8000;
    const poll = startVisibilityPoll({
      tick: () => void refresh(),
      setIntervalFn: (handler) => window.setInterval(handler, intervalMs),
    });
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      poll.dispose();
      window.removeEventListener("focus", onFocus);
    };
  }, [projectPath, refresh, busy, busyKey]);

  return { gitDirtySummary, refreshGitDirtyStatus: refresh };
}
