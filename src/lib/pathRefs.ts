/**
 * Detect file paths and URLs in assistant markdown for in-place cards.
 */

import type { Locale } from "../i18n";
import {
  isImagePath,
  isMediaPath,
  isVideoPath,
  pathBasename,
  pathExt,
} from "@/lib/attachments";

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
 */
export function normalizePathToken(s: string): string {
  let t = s.trim().replace(/\\/g, "/");
  if (!t) return t;
  // Leading "..." / "…" / ".../" (ASCII or fullwidth)
  t = t.replace(/^(?:\.\.\.|…)+\/*/u, "");
  // Mid-path ellipsis (rare): keep the longest trailing segment run
  if (t.includes("/.../") || t.includes("/…/")) {
    const parts = t.split(/\/(?:\.\.\.|…)+\//u);
    t = parts[parts.length - 1] || t;
  }
  return t.replace(/^\.\//, "").replace(/^\/+/, "");
}

export function looksLikeFilePath(s: string): boolean {
  const t = normalizePathToken(s);
  if (!t || t.length > 800) return false;
  if (isHttpUrl(t)) return false;
  if (t.includes("://")) return false;
  // Still-broken truncation (nothing usable left)
  if (t.startsWith("...") || t.startsWith("…")) return false;
  // Absolute
  if (t.startsWith("/") || /^[A-Za-z]:[\\/]/.test(t)) {
    return FILE_EXT_RE.test(t) || /\/[^/]+$/.test(t);
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
  // Bare filename with known extension
  if (/^[\w.-]+\.\w{1,12}$/.test(t) && FILE_EXT_RE.test(t)) {
    return true;
  }
  return false;
}

export function isAbsoluteFsPath(s: string): boolean {
  return s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s);
}

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
  if (opts?.pathMap?.[raw]) return opts.pathMap[raw]!;
  // Prefer normalized form (strip agent ellipsis) for map + relative open
  const t = normalizePathToken(raw);
  if (!t) return null;
  if (opts?.pathMap?.[t]) return opts.pathMap[t]!;
  const norm = t.replace(/\\/g, "/");
  if (opts?.pathMap?.[norm]) return opts.pathMap[norm]!;
  if (isAbsoluteFsPath(t) || isAbsoluteFsPath(raw)) {
    return isAbsoluteFsPath(raw) ? raw.replace(/\\/g, "/") : norm;
  }
  // Relative: keep as relative token (do not join project root)
  if (looksLikeFilePath(raw) && !isHttpUrl(raw)) {
    if (norm.includes("/") || norm.includes("\\")) return norm;
    // bare filename only — too ambiguous without pathMap
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

export function fileSubtitle(path: string, locale: Locale = "zh"): string {
  const ext = pathExt(path).toUpperCase();
  const pick = (en: string, zh: string, tw: string) =>
    locale === "en" ? en : locale === "zh-TW" ? tw : zh;
  if (!ext) return pick("File", "文件", "檔案");
  if (ext === "MD" || ext === "MDX") return pick("Doc · MD", "文档 · MD", "文件 · MD");
  if (ext === "HTML" || ext === "HTM") return "HTML";
  if (ext === "DOCX" || ext === "DOC")
    return pick("Doc · Word", "文档 · Word", "文件 · Word");
  if (ext === "XLSX" || ext === "XLS")
    return pick("Sheet · Excel", "表格 · Excel", "試算表 · Excel");
  if (ext === "PDF") return "PDF";
  if (ext === "PY") return pick("Code · Python", "代码 · Python", "程式碼 · Python");
  if (["TS", "TSX", "JS", "JSX"].includes(ext))
    return pick("Code · " + ext, "代码 · " + ext, "程式碼 · " + ext);
  return pick(`File · ${ext}`, `文件 · ${ext}`, `檔案 · ${ext}`);
}

export { pathBasename, isMediaPath };
