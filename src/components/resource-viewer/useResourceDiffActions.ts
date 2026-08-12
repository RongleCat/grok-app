
import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import * as api from "@/lib/api";
import type { MessageKey } from "@/i18n";
import {
  buildUnifiedDiff,
  normalizePath,
  pathBaseName,
  pathRelativeToProject,
  type SessionFileChange,
} from "@/lib/sessionChanges";
import {
  applySelectedHunks,
  batchSummaryVars,
  canFallbackToBeforeWrite,
  classifyGitCheckoutFailure,
  describeBatchPlanHonesty,
  formatGitCheckoutFailReason,
  needsUntrackedWipeConfirm,
  planBatchAccept,
  planBatchReject,
  planBatchRemainingHunks,
  planFileAccept,
  planFileReject,
  planFileRestore,
  rejectSelectedHunks,
  remainingHunkIndices,
  summarizeBatchResults,
  type BatchDiffPlan,
  type BatchDiffResultItem,
  type BatchFileInput,
  type UnifiedHunk,
} from "@/lib/diffAccept";
import {
  resolveWorkspaceAbsolutePath,
  type WorkspaceGitFile,
} from "@/lib/workspaceGit";
import type { DiffViewState } from "./types";
import { changeStatusLabel as changeStatusLabelHelper } from "./helpers";

export type UseResourceDiffActionsArgs = {
  projectPath: string | null;
  sessionChanges: SessionFileChange[];
  workspaceFiles: WorkspaceGitFile[];
  workspaceAvailable: boolean;
  tr: (key: MessageKey, vars?: Record<string, string>) => string;
  setError: Dispatch<SetStateAction<string | null>>;
  diffView: DiffViewState | null;
  setDiffView: Dispatch<SetStateAction<DiffViewState | null>>;
  restorableAfterByPath: Record<string, string>;
  setRestorableAfterByPath: Dispatch<SetStateAction<Record<string, string>>>;
  diffDecisionByPath: Record<string, "accepted" | "rejected">;
  setDiffDecisionByPath: Dispatch<
    SetStateAction<Record<string, "accepted" | "rejected">>
  >;
  diffActionBusy: boolean;
  setDiffActionBusy: Dispatch<SetStateAction<boolean>>;
  setRejectConfirm: Dispatch<
    SetStateAction<{ path: string; name: string; untracked: boolean } | null>
  >;
  setBatchRejectConfirm: Dispatch<
    SetStateAction<{ plan: BatchDiffPlan; untracked: boolean } | null>
  >;
  setBatchHunkRejectConfirm: Dispatch<SetStateAction<boolean>>;
  setBatchProgress: Dispatch<
    SetStateAction<{
      action: "accept" | "reject";
      current: number;
      total: number;
    } | null>
  >;
  setBatchStatus: Dispatch<SetStateAction<string | null>>;
  refreshWorkspaceStatus: () => void | Promise<void>;
  diffHunks: UnifiedHunk[];
};

