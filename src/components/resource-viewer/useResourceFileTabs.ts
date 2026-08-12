/**
 * File tabs: open / save / edit buffer / close policies for ResourceViewer.
 */

import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import * as api from "@/lib/api";
import type { MessageKey } from "@/i18n";
import { resolvePreviewSrc } from "@/lib/filePreviewSrc";
import {
  defaultResourceEditMode,
  isFsWriteConflict,
  isResourceDraftDirty,
  isResourceTextEditable,
} from "@/lib/resourceEdit";
import {
  closeResourceTab,
  openResourceTab,
  resolveResourceTabsEmptyState,
} from "@/lib/resourceTabs";
import { normalizePath, pathBaseName } from "@/lib/sessionChanges";
import {
  baseName,
  fileTabMatchesPath,
  fileTabToResourceTab,
  mergeFileTabsFromOpen,
} from "./helpers";
import type { FileTab, SideMode } from "./types";

export type UseResourceFileTabsArgs = {
  projectPath: string | null;
  sideMode: SideMode;
  tr: (key: MessageKey, vars?: Record<string, string>) => string;
  setError: Dispatch<SetStateAction<string | null>>;
  onClose?: () => void;
};

export function useResourceFileTabs({
  projectPath,
  sideMode,
  tr,
  setError,
  onClose,
}: UseResourceFileTabsArgs) {
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Tab id waiting for conflict resolve (reload vs overwrite). */
  const [conflictTabId, setConflictTabId] = useState<string | null>(null);
  /** Close tab while dirty — confirm discard. */
  const [discardTabId, setDiscardTabId] = useState<string | null>(null);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  const filesTabsEmpty = useMemo(
    () =>
      resolveResourceTabsEmptyState({
        tabCount: tabs.length,
        sideMode,
      }),
    [tabs.length, sideMode],
  );

  const resetTabs = useCallback(() => {
    setTabs([]);
    setActiveId(null);
  }, []);

const applyReadResult = (
  id: string,
  r: api.FsReadResult,
  src: string | null,
  relativePath: string,
) => {
  const editable = isResourceTextEditable({
    kind: r.kind,
    text: r.text,
    truncated: r.truncated,
    error: r.error,
  });
  const text = r.text ?? null;
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
            draftText: editable ? text : null,
            baselineText: editable ? text : null,
            mtimeMs: typeof r.mtimeMs === "number" ? r.mtimeMs : null,
            editMode: editable ? defaultResourceEditMode(r.kind) : false,
            saving: false,
          }
        : t,
    ),
  );
};

const activeTabEditable = useMemo(() => {
  if (!activeTab?.preview || activeTab.tabKind === "url") return false;
  return isResourceTextEditable({
    kind: activeTab.preview.kind,
    text: activeTab.baselineText ?? activeTab.preview.text,
    truncated: activeTab.preview.truncated,
    error: activeTab.preview.error,
  });
}, [activeTab]);

const updateActiveDraft = useCallback((text: string) => {
  setTabs((prev) =>
    prev.map((t) =>
      t.id === activeId ? { ...t, draftText: text } : t,
    ),
  );
}, [activeId]);

const revertActiveDraft = useCallback(() => {
  setTabs((prev) =>
    prev.map((t) =>
      t.id === activeId && t.baselineText != null
        ? { ...t, draftText: t.baselineText }
        : t,
    ),
  );
}, [activeId]);

const toggleActiveEditMode = useCallback(() => {
  setTabs((prev) =>
    prev.map((t) =>
      t.id === activeId ? { ...t, editMode: !t.editMode } : t,
    ),
  );
}, [activeId]);

const reloadActiveFile = useCallback(async () => {
  const tab = tabs.find((t) => t.id === activeId);
  if (!tab || tab.tabKind === "url" || !api.isTauri()) return;
  setTabs((prev) =>
    prev.map((t) =>
      t.id === tab.id ? { ...t, loading: true, error: null } : t,
    ),
  );
  try {
    let r: api.FsReadResult;
    if (projectPath && tab.relativePath && !tab.relativePath.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(tab.relativePath)) {
      r = await api.fsReadFile(projectPath, tab.relativePath);
    } else if (tab.absolutePath) {
      r = await api.fsReadAbsolute(tab.absolutePath);
    } else {
      r = await api.fsOpenPath(tab.relativePath, projectPath);
    }
    const src = await resolvePreviewSrc(r);
    applyReadResult(tab.id, r, src, tab.relativePath);
  } catch (e) {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tab.id
          ? {
              ...t,
              loading: false,
              error: `${tr("resources.openFailed")}: ${String(e)}`,
            }
          : t,
      ),
    );
  }
}, [activeId, projectPath, tabs, tr]);

