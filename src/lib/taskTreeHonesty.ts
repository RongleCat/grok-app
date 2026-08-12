/**
 * Nested subagent / tool tree honesty for the Tasks panel.
 *
 * Product truth:
 * - Hierarchy appears only from tool_step rows (CLI/ACP signals).
 * - Never invent phantom subagent / tool nodes that are not in the input.
 * - Prefer explicit `parentId` / `toolParentId`.
 * - Stream-order inference only under a long-running **spawn_subagent**
 *   (see {@link assignInferredParentIds}) — best-effort when ACP omits parent.
 * - Flat list when no nesting data exists (no fake tree chrome).
 *
 * Pure helpers — no I/O.
 */

import {
  assignInferredParentIds,
  buildTaskTree,
  isSubagentSpawnKind,
  taskTreeHasNesting,
  type AgentTask,
  type TaskTreeNode,
} from "./sessionTasks";

/** How a child got its parent link. */
export type TaskParentLinkSource = "explicit" | "inferred" | "none";

/** Honesty snapshot for a task list / forest (no invented rows). */
export type TaskTreeHonesty = {
  /** Input task count (tool signals only). */
  taskCount: number;
  /** True when any node has children after honest linking. */
  hasNesting: boolean;
  /** At least one child used an explicit parentId that exists in the list. */
  hasExplicitParent: boolean;
  /** Children whose parent was filled only by spawn stream-order inference. */
  inferredChildCount: number;
  /** Explicit parent links that resolved to a known parent. */
  explicitChildCount: number;
  /**
   * Spawn_subagent (or spawn-like) roots present in the list.
   * Never counts invented spawns — only kinds already on tool rows.
   */
  spawnRootCount: number;
};

/**
 * Classify parent linkage without inventing rows.
 * Compares raw tasks to {@link assignInferredParentIds} output.
 */
export function describeTaskTreeHonesty(
  tasks: readonly AgentTask[],
): TaskTreeHonesty {
  const list = Array.isArray(tasks) ? [...tasks] : [];
  const idSet = new Set(list.map((t) => t.id));
  const linked = assignInferredParentIds(list);

  let explicitChildCount = 0;
  let inferredChildCount = 0;
  let hasExplicitParent = false;

  for (let i = 0; i < list.length; i++) {
    const raw = list[i]!;
    const after = linked[i]!;
    const rawParent =
      raw.parentId &&
      raw.parentId !== raw.id &&
      idSet.has(raw.parentId)
        ? raw.parentId
        : undefined;
    const afterParent =
      after.parentId &&
      after.parentId !== after.id &&
      idSet.has(after.parentId)
        ? after.parentId
        : undefined;

    if (rawParent) {
      hasExplicitParent = true;
      if (afterParent === rawParent) explicitChildCount += 1;
    } else if (afterParent) {
      inferredChildCount += 1;
    }
  }

  const tree = buildTaskTree(list);
  const spawnRootCount = list.filter(
    (t) => isSubagentSpawnKind(t.kind) && t.longRunning,
  ).length;

  return {
    taskCount: list.length,
    hasNesting: taskTreeHasNesting(tree),
    hasExplicitParent,
    inferredChildCount,
    explicitChildCount,
    spawnRootCount,
  };
}

/**
 * Parent link source for one task after honest linking.
 * Does not invent a parent when none applies.
 */
export function resolveTaskParentLinkSource(
  task: AgentTask,
  allTasks: readonly AgentTask[],
): TaskParentLinkSource {
  const list = Array.isArray(allTasks) ? [...allTasks] : [];
  const idSet = new Set(list.map((t) => t.id));
  const rawParent =
    task.parentId &&
    task.parentId !== task.id &&
    idSet.has(task.parentId)
      ? task.parentId
      : undefined;
  if (rawParent) return "explicit";

  const linked = assignInferredParentIds(list);
  const after = linked.find((t) => t.id === task.id);
  const afterParent =
    after?.parentId &&
    after.parentId !== after.id &&
    idSet.has(after.parentId)
      ? after.parentId
      : undefined;
  if (afterParent) return "inferred";
  return "none";
}

/**
 * Collect all task ids present in a forest (roots + descendants).
 * Used to assert the UI never invents nodes outside the tool signal set.
 */
export function collectTaskTreeIds(nodes: readonly TaskTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (n: TaskTreeNode) => {
    out.push(n.task.id);
    for (const c of n.children) walk(c);
  };
  for (const n of nodes) walk(n);
  return out;
}

/**
 * True when every tree node id is in `allowedIds` and no extras exist.
 * Fail-closed honesty: invented nodes → false.
 */
export function taskTreeIdsAreHonest(
  nodes: readonly TaskTreeNode[],
  allowedIds: ReadonlySet<string> | readonly string[],
): boolean {
  const allowed =
    allowedIds instanceof Set ? allowedIds : new Set(allowedIds);
  const ids = collectTaskTreeIds(nodes);
  if (ids.length !== allowed.size && ids.length !== new Set(ids).size) {
    // Duplicates in tree are dishonest / broken.
    if (ids.length !== new Set(ids).size) return false;
  }
  for (const id of ids) {
    if (!allowed.has(id)) return false;
  }
  // Every allowed id need not appear (filters may drop), but no invent.
  return true;
}

/**
 * Whether tree chrome (indent / expand) should show.
 * False for empty lists and flat forests — no fake nesting UI.
 */
export function shouldShowTaskTreeChrome(
  nodes: readonly TaskTreeNode[],
): boolean {
  if (!nodes.length) return false;
  return taskTreeHasNesting(nodes as TaskTreeNode[]);
}
