/**
 * Per-project Side Workbench tab groups (session-local).
 * Switching projects stashes tabs/active/tree and restores the next group.
 * `expanded` is layout, not part of the project slice.
 */

import {
  emptySideWorkbenchState,
  type SideTab,
  type SideWorkbenchState,
} from "@/lib/sideWorkbench";

export const SIDE_WORKBENCH_ORPHAN_KEY = "__orphan__";

export type SideWorkbenchProjectSlice = {
  tabs: SideWorkbenchState["tabs"];
  activeId: SideWorkbenchState["activeId"];
  treeVisible: SideWorkbenchState["treeVisible"];
};

export function sideWorkbenchProjectKey(
  projectId: string | null | undefined,
): string {
  const id = (projectId ?? "").trim();
  return id || SIDE_WORKBENCH_ORPHAN_KEY;
}

export function emptySideWorkbenchProjectSlice(): SideWorkbenchProjectSlice {
  const empty = emptySideWorkbenchState();
  return {
    tabs: empty.tabs,
    activeId: empty.activeId,
    treeVisible: empty.treeVisible,
  };
}

export function takeSideWorkbenchProjectSlice(
  state: SideWorkbenchState,
): SideWorkbenchProjectSlice {
  return {
    tabs: state.tabs,
    activeId: state.activeId,
    treeVisible: state.treeVisible,
  };
}

export function applySideWorkbenchProjectSlice(
  state: SideWorkbenchState,
  slice: SideWorkbenchProjectSlice | undefined,
): SideWorkbenchState {
  const next = slice ?? emptySideWorkbenchProjectSlice();
  return {
    ...state,
    tabs: next.tabs,
    activeId: next.activeId,
    treeVisible: next.treeVisible,
  };
}

/**
 * Stash `fromKey`, restore `toKey` (empty group if first visit).
 * Same key is a no-op. `expanded` is preserved.
 */
export function switchSideWorkbenchProject(
  state: SideWorkbenchState,
  store: ReadonlyMap<string, SideWorkbenchProjectSlice>,
  fromKey: string,
  toKey: string,
): {
  state: SideWorkbenchState;
  store: Map<string, SideWorkbenchProjectSlice>;
} {
  const nextStore = new Map(store);
  if (fromKey === toKey) {
    return { state, store: nextStore };
  }
  nextStore.set(fromKey, takeSideWorkbenchProjectSlice(state));
  return {
    state: applySideWorkbenchProjectSlice(state, nextStore.get(toKey)),
    store: nextStore,
  };
}

/** Terminal / browser tabs stashed on other projects (keep-alive hosts). */
export function collectStashedPersistTabs(
  store: ReadonlyMap<string, SideWorkbenchProjectSlice>,
  currentKey: string,
): SideTab[] {
  const out: SideTab[] = [];
  for (const [key, slice] of store) {
    if (key === currentKey) continue;
    for (const tab of slice.tabs) {
      if (tab.kind === "browser" || tab.kind === "terminal") {
        out.push(tab);
      }
    }
  }
  return out;
}
