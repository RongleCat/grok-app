/**
 * Review tab — Codex-style multi-file stacked diffs + side file tree.
 * Bulk-loads workspace git diffs in one IPC; session before/after is free.
 * Right-tree click scrolls the left stack to the matching file block.
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
import {
  IconArrowsMinimize,
  IconCode,
  IconCopy,
  IconEye,
  IconFolder,
  IconListTree,
  IconMore,
  IconRefresh,
  IconSearch,
  IconSideExpand,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import {
  buildUnifiedDiff,
  normalizePath,
  pathBaseName,
  pathRelativeToProject,
  sessionFileLineDelta,
  type SessionFileChange,
} from "@/lib/sessionChanges";
import {
  buildReviewTree,
  countPatchDelta,
  decodeGitPath,
  parseReviewPatch,
  reviewFileBadge,
  truncateMiddle,
  type ReviewDiffRow,
  type ReviewTreeNode,
} from "@/lib/reviewDiff";
import {
  classifyWorkspaceGitUnavailable,
  countWorkspaceKinds,
  filterEntriesByKind,
  normalizeChangesKindFilter,
  presentWorkspaceKindFilters,
  resolveReviewEmptyState,
  shouldShowKindFilters,
  type ChangesKindFilter,
  type WorkspaceGitUnavailableKind,
} from "@/lib/resourceChangesHonesty";
import {
  formatOpenEditorErrorMessage,
  isOsOpenTarget,
  planOpenInEditor,
  readOpenTargetStorage,
  resolveOpenEditorError,
} from "@/lib/openEditorHonesty";
import type { WorkspaceGitFile, WorkspaceGitKind } from "@/lib/workspaceGit";
import type { MessageKey } from "@/i18n";

export type ReviewTabProps = {
  locale: Locale | string;
  projectPath?: string | null;
  sessionChanges?: SessionFileChange[];
  isGitProject?: boolean;
  /** Open a workspace file in a side file tab (eye icon). */
  onOpenFile?: (path: string, name: string) => void;
};

type ReviewScope = "all" | "session" | "workspace";

type ReviewFileEntry = {
  key: string;
  relPath: string;
  path: string;
  name: string;
  source: "session" | "workspace" | "both";
  kind?: string;
  added: number;
  removed: number;
  /** Unified patch text when known. */
  patch: string | null;
  binary: boolean;
  loading: boolean;
  error: string | null;
  session?: SessionFileChange;
};

type BundleMeta = {
  branch: string | null;
  upstream: string | null;
  totalAdded: number;
  totalRemoved: number;
};

const INITIAL_EXPAND = 4;
/** Cap rendered change lines per file before "show more". */
const LINE_CAP = 320;

function sessionRel(
  change: SessionFileChange,
  projectPath: string | null | undefined,
): string {
  return (
    pathRelativeToProject(change.path, projectPath) ||
    normalizePath(change.path) ||
    change.name
  );
}

function ReviewKindChip({ name }: { name: string }) {
  const b = reviewFileBadge(name);
  return (
    <span className={`sw-review-chip sw-review-chip--${b.tone}`} aria-hidden>
      {b.label}
    </span>
  );
}

