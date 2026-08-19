/**
 * Detect file paths and URLs in assistant markdown for in-place cards.
 */

import { createT, type Locale } from "../i18n";
import {
  isImagePath,
  isMediaPath,
  isVideoPath,
  pathBasename,
  pathExt,
} from "@/lib/attachments";
import {
  isFusedQueryKeyPath,
  isRealLocalAbsolutePath,
  isSiteRootAbsolutePath,
  isWindowsStylePath,
  normalizeLocalPathToken,
  unescapeShellPath,
} from "@/lib/pathNormalize";

const CODE_EXTS =
  "ts|tsx|js|jsx|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|bash|zsh|sql|vue|svelte|dart|lua|r|scala|zig|toml|yaml|yml|json|jsonc|css|scss|less|md|mdx|txt|log|html|htm|xml|csv|tsv|env|ini|conf|config|docx|docm|xlsx|xlsm|pptx|pptm|pdf|odt|ods|odp|zip|tar|gz|tgz|7z|rar|wasm|map|lock|gradle|cmake|dockerfile|makefile|svg";

const FILE_EXT_RE = new RegExp(
  `\\.(?:${CODE_EXTS}|png|jpe?g|gif|webp|bmp|heic|avif|mp4|webm|mov|mkv|m4v|avi|mp3|wav|ogg|m4a|flac)$`,
  "i",
);

export function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/**
 * Agent prose often truncates long paths with a leading ellipsis:
 *   `.../MANISH1027512/2071…/img_000.jpg`
 * Strip that prefix so the remaining multi-segment suffix can be resolved
 * via host smart open (project + sibling knowledge bases).
 *
 * Also restores shell escapes (`\ ` `\( `) on POSIX so Downloads paths with
 * spaces open correctly; does not treat those backslashes as Windows separators.
 */
