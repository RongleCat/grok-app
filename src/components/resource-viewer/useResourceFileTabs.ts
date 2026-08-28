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
  RESOURCE_TABS_MAX,
  closeActiveResourceTab,
  closeResourceTab,
  openResourceTab,
  resolveResourceTabsAllDirtySoftFail,
  resolveResourceTabsCapSoftFail,
  resolveResourceTabsEmptyState,
  shouldConfirmCloseResourceTab,
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
  /** When set, list/read/write go through OpenSSH, not local fs. */
  sshAlias?: string | null;
  sideMode: SideMode;
  tr: (key: MessageKey, vars?: Record<string, string>) => string;
  setError: Dispatch<SetStateAction<string | null>>;
  onClose?: () => void;
};

export function useResourceFileTabs({
  projectPath,
  sshAlias = null,
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

  /** Soft-fail honesty when LRU drops tabs at the cap (never invents success). */
  const notifyCapSoftFail = useCallback(
    (open: {
      droppedIds: string[];
      droppedDirty?: boolean;
      refusedAllDirty?: boolean;
    }) => {
      const allDirty = resolveResourceTabsAllDirtySoftFail({
        refusedAllDirty: open.refusedAllDirty,
        max: RESOURCE_TABS_MAX,
      });
      if (allDirty) {
        setError(tr(allDirty.messageKey, { max: String(allDirty.max) }));
        return;
      }
      const notice = resolveResourceTabsCapSoftFail({
        droppedIds: open.droppedIds,
        droppedDirty: open.droppedDirty,
        max: RESOURCE_TABS_MAX,
      });
      if (!notice) return;
      const key = notice.droppedDirty
        ? notice.dirtyMessageKey
        : notice.messageKey;
      setError(
        tr(key, {
          max: String(notice.max),
          count: String(notice.droppedCount),
        }),
      );
    },
    [setError, tr],
  );

  /** Dirty path keys for side-tab honesty (absolute or relative). */
  const dirtyPaths = useMemo(() => {
    const out: string[] = [];
    for (const t of tabs) {
      if (t.tabKind === "url") continue;
      if (!isResourceDraftDirty(t.draftText, t.baselineText)) continue;
      if (t.absolutePath) out.push(t.absolutePath);
      if (t.relativePath) out.push(t.relativePath);
    }
    return out;
  }, [tabs]);

  const isPathDirty = useCallback(
    (path: string) => {
      const p = (path || "").trim();
      if (!p) return false;
      return tabs.some(
        (t) =>
          t.tabKind !== "url" &&
          fileTabMatchesPath(t, p) &&
          isResourceDraftDirty(t.draftText, t.baselineText),
      );
    },
    [tabs],
  );

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
  setError(null);
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
            error: null,
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
    if (sshAlias && projectPath && tab.relativePath) {
      r = await api.sshReadFile(sshAlias, projectPath, tab.relativePath);
    } else if (projectPath && tab.relativePath && !tab.relativePath.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(tab.relativePath)) {
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
}, [activeId, projectPath, sshAlias, tabs, tr]);

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
      if (sshAlias && projectPath && tab.relativePath) {
        w = await api.sshWriteFile(
          sshAlias,
          projectPath,
          tab.relativePath,
          tab.draftText,
          expected,
        );
      } else if (underProject && projectPath) {
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
  [activeId, projectPath, sshAlias, tabs, tr],
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
  if (open.refusedAllDirty) {
    notifyCapSoftFail(open);
    return;
  }
  if (!open.created) {
    setTabs((prev) => mergeFileTabsFromOpen(prev, open));
    setActiveId(open.activeId);
    return;
  }
  notifyCapSoftFail(open);
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
    const r = sshAlias
      ? await api.sshReadFile(sshAlias, projectPath, relativePath)
      : await api.fsReadFile(projectPath, relativePath);
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
    if (open.refusedAllDirty) {
      notifyCapSoftFail(open);
      return;
    }
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
    notifyCapSoftFail(open);
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
      let r: api.FsReadResult;
      if (sshAlias && projectPath) {
        const root = projectPath.replace(/[/\\]+$/, "").replace(/\\/g, "/");
        const abs = norm.replace(/\\/g, "/");
        const rel =
          abs === root
            ? ""
            : abs.startsWith(`${root}/`)
              ? abs.slice(root.length + 1)
              : !abs.startsWith("/")
                ? abs
                : "";
        if (abs.startsWith("/") && rel === "" && abs !== root) {
          throw new Error("path outside project");
        }
        r = await api.sshReadFile(sshAlias, projectPath, rel);
      } else {
        r = looksAbs
          ? await api.fsReadAbsolute(norm)
          : await api.fsOpenPath(norm, projectPath);
      }
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
  [notifyCapSoftFail, projectPath, sshAlias, tabs, tr],
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
    if (open.refusedAllDirty) {
      notifyCapSoftFail(open);
      return;
    }
    if (!open.created) {
      setTabs((prev) => mergeFileTabsFromOpen(prev, open));
      setActiveId(open.activeId);
      return;
    }
    notifyCapSoftFail(open);
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
  [notifyCapSoftFail, tabs],
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
    const slim = tabs.map(fileTabToResourceTab);
    if (shouldConfirmCloseResourceTab(slim, id)) {
      setDiscardTabId(id);
      return;
    }
    closeTabForced(id);
  },
  [closeTabForced, tabs],
);

