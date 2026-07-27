/**
 * T04 error deck — structured copy for the four product error classes
 * (plus a few host-side codes): problem / cause / primary / secondary.
 *
 * Labels come from i18n; action ids are stable for App handlers.
 */

import { createT, type Locale, type MessageKey } from "@/i18n";

/** What the banner / toast buttons should do. */
export type ErrorDeckActionId =
  | "reconnect"
  | "open_doctor"
  | "open_runtime"
  | "open_account"
  | "open_providers"
  | "dismiss"
  /** Stream-stall banner: clear the stall prompt and keep the turn running. */
  | "keep_waiting"
  /** Stream-stall banner: cancel the in-flight turn. */
  | "cancel_turn";

/** Host / product error classes (aligned with AgentErrorCode + specials). */
export type ErrorDeckCode =
  | "CLI_NOT_FOUND"
  | "AUTH_FAILED"
  | "NETWORK_PROVIDER"
  | "AGENT_CRASHED"
  | "QUOTA_EXCEEDED"
  | "CONNECT_FAILED"
  | "PROCESS_LIMIT"
  | "TURN_TIMEOUT"
  | "AGENT_DISCONNECTED"
  | "STREAM_STALL"
  | "GENERIC";

export type ErrorDeckAction = {
  id: ErrorDeckActionId;
  label: string;
};

export type ErrorDeckCard = {
  code: ErrorDeckCode;
  /** Short headline (what went wrong). */
  problem: string;
  /** One-line likely cause / context. */
  cause: string;
  primary: ErrorDeckAction;
  secondary: ErrorDeckAction | null;
};

type DeckSpec = {
  problem: MessageKey;
  cause: MessageKey;
  primaryId: ErrorDeckActionId;
  primaryLabel: MessageKey;
  secondaryId?: ErrorDeckActionId;
  secondaryLabel?: MessageKey;
};

const DECK: Record<ErrorDeckCode, DeckSpec> = {
  CLI_NOT_FOUND: {
    problem: "error.deck.cli.problem",
    cause: "error.deck.cli.cause",
    primaryId: "open_doctor",
    primaryLabel: "error.action.openDoctor",
    secondaryId: "open_runtime",
    secondaryLabel: "error.action.setCliPath",
  },
  AUTH_FAILED: {
    problem: "error.deck.auth.problem",
    cause: "error.deck.auth.cause",
    primaryId: "open_account",
    primaryLabel: "error.action.openAccount",
    secondaryId: "open_providers",
    secondaryLabel: "error.action.openProviders",
  },
  NETWORK_PROVIDER: {
    problem: "error.deck.network.problem",
    cause: "error.deck.network.cause",
    primaryId: "reconnect",
    primaryLabel: "error.action.reconnect",
    secondaryId: "open_providers",
    secondaryLabel: "error.action.openProviders",
  },
  AGENT_CRASHED: {
    problem: "error.deck.crash.problem",
    cause: "error.deck.crash.cause",
    primaryId: "reconnect",
    primaryLabel: "error.action.reconnect",
    secondaryId: "open_doctor",
    secondaryLabel: "error.action.openDoctor",
  },
  QUOTA_EXCEEDED: {
    problem: "error.deck.quota.problem",
    cause: "error.deck.quota.cause",
    primaryId: "open_account",
    primaryLabel: "error.action.openAccount",
    secondaryId: "dismiss",
    secondaryLabel: "error.action.dismiss",
  },
  CONNECT_FAILED: {
    problem: "error.deck.connect.problem",
    cause: "error.deck.connect.cause",
    primaryId: "reconnect",
    primaryLabel: "error.action.reconnect",
    secondaryId: "open_doctor",
    secondaryLabel: "error.action.openDoctor",
  },
  PROCESS_LIMIT: {
    problem: "error.deck.limit.problem",
    cause: "error.deck.limit.cause",
    primaryId: "open_runtime",
    primaryLabel: "error.action.openRuntime",
    secondaryId: "dismiss",
    secondaryLabel: "error.action.dismiss",
  },
  TURN_TIMEOUT: {
    problem: "error.deck.timeout.problem",
    cause: "error.deck.timeout.cause",
    primaryId: "reconnect",
    primaryLabel: "error.action.retry",
    secondaryId: "dismiss",
    secondaryLabel: "error.action.dismiss",
  },
  AGENT_DISCONNECTED: {
    problem: "error.deck.disconnect.problem",
    cause: "error.deck.disconnect.cause",
    primaryId: "reconnect",
    primaryLabel: "error.action.reconnect",
    secondaryId: "open_doctor",
    secondaryLabel: "error.action.openDoctor",
  },
  STREAM_STALL: {
    problem: "error.deck.stall.problem",
    cause: "error.deck.stall.cause",
    // Handled by the stall banner (not the generic error-banner switch):
    // keep_waiting dismisses the prompt; cancel_turn stops the turn.
    primaryId: "keep_waiting",
    primaryLabel: "agent.streamStallKeepWaiting",
    secondaryId: "cancel_turn",
    secondaryLabel: "agent.streamStallCancel",
  },
  GENERIC: {
    problem: "error.deck.generic.problem",
    cause: "error.deck.generic.cause",
    primaryId: "dismiss",
    primaryLabel: "error.action.dismiss",
    secondaryId: "open_doctor",
    secondaryLabel: "error.action.openDoctor",
  },
};

