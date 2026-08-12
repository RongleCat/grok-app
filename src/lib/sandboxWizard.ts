/**
 * Sandbox profile trust wizard — pure helpers.
 *
 * Flow (trust / info guide):
 *   intro → pick profile → confirm
 *
 * Recommends {@link RECOMMENDED_SANDBOX_PROFILE} (`workspace`) for everyday use.
 * Honesty banners for Windows (kernel soft-fail) and older CLI (flag omitted).
 * Never uses `window.confirm` — UI hosts a GlassModal.
 */

import type { MessageKey } from "@/i18n";
import {
  DEFAULT_SANDBOX_PROFILE,
  RECOMMENDED_SANDBOX_PROFILE,
  SANDBOX_PROFILES,
  isDangerousSandboxProfile,
  normalizeSandboxProfile,
  platformEnforcesOsSandbox,
  sandboxDangerConfirmKey,
  sandboxIsolationActive,
  sandboxLinuxUsernsNoteKey,
  sandboxProfileHelpKey,
  sandboxProfileLabelKey,
  type SandboxProfileId,
} from "@/lib/sandboxProfile";

/** Ordered wizard steps. */
export type SandboxWizardStep = "intro" | "pick" | "confirm";

export const SANDBOX_WIZARD_STEPS: readonly SandboxWizardStep[] = [
  "intro",
  "pick",
  "confirm",
] as const;

export const SANDBOX_WIZARD_STEP_TOTAL = SANDBOX_WIZARD_STEPS.length;

/** Host mode: post-trust offer vs Settings “Open sandbox guide”. */
export type SandboxWizardMode = "trust" | "info";

/** Soft localStorage key for “don’t offer after trust”. */
export const SANDBOX_WIZARD_DISMISS_KEY = "grok.sandboxWizard.dismissed.v1";

export const SANDBOX_WIZARD_DISMISS_VERSION = 1;

/** Minimal storage surface so unit tests need no jsdom. */
export interface SandboxWizardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): SandboxWizardStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

export type SandboxWizardDismissStored = {
  version: number;
  dismissed: boolean;
};

/** User answers while stepping through the wizard. */
export type SandboxWizardAnswers = {
  /** Selected profile (null until pick step). */
  profile: SandboxProfileId | null;
  /** Soft “don’t offer again after trust”. */
  dontOfferAgain?: boolean;
};

export type SandboxWizardRecommendResult = {
  profile: SandboxProfileId;
  /** Why this profile is recommended. */
  reasonKey: MessageKey;
  /**
   * Optional honesty banner (Windows soft-fail / old CLI).
   * `null` when no extra caution is needed.
   */
  honestyKey: MessageKey | null;
};

export type SandboxWizardStepPlan = {
  step: SandboxWizardStep;
  /** 0-based index into {@link SANDBOX_WIZARD_STEPS}. */
  index: number;
  total: number;
  /** Human progress 1..total. */
  progress: number;
  canBack: boolean;
  /** True when continue advances past confirm (apply). */
  isLast: boolean;
  /** Continue enabled (pick requires a profile). */
  canContinue: boolean;
  nextStep: SandboxWizardStep | "done";
  prevStep: SandboxWizardStep | null;
  selectedProfile: SandboxProfileId | null;
  recommendedProfile: SandboxProfileId;
  /** Danger note when selected profile is off/devbox. */
  dangerKey: MessageKey | null;
};

/**
 * Recommend a sandbox profile when trusting a project.
 * Always prefers {@link RECOMMENDED_SANDBOX_PROFILE}; honesty keys when
 * platform/CLI cannot enforce isolation (or Linux userns may block bwrap).
 */
