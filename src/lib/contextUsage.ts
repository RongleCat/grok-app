/**
 * Context usage chip — pure token format + state for honest UX.
 *
 * Token estimate heuristic (`estimateTokensFromMessages`, when the agent
 * has not reported counts): tokens ≈ ceil(visibleChars / 4) over the same
 * visible message set the chip uses. Chip total sums user + assistant body
 * (+ thought) only (tools skipped), except tools/system-only transcripts
 * soft-fall back to breakdown total.
 * Menu breakdown classifies further:
 *   user / assistant / thought / tools (tool_step & activity) / system-like,
 *   plus history = user+assistant+thought rollup.
 * Agent-reported system/tools/history buckets win without a `~` tilde.
 *
 * Host journal is **not** rewritten on compact (UI history stays full).
 * After a compact without `tokensAfter`, we soft-fail with "—" (no invented
 * full-history re-estimate). Chip still surfaces so the user can re-compact
 * and read last-compact detail — not a silent hide.
 * When `tokensAfter` is known, later growth is estimated only from messages
 * after that compact marker and the chip is marked estimated (`~`).
 *
 * Empty / no-data honesty (CONTEXT-USAGE-PRO):
 * - Brand-new sessions: hide chip (no "—" placeholder).
 * - Soft-unknown after compact or partial agent signal: show muted "—".
 * - Zero estimated role buckets render as "—" (not "~0").
 */

import {
  formatEnglishCompactCount,
  formatMyriadCount,
  myriadUnitsFor,
} from "./formatCompactCount";

export type ContextUsageSource = "known" | "estimated" | "unknown";

export interface LastCompactSummary {
  trigger: string;
  tokensBefore?: number;
  tokensAfter?: number;
  summaryPreview?: string;
  note?: string;
  messageId?: string;
}

/**
 * Agent-reported usage breakdown (I/O, cache, cost).
 *
 * **Two different meanings of `totalTokens` on the wire** (Grok Build 0.2.x):
 *
 * 1. **Context occupancy** — `params._meta.totalTokens` on streaming
 *    `session/update` chunks (thought / tool / message). Tracks how full the
 *    model context window is right now. Source: `context_size`.
 *
 * 2. **Turn billing aggregate** — `update.usage` on `turn_completed` (and
 *    similar). Sums `inputTokens` / `outputTokens` across **all modelCalls**
 *    in the agentic turn (often 10–20 API rounds). Includes cache reads.
 *    Source: `turn_completed`. **Not** window occupancy — using it for the
 *    ring inflates short chats to 50–100%.
 *
 * Chip / ring must use occupancy only. Cost rollup may use billing totals.
 */
export interface KnownUsageBreakdown {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** Optional structured buckets when the agent reports them. */
  systemTokens?: number | null;
  toolsTokens?: number | null;
  historyTokens?: number | null;
  /** Prompt-caching / reasoning / cost signals (ClaudeCode / Claude plans). */
  cachedReadTokens?: number | null;
  cacheCreationTokens?: number | null;
  reasoningTokens?: number | null;
  /** USD cost in 1e-6 ticks (1 tick = 1 micro-dollar); avoids float drift. */
  costUsdTicks?: number | null;
  /** ACP sessionUpdate kind / source string. */
  source?: string;
}

/**
 * Sources that report **context window occupancy** (not multi-call spend).
 * - `context_size` — Grok Build `params._meta.totalTokens` on stream chunks
 * - `compact` / structured context usage with system/tools/history buckets
 * - Solo `totalTokens` without input/output (stream-shaped)
 */
export function isOccupancyUsageSource(source: string | null | undefined): boolean {
  const s = (source ?? "").toLowerCase();
  if (!s) return false;
  if (
    s === "context_size" ||
    s === "stream_meta" ||
    s === "compact" ||
    s === "contextusage" ||
    s === "context_usage" ||
    s === "tokens_used" ||
    s === "auto_compact_started"
  ) {
    return true;
  }
  return false;
}

/**
 * True when this usage payload is a **turn-level billing aggregate** and must
 * not drive the context ring.
 *
 * Evidence from live Grok sessions:
 *   turn_completed.usage = { inputTokens: 1.6M, totalTokens: 1.7M,
 *     cachedReadTokens: 1.5M, modelCalls: 19 }
 * while stream `_meta.totalTokens` for the same turn ends ~150k.
 */
export function isLikelyBillingAggregateUsage(opts: {
  source?: string | null;
  totalTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedReadTokens?: number | null;
}): boolean {
  const src = (opts.source ?? "").toLowerCase();
  if (
    src === "turn_completed" ||
    src === "response_completed" ||
    src === "prompt_result" ||
    src.includes("turn_completed") ||
    src === "turn_usage" ||
    src === "turnusage"
  ) {
    return true;
  }
  // Explicit occupancy sources are never billing aggregates.
  if (isOccupancyUsageSource(src)) return false;

  const total = opts.totalTokens ?? null;
  const input = opts.inputTokens ?? null;
  const cached = opts.cachedReadTokens ?? null;

  // Multi-call billing: large cache read that is a big fraction of input, and
  // a total that would already overflow a typical 128k–500k window.
  if (
    cached != null &&
    cached > 50_000 &&
    input != null &&
    input > 0 &&
    cached / input >= 0.4 &&
    total != null &&
    total > 200_000
  ) {
    return true;
  }
  return false;
}

