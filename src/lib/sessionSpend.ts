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

/**
 * Only the CLI **user-turn** aggregate. Per-call `response_completed` /
 * `turn_usage` packets use a different cache accounting (often cache-only
 * or uncached+cache split) and must not be summed with `turn_completed`.
 */
export function isSessionSpendBillingSource(
  source: string | null | undefined,
): boolean {
  const s = (source ?? "").toLowerCase();
  return s === "turn_completed";
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

/**
 * Per-call / split-accounting fragments: cache with no input, or cache > input
 * and no modelCalls. Those packets must not be summed into the turn snapshot.
 */
export function isSpendFragment(turn: SessionSpendTurn): boolean {
  const input = finiteNonNeg(turn.inputTokens) ?? 0;
  const cached = finiteNonNeg(turn.cachedReadTokens) ?? 0;
  const calls = finiteNonNeg(turn.modelCalls) ?? 0;
  if (calls > 0) return false;
  if (cached > 0 && (input <= 0 || cached > input)) return true;
  return false;
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

/**
 * Cache hit % = cachedRead / input. Null when input is unknown.
 * Caps at 100 — some wires report cache reads outside the input total.
 */
export function sessionSpendCacheHitRate(
  spend: Pick<SessionSpend, "inputTokens" | "cachedReadTokens"> | null | undefined,
): number | null {
  if (!spend) return null;
  const input = spend.inputTokens;
  if (!Number.isFinite(input) || input <= 0) return null;
  const cached = Number.isFinite(spend.cachedReadTokens)
    ? Math.max(0, spend.cachedReadTokens)
    : 0;
  return Math.min(100, Math.round((cached / input) * 100));
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
  if (isSpendFragment(turn)) return state;

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
  let cached = finiteNonNeg(turn.cachedReadTokens) ?? 0;
  // CLI `inputTokens` already includes cache reads; cache cannot exceed input.
  if (input > 0 && cached > input) cached = input;
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

const SPEND_STORE_KEY = "grok.sessionSpend.v1";

const spendBySession = new Map<string, SessionSpend>();
const listeners = new Set<(sessionId: string) => void>();
let storeHydrated = false;

function canUseSessionStorage(): boolean {
  return typeof sessionStorage !== "undefined";
}

function persistSpendStore(): void {
  if (!canUseSessionStorage()) return;
  try {
    const obj: Record<string, SessionSpend> = {};
    for (const [id, spend] of spendBySession) obj[id] = spend;
    sessionStorage.setItem(SPEND_STORE_KEY, JSON.stringify(obj));
  } catch {
    /* quota / private mode */
  }
}

function hydrateSpendStore(): void {
  if (storeHydrated) return;
  storeHydrated = true;
  if (!canUseSessionStorage()) return;
  try {
    const raw = sessionStorage.getItem(SPEND_STORE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, SessionSpend>;
    for (const [id, spend] of Object.entries(obj ?? {})) {
      if (!id || !spend || typeof spend !== "object") continue;
      spendBySession.set(id, { ...emptySessionSpend(), ...spend });
    }
  } catch {
    /* ignore bad cache */
  }
}

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
  hydrateSpendStore();
  if (!sessionId) return emptySessionSpend();
  return spendBySession.get(sessionId) ?? emptySessionSpend();
}

export function resetSessionSpend(sessionId: string): void {
  hydrateSpendStore();
  spendBySession.delete(sessionId);
  persistSpendStore();
  notify(sessionId);
}

export function ingestSessionSpend(
  sessionId: string,
  turn: SessionSpendTurn,
  now = Date.now(),
): SessionSpend {
  hydrateSpendStore();
  const prev = spendBySession.get(sessionId) ?? emptySessionSpend();
  const next = applySessionSpendTurn(prev, turn, now);
  if (next === prev) return prev;
  spendBySession.set(sessionId, next);
  persistSpendStore();
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
  storeHydrated = true;
  if (canUseSessionStorage()) {
    try {
      sessionStorage.removeItem(SPEND_STORE_KEY);
    } catch {
      /* ignore */
    }
  }
}