function DiffRows({
  rows,
  lineCap,
  showAll,
  onShowAll,
  showAllLabel,
  unmodifiedLabel,
}: {
  rows: ReviewDiffRow[];
  lineCap: number;
  showAll: boolean;
  onShowAll: () => void;
  showAllLabel: string;
  unmodifiedLabel: (n: number) => string;
}) {
  let lineCount = 0;
  const out: ReactNode[] = [];
  for (const row of rows) {
    if (row.type === "fold") {
      out.push(
        <div key={row.id} className="sw-review-fold" role="presentation">
          <span className="sw-review-fold__chev" aria-hidden>
            ▴
          </span>
          <span>{unmodifiedLabel(row.count)}</span>
          <span className="sw-review-fold__chev" aria-hidden>
            ▾
          </span>
        </div>,
      );
      continue;
    }
    lineCount++;
    if (!showAll && lineCount > lineCap) continue;
    const cls =
      row.kind === "add"
        ? "sw-review-line sw-review-line--add"
        : row.kind === "del"
          ? "sw-review-line sw-review-line--del"
          : "sw-review-line sw-review-line--ctx";
    out.push(
      <div key={`L${lineCount}-${row.ln ?? ""}-${row.kind}`} className={cls}>
        <span className="sw-review-line__ln" aria-hidden>
          {row.ln ?? ""}
        </span>
        <span className="sw-review-line__code">{row.text}</span>
      </div>,
    );
  }
  if (!showAll && lineCount > lineCap) {
    out.push(
      <button
        key="more"
        type="button"
        className="sw-review-more"
        onClick={onShowAll}
      >
        {showAllLabel}
      </button>,
    );
  }
  return <>{out}</>;
}

