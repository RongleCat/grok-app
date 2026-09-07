/**
 * Command-palette search: open/query/filters, journal scan, and keyboard nav.
 * Persistence lives here. Action dispatch and session open stay with the host.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createT } from "@/i18n";
import { sessionsSearch } from "@/lib/api";
import { installDialogFocus } from "@/lib/a11yFocus";
import {
  defaultPaletteActions,
  filterPaletteActions,
  type PaletteActionDef,
} from "@/lib/paletteActions";
import {
  flattenSearchPanelItems,
  type SearchPanelItem,
} from "@/lib/searchPanelNav";
import { useSearchPanelNav } from "@/hooks/useSearchPanelNav";
import {
  clearSessionSearchFilters,
  filterSessionSearch,
  hasActiveSessionSearchFilters,
  mergeSessionSearchHits,
  resolveSessionSearchEmptyState,
  shouldScanSessionContent,
  type MergedSessionHit,
  type SearchableProject,
  type SessionContentHit,
  type SessionSearchMode,
  type SessionSearchRankMode,
} from "@/lib/sessionSearch";
import {
  loadSessionSearchFilterPref,
  saveSessionSearchFilterPref,
  SESSION_SEARCH_FILTER_CHANGE_EVENT,
} from "@/lib/sessionSearchFilterPref";
import {
  loadSessionSearchRankPref,
  saveSessionSearchRankPref,
  SESSION_SEARCH_RANK_CHANGE_EVENT,
} from "@/lib/sessionSearchRankPref";

type TFn = ReturnType<typeof createT>;

export type SearchPaletteSession = {
  id: string;
  title: string;
  projectId: string | null;
  archived?: boolean;
};

export type SearchPaletteProject = {
  id: string;
  name: string;
  path: string;
};

export function useSearchPalette(opts: {
  sessions: readonly SearchPaletteSession[];
  projects: readonly SearchPaletteProject[];
  tr: TFn;
  onRunAction: (action: PaletteActionDef) => void;
  onPickProject: (project: SearchableProject) => void;
  onPickSession: (hit: MergedSessionHit) => void;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const searchPanelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SessionSearchMode>(
    () => loadSessionSearchFilterPref().mode,
  );
  const [includeArchived, setIncludeArchived] = useState(
    () => loadSessionSearchFilterPref().includeArchived,
  );
  const [rankMode, setRankMode] = useState<SessionSearchRankMode>(
    () => loadSessionSearchRankPref(),
  );
  const [contentHits, setContentHits] = useState<SessionContentHit[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const contentSeq = useRef(0);

  const openPalette = useCallback(() => setOpen(true), []);
  const openBlank = useCallback(() => {
    setQuery("");
    setOpen(true);
  }, []);
  const closePalette = useCallback(() => setOpen(false), []);

  const applyMode = useCallback((next: SessionSearchMode) => {
    setMode(next);
    saveSessionSearchFilterPref({ mode: next });
  }, []);

  const applyIncludeArchived = useCallback((next: boolean) => {
    setIncludeArchived(next);
    saveSessionSearchFilterPref({ includeArchived: next });
  }, []);

  const applyRankMode = useCallback((next: SessionSearchRankMode) => {
    setRankMode(next);
    saveSessionSearchRankPref(next);
  }, []);

  const clearFilters = useCallback(() => {
    const next = clearSessionSearchFilters();
    setMode(next.mode);
    setIncludeArchived(next.includeArchived);
    saveSessionSearchFilterPref(next);
  }, []);

  useEffect(() => {
    if (!open) return;
    return installDialogFocus(() => searchPanelRef.current, {
      onEscape: () => setOpen(false),
      capture: true,
      initialFocus: "none",
      restoreFocus: true,
    });
  }, [open]);

  useEffect(() => {
    const syncRank = () => setRankMode(loadSessionSearchRankPref());
    const syncFilters = () => {
      const f = loadSessionSearchFilterPref();
      setMode(f.mode);
      setIncludeArchived(f.includeArchived);
    };
    const syncAll = () => {
      syncRank();
      syncFilters();
    };
    const onRank = (e: Event) => {
      const detail = (e as CustomEvent<SessionSearchRankMode>).detail;
      if (detail === "hybrid" || detail === "keyword") {
        setRankMode(detail);
      } else {
        syncRank();
      }
    };
    const onFilter = (e: Event) => {
      const detail = (
        e as CustomEvent<{ mode?: SessionSearchMode; includeArchived?: boolean }>
      ).detail;
      if (detail && typeof detail === "object") {
        if (
          detail.mode === "all" ||
          detail.mode === "title" ||
          detail.mode === "content"
        ) {
          setMode(detail.mode);
        }
        if (typeof detail.includeArchived === "boolean") {
          setIncludeArchived(detail.includeArchived);
        }
      } else {
        syncFilters();
      }
    };
    window.addEventListener(SESSION_SEARCH_RANK_CHANGE_EVENT, onRank);
    window.addEventListener(SESSION_SEARCH_FILTER_CHANGE_EVENT, onFilter);
    window.addEventListener("storage", syncAll);
    return () => {
      window.removeEventListener(SESSION_SEARCH_RANK_CHANGE_EVENT, onRank);
      window.removeEventListener(SESSION_SEARCH_FILTER_CHANGE_EVENT, onFilter);
      window.removeEventListener("storage", syncAll);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setContentHits([]);
      setContentLoading(false);
      return;
    }
    const q = query.trim();
    if (!shouldScanSessionContent(q, mode)) {
      setContentHits([]);
      setContentLoading(false);
      return;
    }
    setContentLoading(true);
    const seq = ++contentSeq.current;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const hits = await sessionsSearch(q, 20);
          if (contentSeq.current !== seq) return;
          setContentHits(
            hits.map((h) => ({
              id: h.id,
              title: h.title,
              projectId: h.projectId,
              snippet: h.snippet,
              matchCount: h.matchCount,
              updatedAt: h.updatedAt,
              archived: h.archived,
            })),
          );
        } catch {
          if (contentSeq.current !== seq) return;
          setContentHits([]);
        } finally {
          if (contentSeq.current === seq) {
            setContentLoading(false);
          }
        }
      })();
    }, 280);
    return () => {
      // A dispatched IPC cannot be cancelled by clearing its debounce timer.
      // Invalidate late success, failure and finally callbacks on close/unmount.
      contentSeq.current += 1;
      window.clearTimeout(t);
    };
  }, [query, open, mode]);

  const searchHits = useMemo(
    () =>
      filterSessionSearch(
        query,
        opts.sessions.map((s) => ({
          id: s.id,
          title: s.title,
          projectId: s.projectId,
          archived: s.archived,
        })),
        opts.projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
        { includeArchived, mode, rankMode },
      ),
    [query, opts.sessions, opts.projects, includeArchived, mode, rankMode],
  );

  const sessionHits = useMemo(
    () =>
      mergeSessionSearchHits(query, searchHits.matchedSessions, contentHits, {
        includeArchived,
        mode,
        rankMode,
      }),
    [
      query,
      searchHits.matchedSessions,
      contentHits,
      includeArchived,
      mode,
      rankMode,
    ],
  );

  const actions = useMemo(
    () => filterPaletteActions(query, defaultPaletteActions(), opts.tr),
    [query, opts.tr],
  );

  const items = useMemo(
    () =>
      flattenSearchPanelItems({
        actions,
        projects: searchHits.matchedProjects,
        sessions: sessionHits,
      }),
    [actions, searchHits.matchedProjects, sessionHits],
  );

  const emptyState = useMemo(
    () =>
      resolveSessionSearchEmptyState({
        query,
        sessionHitCount: sessionHits.length,
        contentLoading,
        mode,
        includeArchived,
        rankMode,
      }),
    [query, sessionHits.length, contentLoading, mode, includeArchived, rankMode],
  );

  const filtersActive = useMemo(
    () => hasActiveSessionSearchFilters({ mode, includeArchived }),
    [mode, includeArchived],
  );

  const activateItem = useCallback((item: SearchPanelItem) => {
    const o = optsRef.current;
    if (item.kind === "action") {
      const action = actions.find((a) => a.id === item.id);
      if (!action) return;
      setOpen(false);
      setQuery("");
      o.onRunAction(action);
      return;
    }
    if (item.kind === "project") {
      const p = searchHits.matchedProjects.find((x) => x.id === item.id);
      if (!p) return;
      setOpen(false);
      o.onPickProject(p);
      return;
    }
    const hit = sessionHits.find((h) => h.id === item.id);
    if (!hit) return;
    setOpen(false);
    o.onPickSession(hit);
  }, [actions, searchHits.matchedProjects, sessionHits]);

  const { activeIndex, setActiveIndex } = useSearchPanelNav({
    open,
    items,
    sessionCount: sessionHits.length,
    resetKey: [query, mode, rankMode, String(includeArchived)].join("\0"),
    getRoot: () => searchPanelRef.current,
    onActivate: activateItem,
    onActivateSessionIndex: (sessionIndex) => {
      const hit = sessionHits[sessionIndex];
      if (hit) activateItem({ kind: "session", id: hit.id });
    },
  });

  const runAction = useCallback(
    (action: PaletteActionDef) => {
      setOpen(false);
      setQuery("");
      optsRef.current.onRunAction(action);
    },
    [],
  );

  const pickProject = useCallback((project: SearchableProject) => {
    setOpen(false);
    optsRef.current.onPickProject(project);
  }, []);

  const pickSession = useCallback((hit: MergedSessionHit) => {
    setOpen(false);
    optsRef.current.onPickSession(hit);
  }, []);

  return {
    open,
    query,
    mode,
    rankMode,
    includeArchived,
    filtersActive,
    activeIndex,
    items,
    actions,
    projects: searchHits.matchedProjects,
    sessionHits,
    contentLoading,
    emptyState,
    panelRef: searchPanelRef,
    openPalette,
    openBlank,
    closePalette,
    setQuery: (value: string) => setQuery(value),
    applyMode,
    applyRankMode,
    applyIncludeArchived,
    clearFilters,
    setActiveIndex,
    runAction,
    pickProject,
    pickSession,
  };
}