export function recommendSandboxForTrust(opts: {
  platform?: string | null;
  /** Pre-resolved `cliSupportsSandbox(version)` result. */
  cliSupportsSandbox?: boolean | null;
} = {}): SandboxWizardRecommendResult {
  const profile = RECOMMENDED_SANDBOX_PROFILE;
  const reasonKey: MessageKey = "sandboxWizard.reason.workspace";

  if (opts.cliSupportsSandbox === false) {
    return {
      profile,
      reasonKey,
      honestyKey: "sandboxWizard.honesty.cliUnsupported",
    };
  }

  if (
    opts.platform != null &&
    !platformEnforcesOsSandbox(opts.platform)
  ) {
    return {
      profile,
      reasonKey,
      honestyKey: "sandboxWizard.honesty.platform",
    };
  }

  // Linux: Landlock/bwrap possible, but userns may still SANDBOX_BLOCKED.
  if (sandboxLinuxUsernsNoteKey(opts.platform, profile) != null) {
    return {
      profile,
      reasonKey,
      honestyKey: "sandboxWizard.honesty.linuxUserns",
    };
  }

  return { profile, reasonKey, honestyKey: null };
}

/**
 * Simple step machine plan for intro → pick → confirm.
 * Pure: does not mutate answers.
 */
export function planSandboxWizardStep(
  step: SandboxWizardStep,
  answers: SandboxWizardAnswers,
): SandboxWizardStepPlan {
  const selectedProfile =
    answers.profile != null
      ? normalizeSandboxProfile(answers.profile)
      : null;

  const recommendedProfile = RECOMMENDED_SANDBOX_PROFILE;
  const dangerKey =
    selectedProfile && isDangerousSandboxProfile(selectedProfile)
      ? sandboxDangerConfirmKey(selectedProfile)
      : null;

  if (step === "intro") {
    return {
      step: "intro",
      index: 0,
      total: SANDBOX_WIZARD_STEP_TOTAL,
      progress: 1,
      canBack: false,
      isLast: false,
      canContinue: true,
      nextStep: "pick",
      prevStep: null,
      selectedProfile,
      recommendedProfile,
      dangerKey: null,
    };
  }

  if (step === "pick") {
    return {
      step: "pick",
      index: 1,
      total: SANDBOX_WIZARD_STEP_TOTAL,
      progress: 2,
      canBack: true,
      isLast: false,
      canContinue: selectedProfile != null,
      nextStep: "confirm",
      prevStep: "intro",
      selectedProfile,
      recommendedProfile,
      dangerKey,
    };
  }

  // confirm
  return {
    step: "confirm",
    index: 2,
    total: SANDBOX_WIZARD_STEP_TOTAL,
    progress: 3,
    canBack: true,
    isLast: true,
    canContinue: selectedProfile != null,
    nextStep: "done",
    prevStep: "pick",
    selectedProfile,
    recommendedProfile,
    dangerKey,
  };
}

/**
 * Advance one step (or stay if continue blocked).
 * Pure transition helper for hosts that don't want to re-derive next.
 */
export function advanceSandboxWizardStep(
  step: SandboxWizardStep,
  answers: SandboxWizardAnswers,
): SandboxWizardStep | "done" {
  const plan = planSandboxWizardStep(step, answers);
  if (!plan.canContinue) return step;
  return plan.nextStep;
}

/** Step back, or stay on intro. */
export function retreatSandboxWizardStep(
  step: SandboxWizardStep,
): SandboxWizardStep {
  const plan = planSandboxWizardStep(step, { profile: null });
  return plan.prevStep ?? step;
}

/**
 * Whether to open the wizard after a successful project trust.
 * - Requires `justTrusted`
 * - Soft-skips when user dismissed previously
 * - Offers when global profile is still unrestricted (`off` / invalid)
 */
export function shouldOfferSandboxWizard(opts: {
  justTrusted: boolean;
  currentProfile: string;
  dismissed?: boolean;
}): boolean {
  if (!opts.justTrusted) return false;
  if (opts.dismissed) return false;
  const id =
    normalizeSandboxProfile(opts.currentProfile) ?? DEFAULT_SANDBOX_PROFILE;
  // Already isolating → no need to nag after trust.
  return id === "off" || !sandboxIsolationActive(id);
}

/**
 * Honesty banner for the wizard body (Windows / old CLI / Linux userns).
 * Independent of soft-fail Settings banners; returns wizard-scoped keys.
 * Priority: cli_unsupported → platform (non-mac/linux) → linux_userns → null.
 * `null` when no banner is needed.
 */