/**
 * Whether `knownUsage.totalTokens` is safe to show as context occupancy.
 * Prefer {@link ContextUsageState.knownTokens} when set.
 */
export function knownUsageTotalIsOccupancy(
  usage: KnownUsageBreakdown | null | undefined,
): boolean {
  if (!usage || usage.totalTokens == null) return false;
  if (isLikelyBillingAggregateUsage(usage)) return false;
  if (isOccupancyUsageSource(usage.source)) return true;
  // Solo total (no I/O split) → stream-shaped occupancy.
  if (usage.inputTokens == null && usage.outputTokens == null) return true;
  // Structured context breakdown (system/tools/history) → occupancy.
  if (
    usage.systemTokens != null ||
    usage.toolsTokens != null ||
    usage.historyTokens != null
  ) {
    return true;
  }
  // Single-shot usage without multi-call cache signal: treat as occupancy
  // (short chat turn with one model call ≈ full prompt size).
  if (
    usage.inputTokens != null &&
    usage.outputTokens != null &&
    (usage.cachedReadTokens == null || usage.cachedReadTokens === 0)
  ) {
    return true;
  }
  return false;
}

export interface ContextUsageState {
  /** Absolute occupancy tokens (CLI `tokens_used` / stream `_meta.totalTokens`). */
  knownTokens: number | null;
  /** Message id of the last compact marker (for post-compact delta). */
  lastCompactMessageId: string | null;
  lastCompact: LastCompactSummary | null;
  /**
   * Latest agent-reported usage (input/output/total).
   * Prefer total for the chip when present.
   */
  knownUsage: KnownUsageBreakdown | null;
  /**
   * Agent-reported context window (CLI denominator). Prefer over catalog
   * so ring % matches `/session-info` / auto-compact reason.
   */
  agentContextWindow: number | null;
  /**
   * Agent-reported integer percentage (CLI style) when the wire sends it
   * (`auto_compact_started.percentage`). Cleared when occupancy changes
   * without a fresh percentage.
   */
  agentPercentage: number | null;
}

export const INITIAL_CONTEXT_USAGE: ContextUsageState = {
  knownTokens: null,
  lastCompactMessageId: null,
  lastCompact: null,
  knownUsage: null,
  agentContextWindow: null,
  agentPercentage: null,
};

export type ContextUsageMessage = {
  id: string;
  role: string;
  content?: string;
  thought?: string;
  marker?: string;
  compactMeta?: {
    trigger?: string;
    tokensBefore?: number;
    tokensAfter?: number;
    summaryPreview?: string;
    note?: string;
  } | null;
};

export type ContextUsageAction =
  | { type: "reset" }
  | {
      type: "compact";
      tokensBefore?: number;
      tokensAfter?: number;
      trigger?: string;
      summaryPreview?: string;
      note?: string;
      messageId?: string;
    }
  | {
      type: "usage";
      totalTokens?: number;
      inputTokens?: number;
      outputTokens?: number;
      systemTokens?: number;
      toolsTokens?: number;
      historyTokens?: number;
      cachedReadTokens?: number;
      cacheCreationTokens?: number;
      reasoningTokens?: number;
      costUsdTicks?: number;
      /** CLI context window (tokens). */
      contextWindow?: number;
      /** CLI integer percentage when provided. */
      percentage?: number;
      source?: string;
    }
  | { type: "hydrate"; messages: ContextUsageMessage[] };

