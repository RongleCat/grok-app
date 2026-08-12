/**
 * Chat path card → Side Workbench Files tab deep-link (pure).
 *
 * Gates: project present + trusted + path under project root.
 * Soft-fail reasons map to i18n keys; optional OS reveal when side open is denied.
 * No DOM / Tauri / i18n side effects.
 */

import type { MessageKey } from "@/i18n";
import {
  isHomeRelativePath,
  isHttpUrl,
  normalizeLocalPathToken,
} from "@/lib/pathRefs";
import {
  isFsAbsolutePath,
  joinProjectPath,
} from "@/lib/sideWorkbench";

/** Stable soft-fail reasons for chat → side Files tab. */
export type SidePathDeepLinkReason =
  | "empty"
  | "url"
  | "no_project"
  | "untrusted"
  | "outside_project"
  | "missing";

export type SidePathDeepLinkInput = {
  /** Resolved absolute path preferred; project-relative also accepted. */
  path: string;
  title?: string;
  projectPath?: string | null;
  /**
   * When `false`, refuse (project must be trusted first).
   * `true` / `null` / `undefined` → allow if a project path exists.
   */
  projectTrusted?: boolean | null;
  /** When true, path is known missing on disk (card layer already probed). */
  missing?: boolean;
};

export type SidePathDeepLinkOk = {
  ok: true;
  /** Absolute (or joined) path for SideTab + FilesWorkspace. */
  path: string;
  /** Project-relative key when under root; empty string for the root itself. */
  relativePath: string | null;
  title: string;
};

export type SidePathDeepLinkFail = {
  ok: false;
  reason: SidePathDeepLinkReason;
  /** i18n key for toast honesty. */
  messageKey: MessageKey;
  /** Absolute path for optional OS reveal fallback (when known). */
  revealPath?: string;
  /** Whether caller should attempt pathReveal after toast. */
  shouldReveal: boolean;
};

export type SidePathDeepLinkResult = SidePathDeepLinkOk | SidePathDeepLinkFail;

const MSG: Record<SidePathDeepLinkReason, MessageKey> = {
  empty: "resources.sideOpen.empty",
  url: "resources.sideOpen.url",
  no_project: "resources.sideOpen.noProject",
  untrusted: "resources.sideOpen.untrusted",
  outside_project: "resources.sideOpen.outsideProject",
  missing: "resources.openErr.notFound",
};

/** Normalize for open / under-root compare (POSIX separators, trim trailing slash). */
export function normalizeSidePath(path: string): string {
  const raw = (path ?? "").trim().replace(/^<|>$/g, "");
  if (!raw) return "";
  const unescaped = normalizeLocalPathToken(raw) || raw;
  // Collapse trailing separators except drive roots (`C:/`, `/`).
  if (/^[A-Za-z]:\/?$/.test(unescaped.replace(/\\/g, "/"))) {
    return unescaped.replace(/\\/g, "/").replace(/\/?$/, "/");
  }
  if (unescaped === "/" || unescaped === "\\") return "/";
  return unescaped.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** True when `target` is the project root or a path inside it. */
export function isPathUnderProject(
  projectRoot: string,
  target: string,
): boolean {
  const root = normalizeSidePath(projectRoot);
  const tgt = normalizeSidePath(target);
  if (!root || !tgt) return false;
  return tgt === root || tgt.startsWith(root + "/");
}

/**
 * Project-relative form of an absolute path, or null when outside root.
 * Root itself → `""`.
 */
export function toProjectRelative(
  projectRoot: string,
  targetAbs: string,
): string | null {
  if (!isPathUnderProject(projectRoot, targetAbs)) return null;
  const root = normalizeSidePath(projectRoot);
  const tgt = normalizeSidePath(targetAbs);
  if (tgt === root) return "";
  return tgt.slice(root.length + 1);
}

/** Join project root + relative segment (delegates style to sideWorkbench). */
export function joinProjectRoot(
  projectRoot: string,
  relative: string,
): string {
  return joinProjectPath(projectRoot, relative);
}

function basenameTitle(path: string, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();
  const n = normalizeSidePath(path);
  if (!n) return path || "file";
  const parts = n.split("/").filter(Boolean);
  return parts[parts.length - 1] || n;
}

function fail(
  reason: SidePathDeepLinkReason,
  opts?: { revealPath?: string; shouldReveal?: boolean },
): SidePathDeepLinkFail {
  const revealPath = opts?.revealPath?.trim() || undefined;
  return {
    ok: false,
    reason,
    messageKey: MSG[reason],
    revealPath,
    shouldReveal: !!opts?.shouldReveal && !!revealPath,
  };
}

/**
 * Decide whether a chat path card may open a Side Workbench Files tab.
 *
 * - URLs are not file deep-links (browser path stays separate).
 * - Relative tokens join project root (no monorepo invent — caller should
 *   pass Host-resolved abs when available).
 * - Absolute paths must sit under the trusted project root.
 * - Soft-fail outside / untrusted / no project may set `shouldReveal` so the
 *   UI can fall back to OS reveal without pretending the side tab opened.
 */
export function resolveSidePathDeepLink(
  input: SidePathDeepLinkInput,
): SidePathDeepLinkResult {
  const raw = (input.path ?? "").trim();
  if (!raw) return fail("empty");

  if (isHttpUrl(raw)) return fail("url");

  if (input.missing) {
    const hint = isFsAbsolutePath(raw) || isHomeRelativePath(raw)
      ? normalizeSidePath(raw) || raw
      : undefined;
    return fail("missing", { revealPath: hint, shouldReveal: false });
  }

  const projectPath = (input.projectPath ?? "").trim();
  if (!projectPath) {
    const reveal =
      isFsAbsolutePath(raw) || isHomeRelativePath(raw)
        ? normalizeSidePath(raw) || raw
        : undefined;
    return fail("no_project", {
      revealPath: reveal,
      shouldReveal: !!reveal,
    });
  }

  if (input.projectTrusted === false) {
    return fail("untrusted", {
      revealPath:
        isFsAbsolutePath(raw) || isHomeRelativePath(raw)
          ? normalizeSidePath(raw) || raw
          : undefined,
      shouldReveal: false,
    });
  }

  const norm = normalizeSidePath(raw) || raw;

  // Home-relative / absolute outside pure join — must already be under root.
  if (isHomeRelativePath(norm)) {
    // Pure helper cannot expand `~`; treat as outside unless it literally
    // matches a home-style project root (rare). Soft-fail with reveal.
    return fail("outside_project", {
      revealPath: norm,
      shouldReveal: true,
    });
  }

  let abs: string;
  if (isFsAbsolutePath(norm)) {
    abs = norm;
  } else {
    // Project-relative → join root (path style follows project root).
    abs = normalizeSidePath(joinProjectRoot(projectPath, norm)) || joinProjectRoot(projectPath, norm);
  }

  if (!isPathUnderProject(projectPath, abs)) {
    return fail("outside_project", {
      revealPath: abs,
      shouldReveal: true,
    });
  }

  const relativePath = toProjectRelative(projectPath, abs);
  return {
    ok: true,
    path: abs,
    relativePath,
    title: basenameTitle(abs, input.title),
  };
}
