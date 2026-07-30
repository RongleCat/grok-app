/**
 * Context usage chip — pure token format + state for honest UX.
 *
 * Token estimate heuristic (when the agent has not reported counts):
 *   tokens ≈ ceil(visibleChars / 4)
 * where visibleChars sums user + assistant body (+ thought) only.
 * Tool / marker rows are skipped.
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
              source: "compact",
            }
          : null,
      };
    }
    case "usage": {
      const inputTokens = finiteToken(action.inputTokens) ?? null;
      const outputTokens = finiteToken(action.outputTokens) ?? null;
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
        outputTokens == null
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

/** True for rows excluded from visible-chat token estimates. */
function isSkippedContextMessage(m: ContextUsageMessage): boolean {
  return (
    m.marker === "context_compact" ||
    m.marker === "tool_step" ||
    m.marker === "turn_cancelled" ||
    m.role === "tool"
  );
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
 * Always estimated — never model tokenizer output.
 * User content → user; assistant body → assistant; thought/reasoning → thought.
 */
export interface ContextUsageBreakdown {
  userTokens: number;
  assistantTokens: number;
  thoughtTokens: number;
  /** Sum of the three role estimates (each ceil'd independently). */
  totalTokens: number;
  /** Always true for this heuristic path. */
  estimated: true;
}

export function estimateContextBreakdown(
  messages: ContextUsageMessage[],
): ContextUsageBreakdown {
  let userChars = 0;
  let assistantChars = 0;
  let thoughtChars = 0;
  for (const m of messages) {
    if (isSkippedContextMessage(m)) continue;
    const contentLen = (m.content || "").length;
    const thoughtLen = (m.thought || "").length;
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
  const userTokens = userChars <= 0 ? 0 : Math.ceil(userChars / 4);
  const assistantTokens =
    assistantChars <= 0 ? 0 : Math.ceil(assistantChars / 4);
  const thoughtTokens = thoughtChars <= 0 ? 0 : Math.ceil(thoughtChars / 4);
  return {
    userTokens,
    assistantTokens,
    thoughtTokens,
    totalTokens: userTokens + assistantTokens + thoughtTokens,
    estimated: true,
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
): ContextUsageBreakdown | null {
  const b = estimateContextBreakdown(messages);
  if (b.totalTokens <= 0) return null;
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
  // Breakdown always from full visible transcript (host history not rewritten).
  const breakdown = breakdownOrNull(messages);

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
