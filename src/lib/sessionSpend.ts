/**
 * Session billing spend — TUI `/usage` “since start or last resume”.
 *
 * Accumulates **turn-level billing** (`turn_completed` / `response_completed`)
 * only. Occupancy (`context_size`, compact) must never land here.
 *
 * `session/prompt` result.usage is sourced as `prompt_result` so it is not
 * double-counted with the matching `sessionUpdate: turn_completed`.
 */

export type SessionSpend = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedReadTokens: number;
  reasoningTokens: number;
  modelCalls: number;
  apiDurationMs: number;
  /** Sum of known ticks; null until any turn reports cost. */
  costUsdTicks: number | null;
  usageIsIncomplete: boolean;
  costIsPartial: boolean;
  /** Epoch ms of the last accepted turn (dedupe). */
  lastAt: number;
  lastFingerprint: string | null;
};

export type SessionSpendTurn = {
  source?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cachedReadTokens?: number | null;
  reasoningTokens?: number | null;
  modelCalls?: number | null;
  apiDurationMs?: number | null;
  costUsdTicks?: number | null;
  usageIsIncomplete?: boolean | null;
  costIsPartial?: boolean | null;
};

/** Live Grok Build journals: ticks / 1e9 = USD (`$3.2001` TUI style). */
export const COST_USD_TICKS_PER_DOLLAR = 1_000_000_000;

const DEDUPE_WINDOW_MS = 3_000;

export const EMPTY_SESSION_SPEND: SessionSpend = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedReadTokens: 0,
  reasoningTokens: 0,
  modelCalls: 0,
  apiDurationMs: 0,
  costUsdTicks: null,
  usageIsIncomplete: false,
  costIsPartial: false,
  lastAt: 0,
  lastFingerprint: null,
};

export function emptySessionSpend(): SessionSpend {
  return { ...EMPTY_SESSION_SPEND };
}

export function isSessionSpendBillingSource(
  source: string | null | undefined,
): boolean {
  const s = (source ?? "").toLowerCase();
  if (!s) return false;
  if (s === "prompt_result") return false;
  return (
    s === "turn_completed" ||
    s === "response_completed" ||
    s.includes("turn_completed") ||
    s === "turn_usage" ||
    s === "turnusage"
  );
}

