/**
 * Parse `path:line` / `path:line:col` citations (rg / LSP / agent style).
 * Pure helpers — soft-fail invalid line/col (never throw).
 */

export type PathLineCitation = {
  /** Path with line/col suffix removed when a valid numeric suffix was present. */
  path: string;
  /** 1-based line, or null when absent / invalid. */
  line: number | null;
  /** 1-based column, or null when absent / invalid. */
  column: number | null;
};

const MAX_LINE = 10_000_000;
const MAX_COL = 10_000_000;

/**
 * True when `s` looks like `C:` / `D:` Windows drive prefix at index 0.
 */
function isWindowsDrivePrefix(s: string): boolean {
  return s.length >= 2 && /[A-Za-z]/.test(s[0]!) && s[1] === ":";
}

/**
 * Parse a trailing `:digits` or `:digits:digits` suffix as line / line:col.
 * Does not treat Windows drive letters as the first separator.
 * Soft-fail: zero, negative, non-finite, or oversized → null fields; path
 * stays the original token when nothing valid was stripped.
 */
export function parsePathLineCitation(raw: string): PathLineCitation {
  const input = (raw ?? "").trim();
  if (!input) {
    return { path: "", line: null, column: null };
  }

  // Never rewrite URLs (host:port) or schemes.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) || /^https?:\/\//i.test(input)) {
    return { path: input, line: null, column: null };
  }

  const start = isWindowsDrivePrefix(input) ? 2 : 0;
  const rest = input.slice(start);
  // Prefer :line:col from the end, then :line only (greedy .* would steal :line).
  let pathBody = "";
  let lineRaw = "";
  let colRaw: string | undefined;
  const both = rest.match(/^(.*):(\d{1,9}):(\d{1,9})$/);
  if (both) {
    pathBody = both[1] ?? "";
    lineRaw = both[2] ?? "";
    colRaw = both[3];
  } else {
    const one = rest.match(/^(.*):(\d{1,9})$/);
    if (!one) {
      return { path: input, line: null, column: null };
    }
    pathBody = one[1] ?? "";
    lineRaw = one[2] ?? "";
  }
  // Path must be non-empty after strip (avoid bare `:12`).
  if (!pathBody) {
    return { path: input, line: null, column: null };
  }

  const path = input.slice(0, start) + pathBody;
  // Require the stripped path to still look path-like (avoid `error:404` etc.).
  // Allow extensions, separators, or absolute/home roots.
  const looksPath =
    /[/\\]/.test(path) ||
    /\.\w{1,12}$/.test(path) ||
    path.startsWith("~") ||
    isWindowsDrivePrefix(path);
  if (!looksPath) {
    return { path: input, line: null, column: null };
  }

  const line = parsePositiveInt(lineRaw, MAX_LINE);
  const column =
    colRaw != null && colRaw !== ""
      ? parsePositiveInt(colRaw, MAX_COL)
      : null;

  // Soft-fail invalid line: keep full token (do not invent a partial strip).
  if (line == null) {
    return { path: input, line: null, column: null };
  }

  return { path, line, column };
}

function parsePositiveInt(s: string, max: number): number | null {
  if (!/^\d+$/.test(s)) return null;
  // Avoid Number('') / leading zeros issues; BigInt not needed for line numbers.
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < 1 || n > max) return null;
  return n;
}

/**
 * Clamp a 1-based focus line into `[1, lineCount]`.
 * Soft-fail: missing / invalid / empty file → null (caller skips scroll).
 */
export function normalizeFocusLine(
  line: number | null | undefined,
  lineCount?: number | null,
): number | null {
  if (line == null || !Number.isFinite(line) || !Number.isInteger(line)) {
    return null;
  }
  if (line < 1) return null;
  if (lineCount != null) {
    if (!Number.isFinite(lineCount) || lineCount < 1) return null;
    if (line > lineCount) return null;
  }
  return line;
}

/** Path only (line/col stripped when valid). */
export function pathWithoutLineSuffix(raw: string): string {
  return parsePathLineCitation(raw).path;
}
