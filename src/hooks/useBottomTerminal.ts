/**
 * Bottom terminal panel state. Tabs are per-project; open/height are layout.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addBottomTerminalTab,
  applyBottomTerminalProjectSlice,
  bottomTerminalProjectKey,
  closeBottomTerminal,
  closeBottomTerminalTab,
  emptyBottomTerminalState,
  loadBottomTerminalHeight,
  saveBottomTerminalHeight,
  setActiveBottomTerminalTab,
  setBottomTerminalHeight,
  switchBottomTerminalProject,
  toggleBottomTerminal,
  type BottomTerminalProjectSlice,
  type BottomTerminalState,
} from "@/lib/bottomTerminal";

export function useBottomTerminal(projectId: string | null | undefined): {
  state: BottomTerminalState;
  toggle: () => void;
  addTab: () => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  setHeight: (height: number, maxPx?: number) => void;
  closePanel: () => void;
} {
  const [state, setState] = useState<BottomTerminalState>(() =>
    applyBottomTerminalProjectSlice(
      {
        ...emptyBottomTerminalState(),
        height: loadBottomTerminalHeight(
          typeof localStorage !== "undefined" ? localStorage : null,
        ),
      },
      undefined,
    ),
  );

  const storeRef = useRef<Map<string, BottomTerminalProjectSlice>>(new Map());
  const keyRef = useRef(bottomTerminalProjectKey(projectId));
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const toKey = bottomTerminalProjectKey(projectId);
    const fromKey = keyRef.current;
    if (fromKey === toKey) return;
    const { state: next, store } = switchBottomTerminalProject(
      stateRef.current,
      storeRef.current,
      fromKey,
      toKey,
    );
    storeRef.current = store;
    keyRef.current = toKey;
    setState(next);
  }, [projectId]);

  const toggle = useCallback(() => {
    setState((s) => toggleBottomTerminal(s));
  }, []);

  const addTab = useCallback(() => {
    setState((s) => addBottomTerminalTab(s));
  }, []);

  const closeTab = useCallback((id: string) => {
    setState((s) => closeBottomTerminalTab(s, id));
  }, []);

  const activateTab = useCallback((id: string) => {
    setState((s) => setActiveBottomTerminalTab(s, id));
  }, []);

  const setHeight = useCallback((height: number, maxPx?: number) => {
    setState((s) => {
      const next = setBottomTerminalHeight(s, height, maxPx);
      if (next.height !== s.height) {
        saveBottomTerminalHeight(
          next.height,
          typeof localStorage !== "undefined" ? localStorage : null,
        );
      }
      return next;
    });
  }, []);

  const closePanel = useCallback(() => {
    setState((s) => closeBottomTerminal(s));
  }, []);

  return {
    state,
    toggle,
    addTab,
    closeTab,
    activateTab,
    setHeight,
    closePanel,
  };
}
