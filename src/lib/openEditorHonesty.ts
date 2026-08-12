/**
 * OPEN-EDITOR-HONESTY — pure helpers for open-in-editor / reveal soft-fail.
 *
 * Classifies Host `open_in_editor` / `path_reveal` / `path_open` failures into
 * stable kinds for toasts and banners. Never invents “opened” / “revealed”
 * without a successful Host call. No DOM / Tauri side effects.
 *
 * Host message shapes (today):
 * - `path not found: …` / `empty path`
 * - `{editorId} not found`
 * - `failed to open editor \`…\`: …`
 * - permission / allowlist phrases (`path not allowed`, EACCES, …)
 */

/** Stable failure modes for open-in-editor. */
export type OpenEditorErrorKind =
  | "no_editor"
  | "not_found"
  | "path_denied"
  | "host_only"
  | "cancelled"
  | "other";

/** Stable failure modes for path reveal / open-with-system. */
export type RevealErrorKind =
  | "not_found"
  | "path_denied"
  | "host_only"
  | "cancelled"
  | "other";

/** Empty / honesty states for Settings preferred-editor surface. */
export type OpenEditorEmptyKind =
  | "no_editors"
  | "preferred_missing"
  | "ok";

export type OpenEditorEmptyState = {
  kind: OpenEditorEmptyKind;
  /** Primary i18n message key (null when ok). */
  messageKey: string | null;
  /** Soft-warn (empty scan or preferred missing) vs quiet ok. */
  severity: "none" | "info" | "warn";
};

/** Soft preflight before calling Host open_in_editor. */
export type OpenInEditorPlan =
  | { ok: true; path: string; editorId: string | null }
  | {
      ok: false;
      kind: OpenEditorErrorKind;
      messageKey: string;
    };

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
    const o = err as {
      code?: unknown;
      message?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    const parts = [o.code, o.message, o.reason, o.error]
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
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  return "";
}

function isCancelledText(s: string): boolean {
  return (
    /\bcancel(led|ed)?\b/.test(s) ||
    s.includes("user cancelled") ||
    s.includes("user canceled") ||
    s.includes("dismissed")
  );
}

function isHostOnlyText(s: string): boolean {
  return (
    s.includes("need tauri") ||
    s.includes("need_tauri") ||
    s.includes("requires the tauri") ||
    s.includes("requires the desktop") ||
    s.includes("host only") ||
    s.includes("host_only") ||
    s.includes("not in tauri") ||
    s.includes("not available in browser") ||
    s.includes("desktop only") ||
    s.includes("desktop app")
  );
}

function isPathDeniedText(s: string): boolean {
  return (
    s.includes("path not allowed") ||
    s.includes("path_not_allowed") ||
    s.includes("path denied") ||
    s.includes("path_denied") ||
    s.includes("outside allowlist") ||
    s.includes("outside path scope") ||
    s.includes("outside known") ||
    s.includes("eacces") ||
    s.includes("eperm") ||
    (s.includes("permission") &&
      (s.includes("denied") || s.includes("refuse"))) ||
    s.includes("access is denied") ||
    s.includes("operation not permitted") ||
    s.includes("unauthorized") ||
    s.includes("forbidden")
  );
}

function isPathNotFoundText(s: string): boolean {
  return (
    s.includes("path not found") ||
    s.includes("path_not_found") ||
    s.includes("empty path") ||
    s.includes("path is empty") ||
    s.includes("file not found") ||
    s.includes("no such file") ||
    s.includes("does not exist") ||
    s.includes("enoent") ||
    s.trim() === "not found" ||
    s.trim() === "error: not found"
  );
}

function isNoEditorText(s: string): boolean {
  // Host: `{id} not found` when launching a named editor / git GUI.
  // Prefer this only when it is not clearly a filesystem path miss.
  if (isPathNotFoundText(s) && s.includes("path")) return false;
  return (
    s.includes("no editor") ||
    s.includes("no_editor") ||
    s.includes("no code editor") ||
    s.includes("editor not found") ||
    s.includes("editors not found") ||
    s.includes("no editors") ||
    s.includes("editor unavailable") ||
    s.includes("failed to open editor") ||
    // bare "`code` not found" / "cursor not found" without "path not found"
    (/\bnot found\b/.test(s) &&
      !s.includes("path not found") &&
      !s.includes("file not found") &&
      !s.includes("no such file") &&
      !s.includes("session not found") &&
      !s.includes("project not found"))
  );
}

