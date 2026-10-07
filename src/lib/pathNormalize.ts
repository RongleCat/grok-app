/**
 * Path normalization for chat cards / media delivery.
 *
 * Goals:
 * - Restore shell-escaped local paths (`\ ` `\( ` `\)`) before open/preview
 * - Distinguish real filesystem absolutes from site-root paths (`/images/...`)
 * - Prefer short display tokens; keep absolute only for resolve/open
 *
 * Pure helpers — no Tauri / DOM.
 */

/**
 * Site / CMS root paths that look absolute but are not local FS
 * (e.g. `/images/partner-brands/x.png` in homepage HTML).
 *
 * Only the **first** path segment is checked. Agent session roots like
 * `/sess/images/1.jpg` or `/var/folders/…` stay local.
 */
const SITE_ROOT_FIRST_SEG =
  /^(?:images?|static|assets?|public|uploads?|css|js|fonts?|icons?|img|cdn|dist|build|frontend|backend|api|web|www|resources?|files?|content|cms)(?:\/|$)/i;

/** Windows drive or UNC — backslash is a separator, not shell escape. */
export function isWindowsStylePath(s: string): boolean {
  const t = s.trim();
  return (
    (/^[A-Za-z]:[\\/]/.test(t) || t.startsWith("\\\\")) &&
    !isFusedQueryKeyPath(t)
  );
}

/**
 * Known POSIX roots that must never be the *remainder* of a single-letter
 * forward-slash “drive” token. A fused media query key (`t:/Users/…`) hits
 * these; a real Windows media path does not (profiles live under `C:\Users\`
 * with a backslash, and the canonical `C:/Users/…` is allowed below).
 */
const POSIX_ROOT_AFTER_DRIVE =
  /^(?:Users|home|tmp|var|private|opt|Volumes|Library|Applications|usr|etc|sess|data|workspace|work|root)(?:\/|$)/i;

/**
 * True when a forward-slash “drive” token is actually a media query key
 * fused onto a Unix absolute path, e.g. `t:/Users/me/a.png` produced from
 * `?t=TOKEN&p=/Users/me/a.png` (query key `t` + `:` + path). Such tokens must
 * never be treated as local filesystem paths — they fail path_scope and only
 * surface as “preview failed” cards after a remount.
 *
 * Real Windows media keeps working:
 * - backslash paths (`C:\Users\…`) never match (forward-slash only);
 * - any real drive letter (`C`–`Z`, including `F:/…`) is never treated as fused;
 * - only known media query keys `t` / `p` + a POSIX-root remainder count.
 */