function finiteToken(n: number | undefined | null): number | undefined {
  if (n == null || !Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

export function reduceContextUsage(
  state: ContextUsageState,
  action: ContextUsageAction,
): ContextUsageState {
  switch (action.type) {
    case "reset":
      return { ...INITIAL_CONTEXT_USAGE };
    case "compact": {
      const tokensAfter = finiteToken(action.tokensAfter);
      const tokensBefore = finiteToken(action.tokensBefore);
      const trigger = (action.trigger || "auto").toLowerCase();
      // Only keep absolute known tokens when this event reports tokensAfter.
      // A compact without counts invalidates the previous absolute figure.
      return {
        ...state,
        knownTokens: tokensAfter ?? null,
        lastCompactMessageId:
          action.messageId ?? state.lastCompactMessageId,
        lastCompact: {
          trigger:
            trigger === "manual"
              ? "manual"
              : trigger === "auto"
                ? "auto"
                : trigger,
          tokensBefore,
          tokensAfter,
          summaryPreview: action.summaryPreview,
          note: action.note,
          messageId: action.messageId,
        },
        // Compact often resets agent context; clear stale turn usage unless
        // tokensAfter already gives a known base (chip still shows knownTokens).
        knownUsage: tokensAfter != null
          ? {
              inputTokens: null,
              outputTokens: null,
              totalTokens: tokensAfter,
              systemTokens: null,
              toolsTokens: null,
              historyTokens: null,
              source: "compact",
            }
          : null,
        // Keep agent window; percentage no longer valid after compact.
        agentPercentage: null,
      };
    }
    case "usage": {
      const inputTokens = finiteToken(action.inputTokens) ?? null;
      const outputTokens = finiteToken(action.outputTokens) ?? null;
      const systemTokens = finiteToken(action.systemTokens) ?? null;
      const toolsTokens = finiteToken(action.toolsTokens) ?? null;
      const historyTokens = finiteToken(action.historyTokens) ?? null;
      const cachedReadTokens = finiteToken(action.cachedReadTokens) ?? null;
      const cacheCreationTokens =
        finiteToken(action.cacheCreationTokens) ?? null;
      const reasoningTokens = finiteToken(action.reasoningTokens) ?? null;
      const costUsdTicks = finiteToken(action.costUsdTicks) ?? null;
      const agentWindow = finiteToken(action.contextWindow) ?? null;
      const agentPct = finiteToken(action.percentage) ?? null;
      let totalTokens = finiteToken(action.totalTokens) ?? null;
      // Fallback sum only for single-shot I/O (never for billing aggregates).
      if (
        totalTokens == null &&
        inputTokens != null &&
        outputTokens != null
      ) {
        totalTokens = inputTokens + outputTokens;
      }
      if (
        totalTokens == null &&
        inputTokens == null &&
        outputTokens == null &&
        systemTokens == null &&
        toolsTokens == null &&
        historyTokens == null &&
        cachedReadTokens == null &&
        reasoningTokens == null &&
        costUsdTicks == null &&
        agentWindow == null &&
        agentPct == null
      ) {
        return state;
      }

      const knownUsage: KnownUsageBreakdown = {
        inputTokens,
        outputTokens,
        totalTokens,
        systemTokens,
        toolsTokens,
        historyTokens,
        cachedReadTokens,
        cacheCreationTokens,
        reasoningTokens,
        costUsdTicks,
        source: action.source,
      };

      // Occupancy (ring): only context_size / compact-shaped / safe single-shot.
      // Billing aggregates (turn_completed multi-call sums) keep knownUsage for
      // cache/cost UI but must not overwrite knownTokens.
      const billing = isLikelyBillingAggregateUsage({
        source: action.source,
        totalTokens,
        inputTokens,
        outputTokens,
        cachedReadTokens,
      });
      const occupancySafe =
        !billing &&
        totalTokens != null &&
        (isOccupancyUsageSource(action.source) ||
          knownUsageTotalIsOccupancy(knownUsage));

      // Stream meta fires on every chunk — skip no-op occupancy updates
      // (unless window/pct refreshed).
      if (
        occupancySafe &&
        totalTokens === state.knownTokens &&
        (action.source === "context_size" || action.source === "stream_meta") &&
        state.knownUsage?.source === action.source &&
        agentWindow == null &&
        agentPct == null
      ) {
        return state;
      }

      return {
        ...state,
        knownTokens: occupancySafe ? totalTokens : state.knownTokens,
        // Occupancy snapshot clears post-compact delta; billing does not.
        lastCompactMessageId:
          occupancySafe ? null : state.lastCompactMessageId,
        knownUsage,
        agentContextWindow:
          agentWindow ?? state.agentContextWindow,
        // Prefer fresh CLI percentage; clear when occupancy moves without %.
        agentPercentage: occupancySafe
          ? agentPct
          : agentPct ?? state.agentPercentage,
      };
    }
    case "hydrate":
      return hydrateContextUsageFromMessages(action.messages);
    default:
      return state;
  }
}

/** Scan history for the latest compact marker (session open / switch). */
export function hydrateContextUsageFromMessages(
  messages: ContextUsageMessage[],
): ContextUsageState {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!isContextCompactMessage(m)) continue;
    const meta = m.compactMeta;
    const tokensAfter = finiteToken(meta?.tokensAfter);
    const tokensBefore = finiteToken(meta?.tokensBefore);
    const trigger = (meta?.trigger || "auto").toLowerCase();
    return {
      knownTokens: tokensAfter ?? null,
      lastCompactMessageId: m.id,
      lastCompact: {
        trigger:
          trigger === "manual"
            ? "manual"
            : trigger === "auto"
              ? "auto"
              : trigger,
        tokensBefore,
        tokensAfter,
        summaryPreview: meta?.summaryPreview,
        note: meta?.note,
        messageId: m.id,
      },
      knownUsage:
        tokensAfter != null
          ? {
              inputTokens: null,
              outputTokens: null,
              totalTokens: tokensAfter,
              systemTokens: null,
              toolsTokens: null,
              historyTokens: null,
              source: "compact",
            }
          : null,
      agentContextWindow: null,
      agentPercentage: null,
    };
  }
  return { ...INITIAL_CONTEXT_USAGE };
}

/**
 * Rough token estimate: CJK ~1.5 chars/token, other ~4 chars/token.
 * Never a model tokenizer — chip uses `~` when this path is taken.
 * English-biased 4 chars/token was ~10x low for CJK-heavy sessions.
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (isCjkCodePoint(code)) cjk += 1;
    else other += 1;
  }
  if (cjk <= 0 && other <= 0) return 0;
  return Math.ceil(cjk / 1.5 + other / 4);
}

/** CJK unified/compat/extension code points (rough). */
function isCjkCodePoint(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容
    (code >= 0x20000 && code <= 0x2a6df) // CJK 扩展 B
  );
}

/**
 * True for host journal compact marker content (not free-text tool titles).
 * Matches bare `context_compact`, `context_compact|…`, or multiline header.
 * Does **not** match titles that merely contain the word "compact".
 */
