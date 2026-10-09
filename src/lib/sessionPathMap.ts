/**
 * Session path map for chat FilePathCards.
 *
 * Agents often write short relative paths (`04-正文/正文.md`, `正文.md`) while
 * tool_step rows already hold the true absolute path (usually on the host
 * `input:` line → `toolInput`). Project trees can contain many homonyms
 * (article templates all share `04-正文/正文.md`).
 *
 * Mapping rules:
 * 1. Collect absolute files the session has already touched (tools + prose).
 * 2. A short token maps when exactly one candidate exists.
 * 3. When several candidates share a short token, prefer the **last-touched**
 *    absolute path (chronological order in the corpus). Reading a style-ref
 *    `正文.md` mid-session must not permanently steal clicks from the article
 *    the agent is actively editing afterwards.
 */

import type { ChatMessage, MessageSegment } from "@/lib/session";
import { parseToolStepContent } from "@/lib/session";
import {
  isAbsoluteFsPath,
  isHomeRelativePath,
  isHttpUrl,
  isRealLocalAbsolutePath,
  isSiteRootAbsolutePath,
  normalizePathToken,
} from "@/lib/pathRefs";
import { pathBasename } from "@/lib/attachments";
import { normalizeLocalPathToken, pathTokenText } from "@/lib/pathNormalize";

/** File-ish extensions we treat as openable path-map targets (not dirs). */
const FILE_EXT_RE =
  /\.(?:ts|tsx|js|jsx|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|bash|zsh|sql|vue|svelte|dart|lua|r|scala|zig|toml|yaml|yml|json|jsonc|css|scss|less|md|mdx|txt|log|html|htm|xml|csv|tsv|env|ini|conf|config|docx|docm|xlsx|xlsm|pptx|pptm|pdf|odt|ods|odp|zip|tar|gz|tgz|7z|rar|wasm|map|lock|gradle|cmake|svg|png|jpe?g|gif|webp|bmp|heic|avif|mp4|webm|mov|mkv|m4v|avi|mp3|wav|ogg|m4a|flac)$/i;

