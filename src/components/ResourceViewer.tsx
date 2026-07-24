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
import { createT, type Locale } from "@/i18n";
import { resolvePreviewSrc } from "@/lib/filePreviewSrc";
import { HtmlBrowser } from "@/components/HtmlBrowser";
import { EmbeddedBrowser } from "@/components/EmbeddedBrowser";
import { MarkdownBody } from "@/components/MarkdownBody";
import { OverlayScroll } from "@/components/OverlayScroll";
import { FileMediaPlayer } from "@/components/FileMediaPlayer";
import { ImageUi } from "@/components/ImageUi";
import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconCopy,
  IconExternalLink,
  IconFileDiff,
  IconFolder,
  IconFiles,
  IconListTree,
  IconPlan,
  IconRefresh,
  IconSearch,
} from "@/components/icons";
import { PlanReviewPanel } from "@/components/PlanReviewPanel";
import type { PlanReviewState } from "@/lib/planBody";
import { OfficeDocumentPreview } from "@/components/OfficeDocumentPreview";
import { CodePreview } from "@/components/CodePreview";
import { isOfficeKind } from "@/lib/filePreviewSrc";
import { OpenLocationButton } from "@/components/OpenLocationButton";
import { Tip } from "@/components/ui/tooltip";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import type { MessageKey } from "@/i18n";
import {
  buildUnifiedDiff,
  normalizePath,
  pathBaseName,
  pathRelativeToProject,
  type SessionFileChange,
} from "@/lib/sessionChanges";
import {
  filterWorkspaceGitEntries,
  normalizeWorkspaceGitEntries,
  resolveWorkspaceAbsolutePath,
  workspaceGitKindBadge,
  workspaceGitKindMessageKey,
  type WorkspaceGitFile,
} from "@/lib/workspaceGit";

const TREE_WIDTH_KEY = "grok-app.resourceTreeWidth";
const TREE_WIDTH_DEFAULT = 220;
const TREE_WIDTH_MIN = 140;
const TREE_WIDTH_MAX = 420;

function loadTreeWidth(): number {
  try {
    const n = Number(localStorage.getItem(TREE_WIDTH_KEY));
    if (Number.isFinite(n) && n >= TREE_WIDTH_MIN && n <= TREE_WIDTH_MAX) {
      return Math.round(n);
    }
  } catch {
    /* ignore */
  }
  return TREE_WIDTH_DEFAULT;
}

function clampTreeWidth(w: number, containerWidth: number): number {
  const maxByContainer = Math.max(
    TREE_WIDTH_MIN,
    Math.floor(containerWidth * 0.55),
  );
  const max = Math.min(TREE_WIDTH_MAX, maxByContainer);
  if (!Number.isFinite(w)) return TREE_WIDTH_DEFAULT;
  return Math.min(max, Math.max(TREE_WIDTH_MIN, Math.round(w)));
}

/** Request from chat (or elsewhere) to open a path/URL in this pane. */
export type ResourceOpenTarget =
  | { type: "file"; path: string; title?: string }
  | { type: "url"; url: string; title?: string };

export interface ResourceViewerProps {
  projectPath: string | null;
  projectName: string | null;
  locale: Locale;
  onClose?: () => void;
  /** When set, open the file/url then call onOpenRequestConsumed. */
  openRequest?: ResourceOpenTarget | null;
  onOpenRequestConsumed?: () => void;
  /**
   * Whether the right pane is currently shown.
   * When it becomes false, the file tree collapses and is not remembered.
   */
  paneActive?: boolean;
  /**
   * Files written/edited by agent tools in the active session (Changes panel).
   */
  sessionChanges?: SessionFileChange[];
  /**
   * Live plan snapshot for Plan review mode (exit_plan_mode / progress).
   */
  plan?: PlanReviewState | null;
  /** Increment / change to force switch into Plan mode (详情 / auto-open). */
  planFocusKey?: number | null;
  onApprovePlan?: () => void;
  onRequestPlanChanges?: () => void;
  onDismissPlan?: () => void;
}

type SideMode = "files" | "changes" | "plan";

type DiffViewState = {
  path: string;
  name: string;
  loading: boolean;
  /** Unified diff text when available. */
  unified: string | null;
  /** Fallback: full after content only. */
  afterOnly: string | null;
  error: string | null;
  source: "payload" | "git" | "head" | "after" | null;
};

type ChangeSelectionSource = "session" | "workspace";

interface TreeNode {
  name: string;
  relativePath: string;
  isDir: boolean;
  size: number;
  ext: string;
  children?: TreeNode[];
  loaded?: boolean;
}