export function isContextCompactContent(
  content: string | null | undefined,
): boolean {
  if (!content) return false;
  return (
    content === "context_compact" ||
    content.startsWith("context_compact|") ||
    content.startsWith("context_compact\n")
  );
}

/**
 * Whether a chat/journal row is a real context-compact marker.
 * Prefer explicit `marker`; fall back only to structured content prefix.
 * Never treats tool titles containing "compact" as compaction.
 */
export function isContextCompactMessage(m: {
  marker?: string | null;
  role?: string | null;
  content?: string | null;
  compactMeta?: unknown;
}): boolean {
  if (m.marker === "context_compact") return true;
  if (m.role === "tool" && isContextCompactContent(m.content)) return true;
  return false;
}

/** Markers that are host journal chrome, not model context content. */
function isJournalChromeMessage(m: ContextUsageMessage): boolean {
  return (
    isContextCompactMessage(m) ||
    m.marker === "turn_cancelled" ||
    m.marker === "turn_end"
  );
}

/** True for rows excluded from the chip total estimate (journal chrome only). */
function isSkippedContextMessage(m: ContextUsageMessage): boolean {
  return isJournalChromeMessage(m);
}

/** Sum visible chat text (user/assistant/tool content + thought); skip markers. */
export function estimateTokensFromMessages(
  messages: ContextUsageMessage[],
): number {
  let total = 0;
  for (const m of messages) {
    if (isSkippedContextMessage(m)) continue;
    total += estimateTokensFromText(m.content || "");
    total += estimateTokensFromText(m.thought || "");
  }
  return total;
}

/** Tool / activity rows identifiable in the host journal. */
export function isToolActivityMessage(m: ContextUsageMessage): boolean {
  if (isJournalChromeMessage(m)) return false;
  if (m.marker === "tool_step") return true;
  if (m.role === "tool") return true;
  if (m.role === "activity") return true;
  return false;
}

/** System-prompt / system-marker style rows (rare in host journal). */
export function isSystemLikeMessage(m: ContextUsageMessage): boolean {
  if (isJournalChromeMessage(m) || isToolActivityMessage(m)) return false;
  if (m.role === "system") return true;
  if (m.marker === "system" || m.marker === "system_prompt") return true;
  return false;
}

/**
 * Rough role breakdown of visible chat (CJK-aware, same heuristic as total).
 * Classification:
 *   user → user; assistant text → assistant; thought → thought;
 *   tool/activity → tools; system-like → system.
 * historyTokens is the conversation rollup (user+assistant+thought), not
 * double-counted in totalTokens.
 *
 * `null` optional buckets mean unknown (no signal). Heuristic path always
 * produces numbers for buckets it can attribute (0 when empty).
 * Never model tokenizer output — use ~ in the UI when estimated.
 */
export interface ContextUsageBreakdown {
  userTokens: number;
  assistantTokens: number;
  thoughtTokens: number;
  /** System-like content; null when unknown. */
  systemTokens: number | null;
  /** Tool / activity message content; null when unknown. */
  toolsTokens: number | null;
  /**
   * Conversation history rollup (user+assistant+thought) or agent-reported.
   * Not added again into totalTokens (already covered by role rows).
   */
  historyTokens: number | null;
  /**
   * Sum of user + assistant + thought + system + tools
   * (history is a rollup, not additive).
   */
  totalTokens: number;
  /** True when any bucket is heuristic. */
  estimated: boolean;
  /**
   * Which system/tools/history buckets came from agent reports (no tilde).
   * Role rows (user/assistant/thought) stay estimated unless noted later.
   */
  knownBuckets?: {
    system?: boolean;
    tools?: boolean;
    history?: boolean;
  };
}

function ceilTokensFromChars(chars: number): number {
  return chars <= 0 ? 0 : Math.ceil(chars / 4);
}

export function estimateContextBreakdown(
  messages: ContextUsageMessage[],
): ContextUsageBreakdown {
  let userChars = 0;
  let assistantChars = 0;
  let thoughtChars = 0;
  let systemChars = 0;
  let toolsChars = 0;
  for (const m of messages) {
    if (isJournalChromeMessage(m)) continue;
    const contentLen = (m.content || "").length;
    const thoughtLen = (m.thought || "").length;
    if (isToolActivityMessage(m)) {
      toolsChars += contentLen;
      // Tool rows rarely carry thought; attribute if present.
      thoughtChars += thoughtLen;
      continue;
    }
    if (isSystemLikeMessage(m)) {
      systemChars += contentLen;
      thoughtChars += thoughtLen;
      continue;
    }
    if (m.role === "user") {
      userChars += contentLen;
      // Rare thought on user rows still counts as thought if present.
      thoughtChars += thoughtLen;
    } else {
      // assistant (and any other non-tool visible role)
      assistantChars += contentLen;
      thoughtChars += thoughtLen;
    }
  }
  const userTokens = ceilTokensFromChars(userChars);
  const assistantTokens = ceilTokensFromChars(assistantChars);
  const thoughtTokens = ceilTokensFromChars(thoughtChars);
  const systemTokens = ceilTokensFromChars(systemChars);
  const toolsTokens = ceilTokensFromChars(toolsChars);
  const historyTokens = userTokens + assistantTokens + thoughtTokens;
  return {
    userTokens,
    assistantTokens,
    thoughtTokens,
    systemTokens,
    toolsTokens,
    historyTokens,
    totalTokens:
      userTokens + assistantTokens + thoughtTokens + systemTokens + toolsTokens,
    estimated: true,
  };
}

