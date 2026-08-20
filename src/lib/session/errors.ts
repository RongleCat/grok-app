import { t, type Locale } from "../../i18n";
import { stripAnsi } from "../ansi";
import {
  buildErrorDeck,
  isAuthDeckCode,
  resolveErrorDeckCode,
} from "../errorDeck";
import type {
  ErrorDeckAction,
  ErrorDeckCard,
  ErrorDeckCode,
  ErrorDeckResolveOpts,
} from "../errorDeck";
import type { AgentError, AgentErrorCode, ChatMessage, TurnErrorPayload } from "./types";

/**
 * Convert in-flight thinking bubble into a persistent error row in the thread.
 * If no streaming assistant exists, append a new error message.
 *
 * Stores a friendly, locale-aware body (not raw RPC/MCP dumps).
 */
export function applyTurnError(
  messages: ChatMessage[],
  payload: TurnErrorPayload,
  locale: Locale = "en",
): ChatMessage[] {
  const content = formatTurnErrorBody(payload, locale);
  const mid = payload.messageId || "";

  let idx = mid ? messages.findIndex((m) => m.id === mid) : -1;
  if (idx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "assistant" && m.streaming) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) {
    // Last empty assistant (host may have already cleared streaming)
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "assistant" && !m.content.trim() && !m.isError) {
        idx = i;
        break;
      }
    }
  }

  if (idx >= 0) {
    const next = messages.slice();
    const prev = next[idx]!;
    next[idx] = {
      ...prev,
      id: mid || prev.id,
      content,
      thought: undefined,
      streaming: false,
      isError: true,
    };
    // Clear any other lingering streaming flags
    return next.map((m, i) =>
      i !== idx && m.streaming ? { ...m, streaming: false } : m,
    );
  }

  return [
    ...messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
    {
      id: mid || `err-${Date.now()}`,
      role: "assistant",
      content,
      streaming: false,
      isError: true,
    },
  ];
}
const KNOWN_ERROR_CODES: AgentErrorCode[] = [
  "CLI_NOT_FOUND",
  "AUTH_FAILED",
  "NETWORK_PROVIDER",
  "AGENT_CRASHED",
  "QUOTA_EXCEEDED",
  "CONNECT_FAILED",
  "PROCESS_LIMIT",
  "CLI_TOO_OLD",
  "SANDBOX_BLOCKED",
];

export function isAgentErrorCode(code: string | undefined | null): code is AgentErrorCode {
  return !!code && (KNOWN_ERROR_CODES as string[]).includes(code);
}

export function errorCopy(code: AgentErrorCode, locale: Locale = "en"): string {
  const card = buildErrorDeck(code, locale);
  return `${card.problem} ${card.cause}`.trim();
}

/** Friendly bubble body from any deck code (including App-only recoveries). */
function errorCopyFromDeck(
  code: ErrorDeckCode,
  locale: Locale = "en",
): string {
  const card = buildErrorDeck(code, locale);
  return `${card.problem} ${card.cause}`.trim();
}

/** Turn took too long (Host session/prompt timeout) — more specific than generic network. */
export function turnTimeoutCopy(locale: Locale = "en"): string {
  const card = buildErrorDeck("TURN_TIMEOUT", locale);
  return `${card.problem} ${card.cause}`.trim();
}

export function agentDisconnectedCopy(locale: Locale = "en"): string {
  const card = buildErrorDeck("AGENT_DISCONNECTED", locale);
  return `${card.problem} ${card.cause}`.trim();
}

/** Mid-stream disconnect / closed before response.completed (relay flap). */
export function streamFlapCopy(locale: Locale = "en"): string {
  return t(locale, "error.streamFlap");
}

const AGENT_ERROR_CODE_RE =
  /^(CLI_NOT_FOUND|AUTH_FAILED|NETWORK_PROVIDER|AGENT_CRASHED|QUOTA_EXCEEDED|CONNECT_FAILED|PROCESS_LIMIT|CLI_TOO_OLD|SANDBOX_BLOCKED)(?::\s*|\s+)([\s\S]*)$/;

const MARKDOWN_CODE_RE =
  /^\*\*(CLI_NOT_FOUND|AUTH_FAILED|NETWORK_PROVIDER|AGENT_CRASHED|QUOTA_EXCEEDED|CONNECT_FAILED|PROCESS_LIMIT|CLI_TOO_OLD|SANDBOX_BLOCKED)\*\*(?:\s*[\r\n]+([\s\S]*))?$/;

export { stripAnsi };

/** Drop stderr tails and other bulky transport noise from error strings. */
export function stripErrorNoise(text: string): string {
  let s = stripAnsi(text).trim();
  const stderrIdx = s.search(/;?\s*stderr:/i);
  if (stderrIdx >= 0) s = s.slice(0, stderrIdx).trim();
  // Collapse multi-line dumps to first useful line for classification.
  return s;
}

