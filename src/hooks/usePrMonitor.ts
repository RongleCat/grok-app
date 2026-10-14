/**
 * usePrMonitor — one chat's PR watches, and the repository's PR list.
 *
 * The host owns the watches: it polls each one, reads a change, delivers the
 * follow-up turn into this chat and pushes the rows (`pr-monitor://state`) plus
 * each wake's outcome (`pr-monitor://wake`). So this hook reads the repo's open
 * PRs once per menu open, reads this chat's watches once on subscribe, and then
 * only renders what the host pushes — it never polls for watch state. A project
 * change while a read is in flight starts that project's read when the old one
 * finishes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createT, type Locale } from "@/i18n";
import * as api from "@/lib/api";
import type { GitPrHubEntry } from "@/lib/gitPrHub";
import {
  describeWake,
  lastChangeOf,
  pendingWakeCount,
  sortPrsForList,
  watchErrorOf,
  type PrMonitorWatchInfo,
} from "@/lib/prMonitor";

export type UsePrMonitorOptions = {
  /** Desktop host with a bound project — the host side needs both. */
  enabled: boolean;
  projectPath: string | null;
  sessionId: string | null;
  locale: Locale;
  /** Short status message for the user (toast). */
  notify?: (message: string, tone: "info" | "error") => void;
};

export type UsePrMonitorResult = {
  /** First repo PR read finished (so the list avoids an empty flash). */
  ready: boolean;
  /** `gh`/git availability as reported by the host; `null` while unknown. */
  available: boolean | null;
  reason: string | null;
  /** Open PRs of this repository, most recently updated first. */
  prs: GitPrHubEntry[];
  /** The watches the host holds for this chat. */
  watches: PrMonitorWatchInfo[];
  /** A repo PR read is in flight. */
  loading: boolean;
  /** This chat can mount a watch (a project and a chat id both exist). */
  canWatch: boolean;
  /** How many PRs this chat follows. */
  watching: number;
  /** Wakes waiting for this chat to go idle. */
  pendingCount: number;
  /** The most recent change a watch delivered, or `null`. */
  lastChange: string | null;
  /** First poll failure the host reported for this chat's watches, or `null`. */
  watchError: string | null;
  /** PR numbers whose watch/unwatch call is in flight. */
  busy: readonly number[];
  /** Start or stop watching one PR of this repository. */
  toggleWatch: (prNumber: number) => void;
  /** Re-read the repository's open PRs (once per menu open, and after a project change). */
  refresh: () => void;
};

export function usePrMonitor(opts: UsePrMonitorOptions): UsePrMonitorResult {
  const { enabled, projectPath, sessionId, locale } = opts;

  const tr = useMemo(() => createT(locale), [locale]);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [prs, setPrs] = useState<GitPrHubEntry[]>([]);
  const [watches, setWatches] = useState<PrMonitorWatchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<readonly number[]>([]);

  // Live refs: the event handlers and callbacks must not re-subscribe per render.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const trRef = useRef(tr);
  trRef.current = tr;
  const sessionRef = useRef<string | null>(sessionId);
  sessionRef.current = sessionId;
  const projectRef = useRef<string | null>(projectPath);
  projectRef.current = projectPath;
  const watchesRef = useRef<readonly PrMonitorWatchInfo[]>(watches);
  watchesRef.current = watches;
  const busyRef = useRef<readonly number[]>(busy);
  busyRef.current = busy;
  const readingRef = useRef(false);
  const refreshRef = useRef<() => void>(() => {});

  /** The repository's open PRs, for the list the menu shows. */
  const refresh = useCallback(() => {
    // One read per appearance: a second request for the same project while the
    // first is in flight would be the same answer twice. A project change
    // during that read is a different question — the finish path asks it.
    if (!projectRef.current || readingRef.current) {
      if (!projectRef.current) {
        setPrs([]);
        setLoading(false);
        setReady(true);
      }
      return;
    }
    const project = projectRef.current;
    readingRef.current = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await api.gitPrList(project, { limit: 30, state: "open" });
        if (projectRef.current !== project) return;
        setAvailable(!!res?.available);
        setReason(res?.reason ?? null);
        setPrs(sortPrsForList(res?.prs ?? []));
      } catch (e) {
        if (projectRef.current !== project) return;
        setAvailable(false);
        setReason(String(e));
        setPrs([]);
      } finally {
        readingRef.current = false;
        const current = projectRef.current;
        if (current !== project) {
          if (current) {
            refreshRef.current();
          } else {
            setPrs([]);
            setLoading(false);
            setReady(true);
          }
        } else {
          setReady(true);
          setLoading(false);
        }
      }
    })();
  }, []);
  refreshRef.current = refresh;

  useEffect(() => {
    setReady(false);
    if (!enabled || !projectPath) {
      setPrs([]);
      setAvailable(enabled ? null : false);
      setReason(null);
      setLoading(false);
      setReady(true);
      return;
    }
    refresh();
  }, [enabled, projectPath, refresh]);

  // ── This chat's watches: one read on subscribe, then the host's pushes ─────
  useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      setWatches([]);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const state = await api.prMonitorState(sessionId);
        if (cancelled) return;
        setWatches(Array.isArray(state?.watches) ? state.watches : []);
      } catch {
        // Soft read: the host keeps pushing, so the rows stay live either way.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const unlisten: Array<() => void> = [];
    void (async () => {
      const offState = await api.onPrMonitorState((payload) => {
        if (!payload || payload.sessionId !== sessionRef.current) return;
        setWatches(Array.isArray(payload.watches) ? payload.watches : []);
      });
      const offWake = await api.onPrMonitorWake((payload) => {
        if (!payload || payload.sessionId !== sessionRef.current) return;
        const notice = describeWake(payload, trRef.current);
        if (notice) optsRef.current.notify?.(notice.text, notice.tone);
      });
      if (cancelled) {
        offState();
        offWake();
        return;
      }
      unlisten.push(offState, offWake);
    })();
    return () => {
      cancelled = true;
      for (const off of unlisten) off();
    };
  }, [sessionId]);

  const toggleWatch = useCallback((prNumber: number) => {
    const sid = sessionRef.current;
    const project = projectRef.current;
    const number = Math.trunc(Number(prNumber));
    if (!sid || !project || !Number.isFinite(number) || number <= 0) return;
    if (busyRef.current.includes(number)) return;
    const stop = watchesRef.current.some((w) => Number(w.prNumber) === number);
    setBusy((prev) => [...prev, number]);
    void (async () => {
      try {
        if (stop) {
          await api.prMonitorUnwatch(sid, number);
          return;
        }
        const res = await api.prMonitorWatch({
          sessionId: sid,
          projectPath: project,
          prNumber: number,
        });
        if (!res?.ok) throw new Error(res?.error || "watch failed");
      } catch (e) {
        optsRef.current.notify?.(
          trRef.current(
            stop ? "prMonitor.unwatchFailed" : "prMonitor.watchFailed",
            { reason: String(e) },
          ),
          "error",
        );
      } finally {
        setBusy((prev) => prev.filter((n) => n !== number));
      }
    })();
  }, []);

  return {
    ready,
    available,
    reason,
    prs,
    watches,
    loading,
    canWatch: enabled && !!projectPath && !!sessionId,
    watching: watches.length,
    pendingCount: pendingWakeCount(watches),
    lastChange: lastChangeOf(watches),
    watchError: watchErrorOf(watches),
    busy,
    toggleWatch,
    refresh,
  };
}
