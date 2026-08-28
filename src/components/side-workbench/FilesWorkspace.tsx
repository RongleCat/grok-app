/**
 * Files workbench (Phase 1): dual-row chrome under shared SideTabBar —
 * breadcrumb + tree toggle +「打开」; one shared tree; multi-file preview
 * driven by parent SideTab file paths. Preview | tree split (not exclusive stack).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import { detectAppPlatform, revealInOsLabel } from "@/lib/appPlatform";
import {
  IconChevronDown,
  IconChevronRight,
  IconListTree,
  IconRefresh,
  IconSearch,
} from "@/components/icons";
import { OpenLocationButton } from "@/components/OpenLocationButton";
import { OverlayScroll } from "@/components/OverlayScroll";
import { VirtualList } from "@/components/VirtualList";
import { Tip } from "@/components/ui/tooltip";
import { GlassModal } from "@/components/GlassModal";
import { FileKindMark } from "@/components/resource-viewer/FileKindMark";
import { ResourcePreviewBody } from "@/components/resource-viewer/ResourcePreviewBody";
import {
  clampTreeWidth,
  loadTreeWidth,
  persistTreeWidth,
  TREE_WIDTH_MIN,
} from "@/components/resource-viewer/helpers";
import type { FileTab, TreeNode } from "@/components/resource-viewer/types";
import { useResourceFileTabs } from "@/components/resource-viewer/useResourceFileTabs";
import {
  formatOpenEditorErrorMessage,
  readOpenTargetStorage,
  resolveOpenEditorError,
  writeOpenTargetStorage,
} from "@/lib/openEditorHonesty";
import { resolveFilesWorkbenchSplitLayout } from "@/lib/resourceTabs";
import {
  RESOURCE_TREE_ROW_HEIGHT_PX,
  RESOURCE_TREE_VIRTUALIZE_THRESHOLD,
  expandKeysForResourcePath,
  expandKeysForResourceTreeFilter,
  filterResourceTreeNodes,
  flattenVisibleResourceTree,
  loadTreeExpanded,
  mergeTreeExpandedForFilter,
  replaceResourceTreeChildren,
  saveTreeExpanded,
  sessionChangePathsKey,
} from "@/lib/resourceTree";
import { isResourceDraftDirty } from "@/lib/resourceEdit";
import {
  pathBaseName,
  type SessionFileChange,
} from "@/lib/sessionChanges";
import { sshChatRelative, sshRemoteDirToList } from "@/lib/sshChatPath";

export type FilesWorkspaceProps = {
  locale: Locale | string;
  projectPath: string | null;
  /** OpenSSH Host alias — list/read/write go over SSH. */
  sshAlias?: string | null;
  projectName?: string | null;
  /** Shared tree visibility (SideWorkbenchState.treeVisible). */
  treeVisible: boolean;
  onTreeVisibleChange: (v: boolean) => void;
  /**
   * Active file path from Side Workbench (absolute or project-relative).
   * When set, focus/open that path in the shared preview tabs.
   */
  activePath?: string | null;
  /** 1-based line from path:line open request (soft-fail if out of range). */
  activeLine?: number | null;
  activeColumn?: number | null;
  /** Report file open from tree so parent can create/focus a SideTab. */
  onFileOpen?: (path: string, name: string) => void;
  /** Dirty path keys for side-tab dirty markers / close honesty. */
  onDirtyPathsChange?: (paths: string[]) => void;
  /**
   * Parent asks to close a path (side tab ×). Returns false when discard
   * modal is shown instead of closing immediately.
   */
  closePathRequest?: { path: string; token: number } | null;
  onClosePathResult?: (path: string, closed: boolean) => void;
  paneActive?: boolean;
  sessionChanges: SessionFileChange[];
};

const NOOP = () => {};
const NOOP_ASYNC = async () => {};