const PATH_HARD_STOP = /[`"'<>|*?\n\r]/;
const PATH_CJK_STOP = /[，。；：、！？）】》]/;

function normAbs(p: string): string {
  const n = normalizeLocalPathToken(p) || pathTokenText(p).replace(/\\/g, "/");
  return n.replace(/\/+$/, "");
}

/**
 * Single-line absolute / home path that looks like a real file (has extension).
 * Rejects truncated space-broken tails (`…/Mac`) and shell commands.
 */
export function isPlausibleAbsFile(p: string): boolean {
  const t = normAbs(pathTokenText(p).trim());
  if (!t || t.length > 800) return false;
  if (t.includes("\n") || t.includes("\r")) return false;
  if (isHttpUrl(t) || t.includes("://")) return false;
  if (isSiteRootAbsolutePath(t)) return false;
  // Shell / multi-arg noise (`ls -la /tmp`, `cd "/path" && …`)
  if (/\s(-{1,2}[A-Za-z]|&&|\||;)/.test(t)) return false;
  if (
    !isRealLocalAbsolutePath(t) &&
    !isAbsoluteFsPath(t) &&
    !isHomeRelativePath(t)
  ) {
    return false;
  }
  const base = pathBasename(t);
  if (!base || base === t) return false;
  // Require a real file extension so space-truncated folder tails never map.
  return FILE_EXT_RE.test(base);
}

/**
 * Host `input:` / toolInput is often a pure absolute file path (read/write/edit).
 * Accept that as a path map source when it looks like a single file.
 */
export function isToolInputFilePath(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const t = raw.trim();
  if (!t || t.includes("\n")) return false;
  return isPlausibleAbsFile(t);
}

/**
 * Scan prose for absolute file paths, including unescaped spaces in folder
 * names (`Mac Studio…/04-正文/正文.md`, `Application Support/…`).
 * Mirrors the media extractor in attachments.ts but for general file exts.
 */
export function extractAbsoluteFilePathsFromText(content: string): string[] {
  if (typeof content !== "string" || !content) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = normalizeLocalPathToken(raw) || pathTokenText(raw).trim();
    if (!isPlausibleAbsFile(t)) return;
    const n = normAbs(t);
    if (seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  // Backticks: allow spaces inside.
  for (const hit of content.matchAll(/`([^`\n]{2,800})`/g)) {
    const inner = hit[1]?.trim() || "";
    if (isAbsoluteFsPath(inner) || isHomeRelativePath(inner)) push(inner);
  }

  // Bare: known roots + optional space continuation until file extension.
  const rootRe =
    /(\/(?:Users|home|tmp|var|private|opt|Volumes|Applications|System|Library|mnt|run|root|usr|etc|sess|data|workspace)\/|~\/|[A-Za-z]:[\\/])/gi;
  let sm: RegExpExecArray | null;
  while ((sm = rootRe.exec(content)) !== null) {
    const before = content.slice(Math.max(0, sm.index - 8), sm.index);
    if (
      /:\/\//.test(before) ||
      before.endsWith("://") ||
      /https?:$/i.test(before)
    ) {
      continue;
    }
    // Mid-path rematch: `/Users/…/Documents/workspace/grok/a.png` must not
    // also yield `/workspace/grok/a.png` (that stolen basename 404s ImageUi
    // until a session remount resolves the real project file).
    if (sm.index > 0) {
      const prev = content[sm.index - 1]!;
      const delim =
        /[\s`"'<>|*?()[\]{}=，。；：、！？）】》〈《「『【（,;:!?+]/.test(prev);
      if (!delim && /[A-Za-z0-9_./~%+\-@\\]/.test(prev)) {
        continue;
      }
    }
    const start = sm.index;
    let i = start;
    let built = "";
    while (i < content.length && built.length < 800) {
      const c = content[i]!;
      if (c === "\\" && i + 1 < content.length) {
        built += c + content[i + 1]!;
        i += 2;
        continue;
      }
      if (/\s/.test(c)) {
        if (c === "\n" || c === "\r") break;
        // Space may be inside a folder name — keep going until we hit a file ext
        // at a path boundary; otherwise treat as token end.
        if (FILE_EXT_RE.test(built)) break;
        let j = i;
        let trial = built;
        let finished: string | null = null;
        while (j < content.length && trial.length < 800) {
          const d = content[j]!;
          if (PATH_HARD_STOP.test(d) || PATH_CJK_STOP.test(d)) break;
          if (d === "\\" && j + 1 < content.length) {
            trial += d + content[j + 1]!;
            j += 2;
            continue;
          }
          trial += d;
          j += 1;
          if (!FILE_EXT_RE.test(trial)) continue;
          const next = j < content.length ? content[j]! : "";
          if (
            !next ||
            /[\s`"'<>|*?，。；：、！？）】》,;!?]/.test(next) ||
            PATH_HARD_STOP.test(next)
          ) {
            finished = trial;
            break;
          }
        }
        if (finished) {
          built = finished;
          i = j;
        }
        break;
      }
      if (/[`"'<>|*?]/.test(c) || PATH_CJK_STOP.test(c)) break;
      built += c;
      i += 1;
    }
    if (FILE_EXT_RE.test(built)) {
      push(built);
      rootRe.lastIndex = Math.max(rootRe.lastIndex, start + built.length);
    }
  }

  return out;
}

/** Collect absolute file paths referenced by a single message (order preserved). */
export function collectAbsolutePathsFromMessage(m: ChatMessage): string[] {
  const out: string[] = [];
  const push = (raw?: string | null) => {
    const text = pathTokenText(raw);
    if (!text) return;
    const t = normalizeLocalPathToken(text) || text.trim();
    if (!isPlausibleAbsFile(t)) return;
    out.push(normAbs(t));
  };
  /** Whole field if it is a single path, else scan embedded abs paths (curl -o). */
  const pushFromText = (raw?: string | null) => {
    const text = pathTokenText(raw);
    if (!text) return;
    push(text);
    if (!isPlausibleAbsFile(text.trim())) {
      for (const p of extractAbsoluteFilePathsFromText(text)) {
        push(p);
      }
    }
  };

  pushFromText(m.toolPath);
  // Host journals file targets as `input:` → toolInput (read_file / write / edit).
  // Without this, short tokens like `04-正文/正文.md` never see the real abs path
  // when the article folder name contains spaces (Mac Studio…).
  // Live shell tools keep the full command here (`curl -o "/abs/out.png"`).
  pushFromText(m.toolInput);
  pushFromText(m.toolOutput);
  // Media / file cards attached to the message (image_gen, drops, etc.)
  // so short tokens like `images/1.jpg` resolve in every content segment.
  if (m.attachments?.length) {
    for (const a of m.attachments) {
      if (!a.isDir) push(a.path);
    }
  }
  if (m.marker === "tool_step" || m.content?.startsWith("tool_step|")) {
    const raw = m.content || "";
    // Prefer structured fields when present; still re-parse raw journal lines
    // so offline tests / partial rows keep working.
    const parsed = raw.startsWith("tool_step|")
      ? parseToolStepContent(raw)
      : null;
    pushFromText(parsed?.path);
    pushFromText(parsed?.input);
    // Title / detail often embed `Read `/abs/path``
    if (parsed?.title) {
      for (const hit of parsed.title.matchAll(/`([^`]+)`/g)) {
        push(hit[1]);
      }
    }
    if (parsed?.detail) {
      for (const hit of parsed.detail.matchAll(/`([^`]+)`/g)) {
        push(hit[1]);
      }
      // Only push whole detail when it is a single path line.
      if (isToolInputFilePath(parsed.detail)) push(parsed.detail);
      else {
        for (const p of extractAbsoluteFilePathsFromText(parsed.detail)) {
          push(p);
        }
      }
    }
    // Segments on live tool rows
    if (m.segments?.length) {
      for (const seg of m.segments) {
        if (seg.kind === "tool") {
          const tool = seg as Extract<MessageSegment, { kind: "tool" }>;
          pushFromText(tool.path);
          pushFromText(tool.input);
          pushFromText(tool.output);
          pushFromText(tool.detail);
        }
      }
    }
    return out;
  }

  if (m.segments?.length) {
    for (const seg of m.segments) {
      if (seg.kind === "tool") {
        const tool = seg as Extract<MessageSegment, { kind: "tool" }>;
        pushFromText(tool.path);
        pushFromText(tool.input);
        pushFromText(tool.output);
        pushFromText(tool.detail);
      }
    }
  }

  const text = m.content || "";
  if (text) {
    for (const p of extractAbsoluteFilePathsFromText(text)) {
      push(p);
    }
  }

  return out;
}

/**
 * Suffix keys for an absolute path: basename, last 2..5 segments, and
 * project-relative form when under `projectPath`.
 */
export function suffixKeysForAbsolute(
  abs: string,
  projectPath?: string | null,
): string[] {
  const norm = normAbs(abs);
  const parts = norm.split("/").filter(Boolean);
  const keys: string[] = [norm];
  if (parts.length) {
    keys.push(parts[parts.length - 1]!);
  }
  const max = Math.min(5, parts.length);
  for (let n = 2; n <= max; n++) {
    keys.push(parts.slice(-n).join("/"));
  }
  const root = projectPath ? normAbs(projectPath) : "";
  if (root && (norm === root || norm.startsWith(root + "/"))) {
    const rel = norm.slice(root.length).replace(/^\//, "");
    if (rel) {
      keys.push(rel);
      keys.push(`./${rel}`);
    }
  }
  return keys;
}

export type BuildPathMapOpts = {
  /**
   * When several absolute paths share a short token:
   * - `unique` — only map when exactly one candidate (legacy / strict)
   * - `last` — map to the last-seen candidate (session default; recency)
   */
  onAmbiguous?: "unique" | "last";
};

/**
 * Build token → absolute map from an ordered corpus of absolute paths.
 * Later entries win for ambiguous short tokens when `onAmbiguous: "last"`.
 */
export function buildUniquePathMap(
  absolutePaths: string[],
  projectPath?: string | null,
  opts?: BuildPathMapOpts,
): Record<string, string> {
  const onAmbiguous = opts?.onAmbiguous ?? "unique";
  // Preserve last-seen index per absolute path (chronological corpus).
  const lastIdx = new Map<string, number>();
  absolutePaths.forEach((raw, i) => {
    const n = normAbs(raw);
    if (!isPlausibleAbsFile(n)) return;
    lastIdx.set(n, i);
  });
  const absList = [...lastIdx.keys()].sort(
    (a, b) => (lastIdx.get(a) ?? 0) - (lastIdx.get(b) ?? 0),
  );

  // token → set of abs
  const bucket = new Map<string, Set<string>>();
  const add = (token: string, abs: string) => {
    const t = token.trim().replace(/\\/g, "/");
    if (!t) return;
    let set = bucket.get(t);
    if (!set) {
      set = new Set();
      bucket.set(t, set);
    }
    set.add(abs);
  };

  for (const abs of absList) {
    for (const key of suffixKeysForAbsolute(abs, projectPath)) {
      add(key, abs);
      const stripped = normalizePathToken(key);
      if (stripped && stripped !== key) add(stripped, abs);
    }
  }

  const map: Record<string, string> = {};
  for (const [token, set] of bucket) {
    if (set.size === 1) {
      map[token] = [...set][0]!;
      continue;
    }
    if (onAmbiguous === "last" && set.size > 1) {
      let best: string | null = null;
      let bestI = -1;
      for (const abs of set) {
        const i = lastIdx.get(abs) ?? -1;
        if (i >= bestI) {
          bestI = i;
          best = abs;
        }
      }
      if (best) map[token] = best;
    }
  }
  // Always map absolute → itself even if somehow multi (shouldn't happen).
  for (const abs of absList) {
    map[abs] = abs;
  }
  return map;
}

/** Session-wide map used by markdown path cards. */
export function buildSessionFilePathMap(
  messages: ChatMessage[],
  projectPath?: string | null,
): Record<string, string> {
  const abs: string[] = [];
  for (const m of messages) {
    abs.push(...collectAbsolutePathsFromMessage(m));
  }
  // Prefer last tool-touched file for homonyms like many `04-正文/正文.md`.
  return buildUniquePathMap(abs, projectPath, { onAmbiguous: "last" });
}

/** Merge media attachment map + session file map (session wins on conflict only if unique). */
export function mergePathMaps(
  ...maps: Array<Record<string, string> | undefined | null>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of maps) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) {
      if (k && v) out[k] = v;
    }
  }
  return out;
}