export function isFusedQueryKeyPath(s: string): boolean {
  const t = (s ?? "").trim();
  if (!/^[A-Za-z]:\//.test(t)) return false;
  const drive = t[0]!.toLowerCase();
  // Media HTTP query keys only — never invent fused hits for real volumes
  // (`F:/media/…`, `G:/Users/…` on multi-disk Windows).
  if (drive !== "t" && drive !== "p") return false;
  const rest = t.slice(2).replace(/^\/+/, "");
  return POSIX_ROOT_AFTER_DRIVE.test(rest);
}

/**
 * Undo shell escapes commonly pasted from terminals:
 * `file\ \(1\).png` → `file (1).png`
 * Does **not** rewrite Windows path separators (`C:\Users\...`).
 */
export function unescapeShellPath(input: string): string {
  const raw = (input ?? "").trim();
  if (!raw) return "";
  if (isWindowsStylePath(raw)) {
    // Normalize separators only.
    return raw.replace(/\\/g, "/");
  }
  // POSIX / unix-style: `\X` → `X` (space, parens, $, `, etc.)
  if (!raw.includes("\\")) return raw;
  return raw.replace(/\\(.)/g, "$1");
}

/**
 * True local absolute / home path we may send to media HTTP or path_scope.
 * Rejects site-root tokens like `/images/foo.png`.
 *
 * Any other absolute (`/Users/…`, `/sess/…`, `/data/proj/…`, Windows drives)
 * is treated as local so agent-home / custom roots keep working.
 */
export function isRealLocalAbsolutePath(s: string): boolean {
  const t = unescapeShellPath(s).replace(/\\/g, "/");
  if (!t) return false;
  if (t.includes("://")) return false;
  // `t:/Users/…` / `p:/Users/…` are fused media query keys, not local drives.
  if (isFusedQueryKeyPath(t)) return false;
  if (t.startsWith("//") && !t.startsWith("///")) {
    // Protocol-relative URL, not FS.
    return false;
  }
  if (isWindowsStylePath(t) || /^[A-Za-z]:\//.test(t)) return true;
  if (t === "~" || t.startsWith("~/")) return true;
  if (!t.startsWith("/")) return false;
  // Site CMS roots only — everything else absolute is a local candidate.
  if (isSiteRootAbsolutePath(t)) return false;
  // Need at least `/segment` (not bare `/`).
  return t.length > 1;
}

/**
 * Absolute-looking path that is really a web/CMS root (not local disk).
 * UI should keep these as plain code or URL cards — never ImageUi/media HTTP.
 *
 * Does **not** call {@link isRealLocalAbsolutePath} (avoids recursion).
 * Known local roots (`/Users`, `/home`, `/tmp`, …) are never site roots even
 * when a later segment is `images/`.
 */
export function isSiteRootAbsolutePath(s: string): boolean {
  const t = unescapeShellPath(s).replace(/\\/g, "/").trim();
  if (!t.startsWith("/") || t.startsWith("//")) return false;
  if (t.includes("://")) return false;
  // Windows / home never site-root.
  if (isWindowsStylePath(t) || /^[A-Za-z]:\//.test(t)) return false;
  if (t === "~" || t.startsWith("~/")) return false;
  // Drop leading slash → first segment
  const rest = t.replace(/^\/+/, "");
  if (!rest) return false;
  const first = rest.split("/")[0] ?? "";
  // Real FS roots — even if they contain /images/ later.
  if (
    /^(?:Users|home|tmp|var|private|opt|Volumes|Applications|System|Library|mnt|run|root|usr|etc|sess|data|workspace|work|projects?|Users)$/i.test(
      first,
    )
  ) {
    return false;
  }
  return SITE_ROOT_FIRST_SEG.test(rest);
}

/**
 * Normalize a path token for lookup / open:
 * 1) shell-unescape (POSIX)
 * 2) Windows `\` → `/`
 * 3) collapse accidental `//` inside real local abs only
 */
export function normalizeLocalPathToken(input: string): string {
  let t = (input ?? "").trim().replace(/^<|>$/g, "");
  if (!t) return "";
  if (isWindowsStylePath(t)) {
    t = t.replace(/\\/g, "/");
  } else if (t.includes("\\")) {
    t = unescapeShellPath(t);
  }
  t = t.replace(/\\/g, "/");
  if (isRealLocalAbsolutePath(t) && t.startsWith("/") && !t.startsWith("//")) {
    t = t.replace(/\/{2,}/g, "/");
  }
  return t;
}

/**
 * Lookup key for one local file.
 * `C:\Users\a\paste.png` and `C:/Users/a/paste.png` are the same file.
 * Empty input stays empty.
 */
export function localPathIdentity(path: string): string {
  const t = (path ?? "").trim();
  if (!t) return "";
  return normalizeLocalPathToken(t) || t;
}

/**
 * Whether this token may be rendered as a local image/video card.
 * Requires a real local absolute (or pathMap hit that is real local).
 */
export function isLocalMediaOpenable(
  token: string,
  pathMap?: Record<string, string> | null,
): boolean {
  const raw = (token ?? "").trim();
  if (!raw) return false;
  if (isSiteRootAbsolutePath(raw)) return false;
  if (pathMap?.[raw] && isRealLocalAbsolutePath(pathMap[raw]!)) return true;
  const norm = normalizeLocalPathToken(raw);
  if (!norm) return false;
  if (pathMap?.[norm] && isRealLocalAbsolutePath(pathMap[norm]!)) return true;
  return isRealLocalAbsolutePath(norm);
}

/**
 * Prefer a short display label: basename for real abs / long paths;
 * keep relative multi-segment as-is for code citations.
 */
export function displayPathLabel(path: string): string {
  const t = normalizeLocalPathToken(path) || path.trim();
  if (!t) return path;
  if (isRealLocalAbsolutePath(t) || t.length > 64) {
    const parts = t.split("/").filter(Boolean);
    return parts[parts.length - 1] || t;
  }
  return t;
}
