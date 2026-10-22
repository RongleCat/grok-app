/**
 * usePrMonitor — one chat's PR watches, and the repository's PR list.
 *
 * The host owns the watches: it polls each one, reads a change, delivers the
 * follow-up turn into this chat and pushes the rows (`pr-monitor://state`) plus
 * each wake's outcome (`pr-monitor://wake`). So this hook reads the repo's open
 * PRs once per menu open, reads this chat's watches on subscribe, and then
 * renders what the host pushes. A project change while a read is in flight
 * starts that project's read when the old one finishes.
 *
 * The watch read is also a reconcile, not only a subscribe: the host's push is
 * the primary path, but an agent can mount a watch while this webview has no
 * listener (window hidden or recreated), and the push is not replayed. So the
 * rows are read again when the branch menu opens — the moment the state becomes
 * visible to a person — and once after a bell click. Nothing reads them on a
 * timer or on a window event, so a background window stays quiet.
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
  /** Re-read this chat's watches from the host (menu open, bell click). */
  refreshWatches: () => void;
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
  /** Only the newest watch read may land; an older answer must not roll back. */
  const watchReadSeq = useRef(0);
  /** Host revision of the rows on screen: an older push must not overwrite them. */
  const lastRevision = useRef(0);

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

  // ── This chat's watches: reads that reconcile, then the host's pushes ──────
  const refreshWatches = useCallback(() => {
    const sid = sessionRef.current;
    if (!sid) {
      setWatches([]);
      return;
    }
    // A mirror client has no host to ask; its rows only arrive as pushes, and
    // an empty local answer would wipe them.
    if (!api.isDesktopHost()) return;
    const seq = watchReadSeq.current + 1;
    watchReadSeq.current = seq;
    void (async () => {
      try {
        const state = await api.prMonitorState(sid);
        if (seq !== watchReadSeq.current || sessionRef.current !== sid) return;
        const revision = Number(state?.revision ?? 0);
        if (revision < lastRevision.current) return;
        lastRevision.current = revision;
        setWatches(Array.isArray(state?.watches) ? state.watches : []);
      } catch {
        // Soft read: the host keeps pushing, so the rows stay live either way.
      }
    })();
  }, []);

  useEffect(() => {
    watchReadSeq.current += 1; // a read of the previous chat must not land
    lastRevision.current = 0;
    // Rows belong to one chat: never let the previous chat's rows render here.
    setWatches([]);
    if (!sessionId) return;
    let cancelled = false;
    const unlisten: Array<() => void> = [];
    // Subscribe first, then read: a push that lands between the read and the
    // listener would otherwise be lost, and the read answer would be older.
    void (async () => {
      const offs: Array<() => void> = [];
      try {
        offs.push(
          await api.onPrMonitorState((payload) => {
            if (!payload || payload.sessionId !== sessionRef.current) return;
            const revision = Number(payload.revision ?? 0);
            // A push emitted before a read we already applied must not roll
            // the rows back; a push at the same revision carries the same rows.
            if (revision < lastRevision.current) return;
            lastRevision.current = revision;
            // The push is fresher than any read still in flight: drop that read.
            watchReadSeq.current += 1;
            setWatches(Array.isArray(payload.watches) ? payload.watches : []);
          }),
        );
        offs.push(
          await api.onPrMonitorWake((payload) => {
            if (!payload || payload.sessionId !== sessionRef.current) return;
            const notice = describeWake(payload, trRef.current);
            if (notice) optsRef.current.notify?.(notice.text, notice.tone);
          }),
        );
      } catch (e) {
        console.warn("[pr-monitor] listener registration failed", e);
      } finally {
        if (cancelled) {
          for (const off of offs) off();
        } else {
          unlisten.push(...offs);
          // The read needs no listener: run it even if registration failed,
          // which is exactly when the push path is unavailable.
          refreshWatches();
        }
      }
    })();
    // The push is not replayed: a watch the agent mounted while this webview
    // could not hear it is picked up when the menu opens or a bell is clicked
    // (`refreshWatches`). No timer and no window event reads it in the
    // background.
    return () => {
      cancelled = true;
      for (const off of unlisten) off();
    };
  }, [sessionId, refreshWatches]);

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
        // The host pushes the new rows; read them once too, so a dropped push
        // cannot leave a bell that looks like the click did nothing.
        refreshWatches();
      }
    })();
  }, [refreshWatches]);

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
    refreshWatches,
  };
}