export function useResourceDiffActions({
  projectPath,
  sessionChanges,
  workspaceFiles,
  workspaceAvailable,
  tr,
  setError,
  diffView,
  setDiffView,
  restorableAfterByPath,
  setRestorableAfterByPath,
  diffDecisionByPath,
  setDiffDecisionByPath,
  diffActionBusy,
  setDiffActionBusy,
  setRejectConfirm,
  setBatchRejectConfirm,
  setBatchHunkRejectConfirm,
  setBatchProgress,
  setBatchStatus,
  refreshWorkspaceStatus,
  diffHunks,
}: UseResourceDiffActionsArgs) {
  const kindForPath = useCallback(
    (path: string): string => {
      const n = normalizePath(path);
      if (!n) return "modified";
      const w = workspaceFiles.find(
        (f) =>
          normalizePath(f.absolutePath) === n ||
          normalizePath(f.path) === n ||
          resolveWorkspaceAbsolutePath(projectPath, f.path) === n,
      );
      if (w) return w.kind;
      return "modified";
    },
    [workspaceFiles, projectPath],
  );
  const rememberRestorable = useCallback((path: string, after: string | null | undefined) => {
    if (typeof after !== "string") return;
    const key = normalizePath(path);
    if (!key) return;
    setRestorableAfterByPath((prev) =>
      prev[key] === after ? prev : { ...prev, [key]: after },
    );
  }, []);
  const markDecision = useCallback(
    (path: string, decision: "accepted" | "rejected") => {
      const key = normalizePath(path);
      if (!key) return;
      setDiffDecisionByPath((prev) => ({ ...prev, [key]: decision }));
    },
    [],
  );
  const runAcceptFile = useCallback(
    async (path: string, afterOverride?: string | null) => {
      if (!projectPath || !api.isTauri()) {
        setError(tr("changes.needProject"));
        return;
      }
      const key = normalizePath(path);
      const after =
        afterOverride ??
        (typeof diffView?.afterText === "string" ? diffView.afterText : null) ??
        restorableAfterByPath[key] ??
        null;
      if (typeof after === "string") {
        rememberRestorable(path, after);
      }
      const plan = planFileAccept({ after });
      setDiffActionBusy(true);
      setError(null);
      try {
        if (plan.mode === "write_after") {
          const res = await api.applyFilePatch(projectPath, path, plan.content);
          if (!res.ok) {
            setError(
              tr("changes.actionFailed", {
                reason: res.reason || "write failed",
              }),
            );
            return;
          }
        } else if (plan.mode === "unavailable") {
          setError(tr("changes.actionUnavailable", { reason: plan.reason }));
          return;
        }
        // keep_current: success with no disk write
        markDecision(path, "accepted");
        void refreshWorkspaceStatus();
      } catch (e) {
        setError(tr("changes.actionFailed", { reason: String(e) }));
      } finally {
        setDiffActionBusy(false);
      }
    },
    [
      projectPath,
      diffView,
      restorableAfterByPath,
      rememberRestorable,
      markDecision,
      refreshWorkspaceStatus,
      tr,
    ],
  );
  const executeRejectFile = useCallback(
    async (path: string, confirmed: boolean) => {
      if (!projectPath || !api.isTauri()) {
        setError(tr("changes.needProject"));
        return;
      }
      const key = normalizePath(path);
      const after =
        (typeof diffView?.afterText === "string" ? diffView.afterText : null) ??
        restorableAfterByPath[key] ??
        null;
      if (typeof after === "string") {
        rememberRestorable(path, after);
      }
      const before =
        typeof diffView?.beforeText === "string" &&
        normalizePath(diffView.path) === key
          ? diffView.beforeText
          : null;
      const kind = kindForPath(path);
      const plan = planFileReject({
        hasGitRepo: workspaceAvailable,
        kind,
        before,
        fileExists: true,
      });
      setDiffActionBusy(true);
      setError(null);
      try {
        if (plan.mode === "git") {
          if (plan.confirmUntracked && !confirmed) {
            setRejectConfirm({
              path,
              name: pathBaseName(path),
              untracked: true,
            });
            return;
          }
          const res = await api.gitCheckoutFile(
            projectPath,
            path,
            plan.confirmUntracked && confirmed,
          );
          if (res.needsUntrackedConfirm) {
            setRejectConfirm({
              path,
              name: pathBaseName(path),
              untracked: true,
            });
            return;
          }
          if (!res.ok) {
            // Soft-fail classified: missing git → try before write when available
            const failKind = classifyGitCheckoutFailure(res);
            if (
              failKind &&
              canFallbackToBeforeWrite(failKind) &&
              typeof before === "string"
            ) {
              const w = await api.applyFilePatch(projectPath, path, before);
              if (!w.ok) {
                setError(
                  tr("changes.actionFailed", {
                    reason: w.reason || res.reason || "reject failed",
                  }),
                );
                return;
              }
            } else if (failKind) {
              setError(
                formatGitCheckoutFailReason(failKind, res.reason, (k, v) =>
                  tr(k as MessageKey, v),
                ),
              );
              return;
            } else {
              setError(
                tr("changes.actionFailed", {
                  reason: res.reason || "reject failed",
                }),
              );
              return;
            }
          }
        } else if (plan.mode === "write_before") {
          if (!confirmed && needsUntrackedWipeConfirm(kind)) {
            setRejectConfirm({
              path,
              name: pathBaseName(path),
              untracked: true,
            });
            return;
          }
          const res = await api.applyFilePatch(
            projectPath,
            path,
            plan.content,
          );
          if (!res.ok) {
            setError(
              tr("changes.actionFailed", {
                reason: res.reason || "write failed",
              }),
            );
            return;
          }
        } else if (plan.mode === "delete") {
          if (!confirmed) {
            setRejectConfirm({
              path,
              name: pathBaseName(path),
              untracked: true,
            });
            return;
          }
          const res = await api.deleteProjectFile(projectPath, path, true);
          if (!res.ok) {
            const failKind = classifyGitCheckoutFailure(res);
            setError(
              failKind
                ? formatGitCheckoutFailReason(failKind, res.reason, (k, v) =>
                    tr(k as MessageKey, v),
                  )
                : tr("changes.actionFailed", {
                    reason: res.reason || "delete failed",
                  }),
            );
            return;
          }
        } else {
          setError(
            tr("changes.actionUnavailable", { reason: plan.reason }),
          );
          return;
        }
        markDecision(path, "rejected");
        setRejectConfirm(null);
        void refreshWorkspaceStatus();
        // Refresh diff preview after reject
        if (diffView && normalizePath(diffView.path) === key) {
          setDiffView((prev) =>
            prev
              ? {
                  ...prev,
                  afterText:
                    typeof before === "string" ? before : prev.afterText,
                  unified: null,
                  source: "after",
                }
              : prev,
          );
        }
      } catch (e) {
        setError(tr("changes.actionFailed", { reason: String(e) }));
      } finally {
        setDiffActionBusy(false);
      }
    },
    [
      projectPath,
      diffView,
      restorableAfterByPath,
      kindForPath,
      workspaceAvailable,
      rememberRestorable,
      markDecision,
      refreshWorkspaceStatus,
      tr,
    ],
  );
  const requestRejectFile = useCallback(
    (path: string) => {
      const kind = kindForPath(path);
      // Confirm all rejects; untracked wipe gets a stronger copy.
      setRejectConfirm({
        path,
        name: pathBaseName(path),
        untracked: needsUntrackedWipeConfirm(kind),
      });
    },
    [kindForPath],
  );
  const runRestoreFile = useCallback(
    async (path: string) => {
      if (!projectPath || !api.isTauri()) {
        setError(tr("changes.needProject"));
        return;
      }
      const key = normalizePath(path);
      const after =
        restorableAfterByPath[key] ??
        (typeof diffView?.afterText === "string" ? diffView.afterText : null);
      const plan = planFileRestore({ after });
      if (plan.mode !== "write_after") {
        setError(
          tr("changes.actionUnavailable", {
            reason: plan.mode === "unavailable" ? plan.reason : "no snapshot",
          }),
        );
        return;
      }
      setDiffActionBusy(true);
      setError(null);
      try {
        const res = await api.applyFilePatch(projectPath, path, plan.content);
        if (!res.ok) {
          setError(
            tr("changes.actionFailed", {
              reason: res.reason || "restore failed",
            }),
          );
          return;
        }
        markDecision(path, "accepted");
        void refreshWorkspaceStatus();
      } catch (e) {
        setError(tr("changes.actionFailed", { reason: String(e) }));
      } finally {
        setDiffActionBusy(false);
      }
    },
    [
      projectPath,
      restorableAfterByPath,
      diffView,
      markDecision,
      refreshWorkspaceStatus,
      tr,
    ],
  );
  const runAcceptHunk = useCallback(
    async (hunkIndex: number) => {
      if (!projectPath || !api.isTauri() || !diffView) return;
      const before =
        typeof diffView.beforeText === "string" ? diffView.beforeText : null;
      if (before == null || diffHunks.length === 0) {
        setError(
          tr("changes.actionUnavailable", {
            reason: "hunk apply needs before snapshot",
          }),
        );
        return;
      }
      const result = applySelectedHunks(before, diffHunks, [hunkIndex]);
      if (!result.ok) {
        setError(tr("changes.actionFailed", { reason: result.error }));
        return;
      }
      // If other hunks should stay applied, start from full after and only
      // re-apply is wrong — accept one hunk from original means original+hunk.
      // When working tree already has all hunks, accepting one is keep_current
      // for that hunk. Prefer: write original+selected only when rejecting rest
      // is not desired. File-level accept is primary; hunk accept applies just
      // that hunk onto before (partial accept).
      setDiffActionBusy(true);
      try {
        const res = await api.applyFilePatch(
          projectPath,
          diffView.path,
          result.content,
        );
        if (!res.ok) {
          setError(
            tr("changes.actionFailed", {
              reason: res.reason || "hunk write failed",
            }),
          );
          return;
        }
        rememberRestorable(diffView.path, result.content);
        void refreshWorkspaceStatus();
      } catch (e) {
        setError(tr("changes.actionFailed", { reason: String(e) }));
      } finally {
        setDiffActionBusy(false);
      }
    },
    [
      projectPath,
      diffView,
      diffHunks,
      rememberRestorable,
      refreshWorkspaceStatus,
      tr,
    ],
  );
  const runRejectHunk = useCallback(
    async (hunkIndex: number) => {
      if (!projectPath || !api.isTauri() || !diffView) return;
      const current =
        typeof diffView.afterText === "string" ? diffView.afterText : null;
      if (current == null || diffHunks.length === 0) {
        setError(
          tr("changes.actionUnavailable", {
            reason: "hunk reject needs after snapshot",
          }),
        );
        return;
      }
      rememberRestorable(diffView.path, current);
      const result = rejectSelectedHunks(current, diffHunks, [hunkIndex]);
      if (!result.ok) {
        setError(tr("changes.actionFailed", { reason: result.error }));
        return;
      }
      setDiffActionBusy(true);
      try {
        const res = await api.applyFilePatch(
          projectPath,
          diffView.path,
          result.content,
        );
        if (!res.ok) {
          setError(
            tr("changes.actionFailed", {
              reason: res.reason || "hunk write failed",
            }),
          );
          return;
        }
        setDiffView((prev) =>
          prev
            ? {
                ...prev,
                afterText: result.content,
                unified:
                  typeof prev.beforeText === "string"
                    ? buildUnifiedDiff(
                        pathRelativeToProject(prev.path, projectPath) ||
                          prev.name,
                        prev.beforeText,
                        result.content,
                      )
                    : prev.unified,
              }
            : prev,
        );
        void refreshWorkspaceStatus();
      } catch (e) {
        setError(tr("changes.actionFailed", { reason: String(e) }));
      } finally {
        setDiffActionBusy(false);
      }
    },
    [
      projectPath,
      diffView,
      diffHunks,
      rememberRestorable,
      refreshWorkspaceStatus,
      tr,
    ],
  );
  const buildSessionBatchInputs = useCallback((): BatchFileInput[] => {
    return sessionChanges.map((c) => {
      const key = normalizePath(c.path);
  return {
        path: c.path,
        name: c.name,
        kind: kindForPath(c.path),
        after: typeof c.after === "string" ? c.after : null,
        before: typeof c.before === "string" ? c.before : null,
        decision: key ? (diffDecisionByPath[key] ?? null) : null,
        fileExists: true,
      };
    });
  }, [sessionChanges, kindForPath, diffDecisionByPath]);
  const hostAcceptOne = useCallback(
    async (
      path: string,
      after: string | null | undefined,
    ): Promise<BatchDiffResultItem> => {
      const name = pathBaseName(path);
      try {
        const plan = planFileAccept({ after });
        if (plan.mode === "write_after") {
          const res = await api.applyFilePatch(projectPath!, path, plan.content);
          if (!res.ok) {
  return {
              path,
              name,
              status: "soft_fail",
              reason: res.reason || "write failed",
            };
          }
          rememberRestorable(path, plan.content);
        } else if (plan.mode === "unavailable") {
          return { path, name, status: "skipped", reason: plan.reason };
        }
        markDecision(path, "accepted");
        return { path, name, status: "ok" };
      } catch (e) {
        return { path, name, status: "error", reason: String(e) };
      }
    },
    [projectPath, rememberRestorable, markDecision],
  );
  const hostRejectOne = useCallback(
    async (
      path: string,
      opts: {
        confirmed: boolean;
        kind?: string | null;
        before?: string | null;
        after?: string | null;
      },
    ): Promise<BatchDiffResultItem> => {
      const name = pathBaseName(path);
      try {
        if (typeof opts.after === "string") {
          rememberRestorable(path, opts.after);
        }
        const plan = planFileReject({
          hasGitRepo: workspaceAvailable,
          kind: opts.kind,
          before: opts.before,
          fileExists: true,
        });
        if (plan.mode === "git") {
          if (plan.confirmUntracked && !opts.confirmed) {
  return {
              path,
              name,
              status: "skipped",
              reason: "needs untracked confirm",
            };
          }
          const res = await api.gitCheckoutFile(
            projectPath!,
            path,
            plan.confirmUntracked && opts.confirmed,
          );
          if (res.needsUntrackedConfirm) {
  return {
              path,
              name,
              status: "skipped",
              reason: "needs untracked confirm",
            };
          }
          if (!res.ok) {
            const failKind = classifyGitCheckoutFailure(res);
            if (
              failKind &&
              canFallbackToBeforeWrite(failKind) &&
              typeof opts.before === "string"
            ) {
              const w = await api.applyFilePatch(
                projectPath!,
                path,
                opts.before,
              );
              if (!w.ok) {
                return {
                  path,
                  name,
                  status: "soft_fail",
                  reason: w.reason || res.reason || "reject failed",
                };
              }
            } else {
              return {
                path,
                name,
                status: "soft_fail",
                reason: failKind || res.reason || "reject failed",
              };
            }
          }
        } else if (plan.mode === "write_before") {
          const res = await api.applyFilePatch(
            projectPath!,
            path,
            plan.content,
          );
          if (!res.ok) {
            return {
              path,
              name,
              status: "soft_fail",
              reason: res.reason || "write failed",
            };
          }
        } else if (plan.mode === "delete") {
          if (!opts.confirmed) {
            return {
              path,
              name,
              status: "skipped",
              reason: "needs untracked confirm",
            };
          }
          const res = await api.deleteProjectFile(projectPath!, path, true);
          if (!res.ok) {
            const failKind = classifyGitCheckoutFailure(res);
            return {
              path,
              name,
              status: "soft_fail",
              reason: failKind || res.reason || "delete failed",
            };
          }
        } else {
          return { path, name, status: "skipped", reason: plan.reason };
        }
        markDecision(path, "rejected");
        return { path, name, status: "ok" };
      } catch (e) {
        return { path, name, status: "error", reason: String(e) };
      }
    },
    [projectPath, workspaceAvailable, rememberRestorable, markDecision],
  );
  const publishBatchSummary = useCallback(
    (action: "accept" | "reject", items: BatchDiffResultItem[]) => {
      const summary = summarizeBatchResults(action, items);
      const vars = batchSummaryVars(summary);
      if (summary.error + summary.softFail > 0) {
        setError(
          tr(
            action === "accept"
              ? "changes.batchAcceptSummary"
              : "changes.batchRejectSummary",
            vars,
          ),
        );
        setBatchStatus(null);
      } else {
        setError(null);
        setBatchStatus(
          tr(
            action === "accept"
              ? "changes.batchAcceptSummary"
              : "changes.batchRejectSummary",
            vars,
          ),
        );
      }
    },
    [tr],
  );

  const executeBatchAccept = useCallback(
    async (plan: BatchDiffPlan) => {
      if (!projectPath || !api.isTauri() || !plan.canRun) return;
      setDiffActionBusy(true);
      setBatchStatus(null);
      setError(null);
      const results: BatchDiffResultItem[] = plan.skipped.map((e) => ({
        path: e.path,
        name: e.name,
        status: "skipped" as const,
        reason:
          e.outcome.kind === "skip"
            ? e.outcome.reason
            : undefined,
      }));
      const total = plan.run.length;
      let current = 0;
      setBatchProgress({ action: "accept", current: 0, total });
      try {
        for (const entry of plan.run) {
          current += 1;
          setBatchProgress({ action: "accept", current, total });
          const after =
            entry.outcome.kind === "run" &&
            entry.outcome.run.action === "accept" &&
            entry.outcome.run.plan.mode === "write_after"
              ? entry.outcome.run.plan.content
              : sessionChanges.find(
                  (c) => normalizePath(c.path) === normalizePath(entry.path),
                )?.after ?? null;
          const r = await hostAcceptOne(entry.path, after);
          results.push(r);
        }
        publishBatchSummary("accept", results);
        void refreshWorkspaceStatus();
      } finally {
        setBatchProgress(null);
        setDiffActionBusy(false);
      }
    },
    [
      projectPath,
      hostAcceptOne,
      publishBatchSummary,
      refreshWorkspaceStatus,
      sessionChanges,
    ],
  );

  const executeBatchReject = useCallback(
    async (plan: BatchDiffPlan, confirmed: boolean) => {
      if (!projectPath || !api.isTauri() || !plan.canRun) return;
      setBatchRejectConfirm(null);
      setDiffActionBusy(true);
      setBatchStatus(null);
      setError(null);
      const results: BatchDiffResultItem[] = plan.skipped.map((e) => ({
        path: e.path,
        name: e.name,
        status: "skipped" as const,
        reason:
          e.outcome.kind === "skip" ? e.outcome.reason : undefined,
      }));
      const total = plan.run.length;
      let current = 0;
      setBatchProgress({ action: "reject", current: 0, total });
      try {
        for (const entry of plan.run) {
          current += 1;
          setBatchProgress({ action: "reject", current, total });
          const sc = sessionChanges.find(
            (c) => normalizePath(c.path) === normalizePath(entry.path),
          );
          const needsWipe =
            entry.outcome.kind === "run" &&
            entry.outcome.run.action === "reject" &&
            entry.outcome.run.needsUntrackedConfirm;
          const r = await hostRejectOne(entry.path, {
            confirmed: confirmed || !needsWipe,
            kind: entry.kind,
            before: typeof sc?.before === "string" ? sc.before : null,
            after: typeof sc?.after === "string" ? sc.after : null,
          });
          results.push(r);
        }
        publishBatchSummary("reject", results);
        void refreshWorkspaceStatus();
      } finally {
        setBatchProgress(null);
        setDiffActionBusy(false);
      }
    },
    [
      projectPath,
      hostRejectOne,
      publishBatchSummary,
      refreshWorkspaceStatus,
      sessionChanges,
    ],
  );

  const requestBatchAcceptSession = useCallback(() => {
    if (!projectPath || !api.isTauri() || diffActionBusy) return;
    const plan = planBatchAccept(buildSessionBatchInputs(), {
      scope: "session",
    });
    const honesty = describeBatchPlanHonesty(plan);
    if (!honesty.canRun) {
      setBatchStatus(
        tr(
          (honesty.emptyReasonKey ||
            "changes.batchNothingRemaining") as MessageKey,
        ),
      );
      return;
    }
    // Partial success is expected: execute only `plan.run`, then summarize.
    void executeBatchAccept(plan);
  }, [
    projectPath,
    diffActionBusy,
    buildSessionBatchInputs,
    executeBatchAccept,
    tr,
  ]);

  const requestBatchRejectSession = useCallback(() => {
    if (!projectPath || !api.isTauri() || diffActionBusy) return;
    const plan = planBatchReject(buildSessionBatchInputs(), {
      hasGitRepo: workspaceAvailable,
      scope: "session",
    });
    const honesty = describeBatchPlanHonesty(plan);
    if (!honesty.canRun) {
      setBatchStatus(
        tr(
          (honesty.emptyReasonKey ||
            "changes.batchNothingRemaining") as MessageKey,
        ),
      );
      return;
    }
    // Always GlassModal confirm (never window.confirm); stronger untracked copy.
    setBatchRejectConfirm({
      plan,
      untracked: honesty.needsUntrackedConfirm,
    });
  }, [
    projectPath,
    diffActionBusy,
    buildSessionBatchInputs,
    workspaceAvailable,
    tr,
  ]);

  const remainingHunkCount = useMemo(
    () => remainingHunkIndices(diffHunks.length, []).length,
    [diffHunks.length],
  );

  const runBatchRemainingHunks = useCallback(
    async (action: "accept" | "reject") => {
      if (!projectPath || !api.isTauri() || !diffView || diffActionBusy) return;
      const plan = planBatchRemainingHunks({
        action,
        hunks: diffHunks,
        before:
          typeof diffView.beforeText === "string" ? diffView.beforeText : null,
        after:
          typeof diffView.afterText === "string" ? diffView.afterText : null,
      });
      if (!plan.ok) {
        setError(
          tr("changes.actionUnavailable", {
            reason: plan.detail || plan.reason,
          }),
        );
        return;
      }
      setDiffActionBusy(true);
      setBatchStatus(null);
      setError(null);
      setBatchProgress({
        action,
        current: 0,
        total: plan.indices.length,
      });
      try {
        if (action === "reject") {
          rememberRestorable(diffView.path, diffView.afterText);
        }
        const res = await api.applyFilePatch(
          projectPath,
          diffView.path,
          plan.content,
        );
        setBatchProgress({
          action,
          current: plan.indices.length,
          total: plan.indices.length,
        });
        if (!res.ok) {
          setError(
            tr("changes.actionFailed", {
              reason: res.reason || "hunk batch write failed",
            }),
          );
          return;
        }
        if (action === "accept") {
          rememberRestorable(diffView.path, plan.content);
          markDecision(diffView.path, "accepted");
        } else {
          markDecision(diffView.path, "rejected");
        }
        setDiffView((prev) => {
          if (!prev) return prev;
          const before =
            typeof prev.beforeText === "string" ? prev.beforeText : null;
          const rel =
            pathRelativeToProject(prev.path, projectPath) || prev.name;
  return {
            ...prev,
            afterText: plan.content,
            unified:
              before != null
                ? buildUnifiedDiff(rel, before, plan.content)
                : prev.unified,
          };
        });
        setBatchStatus(
          tr(
            action === "accept"
              ? "changes.batchHunksAcceptDone"
              : "changes.batchHunksRejectDone",
            { n: String(plan.indices.length) },
          ),
        );
        void refreshWorkspaceStatus();
      } catch (e) {
        setError(tr("changes.actionFailed", { reason: String(e) }));
      } finally {
        setBatchProgress(null);
        setDiffActionBusy(false);
        setBatchHunkRejectConfirm(false);
      }
    },
    [
      projectPath,
      diffView,
      diffHunks,
      diffActionBusy,
      rememberRestorable,
      markDecision,
      refreshWorkspaceStatus,
      tr,
    ],
  );

  const requestBatchAcceptHunks = useCallback(() => {
    void runBatchRemainingHunks("accept");
  }, [runBatchRemainingHunks]);

  const requestBatchRejectHunks = useCallback(() => {
    if (!diffView || remainingHunkCount === 0 || diffActionBusy) return;
    setBatchHunkRejectConfirm(true);
  }, [diffView, remainingHunkCount, diffActionBusy]);

  const changeStatusLabel = useCallback(
    (status: string) => changeStatusLabelHelper(status, tr),
    [tr],
  );

  return {
    kindForPath,
    rememberRestorable,
    markDecision,
    runAcceptFile,
    executeRejectFile,
    requestRejectFile,
    runRestoreFile,
    runAcceptHunk,
    runRejectHunk,
    buildSessionBatchInputs,
    hostAcceptOne,
    hostRejectOne,
    publishBatchSummary,
    executeBatchAccept,
    executeBatchReject,
    requestBatchAcceptSession,
    requestBatchRejectSession,
    remainingHunkCount,
    runBatchRemainingHunks,
    requestBatchAcceptHunks,
    requestBatchRejectHunks,
    changeStatusLabel,
  };
}
