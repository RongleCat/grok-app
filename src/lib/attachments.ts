/**
 * Composer attachments from drag-drop (or future pickers).
 * Sent to the agent as Grok Build `@path` references.
 *
 * Also: session-relative media path helpers for in-chat image/video cards
 * (`images/1.jpg`, `videos/1.mp4`, markdown links, absolute paths).
 */

import {
  isFusedQueryKeyPath,
  isRealLocalAbsolutePath,
  isSiteRootAbsolutePath,
  isWindowsStylePath,
  normalizeLocalPathToken,
  unescapeShellPath,
} from "@/lib/pathNormalize";

export interface Attachment {
  path: string;
  name: string;
  isDir: boolean;
}

/** Merge new items by absolute path (dedupe). */
export function mergeAttachments(
  prev: Attachment[],
  next: Attachment[],
): Attachment[] {
  const map = new Map(prev.map((a) => [a.path, a]));
  for (const a of next) {
    if (!a.path) continue;
    map.set(a.path, a);
  }
  return Array.from(map.values());
}

/**
 * Build the text sent to the agent: user message + `@/abs/path` lines.
 * Empty user text is fine when only files are attached.
 */
export function buildAgentPrompt(
  userText: string,
  attachments: Attachment[],
): string {
  const body = userText.trim();
  if (!attachments.length) return body;
  const refs = attachments.map((a) => `@${a.path}`).join("\n");
  return body ? `${body}\n\n${refs}` : refs;
}

/** Basename without emoji. Shell-unescapes POSIX paths first. */
export function pathBasename(path: string): string {
  const norm = normalizeLocalPathToken(path) || path.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

/**
 * Split stored/agent message into display text + attachment list.
 * Lines that are sole `@/abs/path` (or `@path`) become attachments.
 *
 * Internal blank lines in the body are preserved. Only blank lines that sit
 * between the body and a trailing `@path` block are stripped from `text`
 * (they are the dual-write separator, not user content).
 */
export function parseAttachmentsFromContent(content: string): {
  text: string;
  attachments: Attachment[];
} {
  if (!content) return { text: "", attachments: [] };
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const attachments: Attachment[] = [];
  const textLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // @/path or @C:\path or @path
    const m = trimmed.match(/^@((?:\/|[A-Za-z]:[\\/]).+)$/);
    if (m?.[1]) {
      const path = m[1].trim();
      attachments.push({
        path,
        name: pathBasename(path),
        isDir: false, // refined by pathsClassify when needed
      });
      continue;
    }
    // Legacy display markers from older builds
    const legacy = trimmed.match(/^\[(file|dir)\]\s+(.+)$/i);
    if (legacy?.[2] && !legacy[2].includes("/")) {
      // name-only legacy line — skip as plain text still ok
      textLines.push(line);
      continue;
    }
    textLines.push(line);
  }
  // Drop trailing blank lines left before attachment block (separator only).
  while (textLines.length && textLines[textLines.length - 1]!.trim() === "") {
    textLines.pop();
  }
  return { text: textLines.join("\n"), attachments };
}

/**
 * Dual-write sole-line `@/abs/path` refs onto display/journal content (idempotent).
 * Mirrors host `append_journal_attachment_refs`: keeps internal body blank lines;
 * normalizes only a trailing blank run before the attachment block.
 */
export function appendAttachmentRefsToContent(
  content: string,
  attachments: Attachment[],
): string {
  if (!attachments.length) {
    return (content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }
  const normalized = (content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  const priorRefs: string[] = [];
  while (lines.length) {
    const t = lines[lines.length - 1]!.trim();
    const m = t.match(/^@((?:\/|[A-Za-z]:[\\/]).+)$/);
    if (m?.[1]) {
      priorRefs.unshift(lines.pop()!);
      continue;
    }
    break;
  }
  while (lines.length && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }

  const existing = new Set(
    priorRefs
      .map((l) => l.trim().replace(/^@/, "").trim())
      .filter(Boolean),
  );
  const newRefs: string[] = [];
  for (const a of attachments) {
    const path = (a.path ?? "").trim();
    if (!path || existing.has(path)) continue;
    existing.add(path);
    newRefs.push(`@${path}`);
  }
  const refs = [...priorRefs, ...newRefs];
  if (!refs.length) return lines.join("\n");
  if (lines.length) lines.push("");
  lines.push(...refs);
  return lines.join("\n");
}

/** File extension lowercase without dot. */
export function pathExt(path: string): string {
  const base = pathBasename(path);
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i + 1).toLowerCase();
}

const IMAGE_EXTS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "heic",
  "avif",
] as const;

