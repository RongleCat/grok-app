/**
 * Goal orchestration UI display pref (localStorage) — parse / load / save.
 * Saving dispatches `GOAL_ORCH_UI_CHANGE_EVENT` on `window` so listeners
 * can re-read without prop drilling. Split from goalOrch.ts
 * (1k-line budget); re-exported there.
 */
import {
  DEFAULT_GOAL_ORCH_UI_ENABLED,
  GOAL_ORCH_UI_CHANGE_EVENT,
  GOAL_ORCH_UI_STORAGE_KEY,
  type GoalOrchUiStorage,
} from "./goalOrch";

function defaultStorage(): GoalOrchUiStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

// ── Display pref ────────────────────────────────────────────────────────────

export function parseGoalOrchUiEnabled(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_GOAL_ORCH_UI_ENABLED;
}

export function loadGoalOrchUiEnabled(
  storage: GoalOrchUiStorage = defaultStorage(),
): boolean {
  try {
    return parseGoalOrchUiEnabled(storage.getItem(GOAL_ORCH_UI_STORAGE_KEY));
  } catch {
    return DEFAULT_GOAL_ORCH_UI_ENABLED;
  }
}

export function saveGoalOrchUiEnabled(
  enabled: boolean,
  storage: GoalOrchUiStorage = defaultStorage(),
): void {
  try {
    storage.setItem(GOAL_ORCH_UI_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(GOAL_ORCH_UI_CHANGE_EVENT, { detail: enabled }),
      );
    } catch {
      /* ignore */
    }
  }
}
