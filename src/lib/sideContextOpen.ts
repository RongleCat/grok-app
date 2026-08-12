/**
 * Chat → Side Workbench context open helpers (Phase 6).
 * Pure: map click targets to side tab open intents.
 */

import {
  openSideTab,
  type SideWorkbenchState,
} from "@/lib/sideWorkbench";

export type SideContextOpenTarget =
  | {
      type: "file";
      path: string;
      title?: string;
      line?: number | null;
      column?: number | null;
    }
  | { type: "url"; url: string; title?: string }
  | { type: "changes"; path?: string };

export type SideContextOpenResult = {
  state: SideWorkbenchState;
  /** Aside should open if currently collapsed. */
  needAsideOpen: boolean;
  kind: "file" | "browser" | "review";
};

/**
 * Apply a chat/resource open request to Side Workbench state.
 * Review requires git (caller gates); non-git changes → no-op state.
 */
export function applySideContextOpen(
  state: SideWorkbenchState,
  target: SideContextOpenTarget,
  opts?: { isGitProject?: boolean },
): SideContextOpenResult {
  if (target.type === "file") {
    const next = openSideTab(state, "file", {
      path: target.path,
      name: target.title,
      line: target.line,
      column: target.column,
    });
    return { state: next, needAsideOpen: true, kind: "file" };
  }
  if (target.type === "url") {
    const next = openSideTab(state, "browser", {
      url: target.url,
      title: target.title,
      name: target.title,
    });
    return { state: next, needAsideOpen: true, kind: "browser" };
  }
  // changes → review
  if (!opts?.isGitProject) {
    return { state, needAsideOpen: false, kind: "review" };
  }
  const next = openSideTab(state, "review");
  return { state: next, needAsideOpen: true, kind: "review" };
}
