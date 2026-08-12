/**
 * Files workbench (Phase 1): dual-row chrome under shared SideTabBar —
 * breadcrumb + tree toggle +「打开」; one shared tree; multi-file preview
 * driven by parent SideTab file paths.
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
import { createT, type Locale } from "@/i18n";
import { detectAppPlatform, revealInOsLabel } from "@/lib/appPlatform";
import {
  IconChevronDown,
  IconChevronRight,
  IconListTree,
  IconSearch,
} from "@/components/icons";
import { OpenLocationButton } from "@/components/OpenLocationButton";
import { OverlayScroll } from "@/components/OverlayScroll";
import { Tip } from "@/components/ui/tooltip";
import { FileKindMark } from "@/components/resource-viewer/FileKindMark";
import { ResourcePreviewBody } from "@/components/resource-viewer/ResourcePreviewBody";
import {
  clampTreeWidth,
  loadTreeWidth,
  TREE_WIDTH_KEY,
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
import { pathBaseName } from "@/lib/sessionChanges";

export type FilesWorkspaceProps = {
  locale: Locale | string;
  projectPath: string | null;
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
  paneActive?: boolean;
};

const NOOP = () => {};
const NOOP_ASYNC = async () => {};

export function FilesWorkspace({
  locale,
  projectPath,
  projectName,
  treeVisible,
  onTreeVisibleChange,
  activePath,
  activeLine = null,
  activeColumn = null,
  onFileOpen,
  paneActive = true,
}: FilesWorkspaceProps) {
  const tr = useMemo(() => createT(locale as Locale), [locale]);
  const [root, setRoot] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ "": true });
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [treeWidth, setTreeWidth] = useState(loadTreeWidth);
  const [resizingTree, setResizingTree] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
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
  } = fileTabs;

  const loadDir = useCallback(
    async (relative: string): Promise<TreeNode[]> => {
      if (!projectPath || !api.isTauri()) return [];
      try {
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
    [projectPath],
  );

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setRoot([]);
      return;
    }
    setLoadingTree(true);
    const nodes = await loadDir("");
    setRoot(nodes);
    setLoadingTree(false);
  }, [loadDir, projectPath]);

  useEffect(() => {
    void refresh();
    setExpanded({ "": true });
    setQuery("");
  }, [projectPath]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh on path only

  // Focus/open when Side Workbench active file path changes.
  // Directories (project root / folder tab) stay on empty preview — never "not a file".
  useEffect(() => {
    if (!paneActive || !activePath?.trim()) return;
    const p = activePath.trim();
    let cancelled = false;
    void (async () => {
      const root = (projectPath || "")
        .replace(/[/\\]+$/, "")
        .replace(/\\/g, "/");
      const norm = p.replace(/[/\\]+$/, "").replace(/\\/g, "/");
      // Bound project folder itself → tree only, no preview tab.
      if (root && (norm === root || norm === "")) return;

      // Skip dir-check IPC when path has a clear file extension (chat cards).
      // Full classify only for extension-less names that might be folders.
      const base = norm.split("/").pop() || norm;
      const looksLikeFile = base.includes(".") && !base.endsWith(".");
      if (!looksLikeFile && api.isTauri()) {
        try {
          const classified = await api.pathsClassify([p]);
          if (cancelled) return;
          const entry = classified?.[0];
          if (entry?.exists && entry.isDir) {
            // Folder targets: leave preview empty ("请选择文件"); expand tree later if needed.
            return;
          }
        } catch {
          /* classify soft-fail → try open as file */
        }
      }
      if (cancelled) return;
      // Prefer absolute open (handles chat paths); falls back internally.
      void openAbsoluteFile(p, undefined, {
        line: activeLine,
        column: activeColumn,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [activePath, activeLine, activeColumn, paneActive, projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const kids = await loadDir(node.relativePath);
        const mark = (list: TreeNode[]): TreeNode[] =>
          list.map((n) => {
            if (n.relativePath === key) {
              return { ...n, children: kids, loaded: true };
            }
            if (n.children?.length) {
              return { ...n, children: mark(n.children) };
            }
            return n;
          });
        setRoot((r) => mark(r));
      }
    },
    [expanded, loadDir],
  );

  const filterMatch = useCallback(
    (n: TreeNode): boolean => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      if (n.name.toLowerCase().includes(q)) return true;
      if (n.relativePath.toLowerCase().includes(q)) return true;
      if (n.isDir && n.children?.length) {
        return n.children.some(filterMatch);
      }
      return false;
    },
    [query],
  );

  const onTreeFileClick = useCallback(
    async (relativePath: string, name: string) => {
      await openFile(relativePath);
      onFileOpen?.(relativePath, name || pathBaseName(relativePath));
    },
    [openFile, onFileOpen],
  );

  const renderTree = (nodes: TreeNode[], depth: number): ReactNode =>
    nodes.filter(filterMatch).map((n) => {
      const open = !!expanded[n.relativePath];
      const selected =
        activeTab &&
        (activeTab.relativePath === n.relativePath ||
          activeTab.absolutePath === n.relativePath);
      return (
        <div key={n.relativePath}>
          <button
            type="button"
            className={
              "rp-tree__row" + (selected ? " is-selected" : "")
            }
            style={{ paddingLeft: 8 + depth * 12 }}
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
          {n.isDir && open && n.children?.length ? (
            <div className="rp-tree__kids">
              {renderTree(n.children, depth + 1)}
            </div>
          ) : null}
        </div>
      );
    });

  // Tree resize
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
      try {
        localStorage.setItem(TREE_WIDTH_KEY, String(treeWidth));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizingTree, treeWidth]);

  const absPath =
    activeTab?.absolutePath ||
    (projectPath && activeTab?.relativePath
      ? `${projectPath.replace(/\/$/, "")}/${activeTab.relativePath.replace(/^\//, "")}`
      : projectPath);

  const crumbs = useMemo(() => {
    const rel = activeTab?.relativePath || "";
    if (!rel) return [] as string[];
    return rel.replace(/\\/g, "/").split("/").filter(Boolean);
  }, [activeTab?.relativePath]);

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
          (treeVisible ? "" : " rp-split--solo") +
          (resizingTree ? " is-resizing" : "")
        }
      >
        <div className="rp-split__preview">
          {(() => {
            // Directory / failed "not a file" → empty placeholder, not an error wall.
            const isDirOpenError =
              !!activeTab?.error &&
              /not a file/i.test(activeTab.error);
            const showEmpty =
              !activeTab || isDirOpenError || (!activeTab.loading && !activeTab.preview && !activeTab.error);
            if (showEmpty && !activeTab?.loading) {
              return (
                <div
                  className="rp__empty-state"
                  data-testid="files-preview-empty"
                >
                  <div className="rp__empty-title">
                    {tr("resources.preview")}
                  </div>
                  <div className="rp__empty-desc">
                    {tr("resources.emptyPreviewHint")}
                  </div>
                </div>
              );
            }
            if (activeTab?.loading) {
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
                activeTab={activeTab as FileTab}
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
        {treeVisible ? (
          <>
            <div
              className="rp-split__resizer"
              role="separator"
              aria-orientation="vertical"
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
                ) : root.length === 0 ? (
                  <div className="rp__empty-desc" style={{ padding: 12 }}>
                    {tr("resources.empty")}
                  </div>
                ) : (
                  renderTree(root, 0)
                )}
              </OverlayScroll>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