export function buildErrorDeck(
  code: ErrorDeckCode,
  locale: Locale = "en",
): ErrorDeckCard {
  const t = createT(locale);
  const spec = DECK[code] ?? DECK.GENERIC;
  return {
    code,
    problem: t(spec.problem),
    cause: t(spec.cause),
    primary: { id: spec.primaryId, label: t(spec.primaryLabel) },
    secondary:
      spec.secondaryId && spec.secondaryLabel
        ? { id: spec.secondaryId, label: t(spec.secondaryLabel) }
        : null,
  };
}

const AGENT_DECK_CODES: ErrorDeckCode[] = [
  "CLI_NOT_FOUND",
  "AUTH_FAILED",
  "NETWORK_PROVIDER",
  "AGENT_CRASHED",
  "QUOTA_EXCEEDED",
  "CONNECT_FAILED",
  "PROCESS_LIMIT",
];

/** Map a classified agent code (or special timeout/disconnect) to a deck code. */
export function deckCodeFromAgent(
  code: string | null | undefined,
  opts?: { timeout?: boolean; disconnected?: boolean },
): ErrorDeckCode {
  if (opts?.timeout) return "TURN_TIMEOUT";
  if (opts?.disconnected) return "AGENT_DISCONNECTED";
  if (code && (AGENT_DECK_CODES as string[]).includes(code)) {
    return code as ErrorDeckCode;
  }
  return "GENERIC";
}

/** Whether the primary/secondary action should re-open the agent. */
export function isReconnectAction(id: ErrorDeckActionId): boolean {
  return id === "reconnect";
}

/**
 * Map free-form error text to a deck code when the host did not emit a stable code.
 * Keeps the four product classes (CLI / auth / network / crash) from collapsing to GENERIC.
 */
export function classifyErrorMessage(raw: string | null | undefined): ErrorDeckCode {
  const s = (raw ?? "").toLowerCase();
  if (!s.trim()) return "GENERIC";
  if (
    s.includes("cli_not_found") ||
    s.includes("command not found") ||
    s.includes("no such file") ||
    s.includes("not found in path") ||
    s.includes("grok build not found") ||
    s.includes("cli not found") ||
    (s.includes("executable") && s.includes("not"))
  ) {
    return "CLI_NOT_FOUND";
  }
  if (
    s.includes("auth_failed") ||
    s.includes("unauthorized") ||
    s.includes("401") ||
    s.includes("invalid api key") ||
    s.includes("not logged in") ||
    s.includes("authentication") ||
    s.includes("login required")
  ) {
    return "AUTH_FAILED";
  }
  if (
    s.includes("quota") ||
    s.includes("rate limit") ||
    s.includes("429") ||
    s.includes("insufficient")
  ) {
    return "QUOTA_EXCEEDED";
  }
  if (
    s.includes("network_provider") ||
    s.includes("timed out") ||
    s.includes("timeout") ||
    s.includes("econnrefused") ||
    s.includes("enotfound") ||
    s.includes("dns") ||
    s.includes("502") ||
    s.includes("503") ||
    s.includes("provider") ||
    s.includes("fetch failed")
  ) {
    return "NETWORK_PROVIDER";
  }
  if (
    s.includes("process_limit") ||
    s.includes("too many agent") ||
    s.includes("concurrent agent")
  ) {
    return "PROCESS_LIMIT";
  }
  if (
    s.includes("connect_failed") ||
    s.includes("failed to connect") ||
    s.includes("attach failed")
  ) {
    return "CONNECT_FAILED";
  }
  if (
    s.includes("agent_crashed") ||
    s.includes("exited") ||
    s.includes("panic") ||
    s.includes("segfault") ||
    s.includes("broken pipe") ||
    s.includes("protocol error")
  ) {
    return "AGENT_CRASHED";
  }
  return "GENERIC";
}

/** Prefer a host code; otherwise classify the message text. */
export function resolveErrorDeckCode(
  code: string | null | undefined,
  message?: string | null,
  opts?: { timeout?: boolean; disconnected?: boolean },
): ErrorDeckCode {
  const fromCode = deckCodeFromAgent(code, opts);
  if (fromCode !== "GENERIC") return fromCode;
  return classifyErrorMessage(message ?? code);
}

