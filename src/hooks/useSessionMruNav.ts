/**
 * Global Ctrl+Tab / Ctrl+Shift+Tab: switch recently used chats.
 *
 * Same chord on macOS, Windows, and Linux (Cmd+Tab is the OS app switcher).
 * Hold Ctrl and tap Tab to walk a frozen MRU snapshot; release Ctrl to commit.
 */

import { useCallback, useEffect, useRef } from "react";
import { isShortcutRecordingActive } from "@/lib/shortcutRemap";
import {
  beginSessionMruCycle,
  isSessionMruModifierKey,
  loadSessionMru,
  matchSessionMruChord,
  saveSessionMru,
  sessionMruCycleTarget,
  stepSessionMruCycle,
  touchSessionMru,
  type SessionMruCycle,
  type SessionMruDir,
} from "@/lib/sessionMru";

export function useSessionMruNav(opts: {
  getCurrentId: () => string | null | undefined;
  getLiveIds: () => readonly string[];
  openById: (id: string) => void;
  isEnabled?: () => boolean;
}): { noteOpened: (id: string) => void } {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const listRef = useRef<string[]>(loadSessionMru());
  const cycleRef = useRef<SessionMruCycle | null>(null);

  const persist = (next: string[]) => {
    listRef.current = next;
    saveSessionMru(next);
  };

  const commitCycle = () => {
    const cycle = cycleRef.current;
    if (!cycle) return;
    cycleRef.current = null;
    const target = sessionMruCycleTarget(cycle);
    if (target) persist(touchSessionMru(listRef.current, target));
  };

  const noteOpened = useCallback((id: string) => {
    const tid = id.trim();
    if (!tid) return;
    const cycle = cycleRef.current;
    if (cycle) {
      if (sessionMruCycleTarget(cycle) === tid) return;
      cycleRef.current = null;
    }
    persist(touchSessionMru(listRef.current, tid));
  }, []);

  const step = (dir: SessionMruDir) => {
    const o = optsRef.current;
    if (o.isEnabled && !o.isEnabled()) return;
    if (isShortcutRecordingActive()) return;

    let cycle = cycleRef.current;
    if (!cycle) {
      cycle = beginSessionMruCycle(
        listRef.current,
        o.getLiveIds(),
        o.getCurrentId(),
        dir,
      );
    } else {
      cycle = stepSessionMruCycle(cycle, dir);
    }
    if (!cycle) return;
    const target = sessionMruCycleTarget(cycle);
    if (!target) return;
    cycleRef.current = cycle;
    if (target !== (o.getCurrentId() ?? "").trim()) {
      o.openById(target);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const dir = matchSessionMruChord({
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        repeat: e.repeat,
        isComposing: e.isComposing,
      });
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      step(dir);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isSessionMruModifierKey(e)) return;
      commitCycle();
    };
    const endCycle = () => commitCycle();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", endCycle);
    document.addEventListener("visibilitychange", endCycle);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", endCycle);
      document.removeEventListener("visibilitychange", endCycle);
    };
  }, []);

  return { noteOpened };
}