function TreeNodes({
  nodes,
  depth,
  selectedKey,
  collapsedDirs,
  onToggleDir,
  onSelect,
  onOpenFile,
  openFileLabel,
}: {
  nodes: ReviewTreeNode[];
  depth: number;
  selectedKey: string | null;
  collapsedDirs: Set<string>;
  onToggleDir: (id: string) => void;
  onSelect: (key: string) => void;
  onOpenFile?: (path: string, name: string) => void;
  openFileLabel: string;
}) {
  return (
    <>
      {nodes.map((n) => {
        if (n.isDir) {
          const open = !collapsedDirs.has(n.id);
          return (
            <div key={n.id} className="sw-review-tree__dir">
              <button
                type="button"
                className="sw-review-tree__row sw-review-tree__row--dir"
                style={{ paddingLeft: 8 + depth * 12 }}
                onClick={() => onToggleDir(n.id)}
                title={n.path}
              >
                <span className="sw-review-tree__chev" aria-hidden>
                  {open ? "▾" : "▸"}
                </span>
                <span className="sw-review-tree__name">{n.name}</span>
                <span className="sw-review-tree__dot" aria-hidden />
              </button>
              {open && n.children?.length ? (
                <TreeNodes
                  nodes={n.children}
                  depth={depth + 1}
                  selectedKey={selectedKey}
                  collapsedDirs={collapsedDirs}
                  onToggleDir={onToggleDir}
                  onSelect={onSelect}
                  onOpenFile={onOpenFile}
                  openFileLabel={openFileLabel}
                />
              ) : null}
            </div>
          );
        }
        const selected = n.fileKey === selectedKey;
        // Codex reference: orange dot for dirty files; U / + for untracked / added.
        const kind = (n.kind || "").toLowerCase();
        const isNew = kind === "untracked" || kind === "added";
        return (
          <div
            key={n.id}
            className={
              "sw-review-tree__row" + (selected ? " is-selected" : "")
            }
            style={{ paddingLeft: 8 + depth * 12 }}
            data-testid={`review-tree-file-${n.fileKey}`}
          >
            <button
              type="button"
              className="sw-review-tree__row-main"
              onClick={() => n.fileKey && onSelect(n.fileKey)}
              title={n.path}
              style={{
                appearance: "none",
                border: 0,
                background: "transparent",
                color: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                minWidth: 0,
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
                font: "inherit",
              }}
            >
              <span className="sw-review-tree__chev sw-review-tree__chev--spacer" />
              <ReviewKindChip name={n.name} />
              <span className="sw-review-tree__name">
                {truncateMiddle(n.name, 22)}
              </span>
            </button>
            {isNew ? (
              <span
                className="sw-review-tree__status is-add"
                aria-hidden
                title={kind}
              >
                {kind === "untracked" ? "U" : "+"}
              </span>
            ) : (
              <span className="sw-review-tree__dot" aria-hidden />
            )}
            {onOpenFile ? (
              <button
                type="button"
                className="sw-review-tree__eye"
                title={openFileLabel}
                aria-label={openFileLabel}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFile(n.path, n.name);
                }}
              >
                <IconEye size={13} />
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function ReviewTab({
  locale,
  projectPath,
  sessionChanges = [],
  isGitProject = false,
  onOpenFile,
}: ReviewTabProps) {
  const tr = useMemo(() => createT(locale as Locale), [locale]);
  const [scope, setScope] = useState<ReviewScope>("all");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [expandAll, setExpandAll] = useState(false);
  const [showAllLines, setShowAllLines] = useState<Set<string>>(() => new Set());
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(
    () => new Set(),
  );
  const [files, setFiles] = useState<ReviewFileEntry[]>([]);
  const [bundle, setBundle] = useState<BundleMeta>({
    branch: null,
    upstream: null,
    totalAdded: 0,
    totalRemoved: 0,
  });
  const [loading, setLoading] = useState(false);
  const [loadErrorKind, setLoadErrorKind] =
    useState<WorkspaceGitUnavailableKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<ChangesKindFilter>("all");
  const [moreOpen, setMoreOpen] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const stackRef = useRef<HTMLDivElement>(null);
  const fileEls = useRef<Map<string, HTMLElement>>(new Map());
  const loadSeq = useRef(0);
  const scopeMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  const buildSessionEntries = useCallback((): ReviewFileEntry[] => {
    return sessionChanges.map((c) => {
      const rel = decodeGitPath(sessionRel(c, projectPath));
      const delta = sessionFileLineDelta(c);
      let patch: string | null = null;
      if (typeof c.before === "string" && typeof c.after === "string") {
        patch = buildUnifiedDiff(rel || c.name, c.before, c.after);
      } else if (typeof c.after === "string" && c.before == null) {
        patch = buildUnifiedDiff(rel || c.name, "", c.after);
      }
      const fromPatch = patch ? countPatchDelta(patch) : null;
      const name = decodeGitPath(c.name || pathBaseName(rel));
      return {
        key: `s:${rel.toLowerCase()}`,
        relPath: rel,
        path: normalizePath(c.path) || rel,
        name,
        source: "session" as const,
        kind: "modified",
        added: delta?.added ?? fromPatch?.added ?? 0,
        removed: delta?.removed ?? fromPatch?.removed ?? 0,
        patch,
        binary: false,
        loading: false,
        error: null,
        session: c,
      };
    });
  }, [sessionChanges, projectPath]);

  const refresh = useCallback(async () => {
    const seq = ++loadSeq.current;
    const path = (projectPath || "").trim();
    setLoading(true);
    setLoadErrorKind(null);

    const sessionEntries = buildSessionEntries();
    const byRel = new Map<string, ReviewFileEntry>();

    const includeSession = scope === "all" || scope === "session";
    const includeWorkspace = scope === "all" || scope === "workspace";

    if (includeSession) {
      for (const e of sessionEntries) {
        byRel.set(e.relPath.toLowerCase(), { ...e });
      }
    }

    let meta: BundleMeta = {
      branch: null,
      upstream: null,
      totalAdded: 0,
      totalRemoved: 0,
    };
    let nextLoadError: WorkspaceGitUnavailableKind | null = null;

    if (includeWorkspace && path && api.isTauri()) {
      try {
        const res = await api.gitReviewBundle(path);
        if (seq !== loadSeq.current) return;
        if (res?.available) {
          meta = {
            branch: res.branch ?? null,
            upstream: res.upstream ?? null,
            totalAdded: res.totalAdded ?? 0,
            totalRemoved: res.totalRemoved ?? 0,
          };
          for (const f of res.files ?? []) {
            const rel =
              decodeGitPath(normalizePath(f.path) || f.name || "") ||
              decodeGitPath(f.name || "");
            if (!rel) continue;
            const key = rel.toLowerCase();
            const existing = byRel.get(key);
            const name =
              decodeGitPath(f.name || "") || pathBaseName(rel);
            const entry: ReviewFileEntry = {
              key: existing?.key ?? `w:${key}`,
              relPath: rel,
              path:
                normalizePath(f.absolutePath) ||
                (projectPath
                  ? `${normalizePath(projectPath)}/${rel}`
                  : rel),
              name,
              source: existing ? "both" : "workspace",
              kind: f.kind,
              added: f.added ?? 0,
              removed: f.removed ?? 0,
              // Prefer session payload when present (agent-local edit).
              patch:
                existing?.patch && existing.patch.trim()
                  ? existing.patch
                  : f.diff ?? null,
              binary: !!f.binary,
              loading: false,
              error: null,
              session: existing?.session,
            };
            if (existing?.patch && existing.patch.trim()) {
              const d = countPatchDelta(existing.patch);
              entry.added = d.added;
              entry.removed = d.removed;
            }
            byRel.set(key, entry);
          }
        } else {
          nextLoadError = classifyWorkspaceGitUnavailable({
            projectPath: path,
            isTauri: true,
            available: false,
            reason: res?.reason ?? "unavailable",
          });
        }
      } catch (e) {
        nextLoadError = classifyWorkspaceGitUnavailable({
          projectPath: path,
          isTauri: true,
          available: false,
          reason: String(e),
        });
      }
    } else if (includeWorkspace && path && !api.isTauri()) {
      nextLoadError = "host_only";
    } else if (includeWorkspace && !path) {
      nextLoadError = "no_project";
    }

    if (seq !== loadSeq.current) return;
    setLoadErrorKind(nextLoadError);

    const list = Array.from(byRel.values()).sort((a, b) =>
      a.relPath.localeCompare(b.relPath),
    );

    // Recompute totals from visible list when scope filters session-only etc.
    if (scope !== "workspace" || !meta.totalAdded) {
      let a = 0;
      let r = 0;
      for (const f of list) {
        a += f.added;
        r += f.removed;
      }
      meta = { ...meta, totalAdded: a, totalRemoved: r };
    }

    setBundle(meta);
    setFiles(list);
    setLoading(false);

    // Default expand first few files; preserve open keys that still exist.
    setExpanded((prev) => {
      if (prev.size > 0) {
        const next = new Set<string>();
        for (const k of prev) {
          if (list.some((f) => f.key === k)) next.add(k);
        }
        if (next.size > 0) return next;
      }
      return new Set(list.slice(0, INITIAL_EXPAND).map((f) => f.key));
    });

    setSelectedKey((cur) => {
      if (cur && list.some((f) => f.key === cur)) return cur;
      return list[0]?.key ?? null;
    });
  }, [projectPath, scope, buildSessionEntries]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Close menus on outside click
  useEffect(() => {
    if (!scopeOpen && !moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (scopeOpen && !scopeMenuRef.current?.contains(t)) {
        setScopeOpen(false);
      }
      if (moreOpen && !moreMenuRef.current?.contains(t)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [scopeOpen, moreOpen]);

  const selectedFile = useMemo(
    () => files.find((f) => f.key === selectedKey) ?? null,
    [files, selectedKey],
  );

  const copySelectedPath = useCallback(async () => {
    const p = selectedFile?.path || selectedFile?.relPath;
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
    } catch {
      /* soft-fail */
    }
  }, [selectedFile]);

  const revealSelected = useCallback(async () => {
    const p = selectedFile?.path;
    if (!p || !api.isTauri()) return;
    try {
      await api.pathReveal(p);
    } catch {
      /* soft-fail */
    }
  }, [selectedFile]);

  const openSelectedInEditor = useCallback(async () => {
    const p = selectedFile?.path;
    if (!p) return;
    const preferred = readOpenTargetStorage("finder");
    const editorId = isOsOpenTarget(preferred) ? null : preferred;
    const plan = planOpenInEditor({
      path: p,
      editorId,
      isTauri: api.isTauri(),
    });
    if (!plan.ok) {
      if (plan.kind === "cancelled") return;
      setActionError(tr(plan.messageKey as MessageKey));
      return;
    }
    try {
      await api.openInEditor({
        path: plan.path,
        editor: plan.editorId ?? undefined,
      });
      setActionError(null);
    } catch (e) {
      const resolved = resolveOpenEditorError(e);
      if (resolved.silent) return;
      setActionError(formatOpenEditorErrorMessage(resolved, tr));
    }
  }, [selectedFile, tr]);

  const openFilePreview = useCallback(
    (path: string, name: string) => {
      if (!onOpenFile) return;
      const hit = files.find(
        (f) => f.relPath === path || f.path === path || f.name === name,
      );
      onOpenFile(hit?.path || path, name || pathBaseName(path));
    },
    [onOpenFile, files],
  );

  const q = filter.trim().toLowerCase();
  const kindCounts = useMemo(() => {
    // Reuse workspace counter shape for review kinds.
    const asWorkspace: WorkspaceGitFile[] = files.map((f) => ({
      path: f.relPath,
      absolutePath: f.path,
      status: "  ",
      indexStatus: " ",
      worktreeStatus: " ",
      kind: (f.kind || "modified") as WorkspaceGitKind,
      name: f.name,
    }));
    return countWorkspaceKinds(asWorkspace);
  }, [files]);
  const showKinds = shouldShowKindFilters(kindCounts);
  const presentKinds = useMemo(
    () => presentWorkspaceKindFilters(kindCounts, kindFilter),
    [kindCounts, kindFilter],
  );

  const visibleFiles = useMemo(() => {
    let list = filterEntriesByKind(files, kindFilter);
    if (!q) return list;
    return list.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.relPath.toLowerCase().includes(q),
    );
  }, [files, q, kindFilter]);

  const emptyState = useMemo(
    () =>
      resolveReviewEmptyState({
        isGitProject,
        sessionCount: sessionChanges.length,
        projectPath,
        loading,
        loadErrorKind,
        fileCount: files.length,
        visibleCount: visibleFiles.length,
        hasActiveFilter: !!q || kindFilter !== "all",
      }),
    [
      isGitProject,
      sessionChanges.length,
      projectPath,
      loading,
      loadErrorKind,
      files.length,
      visibleFiles.length,
      q,
      kindFilter,
    ],
  );

  const tree = useMemo(
    () =>
      buildReviewTree(
        visibleFiles.map((f) => ({
          key: f.key,
          relPath: f.relPath,
          name: f.name,
          added: f.added,
          removed: f.removed,
          kind: f.kind,
          binary: f.binary,
        })),
      ),
    [visibleFiles],
  );

  /** Parse only expanded files once per patch identity (avoid re-parse on scroll). */
  const parsedByKey = useMemo(() => {
    const m = new Map<string, ReturnType<typeof parseReviewPatch>>();
    for (const f of visibleFiles) {
      if (!expanded.has(f.key) || !f.patch) continue;
      m.set(f.key, parseReviewPatch(f.patch));
    }
    return m;
    // expanded is a Set — stringify keys for stable dep
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate Set key snapshot
  }, [visibleFiles, Array.from(expanded).join("|")]);

  const scrollToFile = useCallback((key: string) => {
    setSelectedKey(key);
    setExpanded((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    // rAF so expand layout settles before scroll
    requestAnimationFrame(() => {
      const el = fileEls.current.get(key);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setExpandAll(true);
    setExpanded(new Set(files.map((f) => f.key)));
  }, [files]);

  const handleCollapseAll = useCallback(() => {
    setExpandAll(false);
    setExpanded(new Set());
  }, []);

  const toggleDir = useCallback((id: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const scopeLabel =
    scope === "session"
      ? tr("side.review.scopeSession")
      : scope === "workspace"
        ? tr("side.review.scopeWorkspace")
        : tr("side.review.scopeAll");

  const allDiffsOpen =
    expandAll || (files.length > 0 && expanded.size >= files.length);
  const expandAllLabel = allDiffsOpen
    ? tr("side.review.collapseAll")
    : tr("side.review.expandAll");

  if (emptyState.kind === "not_git") {
    return (
      <div className="sw-review" data-testid="side-review-tab">
        <div
          className="rp__empty-state"
          data-testid="review-empty"
          data-empty-kind="not_git"
        >
          <div className="rp__empty-title">{tr(emptyState.titleKey as MessageKey)}</div>
          {emptyState.hintKey ? (
            <div className="rp__empty-desc">
              {tr(emptyState.hintKey as MessageKey)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="sw-review" data-testid="side-review-tab">
      {actionError ? (
        <div className="rp__error" role="alert" data-testid="review-action-error">
          {actionError}
          <button
            type="button"
            className="chrome-btn"
            aria-label={tr("common.dismiss")}
            onClick={() => setActionError(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      <div className="sw-review__header" data-testid="review-toolbar">
        <div className="sw-review__header-main">
          <div className="sw-review__scope-wrap" ref={scopeMenuRef}>
            <button
              type="button"
              className="sw-review__scope-btn"
              aria-haspopup="listbox"
              aria-expanded={scopeOpen}
              onClick={() => setScopeOpen((v) => !v)}
              data-testid="review-scope-btn"
            >
              <span>{scopeLabel}</span>
              <span className="sw-review__scope-chev" aria-hidden>
                ▾
              </span>
            </button>
            {scopeOpen ? (
              <div
                className="sw-review__scope-menu"
                role="listbox"
                data-testid="review-scope-menu"
              >
                {(
                  [
                    ["all", tr("side.review.scopeAll")],
                    ["session", tr("side.review.scopeSession")],
                    ["workspace", tr("side.review.scopeWorkspace")],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="option"
                    aria-selected={scope === value}
                    className={
                      "sw-review__scope-opt" +
                      (scope === value ? " is-active" : "")
                    }
                    onClick={() => {
                      setScope(value);
                      setScopeOpen(false);
                    }}
                  >
                    <span>{label}</span>
                    {scope === value ? (
                      <span className="sw-review__scope-check" aria-hidden>
                        ✓
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="sw-review__totals" data-testid="review-stats">
            {loading && files.length === 0 ? (
              <span className="sw-review__totals-muted">
                {tr("resources.loading")}
              </span>
            ) : (
              <>
                <span className="sw-review__add">
                  +{bundle.totalAdded.toLocaleString()}
                </span>
                <span className="sw-review__del">
                  -{bundle.totalRemoved.toLocaleString()}
                </span>
              </>
            )}
          </div>
        </div>
        {(bundle.branch || bundle.upstream) && (
          <div className="sw-review__branch-line" data-testid="review-branch">
            <span>{bundle.branch || "HEAD"}</span>
            {bundle.upstream ? (
              <>
                <span className="sw-review__branch-arrow" aria-hidden>
                  →
                </span>
                <span>{bundle.upstream}</span>
              </>
            ) : null}
          </div>
        )}
        <div className="sw-review__header-actions">
          <div className="sw-review__more-wrap" ref={moreMenuRef}>
            <button
              type="button"
              className="sw-review__icon-btn"
              title={tr("side.review.more")}
              aria-label={tr("side.review.more")}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
              data-testid="review-more"
            >
              <IconMore size={15} />
            </button>
            {moreOpen ? (
              <div className="sw-review__scope-menu sw-review__more-menu">
                <button
                  type="button"
                  className="sw-review__scope-opt"
                  onClick={() => {
                    setMoreOpen(false);
                    void refresh();
                  }}
                >
                  <span>{tr("side.review.refresh")}</span>
                  <IconRefresh size={13} />
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={
              "sw-review__icon-btn" + (sideCollapsed ? "" : " is-active")
            }
            title={tr("side.review.toggleTree")}
            aria-label={tr("side.review.toggleTree")}
            onClick={() => setSideCollapsed((v) => !v)}
            data-testid="review-toggle-tree"
          >
            <IconListTree size={15} />
          </button>
          <button
            type="button"
            className="sw-review__icon-btn"
            title={tr("changes.copyPath")}
            aria-label={tr("changes.copyPath")}
            disabled={!selectedFile}
            onClick={() => void copySelectedPath()}
            data-testid="review-copy-path"
          >
            <IconCopy size={15} />
          </button>
          <button
            type="button"
            className="sw-review__icon-btn"
            title={tr("changes.openInEditor")}
            aria-label={tr("changes.openInEditor")}
            disabled={!selectedFile}
            onClick={() => void openSelectedInEditor()}
            data-testid="review-open-editor"
          >
            <IconCode size={15} />
          </button>
          <button
            type="button"
            className="sw-review__icon-btn"
            title={tr("changes.reveal")}
            aria-label={tr("changes.reveal")}
            disabled={!selectedFile}
            onClick={() => void revealSelected()}
            data-testid="review-reveal"
          >
            <IconFolder size={15} />
          </button>
          <Tip label={expandAllLabel} placement="bottom">
            <button
              type="button"
              className={
                "sw-review__icon-btn" + (allDiffsOpen ? " is-active" : "")
              }
              aria-label={expandAllLabel}
              disabled={files.length === 0}
              onClick={allDiffsOpen ? handleCollapseAll : handleExpandAll}
              data-testid="review-expand-all"
            >
              {allDiffsOpen ? (
                <IconArrowsMinimize size={15} />
              ) : (
                <IconSideExpand size={15} />
              )}
            </button>
          </Tip>
        </div>
      </div>

      <div className="sw-review__split">
        <div
          className="sw-review__stack"
          data-testid="review-diff"
          ref={stackRef}
        >
          {emptyState.kind !== "ok" ? (
            <div
              className="rp__empty-state rp__empty-state--sm"
              data-testid="review-empty"
              data-empty-kind={emptyState.kind}
            >
              <div className="rp__empty-title">
                {tr(emptyState.titleKey as MessageKey)}
              </div>
              {emptyState.hintKey ? (
                <div className="rp__empty-desc">
                  {tr(emptyState.hintKey as MessageKey)}
                </div>
              ) : null}
            </div>
          ) : (
            visibleFiles.map((f) => {
              const isOpen = expanded.has(f.key);
              const parsed = isOpen ? parsedByKey.get(f.key) ?? null : null;
              return (
                <section
                  key={f.key}
                  className={
                    "sw-review-file" +
                    (selectedKey === f.key ? " is-selected" : "")
                  }
                  data-review-key={f.key}
                  ref={(el) => {
                    if (el) fileEls.current.set(f.key, el);
                    else fileEls.current.delete(f.key);
                  }}
                >
                  <div className="sw-review-file__head-row">
                    <button
                      type="button"
                      className="sw-review-file__head"
                      onClick={() => {
                        setSelectedKey(f.key);
                        toggleExpand(f.key);
                      }}
                      title={f.relPath}
                      data-testid={`review-file-head-${f.key}`}
                    >
                      <ReviewKindChip name={f.name} />
                      <span className="sw-review-file__name">
                        {truncateMiddle(f.name, 36)}
                      </span>
                      <span className="sw-review-file__stats">
                        <span className="sw-review__add">+{f.added}</span>
                        <span className="sw-review__del">-{f.removed}</span>
                      </span>
                    </button>
                    {onOpenFile ? (
                      <button
                        type="button"
                        className="sw-review-file__path-link"
                        title={tr("side.review.openPreview")}
                        aria-label={tr("side.review.openPreview")}
                        data-testid="review-path-link"
                        onClick={() => openFilePreview(f.path, f.name)}
                      >
                        {truncateMiddle(f.relPath, 42)}
                      </button>
                    ) : (
                      <span className="sw-review-file__path-link is-static">
                        {truncateMiddle(f.relPath, 42)}
                      </span>
                    )}
                  </div>
                  {isOpen ? (
                    <div className="sw-review-file__body">
                      {f.binary ? (
                        <div className="sw-review-file__msg">
                          {tr("side.review.binary")}
                        </div>
                      ) : f.loading ? (
                        <div className="sw-review-file__msg">
                          {tr("changes.loadingDiff")}
                        </div>
                      ) : f.error ? (
                        <div className="sw-review-file__msg">{f.error}</div>
                      ) : !f.patch || parsed?.empty ? (
                        <div className="sw-review-file__msg">
                          {tr("changes.noDiff")}
                        </div>
                      ) : (
                        <DiffRows
                          rows={parsed!.rows}
                          lineCap={LINE_CAP}
                          showAll={showAllLines.has(f.key)}
                          onShowAll={() =>
                            setShowAllLines((prev) => {
                              const next = new Set(prev);
                              next.add(f.key);
                              return next;
                            })
                          }
                          showAllLabel={tr("side.review.showMore")}
                          unmodifiedLabel={(n) =>
                            tr("side.review.unmodified", {
                              n: n.toLocaleString(),
                            })
                          }
                        />
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </div>

        {!sideCollapsed ? (
          <aside className="sw-review__side" data-testid="review-tree">
            <div className="sw-review__filter">
              <span className="sw-review__filter-icon" aria-hidden>
                <IconSearch size={13} />
              </span>
              <input
                ref={filterInputRef}
                type="search"
                className="sw-review__filter-input"
                placeholder={tr("side.review.filterFiles")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label={tr("side.review.filterFiles")}
                data-testid="review-filter"
              />
            </div>
            {showKinds && presentKinds.length > 0 ? (
              <div
                className="sw-review__kind-filters"
                role="tablist"
                aria-label={tr("changes.kindFilterLabel")}
                data-testid="review-kind-filters"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={kindFilter === "all"}
                  className={
                    "sw-review__kind-chip" +
                    (kindFilter === "all" ? " is-active" : "")
                  }
                  onClick={() => setKindFilter("all")}
                >
                  <span>{tr("changes.kindFilterAll")}</span>
                  <span className="sw-review__kind-chip-count">
                    {files.length}
                  </span>
                </button>
                {presentKinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={kindFilter === k}
                    className={
                      "sw-review__kind-chip" +
                      (kindFilter === k ? " is-active" : "")
                    }
                    onClick={() =>
                      setKindFilter(normalizeChangesKindFilter(k))
                    }
                  >
                    <span>
                      {tr(
                        `changes.workspace.kind.${k}` as MessageKey,
                      )}
                    </span>
                    <span className="sw-review__kind-chip-count">
                      {kindCounts[k] ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="sw-review__tree-scroll">
              {emptyState.kind === "loading" ? (
                <div className="sw-review-file__msg">
                  {tr("resources.loading")}
                </div>
              ) : tree.length === 0 ? (
                <div
                  className="sw-review-file__msg"
                  data-empty-kind={emptyState.kind}
                >
                  {tr(emptyState.titleKey as MessageKey)}
                </div>
              ) : (
                <TreeNodes
                  nodes={tree}
                  depth={0}
                  selectedKey={selectedKey}
                  collapsedDirs={collapsedDirs}
                  onToggleDir={toggleDir}
                  onSelect={scrollToFile}
                  onOpenFile={onOpenFile ? openFilePreview : undefined}
                  openFileLabel={tr("side.review.openPreview")}
                />
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
