/**
 * SESSION-EXPORT-PRO — multi-format export honesty (md / txt / json / html).
 *
 * Pure helpers for format labels, soft-empty journal detection, estimated size
 * class, soft-fail reason keys, and filename sanitize. NDJSON streaming export
 * lives elsewhere — do not add it here.
 *
 * No DOM / Tauri side effects. Callers own downloads and toasts.
 */

import {
  formatToolSummaryLine,
  shouldPreferCliMarkdownExport,
  type ExportableMessage,
  type SessionExportFormat,
  type SessionExportOptions,
  sessionExportFilenameFor,
} from "@/lib/sessionExport";

/** Transcript formats this pro module covers (no NDJSON). */
export const SESSION_EXPORT_FORMATS: readonly SessionExportFormat[] = [
  "markdown",
  "plain",
  "json",
  "html",
] as const;

/** Stable soft-fail kinds for text-format export toasts. */
export type SessionExportSoftFailKind =
  | "empty"
  | "no_target"
  | "write_failed"
  | "load_failed"
  | "clipboard"
  | "cancelled"
  | "other";

/** Coarse size buckets for honest pre-export meta (never invents content). */
export type SessionExportSizeClass =
  | "empty"
  | "tiny"
  | "small"
  | "medium"
  | "large"
  | "huge";

/** Byte thresholds for {@link sessionExportSizeClass} (UTF-8 estimate). */
export const SESSION_EXPORT_SIZE_THRESHOLDS = {
  /** exclusive upper bound of empty */
  empty: 0,
  tiny: 2 * 1024,
  small: 32 * 1024,
  medium: 256 * 1024,
  large: 2 * 1024 * 1024,
} as const;

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const code =
      typeof (err as Error & { code?: unknown }).code === "string"
        ? String((err as Error & { code?: string }).code)
        : "";
    return `${code} ${err.message} ${err.name}`.trim();
  }
  if (typeof err === "object") {
    const o = err as { code?: unknown; message?: unknown; reason?: unknown };
    const parts = [o.code, o.message, o.reason]
      .filter((x) => x != null && String(x).trim())
      .map(String);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function errCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string") return c.trim().toLowerCase();
  }
  return "";
}

function isToolish(m: ExportableMessage): boolean {
  if (m.role === "tool") return true;
  if (
    m.marker === "tool_step" ||
    m.marker === "context_compact" ||
    m.marker === "turn_cancelled"
  ) {
    return true;
  }
  const c = (m.content || "").trim();
  return c.startsWith("tool_step|") || c.startsWith("tool_step");
}

function normalizeRole(
  role: string | undefined,
): "user" | "assistant" | "other" {
  const r = (role || "").trim().toLowerCase();
  if (r === "user" || r === "human" || r === "me" || r === "prompt") {
    return "user";
  }
  if (
    r === "assistant" ||
    r === "ai" ||
    r === "bot" ||
    r === "model" ||
    r === "grok" ||
    r === "agent"
  ) {
    return "assistant";
  }
  return "other";
}

/** Type guard for {@link SessionExportFormat}. */
export function isSessionExportFormat(v: unknown): v is SessionExportFormat {
  return (
    typeof v === "string" &&
    (SESSION_EXPORT_FORMATS as readonly string[]).includes(v)
  );
}

/** File extension including the leading dot (`.md`, `.txt`, …). */
export function sessionExportFormatExt(format: SessionExportFormat): string {
  switch (format) {
    case "markdown":
      return ".md";
    case "plain":
      return ".txt";
    case "json":
      return ".json";
    case "html":
      return ".html";
  }
}

/**
 * i18n key for the session-menu / long action label
 * (`session.exportMd`, `session.exportPlain`, …).
 */
export function sessionExportFormatLabelKey(format: SessionExportFormat): string {
  switch (format) {
    case "markdown":
      return "session.exportMd";
    case "plain":
      return "session.exportPlain";
    case "json":
      return "session.exportJson";
    case "html":
      return "session.exportHtml";
  }
}

/**
 * i18n key for the short format name chip (`Markdown`, `Plain text`, …).
 */
export function sessionExportFormatNameKey(format: SessionExportFormat): string {
  return `session.exportFormat.${format}`;
}

/**
 * Default include-thoughts / include-tool-summary for a format when the
 * caller does not pass options. Matches existing App / sessionExport defaults.
 */
