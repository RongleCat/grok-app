/**
 * Zen mode — hide left sidebar + right aside to maximize chat.
 * localStorage-only (`grok.zenMode`); remembers prior collapse state so
 * disabling restores the layout the user had when they entered zen.
 *
 * Escape is intentionally not bound (must not steal Esc→stop generation).
 */

export const ZEN_MODE_STORAGE_KEY = "grok.zenMode";
export const ZEN_MODE_PRIOR_STORAGE_KEY = "grok.zenMode.prior";

/** Fired on `window` after a successful save (detail = boolean enabled). */
export const ZEN_MODE_CHANGE_EVENT = "grok-zen-mode-change";

export const DEFAULT_ZEN_MODE = false;

export type ZenModePriorLayout = {
  sidebarCollapsed: boolean;
  asideCollapsed: boolean;
};

/** Minimal storage surface so unit tests need no jsdom. */
export interface ZenModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): ZenModeStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

/** Parse stored zen flag; invalid / empty → default false. */
export function parseZenMode(raw: unknown): boolean {
  if (raw === "1" || raw === "true" || raw === true || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === false || raw === "off") {
    return false;
  }
  return DEFAULT_ZEN_MODE;
}

export function loadZenMode(
  storage: ZenModeStorage = defaultStorage(),
): boolean {
  try {
    return parseZenMode(storage.getItem(ZEN_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_ZEN_MODE;
  }
}

export function saveZenMode(
  enabled: boolean,
  storage: ZenModeStorage = defaultStorage(),
): void {
  try {
    storage.setItem(ZEN_MODE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(ZEN_MODE_CHANGE_EVENT, { detail: enabled }),
      );
    } catch {
      /* ignore */
    }
  }
}

export function parseZenModePrior(raw: unknown): ZenModePriorLayout | null {
  if (raw == null || raw === "") return null;
  try {
    const o =
      typeof raw === "string"
        ? (JSON.parse(raw) as Record<string, unknown>)
        : (raw as Record<string, unknown>);
    if (!o || typeof o !== "object") return null;
    if (
      typeof o.sidebarCollapsed !== "boolean" ||
      typeof o.asideCollapsed !== "boolean"
    ) {
      return null;
    }
    return {
      sidebarCollapsed: o.sidebarCollapsed,
      asideCollapsed: o.asideCollapsed,
    };
  } catch {
    return null;
  }
}

export function loadZenModePrior(
  storage: ZenModeStorage = defaultStorage(),
): ZenModePriorLayout | null {
  try {
    return parseZenModePrior(storage.getItem(ZEN_MODE_PRIOR_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveZenModePrior(
  prior: ZenModePriorLayout,
  storage: ZenModeStorage = defaultStorage(),
): void {
  try {
    storage.setItem(ZEN_MODE_PRIOR_STORAGE_KEY, JSON.stringify(prior));
  } catch {
    /* private mode / quota */
  }
}

export function clearZenModePrior(
  storage: ZenModeStorage = defaultStorage(),
): void {
  try {
    if (typeof storage.removeItem === "function") {
      storage.removeItem(ZEN_MODE_PRIOR_STORAGE_KEY);
    } else {
      storage.setItem(ZEN_MODE_PRIOR_STORAGE_KEY, "");
    }
  } catch {
    /* ignore */
  }
}

/**
 * Layout collapse flags after applying a zen transition.
 * Pure helper — callers persist layout + zen flag themselves.
 *
 * - enable: remember current collapse, force both collapsed
 * - disable: restore prior (or leave current if prior missing)
 */
export function applyZenModeLayoutTransition(
  enabled: boolean,
  current: ZenModePriorLayout,
  prior: ZenModePriorLayout | null,
): {
  layout: ZenModePriorLayout;
  /** Prior to persist when enabling; null means clear when disabling. */
  nextPrior: ZenModePriorLayout | null;
} {
  if (enabled) {
    return {
      layout: { sidebarCollapsed: true, asideCollapsed: true },
      nextPrior: {
        sidebarCollapsed: current.sidebarCollapsed,
        asideCollapsed: current.asideCollapsed,
      },
    };
  }
  if (prior) {
    return {
      layout: {
        sidebarCollapsed: prior.sidebarCollapsed,
        asideCollapsed: prior.asideCollapsed,
      },
      nextPrior: null,
    };
  }
  return {
    layout: {
      sidebarCollapsed: current.sidebarCollapsed,
      asideCollapsed: current.asideCollapsed,
    },
    nextPrior: null,
  };
}
