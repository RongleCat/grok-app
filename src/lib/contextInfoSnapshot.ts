/**
 * `/context` snapshot from Grok Build `x.ai/session/info`.
 *
 * The pager (`context_info.rs`) splits the window into system prompt, messages,
 * reasoning/overhead, and free. Tool definitions, skills, workflows, and MCP
 * are informational: they are already inside those rows.
 */

export type ContextBarKind = "system" | "messages" | "overhead" | "free";

export interface ContextUsageCategory {
  label: string;
  tokens: number;
  detail: string | null;
}

export interface ContextInfoView {
  used: number;
  total: number;
  /** `used / total * 100`, two-decimal header percent. */
  percent: number;
  /** Integer percent the pager compares with the auto-compact threshold. */
  usagePct: number;
  systemTokens: number;
  messageTokens: number;
  overheadTokens: number;
  freeTokens: number;
  autoCompactPercent: number;
  /** Tokens until the threshold. Null when the window size is unknown. */
  autoCompactRemaining: number | null;
  autoCompactNow: boolean;
  toolDefinitionsTokens: number;
  toolDefinitionsCount: number;
  categories: ContextUsageCategory[];
  turnCount: number;
  toolCallCount: number;
  compactionCount: number;
  model: string | null;
  /** 100-cell bar. The popover lays it out 5×20, same cells as the pager. */
  bar: ContextBarKind[];
}

const BAR_CELLS = 100;
const DEFAULT_AUTO_COMPACT_PERCENT = 85;