const saveActiveFile = useCallback(
  async (opts?: { force?: boolean }) => {
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab || tab.tabKind === "url" || tab.draftText == null) return;
    if (!api.isTauri()) {
      setError(tr("resources.saveFailed"));
      return;
    }
    if (!isResourceDraftDirty(tab.draftText, tab.baselineText) && !opts?.force) {
      return;
    }
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tab.id ? { ...t, saving: true, error: null } : t,
      ),
    );
    setError(null);
    try {
      const expected = opts?.force ? null : tab.mtimeMs ?? null;
      const underProject =
        !!projectPath &&
        tab.relativePath &&
        !tab.relativePath.startsWith("/") &&
        !/^[A-Za-z]:[\\/]/.test(tab.relativePath) &&
        (tab.absolutePath
          ? normalizePath(tab.absolutePath).startsWith(
              normalizePath(projectPath) + "/",
            ) ||
            normalizePath(tab.absolutePath) === normalizePath(projectPath)
          : true);

      let w: api.FsWriteResult;
      if (underProject && projectPath) {
        w = await api.fsWriteFile(
          projectPath,
          tab.relativePath,
          tab.draftText,
          expected,
        );
      } else if (tab.absolutePath) {
        w = await api.fsWriteAbsolute(
          tab.absolutePath,
          tab.draftText,
          expected,
        );
      } else {
        throw new Error(tr("resources.saveNoPath"));
      }

      const savedText = tab.draftText ?? "";
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                saving: false,
                baselineText: savedText,
                draftText: savedText,
                mtimeMs: w.mtimeMs,
                absolutePath: w.absolutePath || t.absolutePath,
                preview: t.preview
                  ? {
                      ...t.preview,
                      text: savedText,
                      size: w.size,
                      mtimeMs: w.mtimeMs,
                      truncated: false,
                    }
                  : t.preview,
              }
            : t,
        ),
      );
    } catch (e) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id ? { ...t, saving: false } : t,
        ),
      );
      if (isFsWriteConflict(e)) {
        setConflictTabId(tab.id);
      } else {
        setError(String(e) || tr("resources.saveFailed"));
      }
    }
  },
  [activeId, projectPath, tabs, tr],
);

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
    (t) => t.tabKind !== "url" && fileTabMatchesPath(t, relativePath),
  );
  const keyPath = existing
    ? fileTabToResourceTab(existing).path
    : relativePath;
  const open = openResourceTab(
    tabs.map(fileTabToResourceTab),
    keyPath,
    existing
      ? {
          id: existing.id,
          name: existing.name,
          kind: existing.preview?.kind,
        }
      : { name: baseName(relativePath) },
  );
  if (!open.created) {
    setTabs((prev) => mergeFileTabsFromOpen(prev, open));
    setActiveId(open.activeId);
    return;
  }
  const id = open.activeId;
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
  setTabs((prev) => mergeFileTabsFromOpen(prev, open, tab));
  setActiveId(id);
  try {
    const r = await api.fsReadFile(projectPath, relativePath);
    const src = await resolvePreviewSrc(r);
    applyReadResult(id, r, src, relativePath);
  } catch (e) {
    const msg = String(e || "");
    if (/not a file/i.test(msg)) {
      setTabs((prev) => prev.filter((t) => t.id !== id));
      setActiveId((cur) => (cur === id ? null : cur));
      return;
    }
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
  async (
    absolutePath: string,
    title?: string,
    opts?: { line?: number | null; column?: number | null },
  ) => {
    if (!api.isTauri()) {
      setError(tr("resources.openFailed"));
      return;
    }
    const norm = absolutePath.trim();
    if (!norm) return;
    const focusLine =
      opts?.line != null && Number.isInteger(opts.line) && opts.line >= 1
        ? opts.line
        : null;
    const focusColumn =
      opts?.column != null &&
      Number.isInteger(opts.column) &&
      opts.column >= 1
        ? opts.column
        : null;
    const existing = tabs.find(
      (t) => t.tabKind !== "url" && fileTabMatchesPath(t, norm),
    );
    const keyPath = existing ? fileTabToResourceTab(existing).path : norm;
    const open = openResourceTab(
      tabs.map(fileTabToResourceTab),
      keyPath,
      existing
        ? {
            id: existing.id,
            name: title || existing.name,
            kind: existing.preview?.kind,
          }
        : { name: title || baseName(norm) },
    );
    if (!open.created) {
      // Move existing to front + activate (Chrome-like focus / MRU)
      // Refresh focus line when re-opening the same path from a citation.
      setTabs((prev) =>
        mergeFileTabsFromOpen(prev, open).map((t) =>
          t.id === open.activeId
            ? { ...t, focusLine, focusColumn }
            : t,
        ),
      );
      setActiveId(open.activeId);
      return;
    }
    const id = open.activeId;
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
      focusLine,
      focusColumn,
    };
    setTabs((prev) => mergeFileTabsFromOpen(prev, open, tab));
    setActiveId(id);
    try {
      // Chat file cards already hand us absolute paths — read directly.
      // Smart open (suffix walk under monorepos) is only for relative tokens.
      const looksAbs =
        norm.startsWith("/") ||
        /^[A-Za-z]:[\\/]/.test(norm) ||
        norm.startsWith("\\\\");
      const r = looksAbs
        ? await api.fsReadAbsolute(norm)
        : await api.fsOpenPath(norm, projectPath);
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
      // applyReadResult replaces the tab fields — re-apply focus after read.
      if (focusLine != null || focusColumn != null) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, focusLine, focusColumn } : t,
          ),
        );
      }
    } catch (e) {
      // Directory / non-file: drop the tab so the preview shows empty placeholder.
      const msg = String(e || "");
      if (/not a file/i.test(msg)) {
        setTabs((prev) => prev.filter((t) => t.id !== id));
        setActiveId((cur) => (cur === id ? null : cur));
        return;
      }
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

const openChangeInPane = useCallback(
  (path: string) => {
    const p = normalizePath(path);
    if (!p) return;
    void openAbsoluteFile(p, pathBaseName(p));
  },
  [openAbsoluteFile],
);

const openUrl = useCallback(
  (url: string, title?: string) => {
    const u = url.trim();
    if (!u) return;
    const existing = tabs.find(
      (t) => t.tabKind === "url" && fileTabMatchesPath(t, u),
    );
    let name = title || u;
    try {
      name = title || new URL(u).hostname || u;
    } catch {
      /* keep */
    }
    const keyPath = existing ? fileTabToResourceTab(existing).path : u;
    const open = openResourceTab(
      tabs.map(fileTabToResourceTab),
      keyPath,
      existing
        ? { id: existing.id, name: title || existing.name, kind: "url" }
        : { name, kind: "url" },
    );
    if (!open.created) {
      setTabs((prev) => mergeFileTabsFromOpen(prev, open));
      setActiveId(open.activeId);
      return;
    }
    const id = open.activeId;
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
    setTabs((prev) => mergeFileTabsFromOpen(prev, open, tab));
    setActiveId(id);
  },
  [tabs],
);

const closePaneIfNoTabs = useCallback(
  (remaining: number) => {
    if (remaining === 0) onClose?.();
  },
  [onClose],
);

const closeTabForced = useCallback(
  (id: string) => {
    let remaining = -1;
    setTabs((prev) => {
      const closed = closeResourceTab(
        prev.map(fileTabToResourceTab),
        activeId,
        id,
      );
      remaining = closed.tabs.length;
      setActiveId(closed.activeId);
      if (closed.tabs.length === prev.length) return prev;
      const keep = new Set(closed.tabs.map((t) => t.id));
      // Preserve pure-helper order (same relative order minus closed).
      const byId = new Map(prev.map((t) => [t.id, t]));
      return closed.tabs
        .map((r) => byId.get(r.id))
        .filter((t): t is FileTab => !!t && keep.has(t.id));
    });
    if (remaining === 0) closePaneIfNoTabs(0);
  },
  [activeId, closePaneIfNoTabs],
);

const closeTab = useCallback(
  (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (tab && isResourceDraftDirty(tab.draftText, tab.baselineText)) {
      setDiscardTabId(id);
      return;
    }
    closeTabForced(id);
  },
  [closeTabForced, tabs],
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
  return {
    tabs,
    setTabs,
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
  };
}
