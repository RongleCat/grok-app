/**
 * Global Ctrl+Tab / Ctrl+Shift+Tab: switch recently used chats.
 *
 * Same chord on macOS, Windows, and Linux (Cmd+Tab is the OS app switcher).
 * Hold Ctrl and tap Tab to walk a frozen snapshot in a temporary panel;
 * releasing Ctrl opens the highlighted chat and hides the panel.
 */

import { useCallback, useEffect, useRef } from "react";
import { isShortcutRecordingActive } from "@/lib/shortcutRemap";
import {
  beginSessionMruCycle,
  buildSessionMruPanelState,
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
import {
  registerSessionMruPanelPick,
  setSessionMruPanelState,
} from "@/lib/sessionMruPanelStore";

export type SessionMruRowLookup = {
  title: string;
  projectName: string;
};

export function useSessionMruNav(opts: {
  getCurrentId: () => string | null | undefined;
  getLiveIds: () => readonly string[];
  getRow: (id: string) => SessionMruRowLookup | null;
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

  const publish = (cycle: SessionMruCycle | null) => {
    setSessionMruPanelState(
      buildSessionMruPanelState(cycle, optsRef.current.getRow),
    );
  };

  const hidePanel = () => {
    cycleRef.current = null;
    publish(null);
  };

  const commitCycle = () => {
    const cycle = cycleRef.current;
    if (!cycle) return;
    hidePanel();
    const target = sessionMruCycleTarget(cycle);
    if (!target) return;
    persist(touchSessionMru(listRef.current, target));
    const current = (optsRef.current.getCurrentId() ?? "").trim();
    if (target !== current) optsRef.current.openById(target);
  };

  const noteOpened = useCallback((id: string) => {
    const tid = id.trim();
    if (!tid) return;
    const cycle = cycleRef.current;
    if (cycle) {
      if (sessionMruCycleTarget(cycle) === tid) return;
      hidePanel();
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
    cycleRef.current = cycle;
    publish(cycle);
  };

  const pickIndex = (index: number) => {
    const cycle = cycleRef.current;
    if (!cycle) return;
    if (index < 0 || index >= cycle.snapshot.length) return;
    const next = { snapshot: cycle.snapshot, index };
    cycleRef.current = next;
    publish(next);
  };

  useEffect(() => {
    registerSessionMruPanelPick(pickIndex);
    return () => registerSessionMruPanelPick(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (cycleRef.current && e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        hidePanel();
        return;
      }
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