function finite(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function pick(obj: Record<string, unknown>, camel: string, snake: string): unknown {
  if (camel in obj) return obj[camel];
  if (snake in obj) return obj[snake];
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Envelope `{ result }`, a JSON string, or the session-info object itself. */
export function unwrapSessionInfoPayload(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  const obj = asObject(value);
  if (!obj) return null;
  const nested = obj.result;
  if (typeof nested === "string") {
    return unwrapSessionInfoPayload(nested);
  }
  const nestedObj = asObject(nested);
  if (nestedObj && (nestedObj.context != null || nestedObj.sessionId != null || nestedObj.session_id != null)) {
    return nestedObj;
  }
  if (obj.context != null || obj.sessionId != null || obj.session_id != null) {
    return obj;
  }
  return null;
}

function percentOfWindow(part: number, total: number): string {
  if (total <= 0) return "—";
  const raw = (part / total) * 100;
  const p = Math.max(raw, part > 0 ? 0.1 : 0);
  return p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}

export function contextShareLabel(part: number, total: number): string {
  return percentOfWindow(part, total);
}

/**
 * `system + messages + overhead + free = total`.
 * Category totals can exceed `used`; `used` can exceed `total`.
 */
export function splitContextWindow(
  used: number,
  total: number,
  systemTokens: number,
  messageTokens: number,
): { system: number; messages: number; overhead: number; free: number } {
  const capped = Math.min(used, total);
  const system = Math.min(systemTokens, capped);
  const messages = Math.min(messageTokens, capped - system);
  return {
    system,
    messages,
    overhead: capped - system - messages,
    free: Math.max(0, total - capped),
  };
}

function usagePct(used: number, total: number, wire: number | null): number {
  if (wire != null) return Math.min(100, wire);
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function buildBar(
  used: number,
  total: number,
  system: number,
  messages: number,
): ContextBarKind[] {
  const cellsFor = (tokens: number) =>
    total <= 0 ? 0 : Math.round((tokens / total) * BAR_CELLS);
  const usedCells = Math.min(BAR_CELLS, cellsFor(used));
  const systemCells = Math.min(usedCells, cellsFor(system));
  const messageCells = Math.min(usedCells - systemCells, cellsFor(messages));
  const overheadCells = usedCells - systemCells - messageCells;
  const freeCells = BAR_CELLS - usedCells;
  return [
    ...Array<ContextBarKind>(systemCells).fill("system"),
    ...Array<ContextBarKind>(messageCells).fill("messages"),
    ...Array<ContextBarKind>(overheadCells).fill("overhead"),
    ...Array<ContextBarKind>(freeCells).fill("free"),
  ];
}

function parseCategories(raw: unknown): ContextUsageCategory[] {
  if (!Array.isArray(raw)) return [];
  const out: ContextUsageCategory[] = [];
  for (const item of raw) {
    const row = asObject(item);
    if (!row) continue;
    const label = pick(row, "label", "label");
    const tokens = finite(pick(row, "tokens", "tokens"));
    if (typeof label !== "string" || !label.trim() || tokens == null) continue;
    const detail = pick(row, "detail", "detail");
    out.push({
      label: label.trim(),
      tokens,
      detail: typeof detail === "string" && detail.trim() ? detail.trim() : null,
    });
  }
  return out;
}

/** Build the pager view. Null when the payload has no context object. */
export function parseContextInfoPayload(raw: unknown): ContextInfoView | null {
  const body = unwrapSessionInfoPayload(raw);
  if (!body) return null;
  const context = asObject(pick(body, "context", "context"));
  if (!context) return null;
  const used = finite(pick(context, "used", "used")) ?? 0;
  const total = finite(pick(context, "total", "total")) ?? 0;
  const systemRaw = finite(pick(context, "systemPromptTokens", "system_prompt_tokens")) ?? 0;
  const messageRaw = finite(pick(context, "messageTokens", "message_tokens")) ?? 0;
  const split = splitContextWindow(used, total, systemRaw, messageRaw);
  const threshold =
    finite(pick(context, "autoCompactThresholdPercent", "auto_compact_threshold_percent")) ??
    DEFAULT_AUTO_COMPACT_PERCENT;
  const pct = usagePct(
    used,
    total,
    finite(pick(context, "usagePct", "usage_pct")),
  );
  const thresholdTokens =
    total > 0 ? Math.ceil((total * Math.min(100, threshold)) / 100) : 0;
  const modelRaw = pick(body, "modelDisplayName", "model_display_name") ?? pick(body, "model", "model");
  const model = typeof modelRaw === "string" && modelRaw.trim() ? modelRaw.trim() : null;
  return {
    used,
    total,
    percent: total > 0 ? (Math.min(used, total) / total) * 100 : 0,
    usagePct: pct,
    systemTokens: split.system,
    messageTokens: split.messages,
    overheadTokens: split.overhead,
    freeTokens: split.free,
    autoCompactPercent: Math.min(100, threshold),
    autoCompactRemaining: total > 0 ? Math.max(0, thresholdTokens - Math.min(used, total)) : null,
    autoCompactNow: pct >= Math.min(100, threshold),
    toolDefinitionsTokens: finite(pick(context, "toolDefinitionsTokens", "tool_definitions_tokens")) ?? 0,
    toolDefinitionsCount: finite(pick(context, "toolDefinitionsCount", "tool_definitions_count")) ?? 0,
    categories: parseCategories(pick(context, "usageCategories", "usage_categories")),
    turnCount: finite(pick(context, "turnCount", "turn_count")) ?? 0,
    toolCallCount: finite(pick(context, "toolCallCount", "tool_call_count")) ?? 0,
    compactionCount: finite(pick(context, "compactionCount", "compaction_count")) ?? 0,
    model,
    bar: buildBar(used, total, split.system, split.messages),
  };
}

/**
 * Lone `/context` line. `/context-window` is a different command.
 * Extra paragraphs stay a normal send.
 */
export function classifyContextSlashLine(
  text: string | null | undefined,
): { args: string } | null {
  const raw = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!raw.startsWith("/")) return null;
  const nl = raw.search(/[\r\n]/);
  const first = (nl === -1 ? raw : raw.slice(0, nl)).trim();
  const rest = nl === -1 ? "" : raw.slice(nl).trim();
  if (rest) return null;
  const match = /^\/context(?:\s+(.*))?$/i.exec(first);
  if (!match) return null;
  return { args: (match[1] ?? "").trim() };
}