export function defaultSessionExportOptions(
  format: SessionExportFormat,
): Required<SessionExportOptions> {
  switch (format) {
    case "json":
      // Clean re-import: tools + thoughts off unless opted in.
      return { includeThoughts: false, includeToolSummary: false };
    case "markdown":
    case "plain":
    case "html":
      return { includeThoughts: true, includeToolSummary: true };
  }
}

/**
 * Whether the local journal has any content that would appear in a
 * text-format export under the given options.
 *
 * Soft-empty covers: no messages, only blank shells, tool-only journals when
 * tools are omitted, and JSON paths with no user/assistant body text.
 * Never invents content from title / meta alone.
 */
export function isSessionExportJournalEmpty(
  messages: ExportableMessage[] | null | undefined,
  opts?: {
    format?: SessionExportFormat;
    options?: SessionExportOptions | null;
  },
): boolean {
  if (!messages || messages.length === 0) return true;

  const format = opts?.format ?? "markdown";
  const defaults = defaultSessionExportOptions(format);
  const o = opts?.options ?? {};
  // Explicit option wins; otherwise format defaults (json opt-in tools/thoughts).
  const includeThoughts =
    o.includeThoughts !== undefined
      ? !!o.includeThoughts
      : defaults.includeThoughts;
  const includeToolSummary =
    o.includeToolSummary !== undefined
      ? !!o.includeToolSummary
      : defaults.includeToolSummary;

  for (const m of messages) {
    if (isToolish(m)) {
      if (!includeToolSummary) continue;
      // JSON surfaces tools as assistant `[tool] …` only when opted in.
      const line = formatToolSummaryLine((m.content || "").trim(), m.marker);
      if (line) return false;
      continue;
    }

    const body = (m.content || "").trim();
    const thought = (m.thought || "").trim();

    if (format === "json") {
      const role = normalizeRole(m.role);
      if (role === "other") continue;
      if (body) return false;
      // JSON export skips empty content even when thought is present.
      continue;
    }

    if (body) return false;
    if (includeThoughts && thought) return false;
  }

  return true;
}

/**
 * Approximate UTF-8 byte length of a string (for size class only).
 * Prefer `TextEncoder` when available; fall back to code-unit length.
 */
export function estimateUtf8ByteLength(text: string | null | undefined): number {
  if (text == null || text === "") return 0;
  if (typeof TextEncoder !== "undefined") {
    try {
      return new TextEncoder().encode(text).length;
    } catch {
      /* fall through */
    }
  }
  // Rough multi-byte-aware fallback without TextEncoder.
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 0x7f) n += 1;
    else if (c <= 0x7ff) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      // surrogate pair → 4 bytes
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}

/**
 * Map a byte length to a coarse size class.
 * Negative / non-finite → empty (never invent "large").
 */
export function sessionExportSizeClass(
  byteLength: number | null | undefined,
): SessionExportSizeClass {
  const n = Number(byteLength);
  if (!Number.isFinite(n) || n <= SESSION_EXPORT_SIZE_THRESHOLDS.empty) {
    return "empty";
  }
  if (n < SESSION_EXPORT_SIZE_THRESHOLDS.tiny) return "tiny";
  if (n < SESSION_EXPORT_SIZE_THRESHOLDS.small) return "small";
  if (n < SESSION_EXPORT_SIZE_THRESHOLDS.medium) return "medium";
  if (n < SESSION_EXPORT_SIZE_THRESHOLDS.large) return "large";
  return "huge";
}

/** i18n key for a size-class chip (`session.exportSize.tiny`, …). */
export function sessionExportSizeClassLabelKey(
  cls: SessionExportSizeClass,
): string {
  return `session.exportSize.${cls}`;
}

/**
 * Estimate size class from an already-rendered export body.
 * Does not parse the journal — use when content is already in hand.
 */
export function estimateSessionExportSizeClass(
  body: string | null | undefined,
): {
  byteLength: number;
  sizeClass: SessionExportSizeClass;
  empty: boolean;
} {
  const byteLength = estimateUtf8ByteLength(body);
  const sizeClass = sessionExportSizeClass(byteLength);
  return {
    byteLength,
    sizeClass,
    empty: sizeClass === "empty",
  };
}

/**
 * Classify a thrown value / host error into a stable soft-fail kind.
 * Prefer explicit `code` over free-form text. Never invents success.
 */