const VIDEO_EXTS = [
  "mp4",
  "webm",
  "mov",
  "mkv",
  "m4v",
  "avi",
  "ogv",
  "mpeg",
  "mpg",
] as const;

const IMAGE_EXT_RE = IMAGE_EXTS.join("|");
const VIDEO_EXT_RE = VIDEO_EXTS.join("|");
const MEDIA_EXT_RE = `${IMAGE_EXT_RE}|${VIDEO_EXT_RE}`;

export function isImagePath(path: string): boolean {
  return (IMAGE_EXTS as readonly string[]).includes(pathExt(path));
}

export function isVideoPath(path: string): boolean {
  return (VIDEO_EXTS as readonly string[]).includes(pathExt(path));
}

export function isMediaPath(path: string): boolean {
  return isImagePath(path) || isVideoPath(path);
}

/**
 * Local media abs worth attaching / previewing.
 *
 * Mirrors Host `is_plausible_local_media_abs`: reject single-segment false
 * extracts like `/replica_v2.mp4` or `/img_001.png` (often mid-path tails after
 * space + CJK folder names). Windows drive paths and `~/…` stay allowed.
 */
export function isPlausibleLocalMediaAbs(path: string): boolean {
  if (!path) return false;
  if (/^https?:\/\//i.test(path)) return false;
  const n = normalizeLocalPathToken(path) || path.trim();
  if (!n || !isMediaPath(n)) return false;
  if (isSiteRootAbsolutePath(n)) return false;
  // Windows drive (`C:\…` / `C:/…`) — host treats as always multi-part enough.
  if (isWindowsStylePath(n) || /^[A-Za-z]:\//.test(n)) {
    return n.length > 3;
  }
  if (n === "~" || n === "~/") return false;
  if (n.startsWith("~/")) {
    const rest = n.slice(2);
    if (!rest || rest.includes("..")) return false;
    return rest.split("/").filter(Boolean).length >= 1;
  }
  if (!n.startsWith("/")) return false;
  // POSIX: need `/dir/file.ext` — not `/file.ext` alone.
  return n.split("/").filter(Boolean).length >= 2;
}

/**
 * Known absolute roots that may follow CJK/prose glue (`换成/Users/…`).
 * Used only as a *start* allowlist after non-ASCII prev chars — not required
 * for normal delimited paths (` /tmp/a.png`, `：/workspace/…`).
 */
const KNOWN_LOCAL_ABS_PREFIX =
  /^(?:\/(?:Users|home|tmp|var|private|opt|Volumes|Applications|System|Library|mnt|run|root|usr|etc|sess|data|workspace|work|projects?)\/|~\/|[A-Za-z]:[\\/])/i;

/**
 * Whether `index` is a valid start for a bare absolute media path.
 * Avoids lookbehind (WKWebView). Rejects mid-path re-matches after ASCII path
 * body **and** after CJK segments from space-broken folders
 * (`…/grok 美女视频/file.mp4` must not yield `/file.mp4`).
 * Still allows CJK glue before known roots: `换成/Users/me/a.png`.
 */
function isBareAbsMediaStart(
  content: string,
  index: number,
  path: string,
): boolean {
  if (index <= 0) return true;
  const prev = content[index - 1]!;
  // Sentence / markdown / table delimiters — a real path may start after these.
  if (/[\s`"'<>|*?()[\]{}=，。；：、！？）】》〈《「『【（,;:!?+]/.test(prev)) {
    return true;
  }
  // ASCII path body / separators → mid-path (`Support/com.grokapp/…`).
  if (/[A-Za-z0-9_./~%+\-@\\]/.test(prev)) {
    return false;
  }
  // Non-ASCII (CJK, hangul, …): only allow known-root glue, not tail segments.
  if (prev.charCodeAt(0) > 127) {
    return KNOWN_LOCAL_ABS_PREFIX.test(path);
  }
  // Other ASCII punctuation — allow.
  return true;
}

/**
 * Known relative media roots (agent session + project cwd skill outputs).
 * Prefer longest match when building path-map tails.
 */
export const RELATIVE_MEDIA_ROOTS = [
  "images",
  "image",
  "videos",
  "video",
  "outputs",
  "output",
  "assets",
  "media",
  "generated",
  "exports",
] as const;

/** Session-relative media folder segment from an absolute path (`images/1.jpg`, `outputs/...`). */
export function mediaTailFromPath(abs: string): string | null {
  const norm = normalizeLocalPathToken(abs) || abs.replace(/\\/g, "/");
  let best: string | null = null;
  let bestIdx = -1;
  for (const folder of RELATIVE_MEDIA_ROOTS) {
    const marker = `/${folder}/`;
    const idx = norm.toLowerCase().lastIndexOf(marker);
    if (idx > bestIdx) {
      bestIdx = idx;
      best = norm.slice(idx + 1);
    }
  }
  if (best) return best;
  // Project shots / design-demos / arbitrary folders: last 2–3 segments so
  // `![alt](design-demos/shots/foo.png)` matches the attachment abs path.
  if (!isMediaPath(norm)) return null;
  const parts = norm.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(-Math.min(3, parts.length)).join("/");
}

/**
 * Extract absolute local image/video paths mentioned in assistant text
 * (backticks, plain paths). Backtick form allows spaces; prose may use
 * shell escapes (`\ ` `\( `) which are unescaped before attach.
 *
 * Never returns single-segment false extracts (`/file.mp4`) — those break
 * VideoUi/media HTTP with `path not allowed`.
 */
export function extractMediaPathsFromContent(content: string): Attachment[] {
  if (!content) return [];
  const seen = new Set<string>();
  const out: Attachment[] = [];
  const push = (raw: string) => {
    if (!raw) return;
    // Reject CMS site roots before normalize invents nothing useful.
    if (isSiteRootAbsolutePath(raw)) return;
    const path = normalizeLocalPathToken(raw) || raw.trim();
    if (!path || seen.has(path) || !isMediaPath(path)) return;
    if (!isRealLocalAbsolutePath(path)) return;
    // Host-aligned multi-segment gate (drops `/replica_v2.mp4` mid-path tails).
    if (!isPlausibleLocalMediaAbs(path)) return;
    seen.add(path);
    out.push({ path, name: pathBasename(path), isDir: false });
  };

  // Backticks: allow spaces inside (`…/Application Support/…`, CJK folders).
  const tickRe = new RegExp(
    `\`((?:\\/|[A-Za-z]:[\\\\/]|~\\/)[^\`]+?\\.(?:${MEDIA_EXT_RE}))\``,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = tickRe.exec(content)) !== null) push(m[1] || "");

  // Bare paths: known roots + soft space continuation; simple scan gated below.
  extractBareAbsoluteMedia(content, push);

  return out;
}

/** Hard path terminators (never part of a local FS path token). */
const PATH_HARD_STOP = /[`"'<>|*?\n\r]/;
/** CJK / fullwidth sentence punctuation abutting paths without a space. */
const PATH_CJK_STOP = /[，。；：、！？）】》]/;

/**
 * After an unescaped space in a known-root walk, try to finish a media path
 * that includes spaces in folder names (`Application Support`, `grok 美女视频`).
 * Returns null when the space is a real token boundary (sentence).
 */
function tryFinishSpacedMediaPath(
  content: string,
  spaceIndex: number,
  prefix: string,
  mediaExt: RegExp,
): { path: string; end: number } | null {
  // Prefix already ends with a media ext (`/tmp/a.png …`) — space is a
  // real token boundary, not a folder-name space. Do not swallow the rest
  // of the sentence into one false path (`…png and /tmp/b.mp4`).
  if (mediaExt.test(prefix)) return null;

  let i = spaceIndex;
  let built = prefix;
  while (i < content.length && built.length < 800) {
    const c = content[i]!;
    if (PATH_HARD_STOP.test(c) || PATH_CJK_STOP.test(c)) break;
    if (c === "\\" && i + 1 < content.length) {
      built += c + content[i + 1]!;
      i += 2;
      continue;
    }
    built += c;
    i += 1;
    if (!mediaExt.test(built)) continue;
    const next = i < content.length ? content[i]! : "";
    // Complete at end-of-string or a clear path boundary.
    if (
      !next ||
      /[\s`"'<>|*?，。；：、！？）】》,;!?]/.test(next) ||
      PATH_HARD_STOP.test(next)
    ) {
      return { path: built, end: i };
    }
  }
  if (mediaExt.test(built)) return { path: built, end: i };
  return null;
}