/**
 * Merge agent-reported system/tools/history into an estimated breakdown.
 * Prefer known numbers without inventing zeros for missing fields.
 */
export function mergeKnownBucketsIntoBreakdown(
  breakdown: ContextUsageBreakdown | null,
  knownUsage: KnownUsageBreakdown | null,
): ContextUsageBreakdown | null {
  if (!knownUsage) return breakdown;
  const knownSystem = finiteToken(knownUsage.systemTokens ?? undefined);
  const knownTools = finiteToken(knownUsage.toolsTokens ?? undefined);
  const knownHistory = finiteToken(knownUsage.historyTokens ?? undefined);
  if (knownSystem == null && knownTools == null && knownHistory == null) {
    return breakdown;
  }
  const base: ContextUsageBreakdown = breakdown ?? {
    userTokens: 0,
    assistantTokens: 0,
    thoughtTokens: 0,
    systemTokens: null,
    toolsTokens: null,
    historyTokens: null,
    totalTokens: 0,
    // Pure agent-reported path — no char heuristic.
    estimated: false,
  };
  const systemTokens =
    knownSystem != null ? knownSystem : base.systemTokens;
  const toolsTokens = knownTools != null ? knownTools : base.toolsTokens;
  const historyTokens =
    knownHistory != null ? knownHistory : base.historyTokens;
  // Recompute total: known system/tools replace estimates; history is rollup.
  const systemPart = systemTokens ?? 0;
  const toolsPart = toolsTokens ?? 0;
  // When role rows are empty and only known history exists, use history in total.
  const roleSum = base.userTokens + base.assistantTokens + base.thoughtTokens;
  const conversationPart =
    roleSum > 0 ? roleSum : (historyTokens ?? 0);
  return {
    ...base,
    systemTokens,
    toolsTokens,
    historyTokens,
    totalTokens: conversationPart + systemPart + toolsPart,
    // Keep estimated when any heuristic role content is present.
    estimated: breakdown != null ? breakdown.estimated : false,
    knownBuckets: {
      system: knownSystem != null ? true : base.knownBuckets?.system,
      tools: knownTools != null ? true : base.knownBuckets?.tools,
      history: knownHistory != null ? true : base.knownBuckets?.history,
    },
  };
}

/**
 * Compact token display.
 * Myriad locales (zh · zh-TW · ja · ko): 百 / 千 / 万·萬·만 / 亿·億·억.
 * Every other locale (incl. en): K / M / B.
 * Example zh: 500 → 5百 · 1500 → 1.5千 · 12500 → 1.3万
 * Example en: 300 → 300 · 5000 → 5K · 500000 → 500K · 1e6 → 1M
 */
export function formatTokenCount(n: number, locale: string = "zh"): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const whole = Math.round(n);
  const units = myriadUnitsFor(locale);
  if (!units) {
    return formatEnglishCompactCount(whole);
  }
  return formatMyriadCount(whole, units);
}

export function formatContextChipLabel(
  tokens: number | null,
  source: ContextUsageSource,
  locale: string = "zh",
): string {
  if (tokens == null || source === "unknown") return "—";
  const f = formatTokenCount(tokens, locale);
  return source === "estimated" ? `~${f}` : f;
}

export interface ContextUsageDisplay {
  tokens: number | null;
  source: ContextUsageSource;
  /** Chip primary label: "42k", "~12k", or "—" */
  label: string;
  lastCompact: LastCompactSummary | null;
  /**
   * Role split of visible chat (chars/4). Always heuristic when present.
   * Null when there is no visible content to attribute.
   */
  breakdown: ContextUsageBreakdown | null;
  /** Agent-reported input/output/total when available. */
  knownUsage: KnownUsageBreakdown | null;
  /** Effective context window (tokens). Null when unknown (chip hides %). */
  windowSize: number | null;
  /** `tokens / windowSize` capped at 100, or null when either is unknown. */
  percent: number | null;
  /** Cache hit rate (%) = cachedReadTokens / inputTokens. Null when unknown. */
  cacheHitRate: number | null;
  /** Agent-reported cached-read tokens (mirror of knownUsage for the chip). */
  cachedReadTokens: number | null;
}

/**
 * How the composer should surface the context chip (CONTEXT-USAGE-PRO).
 *
 * - `hidden` — brand-new / empty: no "—" placeholder flash.
 * - `soft_unknown` — activity signal (compact / partial agent / breakdown)
 *   but no reliable total: show muted "—" and honest unknown copy.
 * - `visible` — known or estimated token total for the chip label.
 */
export type ContextUsageSurfaceKind = "hidden" | "soft_unknown" | "visible";

/** True when agent-reported usage has any numeric field (not inventing zeros). */
export function knownUsageHasSignal(
  known: KnownUsageBreakdown | null | undefined,
): boolean {
  if (!known) return false;
  return (
    known.inputTokens != null ||
    known.outputTokens != null ||
    known.totalTokens != null ||
    known.systemTokens != null ||
    known.toolsTokens != null ||
    known.historyTokens != null
  );
}

