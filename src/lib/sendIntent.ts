/**
 * Send-intent honesty — pure classification for composer Send / Steer / queue.
 *
 * Product reality (App.tsx `send` / queue Guide) — **do not diverge**:
 * - Empty body → no-op (`blocked_empty`).
 * - `awaiting_permission` → blocked toast; **never** enqueue.
 * - Same-session FSM busy (`streaming` / `connecting`) → **enqueue** follow-up
 *   for after this turn (not mid-turn interject).
 * - Steer / interject is a **separate** path (`sessionInterject` via queue-row
 *   Guide, or composer **Ctrl+Enter** matching Grok Build CLI) while the
 *   agent is generating — classify with `action: "steer"`.
 * - Host live busy on another session / draft → **foreign concurrent** demote+
 *   spawn (`executeSend`); never park into a fake local queue.
 * - Process-global `connecting` is ignored for enqueue gating (parity with
 *   {@link shouldEnqueueSend}).
 *
 * This module is honesty UX only — enqueue semantics stay in `sendQueue.ts`.
 */

import {
  isForeignLiveBusy,
  shouldEnqueueSend,
  SEND_QUEUE_MAX,
} from "@/lib/sendQueue";
import type { SessionState } from "@/lib/session";

/** What the next Send (or Steer) action means for the user. */
export type SendIntentKind =
  | "send_now"
  | "steer"
  | "enqueue"
  | "foreign_concurrent"
  | "blocked_permission"
  | "blocked_empty";

/** i18n keys returned by intent helpers (translate in UI). */
export type SendIntentBannerKey =
  | "composer.intent.enqueue"
  | "composer.intent.steer"
  | "composer.intent.foreignConcurrent"
  | "composer.intent.blockedPermission";

export type SendIntentCtaKey = "composer.intent.openAsNewChat";

export type SendIntentStripLabelKey =
  | "composer.intent.stripEnqueue"
  | "composer.intent.stripHold"
  | "composer.intent.stripSteerHint";

export type ResolveSendIntentOpts = {
  viewedState: SessionState;
  /**
   * Process-global connect flag. Kept for call-site parity with
   * {@link shouldEnqueueSend}; ignored for enqueue gating.
   */
  connecting: boolean;
  liveSessionId: string | null | undefined;
  liveState: SessionState | null | undefined;
  viewedSessionId: string | null | undefined;
  /** True when composer has text and/or attachments. */
  hasBody: boolean;
  /** Current viewed-session queue length (for crowded CTA). */
  queueLength: number;
  /**
   * Default `"send"` classifies the Send / Queue button path.
   * Pass `"steer"` for the queue-row Guide / interject action.
   */
  action?: "send" | "steer";
};

export type SendIntent = {
  kind: SendIntentKind;
  /**
   * True iff the Send path would call `enqueue` (has body + same-session busy,
   * never permission, never foreign-only).
   */
  enqueue: boolean;
  /** Pre-send honesty chip; omit when no banner is useful. */
  bannerKey?: SendIntentBannerKey;
  /**
   * True when showing “Open as new chat” is useful (foreign concurrent, or
   * enqueue with a crowded queue). Callers still pass their own `onOpenNewChat`.
   */
  suggestOpenNewChat: boolean;
};

/** Default queue length at which enqueue suggests opening a new chat. */
export const SEND_INTENT_CROWDED_AT = 5;

/**
 * Map a classified kind to its honesty banner i18n key (or null when silent).
 */
