/**
 * Swap Side Workbench tab groups when the active project changes.
 * Session-local stash — not written to disk.
 */

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SideTab, SideWorkbenchState } from "@/lib/sideWorkbench";
import {
  collectStashedPersistTabs,
  sideWorkbenchProjectKey,
  switchSideWorkbenchProject,
  type SideWorkbenchProjectSlice,
} from "@/lib/sideWorkbenchProject";

export function useSideWorkbenchProjectIsolation(
  projectId: string | null | undefined,
  sideWorkbench: SideWorkbenchState,
  setSideWorkbench: Dispatch<SetStateAction<SideWorkbenchState>>,
): SideTab[] {
  const storeRef = useRef<Map<string, SideWorkbenchProjectSlice>>(new Map());
  const keyRef = useRef(sideWorkbenchProjectKey(projectId));
  const stateRef = useRef(sideWorkbench);
  stateRef.current = sideWorkbench;
  const [stashedPersistTabs, setStashedPersistTabs] = useState<SideTab[]>([]);

  useEffect(() => {
    const toKey = sideWorkbenchProjectKey(projectId);
    const fromKey = keyRef.current;
    if (fromKey === toKey) return;
    const { state, store } = switchSideWorkbenchProject(
      stateRef.current,
      storeRef.current,
      fromKey,
      toKey,
    );
    storeRef.current = store;
    keyRef.current = toKey;
    setSideWorkbench(state);
    setStashedPersistTabs(collectStashedPersistTabs(store, toKey));
  }, [projectId, setSideWorkbench]);

  return stashedPersistTabs;
}
