/**
 * Sidebar session list density (Appearance).
 * localStorage-only — no Rust AppSettings (avoids prefs schema conflicts).
 * Applied via `data-sidebar-density` on `document.documentElement`.
 *
 * - `comfortable` (default): current `.tree-l3` spacing (30px + 2px gap)
 * - `compact`: tighter session rows (24px + 0 gap)
 *
 * VirtualList rowHeight/gap must match CSS — use `sidebarSessionRowMetrics`.
 */

export type SidebarDensity = "comfortable" | "compact";

export const SIDEBAR_DENSITY_STORAGE_KEY = "grok.sidebarDensity";
export const DEFAULT_SIDEBAR_DENSITY: SidebarDensity = "comfortable";
export const SIDEBAR_DENSITY_ATTR = "data-sidebar-density";

/** Fired on window after apply so App VirtualList can re-measure. */
export const SIDEBAR_DENSITY_EVENT = "grok:sidebar-density";

export const SIDEBAR_DENSITIES: readonly SidebarDensity[] = [
  "comfortable",
  "compact",
] as const;

/** Row metrics for VirtualList — keep in sync with app.css `.tree-l3` rules. */
export const SIDEBAR_DENSITY_METRICS = {
  comfortable: { rowHeight: 30, gap: 2 },
  compact: { rowHeight: 24, gap: 0 },
} as const satisfies Record<
  SidebarDensity,
  { rowHeight: number; gap: number }
>;

export function sidebarSessionRowMetrics(density: SidebarDensity): {
  rowHeight: number;
  gap: number;
} {
  return SIDEBAR_DENSITY_METRICS[density];
}

export interface SidebarDensityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isSidebarDensity(value: unknown): value is SidebarDensity {
  return value === "comfortable" || value === "compact";
}

export function parseSidebarDensity(raw: unknown): SidebarDensity {
  if (typeof raw === "string" && isSidebarDensity(raw)) return raw;
  return DEFAULT_SIDEBAR_DENSITY;
}

export function loadSidebarDensity(
  storage: SidebarDensityStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): SidebarDensity {
  try {
    return parseSidebarDensity(storage.getItem(SIDEBAR_DENSITY_STORAGE_KEY));
  } catch {
    return DEFAULT_SIDEBAR_DENSITY;
  }
}

export function saveSidebarDensity(
  density: SidebarDensity,
  storage: SidebarDensityStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): void {
  try {
    storage.setItem(SIDEBAR_DENSITY_STORAGE_KEY, density);
  } catch {
    /* private mode / quota */
  }
}

/** Minimal DOM surface so unit tests need no jsdom. */
export interface SidebarDensityRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute?(name: string): void;
}

/**
 * Apply density to document via `data-sidebar-density`
 * (`html[data-sidebar-density="compact|comfortable"]`).
 * Always sets the attribute so CSS overrides apply explicitly.
 * Dispatches `SIDEBAR_DENSITY_EVENT` on window so VirtualList remounts metrics.
 */
export function applySidebarDensity(
  density: SidebarDensity,
  root: SidebarDensityRoot = typeof document !== "undefined"
    ? document.documentElement
    : { setAttribute: () => {} },
  notify = true,
): void {
  root.setAttribute(SIDEBAR_DENSITY_ATTR, density);
  if (
    notify &&
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(SIDEBAR_DENSITY_EVENT, { detail: density }),
      );
    } catch {
      /* non-DOM test env */
    }
  }
}

/** Persist + apply in one step (Settings onChange). */
export function setSidebarDensity(
  density: SidebarDensity,
  storage?: SidebarDensityStorage,
  root?: SidebarDensityRoot,
): void {
  saveSidebarDensity(density, storage);
  applySidebarDensity(density, root);
}