/** True when a breakdown has any non-zero or agent-known bucket. */
export function breakdownHasSignal(
  breakdown: ContextUsageBreakdown | null | undefined,
): boolean {
  if (!breakdown) return false;
  if (breakdown.totalTokens > 0) return true;
  if (
    breakdown.userTokens > 0 ||
    breakdown.assistantTokens > 0 ||
    breakdown.thoughtTokens > 0
  ) {
    return true;
  }
  if ((breakdown.systemTokens ?? 0) > 0 || (breakdown.toolsTokens ?? 0) > 0) {
    return true;
  }
  if ((breakdown.historyTokens ?? 0) > 0) return true;
  const kb = breakdown.knownBuckets;
  return Boolean(kb?.system || kb?.tools || kb?.history);
}

/**
 * Resolve composer surface kind from a display snapshot.
 * Pure — no DOM; callers map kind → render / hide.
 */
export function resolveContextUsageSurface(
  display: ContextUsageDisplay,
): ContextUsageSurfaceKind {
  if (display.tokens != null && display.source !== "unknown") {
    return "visible";
  }
  // Soft-fail after compact without token counts — still surface "—".
  if (display.lastCompact) return "soft_unknown";
  // Partial agent usage (I/O split without a chip total, etc.).
  if (knownUsageHasSignal(display.knownUsage)) return "soft_unknown";
  // Tools/system-only estimate path should already set tokens; keep as safety.
  if (breakdownHasSignal(display.breakdown)) return "visible";
  return "hidden";
}

/**
 * Whether the composer should surface context usage.
 * New / empty sessions stay hidden (no "—" placeholder); soft-fail "—"
 * after compact / partial agent is still shown.
 */
export function hasContextUsageData(display: ContextUsageDisplay): boolean {
  return resolveContextUsageSurface(display) !== "hidden";
}

function breakdownOrNull(
  messages: ContextUsageMessage[],
  knownUsage: KnownUsageBreakdown | null = null,
): ContextUsageBreakdown | null {
  const estimated = estimateContextBreakdown(messages);
  const b = mergeKnownBucketsIntoBreakdown(
    estimated.totalTokens > 0 ? estimated : null,
    knownUsage,
  );
  if (!b) return null;
  // Drop empty pure-zero estimates with no known buckets.
  const hasKnown =
    b.knownBuckets?.system ||
    b.knownBuckets?.tools ||
    b.knownBuckets?.history;
  if (b.totalTokens <= 0 && !hasKnown) return null;
  return b;
}

/**
 * Context-window usage percentage, capped at 100.
 * Kept as a decimal (≥2 significant digits) so tiny early-conversation usage
 * is never flattened to an integer "0%" — that hid the composer ring arc
 * and read as "no usage". Returns null when either side is unknown.
 */
export function contextPercent(
  tokens: number | null,
  windowSize: number | null,
): number | null {
  if (tokens == null || tokens <= 0) return null;
  if (windowSize == null || windowSize <= 0) return null;
  const p = Math.min(100, (tokens / windowSize) * 100);
  // Never report a visible "0%" while there is real usage: floor at 0.01%.
  return Math.max(0.01, Math.round(p * 100) / 100);
}

/**
 * Grok Build CLI style: integer percent = round(tokens_used / context_window * 100).
 * Matches `auto_compact_started.percentage` / `/session-info` wording.
 */
export function contextPercentCliStyle(
  tokens: number | null,
  windowSize: number | null,
): number | null {
  if (tokens == null || tokens <= 0) return null;
  if (windowSize == null || windowSize <= 0) return null;
  return Math.min(100, Math.round((tokens / windowSize) * 100));
}

/**
 * Effective window for the ring: prefer agent-reported CLI denominator.
 */
export function resolveOccupancyWindow(
  state: ContextUsageState,
  catalogWindow: number | null = null,
): number | null {
  if (state.agentContextWindow != null && state.agentContextWindow > 0) {
    return state.agentContextWindow;
  }
  if (catalogWindow != null && catalogWindow > 0) return catalogWindow;
  return null;
}

/**
 * Percent for known CLI occupancy: prefer agent integer %, else CLI-style round.
 */
export function resolveOccupancyPercent(
  tokens: number | null,
  state: ContextUsageState,
  catalogWindow: number | null,
  opts?: { estimated?: boolean },
): number | null {
  if (tokens == null || tokens <= 0) return null;
  // Fresh agent percentage only when no post-compact estimate delta.
  if (
    !opts?.estimated &&
    state.agentPercentage != null &&
    state.agentPercentage >= 0
  ) {
    return Math.min(100, state.agentPercentage);
  }
  const window = resolveOccupancyWindow(state, catalogWindow);
  if (opts?.estimated) {
    return contextPercent(tokens, window);
  }
  // Known occupancy: match CLI integer rounding.
  return contextPercentCliStyle(tokens, window) ?? contextPercent(tokens, window);
}

/** Prompt-cache hit rate (%) = cachedReadTokens / inputTokens. Null when unknown. */
export function cacheHitRate(usage: KnownUsageBreakdown | null): {
  rate: number | null;
  cachedReadTokens: number | null;
} {
  if (!usage) return { rate: null, cachedReadTokens: null };
  const cached = usage.cachedReadTokens ?? null;
  const input = usage.inputTokens ?? null;
  if (input == null || input <= 0) {
    return { rate: null, cachedReadTokens: cached };
  }
  const hit = cached ?? 0;
  return { rate: Math.round((hit / input) * 100), cachedReadTokens: cached };
}

