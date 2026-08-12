/**
 * Changes / workspace git / diff accept-reject logic for ResourceViewer.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import * as api from "@/lib/api";
import type { MessageKey } from "@/i18n";
import {
  formatOpenEditorErrorMessage,
  formatRevealErrorMessage,
  isOsOpenTarget,
  planOpenInEditor,
  readOpenTargetStorage,
  resolveOpenEditorError,
  resolveRevealError,
} from "@/lib/openEditorHonesty";
import {
  buildUnifiedDiff,
  changeListKey,
  normalizePath,
  pathBaseName,
  pathRelativeToProject,
  type SessionFileChange,
} from "@/lib/sessionChanges";
import {
  parseUnifiedDiff,
  type BatchDiffPlan,
  type UnifiedHunk,
} from "@/lib/diffAccept";
import {
  filterWorkspaceGitEntries,
  normalizeWorkspaceGitEntries,
  resolveWorkspaceAbsolutePath,
  workspaceGitKindMessageKey,
  type WorkspaceGitFile,
} from "@/lib/workspaceGit";
import {
  classifyWorkspaceGitUnavailable,
  countWorkspaceKinds,
  filterWorkspaceByKind,
  normalizeChangesKindFilter,
  presentWorkspaceKindFilters,
  shouldShowKindFilters,
  workspaceGitUnavailableHintKey,
  workspaceGitUnavailableTitleKey,
  type ChangesKindFilter,
  type WorkspaceGitUnavailableKind,
} from "@/lib/resourceChangesHonesty";
import {
  emptyDiffView,
} from "./helpers";
import type {
  ChangeSelectionSource,
  DiffLayout,
  DiffViewState,
  SideMode,
} from "./types";
import { useResourceDiffActions } from "./useResourceDiffActions";

export type UseResourceChangesArgs = {
  projectPath: string | null;
  sessionChanges: SessionFileChange[];
  query: string;
  sideMode: SideMode;
  tr: (key: MessageKey, vars?: Record<string, string>) => string;
  setError: Dispatch<SetStateAction<string | null>>;
};

export function useResourceChanges({
  projectPath,
  sessionChanges,
  query,
  sideMode,
  tr,
  setError,
}: UseResourceChangesArgs) {
const [selectedChangePath, setSelectedChangePath] = useState<string | null>(
  null,
);
const [selectedChangeSource, setSelectedChangeSource] =
  useState<ChangeSelectionSource | null>(null);
const [diffView, setDiffView] = useState<DiffViewState | null>(null);
/** Unified vs side-by-side when both before/after snapshots exist. */
const [diffLayout, setDiffLayout] = useState<DiffLayout>("unified");
const changesListRef = useRef<HTMLDivElement>(null);
const diffLoadSeq = useRef(0);
const workspaceLoadSeq = useRef(0);
/** Workspace git status (project-wide), independent of session tool edits. */
const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceGitFile[]>([]);
const [workspaceLoading, setWorkspaceLoading] = useState(false);
const [workspaceAvailable, setWorkspaceAvailable] = useState(false);
const [workspaceReason, setWorkspaceReason] = useState<string | null>(null);
const [workspaceBranch, setWorkspaceBranch] = useState<string | null>(null);
/** Workspace kind chip filter (all / modified / untracked / …). */
const [kindFilter, setKindFilterRaw] = useState<ChangesKindFilter>("all");
const setKindFilter = useCallback((raw: string) => {
  setKindFilterRaw(normalizeChangesKindFilter(raw));
}, []);
const [pathCopyFlash, setPathCopyFlash] = useState(false);
/** Accept / reject / restore in flight. */
const [diffActionBusy, setDiffActionBusy] = useState(false);
/** Batch accept/reject progress (null when idle). */
const [batchProgress, setBatchProgress] = useState<{
  action: "accept" | "reject";
  current: number;
  total: number;
} | null>(null);
/** Soft success / partial summary (dismissible; not a hard error). */
const [batchStatus, setBatchStatus] = useState<string | null>(null);
/** Per-path decision badge after accept/reject. */
const [diffDecisionByPath, setDiffDecisionByPath] = useState<
  Record<string, "accepted" | "rejected">