interface FileTab {
  id: string;
  relativePath: string;
  name: string;
  absolutePath: string;
  preview: api.FsReadResult | null;
  mediaSrc: string | null;
  error: string | null;
  loading: boolean;
  /** External URL tab (web page). */
  url?: string;
  tabKind?: "file" | "url";
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function baseName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
}

function guessOfficeKind(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx") || lower.endsWith(".docm")) return "docx";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return "xlsx";
  if (lower.endsWith(".pptx") || lower.endsWith(".pptm")) return "pptx";
  if (lower.endsWith(".pdf")) return "pdf";
  return "docx";
}

/** Lightweight file-kind chip for tree rows */
function FileKindMark({ name, isDir }: { name: string; isDir: boolean }) {
  if (isDir) {
    return (
      <span className="rp-kind rp-kind--dir" aria-hidden>
        <IconFolder size={14} />
      </span>
    );
  }
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() || "" : "";
  if (ext === "md" || ext === "mdx") {
    return <span className="rp-kind rp-kind--md" aria-hidden>M</span>;
  }
  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
    return <span className="rp-kind rp-kind--code" aria-hidden>{"{}"}</span>;
  }
  if (ext === "json" || ext === "toml" || ext === "yaml" || ext === "yml") {
    return <span className="rp-kind rp-kind--data" aria-hidden>{"{ }"}</span>;
  }
  if (ext === "gitignore" || lower === ".gitignore") {
    return <span className="rp-kind rp-kind--git" aria-hidden>◆</span>;
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
    return <span className="rp-kind rp-kind--img" aria-hidden>▣</span>;
  }
  return (
    <span className="rp-kind rp-kind--file" aria-hidden>
      <IconFiles size={13} />
    </span>
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
  plan = null,
  planFocusKey = null,
  onApprovePlan,
  onRequestPlanChanges,
  onDismissPlan,
}: ResourceViewerProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [root, setRoot] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    "": true,
  });
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Default closed; session-only — not persisted; reset when pane hides.
  const [treeVisible, setTreeVisible] = useState(false);
  const [sideMode, setSideMode] = useState<SideMode>("files");
  const lastPlanFocusKey = useRef<number | null>(null);
  const [treeWidth, setTreeWidth] = useState(loadTreeWidth);
  const [resizingTree, setResizingTree] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const [selectedChangePath, setSelectedChangePath] = useState<string | null>(
    null,
  );
  const [selectedChangeSource, setSelectedChangeSource] =
    useState<ChangeSelectionSource | null>(null);
  const [diffView, setDiffView] = useState<DiffViewState | null>(null);
  const diffLoadSeq = useRef(0);
  const workspaceLoadSeq = useRef(0);
  /** Workspace git status (project-wide), independent of session tool edits. */
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceGitFile[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceAvailable, setWorkspaceAvailable] = useState(false);
  const [workspaceReason, setWorkspaceReason] = useState<string | null>(null);
  const [workspaceBranch, setWorkspaceBranch] = useState<string | null>(null);
  const [pathCopyFlash, setPathCopyFlash] = useState(false);
  /** Open-with target for the location button (finder / editor id). */
  const [openWithTarget, setOpenWithTarget] = useState(() => {
    try {
      return localStorage.getItem("grok-app.openTarget") || "finder";
    } catch {
      return "finder";
    }
  });

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
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
  const filteredWorkspace = useMemo(
    () => filterWorkspaceGitEntries(workspaceFiles, query),
    [workspaceFiles, query],
  );

  // Closing the right pane always collapses the tree (not remembered).
  useEffect(() => {
    if (!paneActive) setTreeVisible(false);
  }, [paneActive]);

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
      setSelectedChangePath(path);
      setSelectedChangeSource("session");
      setDiffView({
        path,
        name: change.name || pathBaseName(path),
        loading: true,
        unified: null,
        afterOnly: null,
        error: null,
        source: null,
      });

      const relName =
        pathRelativeToProject(path, projectPath) || change.name || pathBaseName(path);

      // 1) Tool payload before/after → local unified diff
      if (
        typeof change.before === "string" &&
        typeof change.after === "string"
      ) {
        const unified = buildUnifiedDiff(relName, change.before, change.after);
        if (seq !== diffLoadSeq.current) return;
        setDiffView({
          path,
          name: change.name || pathBaseName(path),
          loading: false,
          unified,
          afterOnly: null,
          error: null,
          source: "payload",
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
              name: change.name || pathBaseName(path),
              loading: false,
              unified: g.diff,
              afterOnly: null,
              error: null,
              source: "git",
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
              name: change.name || pathBaseName(path),
              loading: false,
              unified,
              afterOnly: null,
              error: null,
              source: "head",
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
          name: change.name || pathBaseName(path),
          loading: false,
          unified,
          afterOnly: null,
          error: null,
          source: "payload",
        });
        return;
      }

      if (afterText != null) {
        setDiffView({
          path,
          name: change.name || pathBaseName(path),
          loading: false,
          unified: null,
          afterOnly: afterText,
          error: null,
          source: "after",
        });
        return;
      }

      setDiffView({
        path,
        name: change.name || pathBaseName(path),
        loading: false,
        unified: null,
        afterOnly: null,
        error: null,
        source: null,
      });
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
      setSelectedChangePath(path);
      setSelectedChangeSource("workspace");
      setDiffView({
        path,
        name: entry.name || pathBaseName(path),
        loading: true,
        unified: null,
        afterOnly: null,
        error: null,
        source: null,
      });

      const relName = entry.path || pathBaseName(path);

      // Prefer git unified diff for workspace rows
      if (projectPath && api.isTauri()) {
        try {
          const g = await api.gitFileDiff(projectPath, path);
          if (seq !== diffLoadSeq.current) return;
          if (g.available && g.diff?.trim()) {
            setDiffView({
              path,
              name: entry.name || pathBaseName(path),
              loading: false,
              unified: g.diff,
              afterOnly: null,
              error: null,
              source: "git",
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
              name: entry.name || pathBaseName(path),
              loading: false,
              unified,
              afterOnly: null,
              error: null,
              source: "head",
            });
            return;
          }
          if (afterText != null) {
            // Untracked / new: show full file as after-only
            setDiffView({
              path,
              name: entry.name || pathBaseName(path),
              loading: false,
              unified:
                entry.kind === "untracked" || entry.kind === "added"
                  ? buildUnifiedDiff(relName, "", afterText)
                  : null,
              afterOnly:
                entry.kind === "untracked" || entry.kind === "added"
                  ? null
                  : afterText,
              error: null,
              source:
                entry.kind === "untracked" || entry.kind === "added"
                  ? "git"
                  : "after",
            });
            return;
          }
        } catch {
          /* soft-fail */
        }
      }

      if (seq !== diffLoadSeq.current) return;
      setDiffView({
        path,
        name: entry.name || pathBaseName(path),
        loading: false,
        unified: null,
        afterOnly: null,
        error: null,
        source: null,
      });
    },
    [projectPath],
  );

  const openChangeInEditor = useCallback(async (path: string) => {
    if (!path || !api.isTauri()) return;
    try {
      await api.openInEditor({ path });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const revealChangePath = useCallback(async (path: string) => {
    if (!path || !api.isTauri()) return;
    try {
      await api.pathReveal(path);
    } catch (e) {
      setError(String(e));
    }
  }, []);

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
    const r = (workspaceReason || "").toLowerCase();
    if (r.includes("not a git") || r.includes("not a git repository")) {
      return tr("changes.workspace.noRepo");
    }
    if (r.includes("git not available") || r.includes("not available")) {
      return tr("changes.workspace.noGit");
    }
    return tr("changes.workspace.unavailable");
  }, [tr, workspaceReason]);

  const showSidePanel = (mode: SideMode) => {
    // Plan mode uses full-width review (no side tree).
    if (mode === "plan") {
      setSideMode("plan");
      setTreeVisible(false);
      return;
    }
    if (treeVisible && sideMode === mode) {
      setTreeVisible(false);
      return;
    }
    setSideMode(mode);
    setTreeVisible(true);
  };

  // External “open plan in resources” (详情 / auto-open on review).
  useEffect(() => {
    if (planFocusKey == null) return;
    if (lastPlanFocusKey.current === planFocusKey) return;
    lastPlanFocusKey.current = planFocusKey;
    setSideMode("plan");
    setTreeVisible(false);
  }, [planFocusKey]);

  // Plan dismissed while viewing plan → fall back to files empty preview.
  useEffect(() => {
    if (sideMode === "plan" && plan && !plan.visible) {
      setSideMode("files");
    }
  }, [plan, sideMode]);

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
        try {
          localStorage.setItem(TREE_WIDTH_KEY, String(w));
        } catch {
          /* ignore */
        }
        return w;
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
    setTabs([]);
    setActiveId(null);
    setExpanded({ "": true });
    setQuery("");
  }, [projectPath, refresh]);

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

  const applyReadResult = (
    id: string,
    r: api.FsReadResult,
    src: string | null,
    relativePath: string,
  ) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              preview: r,
              mediaSrc: src,
              absolutePath: r.absolutePath || "",
              relativePath: relativePath || r.relativePath || t.relativePath,
              name: r.name || baseName(relativePath || r.absolutePath || "file"),
              loading: false,
              tabKind: "file" as const,
            }
          : t,
      ),
    );
  };

  const openFile = async (relativePath: string) => {
    if (!projectPath) {
      setError(tr("main.noProject"));
      return;
    }
    if (!api.isTauri()) {
      setError(tr("resources.openFailed"));
      return;
    }
    const existing = tabs.find(
      (t) => t.tabKind !== "url" && t.relativePath === relativePath,
    );
    if (existing) {
      setTabs((prev) => {
        const hit = prev.find((t) => t.id === existing.id);
        if (!hit) return prev;
        return [hit, ...prev.filter((t) => t.id !== existing.id)];
      });
      setActiveId(existing.id);
      return;
    }
    const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const tab: FileTab = {
      id,
      relativePath,
      name: baseName(relativePath),
      absolutePath: "",
      preview: null,
      mediaSrc: null,
      error: null,
      loading: true,
      tabKind: "file",
    };
    // Newest tab on the left
    setTabs((prev) => [tab, ...prev]);
    setActiveId(id);
    try {
      const r = await api.fsReadFile(projectPath, relativePath);
      const src = await resolvePreviewSrc(r);
      applyReadResult(id, r, src, relativePath);
    } catch (e) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                loading: false,
                error: `${tr("resources.openFailed")}: ${String(e)}`,
              }
            : t,
        ),
      );
    }
  };

  /**
   * Open path from chat cards. Uses smart host resolver:
   * absolute → project-relative → suffix search under project root
   * (handles monorepo: agent writes `05-handoff/next.md` under a subfolder).
   */
  const openAbsoluteFile = useCallback(
    async (absolutePath: string, title?: string) => {
      if (!api.isTauri()) {
        setError(tr("resources.openFailed"));
        return;
      }
      const norm = absolutePath.trim();
      if (!norm) return;
      const existing = tabs.find(
        (t) =>
          t.tabKind !== "url" &&
          (t.absolutePath === norm || t.relativePath === norm),
      );
      if (existing) {
        // Move existing to front + activate (Chrome-like focus)
        setTabs((prev) => {
          const hit = prev.find((t) => t.id === existing.id);
          if (!hit) return prev;
          return [hit, ...prev.filter((t) => t.id !== existing.id)];
        });
        setActiveId(existing.id);
        return;
      }
      const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const tab: FileTab = {
        id,
        relativePath: norm,
        name: title || baseName(norm),
        absolutePath: norm,
        preview: null,
        mediaSrc: null,
        error: null,
        loading: true,
        tabKind: "file",
      };
      setTabs((prev) => [tab, ...prev]);
      setActiveId(id);
      try {
        const r = await api.fsOpenPath(norm, projectPath);
        const src = await resolvePreviewSrc(r);
        // Prefer project-relative tab key when file is under project
        let relKey = r.relativePath || baseName(norm);
        if (projectPath && r.absolutePath) {
          const root = projectPath.replace(/[/\\]+$/, "").replace(/\\/g, "/");
          const absN = r.absolutePath.replace(/\\/g, "/");
          if (absN.startsWith(root + "/")) {
            relKey = absN.slice(root.length + 1);
          }
        }
        applyReadResult(id, r, src, relKey);
      } catch (e) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  loading: false,
                  error: `${tr("resources.openFailed")}: ${String(e)}`,
                }
              : t,
          ),
        );
      }
    },
    [projectPath, tabs, tr],
  );

  const openUrl = useCallback(
    (url: string, title?: string) => {
      const u = url.trim();
      if (!u) return;
      const existing = tabs.find((t) => t.tabKind === "url" && t.url === u);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      let name = title || u;
      try {
        name = title || new URL(u).hostname || u;
      } catch {
        /* keep */
      }
      const tab: FileTab = {
        id,
        relativePath: u,
        name,
        absolutePath: "",
        preview: null,
        mediaSrc: null,
        error: null,
        loading: false,
        url: u,
        tabKind: "url",
      };
      setTabs((prev) => [tab, ...prev]);
      setActiveId(id);
    },
    [tabs],
  );

  // External open requests (from chat file/url cards)
  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.type === "file") {
      void openAbsoluteFile(openRequest.path, openRequest.title);
    } else if (openRequest.type === "url") {
      openUrl(openRequest.url, openRequest.title);
    }
    onOpenRequestConsumed?.();
  }, [openRequest, openAbsoluteFile, openUrl, onOpenRequestConsumed]);

  /** Last tab gone → collapse the right pane (user can still re-open it manually). */
  const closePaneIfNoTabs = useCallback(
    (remaining: number) => {
      if (remaining === 0) onClose?.();
    },
    [onClose],
  );

  const closeTab = useCallback(
    (id: string) => {
      let remaining = -1;
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx < 0) {
          remaining = prev.length;
          return prev;
        }
        const next = prev.filter((t) => t.id !== id);
        remaining = next.length;
        if (activeId === id) {
          // Prefer neighbor on the left (newer), else right
          const neighbor = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
          setActiveId(neighbor?.id ?? null);
        }
        return next;
      });
      if (remaining === 0) closePaneIfNoTabs(0);
    },
    [activeId, closePaneIfNoTabs],
  );

  /** Chrome-style: close every tab except `id`. */
  const closeOtherTabs = useCallback(
    (id: string) => {
      setTabs((prev) => prev.filter((t) => t.id === id));
      setActiveId(id);
    },
    [],
  );

  /** Close tabs visually to the right of `id` (higher index; older tabs). */
  const closeTabsToRight = useCallback(
    (id: string) => {
      let remaining = -1;
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx < 0) {
          remaining = prev.length;
          return prev;
        }
        const next = prev.slice(0, idx + 1);
        remaining = next.length;
        if (activeId && !next.some((t) => t.id === activeId)) {
          setActiveId(id);
        }
        return next;
      });
      if (remaining === 0) closePaneIfNoTabs(0);
    },
    [activeId, closePaneIfNoTabs],
  );

  /** Close tabs visually to the left of `id` (lower index; newer tabs). */
  const closeTabsToLeft = useCallback(
    (id: string) => {
      let remaining = -1;
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx < 0) {
          remaining = prev.length;
          return prev;
        }
        const next = prev.slice(idx);
        remaining = next.length;
        if (activeId && !next.some((t) => t.id === activeId)) {
          setActiveId(id);
        }
        return next;
      });
      if (remaining === 0) closePaneIfNoTabs(0);
    },
    [activeId, closePaneIfNoTabs],
  );

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActiveId(null);
    closePaneIfNoTabs(0);
  }, [closePaneIfNoTabs]);

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

  const changeStatusLabel = useCallback(
    (status: string) => {
      const s = (status || "").toLowerCase();
      if (s === "completed") return tr("changes.status.completed");
      if (s === "failed" || s === "error") return tr("changes.status.failed");
      if (s === "in_progress" || s === "running")
        return tr("changes.status.in_progress");
      if (s === "pending") return tr("changes.status.pending");
      return status || "";
    },
    [tr],
  );

  const previewBody = useMemo(() => {
    // Session change diff takes over the preview when selected in Changes mode.
    if (sideMode === "changes" && diffView) {
      if (diffView.loading) {
        return (
          <div className="rp-preview__msg">{tr("changes.loadingDiff")}</div>
        );
      }
      if (diffView.unified) {
        const srcLabel =
          diffView.source === "git"
            ? tr("changes.sourceGit")
            : diffView.source === "head"
              ? tr("changes.sourceHead")
              : diffView.source === "payload"
                ? tr("changes.sourcePayload")
                : null;
        return (
          <CodePreview
            code={diffView.unified}
            fileName={`${diffView.name}.diff`}
            language="diff"
            footer={srcLabel}
          />
        );
      }
      if (diffView.afterOnly) {
        return (
          <CodePreview
            code={diffView.afterOnly}
            fileName={diffView.name}
            footer={tr("changes.afterOnly")}
          />
        );
      }
      return (
        <div className="rp-changes-empty">
          <div className="rp-changes-empty__title">{tr("changes.noDiff")}</div>
          <div className="rp-changes-empty__hint">{tr("changes.noDiffHint")}</div>
          <div className="rp-changes-empty__actions">
            <button
              type="button"
              className="rp-tool-btn"
              onClick={() => void openChangeInEditor(diffView.path)}
            >
              <IconExternalLink size={14} />
              <span className="rp-tool-btn__label">
                {tr("changes.openInEditor")}
              </span>
            </button>
            <button
              type="button"
              className="rp-tool-btn"
              onClick={() => void revealChangePath(diffView.path)}
            >
              <IconFolder size={14} />
              <span className="rp-tool-btn__label">{tr("changes.reveal")}</span>
            </button>
            <button
              type="button"
              className="rp-tool-btn"
              onClick={() => void copyChangePath(diffView.path)}
            >
              <IconCopy size={14} />
              <span className="rp-tool-btn__label">
                {pathCopyFlash
                  ? tr("changes.pathCopied")
                  : tr("changes.copyPath")}
              </span>
            </button>
          </div>
        </div>
      );
    }

    // URL tabs render via EmbeddedBrowser below (native Webview host).
    // Keep other kinds here so useMemo deps stay correct.
    if (activeTab?.tabKind === "url" && activeTab.url) {
      return null;
    }
    const preview = activeTab?.preview;
    if (!preview) {
      if (activeTab?.error) {
        return <div className="rp-preview__msg">{activeTab.error}</div>;
      }
      return null;
    }
    if (preview.error && !preview.text && !preview.base64 && !preview.stream) {
      return <div className="rp-preview__msg">{preview.error}</div>;
    }
    const mediaSrc = activeTab?.mediaSrc ?? null;
    const dataUrl =
      preview.base64 && preview.mime
        ? `data:${preview.mime};base64,${preview.base64}`
        : null;
    const src = mediaSrc || dataUrl;

    // Word / Excel / PDF rich preview
    if (
      isOfficeKind(preview.kind) &&
      preview.absolutePath &&
      preview.kind !== "image"
    ) {
      return (
        <OfficeDocumentPreview
          kind={preview.kind === "office" ? guessOfficeKind(preview.name) : preview.kind}
          absolutePath={preview.absolutePath}
          name={preview.name}
          locale={locale}
          textFallback={preview.text}
          errorFromHost={preview.error}
          embedded
        />
      );
    }

    switch (preview.kind) {
      case "image":
        if (
          preview.text &&
          (preview.mime.includes("svg") || preview.name.endsWith(".svg"))
        ) {
          return (
            <div
              className="rp-preview__svg"
              dangerouslySetInnerHTML={{ __html: preview.text }}
            />
          );
        }
        return src ? (
          <ImageUi
            layout="pane"
            className="rp-preview__img"
            src={src}
            alt={preview.name}
            path={preview.absolutePath || undefined}
            labels={{
              viewImage: tr("image.view"),
              copyImage: tr("image.copy"),
              reveal: tr("attach.reveal"),
              copyPath: tr("attach.copyPath"),
            }}
          />
        ) : (
          <div className="rp-preview__msg">{tr("resources.binary")}</div>
        );
      case "pdf":
        // Handled above via OfficeDocumentPreview; keep iframe fallback
        return src ? (
          <iframe
            className="rp-preview__frame"
            title={preview.name}
            src={src}
          />
        ) : (
          <div className="rp-preview__msg">{tr("resources.binary")}</div>
        );
      case "audio":
      case "video":
        return src ? (
          <FileMediaPlayer
            kind={preview.kind}
            src={src}
            mime={preview.mime}
            title={preview.name}
            absolutePath={preview.absolutePath || undefined}
            labels={{
              loadError: tr("media.loadError"),
              openExternal: tr("media.openExternal"),
              loading: tr("resources.loading"),
            }}
          />
        ) : (
          <div className="rp-preview__msg">{tr("resources.binary")}</div>
        );
      case "markdown":
        return (
          <div className="rp-preview__md">
            <MarkdownBody>{preview.text ?? ""}</MarkdownBody>
          </div>
        );
      case "html":
        // Do not use file:// in iframe — WKWebView/Tauri blocks it (blank page).
        // HtmlBrowser uses srcDoc (host text) or asset fetch; scripts work, full-bleed.
        return (
          <HtmlBrowser
            title={preview.name}
            absolutePath={preview.absolutePath || null}
            html={preview.text}
          />
        );
      case "json": {
        let body = preview.text ?? "";
        try {
          body = JSON.stringify(JSON.parse(body), null, 2);
        } catch {
          /* keep raw */
        }
        return (
          <CodePreview
            code={body}
            fileName={preview.name.endsWith(".json") ? preview.name : "data.json"}
            language="json"
            footer={
              preview.truncated ? tr("resources.truncated") : null
            }
          />
        );
      }
      default:
        if (preview.text) {
          return (
            <CodePreview
              code={preview.text}
              fileName={preview.name}
              footer={
                preview.truncated ? tr("resources.truncated") : null
              }
            />
          );
        }
        return (
          <div className="rp-preview__msg">
            {preview.error || tr("resources.binary")}
            <div className="rp-preview__meta">
              {preview.name} · {formatSize(preview.size)}
            </div>
          </div>
        );
    }
  }, [
    activeTab,
    tr,
    locale,
    sideMode,
    diffView,
    openChangeInEditor,
    revealChangePath,
    copyChangePath,
    pathCopyFlash,
  ]);

  // No project and no open tabs → empty; allow absolute/url tabs without a project.
  if (!projectPath && tabs.length === 0) {
    return (
      <div className="rp" data-testid="resource-viewer">
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
   */
  return (
    <div
      className="rp"
      data-testid="resource-viewer"
      aria-label={projectName ?? tr("resources.title")}
    >
      <div className="rp-chrome">
        <div className="rp-tabs" role="tablist" aria-label={tr("resources.files")}>
          <div className="rp-tabs__scroll">
            {tabs.length === 0 ? (
              <div className="rp-tabs__placeholder">
                <span className="rp-tabs__hint">{tr("resources.emptyPreview")}</span>
              </div>
            ) : (
              tabs.map((t) => {
                const active = t.id === activeId;
                return (
                  <Tip
                    key={t.id}
                    label={
                      active
                        ? t.relativePath || t.name
                        : `${t.name}\n${t.relativePath || ""}`
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
                        (t.tabKind === "url" ? " rp-tab--url" : "")
                      }
                      onClick={() => setActiveId(t.id)}
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
                      {active ? (
                        <>
                          <span className="rp-tab__name">{t.name}</span>
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
                        </>
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
              target={openWithTarget}
              onTargetChange={(t) => {
                setOpenWithTarget(t);
                try {
                  localStorage.setItem("grok-app.openTarget", t);
                } catch {
                  /* ignore */
                }
              }}
              onOpenError={(e) => setError(e)}
              compact
              labels={{
                openLocation: tr("main.openLocation"),
                openHint: tr("main.openLocationHint"),
                openMenu: tr("main.openLocationMenu"),
                finder: tr("resources.revealFolder"),
                systemDefault: tr("resources.openDefault"),
                copyPath: tr("attach.copyPath"),
              }}
            />
          ) : null}
          {plan?.visible ? (
            <Tip label={tr("resources.plan")}>
              <button
                type="button"
                className={
                  "chrome-btn main__pane-toggle rp-chrome__plan-btn" +
                  (sideMode === "plan" ? " is-on" : "")
                }
                onClick={() => showSidePanel("plan")}
                aria-label={tr("resources.plan")}
              >
                <IconPlan size={16} />
              </button>
            </Tip>
          ) : null}
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
              }}
              onApprove={onApprovePlan}
              onRequestChanges={onRequestPlanChanges}
              onDismiss={onDismissPlan}
            />
          ) : sideMode === "plan" ? (
            <div className="rp__empty-state">
              <div className="rp__empty-title">{tr("resources.plan")}</div>
              <div className="rp__empty-desc">{tr("resources.planEmpty")}</div>
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
            <div className="rp__empty-state">
              <div className="rp__empty-title">
                {sideMode === "changes" &&
                changeCount === 0 &&
                workspaceCount === 0
                  ? tr("changes.empty")
                  : sideMode === "changes"
                    ? tr("changes.title")
                    : tr("resources.emptyPreview")}
              </div>
              <div className="rp__empty-desc">
                {sideMode === "changes" &&
                changeCount === 0 &&
                workspaceCount === 0
                  ? tr("changes.emptyHint")
                  : sideMode === "changes"
                    ? tr("changes.workspace.emptyHint")
                    : tr("resources.emptyPreviewHint")}
              </div>
            </div>
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
                  <div className="rp-changes-list" role="list">
                    {/* ── Session (agent tool edits) ── */}
                    <div className="rp-changes-section">
                      <div className="rp-changes-section__head">
                        <span className="rp-changes-section__title">
                          {tr("changes.section.session")}
                        </span>
                        {changeCount > 0 ? (
                          <span className="rp-changes-section__count">
                            {changeCount}
                          </span>
                        ) : null}
                      </div>
                      {filteredChanges.length === 0 ? (
                        <div className="rp-changes-section__empty">
                          {tr("changes.empty")}
                        </div>
                      ) : (
                        filteredChanges.map((c) => {
                          const active =
                            selectedChangeSource === "session" &&
                            selectedChangePath != null &&
                            normalizePath(c.path) ===
                              normalizePath(selectedChangePath);
                          const rel =
                            pathRelativeToProject(c.path, projectPath) ||
                            c.path;
                          return (
                            <div
                              key={`session:${c.path}`}
                              className={
                                "rp-changes-row" +
                                (active ? " is-active" : "")
                              }
                              role="listitem"
                            >
                              <button
                                type="button"
                                className="rp-changes-row__main"
                                title={c.path}
                                onClick={() => void loadChangeDiff(c)}
                              >
                                <FileKindMark name={c.name} isDir={false} />
                                <span className="rp-changes-row__meta">
                                  <span className="rp-changes-row__name">
                                    {c.name}
                                  </span>
                                  <span className="rp-changes-row__path">
                                    {rel}
                                  </span>
                                  <span className="rp-changes-row__kind">
                                    {c.toolKind}
                                    {c.status
                                      ? ` · ${changeStatusLabel(c.status)}`
                                      : ""}
                                  </span>
                                </span>
                              </button>
                              <div className="rp-changes-row__actions">
                                <Tip label={tr("changes.openInEditor")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void openChangeInEditor(c.path);
                                    }}
                                  >
                                    <IconExternalLink size={13} />
                                  </button>
                                </Tip>
                                <Tip label={tr("changes.reveal")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void revealChangePath(c.path);
                                    }}
                                  >
                                    <IconFolder size={13} />
                                  </button>
                                </Tip>
                                <Tip label={tr("changes.copyPath")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void copyChangePath(c.path);
                                    }}
                                  >
                                    <IconCopy size={13} />
                                  </button>
                                </Tip>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* ── Workspace (git status) ── */}
                    <div className="rp-changes-section">
                      <div className="rp-changes-section__head">
                        <span className="rp-changes-section__title">
                          {tr("changes.section.workspace")}
                        </span>
                        {workspaceCount > 0 ? (
                          <span className="rp-changes-section__count">
                            {workspaceCount}
                          </span>
                        ) : null}
                        {workspaceBranch ? (
                          <span
                            className="rp-changes-section__branch"
                            title={tr("changes.workspace.branch", {
                              branch: workspaceBranch,
                            })}
                          >
                            {workspaceBranch}
                          </span>
                        ) : null}
                      </div>
                      {workspaceLoading && workspaceFiles.length === 0 ? (
                        <div className="rp-changes-section__empty">
                          {tr("changes.workspace.loading")}
                        </div>
                      ) : !workspaceAvailable ? (
                        <div className="rp-changes-section__empty">
                          {workspaceUnavailableLabel()}
                        </div>
                      ) : filteredWorkspace.length === 0 ? (
                        <div className="rp-changes-section__empty">
                          {tr("changes.workspace.empty")}
                        </div>
                      ) : (
                        filteredWorkspace.map((w) => {
                          const abs =
                            normalizePath(w.absolutePath) ||
                            resolveWorkspaceAbsolutePath(
                              projectPath,
                              w.path,
                            );
                          const active =
                            selectedChangeSource === "workspace" &&
                            selectedChangePath != null &&
                            (normalizePath(selectedChangePath) === abs ||
                              normalizePath(selectedChangePath) ===
                                normalizePath(w.path));
                          return (
                            <div
                              key={`ws:${w.path}`}
                              className={
                                "rp-changes-row" +
                                (active ? " is-active" : "")
                              }
                              role="listitem"
                            >
                              <button
                                type="button"
                                className="rp-changes-row__main"
                                title={abs || w.path}
                                onClick={() => void loadWorkspaceDiff(w)}
                              >
                                <span
                                  className={
                                    "rp-changes-badge rp-changes-badge--" +
                                    w.kind
                                  }
                                  aria-hidden
                                >
                                  {workspaceGitKindBadge(w.kind)}
                                </span>
                                <span className="rp-changes-row__meta">
                                  <span className="rp-changes-row__name">
                                    {w.name}
                                  </span>
                                  <span className="rp-changes-row__path">
                                    {w.path}
                                  </span>
                                  <span className="rp-changes-row__kind">
                                    {workspaceKindLabel(w.kind)}
                                    {w.status.trim()
                                      ? ` · ${w.status}`
                                      : ""}
                                  </span>
                                </span>
                              </button>
                              <div className="rp-changes-row__actions">
                                <Tip label={tr("changes.openInEditor")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void openChangeInEditor(abs || w.path);
                                    }}
                                  >
                                    <IconExternalLink size={13} />
                                  </button>
                                </Tip>
                                <Tip label={tr("changes.reveal")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void revealChangePath(abs || w.path);
                                    }}
                                  >
                                    <IconFolder size={13} />
                                  </button>
                                </Tip>
                                <Tip label={tr("changes.copyPath")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void copyChangePath(abs || w.path);
                                    }}
                                  >
                                    <IconCopy size={13} />
                                  </button>
                                </Tip>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
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
    </div>
  );
}