/**
 * Scan prose for absolute media paths, including shell-escaped spaces
 * (`file\ \(1\).png`) and unescaped spaces in folder names.
 * Site-root / single-segment tails are filtered by `push`.
 *
 * Roots may follow CJK without a space (`logo换成/Users/…`).
 */
function extractBareAbsoluteMedia(
  content: string,
  push: (raw: string) => void,
): void {
  // Find known local roots anywhere (not only after whitespace).
  const rootRe =
    /(\/(?:Users|home|tmp|var|private|opt|Volumes|Applications|System|Library|mnt|run|root|usr|etc|sess|data|workspace)\/|~\/|[A-Za-z]:[\\/])/gi;
  let sm: RegExpExecArray | null;
  const mediaExt = new RegExp(`\\.(?:${MEDIA_EXT_RE})$`, "i");
  while ((sm = rootRe.exec(content)) !== null) {
    // Skip if this looks like a URL path segment (…://host/Users/…).
    const before = content.slice(Math.max(0, sm.index - 8), sm.index);
    if (/:\/\//.test(before) || before.endsWith("://") || /https?:$/i.test(before)) {
      continue;
    }
    const start = sm.index;
    let i = start;
    let out = "";
    while (i < content.length) {
      const c = content[i]!;
      if (c === "\\" && i + 1 < content.length) {
        // Keep escape sequence for push() to unescape.
        out += c + content[i + 1]!;
        i += 2;
        continue;
      }
      // Unescaped whitespace: either end of token, or space inside a folder name.
      if (/\s/.test(c)) {
        if (c === "\n" || c === "\r") break;
        const spaced = tryFinishSpacedMediaPath(content, i, out, mediaExt);
        if (spaced) {
          out = spaced.path;
          i = spaced.end;
        }
        break;
      }
      // Markdown / glob delimiters end the path.
      if (/[`"'<>|*?]/.test(c)) break;
      // CJK / sentence punctuation often follows paths without space.
      if (PATH_CJK_STOP.test(c)) break;
      out += c;
      i += 1;
      if (out.length > 800) break;
    }
    if (mediaExt.test(out)) push(out);
    // Advance past this match to avoid tight loops.
    rootRe.lastIndex = Math.max(rootRe.lastIndex, start + Math.max(out.length, 1));
  }

  // Simple bare paths without requiring a known root (`/workspace/…`, custom).
  // Require a valid start boundary so we never re-match mid-path tails:
  //   `…/Support/com.grokapp/…/images/1.jpg` → false `/com…`
  //   `…/grok 美女视频/replica_v2.mp4` → false `/replica_v2.mp4`
  // Allows CJK glue before known roots: `换成/Users/…/a.png`.
  //
  // No lookbehind (`(?<!…)`) — Safari/WKWebView throws
  // "Invalid regular expression: invalid group specifier name" and white-screens
  // the chat UiErrorBoundary. Check the previous char after each match instead.
  const bareSimpleRe = new RegExp(
    `((?:\\/(?!images?\\/|static\\/|assets?\\/|public\\/|uploads?\\/)[^\\s\`"'<>|*?]+|~\\/[^\\s\`"'<>|*?]+|[A-Za-z]:[\\\\/][^\\s\`"'<>|*?]+)\\.(?:${MEDIA_EXT_RE}))\\b`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = bareSimpleRe.exec(content)) !== null) {
    const path = m[1] || "";
    if (!path) continue;
    if (!isBareAbsMediaStart(content, m.index, path)) continue;
    push(path);
  }
}

/** @deprecated use extractMediaPathsFromContent */
export function extractImagePathsFromContent(content: string): Attachment[] {
  return extractMediaPathsFromContent(content).filter((a) =>
    isImagePath(a.path),
  );
}

/**
 * Project / session relative media paths:
 * - Grok Build: `images/1.jpg`, `videos/1.mp4` (agent session dir)
 * - Skill outputs: `outputs/xhx-media-gen/foo.png` (project cwd)
 * - Bare basenames in ticks/links: `shenzhen-weather-card.png` (project cwd)
 * Also any multi-segment relative path with a media extension (no `..`).
 *
 * Bare unadorned prose filenames are intentionally skipped (too many false
 * positives). Tick / markdown-link forms are how agents cite workspace copies.
 */
export function extractSessionRelativeMediaRefs(content: string): string[] {
  if (!content) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string, allowBare: boolean) => {
    let p = raw.trim().replace(/^\.\//, "").replace(/\\/g, "/");
    if (!p || seen.has(p)) return;
    if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) return;
    if (p.includes("..")) return;
    if (!isMediaPath(p)) return;
    // Bare basenames only when explicitly cited (ticks / md links).
    if (!p.includes("/") && !allowBare) return;
    // Reject obvious URL-ish or protocol-ish
    if (p.includes("://")) return;
    // Reject path-traversal-looking tokens and over-long noise
    if (p.length > 260) return;
    seen.add(p);
    out.push(p);
  };

  const folder = `(?:${RELATIVE_MEDIA_ROOTS.join("|")})`;
  // Multi-segment relative media path (skill outputs under project cwd, etc.)
  const relMedia = `(?:${folder}\\/|[\\w.-]+\\/)[^\\s\`"'<>|*?\\n]+?\\.(?:${MEDIA_EXT_RE})`;
  // Bare basename cited in ticks / links (workspace copies after write/cp)
  const bareMedia = `[\\w.-]+\\.(?:${MEDIA_EXT_RE})`;

  let m: RegExpExecArray | null;

  const tickRelRe = new RegExp(`\`(${relMedia})\``, "gi");
  while ((m = tickRelRe.exec(content)) !== null) push(m[1] || "", false);

  const tickBareRe = new RegExp(`\`(${bareMedia})\``, "gi");
  while ((m = tickBareRe.exec(content)) !== null) push(m[1] || "", true);

  const linkRelRe = new RegExp(`\\[[^\\]]*\\]\\((${relMedia})\\)`, "gi");
  while ((m = linkRelRe.exec(content)) !== null) push(m[1] || "", false);

  const linkBareRe = new RegExp(`\\[[^\\]]*\\]\\((${bareMedia})\\)`, "gi");
  while ((m = linkBareRe.exec(content)) !== null) push(m[1] || "", true);

  // Unquoted multi-segment only (never bare prose)
  const bareRe = new RegExp(
    `(?:^|[\\s("'（【])(${relMedia})\\b`,
    "gi",
  );
  while ((m = bareRe.exec(content)) !== null) push(m[1] || "", false);

  return out;
}

/** @deprecated use extractSessionRelativeMediaRefs */
export function extractSessionRelativeImageRefs(content: string): string[] {
  return extractSessionRelativeMediaRefs(content).filter((p) => isImagePath(p));
}

/**
 * Resolve a markdown link href/text to a local media absolute path when possible.
 */
export function resolveMediaHref(
  href: string | undefined | null,
  linkText: string | undefined | null,
  pathMap?: Record<string, string> | null,
): string | null {
  const candidates = [href, linkText]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  for (const cand of candidates) {
    const cleaned = cand.replace(/^<|>$/g, "");
    const abs = resolveInlineMediaToken(cleaned, pathMap);
    if (abs && isMediaPath(abs)) return abs;
  }
  return null;
}

/** @deprecated use resolveMediaHref */
export function resolveImageHref(
  href: string | undefined | null,
  linkText: string | undefined | null,
  pathMap?: Record<string, string> | null,
): string | null {
  const abs = resolveMediaHref(href, linkText, pathMap);
  return abs && isImagePath(abs) ? abs : abs && isVideoPath(abs) ? abs : abs;
}

/** Join agent session root with a short relative path. */
export function joinSessionMediaPath(
  mediaRoot: string,
  relative: string,
): string {
  const root = mediaRoot.replace(/[/\\]+$/, "");
  const rel = relative.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(root) || root.includes("\\")) {
    return `${root}\\${rel.replace(/\//g, "\\")}`;
  }
  return `${root}/${rel}`;
}

/**
 * Absolute paths from text + optional session-relative refs joined to mediaRoot.
 */
export function mergeMessageAttachments(
  stored: Attachment[] | undefined,
  content: string,
  options?: {
    mediaRoot?: string | null;
    resolvedRelative?: Attachment[];
  },
): Attachment[] | undefined {
  const fromAbs = extractMediaPathsFromContent(content);
  let fromRel: Attachment[] = options?.resolvedRelative ?? [];
  if (!fromRel.length && options?.mediaRoot) {
    fromRel = extractSessionRelativeMediaRefs(content).map((rel) => ({
      path: joinSessionMediaPath(options.mediaRoot!, rel),
      name: pathBasename(rel),
      isDir: false,
    }));
  }
  const merged = mergeAttachments(
    mergeAttachments(stored ?? [], fromAbs),
    fromRel,
  );
  return merged.length ? merged : undefined;
}

export type MessageWithAttachments = {
  role: string;
  content: string;
  attachments?: Attachment[];
};

/**
 * Attach resolved absolute paths for short media refs in assistant text.
 */
export function applyResolvedSessionMedia<T extends MessageWithAttachments>(
  messages: T[],
  resolved: Attachment[],
): T[] {
  if (!resolved.length) return messages;
  const byName = new Map(resolved.map((a) => [a.name, a] as const));
  const byTail = new Map(
    resolved.map((a) => {
      const tail = mediaTailFromPath(a.path) ?? a.name;
      return [tail.replace(/\\/g, "/"), a] as const;
    }),
  );

  let changed = false;
  const next = messages.map((m) => {
    if (m.role !== "assistant" || !m.content) return m;
    const rels = extractSessionRelativeMediaRefs(m.content);
    if (!rels.length) return m;
    const extra: Attachment[] = [];
    for (const rel of rels) {
      const key = rel.replace(/\\/g, "/");
      const hit =
        byTail.get(key) ||
        byName.get(pathBasename(rel)) ||
        resolved.find(
          (a) =>
            a.path.replace(/\\/g, "/").endsWith(`/${key}`) ||
            key.endsWith(`/${pathBasename(a.path)}`),
        );
      if (hit) extra.push(hit);
    }
    if (!extra.length) return m;
    const attachments = mergeAttachments(m.attachments ?? [], extra);
    if (
      attachments.length === (m.attachments?.length ?? 0) &&
      attachments.every((a, i) => a.path === m.attachments?.[i]?.path)
    ) {
      return m;
    }
    changed = true;
    return { ...m, attachments };
  });
  return changed ? next : messages;
}

/** Collect all session-relative media refs from a message list. */
export function collectSessionRelativeMediaRefs(
  messages: MessageWithAttachments[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== "assistant" || !m.content) continue;
    for (const r of extractSessionRelativeMediaRefs(m.content)) {
      if (seen.has(r)) continue;
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

/** @deprecated use collectSessionRelativeMediaRefs */
export function collectSessionRelativeImageRefs(
  messages: MessageWithAttachments[],
): string[] {
  return collectSessionRelativeMediaRefs(messages);
}

/**
 * Map text tokens (relative short path / basename / absolute) → absolute path
 * for in-place markdown rendering.
 */
export function buildInlineMediaPathMap(
  attachments?: Attachment[] | null,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const a of attachments ?? []) {
    if (a.isDir || !isMediaPath(a.path)) continue;
    const abs = a.path;
    map[abs] = abs;
    map[pathBasename(abs)] = abs;
    const tail = mediaTailFromPath(abs);
    if (tail) {
      map[tail] = abs;
      map[tail.toLowerCase()] = abs;
    }
  }
  return map;
}

/** @deprecated use buildInlineMediaPathMap */
export function buildInlineImagePathMap(
  attachments?: Attachment[] | null,
): Record<string, string> {
  return buildInlineMediaPathMap(attachments);
}

/** Look up absolute path for a code-span / token from the inline map. */
export function resolveInlineMediaToken(
  token: string,
  pathMap: Record<string, string> | undefined | null,
): string | null {
  const t = token.trim();
  if (!t) return null;
  if (isSiteRootAbsolutePath(t)) return null;

  const mappedOk = (abs: string | undefined): string | null => {
    if (!abs) return null;
    if (isSiteRootAbsolutePath(abs)) return null;
    // Mapped targets must still be openable local media (no `/file.mp4` junk).
    if (
      isRealLocalAbsolutePath(abs) &&
      isMediaPath(abs) &&
      isPlausibleLocalMediaAbs(abs)
    ) {
      return abs;
    }
    return null;
  };

  // Relative short tokens (images/1.jpg) resolve only via pathMap.
  const fromMap =
    mappedOk(pathMap?.[t]) ||
    mappedOk(pathMap?.[t.replace(/\\/g, "/")]);
  if (fromMap) return fromMap;

  const norm = normalizeLocalPathToken(t) || unescapeShellPath(t);
  if (!norm) return null;
  if (isSiteRootAbsolutePath(norm)) return null;
  const fromNorm =
    mappedOk(pathMap?.[norm]) ||
    mappedOk(pathMap?.[norm.toLowerCase()]);
  if (fromNorm) return fromNorm;

  // Markdown often cites `design-demos/shots/foo.png` while the map only
  // has the basename or a shorter tail from the attachment abs path.
  if (pathMap && isMediaPath(norm)) {
    const slashNorm = norm.replace(/\\/g, "/").replace(/^\.\//, "");
    const parts = slashNorm.split("/").filter(Boolean);
    for (let n = parts.length; n >= 1; n--) {
      const suffix = parts.slice(-n).join("/");
      const hit =
        mappedOk(pathMap[suffix]) || mappedOk(pathMap[suffix.toLowerCase()]);
      if (hit) return hit;
    }
  }
  // Real local absolute without a map — multi-segment only.
  if (
    isRealLocalAbsolutePath(norm) &&
    isMediaPath(norm) &&
    isPlausibleLocalMediaAbs(norm)
  ) {
    return norm;
  }
  return null;
}

/** @deprecated use resolveInlineMediaToken */
export function resolveInlineImageToken(
  token: string,
  pathMap: Record<string, string> | undefined | null,
): string | null {
  return resolveInlineMediaToken(token, pathMap);
}

/**
 * Whether an attachment path is safe to show as an openable card.
 * Drops:
 * - false extracts like `/img_001.png` / `/replica_v2.mp4` (single-segment abs)
 * - site-root CMS paths (`/images/...`)
 * which otherwise render as dead paperclip thumbs that cannot preview.
 */
export function isDisplayableAttachmentPath(path: string): boolean {
  const t = (path || "").trim();
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (isSiteRootAbsolutePath(t)) return false;
  // Fused media query keys (`t:/Users/…`) are not real attachment paths.
  if (isFusedQueryKeyPath(t)) return false;
  // Media abs: host-aligned multi-segment gate (covers `/replica_v2.mp4`).
  if (isMediaPath(t) && (isRealLocalAbsolutePath(t) || t.startsWith("~/"))) {
    return isPlausibleLocalMediaAbs(t);
  }
  // Single-segment absolute (`/dbs`) — not a real workspace path.
  if (t.startsWith("/") && !t.startsWith("//")) {
    const segs = t.split("/").filter(Boolean);
    if (segs.length < 2) return false;
  }
  // Prefer real local abs / home / windows; relative multi-seg kept for host resolve.
  if (isRealLocalAbsolutePath(t)) return true;
  if (t.startsWith("~/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(t)) return true;
  // Relative project tokens with a directory prefix.
  if ((t.includes("/") || t.includes("\\")) && !t.startsWith("/")) return true;
  return false;
}

/**
 * Attachments still shown below the message: non-media, or media that is
 * not already referenced (and thus inlined) in the message body.
 */
export function filterAttachmentsNotInlined(
  content: string,
  attachments?: Attachment[] | null,
): Attachment[] | undefined {
  if (!attachments?.length) return undefined;
  const rels = new Set(
    extractSessionRelativeMediaRefs(content).map((r) => r.replace(/\\/g, "/")),
  );
  const absInText = new Set(
    extractMediaPathsFromContent(content).map((a) => a.path),
  );
  const out = attachments.filter((a) => {
    // Hide unopenable false extracts (paperclip that cannot preview).
    if (!isDisplayableAttachmentPath(a.path)) return false;
    if (a.isDir || !isMediaPath(a.path)) return true;
    const name = pathBasename(a.path);
    const norm = a.path.replace(/\\/g, "/");
    const rel = mediaTailFromPath(norm);
    if (rel && rels.has(rel)) return false;
    if (absInText.has(a.path)) return false;
    if (rel && content.includes(rel)) return false;
    if (rels.has(name)) return false;
    if ([...rels].some((r) => r === name || r.endsWith(`/${name}`))) {
      return false;
    }
    if (
      content.includes(`\`${name}\``) ||
      content.includes(`\`${a.path}\``) ||
      (rel && content.includes(`\`${rel}\``))
    ) {
      return false;
    }
    // Markdown link / image form (`![alt](rel)` or `](basename)`)
    if (rel && content.includes(`](${rel})`)) return false;
    if (content.includes(`](${name})`)) return false;
    return true;
  });
  return out.length ? out : undefined;
}
