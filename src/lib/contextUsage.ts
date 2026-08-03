/**
 * Context usage chip — pure token format + state for honest UX.
 *
 * Token estimate heuristic (when the agent has not reported counts):
 *   tokens ≈ ceil(visibleChars / 4)
 * Chip total sums user + assistant body (+ thought) only (tools skipped),
 * except tools/system-only transcripts soft-fall back to breakdown total.
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

export type ContextUsageSource = "known" | "estimated" | "unknown";

export interface LastCompactSummary {
  trigger: string;
  tokensBefore?: number;
  tokensAfter?: number;
  summaryPreview?: string;
  note?: string;
  messageId?: string;
}

/** Agent-reported turn/context usage (preferred over char heuristics). */
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

export interface ContextUsageState {
  /** Absolute tokens from last agent compact event (`tokensAfter`). */
  knownTokens: number | null;
  /** Message id of the last compact marker (for post-compact delta). */
  lastCompactMessageId: string | null;
  lastCompact: LastCompactSummary | null;
  /**
   * Latest agent-reported usage (input/output/total).
   * Prefer total for the chip when present.
   */
  knownUsage: KnownUsageBreakdown | null;
}

export const INITIAL_CONTEXT_USAGE: ContextUsageState = {
  knownTokens: null,
  lastCompactMessageId: null,
  lastCompact: null,
  knownUsage: null,
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
      };
    }
    case "usage": {
      const inputTokens = finiteToken(action.inputTokens) ?? null;
      const outputTokens = finiteToken(action.outputTokens) ?? null;
      const systemTokens = finiteToken(action.systemTokens) ?? null;
      const toolsTokens = finiteToken(action.toolsTokens) ?? null;
      const historyTokens = finiteToken(action.historyTokens) ?? null;
      let totalTokens = finiteToken(action.totalTokens) ?? null;
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
        historyTokens == null
      ) {
        return state;
      }
      return {
        ...state,
        // Prefer agent total as known chip base when provided.
        knownTokens:
          totalTokens != null ? totalTokens : state.knownTokens,
        lastCompactMessageId:
          totalTokens != null ? null : state.lastCompactMessageId,
        knownUsage: {
          inputTokens,
          outputTokens,
          totalTokens,
          systemTokens,
          toolsTokens,
          historyTokens,
          cachedReadTokens: finiteToken(action.cachedReadTokens) ?? null,
          cacheCreationTokens: finiteToken(action.cacheCreationTokens) ?? null,
          reasoningTokens: finiteToken(action.reasoningTokens) ?? null,
          costUsdTicks: finiteToken(action.costUsdTicks) ?? null,
          source: action.source,
        },
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
    const isCompact =
      m.marker === "context_compact" ||
      (m.role === "tool" &&
        (m.content?.startsWith("context_compact") || !!m.compactMeta));
    if (!isCompact) continue;
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
    };
  }
  return { ...INITIAL_CONTEXT_USAGE };
}

/**
 * Rough token estimate: ~4 characters per token (English-biased).
 * Not a model tokenizer — chip uses `~` when this path is taken.
 */
export function estimateTokensFromText(text: string): number {
  const n = text.length;
  if (n <= 0) return 0;
  return Math.ceil(n / 4);
}

/** Markers that are host journal chrome, not model context content. */
function isJournalChromeMessage(m: ContextUsageMessage): boolean {
  return (
    m.marker === "context_compact" ||
    m.marker === "turn_cancelled" ||
    m.marker === "turn_end"
  );
}

/** True for rows excluded from the chip total estimate (tools stay out of total). */
function isSkippedContextMessage(m: ContextUsageMessage): boolean {
  return (
    isJournalChromeMessage(m) ||
    m.marker === "tool_step" ||
    m.role === "tool"
  );
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

/** Sum visible chat text (user/assistant content + thought); skip tools/markers. */
export function estimateTokensFromMessages(
  messages: ContextUsageMessage[],
): number {
  let chars = 0;
  for (const m of messages) {
    if (isSkippedContextMessage(m)) continue;
    chars += (m.content || "").length;
    chars += (m.thought || "").length;
  }
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

/**
 * Rough role breakdown of visible chat (same ~4 chars/token heuristic).
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

/** Strip trailing `.0` from one-decimal forms (`1.0万` → `1万`). */
function trimTrailingDotZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/**
 * Compact token display — Chinese units only (百 / 千 / 万·萬 / 亿·億).
 * Never English k/M. Pass locale for 萬/億 (zh-TW) vs 万/亿.
 * Example: 500 → 5百 · 1500 → 1.5千 · 12500 → 1.3万 · 1e6 → 100万
 */
export function formatTokenCount(n: number, locale: string = "zh"): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const whole = Math.round(n);
  const isTw =
    locale === "zh-TW" ||
    locale.toLowerCase() === "zh-hant" ||
    locale.toLowerCase().startsWith("zh-hant");
  const wan = isTw ? "萬" : "万";
  const yi = isTw ? "億" : "亿";
  if (whole >= 100_000_000) {
    return `${trimTrailingDotZero((whole / 100_000_000).toFixed(1))}${yi}`;
  }
  if (whole >= 10_000) {
    return `${trimTrailingDotZero((whole / 10_000).toFixed(1))}${wan}`;
  }
  if (whole >= 1_000) {
    return `${trimTrailingDotZero((whole / 1_000).toFixed(1))}千`;
  }
  if (whole >= 100) {
    return `${trimTrailingDotZero((whole / 100).toFixed(1))}百`;
  }
  return String(whole);
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

/** Context-window usage percentage, capped at 100. Null when unknown. */
export function contextPercent(
  tokens: number | null,
  windowSize: number | null,
): number | null {
  if (tokens == null || tokens <= 0) return null;
  if (windowSize == null || windowSize <= 0) return null;
  return Math.min(100, Math.round((tokens / windowSize) * 100));
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
 * `locale` selects 万/亿 vs 萬/億 (and 百/千) for the chip label.
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
  // Breakdown from full visible transcript + any agent-reported buckets.
  const breakdown = breakdownOrNull(messages, knownUsage);
  const cache = cacheHitRate(knownUsage);

  // Prefer agent-reported total with no post-compact delta ambiguity.
  if (
    knownUsage?.totalTokens != null &&
    state.lastCompactMessageId == null
  ) {
    return {
      tokens: knownUsage.totalTokens,
      source: "known",
      label: formatContextChipLabel(knownUsage.totalTokens, "known", locale),
      lastCompact,
      breakdown,
      knownUsage,
      windowSize,
      percent: contextPercent(knownUsage.totalTokens, windowSize),
      cacheHitRate: cache.rate,
      cachedReadTokens: cache.cachedReadTokens,
    };
  }

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
      windowSize,
      percent: contextPercent(tokens, windowSize),
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
      windowSize,
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
        windowSize,
        percent: contextPercent(breakdown.totalTokens, windowSize),
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
        windowSize,
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
      windowSize,
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
    windowSize,
    percent: contextPercent(estimated, windowSize),
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