/**
 * Resolve what the chip should show from reducer state + live messages.
 * `locale` selects English K/M/B vs 万/亿 vs 萬/億 for the chip label.
 * `windowSize` is the effective context window (tokens) for the "% used" row;
 * null hides the percent row.
 */
export function resolveContextUsageDisplay(
  state: ContextUsageState,
  messages: ContextUsageMessage[],
  locale: string = "zh",
  windowSize: number | null = null,
): ContextUsageDisplay {
  const lastCompact = state.lastCompact;
  const knownUsage = state.knownUsage;
  // Prefer CLI agent window so % matches `/session-info` / auto-compact.
  const effectiveWindow = resolveOccupancyWindow(state, windowSize);
  // Breakdown from full visible transcript + any agent-reported buckets.
  const breakdown = breakdownOrNull(messages, knownUsage);
  const cache = cacheHitRate(knownUsage);

  // Occupancy path: knownTokens is only written from context_size / compact /
  // safe single-shot usage — never from turn_completed multi-call sums.
  if (state.knownTokens != null) {
    let delta = 0;
    if (state.lastCompactMessageId) {
      const idx = messages.findIndex(
        (m) => m.id === state.lastCompactMessageId,
      );
      if (idx >= 0) {
        delta = estimateTokensFromMessages(messages.slice(idx + 1));
      } else {
        // Marker not in list yet — still show known base.
        delta = 0;
      }
    }
    const tokens = state.knownTokens + delta;
    const source: ContextUsageSource = delta > 0 ? "estimated" : "known";
    return {
      tokens,
      source,
      label: formatContextChipLabel(tokens, source, locale),
      lastCompact,
      breakdown,
      knownUsage,
      windowSize: effectiveWindow,
      percent: resolveOccupancyPercent(tokens, state, windowSize, {
        estimated: delta > 0,
      }),
      cacheHitRate: cache.rate,
      cachedReadTokens: cache.cachedReadTokens,
    };
  }

  // Fallback: agent usage total only when it is occupancy-safe (not billing).
  if (
    knownUsage?.totalTokens != null &&
    state.lastCompactMessageId == null &&
    knownUsageTotalIsOccupancy(knownUsage)
  ) {
    return {
      tokens: knownUsage.totalTokens,
      source: "known",
      label: formatContextChipLabel(knownUsage.totalTokens, "known", locale),
      lastCompact,
      breakdown,
      knownUsage,
      windowSize: effectiveWindow,
      percent: resolveOccupancyPercent(
        knownUsage.totalTokens,
        state,
        windowSize,
      ),
      cacheHitRate: cache.rate,
      cachedReadTokens: cache.cachedReadTokens,
    };
  }

  // Compact happened without token counts — do not trust full UI history.
  // Soft-fail: tokens stay unknown ("—"); keep estimated breakdown for honesty.
  if (lastCompact) {
    return {
      tokens: null,
      source: "unknown",
      label: formatContextChipLabel(null, "unknown", locale),
      lastCompact,
      // Still surface visible role split as estimated (honest ~).
      breakdown,
      knownUsage,
      windowSize: effectiveWindow,
      percent: null,
      cacheHitRate: cache.rate,
      cachedReadTokens: cache.cachedReadTokens,
    };
  }

  // Never compacted: rough estimate from visible transcript (or unknown empty).
  const estimated = estimateTokensFromMessages(messages);
  if (estimated <= 0) {
    // Soft-fail: tools/system-only journals skip the chip-total heuristic but
    // still have a breakdown total — surface that as estimated (not invent zero).
    if (breakdown && breakdown.totalTokens > 0) {
      return {
        tokens: breakdown.totalTokens,
        source: "estimated",
        label: formatContextChipLabel(
          breakdown.totalTokens,
          "estimated",
          locale,
        ),
        lastCompact: null,
        breakdown,
        knownUsage,
        windowSize: effectiveWindow,
        percent: contextPercent(breakdown.totalTokens, effectiveWindow),
        cacheHitRate: cache.rate,
        cachedReadTokens: cache.cachedReadTokens,
      };
    }
    // Partial agent I/O without total — soft-unknown surface, no invented sum.
    if (knownUsageHasSignal(knownUsage)) {
      return {
        tokens: null,
        source: "unknown",
        label: formatContextChipLabel(null, "unknown", locale),
        lastCompact: null,
        breakdown,
        knownUsage,
        windowSize: effectiveWindow,
        percent: null,
        cacheHitRate: cache.rate,
        cachedReadTokens: cache.cachedReadTokens,
      };
    }
    return {
      tokens: null,
      source: "unknown",
      label: formatContextChipLabel(null, "unknown", locale),
      lastCompact: null,
      breakdown: null,
      knownUsage,
      windowSize: effectiveWindow,
      percent: null,
      cacheHitRate: cache.rate,
      cachedReadTokens: cache.cachedReadTokens,
    };
  }
  return {
    tokens: estimated,
    source: "estimated",
    label: formatContextChipLabel(estimated, "estimated", locale),
    lastCompact: null,
    breakdown,
    knownUsage,
    windowSize: effectiveWindow,
    percent: contextPercent(estimated, effectiveWindow),
    cacheHitRate: cache.rate,
    cachedReadTokens: cache.cachedReadTokens,
  };
}