>({});
/** After-content snapshots kept for Restore after reject. */
const [restorableAfterByPath, setRestorableAfterByPath] = useState<
  Record<string, string>
>({});
/** In-app confirm for destructive reject. */
const [rejectConfirm, setRejectConfirm] = useState<{
  path: string;
  name: string;
  untracked: boolean;
} | null>(null);
/** In-app confirm for batch reject (session / remaining hunks). */
const [batchRejectConfirm, setBatchRejectConfirm] = useState<{
  plan: BatchDiffPlan;
  untracked: boolean;
} | null>(null);
/** In-app confirm for file-scoped reject-all-remaining hunks. */
const [batchHunkRejectConfirm, setBatchHunkRejectConfirm] = useState(false);
/** Per-hunk review comment → insert structured prompt into composer. */
const [diffCommentTarget, setDiffCommentTarget] = useState<{
  path: string;
  name: string;
  hunkIndex: number;
  hunkHeader: string;
  hunkSnippet: string;
} | null>(null);
const [diffCommentNote, setDiffCommentNote] = useState("");
const [diffCommentError, setDiffCommentError] = useState<
  "empty" | "too_long" | "no_path" | "no_snippet" | null
>(null);

const changeCount = sessionChanges.length;
const workspaceCount = workspaceFiles.length;
const totalChangeBadge = changeCount + workspaceCount;
const filteredChanges = useMemo(() => {
  const q = query.trim().toLowerCase();
  if (!q) return sessionChanges;
  return sessionChanges.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.path.toLowerCase().includes(q) ||
      (c.toolKind || "").toLowerCase().includes(q),
  );
}, [sessionChanges, query]);
const workspaceKindCounts = useMemo(
  () => countWorkspaceKinds(workspaceFiles),
  [workspaceFiles],
);
const showKindFilters = useMemo(
  () => shouldShowKindFilters(workspaceKindCounts),
  [workspaceKindCounts],
);
const presentKindFilters = useMemo(
  () => presentWorkspaceKindFilters(workspaceKindCounts, kindFilter),
  [workspaceKindCounts, kindFilter],
);
const filteredWorkspace = useMemo(() => {
  const byQuery = filterWorkspaceGitEntries(workspaceFiles, query);
  return filterWorkspaceByKind(byQuery, kindFilter);
}, [workspaceFiles, query, kindFilter]);
const workspaceUnavailableKind: WorkspaceGitUnavailableKind | null =
  useMemo(
    () =>
      classifyWorkspaceGitUnavailable({
        projectPath,
        isTauri: api.isTauri(),
        available: workspaceAvailable,
        reason: workspaceReason,
        loading: workspaceLoading,
      }),
    [
      projectPath,
      workspaceAvailable,
      workspaceReason,
      workspaceLoading,
    ],
  );

/** Flat j/k order: session rows then workspace rows (filtered). */
const changeNavKeys = useMemo(() => {
  const keys: string[] = [];
  for (const c of filteredChanges) {
    keys.push(changeListKey("session", c.path));
  }
  for (const w of filteredWorkspace) {
    const abs =
      normalizePath(w.absolutePath) ||
      resolveWorkspaceAbsolutePath(projectPath, w.path) ||
      w.path;
    keys.push(changeListKey("workspace", abs || w.path));
  }
  return keys;
}, [filteredChanges, filteredWorkspace, projectPath]);

const selectedChangeKey = useMemo(() => {
  if (!selectedChangePath || !selectedChangeSource) return null;
  return changeListKey(selectedChangeSource, selectedChangePath);
}, [selectedChangePath, selectedChangeSource]);

const canShowChangesTab =
  workspaceAvailable || changeCount > 0 || sideMode === "changes";