export function resolveSandboxWizardBanner(opts: {
  platform?: string | null;
  cliSupportsSandbox?: boolean | null;
  /** Optional selected / recommended profile (off → no banner). */
  profile?: unknown;
}): MessageKey | null {
  if (opts.profile != null && !sandboxIsolationActive(opts.profile)) {
    return null;
  }

  if (opts.cliSupportsSandbox === false) {
    return "sandboxWizard.honesty.cliUnsupported";
  }

  if (
    opts.platform != null &&
    !platformEnforcesOsSandbox(opts.platform)
  ) {
    return "sandboxWizard.honesty.platform";
  }

  if (sandboxLinuxUsernsNoteKey(opts.platform, opts.profile ?? "workspace") != null) {
    return "sandboxWizard.honesty.linuxUserns";
  }

  return null;
}

/** Profiles shown in the pick step (stable order from catalog). */
export function sandboxWizardProfileChoices(): readonly SandboxProfileId[] {
  return SANDBOX_PROFILES;
}

/** Label key for a pick-row profile. */
export function sandboxWizardProfileLabelKey(
  profile: SandboxProfileId,
): MessageKey {
  return sandboxProfileLabelKey(profile);
}

/** Help key for a pick-row profile. */
export function sandboxWizardProfileHelpKey(
  profile: SandboxProfileId,
): MessageKey {
  return sandboxProfileHelpKey(profile);
}

/** i18n title key for the wizard mode. */
export function sandboxWizardTitleKey(mode: SandboxWizardMode): MessageKey {
  return mode === "info"
    ? "sandboxWizard.title.info"
    : "sandboxWizard.title.trust";
}

/** i18n step label key. */
export function sandboxWizardStepLabelKey(step: SandboxWizardStep): MessageKey {
  switch (step) {
    case "intro":
      return "sandboxWizard.step.intro";
    case "pick":
      return "sandboxWizard.step.pick";
    case "confirm":
      return "sandboxWizard.step.confirm";
  }
}

/** Seed answers with recommended profile pre-selected. */
export function createSandboxWizardAnswers(opts?: {
  platform?: string | null;
  cliSupportsSandbox?: boolean | null;
  /** Override initial selection (default = recommended). */
  profile?: SandboxProfileId | null;
}): SandboxWizardAnswers {
  const rec = recommendSandboxForTrust({
    platform: opts?.platform,
    cliSupportsSandbox: opts?.cliSupportsSandbox,
  });
  return {
    profile:
      opts?.profile !== undefined
        ? opts.profile
        : rec.profile,
    dontOfferAgain: false,
  };
}

/** Parse dismiss flag from storage raw value. */
export function parseSandboxWizardDismissed(raw: unknown): boolean {
  if (raw == null || raw === "") return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (typeof raw !== "string") return false;
  try {
    const parsed = JSON.parse(raw) as Partial<SandboxWizardDismissStored>;
    if (parsed && typeof parsed === "object" && parsed.dismissed === true) {
      return true;
    }
  } catch {
    /* not JSON */
  }
  return false;
}

export function loadSandboxWizardDismissed(
  storage: SandboxWizardStorage = defaultStorage(),
): boolean {
  try {
    return parseSandboxWizardDismissed(
      storage.getItem(SANDBOX_WIZARD_DISMISS_KEY),
    );
  } catch {
    return false;
  }
}

export function markSandboxWizardDismissed(
  storage: SandboxWizardStorage = defaultStorage(),
): void {
  const payload: SandboxWizardDismissStored = {
    version: SANDBOX_WIZARD_DISMISS_VERSION,
    dismissed: true,
  };
  try {
    storage.setItem(SANDBOX_WIZARD_DISMISS_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota */
  }
}

export function clearSandboxWizardDismissed(
  storage: SandboxWizardStorage = defaultStorage(),
): void {
  try {
    if (typeof storage.removeItem === "function") {
      storage.removeItem(SANDBOX_WIZARD_DISMISS_KEY);
    } else {
      storage.setItem(SANDBOX_WIZARD_DISMISS_KEY, "");
    }
  } catch {
    /* private mode */
  }
}
