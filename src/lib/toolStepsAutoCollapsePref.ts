/**
 * User preference: auto-collapse tool steps in the chat timeline.
 * localStorage-only — does not touch Host AppSettings.
 * Default: true (tool rows start collapsed, including while running — #1018).
 */

export const TOOL_STEPS_AUTO_COLLAPSE_STORAGE_KEY = "grok.toolStepsAutoCollapse";

/** Fired on `window` after a successful save (detail = boolean autoCollapse). */
export const TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT =
  "grok-tool-steps-auto-collapse-change";

export const DEFAULT_TOOL_STEPS_AUTO_COLLAPSE = true;

/** Minimal storage surface so unit tests need no jsdom. */
export interface ToolStepsAutoCollapseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ToolStepsAutoCollapseStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default true. */
export function parseToolStepsAutoCollapsePref(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_TOOL_STEPS_AUTO_COLLAPSE;
}

export function loadToolStepsAutoCollapsePref(
  storage: ToolStepsAutoCollapseStorage = defaultStorage(),
): boolean {
  try {
    return parseToolStepsAutoCollapsePref(
      storage.getItem(TOOL_STEPS_AUTO_COLLAPSE_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_TOOL_STEPS_AUTO_COLLAPSE;
  }
}

export function saveToolStepsAutoCollapsePref(
  autoCollapse: boolean,
  storage: ToolStepsAutoCollapseStorage = defaultStorage(),
): void {
  try {
    storage.setItem(
      TOOL_STEPS_AUTO_COLLAPSE_STORAGE_KEY,
      autoCollapse ? "1" : "0",
    );
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT, {
          detail: autoCollapse,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Pure default-open for a tool step / tool group.
 * Tools never auto-expand — including while running — so large stdout stays
 * off the DOM until the user opens the row (#1018). `running` is kept for
 * call-site compatibility; streaming thoughts use activity `openWhileRunning`.
 */
export function toolStepDefaultOpen(
  _running: boolean,
  autoCollapse: boolean = DEFAULT_TOOL_STEPS_AUTO_COLLAPSE,
): boolean {
  return !autoCollapse;
}

/**
 * Work-phase fold (“工作中 / 工作了”).
 * Live work stays expanded so the user can see which tools are running.
 * After the phase ends: keep open on errors; otherwise follow auto-collapse.
 */
export function workPhaseDefaultOpen(opts: {
  running: boolean;
  errorCount?: number;
  autoCollapse?: boolean;
}): boolean {
  if (opts.running) return true;
  if ((opts.errorCount ?? 0) > 0) return true;
  return !(opts.autoCollapse ?? DEFAULT_TOOL_STEPS_AUTO_COLLAPSE);
}

/**
 * Live→idle folds must follow `defaultOpen` on the same render the turn
 * settles. Waiting on useEffect paints one expanded idle frame then collapses.
 */
export function resolveFoldExpanded(input: {
  userToggled: boolean;
  storedOpen: boolean;
  defaultOpen: boolean;
}): boolean {
  return input.userToggled ? input.storedOpen : input.defaultOpen;
}