const refreshWorkspaceStatus = useCallback(async () => {
  if (!projectPath || !api.isTauri()) {
    setWorkspaceFiles([]);
    setWorkspaceAvailable(false);
    setWorkspaceBranch(null);
    setWorkspaceReason(null);
    setWorkspaceLoading(false);
    return;
  }
  const seq = ++workspaceLoadSeq.current;
  setWorkspaceLoading(true);
  try {
    const res = await api.gitStatus(projectPath);
    if (seq !== workspaceLoadSeq.current) return;
    if (!res.available) {
      setWorkspaceFiles([]);
      setWorkspaceAvailable(false);
      setWorkspaceBranch(res.branch ?? null);
      setWorkspaceReason(res.reason ?? "unavailable");
    } else {
      setWorkspaceFiles(
        normalizeWorkspaceGitEntries(res.files ?? [], projectPath),
      );
      setWorkspaceAvailable(true);
      setWorkspaceBranch(res.branch ?? null);
      setWorkspaceReason(null);
    }
  } catch (e) {
    if (seq !== workspaceLoadSeq.current) return;
    setWorkspaceFiles([]);
    setWorkspaceAvailable(false);
    setWorkspaceBranch(null);
    setWorkspaceReason(String(e));
  } finally {
    if (seq === workspaceLoadSeq.current) setWorkspaceLoading(false);
  }
}, [projectPath]);

// Prefetch workspace git status for badge + Changes panel (soft; project change).
useEffect(() => {
  void refreshWorkspaceStatus();
}, [projectPath, refreshWorkspaceStatus]);

// Drop selection if neither session nor workspace still lists the path.
useEffect(() => {
  if (!selectedChangePath) return;
  const n = normalizePath(selectedChangePath);
  const inSession = sessionChanges.some(
    (c) => normalizePath(c.path) === n,
  );
  const inWorkspace = workspaceFiles.some(
    (c) =>
      normalizePath(c.path) === n ||
      normalizePath(c.absolutePath) === n,
  );
  if (!inSession && !inWorkspace) {
    setSelectedChangePath(null);
    setSelectedChangeSource(null);
    setDiffView(null);
  }
}, [sessionChanges, workspaceFiles, selectedChangePath]);

const loadChangeDiff = useCallback(
  async (change: SessionFileChange) => {
    const path = normalizePath(change.path);
    if (!path) return;
    const seq = ++diffLoadSeq.current;
    const name = change.name || pathBaseName(path);
    setSelectedChangePath(path);
    setSelectedChangeSource("session");
    setDiffView(emptyDiffView(path, name, true));

    const relName =
      pathRelativeToProject(path, projectPath) || name;

    // 1) Tool payload before/after → local unified diff
    if (
      typeof change.before === "string" &&
      typeof change.after === "string"
    ) {
      const unified = buildUnifiedDiff(relName, change.before, change.after);
      if (seq !== diffLoadSeq.current) return;
      setDiffView({
        path,
        name,
        loading: false,
        unified,
        afterOnly: null,
        error: null,
        source: "payload",
        beforeText: change.before,
        afterText: change.after,
      });
      return;
    }

    // 2) Optional git diff under project
    if (projectPath && api.isTauri()) {
      try {
        const g = await api.gitFileDiff(projectPath, path);
        if (seq !== diffLoadSeq.current) return;
        if (g.available && g.diff?.trim()) {
          setDiffView({
            path,
            name,
            loading: false,
            unified: g.diff,
            afterOnly: null,
            error: null,
            source: "git",
            beforeText: null,
            afterText: null,
          });
          return;
        }
      } catch {
        /* soft-fail; try after content */
      }
    }

    // 3) Payload after-only, or read current file
    let afterText =
      typeof change.after === "string" && change.after.length > 0
        ? change.after
        : null;
    if (!afterText && api.isTauri()) {
      try {
        const r = await api.fsOpenPath(path, projectPath);
        if (r.text) afterText = r.text;
      } catch {
        /* ignore */
      }
    }

    // 3b) HEAD content via git_show_file + after → local unified diff
    if (
      afterText != null &&
      typeof change.before !== "string" &&
      projectPath &&
      api.isTauri()
    ) {
      try {
        const head = await api.gitShowFile(projectPath, path);
        if (seq !== diffLoadSeq.current) return;
        if (head.available && typeof head.content === "string") {
          const unified = buildUnifiedDiff(relName, head.content, afterText);
          setDiffView({
            path,
            name,
            loading: false,
            unified,
            afterOnly: null,
            error: null,
            source: "head",
            beforeText: head.content,
            afterText,
          });
          return;
        }
      } catch {
        /* soft-fail */
      }
    }

    if (seq !== diffLoadSeq.current) return;

    if (
      typeof change.before === "string" &&
      afterText != null
    ) {
      const unified = buildUnifiedDiff(relName, change.before, afterText);
      setDiffView({
        path,
        name,
        loading: false,
        unified,
        afterOnly: null,
        error: null,
        source: "payload",
        beforeText: change.before,
        afterText,
      });
      return;
    }

    if (afterText != null) {
      setDiffView({
        path,
        name,
        loading: false,
        unified: null,
        afterOnly: afterText,
        error: null,
        source: "after",
        beforeText: null,
        afterText,
      });
      return;
    }

    setDiffView(emptyDiffView(path, name, false));
  },
  [projectPath],
);

