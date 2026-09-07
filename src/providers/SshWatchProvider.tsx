/**
 * Shared SSH watch state: enabled aliases, polled remote sessions, draft remote.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";
import { SSH_REMOTE_PAGE_SIZE, remoteTitleKey } from "@/lib/sshRemoteSessionDisplay";

export type SshDraftRemote = {
  alias: string;
  path: string;
};

const TITLES_KEY = "grok-app.sshRemoteTitles";

function loadTitleOverlay(): Record<string, string> {
  try {
    if (typeof window === "undefined" || !window.localStorage) return {};
    const raw = window.localStorage.getItem(TITLES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function saveTitleOverlay(map: Record<string, string>) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(TITLES_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode */
  }
}

type Ctx = {
  watchAliases: string[];
  sessionsByAlias: Record<string, api.SshRemoteSession[]>;
  totalsByAlias: Record<string, number>;
  titleOverlay: Record<string, string>;
  draftRemote: SshDraftRemote | null;
  setDraftRemote: (next: SshDraftRemote | null) => void;
  enableWatch: (alias: string) => Promise<api.SshWatchResult>;
  disableWatch: (alias: string) => Promise<api.SshWatchResult>;
  refreshSessions: (alias?: string) => Promise<void>;
  loadMore: (alias: string) => Promise<void>;
  renameRemoteSession: (alias: string, id: string, title: string) => void;
};

const SshWatchContext = createContext<Ctx | null>(null);

const POLL_MS = 20_000;

/**
 * Poll results usually identical to the previous page — avoid propagating a
 * new sessionsByAlias/totalsByAlias identity (and re-rendering every
 * consumer) when nothing changed.
 */
