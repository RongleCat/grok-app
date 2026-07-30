/**
 * Context usage chip — pure token format + state for honest UX.
 *
 * Token estimate heuristic (when the agent has not reported counts):
 *   tokens ≈ ceil(visibleChars / 4)
 * Chip total sums user + assistant body (+ thought) only (tools skipped).
 * Menu breakdown classifies further:
 *   user / assistant / thought / tools (tool_step & activity) / system-like,
 *   plus history = user+assistant+thought rollup.
 * Agent-reported system/tools/history buckets win without a `~` tilde.
 *
 * Host journal is **not** rewritten on compact (UI history stays full).
 * After a compact without `tokensAfter`, we therefore show "—" rather than
 * re-estimating from the full transcript (that would overstate agent context).
 * When `tokensAfter` is known, later growth is estimated only from messages
 * after that compact marker and the chip is marked estimated (`~`).
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
 * Resolve what the chip should show from reducer state + live messages.
 * `locale` selects 万/亿 vs 萬/億 (and 百/千) for the chip label.
 */
export function resolveContextUsageDisplay(
  state: ContextUsageState,
  messages: ContextUsageMessage[],
  locale: string = "zh",
): ContextUsageDisplay {
  const lastCompact = state.lastCompact;
  const knownUsage = state.knownUsage;
  // Breakdown from full visible transcript + any agent-reported buckets.
  const breakdown = breakdownOrNull(messages, knownUsage);

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
    };
  }

  // Compact happened without token counts — do not trust full UI history.
  if (lastCompact) {
    return {
      tokens: null,
      source: "unknown",
      label: formatContextChipLabel(null, "unknown", locale),
      lastCompact,
      // Still surface visible role split as estimated (honest ~).
      breakdown,
      knownUsage,
    };
  }

  // Never compacted: rough estimate from visible transcript (or unknown empty).
  const estimated = estimateTokensFromMessages(messages);
  if (estimated <= 0) {
    return {
      tokens: null,
      source: "unknown",
      label: formatContextChipLabel(null, "unknown", locale),
      lastCompact: null,
      breakdown: null,
      knownUsage,
    };
  }
  return {
    tokens: estimated,
    source: "estimated",
    label: formatContextChipLabel(estimated, "estimated", locale),
    lastCompact: null,
    breakdown,
    knownUsage,
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

/** Build `/compact` slash command; empty/whitespace note → bare `/compact`. */
export function buildCompactSlashCommand(note: string): string {
  const n = note.trim();
  return n ? `/compact ${n}` : "/compact";
}