const loadWorkspaceDiff = useCallback(
  async (entry: WorkspaceGitFile) => {
    const abs =
      normalizePath(entry.absolutePath) ||
      resolveWorkspaceAbsolutePath(projectPath, entry.path);
    const path = abs || normalizePath(entry.path);
    if (!path) return;
    const seq = ++diffLoadSeq.current;
    const name = entry.name || pathBaseName(path);
    setSelectedChangePath(path);
    setSelectedChangeSource("workspace");
    setDiffView(emptyDiffView(path, name, true));

    const relName = entry.path || pathBaseName(path);

    // Prefer git unified diff for workspace rows
    if (projectPath && api.isTauri()) {
      try {
        const g = await api.gitFileDiff(projectPath, path);
        if (seq !== diffLoadSeq.current) return;
        if (g.available && g.diff?.trim()) {
          // Also try to load sides for optional split view
          let beforeText: string | null = null;
          let afterText: string | null = null;
          try {
            const [head, cur] = await Promise.all([
              api.gitShowFile(projectPath, path).catch(() => null),
              api.fsOpenPath(path, projectPath).catch(() => null),
            ]);
            if (head?.available && typeof head.content === "string") {
              beforeText = head.content;
            }
            if (cur?.text != null) afterText = cur.text;
          } catch {
            /* optional */
          }
          if (seq !== diffLoadSeq.current) return;
          setDiffView({
            path,
            name,
            loading: false,
            unified: g.diff,
            afterOnly: null,
            error: null,
            source: "git",
            beforeText,
            afterText,
          });
          return;
        }
      } catch {
        /* soft-fail */
      }

      // HEAD + working tree for local unified when porcelain has no unified text
      try {
        const [head, cur] = await Promise.all([
          api.gitShowFile(projectPath, path).catch(() => null),
          api.fsOpenPath(path, projectPath).catch(() => null),
        ]);
        if (seq !== diffLoadSeq.current) return;
        const afterText = cur?.text ?? null;
        if (head?.available && typeof head.content === "string" && afterText != null) {
          const unified = buildUnifiedDiff(relName, head.content, afterText);
          setDiffView({
            path,
            name,
            loading: false,
            unified,
            afterOnly: null,
            error: null,
            source: "head",
            beforeText: head.content,
            afterText,
          });
          return;
        }
        if (afterText != null) {
          // Untracked / new: show full file as after-only / +diff
          const isNew =
            entry.kind === "untracked" || entry.kind === "added";
          setDiffView({
            path,
            name,
            loading: false,
            unified: isNew ? buildUnifiedDiff(relName, "", afterText) : null,
            afterOnly: isNew ? null : afterText,
            error: null,
            source: isNew ? "git" : "after",
            beforeText: isNew ? "" : null,
            afterText,
          });
          return;
        }
      } catch {
        /* soft-fail */
      }
    }

    if (seq !== diffLoadSeq.current) return;
    setDiffView(emptyDiffView(path, name, false));
  },
  [projectPath],
);

const openChangeInEditor = useCallback(
  async (path: string) => {
    // Prefer session/global default open target when it is a code editor.
    // OS targets fall through so Host uses settings.defaultOpenTarget.
    const preferred = readOpenTargetStorage("finder");
    const editorId = isOsOpenTarget(preferred) ? null : preferred;
    const plan = planOpenInEditor({
      path,
      editorId,
      isTauri: api.isTauri(),
    });
    if (!plan.ok) {
      if (plan.kind === "cancelled") return;
      setError(tr(plan.messageKey as MessageKey));
      return;
    }
    try {
      await api.openInEditor({
        path: plan.path,
        editor: plan.editorId ?? undefined,
      });
    } catch (e) {
      const resolved = resolveOpenEditorError(e);
      if (resolved.silent) return;
      setError(formatOpenEditorErrorMessage(resolved, tr));
    }
  },
  [tr],
);