function sshSessionsEqual(
  a: api.SshRemoteSession[] | undefined,
  b: api.SshRemoteSession[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}

/** Merge fetched pages into prev, keeping prev identity when nothing changed. */
function mergeSessionsByAlias(
  prev: Record<string, api.SshRemoteSession[]>,
  fetched: Record<string, api.SshRemoteSession[]>,
): Record<string, api.SshRemoteSession[]> {
  let changed = false;
  const next: Record<string, api.SshRemoteSession[]> = { ...prev };
  for (const alias of Object.keys(fetched)) {
    if (!sshSessionsEqual(prev[alias], fetched[alias])) {
      next[alias] = fetched[alias];
      changed = true;
    }
  }
  return changed ? next : prev;
}

function mergeTotalsByAlias(
  prev: Record<string, number>,
  fetched: Record<string, number>,
): Record<string, number> {
  let changed = false;
  const next: Record<string, number> = { ...prev };
  for (const alias of Object.keys(fetched)) {
    if (prev[alias] !== fetched[alias]) {
      next[alias] = fetched[alias];
      changed = true;
    }
  }
  return changed ? next : prev;
}

export function SshWatchProvider({ children }: { children: ReactNode }) {
  const [watchAliases, setWatchAliases] = useState<string[]>([]);
  const [sessionsByAlias, setSessionsByAlias] = useState<
    Record<string, api.SshRemoteSession[]>
  >({});
  const [totalsByAlias, setTotalsByAlias] = useState<Record<string, number>>(
    {},
  );
  const [pageByAlias, setPageByAlias] = useState<Record<string, number>>({});
  const [titleOverlay, setTitleOverlay] = useState<Record<string, string>>(
    loadTitleOverlay,
  );
  const [draftRemote, setDraftRemote] = useState<SshDraftRemote | null>(null);

  const hydrate = useCallback(async () => {
    if (!api.isTauri()) return;
    try {
      const s = await api.settingsGet();
      const aliases = (s.sshWatchAliases ?? []).filter(Boolean);
      setWatchAliases(aliases);
    } catch {
      /* soft-fail */
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const fetchAlias = useCallback(async (alias: string, limit: number) => {
    const r = await api.sshListSessions(alias, { offset: 0, limit });
    return {
      sessions: r.ok ? r.sessions : [],
      total: r.ok ? (r.total ?? r.sessions.length) : 0,
    };
  }, []);

  const refreshSessions = useCallback(async (alias?: string) => {
    if (!api.isTauri()) return;
    const targets = alias ? [alias] : watchAliases;
    if (targets.length === 0) return;
    const nextSessions: Record<string, api.SshRemoteSession[]> = {};
    const nextTotals: Record<string, number> = {};
    await Promise.all(
      targets.map(async (a) => {
        const limit = pageByAlias[a] ?? SSH_REMOTE_PAGE_SIZE;
        try {
          const r = await fetchAlias(a, limit);
          nextSessions[a] = r.sessions;
          nextTotals[a] = r.total;
        } catch {
          nextSessions[a] = [];
          nextTotals[a] = 0;
        }
      }),
    );
    setSessionsByAlias((prev) => mergeSessionsByAlias(prev, nextSessions));
    setTotalsByAlias((prev) => mergeTotalsByAlias(prev, nextTotals));
  }, [watchAliases, pageByAlias, fetchAlias]);

  useEffect(() => {
    if (watchAliases.length === 0) {
      setSessionsByAlias({});
      setTotalsByAlias({});
      return;
    }
    void refreshSessions();
    const t = window.setInterval(() => {
      void refreshSessions();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [watchAliases, refreshSessions]);

  const enableWatch = useCallback(async (alias: string) => {
    const r = await api.sshWatchStart(alias);
    if (r.ok) {
      setWatchAliases((prev) =>
        prev.includes(alias) ? prev : [...prev, alias],
      );
      setPageByAlias((prev) => ({
        ...prev,
        [alias]: prev[alias] ?? SSH_REMOTE_PAGE_SIZE,
      }));
      void refreshSessions(alias);
    }
    return r;
  }, [refreshSessions]);

  const disableWatch = useCallback(async (alias: string) => {
    const r = await api.sshWatchStop(alias);
    if (r.ok) {
      setWatchAliases((prev) => prev.filter((a) => a !== alias));
      setSessionsByAlias((prev) => {
        const n = { ...prev };
        delete n[alias];
        return n;
      });
      setTotalsByAlias((prev) => {
        const n = { ...prev };
        delete n[alias];
        return n;
      });
      setPageByAlias((prev) => {
        const n = { ...prev };
        delete n[alias];
        return n;
      });
      setDraftRemote((cur) => (cur?.alias === alias ? null : cur));
    }
    return r;
  }, []);

  const loadMore = useCallback(async (alias: string) => {
    const next = (pageByAlias[alias] ?? SSH_REMOTE_PAGE_SIZE) + SSH_REMOTE_PAGE_SIZE;
    setPageByAlias((prev) => ({ ...prev, [alias]: next }));
    if (!api.isTauri()) return;
    try {
      const r = await fetchAlias(alias, next);
      setSessionsByAlias((prev) =>
        mergeSessionsByAlias(prev, { [alias]: r.sessions }),
      );
      setTotalsByAlias((prev) =>
        mergeTotalsByAlias(prev, { [alias]: r.total }),
      );
    } catch {
      /* keep current page */
    }
  }, [pageByAlias, fetchAlias]);

  const renameRemoteSession = useCallback(
    (alias: string, id: string, title: string) => {
      const key = remoteTitleKey(alias, id);
      setTitleOverlay((prev) => {
        const next = { ...prev };
        const trimmed = title.trim();
        if (trimmed) next[key] = trimmed;
        else delete next[key];
        saveTitleOverlay(next);
        return next;
      });
    },
    [],
  );

  const value = useMemo<Ctx>(
    () => ({
      watchAliases,
      sessionsByAlias,
      totalsByAlias,
      titleOverlay,
      draftRemote,
      setDraftRemote,
      enableWatch,
      disableWatch,
      refreshSessions,
      loadMore,
      renameRemoteSession,
    }),
    [
      watchAliases,
      sessionsByAlias,
      totalsByAlias,
      titleOverlay,
      draftRemote,
      enableWatch,
      disableWatch,
      refreshSessions,
      loadMore,
      renameRemoteSession,
    ],
  );

  return (
    <SshWatchContext.Provider value={value}>{children}</SshWatchContext.Provider>
  );
}

export function useSshWatch(): Ctx {
  const ctx = useContext(SshWatchContext);
  if (!ctx) {
    return {
      watchAliases: [],
      sessionsByAlias: {},
      totalsByAlias: {},
      titleOverlay: {},
      draftRemote: null,
      setDraftRemote: () => {},
      enableWatch: async (alias) => ({
        ok: false,
        alias,
        watching: false,
        error: "no provider",
      }),
      disableWatch: async (alias) => ({
        ok: true,
        alias,
        watching: false,
      }),
      refreshSessions: async () => {},
      loadMore: async () => {},
      renameRemoteSession: () => {},
    };
  }
  return ctx;
}