/**
 * Parse a stored / live turn-error payload into a friendly chat body.
 * Prefer stable codes; never show raw MCP Connection refused walls of text.
 */
export function formatTurnErrorBody(
  payload: Pick<TurnErrorPayload, "code" | "message" | "content">,
  locale: Locale = "en",
  opts?: Pick<ErrorDeckResolveOpts, "activeSource">,
): string {
  const rawCombined = [payload.content, payload.message, payload.code]
    .filter(Boolean)
    .join("\n");
  const cleaned = stripErrorNoise(rawCombined);

  let code: AgentErrorCode | null = isAgentErrorCode(payload.code)
    ? payload.code
    : null;
  let rest = stripErrorNoise(payload.message || "");

  const md = (payload.content || "").trim().match(MARKDOWN_CODE_RE);
  if (md) {
    code = md[1] as AgentErrorCode;
    rest = stripErrorNoise(md[2] || rest);
  } else {
    const coded = cleaned.match(AGENT_ERROR_CODE_RE);
    if (coded) {
      code = coded[1] as AgentErrorCode;
      rest = stripErrorNoise(coded[2] || rest);
    }
  }

  const lower = `${rest}\n${cleaned}`.toLowerCase();
  if (
    rest === "turn_timeout" ||
    /rpc timeout.*session\/prompt|after\s*\d+s/.test(lower)
  ) {
    return turnTimeoutCopy(locale);
  }
  if (rest === "agent_disconnected" || /rpc channel closed|transport channel closed/i.test(lower)) {
    return agentDisconnectedCopy(locale);
  }
  // Mid-stream flap (common on custom relays / 中转) — soft network copy, not crash.
  if (
    /stream disconnected|stream closed before|before response\.completed|connection reset|broken pipe/i.test(
      lower,
    )
  ) {
    return streamFlapCopy(locale);
  }

  // Prefer resolveErrorDeckCode so AUTH_FAILED subtypes (no-context / api key /
  // custom route) get honest bubble copy instead of the generic 401 line.
  // Pass rawCombined so bwrap/userns in "; stderr: …" survives stripErrorNoise.
  const deckish = resolveErrorDeckCode(code, `${rawCombined}\n${rest}\n${cleaned}`, opts);
  if (isAuthDeckCode(deckish) || deckish === "PERMISSION_DENIED" || deckish === "MCP_AUTH_FAILED" || deckish === "OAUTH_EXPIRED" || deckish === "WORKSPACE_UNTRUSTED" || deckish === "PROJECT_MISSING" || deckish === "SANDBOX_BLOCKED" || deckish === "QUOTA_EXCEEDED" || deckish === "RATE_LIMITED") {
    return errorCopyFromDeck(deckish, locale);
  }

  // Infer codes from common agent/host phrases when payload lacks a code.
  // Map only host AgentErrorCode values into the typed bubble path below.
  // SANDBOX_BLOCKED / QUOTA_EXCEEDED / RATE_LIMITED already returned above
  // via errorCopyFromDeck — do not re-list them here (TS narrows them out).
  if (!code) {
    if (
      deckish === "CONNECT_FAILED" ||
      deckish === "CLI_NOT_FOUND" ||
      deckish === "NETWORK_PROVIDER" ||
      deckish === "AGENT_CRASHED" ||
      deckish === "PROCESS_LIMIT" ||
      deckish === "CLI_TOO_OLD"
    ) {
      code = deckish;
    } else if (
      /could not connect the agent|edit aborted|no active session|acp client missing|connect failed/i.test(
        lower,
      )
    ) {
      code = "CONNECT_FAILED";
    } else if (
      /quota|rate.?limit|429|insufficient.?credit|usage.?limit|out of credits/i.test(
        lower,
      )
    ) {
      code = "QUOTA_EXCEEDED";
    } else if (
      /not logged|unauthor|401|auth failed|access denied|failed to generate authentication/i.test(
        lower,
      )
    ) {
      // Refined above when possible; fallback generic host code.
      return errorCopyFromDeck("AUTH_FAILED", locale);
    } else if (/cli not found|command not found|grok.*not found/i.test(lower)) {
      code = "CLI_NOT_FOUND";
    } else if (
      /stream disconnected|stream closed|5xx|503|timeout|dns|provider retries|network/i.test(
        lower,
      )
    ) {
      code = "NETWORK_PROVIDER";
    }
  }

  if (code) {
    // Known code → friendly copy only (no technical rest in the bubble).
    // AUTH_FAILED already returned via isAuthDeckCode refine above when message
    // was present; bare code still uses host-aligned copy.
    if (code === "AUTH_FAILED") {
      return errorCopyFromDeck(
        resolveErrorDeckCode("AUTH_FAILED", rest || cleaned, opts),
        locale,
      );
    }
    return errorCopy(code, locale);
  }

  // Unknown: keep a short, non-bulky line.
  const first =
    cleaned
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/connection refused|worker quit|hyper_util|reqwest/i.test(l)) ||
    t(locale, "error.requestFailedRetry");
  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}