const revealChangePath = useCallback(
  async (path: string) => {
    if (!path) return;
    if (!api.isTauri()) {
      const resolved = resolveRevealError({ code: "host_only" });
      setError(formatRevealErrorMessage(resolved, tr));
      return;
    }
    try {
      await api.pathReveal(path);
    } catch (e) {
      const resolved = resolveRevealError(e);
      if (resolved.silent) return;
      setError(formatRevealErrorMessage(resolved, tr));
    }
  },
  [tr],
);

const copyChangePath = useCallback(async (path: string) => {
  if (!path) return;
  try {
    await navigator.clipboard.writeText(path);
    setPathCopyFlash(true);
    window.setTimeout(() => setPathCopyFlash(false), 1200);
  } catch (e) {
    setError(String(e));
  }
}, []);

const workspaceKindLabel = useCallback(
  (kind: string) =>
    tr(workspaceGitKindMessageKey(kind) as MessageKey),
  [tr],
);

const workspaceUnavailableLabel = useCallback(() => {
  const kind =
    workspaceUnavailableKind ??
    classifyWorkspaceGitUnavailable({
      projectPath,
      isTauri: api.isTauri(),
      available: false,
      reason: workspaceReason,
    }) ??
    "unavailable";
  return tr(workspaceGitUnavailableTitleKey(kind) as MessageKey);
}, [tr, workspaceUnavailableKind, projectPath, workspaceReason]);

const workspaceUnavailableHint = useCallback(() => {
  const kind =
    workspaceUnavailableKind ??
    classifyWorkspaceGitUnavailable({
      projectPath,
      isTauri: api.isTauri(),
      available: false,
      reason: workspaceReason,
    }) ??
    "unavailable";
  const key = workspaceGitUnavailableHintKey(kind);
  return key ? tr(key as MessageKey) : null;
}, [tr, workspaceUnavailableKind, projectPath, workspaceReason]);

/** Resolve workspace kind for a path (session-only → modified). */

  const diffHunks: UnifiedHunk[] = useMemo(() => {
    if (!diffView?.unified) return [];
    return parseUnifiedDiff(diffView.unified).hunks;
  }, [diffView?.unified]);

  const diffActions = useResourceDiffActions({
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
  });
  const {
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
  } = diffActions;

  return {
    selectedChangePath,
    setSelectedChangePath,
    selectedChangeSource,
    setSelectedChangeSource,
    diffView,
    setDiffView,
    diffLayout,
    setDiffLayout,
    changesListRef,
    workspaceFiles,
    workspaceLoading,
    workspaceAvailable,
    workspaceReason,
    workspaceUnavailableKind,
    workspaceBranch,
    kindFilter,
    setKindFilter,
    workspaceKindCounts,
    showKindFilters,
    presentKindFilters,
    pathCopyFlash,
    diffActionBusy,
    batchProgress,
    setBatchProgress,
    batchStatus,
    setBatchStatus,
    diffDecisionByPath,
    restorableAfterByPath,
    rejectConfirm,
    setRejectConfirm,
    batchRejectConfirm,
    setBatchRejectConfirm,
    batchHunkRejectConfirm,
    setBatchHunkRejectConfirm,
    diffCommentTarget,
    setDiffCommentTarget,
    diffCommentNote,
    setDiffCommentNote,
    diffCommentError,
    setDiffCommentError,
    changeCount,
    workspaceCount,
    totalChangeBadge,
    filteredChanges,
    filteredWorkspace,
    changeNavKeys,
    selectedChangeKey,
    canShowChangesTab,
    refreshWorkspaceStatus,
    loadChangeDiff,
    loadWorkspaceDiff,
    openChangeInEditor,
    revealChangePath,
    copyChangePath,
    workspaceKindLabel,
    workspaceUnavailableLabel,
    workspaceUnavailableHint,
    kindForPath,
    rememberRestorable,
    markDecision,
    runAcceptFile,
    executeRejectFile,
    requestRejectFile,
    runRestoreFile,
    diffHunks,
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