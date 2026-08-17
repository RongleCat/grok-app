/**
 * Right resource pane — Codex-inspired workbench:
 * multi-tabs · breadcrumb toolbar · preview | file tree · open-with menu.
 * Original implementation for Grok App (Tauri + React).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";
import { createT } from "@/i18n";
import {
  formatOpenEditorErrorMessage,
  readOpenTargetStorage,
  resolveOpenEditorError,
  writeOpenTargetStorage,
} from "@/lib/openEditorHonesty";
import { resolveChangesPreviewEmptyState } from "@/lib/resourceChangesHonesty";
import { EmbeddedBrowser } from "@/components/EmbeddedBrowser";
import { OverlayScroll } from "@/components/OverlayScroll";
import { detectAppPlatform, revealInOsLabel } from "@/lib/appPlatform";
import {
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconClose,
  IconFileDiff,
  IconList,
  IconListTree,
  IconPlan,
  IconRefresh,
  IconSearch,
} from "@/components/icons";
import { PlanReviewPanel } from "@/components/PlanReviewPanel";
import { AgentTasksPanel } from "@/components/AgentTasksPanel";
import {
  resolvePlanResourceEmptyState,
  shouldAutoLeavePlanSideMode,
  shouldShowPlanChromeButton,
} from "@/lib/planModePro";
import {
  AGENTS_RAIL_SIDE_MODE,
  countAgentsRailRunning,
  shouldShowAgentsRailBadge,
} from "@/lib/agentsRail";
import {
  collectSessionTasks,
} from "@/lib/sessionTasks";
import { isOfficeKind } from "@/lib/filePreviewSrc";
import { OpenLocationButton } from "@/components/OpenLocationButton";
import { Tip } from "@/components/ui/tooltip";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import {
  nextChangeListKey,
  normalizePath,
  pathBaseName,
  pathRelativeToProject,
} from "@/lib/sessionChanges";
import {
  resolveWorkspaceAbsolutePath,
} from "@/lib/workspaceGit";
import { disambiguateFileTabLabels } from "@/lib/fileTabChipLabel";
import {
  isResourceDraftDirty,
} from "@/lib/resourceEdit";
import {
  setActiveTab,
} from "@/lib/resourceTabs";
import {
  asideSurfaceFromPreviewKind,
  type AsideSurface,
} from "@/lib/layout";
import {
  type ResourceViewerProps,
  type SideMode,
  type TreeNode,
} from "./types";
import {
  TREE_WIDTH_MIN,
  loadTreeWidth,
  clampTreeWidth,
  persistTreeWidth,
  fileTabToResourceTab,
} from "./helpers";
import { FileKindMark } from "./FileKindMark";
import { ResourcePreviewBody } from "./ResourcePreviewBody";
import { ResourceChangesList } from "./ResourceChangesList";
import { ResourceViewerDialogs } from "./ResourceViewerDialogs";
import { useResourceChanges } from "./useResourceChanges";
import { useResourceFileTabs } from "./useResourceFileTabs";

function ChangesOrFilesEmpty({
  sideMode,
  tr,
  projectPath,
  changeCount,
  workspaceCount,
  workspaceLoading,
  workspaceAvailable,
  workspaceReason,
  filesTabsEmpty,
}: {
  sideMode: string;
  tr: (key: import("@/i18n").MessageKey, vars?: Record<string, string>) => string;
  projectPath: string | null;
  changeCount: number;
  workspaceCount: number;
  workspaceLoading: boolean;
  workspaceAvailable: boolean;
  workspaceReason: string | null;
  filesTabsEmpty: { titleKey?: string; hintKey?: string } | null | undefined;
}) {
  if (sideMode === "changes") {
    const empty = resolveChangesPreviewEmptyState({
      projectPath,
      sessionCount: changeCount,
      workspaceCount,
      workspaceLoading,
      workspaceAvailable,
      workspaceReason,
      isTauri: api.isTauri(),
      hasSelection: false,
    });
    return (
      <div
        className="rp__empty-state"
        data-testid="changes-preview-empty"
        data-empty-kind={empty.kind}
      >
        <div className="rp__empty-title">
          {tr(empty.titleKey as import("@/i18n").MessageKey)}
        </div>
        {empty.hintKey ? (
          <div className="rp__empty-desc">
            {tr(empty.hintKey as import("@/i18n").MessageKey)}
          </div>
        ) : null}
        {empty.kind === "pick" ? (
          <div className="rp__empty-desc rp__empty-desc--muted">
            {tr("changes.navHint")}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="rp__empty-state">
      <div className="rp__empty-title">
        {tr(
          (filesTabsEmpty?.titleKey ??
            "resources.emptyPreview") as import("@/i18n").MessageKey,
        )}
      </div>
      <div className="rp__empty-desc">
        {tr(
          (filesTabsEmpty?.hintKey ??
            "resources.emptyPreviewHint") as import("@/i18n").MessageKey,
        )}
      </div>
    </div>
  );
}

export function ResourceViewer({
  projectPath,
  projectName,
  locale,
  onClose,
  openRequest,
  onOpenRequestConsumed,
  paneActive = true,
  sessionChanges = [],
  sessionMessages = [],
  onOpenAgentsCwd,
  activeCwd = null,
  subagentWorktreeSnapshotEnabled = false,
  sessionBusy = false,
  plan = null,
  planFocusKey = null,
  planChrome = null,
  onApprovePlan,
  onRequestPlanChanges,
  onDismissPlan,
  onOpenPlanHistory,
  onShip,
  onDiffCommentToChat,
  onAsideLayoutHint,
  embeddedChrome = false,
  embeddedFilesToolbar = false,
  treeVisible: treeVisibleProp,
  onTreeVisibleChange,
}: ResourceViewerProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [root, setRoot] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    "": true,
  });
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Default closed standalone; embedded workbench defaults open (Codex files).
  // Session-only — not persisted; reset when pane hides (standalone).
  const [treeVisibleLocal, setTreeVisibleLocal] = useState(
    () => !!embeddedChrome,
  );
  const treeVisible =
    typeof treeVisibleProp === "boolean" ? treeVisibleProp : treeVisibleLocal;
  const setTreeVisible = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next =
        typeof v === "function"
          ? v(
              typeof treeVisibleProp === "boolean"
                ? treeVisibleProp
                : treeVisibleLocal,
            )
          : v;
      if (onTreeVisibleChange) onTreeVisibleChange(next);
      else setTreeVisibleLocal(next);
    },
    [onTreeVisibleChange, treeVisibleProp, treeVisibleLocal],
  );
  const [sideMode, setSideMode] = useState<SideMode>("files");
  const lastPlanFocusKey = useRef<number | null>(null);
  /** User opened Plan via open-in-resources / planFocus — keep empty states. */
  const [userPinnedPlanSide, setUserPinnedPlanSide] = useState(false);

  const agentsRailRunningCount = useMemo(
    () => countAgentsRailRunning(collectSessionTasks(sessionMessages)),
    [sessionMessages],
  );
  const showAgentsRailBadge = shouldShowAgentsRailBadge(
    agentsRailRunningCount,
  );

  const planResourceEmpty = useMemo(
    () =>
      resolvePlanResourceEmptyState({
        planVisible: !!plan?.visible,
        planEnabled: planChrome?.planEnabled !== false,
        userClosed: !!planChrome?.userClosed,
        composerMode: planChrome?.composerMode ?? "agent",
        hasHistory: !!planChrome?.hasHistory,
      }),
    [
      plan?.visible,
      planChrome?.planEnabled,
      planChrome?.userClosed,
      planChrome?.composerMode,
      planChrome?.hasHistory,
    ],
  );
  const [treeWidth, setTreeWidth] = useState(loadTreeWidth);
  const [resizingTree, setResizingTree] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  /** Open-with target for the location button (finder / editor id). */
  const [openWithTarget, setOpenWithTarget] = useState(() =>
    readOpenTargetStorage("finder"),
  );

  const persistOpenWithTarget = useCallback((t: string) => {
    setOpenWithTarget(t);
    writeOpenTargetStorage(t);
    // Keep Host settings.defaultOpenTarget in sync with session UI default.
    void api
      .settingsGet()
      .then((s) => api.settingsSet({ ...s, defaultOpenTarget: t }))
      .catch(() => {
        /* soft-fail — localStorage still holds session default */
      });
  }, []);

  const changes = useResourceChanges({
    projectPath,
    sessionChanges,
    query,
    sideMode,
    tr,
    setError,
  });
  const {
    selectedChangePath,
    selectedChangeSource,
    diffView,
    diffLayout,
    setDiffLayout,
    changesListRef,
    workspaceFiles,
    workspaceLoading,
    workspaceAvailable,
    workspaceReason,
    workspaceBranch,
    kindFilter,
    setKindFilter,
    workspaceKindCounts,
    showKindFilters,
    presentKindFilters,
    pathCopyFlash,
    diffActionBusy,
    batchProgress,
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
    acceptHunkConfirm,
    setAcceptHunkConfirm,
    executeAcceptHunk,
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
    rememberRestorable,
    runAcceptFile,
    executeRejectFile,
    requestRejectFile,
    runRestoreFile,
    diffHunks,
    runAcceptHunk,
    runRejectHunk,
    executeBatchReject,
    requestBatchAcceptSession,
    requestBatchRejectSession,
    remainingHunkCount,
    runBatchRemainingHunks,
    requestBatchAcceptHunks,
    requestBatchRejectHunks,
    changeStatusLabel,
  } = changes;

  const fileTabs = useResourceFileTabs({
    projectPath,
    sideMode,
    tr,
    setError,
    onClose,
  });
  const {
    tabs,
    activeId,
    setActiveId,
    conflictTabId,
    setConflictTabId,
    discardTabId,
    setDiscardTabId,
    activeTab,
    filesTabsEmpty,
    activeTabEditable,
    resetTabs,
    updateActiveDraft,
    revertActiveDraft,
    toggleActiveEditMode,
    reloadActiveFile,
    saveActiveFile,
    openFile,
    openAbsoluteFile,
    openUrl,
    openChangeInPane,
    closeTabForced,
    closeTab,
    closeOtherTabs,
    closeTabsToRight,
    closeTabsToLeft,
    closeAllTabs,
  } = fileTabs;

  const fileLabelById = useMemo(
    () =>
      disambiguateFileTabLabels(
        tabs
          .filter((t) => t.tabKind !== "url")
          .map((t) => ({
            id: t.id,
            path: t.relativePath || t.absolutePath,
            name: t.name,
          })),
      ),
    [tabs],
  );

  // Report content surface → App soft-grows the aside so chrome stays usable.
  const activePreviewKind = activeTab?.preview?.kind ?? null;
  const activeTabKind = activeTab?.tabKind ?? null;
  useEffect(() => {
    if (!onAsideLayoutHint || !paneActive) return;
    let surface: AsideSurface = "empty";
    if (sideMode === "plan" && plan?.visible) {
      surface = "plan";
    } else if (sideMode === "changes" && diffView) {
      surface = "diff";
    } else if (activeTabKind === "url") {
      surface = "url";
    } else if (activePreviewKind) {
      surface = asideSurfaceFromPreviewKind(activePreviewKind);
    } else if (activeTabKind) {
      surface = "unknown";
    }
    onAsideLayoutHint({
      surface,
      treeVisible,
      tabCount: tabs.length,
    });
  }, [
    onAsideLayoutHint,
    paneActive,
    sideMode,
    plan?.visible,
    diffView,
    activePreviewKind,
    activeTabKind,
    treeVisible,
    tabs.length,
  ]);

  // Closing the right pane always collapses the tree (not remembered).
  // Also leave Plan workbench when the pane hides without a live plan, so the
  // next open is files — not a stale empty Plan panel after hard-dismiss.
  useEffect(() => {
    if (!paneActive) {
      setTreeVisible(false);
      if (sideMode === "plan" && (!plan || !plan.visible)) {
        setSideMode("files");
      }
    }
  }, [paneActive, sideMode, plan]);


  const showSidePanel = (mode: SideMode) => {
    // Plan mode uses full-width review (no side tree).
    if (mode === "plan") {
      setSideMode("plan");
      setTreeVisible(false);
      setUserPinnedPlanSide(true);
      return;
    }
    // Leaving Plan unpins empty-state hold.
    setUserPinnedPlanSide(false);
    if (treeVisible && sideMode === mode) {
      setTreeVisible(false);
      return;
    }
    setSideMode(mode);
    setTreeVisible(true);
  };

  // External “open plan in resources” (详情 / auto-open on review / plan mode).
  useEffect(() => {
    if (planFocusKey == null) return;
    if (lastPlanFocusKey.current === planFocusKey) return;
    lastPlanFocusKey.current = planFocusKey;
    setSideMode("plan");
    setTreeVisible(false);
    setUserPinnedPlanSide(true);
  }, [planFocusKey]);

  // Plan hard-dismissed while viewing plan → files only when not user-pinned
  // (open-in-resources keeps the empty state reachable).
  useEffect(() => {
    if (
      shouldAutoLeavePlanSideMode({
        sideModeIsPlan: sideMode === "plan",
        planVisible: !!plan?.visible,
        userPinnedPlanSide,
      })
    ) {
      setSideMode("files");
    }
  }, [plan, sideMode, userPinnedPlanSide]);

  // Drag-resize preview | file-tree split
  useEffect(() => {
    if (!resizingTree) return;
    const onMove = (e: PointerEvent) => {
      const box = splitRef.current?.getBoundingClientRect();
      if (!box) return;
      // Tree is on the right → width from pointer to container right edge
      const next = clampTreeWidth(box.right - e.clientX, box.width);
      setTreeWidth(next);
    };
    const onUp = () => {
      setResizingTree(false);
      setTreeWidth((w) => {
        const box = splitRef.current?.getBoundingClientRect();
        return persistTreeWidth(w, box?.width ?? 800);
      });
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizingTree]);

  const loadDir = useCallback(
    async (relative: string): Promise<TreeNode[]> => {
      if (!projectPath) return [];
      if (!api.isTauri()) throw new Error("Tauri required");
      const entries = await api.fsListDir(projectPath, relative);
      return entries.map((e) => ({
        name: e.name,
        relativePath: e.relativePath,
        isDir: e.isDir,
        size: e.size,
        ext: e.ext,
        children: e.isDir ? [] : undefined,
        loaded: !e.isDir,
      }));
    },
    [projectPath],
  );

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setRoot([]);
      return;
    }
    setLoadingTree(true);
    setError(null);
    try {
      setRoot(await loadDir(""));
    } catch (e) {
      setError(String(e));
      setRoot([]);
    } finally {
      setLoadingTree(false);
    }
  }, [loadDir, projectPath]);

  useEffect(() => {
    void refresh();
    resetTabs();
    setExpanded({ "": true });
    setQuery("");
  }, [projectPath, refresh, resetTabs]);

  const toggleDir = async (node: TreeNode) => {
    const key = node.relativePath;
    const willOpen = !expanded[key];
    setExpanded((ex) => ({ ...ex, [key]: willOpen }));
    if (willOpen && !node.loaded) {
      try {
        const children = await loadDir(node.relativePath);
        const patch = (list: TreeNode[]): TreeNode[] =>
          list.map((n) => {
            if (n.relativePath === key) return { ...n, children, loaded: true };
            if (n.children) return { ...n, children: patch(n.children) };
            return n;
          });
        setRoot((r) => patch(r));
      } catch (e) {
        setError(String(e));
      }
    }
  };


  /** Force-open Changes side panel (never toggle off — used by chip / deep links). */
  const openChangesPanel = useCallback(() => {
    setSideMode("changes");
    setTreeVisible(true);
    // Focus list on next paint so j/k works without an extra click.
    requestAnimationFrame(() => {
      changesListRef.current?.focus({ preventScroll: true });
    });
  }, []);

  // External open requests (from chat file/url cards, session-changes chip, …)
  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.type === "file") {
      // Leave plan workbench so file preview is not hidden behind Plan UI.
      setSideMode("files");
      void openAbsoluteFile(openRequest.path, openRequest.title, {
        line: openRequest.line,
        column: openRequest.column,
      });
    } else if (openRequest.type === "url") {
      setSideMode("files");
      openUrl(openRequest.url, openRequest.title);
    } else if (openRequest.type === "changes") {
      openChangesPanel();
      const want = openRequest.path ? normalizePath(openRequest.path) : "";
      if (want) {
        const sc = sessionChanges.find(
          (c) =>
            normalizePath(c.path) === want ||
            pathRelativeToProject(c.path, projectPath) === want,
        );
        if (sc) {
          void loadChangeDiff(sc);
        } else {
          const w = workspaceFiles.find((entry) => {
            const abs =
              normalizePath(entry.absolutePath) ||
              resolveWorkspaceAbsolutePath(projectPath, entry.path);
            return (
              abs === want ||
              normalizePath(entry.path) === want ||
              pathBaseName(entry.path) === pathBaseName(want)
            );
          });
          if (w) {
            void loadWorkspaceDiff(w);
          } else {
            // Fall back: open the file so the user still lands on something useful.
            void openAbsoluteFile(want, pathBaseName(want));
          }
        }
      }
    }
    onOpenRequestConsumed?.();
  }, [
    openRequest,
    openAbsoluteFile,
    openUrl,
    openChangesPanel,
    onOpenRequestConsumed,
    sessionChanges,
    workspaceFiles,
    projectPath,
    loadChangeDiff,
    loadWorkspaceDiff,
  ]);

  // j/k in Changes list (when list is focused or focus is within the side tree).
  useEffect(() => {
    if (!treeVisible || sideMode !== "changes") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "j" && e.key !== "k" && e.key !== "Enter") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = (target.tagName || "").toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target.isContentEditable
      ) {
        return;
      }
      const listEl = changesListRef.current;
      const treeEl = listEl?.closest(".rp-split__tree") ?? null;
      const within =
        (listEl && listEl.contains(target)) ||
        (treeEl && treeEl.contains(target)) ||
        document.activeElement === listEl;
      if (!within) return;

      if (e.key === "Enter") {
        if (selectedChangePath) {
          e.preventDefault();
          openChangeInPane(selectedChangePath);
        }
        return;
      }

      const dir = e.key === "j" ? "next" : "prev";
      const nextKey = nextChangeListKey(changeNavKeys, selectedChangeKey, dir);
      if (!nextKey || nextKey === selectedChangeKey) return;
      e.preventDefault();
      if (nextKey.startsWith("session:")) {
        const path = nextKey.slice("session:".length);
        const hit = filteredChanges.find(
          (c) => normalizePath(c.path) === path,
        );
        if (hit) void loadChangeDiff(hit);
      } else if (nextKey.startsWith("workspace:")) {
        const path = nextKey.slice("workspace:".length);
        const hit = filteredWorkspace.find((w) => {
          const abs =
            normalizePath(w.absolutePath) ||
            resolveWorkspaceAbsolutePath(projectPath, w.path) ||
            normalizePath(w.path);
          return abs === path || normalizePath(w.path) === path;
        });
        if (hit) void loadWorkspaceDiff(hit);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    treeVisible,
    sideMode,
    changeNavKeys,
    selectedChangeKey,
    selectedChangePath,
    filteredChanges,
    filteredWorkspace,
    projectPath,
    loadChangeDiff,
    loadWorkspaceDiff,
    openChangeInPane,
  ]);

  /** Last tab gone → collapse the right pane (user can still re-open it manually). */

  const [tabMenu, setTabMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

  const absPath =
    (diffView && sideMode === "changes" ? diffView.path : "") ||
    activeTab?.absolutePath ||
    "";

  const filterMatch = useCallback(
    (name: string, path: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return name.toLowerCase().includes(q) || path.toLowerCase().includes(q);
    },
    [query],
  );

  const renderTree = (nodes: TreeNode[], depth: number): ReactNode =>
    nodes
      .filter((n) => filterMatch(n.name, n.relativePath) || n.isDir)
      .map((n) => {
        const isOpen = !!expanded[n.relativePath];
        const active = activeTab?.relativePath === n.relativePath;
        return (
          <div key={n.relativePath || n.name}>
            <Tip label={n.relativePath}>
              <button
                type="button"
                className={
                  "rp-tree__row" +
                  (active ? " is-active" : "") +
                  (n.isDir ? " is-dir" : "")
                }
                style={{ paddingLeft: 8 + depth * 12 }}
                onClick={(e) => {
                  e.preventDefault();
                  if (n.isDir) void toggleDir(n);
                  else void openFile(n.relativePath);
                }}
              >
                <span className="rp-tree__chev">
                  {n.isDir ? (
                    isOpen ? (
                      <IconChevronDown size={12} />
                    ) : (
                      <IconChevronRight size={12} />
                    )
                  ) : (
                    <span className="rp-tree__gap" />
                  )}
                </span>
                <FileKindMark name={n.name} isDir={n.isDir} />
                <span className="rp-tree__name">{n.name}</span>
              </button>
            </Tip>
            {n.isDir && isOpen && n.children && n.children.length > 0 && (
              <div className="rp-tree__kids">
                {renderTree(n.children, depth + 1)}
              </div>
            )}
          </div>
        );
      });


  const previewBody = (
    <ResourcePreviewBody
      tr={tr}
      locale={locale}
      sideMode={sideMode}
      diffView={diffView}
      diffLayout={diffLayout}
      setDiffLayout={setDiffLayout}
      activeTab={activeTab}
      projectPath={projectPath}
      pathCopyFlash={pathCopyFlash}
      diffDecisionByPath={diffDecisionByPath}
      restorableAfterByPath={restorableAfterByPath}
      diffActionBusy={diffActionBusy}
      workspaceAvailable={workspaceAvailable}
      diffHunks={diffHunks}
      remainingHunkCount={remainingHunkCount}
      onDiffCommentToChat={onDiffCommentToChat}
      setDiffCommentError={setDiffCommentError}
      setDiffCommentNote={setDiffCommentNote}
      setDiffCommentTarget={setDiffCommentTarget}
      openChangeInEditor={openChangeInEditor}
      openChangeInPane={openChangeInPane}
      revealChangePath={revealChangePath}
      copyChangePath={copyChangePath}
      updateActiveDraft={updateActiveDraft}
      saveActiveFile={saveActiveFile}
      revertActiveDraft={revertActiveDraft}
      toggleActiveEditMode={toggleActiveEditMode}
      runAcceptFile={runAcceptFile}
      requestRejectFile={requestRejectFile}
      runRestoreFile={runRestoreFile}
      runAcceptHunk={runAcceptHunk}
      runRejectHunk={runRejectHunk}
      requestBatchAcceptHunks={requestBatchAcceptHunks}
      requestBatchRejectHunks={requestBatchRejectHunks}
    />
  );

  // No project and no open tabs → empty; allow absolute/url tabs without a project.
  if (!projectPath && tabs.length === 0) {
    return (
      <div
        className={"rp" + (embeddedChrome ? " rp--embedded" : "")}
        data-testid="resource-viewer"
      >
        {!embeddedChrome ? (
          <div className="rp__chrome">
            <div className="rp__chrome-title">{tr("resources.title")}</div>
            {onClose && (
              <Tip label={tr("common.close")}>
                <button
                  type="button"
                  className="chrome-btn"
                  onClick={onClose}
                >
                  <IconClose size={14} />
                </button>
              </Tip>
            )}
          </div>
        ) : null}
        <div className="rp__empty-state">
          <div className="rp__empty-title">{tr("main.noProject")}</div>
          <div className="rp__empty-desc">{tr("resources.needProject")}</div>
        </div>
      </div>
    );
  }

  /**
   * Single chrome row (Grok Desktop / Codex):
   *   [ file tabs … ] [ 打开位置 ] [ tree ] [ close ]
   * No breadcrumb title row — basename lives only in the tab.
   * Nested path is available via tab title attribute.
   *
   * When `embeddedChrome`, parent SideWorkbench owns the shared tab strip;
   * optional `embeddedFilesToolbar` is the dual-row breadcrumb + tree + open.
   */
  const crumbs = absPath
    ? (activeTab?.relativePath || "")
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean)
    : [];

  return (
    <div
      className={"rp" + (embeddedChrome ? " rp--embedded" : "")}
      data-testid="resource-viewer"
      aria-label={projectName ?? tr("resources.title")}
    >
      {!embeddedChrome ? (
      <div className="rp-chrome">
        <div className="rp-tabs" role="tablist" aria-label={tr("resources.files")}>
          <div className="rp-tabs__scroll">
            {filesTabsEmpty ? (
              <div className="rp-tabs__placeholder">
                <span className="rp-tabs__hint">
                  {tr(filesTabsEmpty.titleKey)}
                </span>
              </div>
            ) : (
              tabs.map((t) => {
                const active = t.id === activeId;
                const isFile = t.tabKind !== "url";
                const chipLabel = isFile
                  ? (fileLabelById.get(t.id) ?? t.name)
                  : t.name;
                const showName = isFile || active;
                const dirty = isResourceDraftDirty(
                  t.draftText,
                  t.baselineText,
                );
                return (
                  <Tip
                    key={t.id}
                    label={
                      active
                        ? t.relativePath || t.name
                        : `${chipLabel}\n${t.relativePath || ""}`
                    }
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      title={t.relativePath || t.name}
                      className={
                        "rp-tab" +
                        (active ? " is-active" : " is-inactive") +
                        (t.tabKind === "url" ? " rp-tab--url" : "") +
                        (isFile ? " rp-tab--named" : "") +
                        (dirty ? " is-dirty" : "")
                      }
                      onClick={() => {
                        const next = setActiveTab(
                          tabs.map(fileTabToResourceTab),
                          t.id,
                        );
                        setActiveId(next.activeId);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setTabMenu({
                          x: e.clientX,
                          y: e.clientY,
                          tabId: t.id,
                        });
                      }}
                    >
                      <FileKindMark
                        name={t.tabKind === "url" ? "web.html" : t.name}
                        isDir={false}
                      />
                      {showName ? (
                        <span className="rp-tab__name">{chipLabel}</span>
                      ) : null}
                      {dirty ? (
                        <span className="rp-tab__dirty" aria-hidden>
                          •
                        </span>
                      ) : null}
                      {active ? (
                        <span
                          className="rp-tab__x"
                          role="button"
                          tabIndex={0}
                          title={tr("resources.tabClose")}
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(t.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              closeTab(t.id);
                            }
                          }}
                        >
                          ×
                        </span>
                      ) : null}
                    </button>
                  </Tip>
                );
              })
            )}
          </div>
        </div>
        <div className="rp-chrome__actions">
          {absPath ? (
            <OpenLocationButton
              path={absPath}
              line={activeTab?.focusLine}
              target={openWithTarget}
              onTargetChange={persistOpenWithTarget}
              onOpenError={(e) => {
                // OpenLocationButton may reveal, system-open, or open-in-editor.
                // Prefer open-editor classifier (superset); reveal-only phrases map fine.
                const resolved = resolveOpenEditorError(e);
                if (resolved.silent) return;
                setError(formatOpenEditorErrorMessage(resolved, tr));
              }}
              compact
              platform={detectAppPlatform()}
              labels={{
                openLocation: tr("main.openLocation"),
                openHint: tr("main.openLocationHint"),
                openMenu: tr("main.openLocationMenu"),
                finder: revealInOsLabel(tr),
                systemDefault: tr("resources.openDefault"),
                copyPath: tr("attach.copyPath"),
              }}
            />
          ) : null}
          {shouldShowPlanChromeButton({
            planVisible: !!plan?.visible,
            composerMode: planChrome?.composerMode ?? "agent",
            userClosed: !!planChrome?.userClosed,
            userPinnedPlanSide,
          }) ? (
            <Tip label={tr("resources.plan")}>
              <button
                type="button"
                className={
                  "chrome-btn main__pane-toggle rp-chrome__plan-btn" +
                  (sideMode === "plan" ? " is-on" : "")
                }
                onClick={() => showSidePanel("plan")}
                aria-label={tr("resources.plan")}
                data-testid="resources-plan-chrome-btn"
              >
                <IconPlan size={16} />
              </button>
            </Tip>
          ) : null}
          {onOpenPlanHistory ? (
            <Tip label={tr("plan.history")}>
              <button
                type="button"
                className="chrome-btn main__pane-toggle"
                onClick={onOpenPlanHistory}
                aria-label={tr("plan.history")}
              >
                <IconClock size={16} />
              </button>
            </Tip>
          ) : null}
          {canShowChangesTab ? (
            <Tip
              label={
                treeVisible && sideMode === "changes"
                  ? tr("changes.hidePanel")
                  : tr("changes.showPanel")
              }
            >
              <button
                type="button"
                className={
                  "chrome-btn main__pane-toggle rp-chrome__changes-btn" +
                  (treeVisible && sideMode === "changes" ? " is-on" : "")
                }
                onClick={() => showSidePanel("changes")}
                aria-label={tr("changes.title")}
              >
                <IconFileDiff size={16} />
                {totalChangeBadge > 0 ? (
                  <span className="rp-chrome__badge" aria-hidden>
                    {totalChangeBadge > 99 ? "99+" : totalChangeBadge}
                  </span>
                ) : null}
              </button>
            </Tip>
          ) : null}
          <Tip
            label={
              treeVisible && sideMode === AGENTS_RAIL_SIDE_MODE
                ? tr("resources.agentsHide")
                : tr("resources.agentsShow")
            }
          >
            <button
              type="button"
              className={
                "chrome-btn main__pane-toggle rp-chrome__agents-btn" +
                (treeVisible && sideMode === AGENTS_RAIL_SIDE_MODE
                  ? " is-on"
                  : "")
              }
              onClick={() => showSidePanel(AGENTS_RAIL_SIDE_MODE)}
              aria-label={tr("resources.agents")}
              data-testid="resources-agents-chrome-btn"
            >
              <IconList size={16} />
              {showAgentsRailBadge ? (
                <span className="rp-chrome__badge" aria-hidden>
                  {agentsRailRunningCount > 99
                    ? "99+"
                    : agentsRailRunningCount}
                </span>
              ) : null}
            </button>
          </Tip>
          <Tip
            label={
              treeVisible && sideMode === "files"
                ? tr("resources.collapseTree")
                : tr("resources.expandTree")
            }
          >
            <button
              type="button"
              className={
                "chrome-btn main__pane-toggle" +
                (treeVisible && sideMode === "files" ? " is-on" : "")
              }
              onClick={() => showSidePanel("files")}
            >
              <IconListTree size={16} />
            </button>
          </Tip>
          {onClose && (
            <Tip label={tr("common.close")}>
              <button
                type="button"
                className="chrome-btn"
                onClick={onClose}
              >
                <IconClose size={14} />
              </button>
            </Tip>
          )}
        </div>
      </div>
      ) : null}

      {/* Dual-row files toolbar under shared Side Workbench tab strip (image-5/6) */}
      {embeddedChrome && embeddedFilesToolbar ? (
        <div className="rp-files-toolbar" data-testid="files-toolbar">
          <div
            className="rp-files-toolbar__crumbs"
            title={activeTab?.relativePath || projectName || ""}
          >
            {crumbs.length === 0 ? (
              <span className="rp-files-toolbar__muted">
                {projectName || tr("resources.files")}
              </span>
            ) : (
              crumbs.map((c, i) => (
                <span key={`${c}-${i}`} className="rp-files-toolbar__crumb-wrap">
                  {i > 0 ? (
                    <span className="rp-files-toolbar__sep" aria-hidden>
                      ›
                    </span>
                  ) : null}
                  <span
                    className={
                      "rp-files-toolbar__crumb" +
                      (i === crumbs.length - 1 ? " is-current" : "")
                    }
                  >
                    {c}
                  </span>
                </span>
              ))
            )}
          </div>
          <div className="rp-files-toolbar__actions">
            <Tip
              label={
                treeVisible
                  ? tr("resources.collapseTree")
                  : tr("resources.expandTree")
              }
            >
              <button
                type="button"
                className={
                  "chrome-btn main__pane-toggle" +
                  (treeVisible && sideMode === "files" ? " is-on" : "")
                }
                aria-label={
                  treeVisible
                    ? tr("resources.collapseTree")
                    : tr("resources.expandTree")
                }
                data-testid="files-tree-toggle"
                onClick={() => {
                  if (sideMode !== "files") setSideMode("files");
                  setTreeVisible(!treeVisible);
                }}
              >
                <IconListTree size={16} />
              </button>
            </Tip>
            {absPath ? (
              <OpenLocationButton
                path={absPath}
                line={activeTab?.focusLine}
                target={openWithTarget}
                onTargetChange={persistOpenWithTarget}
                onOpenError={(e) => {
                  const resolved = resolveOpenEditorError(e);
                  if (resolved.silent) return;
                  setError(formatOpenEditorErrorMessage(resolved, tr));
                }}
                compact
                platform={detectAppPlatform()}
                labels={{
                  openLocation: tr("resources.open"),
                  openHint: tr("main.openLocationHint"),
                  openMenu: tr("main.openLocationMenu"),
                  finder: revealInOsLabel(tr),
                  systemDefault: tr("resources.openDefault"),
                  copyPath: tr("attach.copyPath"),
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {error && (
        <div className="rp__error" role="alert">
          {error}
          <Tip label={tr("common.dismiss")}>
            <button
              type="button"
              className="chrome-btn"
              onClick={() => setError(null)}
            >
              <IconClose size={12} />
            </button>
          </Tip>
        </div>
      )}
      {batchProgress ? (
        <div
          className="rp__status"
          role="status"
          aria-live="polite"
          data-testid="changes-batch-progress"
        >
          {tr("changes.batchProgress", {
            action:
              batchProgress.action === "accept"
                ? tr("changes.accept")
                : tr("changes.reject"),
            current: String(batchProgress.current),
            total: String(batchProgress.total),
          })}
        </div>
      ) : batchStatus && !error ? (
        <div className="rp__status" role="status" data-testid="changes-batch-status">
          {batchStatus}
          <Tip label={tr("common.dismiss")}>
            <button
              type="button"
              className="chrome-btn"
              onClick={() => setBatchStatus(null)}
            >
              <IconClose size={12} />
            </button>
          </Tip>
        </div>
      ) : null}
      {activeTab?.error && (
        <div className="rp__error" role="alert">
          {activeTab.error}
        </div>
      )}

      {/* Split: preview | resizer | tree */}
      <div
        ref={splitRef}
        className={
          "rp-split" +
          (treeVisible ? "" : " rp-split--solo") +
          (resizingTree ? " is-resizing" : "")
        }
      >
        <div className="rp-split__preview">
          {sideMode === "plan" && plan?.visible ? (
            <PlanReviewPanel
              plan={plan}
              forceExpandKey={planFocusKey}
              labels={{
                ready: tr("plan.ready"),
                waiting: tr("plan.waiting"),
                progress: tr("planBar.progress"),
                done: tr("planBar.done"),
                empty: tr("plan.empty"),
                approve: tr("plan.approve"),
                changes: tr("plan.changes"),
                dismiss: tr("plan.dismiss"),
                steps: tr("plan.steps"),
                fraction: tr("planBar.fraction"),
                expandDetails: tr("plan.expandDetails"),
                collapseDetails: tr("plan.collapseDetails"),
                current: tr("planBar.current"),
                edit: tr("plan.edit"),
                cancelEdit: tr("plan.cancelEdit"),
                requestWithDraft: tr("plan.requestWithDraft"),
                approveDirtyHint: tr("plan.approveDirtyHint"),
                draftPlaceholder: tr("plan.draftPlaceholder"),
                draftAria: tr("plan.draftAria"),
                discardTitle: tr("plan.discardTitle"),
                discardMessage: tr("plan.discardMessage"),
                discardConfirm: tr("plan.discardConfirm"),
                discardCancel: tr("common.cancel"),
                draftEmpty: tr("plan.draftEmpty"),
                draftTooLong: tr("plan.draftTooLong"),
                close: tr("common.close"),
              }}
              onApprove={onApprovePlan}
              onRequestChanges={onRequestPlanChanges}
              onDismiss={onDismissPlan}
            />
          ) : sideMode === "plan" ? (
            <div
              className={
                "rp__empty-state plan-resource-empty plan-resource-empty--" +
                (planResourceEmpty?.kind ?? "idle")
              }
              data-testid="plan-resource-empty"
              data-empty-kind={planResourceEmpty?.kind ?? "idle"}
              role="status"
            >
              <div className="rp__empty-title plan-resource-empty__title">
                {tr(planResourceEmpty?.titleKey ?? "resources.plan")}
              </div>
              <div className="rp__empty-desc plan-resource-empty__hint">
                {tr(planResourceEmpty?.hintKey ?? "resources.planEmpty")}
              </div>
              {(planResourceEmpty?.showHistoryCta ?? false) &&
              onOpenPlanHistory ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm plan-resource-empty__cta"
                  onClick={onOpenPlanHistory}
                  data-testid="plan-resource-empty-history"
                >
                  {tr("plan.history")}
                </button>
              ) : null}
            </div>
          ) : sideMode === "changes" && diffView ? (
            diffView.loading ? (
              <div className="rp__empty-state">
                <div className="rp__empty-desc">{tr("changes.loadingDiff")}</div>
              </div>
            ) : diffView.unified || diffView.afterOnly ? (
              <div className="rp-preview-code-host">{previewBody}</div>
            ) : (
              <div className="rp__empty-state">{previewBody}</div>
            )
          ) : !activeTab ? (
            <ChangesOrFilesEmpty
              sideMode={sideMode}
              tr={tr}
              projectPath={projectPath}
              changeCount={changeCount}
              workspaceCount={workspaceCount}
              workspaceLoading={workspaceLoading}
              workspaceAvailable={workspaceAvailable}
              workspaceReason={workspaceReason}
              filesTabsEmpty={filesTabsEmpty}
            />
          ) : activeTab.loading ? (
            <div className="rp__empty-state">
              <div className="rp__empty-desc">{tr("resources.loading")}</div>
            </div>
          ) : activeTab.tabKind === "url" && activeTab.url ? (
            /* Native child Webview over host (GitHub etc. block iframe) */
            <div className="rp-preview-browser rp-preview-browser--url">
              <EmbeddedBrowser
                url={activeTab.url}
                title={activeTab.name}
                locale={locale}
                active
              />
            </div>
          ) : activeTabEditable && activeTab.preview ? (
            /* Full-height editor shell (toolbar + textarea / md preview) */
            <div className="rp-preview-code-host rp-preview-editor-host">
              {previewBody}
            </div>
          ) : activeTab.preview?.kind === "html" ? (
            <div className="rp-preview-browser">{previewBody}</div>
          ) : activeTab.preview &&
            isOfficeKind(activeTab.preview.kind) &&
            activeTab.preview.kind !== "image" ? (
            <div className="rp-preview-office">{previewBody}</div>
          ) : activeTab.preview?.text &&
            (activeTab.preview.kind === "json" ||
              activeTab.preview.kind === "text" ||
              activeTab.preview.kind === "code" ||
              // host may classify source as generic text
              (!["markdown", "html", "image", "audio", "video"].includes(
                activeTab.preview.kind,
              ) &&
                !!activeTab.preview.text)) ? (
            <div className="rp-preview-code-host">{previewBody}</div>
          ) : (
            <OverlayScroll className="rp-preview-scroll">
              <div className="rp-preview-body">{previewBody}</div>
            </OverlayScroll>
          )}
        </div>

        {treeVisible && (
          <>
            <div
              className="rp-split__resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label={tr("resources.resizeTree")}
              aria-valuenow={treeWidth}
              onPointerDown={(e) => {
                e.preventDefault();
                setResizingTree(true);
              }}
            />
            <div
              className="rp-split__tree"
              style={{
                width: treeWidth,
                flex: `0 0 ${treeWidth}px`,
                maxWidth: treeWidth,
                minWidth: TREE_WIDTH_MIN,
              }}
            >
              <div className="rp-side-modes" role="tablist" aria-label={tr("resources.title")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sideMode === "files"}
                  className={
                    "rp-side-modes__btn" + (sideMode === "files" ? " is-active" : "")
                  }
                  onClick={() => setSideMode("files")}
                >
                  {tr("changes.files")}
                </button>
                {canShowChangesTab ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sideMode === "changes"}
                    className={
                      "rp-side-modes__btn" +
                      (sideMode === "changes" ? " is-active" : "")
                    }
                    onClick={() => setSideMode("changes")}
                  >
                    {tr("changes.title")}
                    {totalChangeBadge > 0 ? (
                      <span className="rp-side-modes__count">
                        {totalChangeBadge}
                      </span>
                    ) : null}
                  </button>
                ) : null}
                <button
                  type="button"
                  role="tab"
                  aria-selected={sideMode === AGENTS_RAIL_SIDE_MODE}
                  className={
                    "rp-side-modes__btn" +
                    (sideMode === AGENTS_RAIL_SIDE_MODE ? " is-active" : "")
                  }
                  onClick={() => setSideMode(AGENTS_RAIL_SIDE_MODE)}
                  data-testid="resources-agents-tab"
                >
                  {tr("resources.agents")}
                  {showAgentsRailBadge ? (
                    <span className="rp-side-modes__count">
                      {agentsRailRunningCount > 99
                        ? "99+"
                        : agentsRailRunningCount}
                    </span>
                  ) : null}
                </button>
                {plan?.visible ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sideMode === "plan"}
                    className={
                      "rp-side-modes__btn" +
                      (sideMode === "plan" ? " is-active" : "")
                    }
                    onClick={() => showSidePanel("plan")}
                  >
                    {tr("resources.plan")}
                  </button>
                ) : null}
              </div>
              {sideMode === AGENTS_RAIL_SIDE_MODE ? (
                <div
                  className="rp-agents-rail"
                  data-testid="resources-agents-rail"
                >
                  <AgentTasksPanel
                    variant="rail"
                    messages={sessionMessages}
                    t={(k, vars) => tr(k, vars)}
                    onOpenCwd={onOpenAgentsCwd}
                    activeCwd={activeCwd}
                    subagentWorktreeSnapshotEnabled={
                      subagentWorktreeSnapshotEnabled
                    }
                    sessionBusy={sessionBusy}
                  />
                </div>
              ) : (
                <>
              <div className="rp-tree-search">
                <IconSearch size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr("resources.filterPh")}
                  aria-label={tr("resources.filterPh")}
                />
                {sideMode === "files" ? (
                  <Tip label={tr("resources.refresh")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={() => void refresh()}
                    >
                      <IconRefresh size={14} />
                    </button>
                  </Tip>
                ) : (
                  <Tip label={tr("changes.workspace.refresh")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={() => void refreshWorkspaceStatus()}
                      disabled={workspaceLoading}
                    >
                      <IconRefresh size={14} />
                    </button>
                  </Tip>
                )}
              </div>
              <OverlayScroll className="rp-tree-scroll">
                {sideMode === "changes" ? (
                  <ResourceChangesList
                    tr={tr}
                    changesListRef={changesListRef}
                    projectPath={projectPath}
                    query={query}
                    filteredChanges={filteredChanges}
                    filteredWorkspace={filteredWorkspace}
                    changeCount={changeCount}
                    workspaceCount={workspaceCount}
                    workspaceFiles={workspaceFiles}
                    workspaceLoading={workspaceLoading}
                    workspaceAvailable={workspaceAvailable}
                    workspaceBranch={workspaceBranch}
                    selectedChangeSource={selectedChangeSource}
                    selectedChangePath={selectedChangePath}
                    diffActionBusy={diffActionBusy}
                    onShip={onShip}
                    changeStatusLabel={changeStatusLabel}
                    workspaceKindLabel={workspaceKindLabel}
                    workspaceUnavailableLabel={workspaceUnavailableLabel}
                    workspaceUnavailableHint={workspaceUnavailableHint}
                    kindFilter={kindFilter}
                    onKindFilterChange={setKindFilter}
                    showKindFilters={showKindFilters}
                    presentKindFilters={presentKindFilters}
                    workspaceKindCounts={workspaceKindCounts}
                    loadChangeDiff={loadChangeDiff}
                    loadWorkspaceDiff={loadWorkspaceDiff}
                    runAcceptFile={runAcceptFile}
                    requestRejectFile={requestRejectFile}
                    rememberRestorable={rememberRestorable}
                    openChangeInPane={openChangeInPane}
                    openChangeInEditor={openChangeInEditor}
                    revealChangePath={revealChangePath}
                    copyChangePath={copyChangePath}
                    requestBatchAcceptSession={requestBatchAcceptSession}
                    requestBatchRejectSession={requestBatchRejectSession}
                  />
                ) : loadingTree ? (
                  <div className="rp__empty-state rp__empty-state--sm">
                    {tr("resources.loading")}
                  </div>
                ) : root.length === 0 ? (
                  <div className="rp__empty-state rp__empty-state--sm">
                    {tr("resources.empty")}
                  </div>
                ) : (
                  renderTree(root, 0)
                )}
              </OverlayScroll>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Chrome-style tab context menu */}
      {(() => {
        const idx = tabMenu
          ? tabs.findIndex((t) => t.id === tabMenu.tabId)
          : -1;
        const hasLeft = idx > 0;
        const hasRight = idx >= 0 && idx < tabs.length - 1;
        const hasOthers = tabs.length > 1;
        const tabId = tabMenu?.tabId ?? "";
        const items: ContextMenuItem[] = [
          {
            id: "close",
            label: tr("resources.tabClose"),
            onClick: () => closeTab(tabId),
          },
          {
            id: "close-others",
            label: tr("resources.tabCloseOthers"),
            disabled: !hasOthers,
            onClick: () => closeOtherTabs(tabId),
          },
          {
            id: "close-right",
            label: tr("resources.tabCloseRight"),
            disabled: !hasRight,
            onClick: () => closeTabsToRight(tabId),
          },
          {
            id: "close-left",
            label: tr("resources.tabCloseLeft"),
            disabled: !hasLeft,
            onClick: () => closeTabsToLeft(tabId),
          },
          {
            id: "close-all",
            label: tr("resources.tabCloseAll"),
            onClick: () => closeAllTabs(),
          },
        ];
        return (
          <ContextMenu
            open={!!tabMenu}
            x={tabMenu?.x ?? 0}
            y={tabMenu?.y ?? 0}
            onClose={() => setTabMenu(null)}
            items={items}
            className="rp-tab-menu"
          />
        );
      })()}

      <ResourceViewerDialogs
        tr={tr}
        conflictTabId={conflictTabId}
        setConflictTabId={setConflictTabId}
        reloadActiveFile={reloadActiveFile}
        saveActiveFile={saveActiveFile}
        discardTabId={discardTabId}
        setDiscardTabId={setDiscardTabId}
        closeTabForced={closeTabForced}
        rejectConfirm={rejectConfirm}
        setRejectConfirm={setRejectConfirm}
        diffActionBusy={diffActionBusy}
        executeRejectFile={executeRejectFile}
        batchRejectConfirm={batchRejectConfirm}
        setBatchRejectConfirm={setBatchRejectConfirm}
        executeBatchReject={executeBatchReject}
        batchHunkRejectConfirm={batchHunkRejectConfirm}
        setBatchHunkRejectConfirm={setBatchHunkRejectConfirm}
        acceptHunkConfirm={acceptHunkConfirm}
        setAcceptHunkConfirm={setAcceptHunkConfirm}
        executeAcceptHunk={executeAcceptHunk}
        runBatchRemainingHunks={runBatchRemainingHunks}
        remainingHunkCount={remainingHunkCount}
        diffView={diffView}
        diffCommentTarget={diffCommentTarget}
        setDiffCommentTarget={setDiffCommentTarget}
        diffCommentNote={diffCommentNote}
        setDiffCommentNote={setDiffCommentNote}
        diffCommentError={diffCommentError}
        setDiffCommentError={setDiffCommentError}
        onDiffCommentToChat={onDiffCommentToChat}
      />
    </div>
  );
}