function finiteNonNeg(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function spendTurnFingerprint(turn: SessionSpendTurn): string {
  return [
    finiteNonNeg(turn.inputTokens) ?? "",
    finiteNonNeg(turn.outputTokens) ?? "",
    finiteNonNeg(turn.totalTokens) ?? "",
    finiteNonNeg(turn.cachedReadTokens) ?? "",
    finiteNonNeg(turn.reasoningTokens) ?? "",
    finiteNonNeg(turn.modelCalls) ?? "",
    finiteNonNeg(turn.apiDurationMs) ?? "",
    finiteNonNeg(turn.costUsdTicks) ?? "",
  ].join(":");
}

export function hasSpendSignal(turn: SessionSpendTurn): boolean {
  return (
    finiteNonNeg(turn.inputTokens) != null ||
    finiteNonNeg(turn.outputTokens) != null ||
    finiteNonNeg(turn.totalTokens) != null ||
    finiteNonNeg(turn.cachedReadTokens) != null ||
    finiteNonNeg(turn.reasoningTokens) != null ||
    finiteNonNeg(turn.modelCalls) != null ||
    finiteNonNeg(turn.apiDurationMs) != null ||
    finiteNonNeg(turn.costUsdTicks) != null
  );
}

export function hasSessionSpend(spend: SessionSpend | null | undefined): boolean {
  if (!spend) return false;
  return (
    spend.inputTokens > 0 ||
    spend.outputTokens > 0 ||
    spend.totalTokens > 0 ||
    spend.cachedReadTokens > 0 ||
    spend.reasoningTokens > 0 ||
    spend.modelCalls > 0 ||
    spend.apiDurationMs > 0 ||
    (spend.costUsdTicks != null && spend.costUsdTicks > 0)
  );
}

export function applySessionSpendTurn(
  state: SessionSpend,
  turn: SessionSpendTurn,
  now = Date.now(),
): SessionSpend {
  if (!isSessionSpendBillingSource(turn.source)) return state;
  if (!hasSpendSignal(turn)) return state;

  const fp = spendTurnFingerprint(turn);
  if (
    state.lastFingerprint === fp &&
    now - state.lastAt >= 0 &&
    now - state.lastAt < DEDUPE_WINDOW_MS
  ) {
    return state;
  }

  const input = finiteNonNeg(turn.inputTokens) ?? 0;
  const output = finiteNonNeg(turn.outputTokens) ?? 0;
  const cached = finiteNonNeg(turn.cachedReadTokens) ?? 0;
  const reasoning = finiteNonNeg(turn.reasoningTokens) ?? 0;
  const calls = finiteNonNeg(turn.modelCalls) ?? 0;
  const duration = finiteNonNeg(turn.apiDurationMs) ?? 0;
  const ticks = finiteNonNeg(turn.costUsdTicks);
  let total = finiteNonNeg(turn.totalTokens);
  if (total == null && (input > 0 || output > 0)) {
    total = input + output;
  }

  return {
    inputTokens: state.inputTokens + input,
    outputTokens: state.outputTokens + output,
    totalTokens: state.totalTokens + (total ?? 0),
    cachedReadTokens: state.cachedReadTokens + cached,
    reasoningTokens: state.reasoningTokens + reasoning,
    modelCalls: state.modelCalls + calls,
    apiDurationMs: state.apiDurationMs + duration,
    costUsdTicks:
      ticks != null
        ? (state.costUsdTicks ?? 0) + ticks
        : state.costUsdTicks,
    usageIsIncomplete:
      state.usageIsIncomplete || turn.usageIsIncomplete === true,
    costIsPartial:
      state.costIsPartial ||
      turn.costIsPartial === true ||
      (ticks == null && hasSpendSignal(turn) && state.costUsdTicks != null),
    lastAt: now,
    lastFingerprint: fp,
  };
}

/**
 * Official TUI cost: `$3.2001` (4 decimals). Returns null when ticks unknown.
 */
export function usdFromCostTicks(
  ticks: number | null | undefined,
): number | null {
  const n = finiteNonNeg(ticks);
  if (n == null) return null;
  return n / COST_USD_TICKS_PER_DOLLAR;
}

export function formatUsdFromTicks(
  ticks: number | null | undefined,
): string | null {
  const usd = usdFromCostTicks(ticks);
  if (usd == null) return null;
  return `$${usd.toFixed(4)}`;
}

/** TUI `1m28s` / `56s` / `1h2m`. */
export function formatApiDuration(ms: number | null | undefined): string {
  const n = finiteNonNeg(ms);
  if (n == null || n <= 0) return "—";
  const totalSec = Math.round(n / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return seconds > 0
      ? `${hours}h${minutes}m${seconds}s`
      : minutes > 0
        ? `${hours}h${minutes}m`
        : `${hours}h`;
  }
  return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
}

export function formatExactTokenCount(
  n: number | null | undefined,
  locale = "en",
): string {
  const v = finiteNonNeg(n);
  if (v == null) return "—";
  try {
    return v.toLocaleString(locale);
  } catch {
    return String(v);
  }
}

/** TUI “Resets: August 14, 14:05” — locale-aware, 24h clock. */
export function formatUsageResetTime(
  iso: string | null | undefined,
  locale = "en",
): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const loc =
    locale === "zh-TW" ? "zh-Hant" : locale === "zh" ? "zh-CN" : "en-US";
  try {
    const date = new Intl.DateTimeFormat(loc, {
      month: "long",
      day: "numeric",
    }).format(d);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${date}, ${hh}:${mm}`;
  } catch {
    return "";
  }
}

// ── In-memory per-session store (App process lifetime) ────────────────

const spendBySession = new Map<string, SessionSpend>();
const listeners = new Set<(sessionId: string) => void>();

function notify(sessionId: string): void {
  for (const fn of listeners) {
    try {
      fn(sessionId);
    } catch {
      /* subscriber must not break ingest */
    }
  }
}

export function getSessionSpend(sessionId: string | null | undefined): SessionSpend {
  if (!sessionId) return emptySessionSpend();
  return spendBySession.get(sessionId) ?? emptySessionSpend();
}

export function resetSessionSpend(sessionId: string): void {
  spendBySession.delete(sessionId);
  notify(sessionId);
}

export function ingestSessionSpend(
  sessionId: string,
  turn: SessionSpendTurn,
  now = Date.now(),
): SessionSpend {
  const prev = spendBySession.get(sessionId) ?? emptySessionSpend();
  const next = applySessionSpendTurn(prev, turn, now);
  if (next === prev) return prev;
  spendBySession.set(sessionId, next);
  notify(sessionId);
  return next;
}

export function subscribeSessionSpend(
  fn: (sessionId: string) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test-only: wipe the process map. */
export function clearSessionSpendStore(): void {
  spendBySession.clear();
}