export function classifySessionExportError(
  err: unknown,
): SessionExportSoftFailKind {
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (code === "empty" || code === "empty_journal" || code === "empty-session") {
    return "empty";
  }
  if (code === "no_target" || code === "no-target" || code === "no_session") {
    return "no_target";
  }
  if (
    code === "write_failed" ||
    code === "write-failed" ||
    code === "save_failed" ||
    code === "save-failed"
  ) {
    return "write_failed";
  }
  if (
    code === "load_failed" ||
    code === "load-failed" ||
    code === "messages_failed"
  ) {
    return "load_failed";
  }
  if (code === "clipboard" || code === "clipboard_failed") return "clipboard";
  if (code === "cancelled" || code === "cancel" || code === "user_cancelled") {
    return "cancelled";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  if (
    /\bcancel(led)?\b/.test(s) ||
    s.includes("user cancelled") ||
    s.includes("user canceled") ||
    s.includes("dismissed")
  ) {
    return "cancelled";
  }

  const msgOnly =
    err instanceof Error ? (err.message || "").trim().toLowerCase() : "";
  if (
    msgOnly === "empty" ||
    s.trim() === "empty" ||
    s.trim() === "error: empty" ||
    s.trim() === "empty error" ||
    /^empty(\s+error)?$/i.test(s.trim()) ||
    s.includes("nothing to export") ||
    s.includes("empty journal") ||
    s.includes("empty session") ||
    s.includes("no content to export")
  ) {
    return "empty";
  }

  if (
    s.includes("no target") ||
    s.includes("no_target") ||
    s.includes("no session") ||
    s.includes("no conversation")
  ) {
    return "no_target";
  }

  if (
    s.includes("clipboard") ||
    s.includes("write text") ||
    s.includes("copy failed")
  ) {
    return "clipboard";
  }

  if (
    s.includes("session not found") ||
    s.includes("load messages") ||
    s.includes("failed to load") ||
    s.includes("sessionmessages")
  ) {
    return "load_failed";
  }

  if (
    s.includes("write failed") ||
    s.includes("save failed") ||
    s.includes("could not save") ||
    s.includes("disk full") ||
    s.includes("enospc") ||
    s.includes("eacces") ||
    s.includes("permission denied")
  ) {
    return "write_failed";
  }

  return "other";
}

/** i18n message key for a classified soft-fail (never invent success). */
export function sessionExportSoftFailMessageKey(
  kind: SessionExportSoftFailKind,
): string {
  switch (kind) {
    case "empty":
      return "session.exportEmpty";
    case "no_target":
      return "session.exportNoTarget";
    case "write_failed":
      return "session.exportWriteFail";
    case "load_failed":
      return "session.exportLoadFail";
    case "clipboard":
      return "session.exportClipboardFail";
    case "cancelled":
      return "session.exportCancelled";
    case "other":
    default:
      return "session.exportFail";
  }
}

/** Cancelled native dialogs should not toast as a failure. */
export function sessionExportSoftFailSilent(
  kind: SessionExportSoftFailKind,
): boolean {
  return kind === "cancelled";
}

/**
 * Resolve user-facing soft-fail copy from a thrown value.
 * Returns message key + whether to stay silent (cancelled).
 */
export function resolveSessionExportSoftFail(err: unknown): {
  kind: SessionExportSoftFailKind;
  messageKey: string;
  silent: boolean;
  /** Short technical detail for debug suffix (empty when not useful). */
  detail: string;
} {
  const kind = classifySessionExportError(err);
  const messageKey = sessionExportSoftFailMessageKey(kind);
  const silent = sessionExportSoftFailSilent(kind);
  const raw = errText(err).trim();
  let detail = "";
  if (
    kind === "other" &&
    raw &&
    !/^error:\s*$/i.test(raw) &&
    raw.length < 200
  ) {
    detail = raw.replace(/^Error:\s*/i, "").trim();
  }
  return { kind, messageKey, silent, detail };
}

/**
 * Sanitize a free-form session title into a filesystem-safe slug fragment.
 * Strips path separators, control chars, reserved punctuation; collapses
 * whitespace to `-`; clamps length. Empty → `"session"`.
 */
export function sanitizeSessionExportSlug(
  title: string | null | undefined,
  maxLen = 48,
): string {
  const cap = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 48;
  let s = typeof title === "string" ? title : "";
  // Normalize Unicode + strip C0 / C1 controls and DEL.
  s = s.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  // Path / URL separators and Windows-reserved characters.
  s = s.replace(/[\\/:*?"<>|]+/g, "-");
  s = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, cap)
    .replace(/^-+|-+$/g, "");
  // Windows reserved device names (basename only).
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) {
    s = `session-${s}`;
  }
  return s || "session";
}

/**
 * Safe download basename (no extension) from title + optional session id.
 * Aligns with historical `grok-{slug}-{id8}` naming.
 */
export function sanitizeSessionExportBasename(
  title: string | null | undefined,
  sessionId?: string | null,
  maxSlugLen = 48,
): string {
  const slug = sanitizeSessionExportSlug(title, maxSlugLen);
  const id = (sessionId || "").trim().slice(0, 8);
  return id ? `grok-${slug}-${id}` : `grok-${slug}`;
}

/**
 * Safe download filename for a format after slug sanitize.
 * Prefer this over raw titles when building download attributes.
 */
export function sessionExportSafeFilename(
  format: SessionExportFormat,
  title: string | null | undefined,
  sessionId?: string | null,
): string {
  // sessionExportFilenameFor already slugifies; re-run through sanitize so
  // path separators / control chars never leak even if the core helper changes.
  const safeTitle = sanitizeSessionExportSlug(title);
  return sessionExportFilenameFor(format, safeTitle, sessionId);
}

/**
 * Whether text-format export actions may run.
 * `journalEmpty === true` disables; `null`/`undefined` means unknown (allow
 * attempt — load path will soft-fail empty). Busy alone does not invent content.
 */
export function canSessionExportActions(input: {
  hasTarget: boolean;
  /** true = known empty journal; false = has content; null/undefined = unknown */
  journalEmpty?: boolean | null;
  busy?: boolean;
}): boolean {
  if (!input.hasTarget) return false;
  if (input.journalEmpty === true) return false;
  if (input.busy) return false;
  return true;
}

// ── Path honesty: Journal vs CLI export ──────────────────────────────────

/**
 * Where a transcript export will read from.
 * - `journal` — local App journal only (honest single path).
 * - `cli_preferred` — try `grok export` first; soft-fail → journal.
 * - `cli_unavailable` — CLI would be ideal but host/link/version blocks it;
 *   falls back to journal without inventing a CLI path.
 */
export type SessionExportSourcePath =
  | "journal"
  | "cli_preferred"
  | "cli_unavailable";

/** Short badge id for menu / dialog chips. */
export type SessionExportPathBadge = "journal" | "cli";

/** Why CLI was not selected (when path is not `cli_preferred`). */
export type SessionExportCliSkipReason =
  | "format" // plain/json/html — journal-only formats
  | "mode" // copy always uses local journal
  | "options" // partial include toggles need local render
  | "no_agent" // no linked agent session id
  | "host" // browser / non-Tauri — no `session_cli_export`
  | "cli" // host says CLI binary / export subcommand unavailable
  | null;

export type SessionExportPathResolution = {
  path: SessionExportSourcePath;
  /** Download should attempt CLI first. */
  preferCli: boolean;
  /** CLI errors soft-fail to journal (true whenever preferCli). */
  softFailCliToJournal: boolean;
  /**
   * Badges in display order.
   * - journal only → `["journal"]`
   * - CLI preferred → `["cli", "journal"]` (CLI first, journal fallback honesty)
   * - CLI unavailable → `["journal"]` (never badge CLI when it will not run)
   */
  badges: SessionExportPathBadge[];
  /** i18n keys for {@link badges} (`session.exportPath.journal` / `.cli`). */
  badgeKeys: string[];
  /** Why CLI was skipped; null when `cli_preferred` or not applicable. */
  cliSkipReason: SessionExportCliSkipReason;
  /** i18n key for skip / unavailable hint (null when silent). */
  cliSkipReasonKey: string | null;
};

/** i18n key for a path badge chip. */
export function sessionExportPathBadgeKey(
  badge: SessionExportPathBadge,
): string {
  return badge === "cli"
    ? "session.exportPath.cli"
    : "session.exportPath.journal";
}

/** i18n key for a CLI skip / unavailable reason (null when none). */
export function sessionExportCliSkipReasonKey(
  reason: SessionExportCliSkipReason,
): string | null {
  switch (reason) {
    case "no_agent":
      return "session.exportPath.cliNoAgent";
    case "host":
      return "session.exportPath.cliHostOnly";
    case "cli":
      return "session.exportPath.cliUnavailable";
    case "options":
      return "session.exportPath.cliOptions";
    case "mode":
    case "format":
    case null:
      return null;
  }
}

/**
 * Resolve honest export path + badges for a transcript format.
 *
 * Product truth:
 * - Only **Markdown download** with full-transcript options may prefer
 *   `grok export` (CLI has no thought/tool toggles).
 * - Copy, partial options, plain/json/html → local journal only.
 * - Missing agent link / non-Tauri host / CLI unavailable → journal with
 *   honest skip reason (never badge CLI when it will not run).
 * - CLI attempt always soft-fails to journal at runtime.
 */
export function resolveSessionExportPath(input: {
  format: SessionExportFormat;
  /** download (default) vs copy — copy is always journal. */
  mode?: "download" | "copy";
  /**
   * Linked Grok Build agent session: `true`, non-empty id string, or false/null.
   */
  hasAgentSession?: boolean | string | null;
  /**
   * Desktop host can invoke `session_cli_export` (`api.isTauri()`).
   * Default true (optimistic); pass false for browser / web preview.
   */
  cliHostAvailable?: boolean | null;
  /**
   * CLI binary / `grok export` subcommand known usable.
   * Default true when unknown (attempt + soft-fail). Pass false when
   * probe/version/shared mode already knows export cannot run.
   */
  cliExportAvailable?: boolean | null;
  options?: SessionExportOptions | null;
}): SessionExportPathResolution {
  const format = input.format;
  const mode = input.mode ?? "download";
  const agentLinked = (() => {
    const v = input.hasAgentSession;
    if (v == null || v === false) return false;
    if (typeof v === "string") return v.trim().length > 0;
    return !!v;
  })();
  const hostOk = input.cliHostAvailable !== false;
  const cliOk = input.cliExportAvailable !== false;
  const optionsOk = shouldPreferCliMarkdownExport(input.options);

  const journalOnly = (
    reason: SessionExportCliSkipReason,
    path: SessionExportSourcePath = "journal",
  ): SessionExportPathResolution => {
    const badges: SessionExportPathBadge[] = ["journal"];
    return {
      path,
      preferCli: false,
      softFailCliToJournal: false,
      badges,
      badgeKeys: badges.map(sessionExportPathBadgeKey),
      cliSkipReason: reason,
      cliSkipReasonKey: sessionExportCliSkipReasonKey(reason),
    };
  };

  // Non-markdown formats never hit CLI.
  if (format !== "markdown") {
    return journalOnly("format");
  }
  // Clipboard always renders from the local journal (options apply).
  if (mode === "copy") {
    return journalOnly("mode");
  }
  // Partial thought/tool toggles cannot be honored by `grok export`.
  if (!optionsOk) {
    return journalOnly("options");
  }
  if (!agentLinked) {
    return journalOnly("no_agent");
  }
  if (!hostOk) {
    return journalOnly("host", "cli_unavailable");
  }
  if (!cliOk) {
    return journalOnly("cli", "cli_unavailable");
  }

  const badges: SessionExportPathBadge[] = ["cli", "journal"];
  return {
    path: "cli_preferred",
    preferCli: true,
    softFailCliToJournal: true,
    badges,
    badgeKeys: badges.map(sessionExportPathBadgeKey),
    cliSkipReason: null,
    cliSkipReasonKey: null,
  };
}

/**
 * Menu / dialog label suffix keys for empty + path badges.
 * Callers join with ` · ` after translating each key.
 */
export function sessionExportMenuSuffixKeys(input: {
  journalEmpty?: boolean | null;
  path?: SessionExportPathResolution | null;
}): string[] {
  const keys: string[] = [];
  if (input.journalEmpty === true) {
    keys.push("session.exportEmptyShort");
  }
  const badges = input.path?.badgeKeys ?? [];
  for (const k of badges) {
    if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

/**
 * Join translated suffix parts with a middle-dot separator.
 * Empty parts are skipped; leading separator never emitted.
 */
export function joinSessionExportMenuSuffix(
  parts: Array<string | null | undefined>,
): string {
  const clean = parts.map((p) => (p || "").trim()).filter(Boolean);
  if (!clean.length) return "";
  return ` · ${clean.join(" · ")}`;
}

/**
 * Success toast key after a completed export.
 * Never claims CLI when the body came from the local journal.
 */
export function sessionExportDoneMessageKey(
  source: "cli" | "journal" | null | undefined,
): string {
  return source === "cli" ? "session.exportDoneCli" : "session.exportDone";
}

/**
 * Classify a CLI `session_cli_export` failure for soft-fail handling.
 * All kinds soft-fail to journal — never hard-block the local path.
 */
export type SessionExportCliSoftFailKind =
  | "no_agent"
  | "cli_missing"
  | "timeout"
  | "empty"
  | "other";

export function classifySessionExportCliError(
  err: unknown,
): SessionExportCliSoftFailKind {
  if (err == null || err === "") return "other";
  const s = errText(err).toLowerCase();
  if (
    s.includes("no agent session") ||
    s.includes("no agent") ||
    s.includes("agent session linked") ||
    s.includes("agent session id")
  ) {
    return "no_agent";
  }
  if (
    s.includes("cli not found") ||
    s.includes("grok build cli not found") ||
    s.includes("command not found") ||
    s.includes("no such file")
  ) {
    return "cli_missing";
  }
  if (s.includes("timed out") || s.includes("timeout")) {
    return "timeout";
  }
  if (
    s.includes("empty") ||
    s.includes("nothing to export") ||
    s.includes("no content")
  ) {
    return "empty";
  }
  return "other";
}

/**
 * Whether a CLI export error should soft-fail to the local journal.
 * Always true today — kept as a named policy for callers / tests.
 */
export function sessionExportCliSoftFailsToJournal(
  _kind?: SessionExportCliSoftFailKind | null,
): boolean {
  return true;
}

export type SessionExportFormatRow = {
  format: SessionExportFormat;
  labelKey: string;
  nameKey: string;
  ext: string;
  disabled: boolean;
  /** i18n key explaining why the row is disabled (null when enabled). */
  disabledReasonKey: string | null;
  /** Resolved path honesty for this row. */
  path: SessionExportPathResolution;
  /** Badge i18n keys (`session.exportPath.*`). */
  badgeKeys: string[];
};

/**
 * Build honest format-picker / submenu rows for md/txt/json/html.
 * Empty journal → all transcript formats disabled with empty reason.
 * Missing target → disabled with no-target reason.
 * Path badges: Journal only, or CLI + Journal when CLI preferred.
 */
export function buildSessionExportFormatRows(input?: {
  hasTarget?: boolean;
  journalEmpty?: boolean | null;
  busy?: boolean;
  /** Linked agent session for CLI path honesty. */
  hasAgentSession?: boolean | string | null;
  cliHostAvailable?: boolean | null;
  cliExportAvailable?: boolean | null;
  /** Per-row mode (default download). */
  mode?: "download" | "copy";
  options?: SessionExportOptions | null;
}): SessionExportFormatRow[] {
  const hasTarget = input?.hasTarget !== false;
  const journalEmpty = input?.journalEmpty === true;
  const busy = input?.busy === true;

  return SESSION_EXPORT_FORMATS.map((format) => {
    let disabled = false;
    let disabledReasonKey: string | null = null;
    if (!hasTarget) {
      disabled = true;
      disabledReasonKey = "session.exportNoTarget";
    } else if (journalEmpty) {
      disabled = true;
      disabledReasonKey = "session.exportEmpty";
    } else if (busy) {
      disabled = true;
      disabledReasonKey = "session.exportMdWorking";
    }
    const path = resolveSessionExportPath({
      format,
      mode: input?.mode ?? "download",
      hasAgentSession: input?.hasAgentSession,
      cliHostAvailable: input?.cliHostAvailable,
      cliExportAvailable: input?.cliExportAvailable,
      options: input?.options,
    });
    return {
      format,
      labelKey: sessionExportFormatLabelKey(format),
      nameKey: sessionExportFormatNameKey(format),
      ext: sessionExportFormatExt(format),
      disabled,
      disabledReasonKey,
      path,
      badgeKeys: path.badgeKeys,
    };
  });
}

/**
 * Human-readable byte label for estimated export size (meta chip).
 * Returns null for empty / invalid so UI never shows “0 B” as success.
 */
export function formatSessionExportBytes(
  n: number | null | undefined,
): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${Math.floor(n)} B`;
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
