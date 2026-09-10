/**
 * In-place git branch list + switch for the composer branch chip.
 * Kept out of useGitWorktreeChrome so that hook stays under the 1k-line budget.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import {
  branchCheckedOutElsewhere,
  gitSwitchFailMessage,
  gitSwitchKindFromHost,
  localNameFromRemoteRef,
  sanitizeGitBranchName,
  sortGitBranches,
  type GitBranchEntry,
} from "@/lib/gitBranches";
import { pathsEqual } from "@/lib/gitWorktree";

type GitStatusPatch = {
  available?: boolean | null;
  branch?: string | null;
};

type BranchSwitchHost = {
  tr: ReturnType<typeof createT>;
  activeProject: { path: string } | null;
  session: { sessionId: string | null };
  showToast: (msg: string, ms?: number) => void;
  viewingSessionIdRef: { current: string | null };
};

export function useGitBranches(opts: {
  hostRef: { current: BranchSwitchHost };
  projectPath: string | null;
  gitWorktrees: api.GitWorktreeEntry[];
  switchToWorktree: (wt: api.GitWorktreeEntry) => void | Promise<void>;
  applyStatusBranch: (path: string, status: GitStatusPatch | null | undefined) => void;
  markSessionWorktree: (
    sessionId: string | null | undefined,
    path: string,
    branch: string | null | undefined,
  ) => void | Promise<void>;
  refreshGitWorktrees?: () => void | Promise<void>;
}) {
  const {
    hostRef,
    projectPath,
    gitWorktrees,
    switchToWorktree,
    applyStatusBranch,
    markSessionWorktree,
    refreshGitWorktrees,
  } = opts;
  const [gitBranches, setGitBranches] = useState<GitBranchEntry[]>([]);
  const [gitBranchesAvailable, setGitBranchesAvailable] = useState<
    boolean | null
  >(null);
  const [gitBranchesLoading, setGitBranchesLoading] = useState(false);
  const [gitBranchesReason, setGitBranchesReason] = useState<string | null>(
    null,
  );
  const [gitBranchesBusy, setGitBranchesBusy] = useState(false);
  const gitBranchesReqRef = useRef(0);
  const gitBranchesPathRef = useRef<string | null>(null);

  const refreshGitBranches = useCallback(async () => {
    const path = projectPath?.trim() || null;
    if (!path || !api.isTauri()) {
      gitBranchesReqRef.current += 1;
      gitBranchesPathRef.current = null;
      setGitBranches([]);
      setGitBranchesAvailable(null);
      setGitBranchesReason(null);
      setGitBranchesLoading(false);
      return;
    }
    const reqId = ++gitBranchesReqRef.current;
    if (gitBranchesPathRef.current !== path) {
      gitBranchesPathRef.current = path;
      setGitBranches([]);
      setGitBranchesAvailable(null);
      setGitBranchesReason(null);
    }
    setGitBranchesLoading(true);
    try {
      const res = await api.gitBranchesList(path);
      if (reqId !== gitBranchesReqRef.current) return;
      if (!res.available) {
        setGitBranches([]);
        setGitBranchesAvailable(false);
        setGitBranchesReason(res.reason?.trim() || "unavailable");
      } else {
        setGitBranches(sortGitBranches(res.branches ?? []));
        setGitBranchesAvailable(true);
        setGitBranchesReason(null);
      }
    } catch (e) {
      if (reqId !== gitBranchesReqRef.current) return;
      setGitBranches([]);
      setGitBranchesAvailable(false);
      setGitBranchesReason(String(e));
    } finally {
      if (reqId === gitBranchesReqRef.current) {
        setGitBranchesLoading(false);
      }
    }
  }, [projectPath]);

  useEffect(() => {
    void refreshGitBranches();
  }, [refreshGitBranches]);

  const switchToBranch = useCallback(
    async (row: GitBranchEntry) => {
      const h = hostRef.current;
      const projectPath = h.activeProject?.path?.trim() || "";
      if (!projectPath || !api.isTauri()) return;
      if (row.current) return;
      if (gitBranchesBusy) return;

      if (branchCheckedOutElsewhere(row, projectPath)) {
        const wt =
          gitWorktrees.find((w) => pathsEqual(w.path, row.worktreePath)) ??
          null;
        if (wt) {
          await switchToWorktree(wt);
          return;
        }
        h.showToast(
          h.tr("composer.branchSwitchFailed", {
            branch: row.name,
            reason: gitSwitchFailMessage(
              h.tr,
              "elsewhere",
              null,
              row.worktreePath,
            ),
          }),
          5000,
        );
        return;
      }

      let name: string;
      let startPoint: string | null = null;
      try {
        if (row.remote) {
          startPoint = sanitizeGitBranchName(row.name);
          name = sanitizeGitBranchName(localNameFromRemoteRef(row.name));
        } else {
          name = sanitizeGitBranchName(row.name);
        }
      } catch (e) {
        h.showToast(
          h.tr("composer.branchSwitchFailed", {
            branch: row.name,
            reason: e instanceof Error ? e.message : String(e),
          }),
          4500,
        );
        return;
      }

      setGitBranchesBusy(true);
      try {
        const res = await api.gitSwitchBranch(projectPath, name, startPoint);
        if (!res.ok) {
          const kind = gitSwitchKindFromHost(res.kind);
          h.showToast(
            h.tr("composer.branchSwitchFailed", {
              branch: name,
              reason: gitSwitchFailMessage(
                h.tr,
                kind,
                res.reason,
                res.worktreePath,
              ),
            }),
            5500,
          );
          return;
        }
        const next = (res.branch || name).trim();
        applyStatusBranch(projectPath, { available: true, branch: next });
        const liveId =
          h.viewingSessionIdRef.current || h.session.sessionId || null;
        if (liveId) {
          await markSessionWorktree(liveId, projectPath, next);
        }
        h.showToast(h.tr("composer.branchSwitched", { branch: next }), 2800);
        await Promise.all([
          refreshGitBranches(),
          Promise.resolve(refreshGitWorktrees?.()),
        ]);
      } catch (e) {
        h.showToast(
          h.tr("composer.branchSwitchFailed", {
            branch: name,
            reason: String(e),
          }),
          5000,
        );
      } finally {
        setGitBranchesBusy(false);
      }
    },
    [
      applyStatusBranch,
      gitBranchesBusy,
      gitWorktrees,
      hostRef,
      markSessionWorktree,
      refreshGitBranches,
      refreshGitWorktrees,
      switchToWorktree,
    ],
  );

  return {
    gitBranches,
    gitBranchesAvailable,
    gitBranchesLoading,
    gitBranchesReason,
    gitBranchesBusy,
    refreshGitBranches,
    switchToBranch,
  };
}