export type ErrorBannerView = {
  code: string | null;
  /** Headline (deck problem). */
  summary: string;
  /** Supporting line (deck cause). */
  cause: string | null;
  detail: string | null;
  reconnectHint: boolean;
  primary: ErrorDeckAction | null;
  secondary: ErrorDeckAction | null;
  deck: ErrorDeckCard | null;
};

function bannerFromDeck(
  deck: ErrorDeckCard,
  code: string | null,
  detail: string | null,
): ErrorBannerView {
  return {
    code,
    summary: deck.problem,
    cause: deck.cause,
    detail,
    reconnectHint:
      deck.primary.id === "reconnect" || deck.secondary?.id === "reconnect",
    primary: deck.primary,
    secondary: deck.secondary,
    deck,
  };
}

/**
 * Compact banner: T04 deck (problem / cause / primary / secondary).
 * Technical detail only when short and non-noisy (no MCP stderr walls).
 *
 * Pass `activeSource` so AUTH_FAILED can surface custom-route vs official
 * recovery (re-login alone does not fix a bad relay key).
 */
export function presentErrorBanner(
  error: AgentError | null,
  localError: string | null,
  locale: Locale = "en",
  opts?: Pick<ErrorDeckResolveOpts, "activeSource">,
): ErrorBannerView | null {
  if (error) {
    const body = formatTurnErrorBody(
      { code: error.code, message: error.message, content: undefined },
      locale,
      opts,
    );
    const lower = `${error.message}\n${body}`.toLowerCase();
    const timeout =
      error.message === "turn_timeout" ||
      /timeout|超时/.test(lower);
    const disconnected =
      error.message === "agent_disconnected" ||
      /disconnect|中断|rpc channel closed/i.test(lower);
    const deckCode = resolveErrorDeckCode(error.code, error.message, {
      timeout,
      disconnected,
      activeSource: opts?.activeSource,
    });
    const deck = buildErrorDeck(deckCode, locale);
    // Prefer refined deck code on the banner (AUTH_NO_CONTEXT etc.) when Host
    // only sent AUTH_FAILED — still keep raw host code out of the way.
    return bannerFromDeck(deck, deckCode === "GENERIC" ? error.code : deckCode, null);
  }
  if (!localError?.trim()) return null;

  const cleaned = stripErrorNoise(localError);
  const coded = cleaned.match(AGENT_ERROR_CODE_RE);
  if (coded) {
    const code = coded[1] as AgentErrorCode;
    const rest = stripErrorNoise(coded[2] || "");
    const lower = rest.toLowerCase();
    const timeout = rest === "turn_timeout" || /timeout|超时/.test(lower);
    const disconnected =
      rest === "agent_disconnected" || /disconnect|中断/i.test(lower);
    const deckCode = resolveErrorDeckCode(code, rest, {
      timeout,
      disconnected,
      activeSource: opts?.activeSource,
    });
    const deck = buildErrorDeck(deckCode, locale);
    return bannerFromDeck(deck, deckCode === "GENERIC" ? code : deckCode, null);
  }

  const summary = formatTurnErrorBody(
    { code: undefined, message: cleaned, content: undefined },
    locale,
    opts,
  );
  const isTimeoutish = /timeout|超时|中断|disconnect/i.test(summary);
  if (isTimeoutish) {
    const deck = buildErrorDeck(
      /disconnect|中断/i.test(summary)
        ? "AGENT_DISCONNECTED"
        : "TURN_TIMEOUT",
      locale,
    );
    return bannerFromDeck(deck, null, null);
  }

  // Classify free-form localError (trust / path / permission / MCP …).
  // Keep the original short UX string as summary when present so project names
  // from i18n stay visible; deck supplies cause + recovery actions.
  // Auth subtypes use deck problem as summary (more accurate than raw 401 text).
  const classified = resolveErrorDeckCode(null, cleaned, opts);
  if (classified !== "GENERIC") {
    const deck = buildErrorDeck(classified, locale);
    if (isAuthDeckCode(classified)) {
      return bannerFromDeck(deck, classified, null);
    }
    const short =
      cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned;
    return {
      code: classified,
      summary: short,
      cause: deck.cause,
      detail: null,
      reconnectHint:
        deck.primary.id === "reconnect" || deck.secondary?.id === "reconnect",
      primary: deck.primary,
      secondary: deck.secondary,
      deck,
    };
  }

  // Unknown local UX strings — show as-is, soft dismiss.
  const deck = buildErrorDeck("GENERIC", locale);
  return {
    code: null,
    summary: cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned,
    cause: null,
    detail: null,
    reconnectHint: false,
    primary: { id: "dismiss", label: deck.primary.label },
    secondary: null,
    deck: null,
  };
}