/**
 * Classify a thrown value / host error for open-in-editor.
 * Prefer explicit `code` over free-form text. Never invents success.
 */
export function classifyOpenEditorError(err: unknown): OpenEditorErrorKind {
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (
    code === "cancelled" ||
    code === "cancel" ||
    code === "user_cancelled" ||
    code === "user-cancelled"
  ) {
    return "cancelled";
  }
  if (
    code === "host_only" ||
    code === "host-only" ||
    code === "need_tauri" ||
    code === "need-tauri"
  ) {
    return "host_only";
  }
  if (
    code === "path_denied" ||
    code === "path-denied" ||
    code === "path_not_allowed" ||
    code === "path-not-allowed" ||
    code === "eacces" ||
    code === "eperm" ||
    code === "forbidden"
  ) {
    return "path_denied";
  }
  if (
    code === "no_editor" ||
    code === "no-editor" ||
    code === "editor_not_found" ||
    code === "editor-not-found"
  ) {
    return "no_editor";
  }
  if (
    code === "not_found" ||
    code === "not-found" ||
    code === "path_not_found" ||
    code === "path-not-found" ||
    code === "enoent" ||
    code === "empty_path" ||
    code === "empty-path"
  ) {
    return "not_found";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  if (isCancelledText(s)) return "cancelled";
  if (isHostOnlyText(s)) return "host_only";
  if (isPathDeniedText(s)) return "path_denied";
  // Path miss before generic “not found” editor miss.
  if (isPathNotFoundText(s)) return "not_found";
  if (isNoEditorText(s)) return "no_editor";

  return "other";
}

/**
 * Classify a thrown value / host error for path reveal / system open.
 * Same honesty surface as open-in-editor minus `no_editor`.
 */
export function classifyRevealError(err: unknown): RevealErrorKind {
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (
    code === "cancelled" ||
    code === "cancel" ||
    code === "user_cancelled" ||
    code === "user-cancelled"
  ) {
    return "cancelled";
  }
  if (
    code === "host_only" ||
    code === "host-only" ||
    code === "need_tauri" ||
    code === "need-tauri"
  ) {
    return "host_only";
  }
  if (
    code === "path_denied" ||
    code === "path-denied" ||
    code === "path_not_allowed" ||
    code === "path-not-allowed" ||
    code === "eacces" ||
    code === "eperm" ||
    code === "forbidden"
  ) {
    return "path_denied";
  }
  if (
    code === "not_found" ||
    code === "not-found" ||
    code === "path_not_found" ||
    code === "path-not-found" ||
    code === "enoent" ||
    code === "empty_path" ||
    code === "empty-path"
  ) {
    return "not_found";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  if (isCancelledText(s)) return "cancelled";
  if (isHostOnlyText(s)) return "host_only";
  if (isPathDeniedText(s)) return "path_denied";
  if (isPathNotFoundText(s) || s.includes("not found")) return "not_found";

  return "other";
}

/** i18n message key for a classified open-in-editor error. */
export function openEditorErrorMessageKey(kind: OpenEditorErrorKind): string {
  switch (kind) {
    case "no_editor":
      return "resources.openErr.noEditor";
    case "not_found":
      return "resources.openErr.notFound";
    case "path_denied":
      return "resources.openErr.pathDenied";
    case "host_only":
      return "resources.openErr.hostOnly";
    case "cancelled":
      return "resources.openErr.cancelled";
    case "other":
    default:
      return "resources.openErr.other";
  }
}

/** i18n message key for a classified reveal error. */
export function revealErrorMessageKey(kind: RevealErrorKind): string {
  switch (kind) {
    case "not_found":
      return "resources.revealErr.notFound";
    case "path_denied":
      return "resources.revealErr.pathDenied";
    case "host_only":
      return "resources.revealErr.hostOnly";
    case "cancelled":
      return "resources.revealErr.cancelled";
    case "other":
    default:
      return "resources.revealErr.other";
  }
}

/**
 * Resolve user-facing open-in-editor soft-fail copy from a thrown value.
 * `detail` is a short technical suffix for `other` only.
 */
export function resolveOpenEditorError(err: unknown): {
  kind: OpenEditorErrorKind;
  messageKey: string;
  detail: string;
  /** True when UI should stay silent (user dismissed). */
  silent: boolean;
} {
  const kind = classifyOpenEditorError(err);
  const messageKey = openEditorErrorMessageKey(kind);
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
  return {
    kind,
    messageKey,
    detail,
    silent: kind === "cancelled",
  };
}

/**
 * Resolve user-facing reveal soft-fail copy from a thrown value.
 */
export function resolveRevealError(err: unknown): {
  kind: RevealErrorKind;
  messageKey: string;
  detail: string;
  silent: boolean;
} {
  const kind = classifyRevealError(err);
  const messageKey = revealErrorMessageKey(kind);
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
  return {
    kind,
    messageKey,
    detail,
    silent: kind === "cancelled",
  };
}

/**
 * Format resolved open/reveal error with optional technical detail suffix.
 * `tr` is typically `createT(locale)`.
 */
export function formatOpenEditorErrorMessage(
  resolved: { messageKey: string; detail: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tr: (key: any, vars?: Record<string, string>) => string,
): string {
  const base = tr(resolved.messageKey);
  if (resolved.detail && resolved.detail !== base) {
    if (!base.toLowerCase().includes(resolved.detail.toLowerCase())) {
      return `${base} (${resolved.detail})`;
    }
  }
  return base;
}

/** Alias — same formatting rules for reveal soft-fail. */
export const formatRevealErrorMessage = formatOpenEditorErrorMessage;

/**
 * Settings / open-target empty honesty from a detected-editor scan.
 *
 * - `editorsFound === 0` → warn no_editors (Finder/Explorer still works)
 * - preferred set but not among available ids → info preferred_missing
 * - otherwise ok (null message)
 *
 * Never invents installed editors.
 */
export function resolveOpenEditorEmptyState(input: {
  /** Count of available (detected) code editors. */
  editorsFound: number;
  /**
   * Preferred open target id (`finder` / `explorer` / `system` / editor id).
   * OS file-manager targets never count as “preferred missing”.
   */
  preferred?: string | null;
  /** Available editor ids from Host scan (optional — used when preferred set). */
  availableIds?: readonly string[] | null;
}): OpenEditorEmptyState {
  const n = Math.max(0, Math.floor(Number(input.editorsFound) || 0));
  const preferred = normalizeOpenTargetId(input.preferred);
  // Empty preferred normalizes to finder → OS target (never preferred_missing).
  const isOsTarget = isOsOpenTarget(input.preferred) || !String(input.preferred ?? "").trim();

  if (n === 0) {
    return {
      kind: "no_editors",
      messageKey: "settings.openTargetEmpty",
      severity: "warn",
    };
  }

  if (!isOsTarget && input.availableIds) {
    const ids = input.availableIds.map((x) => normalizeOpenTargetId(x));
    if (preferred && !ids.includes(preferred)) {
      return {
        kind: "preferred_missing",
        messageKey: "settings.openTargetPreferredMissing",
        severity: "info",
      };
    }
  }

  return {
    kind: "ok",
    messageKey: null,
    severity: "none",
  };
}

function normalizeOpenPath(path: string | null | undefined): string {
  return String(path ?? "").trim();
}

/** localStorage key shared by Settings + Open Location + Resource/Review. */
export const OPEN_TARGET_STORAGE_KEY = "grok-app.openTarget";

/** Normalize open-target id (`Finder` → `finder`). Empty → `finder`. */
export function normalizeOpenTargetId(
  id: string | null | undefined,
): string {
  const v = String(id ?? "")
    .trim()
    .toLowerCase();
  return v || "finder";
}

/**
 * True for OS file-manager / system-default targets (not a code editor id).
 * Includes legacy empty / `default`.
 */
export function isOsOpenTarget(id: string | null | undefined): boolean {
  const v = normalizeOpenTargetId(id);
  return (
    v === "finder" ||
    v === "explorer" ||
    v === "system" ||
    v === "default"
  );
}

/**
 * Read last-used / preferred open target from localStorage.
 * Soft-fails to `fallback` on missing storage or errors.
 */
export function readOpenTargetStorage(fallback = "finder"): string {
  try {
    if (typeof localStorage === "undefined") return normalizeOpenTargetId(fallback);
    return normalizeOpenTargetId(
      localStorage.getItem(OPEN_TARGET_STORAGE_KEY) || fallback,
    );
  } catch {
    return normalizeOpenTargetId(fallback);
  }
}

/**
 * Write open target to localStorage (session/global UI consistency).
 * Never throws.
 */
export function writeOpenTargetStorage(target: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      OPEN_TARGET_STORAGE_KEY,
      normalizeOpenTargetId(target),
    );
  } catch {
    /* ignore */
  }
}

export type OpenTargetSelectOption = {
  value: string;
  label: string;
  /** Soft-disabled when preferred editor is missing from probe. */
  disabled?: boolean;
};

/**
 * Settings Select options for default open target.
 *
 * - Finder/Explorer always first and enabled
 * - Available (probed) editors enabled
 * - Preferred editor missing from probe → soft-disabled trailing entry
 * - Never invents installed editors
 */
export function buildOpenTargetSelectOptions(input: {
  finderLabel: string;
  editors: readonly {
    id: string;
    label: string;
    available?: boolean;
  }[];
  preferred?: string | null;
  /**
   * Suffix for soft-disabled preferred label, e.g. `" (not detected)"`.
   * Appended only when preferred is missing and not already in available.
   */
  unavailableSuffix?: string;
}): OpenTargetSelectOption[] {
  const available = (input.editors ?? []).filter(
    (e) => e.available !== false && String(e.id ?? "").trim(),
  );
  const options: OpenTargetSelectOption[] = [
    { value: "finder", label: input.finderLabel },
  ];
  const seen = new Set<string>(["finder"]);
  for (const e of available) {
    const id = normalizeOpenTargetId(e.id);
    if (seen.has(id) || isOsOpenTarget(id)) continue;
    seen.add(id);
    options.push({
      value: id,
      label: String(e.label ?? e.id).trim() || id,
    });
  }

  const preferred = normalizeOpenTargetId(input.preferred);
  if (!isOsOpenTarget(preferred) && !seen.has(preferred)) {
    const base =
      (input.editors ?? []).find(
        (e) => normalizeOpenTargetId(e.id) === preferred,
      )?.label ?? preferred;
    // Keep leading space in suffix (e.g. " (not detected)"); only skip empty.
    const suffix = String(input.unavailableSuffix ?? "");
    options.push({
      value: preferred,
      label: suffix.trim() ? `${base}${suffix}` : String(base),
      disabled: true,
    });
  }
  return options;
}

/**
 * Resolve what primary click / Host should use when preferred may be missing.
 *
 * - OS targets stay as-is (finder/explorer/system)
 * - Available editor id kept
 * - Missing preferred → `osTarget` (default `finder`) — never invents an editor
 * - Legacy `editor` → cursor → code → first available → osTarget
 */
export function resolveEffectiveOpenTarget(input: {
  preferred?: string | null;
  /** Available editor ids from Host scan (lowercase ok). */
  availableIds?: readonly string[] | null;
  /** Fallback OS target when preferred editor missing. Default `finder`. */
  osTarget?: string | null;
}): string {
  const os = normalizeOpenTargetId(input.osTarget ?? "finder");
  const osFallback =
    os === "explorer" || os === "finder" || os === "system" || os === "default"
      ? os === "default"
        ? "system"
        : os
      : "finder";

  let preferred = normalizeOpenTargetId(input.preferred);
  if (preferred === "default") preferred = "system";

  if (isOsOpenTarget(preferred)) {
    return preferred === "system" ? "system" : preferred === "explorer" ? "explorer" : preferred === "finder" ? "finder" : osFallback;
  }

  const ids = (input.availableIds ?? []).map((x) =>
    normalizeOpenTargetId(x),
  );
  const idSet = new Set(ids);

  // Legacy Desktop value: pick best available code editor.
  if (preferred === "editor") {
    return resolveLegacyEditorTarget(ids) ?? osFallback;
  }

  if (idSet.size === 0) {
    // Unknown scan → keep preferred (Host may still resolve); known empty handled by caller.
    if (input.availableIds == null) return preferred;
    return osFallback;
  }
  if (idSet.has(preferred)) return preferred;
  return osFallback;
}

/**
 * Legacy `editor` open target: Cursor → VS Code → first available.
 * Returns null when none available (caller falls back to OS target).
 */
export function resolveLegacyEditorTarget(
  availableIds: readonly string[],
): string | null {
  const ids = availableIds.map((x) => normalizeOpenTargetId(x));
  if (ids.includes("cursor")) return "cursor";
  if (ids.includes("code")) return "code";
  const first = ids.find((id) => id && !isOsOpenTarget(id));
  return first ?? null;
}

/**
 * Order detected editors for open-with menus: preferred first, then probe order.
 * Does not drop entries; does not invent editors.
 */
export function orderOpenWithEditors<T extends { id: string }>(
  editors: readonly T[],
  preferred?: string | null,
): T[] {
  if (!editors.length) return [];
  const pref = normalizeOpenTargetId(preferred);
  if (isOsOpenTarget(pref) || pref === "editor") return [...editors];
  const idx = editors.findIndex(
    (e) => normalizeOpenTargetId(e.id) === pref,
  );
  if (idx <= 0) return [...editors];
  const copy = [...editors];
  const [hit] = copy.splice(idx, 1);
  return [hit, ...copy];
}

/**
 * Soft preflight before Host `open_in_editor`.
 * Order: host_only → not_found (empty path) → no_editor → ok.
 * Does **not** probe the filesystem (Host still does).
 */
export function planOpenInEditor(input: {
  path: string | null | undefined;
  /** Explicit editor id; empty/null → Host default. */
  editorId?: string | null;
  /** `api.isTauri()` — false → host_only. Default true (optimistic). */
  isTauri?: boolean | null;
  /**
   * When known `0` and a non-OS preferred/editor is requested, soft-fail
   * no_editor without calling Host. `null`/`undefined` = unknown → allow.
   */
  editorsFound?: number | null;
  /**
   * When set, a non-OS `editorId` not in this list soft-fails `no_editor`.
   * `null`/`undefined` = unknown → allow (Host still checks).
   */
  availableIds?: readonly string[] | null;
}): OpenInEditorPlan {
  if (input.isTauri === false) {
    return {
      ok: false,
      kind: "host_only",
      messageKey: openEditorErrorMessageKey("host_only"),
    };
  }
  const path = normalizeOpenPath(input.path);
  if (!path) {
    return {
      ok: false,
      kind: "not_found",
      messageKey: openEditorErrorMessageKey("not_found"),
    };
  }
  const editorId = (input.editorId ?? "").trim() || null;
  const wantsEditor = !!editorId && !isOsOpenTarget(editorId);
  if (
    wantsEditor &&
    input.editorsFound != null &&
    Number(input.editorsFound) <= 0
  ) {
    return {
      ok: false,
      kind: "no_editor",
      messageKey: openEditorErrorMessageKey("no_editor"),
    };
  }
  if (wantsEditor && editorId && input.availableIds != null) {
    const ids = input.availableIds.map((x) => normalizeOpenTargetId(x));
    const want = normalizeOpenTargetId(editorId);
    if (want === "editor") {
      if (!resolveLegacyEditorTarget(ids)) {
        return {
          ok: false,
          kind: "no_editor",
          messageKey: openEditorErrorMessageKey("no_editor"),
        };
      }
    } else if (!ids.includes(want)) {
      return {
        ok: false,
        kind: "no_editor",
        messageKey: openEditorErrorMessageKey("no_editor"),
      };
    }
  }
  return {
    ok: true,
    path,
    editorId: editorId ? normalizeOpenTargetId(editorId) : null,
  };
}

/** All open-in-editor error kinds (for label maps / tests). */
export const OPEN_EDITOR_ERROR_KINDS: readonly OpenEditorErrorKind[] = [
  "no_editor",
  "not_found",
  "path_denied",
  "host_only",
  "cancelled",
  "other",
] as const;

/** All reveal error kinds. */
export const REVEAL_ERROR_KINDS: readonly RevealErrorKind[] = [
  "not_found",
  "path_denied",
  "host_only",
  "cancelled",
  "other",
] as const;