/** Close active tab (dirty → discard modal). */
const closeActiveTab = useCallback(() => {
  const slim = tabs.map(fileTabToResourceTab);
  const next = closeActiveResourceTab(slim, activeId);
  const closingId = activeId ?? tabs[0]?.id;
  if (!closingId || next.tabs.length === slim.length) return;
  closeTab(closingId);
}, [activeId, closeTab, tabs]);

/** Chrome-style: close every tab except `id` (dirty others → first discard). */
const closeOtherTabs = useCallback(
  (id: string) => {
    const dirtyOther = tabs.find(
      (t) =>
        t.id !== id && isResourceDraftDirty(t.draftText, t.baselineText),
    );
    if (dirtyOther) {
      setDiscardTabId(dirtyOther.id);
      return;
    }
    setTabs((prev) => prev.filter((t) => t.id === id));
    setActiveId(id);
  },
  [tabs],
);

/** Close tabs visually to the right of `id` (higher index; older tabs). */
const closeTabsToRight = useCallback(
  (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const victims = tabs.slice(idx + 1);
    const dirty = victims.find((t) =>
      isResourceDraftDirty(t.draftText, t.baselineText),
    );
    if (dirty) {
      setDiscardTabId(dirty.id);
      return;
    }
    let remaining = -1;
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.id === id);
      if (i < 0) {
        remaining = prev.length;
        return prev;
      }
      const next = prev.slice(0, i + 1);
      remaining = next.length;
      if (activeId && !next.some((t) => t.id === activeId)) {
        setActiveId(id);
      }
      return next;
    });
    if (remaining === 0) closePaneIfNoTabs(0);
  },
  [activeId, closePaneIfNoTabs, tabs],
);

/** Close tabs visually to the left of `id` (lower index; newer tabs). */
const closeTabsToLeft = useCallback(
  (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const victims = tabs.slice(0, idx);
    const dirty = victims.find((t) =>
      isResourceDraftDirty(t.draftText, t.baselineText),
    );
    if (dirty) {
      setDiscardTabId(dirty.id);
      return;
    }
    let remaining = -1;
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.id === id);
      if (i < 0) {
        remaining = prev.length;
        return prev;
      }
      const next = prev.slice(i);
      remaining = next.length;
      if (activeId && !next.some((t) => t.id === activeId)) {
        setActiveId(id);
      }
      return next;
    });
    if (remaining === 0) closePaneIfNoTabs(0);
  },
  [activeId, closePaneIfNoTabs, tabs],
);

const closeAllTabs = useCallback(() => {
  const dirty = tabs.find((t) =>
    isResourceDraftDirty(t.draftText, t.baselineText),
  );
  if (dirty) {
    setDiscardTabId(dirty.id);
    return;
  }
  setTabs([]);
  setActiveId(null);
  closePaneIfNoTabs(0);
}, [closePaneIfNoTabs, tabs]);

/** Close by path (side-tab bridge); dirty → discard modal. Returns whether closed now. */
const closeByPath = useCallback(
  (path: string): boolean => {
    const p = (path || "").trim();
    if (!p) return true;
    const tab = tabs.find(
      (t) => t.tabKind !== "url" && fileTabMatchesPath(t, p),
    );
    if (!tab) return true;
    if (isResourceDraftDirty(tab.draftText, tab.baselineText)) {
      setDiscardTabId(tab.id);
      return false;
    }
    closeTabForced(tab.id);
    return true;
  },
  [closeTabForced, tabs],
);

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
    dirtyPaths,
    isPathDirty,
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
    closeActiveTab,
    closeByPath,
    closeOtherTabs,
    closeTabsToRight,
    closeTabsToLeft,
    closeAllTabs,
  };
}