/**
 * Prefer agent-reported `tokensBefore`; fall back to the UI estimate captured
 * when the user confirmed manual compact (so the banner can still show a range).
 */
export function mergeCompactTokensBefore(
  agentTokensBefore: number | undefined | null,
  uiTokensBefore: number | undefined | null,
): number | undefined {
  const agent = finiteToken(agentTokensBefore);
  if (agent != null) return agent;
  return finiteToken(uiTokensBefore);
}

/**
 * Compact intensity presets in the App dialog.
 * Grok Build still has no light/standard/aggressive flag, so these seed
 * **note templates** for `/compact`. Separate from CLI 0.2.117+
 * `--compaction-mode` / `--compaction-detail` (see `src/lib/compactionMode.ts`).
 */
export type CompactPresetId = "light" | "standard" | "aggressive";

export const COMPACT_PRESET_IDS: readonly CompactPresetId[] = [
  "light",
  "standard",
  "aggressive",
] as const;

export const DEFAULT_COMPACT_PRESET: CompactPresetId = "standard";

/**
 * When true, {@link buildCompactSlashCommand} would emit a CLI intensity flag.
 * Kept false until Grok Build documents `/compact --intensity=…` (or similar).
 */
export const COMPACT_PRESET_CLI_INTENSITY = false;

/**
 * Rough keep-ratio for **honest** after-estimate in the dialog only.
 * Not model-grade; labels always show `~` so users know it is a guess.
 */
export const COMPACT_PRESET_KEEP_RATIO: Record<CompactPresetId, number> = {
  light: 0.55,
  standard: 0.35,
  aggressive: 0.15,
};

export function isCompactPresetId(value: unknown): value is CompactPresetId {
  return (
    value === "light" || value === "standard" || value === "aggressive"
  );
}

/**
 * Project tokens after a manual compact from current size + preset.
 * Returns null when before is unknown/invalid (dialog shows unknown).
 */
export function estimateCompactAfterTokens(
  beforeTokens: number | null | undefined,
  preset: CompactPresetId = DEFAULT_COMPACT_PRESET,
): number | null {
  const before = finiteToken(beforeTokens);
  if (before == null || before <= 0) return null;
  const ratio = COMPACT_PRESET_KEEP_RATIO[preset] ?? COMPACT_PRESET_KEEP_RATIO.standard;
  return Math.max(1, Math.floor(before * ratio));
}

/**
 * Combine optional preset note template with free-form keep note.
 * Custom text wins over the template when both are set and the custom field
 * is not exactly the template (user edited). Prefer calling with the current
 * field value; App seeds the field from the template on preset change.
 */
export function resolveCompactNoteBody(
  fieldNote: string,
  presetNoteTemplate: string | null | undefined,
): string {
  const field = fieldNote.trim();
  if (field) return field;
  const preset = (presetNoteTemplate ?? "").trim();
  return preset;
}

/**
 * Build `/compact` slash command; empty/whitespace note → bare `/compact`.
 * When {@link COMPACT_PRESET_CLI_INTENSITY} is true and a preset is given,
 * appends `intensity=<id>` so the agent/CLI can prefer a level; today that
 * flag is off and the note alone carries light/standard/aggressive intent.
 */
export function buildCompactSlashCommand(
  note: string,
  opts?: { preset?: CompactPresetId | null },
): string {
  const n = note.trim();
  if (
    COMPACT_PRESET_CLI_INTENSITY &&
    opts?.preset &&
    isCompactPresetId(opts.preset)
  ) {
    const flag = `intensity=${opts.preset}`;
    return n ? `/compact ${flag} ${n}` : `/compact ${flag}`;
  }
  return n ? `/compact ${n}` : "/compact";
}

/**
 * Format before → after range for the compact dialog (and banners).
 * Uses `~` on either side when that side is an estimate.
 * Returns null when both sides are unknown.
 */
export function formatCompactBeforeAfterRange(
  before: number | null | undefined,
  after: number | null | undefined,
  opts: {
    beforeEstimated?: boolean;
    afterEstimated?: boolean;
    locale?: string;
    template: string;
  },
): string | null {
  const b = finiteToken(before);
  const a = finiteToken(after);
  if (b == null && a == null) return null;
  const locale = opts.locale ?? "zh";
  const fmt = (n: number, estimated: boolean) => {
    const s = formatTokenCount(n, locale);
    return estimated ? `~${s}` : s;
  };
  const beforeLabel =
    b != null ? fmt(b, !!opts.beforeEstimated) : "—";
  const afterLabel =
    a != null ? fmt(a, !!opts.afterEstimated) : "—";
  return opts.template
    .replace("{before}", beforeLabel)
    .replace("{after}", afterLabel);
}

export type {
  SessionUsageSnapshot,
} from "./contextUsageSnapshot";
export {
  saveSessionUsageSnapshot,
  loadSessionUsageSnapshot,
  clearSessionUsageSnapshot,
  restoreContextUsageForSession,
} from "./contextUsageSnapshot";
