/**
 * Optional in-app product tour (localStorage).
 * Independent of first-run SetupWizard / account onboarding.
 */

/** Versioned so copy/step set can ship a re-offer later. */
export const PRODUCT_TUTORIAL_STORAGE_KEY = "grok.productTutorial.v1";

export const PRODUCT_TUTORIAL_VERSION = 1;

/** Stable step ids — UI maps each to i18n title/body keys. */
export type ProductTutorialStepId =
  | "welcome"
  | "project"
  | "permissions"
  | "worktree"
  | "send-queue"
  | "context-compact"
  | "shortcuts"
  | "extensions"
  | "done";

/** Ordered tour steps (~9). Keep ids stable for tests and analytics. */
export const PRODUCT_TUTORIAL_STEPS: readonly ProductTutorialStepId[] = [
  "welcome",
  "project",
  "permissions",
  "worktree",
  "send-queue",
  "context-compact",
  "shortcuts",
  "extensions",
  "done",
] as const;

/** Minimal storage surface so unit tests need no jsdom. */
export interface ProductTutorialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): ProductTutorialStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

/** Stored payload: version + done flag (extensible). */
export type ProductTutorialStored = {
  version: number;
  done: boolean;
};

/** Parse stored JSON / legacy "1"; invalid → not done. */
export function parseProductTutorialDone(raw: unknown): boolean {
  if (raw == null || raw === "") return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (typeof raw !== "string") return false;
  try {
    const parsed = JSON.parse(raw) as Partial<ProductTutorialStored>;
    if (parsed && typeof parsed === "object" && parsed.done === true) {
      return true;
    }
  } catch {
    /* not JSON */
  }
  return false;
}

export function loadDone(
  storage: ProductTutorialStorage = defaultStorage(),
): boolean {
  try {
    return parseProductTutorialDone(
      storage.getItem(PRODUCT_TUTORIAL_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return false;
  }
}

export function markDone(
  storage: ProductTutorialStorage = defaultStorage(),
): void {
  const payload: ProductTutorialStored = {
    version: PRODUCT_TUTORIAL_VERSION,
    done: true,
  };
  try {
    storage.setItem(PRODUCT_TUTORIAL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota */
  }
}

/** Clear completion so auto-offer / replay-from-scratch can run again. */
export function reset(
  storage: ProductTutorialStorage = defaultStorage(),
): void {
  try {
    if (typeof storage.removeItem === "function") {
      storage.removeItem(PRODUCT_TUTORIAL_STORAGE_KEY);
    } else {
      storage.setItem(PRODUCT_TUTORIAL_STORAGE_KEY, "");
    }
  } catch {
    /* private mode */
  }
}

export function getSteps(): readonly ProductTutorialStepId[] {
  return PRODUCT_TUTORIAL_STEPS;
}

export function stepCount(): number {
  return PRODUCT_TUTORIAL_STEPS.length;
}

export function stepAt(index: number): ProductTutorialStepId | null {
  if (!Number.isFinite(index) || index < 0) return null;
  return PRODUCT_TUTORIAL_STEPS[index] ?? null;
}

/**
 * Soft auto-offer: only when the workbench gate is ready and the user
 * has not finished/skipped the tour. Does not fight the setup wizard.
 */
export function shouldAutoOffer(
  gateReady: boolean,
  done: boolean,
): boolean {
  return gateReady && !done;
}