export function normalizePathToken(s: string): string {
  let t = s.trim();
  if (!t) return t;
  // Shell-unescape / Windows normalize before other transforms.
  t = normalizeLocalPathToken(t) || t;
  // Absolute / home paths must keep their root — stripping leading `/` used to
  // turn `/Users/.../clip.mp4` into a relative token and break video cards on
  // history reload (FilePathCard instead of VideoUi).
  const abs =
    isRealLocalAbsolutePath(t) ||
    t.startsWith("/") ||
    /^[A-Za-z]:\//.test(t) ||
    t === "~" ||
    t.startsWith("~/");
  if (abs) {
    // Site-root CMS paths stay as-is for classification (not local open).
    if (isSiteRootAbsolutePath(t)) return t;
    // Still collapse mid-path ellipsis if agents truncated long abs paths.
    if (t.includes("/.../") || t.includes("/…/")) {
      const parts = t.split(/\/(?:\.\.\.|…)+\//u);
      const tail = parts[parts.length - 1] || t;
      // Prefer keeping a leading absolute root when possible.
      if (tail.startsWith("/") || /^[A-Za-z]:\//.test(tail) || tail.startsWith("~/")) {
        return tail;
      }
    }
    return t;
  }
  // Leading "..." / "…" / ".../" (ASCII or fullwidth)
  t = t.replace(/^(?:\.\.\.|…)+\/*/u, "");
  // Mid-path ellipsis (rare): keep the longest trailing segment run
  if (t.includes("/.../") || t.includes("/…/")) {
    const parts = t.split(/\/(?:\.\.\.|…)+\//u);
    t = parts[parts.length - 1] || t;
  }
  // Relative only: drop leading ./ and accidental extra slashes
  return t.replace(/^\.\//, "").replace(/^\/+/, "");
}

export function looksLikeFilePath(s: string): boolean {
  const t = normalizePathToken(s);
  if (!t || t.length > 800) return false;
  if (isHttpUrl(t)) return false;
  if (t.includes("://")) return false;
  // Fused media query keys (`t:/Users/…`) are never real files — plain code.
  if (isFusedQueryKeyPath(t)) return false;
  // Still-broken truncation (nothing usable left)
  if (t.startsWith("...") || t.startsWith("…")) return false;
  // CMS/site root (`/images/...`) — leave as plain code, not a path card.
  if (isSiteRootAbsolutePath(t)) return false;
  // Slash-command / skill tokens (`/dbs`, `/goal`) — single segment, no ext.
  // Must not become FilePathCard (click does nothing; confuses skill cites).
  if (/^\/[A-Za-z0-9_.:-]+$/.test(t) && !FILE_EXT_RE.test(t)) {
    return false;
  }
  // Absolute (real local or home)
  if (isRealLocalAbsolutePath(t) || isHomeRelativePath(t)) {
    // Prefer extension, or multi-segment paths (`/Users/me/foo`).
    // Single-segment abs with ext (`/a.png`) stays a path only when real local
    // (agent-home short roots); slash commands without ext already rejected.
    if (FILE_EXT_RE.test(t)) return true;
    const segs = t.replace(/^~\/?/, "").split("/").filter(Boolean);
    return segs.length >= 2;
  }
  // Other absolute-looking tokens without a known FS root: not a file card.
  if (t.startsWith("/") && !isWindowsStylePath(t)) {
    return false;
  }
  // Relative with slash + extension (project / KB paths)
  // Prefer ≥2 segments after normalize so bare `img_000.jpg` stays out
  // of path-card conversion unless it has a directory prefix.
  if (
    (t.includes("/") || t.includes("\\")) &&
    FILE_EXT_RE.test(t) &&
    !t.startsWith("http")
  ) {
    return true;
  }
  // Bare filename with known extension — but not bare media basenames.
  // Agent often cites OSS / CMS names (`manycore.png`) without a real local
  // file; those stay as inline code unless pathMap resolves them to ImageUi.
  if (/^[\w.-]+\.\w{1,12}$/.test(t) && FILE_EXT_RE.test(t)) {
    if (isMediaPath(t)) return false;
    return true;
  }
  return false;
}

/**
 * Home-relative path (`~/docs/a.md`). Not a POSIX absolute path, but the host
 * expands it in `fs_open_path` — treat like an absolute open token.
 */
export function isHomeRelativePath(s: string): boolean {
  const t = unescapeShellPath(s).trim();
  return t === "~" || t.startsWith("~/") || t.startsWith("~\\");
}

/**
 * Looks like an absolute path token (includes site-root `/images/...`).
 * Prefer {@link isRealLocalAbsolutePath} for media open / path_scope.
 */
export function isAbsoluteFsPath(s: string): boolean {
  const t = normalizeLocalPathToken(s) || s.trim();
  if (isFusedQueryKeyPath(t)) return false;
  return (
    t.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(t) ||
    isHomeRelativePath(t)
  );
}

/** Re-export real-local check for markdown / media cards. */
export { isRealLocalAbsolutePath, isSiteRootAbsolutePath, normalizeLocalPathToken };

/** Join project root + relative path (posix-ish). */
export function joinProjectPath(projectRoot: string, relative: string): string {
  const root = projectRoot.replace(/[/\\]+$/, "");
  const rel = relative.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(root) || root.includes("\\")) {
    return `${root}\\${rel.replace(/\//g, "\\")}`;
  }
  return `${root}/${rel}`;
}

/**
 * When the session has only one parent directory among known file paths,
 * bare basenames like `05-configuration.md` can open as siblings.
 */
function uniqueParentDirFromPathMap(
  pathMap: Record<string, string>,
): string | null {
  const parents = new Set<string>();
  for (const abs of Object.values(pathMap)) {
    const n = normalizeLocalPathToken(abs || "") || (abs || "").trim();
    if (!n || isHttpUrl(n) || !isRealLocalAbsolutePath(n)) continue;
    const i = n.lastIndexOf("/");
    if (i <= 0) continue;
    parents.add(n.slice(0, i));
    if (parents.size > 1) return null;
  }
  if (parents.size !== 1) return null;
  return [...parents][0] ?? null;
}

/**
 * Resolve a path token when we already know a verified absolute path
 * (pathMap / absolute in text). Does **not** invent paths by joining
 * projectRoot + relative — monorepo agents often write paths relative to a
 * subfolder (e.g. projects/x-ops), so naive join is often a non-existent file.
 * Relative paths stay relative; host `fs_open_path` does smart resolution.
 */
export function resolveFileToken(
  token: string,
  opts?: {
    projectPath?: string | null;
    /** token → absolute (media attachments map, etc.) */
    pathMap?: Record<string, string> | null;
  },
): string | null {
  const raw = token.trim().replace(/^<|>$/g, "");
  if (!raw) return null;
  // Site CMS roots are not local files — never invent open targets.
  if (isSiteRootAbsolutePath(raw)) return null;
  // Fused media query keys (`t:/Users/…`) are not paths at all.
  if (isFusedQueryKeyPath(raw)) return null;
  if (opts?.pathMap?.[raw]) return opts.pathMap[raw]!;
  // Prefer normalized form (shell-unescape + strip agent ellipsis).
  // Do not strip leading `/` or `~/` — those are openable absolute/home paths.
  const t = normalizePathToken(raw);
  if (!t) return null;
  if (isSiteRootAbsolutePath(t)) return null;
  if (opts?.pathMap?.[t]) return opts.pathMap[t]!;
  const norm = normalizeLocalPathToken(t) || t;
  if (opts?.pathMap?.[norm]) return opts.pathMap[norm]!;
  // Real local absolute / home only (not /images/...).
  if (isRealLocalAbsolutePath(norm) || isHomeRelativePath(norm)) {
    return norm;
  }
  if (isRealLocalAbsolutePath(raw) || isHomeRelativePath(raw)) {
    return normalizeLocalPathToken(raw) || raw;
  }
  // Relative: keep as relative token (do not join project root)
  if (looksLikeFilePath(raw) && !isHttpUrl(raw)) {
    if (norm.includes("/") || norm.includes("\\")) return norm;
    // bare filename — pathMap hit, or unique session parent dir (sibling table)
    if (opts?.pathMap) {
      const bare = pathBasename(norm);
      if (opts.pathMap[bare]) return opts.pathMap[bare]!;
      // Never invent sibling paths for media. A lone agent `images/1.jpg`
      // attachment must not imply `images/foo.png` exists — that produced
      // broken ImageUi cards for workspace basenames after session reload.
      if (isMediaPath(norm)) return null;
      const parent = uniqueParentDirFromPathMap(opts.pathMap);
      if (parent) return `${parent}/${bare}`;
    }
    return null;
  }
  return null;
}

export type PathRefKind = "image" | "video" | "file" | "url";

export function classifyPathRef(pathOrUrl: string): PathRefKind {
  if (isHttpUrl(pathOrUrl)) return "url";
  if (isImagePath(pathOrUrl)) return "image";
  if (isVideoPath(pathOrUrl)) return "video";
  return "file";
}

export function fileSubtitle(path: string, locale: Locale = "en"): string {
  const ext = pathExt(path).toUpperCase();
  const tr = createT(locale);
  if (!ext) return tr("fileCard.file");
  if (ext === "MD" || ext === "MDX") return tr("fileCard.docMd");
  // Format names that are already the same word in every locale stay bare.
  if (ext === "HTML" || ext === "HTM") return "HTML";
  if (ext === "DOCX" || ext === "DOC") return tr("fileCard.docWord");
  if (ext === "XLSX" || ext === "XLS") return tr("fileCard.sheetExcel");
  if (ext === "PDF") return "PDF";
  if (ext === "PY") return tr("fileCard.codePython");
  if (["TS", "TSX", "JS", "JSX"].includes(ext)) return tr("fileCard.code", { ext });
  return tr("fileCard.fileExt", { ext });
}

export { pathBasename, isMediaPath };
