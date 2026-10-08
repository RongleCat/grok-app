/**
 * Official context-window switch, matched to Grok Build's pager command
 * (`/context-window`) and `session/set_model` `_meta.contextWindow`.
 *
 * Short labels (`256k`, `1m`, case-insensitive) and raw token counts are the
 * only accepted forms. A size counts only when it is in the model's advertised
 * list. One window or none is not selectable — the CLI hides the command then.
 */

export interface ContextWindowModel {
  contextWindow?: number | null;
  contextWindows?: number[] | null;
}

export type ContextWindowCommand =
  | { kind: "no-model" }
  | { kind: "no-session" }
  | { kind: "no-options" }
  | { kind: "usage"; options: string; current: string }
  | { kind: "unknown"; token: string; options: string }
  | { kind: "switch"; window: number };

export type ContextWindowFeedback = {
  key:
    | "slash.contextWindowNoModel"
    | "slash.contextWindowNoSession"
    | "slash.contextWindowNone"
    | "slash.contextWindowUsage"
    | "slash.contextWindowUnknown";
  vars?: Record<string, string>;
};

/** Positive token counts, catalog order, duplicates dropped. */
export function positiveContextWindows(
  raw: number[] | null | undefined,
): number[] | undefined {
  if (!raw?.length) return undefined;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const n of raw) {
    if (!Number.isFinite(n) || n <= 0) continue;
    const v = Math.floor(n);
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.length ? out : undefined;
}

/**
 * Windows the pager would list. Empty unless the model advertises more than one,
 * which is when `/context-window` is visible in Grok Build.
 */
export function selectableContextWindows(
  model: ContextWindowModel | null | undefined,
): number[] {
  const list = positiveContextWindows(model?.contextWindows) ?? [];
  return list.length > 1 ? list : [];
}

/** Catalog default or an advertised window. Same rule as the CLI agent. */
export function modelSupportsContextWindow(
  model: ContextWindowModel | null | undefined,
  tokens: number,
): boolean {
  if (!Number.isFinite(tokens) || tokens <= 0) return false;
  const n = Math.floor(tokens);
  const fallback = model?.contextWindow;
  if (fallback != null && Number.isFinite(fallback) && Math.floor(fallback) === n) {
    return true;
  }
  return (positiveContextWindows(model?.contextWindows) ?? []).includes(n);
}

/** `256k` / `1m` for exact multiples. Other counts stay raw (`1048576`). */
export function formatWindowLabel(window: number): string {
  if (window >= 1_000_000 && window % 1_000_000 === 0) {
    return `${window / 1_000_000}m`;
  }
  if (window >= 1_000 && window % 1_000 === 0) {
    return `${window / 1_000}k`;
  }
  return String(window);
}

/** Short label (`256k`, `1m`) or a raw positive token count. */
export function parseWindowToken(token: string): number | null {
  const text = token.trim().toLowerCase();
  if (!text) return null;
  let body = text;
  let mul = 1;
  if (text.endsWith("k")) {
    body = text.slice(0, -1);
    mul = 1_000;
  } else if (text.endsWith("m")) {
    body = text.slice(0, -1);
    mul = 1_000_000;
  }
  if (!/^\d+$/.test(body)) return null;
  const n = Number(body);
  if (!Number.isSafeInteger(n)) return null;
  const product = n * mul;
  if (!Number.isSafeInteger(product) || product <= 0) return null;
  return product;
}

/**
 * Lone `/context-window` line. Extra paragraphs stay a normal send.
 * Returns the argument string (`""` when the size was omitted).
 */
export function classifyContextWindowSlashLine(
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
  const match = /^\/context-window(?:\s+(.*))?$/i.exec(first);
  if (!match) return null;
  return { args: (match[1] ?? "").trim() };
}

/** Same-line text after the `/context-window` token. */
export function leftoverContextWindowArgs(
  stored: string,
  slashEnd: number,
): string {
  const after = String(stored ?? "").slice(Math.max(0, slashEnd));
  const line = after.split(/\r?\n/, 1)[0] ?? "";
  return line.trim();
}

/** Drop the command and its same-line size. Later paragraphs stay. */
export function stripContextWindowSlashFromDraft(
  stored: string,
  slashStart: number,
  slashEnd: number,
): string {
  const s = String(stored ?? "");
  const start = Math.max(0, slashStart);
  const end = Math.max(start, slashEnd);
  const after = s.slice(end);
  const nl = after.search(/[\r\n]/);
  const keep = nl === -1 ? "" : after.slice(nl).replace(/^\r?\n/, "");
  return (s.slice(0, start) + keep).replace(/[ \t]+$/u, "");
}

/**
 * Pager `run` order: no model, no session, no choices, empty usage, then
 * resolve the token against the advertised list.
 */
export function resolveContextWindowCommand(input: {
  args: string;
  hasModel: boolean;
  hasSession: boolean;
  options: number[];
  current: number | null;
}): ContextWindowCommand {
  if (!input.hasModel) return { kind: "no-model" };
  if (!input.hasSession) return { kind: "no-session" };
  const options = input.options.filter((n) => Number.isFinite(n) && n > 0);
  if (options.length <= 1) return { kind: "no-options" };
  const offered = options.map((n) => formatWindowLabel(n)).join(", ");
  const trimmed = input.args.trim();
  if (!trimmed) {
    const current =
      input.current != null && Number.isFinite(input.current) && input.current > 0
        ? ` (current: ${formatWindowLabel(Math.floor(input.current))})`
        : "";
    return {
      kind: "usage",
      options: options.map((n) => formatWindowLabel(n)).join("|"),
      current,
    };
  }
  const parsed = parseWindowToken(trimmed);
  if (parsed == null || !options.includes(parsed)) {
    return { kind: "unknown", token: trimmed, options: offered };
  }
  return { kind: "switch", window: parsed };
}

export function contextWindowSlashFeedback(
  result: Exclude<ContextWindowCommand, { kind: "switch" }>,
): ContextWindowFeedback {
  switch (result.kind) {
    case "no-model":
      return { key: "slash.contextWindowNoModel" };
    case "no-session":
      return { key: "slash.contextWindowNoSession" };
    case "no-options":
      return { key: "slash.contextWindowNone" };
    case "usage":
      return {
        key: "slash.contextWindowUsage",
        vars: { options: result.options, current: result.current },
      };
    case "unknown":
      return {
        key: "slash.contextWindowUnknown",
        vars: { token: result.token, options: result.options },
      };
  }
}