export function resolveSendIntentBanner(
  kind: SendIntentKind,
): SendIntentBannerKey | null {
  switch (kind) {
    case "enqueue":
      return "composer.intent.enqueue";
    case "steer":
      return "composer.intent.steer";
    case "foreign_concurrent":
      return "composer.intent.foreignConcurrent";
    case "blocked_permission":
      return "composer.intent.blockedPermission";
    case "send_now":
    case "blocked_empty":
      return null;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Classify what Send (or Steer) will do for the current composer surface.
 * Mirrors {@link shouldEnqueueSend} + permission + foreign busy; does not
 * change enqueue rules.
 */
export function resolveSendIntent(opts: ResolveSendIntentOpts): SendIntent {
  const action = opts.action ?? "send";
  const queueLength = normalizeCount(opts.queueLength);

  if (!opts.hasBody) {
    return {
      kind: "blocked_empty",
      enqueue: false,
      suggestOpenNewChat: false,
    };
  }

  // Queue-row Guide / mid-turn interject — never enqueues.
  // Runs before permission block: Host auto-cancels ask_user on interject, so
  // steer remains available while a questionnaire is open.
  if (action === "steer") {
    if (canClassifySteer(opts)) {
      return {
        kind: "steer",
        enqueue: false,
        bannerKey: "composer.intent.steer",
        suggestOpenNewChat: false,
      };
    }
    // Guide unavailable: fall through to Send classification so the surface
    // still explains enqueue vs send_now honestly.
  }

  if (opts.viewedState === "awaiting_permission") {
    return {
      kind: "blocked_permission",
      enqueue: false,
      bannerKey: "composer.intent.blockedPermission",
      suggestOpenNewChat: false,
    };
  }

  // Same-session busy → enqueue follow-up (App `send` path).
  // Connecting global flag ignored — parity with shouldEnqueueSend.
  if (shouldEnqueueSend(opts.viewedState, opts.connecting)) {
    const suggestOpenNewChat = queueLength >= SEND_INTENT_CROWDED_AT;
    return {
      kind: "enqueue",
      enqueue: true,
      bannerKey: "composer.intent.enqueue",
      suggestOpenNewChat,
    };
  }

  // Host mid-turn elsewhere → concurrent demote+spawn, not local queue.
  if (
    isForeignLiveBusy(
      opts.liveSessionId,
      opts.liveState,
      opts.viewedSessionId,
    )
  ) {
    return {
      kind: "foreign_concurrent",
      enqueue: false,
      bannerKey: "composer.intent.foreignConcurrent",
      suggestOpenNewChat: true,
    };
  }

  return {
    kind: "send_now",
    enqueue: false,
    suggestOpenNewChat: false,
  };
}

/**
 * Whether the Guide / steer path is available (same product gate as App
 * `canGuideQueuedMessage`: viewed chat mid-turn with a real session id).
 * Live host may lag after demote — viewed FSM live-streaming is enough.
 * Includes `awaiting_permission` (Host auto-cancels questionnaire on interject).
 */
function canClassifySteer(opts: ResolveSendIntentOpts): boolean {
  if (!opts.viewedSessionId) return false;
  // Match isSessionLiveStreaming: streaming | awaiting_permission.
  if (
    opts.viewedState !== "streaming" &&
    opts.viewedState !== "awaiting_permission"
  ) {
    return false;
  }
  // Process-global connect does not block guide in App (only !connecting is
  // checked there for UI busy); keep steer honest while this chat is live.
  return true;
}

function normalizeCount(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * Optional CTA plan: open a separate draft instead of queueing more / stacking
 * concurrent work on the current surface.
 */
export type OpenAsNewSessionPlan = {
  show: boolean;
  ctaKey: SendIntentCtaKey;
  /** Why the CTA is shown (i18n); null when hidden. */
  reasonKey: SendIntentBannerKey | null;
};

export function planOpenAsNewSessionInstead(opts: {
  kind: SendIntentKind;
  queueLength?: number;
  /** Override crowded threshold (default {@link SEND_INTENT_CROWDED_AT}). */
  crowdedAt?: number;
}): OpenAsNewSessionPlan {
  const crowdedAt =
    typeof opts.crowdedAt === "number" && Number.isFinite(opts.crowdedAt)
      ? Math.max(1, Math.floor(opts.crowdedAt))
      : SEND_INTENT_CROWDED_AT;
  const queueLength = normalizeCount(opts.queueLength);
  const crowded = queueLength >= crowdedAt;

  if (opts.kind === "foreign_concurrent") {
    return {
      show: true,
      ctaKey: "composer.intent.openAsNewChat",
      reasonKey: "composer.intent.foreignConcurrent",
    };
  }
  if (opts.kind === "enqueue" && crowded) {
    return {
      show: true,
      ctaKey: "composer.intent.openAsNewChat",
      reasonKey: "composer.intent.enqueue",
    };
  }
  return {
    show: false,
    ctaKey: "composer.intent.openAsNewChat",
    reasonKey: null,
  };
}

/**
 * Queue-strip label keys so strip chrome stays consistent with send intent.
 * Empty / hidden strip → null (caller keeps strip hidden).
 */
export function resolveSendQueueStripIntentLabel(opts: {
  visible: boolean;
  showHold: boolean;
  /** True when mid-turn Guide is available on this chat. */
  canSteer?: boolean;
}): { labelKey: SendIntentStripLabelKey } | null {
  if (!opts.visible) return null;
  if (opts.showHold) {
    return { labelKey: "composer.intent.stripHold" };
  }
  if (opts.canSteer) {
    return { labelKey: "composer.intent.stripSteerHint" };
  }
  return { labelKey: "composer.intent.stripEnqueue" };
}

/**
 * Short label for the primary Send/Queue control (tooltip / aria).
 * Falls back to classic keys when intent is silent.
 */
export type SendControlLabelKey =
  | "composer.send"
  | "composer.queue"
  | "composer.intent.enqueueShort"
  | "composer.intent.foreignShort"
  | "composer.intent.blockedPermission";

export function resolveSendControlLabelKey(
  kind: SendIntentKind,
): SendControlLabelKey {
  switch (kind) {
    case "enqueue":
      return "composer.intent.enqueueShort";
    case "foreign_concurrent":
      return "composer.intent.foreignShort";
    case "blocked_permission":
      return "composer.intent.blockedPermission";
    case "steer":
      // Steer is not the primary Send control; keep classic send label.
      return "composer.send";
    case "send_now":
    case "blocked_empty":
      return "composer.send";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** Expose max for tests that assert crowded CTA vs SEND_QUEUE_MAX. */
export const SEND_INTENT_QUEUE_MAX = SEND_QUEUE_MAX;