export function FilesWorkspace({
  locale,
  projectPath,
  sshAlias = null,
  projectName,
  treeVisible,
  onTreeVisibleChange,
  activePath,
  activeLine = null,
  activeColumn = null,
  onFileOpen,
  onDirtyPathsChange,
  closePathRequest,
  onClosePathResult,
  paneActive = true,
  sessionChanges,
}: FilesWorkspaceProps) {
  const tr = useMemo(() => createT(locale as Locale), [locale]);
  const [root, setRoot] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    loadTreeExpanded(projectPath || ""),
  );
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [treeWidth, setTreeWidth] = useState(loadTreeWidth);
  const [resizingTree, setResizingTree] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const lastCloseToken = useRef<number | null>(null);
  const pendingSideClosePath = useRef<string | null>(null);
  const [openWithTarget, setOpenWithTarget] = useState(() =>
    readOpenTargetStorage("finder"),
  );

  const persistOpenWithTarget = useCallback((t: string) => {
    setOpenWithTarget(t);
    writeOpenTargetStorage(t);
    void api
      .settingsGet()
      .then((s) => api.settingsSet({ ...s, defaultOpenTarget: t }))
      .catch(() => {
        /* soft-fail — localStorage still holds session default */
      });
  }, []);

  const fileTabs = useResourceFileTabs({
    projectPath,
    sshAlias,
    sideMode: "files",
    tr,
    setError,
  });

  const {
    activeTab,
    openFile,
    openAbsoluteFile,
    updateActiveDraft,
    saveActiveFile,
    revertActiveDraft,
    toggleActiveEditMode,
    filesTabsEmpty,
    dirtyPaths,
    closeByPath,
    discardTabId,
    setDiscardTabId,
    closeTabForced,
    conflictTabId,
    setConflictTabId,
    reloadActiveFile,
  } = fileTabs;

  const splitLayout = resolveFilesWorkbenchSplitLayout({ treeVisible });
  // Pathless「文件」chip is a tree-only workspace, not a preview target.
  const previewTab = activePath?.trim() ? activeTab : null;

  useEffect(() => {
    onDirtyPathsChange?.(dirtyPaths);
  }, [dirtyPaths, onDirtyPathsChange]);

  useEffect(() => {
    if (!closePathRequest) return;
    if (lastCloseToken.current === closePathRequest.token) return;
    lastCloseToken.current = closePathRequest.token;
    const closed = closeByPath(closePathRequest.path);
    if (closed) {
      pendingSideClosePath.current = null;
      onClosePathResult?.(closePathRequest.path, true);
    } else {
      // Discard modal open — remember path for confirm.
      pendingSideClosePath.current = closePathRequest.path;
    }
  }, [closePathRequest, closeByPath, onClosePathResult]);

  const loadDir = useCallback(
    async (relative: string): Promise<TreeNode[]> => {
      if (!projectPath || !api.isTauri()) return [];
      try {
        if (sshAlias) {
          const dir = sshRemoteDirToList(projectPath, relative);
          if (!dir) {
            setError(tr("resources.openFailed"));
            return [];
          }
          const listing = await api.sshListDir(sshAlias, dir);
          if (!listing.ok) {
            setError(listing.error || tr("resources.openFailed"));
            return [];
          }
          return (listing.entries || []).map((e) => {
            const rel = relative ? `${relative.replace(/\/+$/, "")}/${e.name}` : e.name;
            const ext = e.isDir
              ? ""
              : (e.name.split(".").pop() || "").toLowerCase();
            return {
              name: e.name,
              relativePath: rel,
              isDir: !!e.isDir,
              size: 0,
              ext,
              children: e.isDir ? [] : undefined,
              loaded: !e.isDir,
            };
          });
        }
        const entries = await api.fsListDir(projectPath, relative);
        return (entries || []).map((e) => ({
          name: e.name,
          relativePath: e.relativePath || e.name,
          isDir: !!e.isDir,
          size: typeof e.size === "number" ? e.size : 0,
          ext: e.ext || "",
          children: e.isDir ? [] : undefined,
          loaded: !e.isDir,
        }));
      } catch (e) {
        setError(String(e));
        return [];
      }
    },
    [projectPath, sshAlias, tr],
  );

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setRoot([]);
      return;
    }
    setLoadingTree(true);
    try {
      setRoot(await loadDir(""));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingTree(false);
    }
  }, [loadDir, projectPath]);

  useEffect(() => {
    void refresh();
    setExpanded(loadTreeExpanded(projectPath || ""));
    setQuery("");
  }, [projectPath]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh on path only

  // Persist expand map when it changes (per project).
  useEffect(() => {
    if (!projectPath) return;
    saveTreeExpanded(projectPath, expanded);
  }, [expanded, projectPath]);

  const { sessionChangeRevisionKey, completedChangeRevisionKey } = useMemo(() => {
    const revisions = sessionChanges.map((change) => {
      const status = change.status.trim().toLowerCase();
      return {
        key: `${change.path}\u001f${change.toolCallId?.trim() || ""}\u001f${status}`,
        status,
      };
    });
    return {
      sessionChangeRevisionKey: sessionChangePathsKey(
        revisions.map((revision) => revision.key),
      ),
      completedChangeRevisionKey: sessionChangePathsKey(
        revisions
          .filter((revision) => revision.status === "completed")
          .map((revision) => revision.key),
      ),
    };
  }, [sessionChanges]);
  const sessionChangeRevisionSeen = useRef("");
  const completedChangeRevisionSeen = useRef("");
  const softRefreshGeneration = useRef(0);
  const expandedRef = useRef(expanded);
  const rootRef = useRef(root);
  expandedRef.current = expanded;
  rootRef.current = root;

  useEffect(() => {
    sessionChangeRevisionSeen.current = "";
    completedChangeRevisionSeen.current = "";
    softRefreshGeneration.current += 1;
  }, [projectPath]);

  const softRefreshTree = useCallback(async () => {
    if (!projectPath) return;
    const generation = ++softRefreshGeneration.current;
    const isCurrent = () => generation === softRefreshGeneration.current;
    const previousRoot = rootRef.current;
    let refreshError: string | null = null;
    try {
      let next = await loadDir("");
      if (!isCurrent()) return;
      const openDirs = Object.entries(expandedRef.current)
        .filter(([, open]) => open)
        .map(([path]) => path)
        .filter(Boolean);
      for (const dir of openDirs) {
        try {
          const children = await loadDir(dir);
          if (!isCurrent()) return;
          next = replaceResourceTreeChildren(next, dir, children);
        } catch (e) {
          if (!isCurrent()) return;
          const find = (nodes: TreeNode[]): TreeNode | undefined => {
            for (const node of nodes) {
              if (node.relativePath === dir) return node;
              const nested = node.children?.length
                ? find(node.children)
                : undefined;
              if (nested) return nested;
            }
            return undefined;
          };
          const previousChildren = find(previousRoot)?.children;
          if (previousChildren) {
            next = replaceResourceTreeChildren(next, dir, previousChildren);
          }
          refreshError = String(e);
        }
      }
      if (!isCurrent()) return;
      if (refreshError) setError(refreshError);
      setRoot(next);
    } catch (e) {
      if (isCurrent()) setError(String(e));
    }
  }, [loadDir, projectPath]);

  useEffect(() => {
    if (!projectPath || !paneActive) return;
    if (sessionChangeRevisionSeen.current === sessionChangeRevisionKey) return;
    sessionChangeRevisionSeen.current = sessionChangeRevisionKey;
    const completedChanged =
      completedChangeRevisionSeen.current !== completedChangeRevisionKey;
    completedChangeRevisionSeen.current = completedChangeRevisionKey;
    if (!completedChanged || !completedChangeRevisionKey) return;
    void softRefreshTree();
  }, [
    sessionChangeRevisionKey,
    completedChangeRevisionKey,
    projectPath,
    paneActive,
    softRefreshTree,
  ]);

  // Focus/open when Side Workbench active file path changes.
  // Directories stay on empty preview; always expand the tree to that path.
  useEffect(() => {
    if (!paneActive || !activePath?.trim()) return;
    const p = activePath.trim();
    let cancelled = false;
    void (async () => {
      const root = (projectPath || "")
        .replace(/[/\\]+$/, "")
        .replace(/\\/g, "/");
      const norm = p.replace(/[/\\]+$/, "").replace(/\\/g, "/");
      if (root && (norm === root || norm === "")) return;

      const rel = root
        ? sshChatRelative(root, norm) ||
          (norm.startsWith(`${root}/`) ? norm.slice(root.length + 1) : norm)
        : norm;
      {
        const top = await loadDir("");
        if (cancelled) return;
        setRoot(top);
      }

      const base = norm.split("/").pop() || norm;
      const looksLikeFile = base.includes(".") && !base.endsWith(".");
      let isDir = false;
      if (!looksLikeFile && api.isTauri()) {
        if (sshAlias) {
          try {
            const listing = await api.sshListDir(sshAlias, norm);
            if (cancelled) return;
            isDir = !!listing.ok;
          } catch {
            /* try as file */
          }
        } else {
          try {
            const classified = await api.pathsClassify([p]);
            if (cancelled) return;
            const entry = classified?.[0];
            if (entry?.exists && entry.isDir) isDir = true;
          } catch {
            /* classify soft-fail → try open as file */
          }
        }
      }

      const dirKeys = expandKeysForResourcePath(rel, { includeSelfIfDir: isDir });
      if (dirKeys.length) {
        setExpanded((e) => {
          const next = { ...e };
          for (const k of dirKeys) next[k] = true;
          return next;
        });
        let loadedRel = "";
        for (const key of dirKeys) {
          if (cancelled) return;
          const kids = await loadDir(key);
          if (cancelled) return;
          setRoot((r) => replaceResourceTreeChildren(r, key, kids));
          loadedRel = key;
        }
        void loadedRel;
      }

      if (cancelled || isDir) return;
      void openAbsoluteFile(p, undefined, {
        line: activeLine,
        column: activeColumn,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [activePath, activeLine, activeColumn, paneActive, projectPath, sshAlias]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDir = useCallback(
    async (node: TreeNode) => {
      const key = node.relativePath;
      const isOpen = !!expanded[key];
      if (isOpen) {
        setExpanded((e) => {
          const n = { ...e };
          delete n[key];
          return n;
        });
        return;
      }
      setExpanded((e) => ({ ...e, [key]: true }));
      if (!node.loaded) {
        try {
          const kids = await loadDir(node.relativePath);
          setRoot((r) => replaceResourceTreeChildren(r, key, kids));
        } catch (e) {
          setError(String(e));
        }
      }
    },
    [expanded, loadDir],
  );

  const filteredRoot = useMemo(
    () => filterResourceTreeNodes(root, query) as TreeNode[],
    [root, query],
  );

  const displayExpanded = useMemo(() => {
    if (!query.trim()) return expanded;
    const force = expandKeysForResourceTreeFilter(root, query);
    return mergeTreeExpandedForFilter(expanded, force);
  }, [expanded, query, root]);

  const onTreeFileClick = useCallback(
    async (relativePath: string, name: string) => {
      // Opening a file never flips tree off — split stays preview | tree.
      await openFile(relativePath);
      onFileOpen?.(relativePath, name || pathBaseName(relativePath));
    },
    [openFile, onFileOpen],
  );

  const visibleRows = useMemo(
    () => flattenVisibleResourceTree(filteredRoot, displayExpanded),
    [filteredRoot, displayExpanded],
  );
  const selectedTreeKey =
    activeTab?.relativePath || activeTab?.absolutePath || null;

  // Tree resize — persist final width via functional update (no stale width).
  useEffect(() => {
    if (!resizingTree) return;
    const onMove = (e: PointerEvent) => {
      const el = splitRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Tree is on the right; width from pointer to right edge.
      const next = clampTreeWidth(rect.right - e.clientX, rect.width);
      setTreeWidth(next);
    };
    const onUp = () => {
      setResizingTree(false);
      setTreeWidth((w) => {
        const box = splitRef.current?.getBoundingClientRect();
        return persistTreeWidth(w, box?.width ?? 800);
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizingTree]);

  const absPath =
    previewTab?.absolutePath ||
    (projectPath && previewTab?.relativePath
      ? `${projectPath.replace(/\/$/, "")}/${previewTab.relativePath.replace(/^\//, "")}`
      : projectPath);

  const crumbs = useMemo(() => {
    const rel = previewTab?.relativePath || "";
    if (!rel) return [] as string[];
    return rel.replace(/\\/g, "/").split("/").filter(Boolean);
  }, [previewTab?.relativePath]);

  const previewDirty = isResourceDraftDirty(
    previewTab?.draftText,
    previewTab?.baselineText,
  );
  const canReloadPreview =
    !!previewTab &&
    previewTab.tabKind !== "url" &&
    !previewTab.loading &&
    !previewDirty;

  if (!projectPath) {
    return (
      <div className="sw-files" data-testid="files-workspace">
        <div className="rp__empty-state">
          <div className="rp__empty-title">{tr("main.noProject")}</div>
          <div className="rp__empty-desc">{tr("resources.needProject")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="sw-files rp--embedded" data-testid="files-workspace">
      {/* Row 2 (image-5/6): crumbs LEFT · tree + 打开 RIGHT */}
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
              previewDirty ? tr("resources.unsaved") : tr("resources.refresh")
            }
          >
            <button
              type="button"
              className="chrome-btn"
              aria-label={
                previewDirty ? tr("resources.unsaved") : tr("resources.refresh")
              }
              data-testid="files-reload"
              disabled={!canReloadPreview}
              onClick={() => {
                if (!canReloadPreview) return;
                void reloadActiveFile();
              }}
            >
              <IconRefresh size={16} />
            </button>
          </Tip>
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
                "chrome-btn main__pane-toggle" + (treeVisible ? " is-on" : "")
              }
              aria-label={
                treeVisible
                  ? tr("resources.collapseTree")
                  : tr("resources.expandTree")
              }
              data-testid="files-tree-toggle"
              onClick={() => onTreeVisibleChange(!treeVisible)}
            >
              <IconListTree size={16} />
            </button>
          </Tip>
          {absPath ? (
            <OpenLocationButton
              path={absPath}
              line={activeTab?.focusLine ?? activeLine}
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

      {error ? (
        <div className="rp__error" role="alert">
          {error}
        </div>
      ) : null}

      <div
        ref={splitRef}
        className={
          "rp-split" +
          (splitLayout.mode === "solo" ? " rp-split--solo" : "") +
          (resizingTree ? " is-resizing" : "")
        }
        data-split-mode={splitLayout.mode}
      >
        <div className="rp-split__preview">
          {(() => {
            // Directory / failed "not a file" → empty placeholder, not an error wall.
            const isDirOpenError =
              !!previewTab?.error &&
              /not a file/i.test(previewTab.error);
            const emptyPres = filesTabsEmpty;
            const showEmpty =
              !previewTab ||
              isDirOpenError ||
              (!previewTab.loading && !previewTab.preview && !previewTab.error);
            if (showEmpty && !previewTab?.loading) {
              return (
                <div
                  className="rp__empty-state"
                  data-testid="files-preview-empty"
                >
                  <div className="rp__empty-title">
                    {tr(emptyPres?.titleKey ?? "resources.emptyPreview")}
                  </div>
                  <div className="rp__empty-desc">
                    {tr(emptyPres?.hintKey ?? "resources.emptyPreviewHint")}
                  </div>
                </div>
              );
            }
            if (previewTab?.loading) {
              return (
                <div className="rp__empty-state">
                  <div className="rp__empty-desc">{tr("resources.loading")}</div>
                </div>
              );
            }
            return (
              <ResourcePreviewBody
                tr={tr}
                locale={locale as Locale}
                sideMode="files"
                diffView={null}
                diffLayout="unified"
                setDiffLayout={NOOP as (v: "unified" | "split") => void}
                activeTab={previewTab as FileTab}
                projectPath={projectPath}
                pathCopyFlash={false}
                diffDecisionByPath={{}}
                restorableAfterByPath={{}}
                diffActionBusy={false}
                diffHunks={[]}
                remainingHunkCount={0}
                setDiffCommentError={NOOP}
                setDiffCommentNote={NOOP}
                setDiffCommentTarget={NOOP}
                openChangeInEditor={NOOP}
                openChangeInPane={NOOP}
                revealChangePath={NOOP}
                copyChangePath={NOOP}
                updateActiveDraft={updateActiveDraft}
                saveActiveFile={saveActiveFile}
                revertActiveDraft={revertActiveDraft}
                toggleActiveEditMode={toggleActiveEditMode}
                runAcceptFile={NOOP_ASYNC}
                requestRejectFile={NOOP}
                runRestoreFile={NOOP_ASYNC}
                runAcceptHunk={NOOP_ASYNC}
                runRejectHunk={NOOP_ASYNC}
                requestBatchAcceptHunks={NOOP}
                requestBatchRejectHunks={NOOP}
              />
            );
          })()}
        </div>
        {splitLayout.mode === "split" ? (
          <>
            <div
              className="rp-split__resizer"
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={treeWidth}
              aria-label={tr("resources.resizeTree")}
              onPointerDown={(e) => {
                e.preventDefault();
                setResizingTree(true);
              }}
            />
            <div
              className="rp-split__tree"
              style={{
                width: treeWidth,
                flex: `0 0 ${Math.max(TREE_WIDTH_MIN, treeWidth)}px`,
                maxWidth: treeWidth,
              }}
              data-testid="files-tree"
            >
              <div className="rp-tree-search">
                <IconSearch size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr("resources.filterPh")}
                  aria-label={tr("resources.filterPh")}
                />
              </div>
              <OverlayScroll className="rp-tree-scroll">
                {loadingTree ? (
                  <div className="rp__empty-desc" style={{ padding: 12 }}>
                    {tr("resources.loading")}
                  </div>
                ) : filteredRoot.length === 0 ? (
                  <div className="rp__empty-desc" style={{ padding: 12 }}>
                    {query.trim()
                      ? tr("resources.filterEmpty")
                      : tr("resources.empty")}
                  </div>
                ) : (
                  <VirtualList
                    items={visibleRows}
                    getKey={(row) => row.node.relativePath || row.node.name}
                    rowHeight={RESOURCE_TREE_ROW_HEIGHT_PX}
                    threshold={RESOURCE_TREE_VIRTUALIZE_THRESHOLD}
                    scrollToKey={selectedTreeKey}
                    renderItem={(row) => {
                      const n = row.node;
                      const open = !!displayExpanded[n.relativePath];
                      const selected =
                        !!activeTab &&
                        (activeTab.relativePath === n.relativePath ||
                          activeTab.absolutePath === n.relativePath);
                      return (
                        <button
                          type="button"
                          className={
                            "rp-tree__row" + (selected ? " is-selected" : "")
                          }
                          style={{ paddingLeft: 8 + row.depth * 12 }}
                          onClick={() => {
                            if (n.isDir) void toggleDir(n);
                            else void onTreeFileClick(n.relativePath, n.name);
                          }}
                        >
                          <span className="rp-tree__chev">
                            {n.isDir ? (
                              open ? (
                                <IconChevronDown size={14} />
                              ) : (
                                <IconChevronRight size={14} />
                              )
                            ) : (
                              <span className="rp-tree__gap" />
                            )}
                          </span>
                          <FileKindMark name={n.name} isDir={n.isDir} />
                          <span className="rp-tree__name">{n.name}</span>
                        </button>
                      );
                    }}
                  />
                )}
              </OverlayScroll>
            </div>
          </>
        ) : null}
      </div>

      <GlassModal
        open={!!discardTabId}
        onClose={() => {
          const sidePath = pendingSideClosePath.current;
          setDiscardTabId(null);
          pendingSideClosePath.current = null;
          if (sidePath) onClosePathResult?.(sidePath, false);
        }}
        title={tr("resources.discardTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                const sidePath = pendingSideClosePath.current;
                setDiscardTabId(null);
                pendingSideClosePath.current = null;
                if (sidePath) onClosePathResult?.(sidePath, false);
              }}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                const id = discardTabId;
                const sidePath = pendingSideClosePath.current;
                setDiscardTabId(null);
                pendingSideClosePath.current = null;
                if (id) closeTabForced(id);
                if (sidePath) onClosePathResult?.(sidePath, true);
              }}
            >
              {tr("resources.discardConfirm")}
            </button>
          </>
        }
      >
        <p className="modal__body-text">{tr("resources.discardBody")}</p>
      </GlassModal>

      <GlassModal
        open={!!conflictTabId}
        onClose={() => setConflictTabId(null)}
        title={tr("resources.conflictTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setConflictTabId(null);
                void reloadActiveFile();
              }}
            >
              {tr("resources.conflictReload")}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setConflictTabId(null);
                void saveActiveFile({ force: true });
              }}
            >
              {tr("resources.conflictOverwrite")}
            </button>
          </>
        }
      >
        <p className="modal__body-text">{tr("resources.conflictBody")}</p>
      </GlassModal>
    </div>
  );
}
