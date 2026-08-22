/**
 * Resource / Files workbench tree helpers — filter, expand persist, width.
 * Pure where possible; localStorage only inside load/save wrappers.
 */

export const TREE_WIDTH_KEY = "grok-app.resourceTreeWidth";
export const TREE_WIDTH_DEFAULT = 220;
export const TREE_WIDTH_MIN = 140;
export const TREE_WIDTH_MAX = 420;
export const TREE_EXPAND_KEY_PREFIX = "grok-app.resourceTreeExpand:";

export type ResourceTreeNodeLike = {
  name: string;
  relativePath: string;
  isDir?: boolean;
  children?: ResourceTreeNodeLike[] | null;
};

/** Must match `.rp-tree__row` height. */
export const RESOURCE_TREE_ROW_HEIGHT_PX = 28;

/** Below this visible-row count, the files tree renders every row. */
export const RESOURCE_TREE_VIRTUALIZE_THRESHOLD = 32;

export type VisibleResourceTreeRow<T extends ResourceTreeNodeLike = ResourceTreeNodeLike> =
  {
    node: T;
    depth: number;
  };

/**
 * Depth-first visible rows for the expanded map.
 * Collapsed dirs contribute the dir row only. `include` skips a node
 * and its descendants (ResourceViewer query: keep dirs, hide non-hits).
 */
export function flattenVisibleResourceTree<T extends ResourceTreeNodeLike>(
  nodes: readonly T[],
  expanded: Record<string, boolean>,
  include?: (node: T) => boolean,
): VisibleResourceTreeRow<T>[] {
  const out: VisibleResourceTreeRow<T>[] = [];
  const walk = (list: readonly T[], depth: number) => {
    for (const n of list) {
      if (include && !include(n)) continue;
      out.push({ node: n, depth });
      if (
        n.isDir &&
        expanded[n.relativePath] &&
        Array.isArray(n.children) &&
        n.children.length > 0
      ) {
        walk(n.children as T[], depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return out;
}

export function loadTreeWidth(
  storage: Pick<Storage, "getItem"> | null = defaultStorage(),
): number {
  try {
    const n = Number(storage?.getItem(TREE_WIDTH_KEY));
    if (Number.isFinite(n) && n >= TREE_WIDTH_MIN && n <= TREE_WIDTH_MAX) {
      return Math.round(n);
    }
  } catch {
    /* ignore */
  }
  return TREE_WIDTH_DEFAULT;
}

export function clampTreeWidth(w: number, containerWidth: number): number {
  const maxByContainer = Math.max(
    TREE_WIDTH_MIN,
    Math.floor(containerWidth * 0.55),
  );
  const max = Math.min(TREE_WIDTH_MAX, maxByContainer);
  if (!Number.isFinite(w)) return TREE_WIDTH_DEFAULT;
  return Math.min(max, Math.max(TREE_WIDTH_MIN, Math.round(w)));
}

/** Clamp and persist tree width; returns the stored value. */
export function persistTreeWidth(
  w: number,
  containerWidth: number,
  storage: Pick<Storage, "setItem"> | null = defaultStorage(),
): number {
  const next = clampTreeWidth(w, containerWidth);
  try {
    storage?.setItem(TREE_WIDTH_KEY, String(next));
  } catch {
    /* ignore */
  }
  return next;
}

function expandStorageKey(projectKey: string): string {
  const k = (projectKey || "").trim() || "_";
  return `${TREE_EXPAND_KEY_PREFIX}${k}`;
}

/** Load expanded dir map for a project (empty root always open). */
export function loadTreeExpanded(
  projectKey: string,
  storage: Pick<Storage, "getItem"> | null = defaultStorage(),
): Record<string, boolean> {
  const base: Record<string, boolean> = { "": true };
  try {
    const raw = storage?.getItem(expandStorageKey(projectKey));
    if (!raw) return base;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return base;
    }
    const out: Record<string, boolean> = { "": true };
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === true) out[k] = true;
    }
    return out;
  } catch {
    return base;
  }
}

/** Persist expanded dirs (only keys set true). */
export function saveTreeExpanded(
  projectKey: string,
  expanded: Record<string, boolean>,
  storage: Pick<Storage, "setItem"> | null = defaultStorage(),
): void {
  const slim: Record<string, true> = {};
  for (const [k, v] of Object.entries(expanded || {})) {
    if (v) slim[k] = true;
  }
  try {
    storage?.setItem(expandStorageKey(projectKey), JSON.stringify(slim));
  } catch {
    /* ignore */
  }
}

function nodeMatchesQuery(n: ResourceTreeNodeLike, q: string): boolean {
  if (!q) return true;
  if (n.name.toLowerCase().includes(q)) return true;
  if (n.relativePath.toLowerCase().includes(q)) return true;
  return false;
}

/**
 * Filter tree: keep nodes that match or have matching descendants.
 * Returns a shallow-copied tree (children arrays filtered).
 */
export function filterResourceTreeNodes<T extends ResourceTreeNodeLike>(
  nodes: readonly T[],
  query: string,
): T[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return nodes as T[];

  const walk = (list: readonly T[]): T[] => {
    const out: T[] = [];
    for (const n of list) {
      const kids = Array.isArray(n.children)
        ? walk(n.children as T[])
        : undefined;
      const selfHit = nodeMatchesQuery(n, q);
      const childHit = !!(kids && kids.length > 0);
      if (selfHit || childHit) {
        out.push(
          kids !== undefined
            ? ({ ...n, children: kids } as T)
            : ({ ...n } as T),
        );
      }
    }
    return out;
  };
  return walk(nodes);
}

/**
 * Relative paths of dirs that should stay expanded so filter hits remain
 * reachable (ancestors of matching leaves + matching dirs).
 */
export function expandKeysForResourceTreeFilter(
  nodes: readonly ResourceTreeNodeLike[],
  query: string,
): string[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const keys = new Set<string>();

  const walk = (
    list: readonly ResourceTreeNodeLike[],
    ancestors: string[],
  ): boolean => {
    let any = false;
    for (const n of list) {
      const path = n.relativePath || "";
      const kids = Array.isArray(n.children) ? n.children : [];
      const selfHit = nodeMatchesQuery(n, q);
      const below = kids.length ? walk(kids, [...ancestors, path]) : false;
      if (selfHit || below) {
        any = true;
        for (const a of ancestors) {
          if (a) keys.add(a);
        }
        if (n.isDir && path) keys.add(path);
        else if (below && path) keys.add(path);
      }
    }
    return any;
  };

  walk(nodes, []);
  return [...keys];
}

/**
 * Merge filter-forced expand keys into the current expand map (immutable).
 * Does not collapse user-expanded dirs.
 */
export function mergeTreeExpandedForFilter(
  expanded: Record<string, boolean>,
  forceKeys: readonly string[],
): Record<string, boolean> {
  if (!forceKeys.length) return expanded;
  const next: Record<string, boolean> = { ...expanded, "": true };
  for (const k of forceKeys) {
    if (k) next[k] = true;
  }
  return next;
}

function defaultStorage(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* ignore */
  }
  return null;
}
