/**
 * Git worktree helpers (issue #42).
 * Porcelain format matches `git worktree list --porcelain`.
 */

export type GitWorktreeEntry = {
  /** Absolute path to the worktree root. */
  path: string;
  /** Full HEAD sha when present. */
  head?: string | null;
  /** Branch name without refs/heads/, or null if detached. */
  branch?: string | null;
  /** True when HEAD is detached. */
  detached: boolean;
  /** True when this is the primary / main worktree (first listed). */
  isMain: boolean;
  /** True when locked (optional porcelain field). */
  locked: boolean;
  /** True when prunable. */
  prunable: boolean;
};

export type GitWorktreesResult = {
  available: boolean;
  worktrees: GitWorktreeEntry[];
  reason?: string | null;
  /** Absolute `~/.grok` for CLI-aligned worktree placement / badge detection. */
  cliGrokHome?: string | null;
};

/** Normalize path for comparison (slash direction, no trailing slash). */
export function normalizeWorktreePath(path: string | null | undefined): string {
  const p = (path ?? "").trim().replace(/\\/g, "/");
  if (!p) return "";
  // Keep Windows drive letter case; strip trailing slashes.
  return p.replace(/\/+$/, "") || p;
}

export function pathsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeWorktreePath(a).toLowerCase();
  const nb = normalizeWorktreePath(b).toLowerCase();
  return !!na && na === nb;
}

/**
 * Parse `git worktree list --porcelain` stdout into entries.
 * Blocks are separated by blank lines; first block is the main worktree.
 */
export function parseWorktreePorcelain(raw: string): GitWorktreeEntry[] {
  const text = (raw ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return [];

  const blocks = text.split(/\n\n+/);
  const out: GitWorktreeEntry[] = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi].trim();
    if (!block) continue;

    let path = "";
    let head: string | null = null;
    let branch: string | null = null;
    let detached = false;
    let locked = false;
    let prunable = false;

    for (const line of block.split("\n")) {
      const t = line.trimEnd();
      if (t.startsWith("worktree ")) {
        path = t.slice("worktree ".length).trim();
      } else if (t.startsWith("HEAD ")) {
        head = t.slice("HEAD ".length).trim() || null;
      } else if (t.startsWith("branch ")) {
        const ref = t.slice("branch ".length).trim();
        branch = ref.startsWith("refs/heads/")
          ? ref.slice("refs/heads/".length)
          : ref || null;
      } else if (t === "detached") {
        detached = true;
      } else if (t.startsWith("locked")) {
        locked = true;
      } else if (t.startsWith("prunable")) {
        prunable = true;
      }
    }

    path = normalizeWorktreePath(path);
    if (!path) continue;

    out.push({
      path,
      head,
      branch: detached ? null : branch,
      detached,
      isMain: bi === 0 || out.length === 0,
      locked,
      prunable,
    });
  }

  // Ensure only first is main
  return out.map((w, i) => ({ ...w, isMain: i === 0 }));
}

/** Short label for UI: branch name, or last path segment. */
export function worktreeLabel(wt: GitWorktreeEntry): string {
  if (wt.branch?.trim()) return wt.branch.trim();
  if (wt.detached) {
    const base = wt.path.split("/").filter(Boolean).pop() || wt.path;
    return wt.head ? `${base} @ ${wt.head.slice(0, 7)}` : base;
  }
  return wt.path.split("/").filter(Boolean).pop() || wt.path;
}

/** Worktrees other than the current project path (for switch list). */
export function siblingWorktrees(
  worktrees: GitWorktreeEntry[],
  currentPath: string | null | undefined,
): GitWorktreeEntry[] {
  return worktrees.filter((w) => !pathsEqual(w.path, currentPath));
}

/** Find worktree matching path, if any. */
export function findWorktreeAt(
  worktrees: GitWorktreeEntry[],
  path: string | null | undefined,
): GitWorktreeEntry | null {
  return worktrees.find((w) => pathsEqual(w.path, path)) ?? null;
}

/**
 * Apply `git status` branch onto the cached worktree list used by the
 * composer branch chip.
 *
 * In-place `git checkout` / `git switch` does not change the project path, so
 * the porcelain list stays stale until the menu is opened. The dirty-status
 * poll already has the live branch — patch the matching row instead of
 * waiting for a click.
 *
 * Returns the same array when nothing changed (skip setState).
 */
export function applyGitStatusBranch(
  worktrees: GitWorktreeEntry[],
  projectPath: string | null | undefined,
  status:
    | { available?: boolean | null; branch?: string | null }
    | null
    | undefined,
): GitWorktreeEntry[] {
  if (!worktrees.length || !status?.available) return worktrees;
  const nextBranch = (status.branch ?? "").trim() || null;
  const detached = !nextBranch;
  let changed = false;
  const next = worktrees.map((wt) => {
    if (!pathsEqual(wt.path, projectPath)) return wt;
    if ((wt.branch ?? null) === nextBranch && wt.detached === detached) {
      return wt;
    }
    changed = true;
    return { ...wt, branch: nextBranch, detached };
  });
  return changed ? next : worktrees;
}

/**
 * Resolve a path to a {@link GitWorktreeEntry} for session bind / switch.
 *
 * Prefers a porcelain list match (branch / main flags intact). When the path
 * is absolute but not listed, returns a detached synthetic entry so callers
 * can still `project_add` + bind without inventing a branch name.
 * Empty / non-absolute-looking empty paths → `null`.
 */
export function worktreeEntryForPath(
  path: string | null | undefined,
  worktrees?: GitWorktreeEntry[] | null,
): GitWorktreeEntry | null {
  const p = normalizeWorktreePath(path);
  if (!p) return null;
  const hit = findWorktreeAt(worktrees ?? [], p);
  if (hit) return hit;
  return {
    path: p,
    head: null,
    branch: null,
    detached: true,
    isMain: false,
    locked: false,
    prunable: false,
  };
}

/**
 * Sanitize optional `--expire` / max-age for `git worktree prune`.
 * Mirrors host `sanitize_worktree_gc_max_age`.
 */
export function sanitizeWorktreeGcMaxAge(
  raw: string | null | undefined,
): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (s.length > 64) throw new Error("max-age too long");
  if (s.startsWith("-")) throw new Error("max-age must not start with '-'");
  if (/[\0\n\r\s]/.test(s)) throw new Error("invalid max-age");
  if (!/^[A-Za-z0-9._]+$/.test(s)) {
    throw new Error("max-age may only contain letters, digits, '.' and '_'");
  }
  return s;
}

/**
 * Build argv for `git worktree prune` (no binary name).
 * Mirrors host `build_worktree_gc_args` — pure; unit-tested.
 *
 * `git [-C project] worktree prune -v [--dry-run] [--expire <age>]`
 * - force without maxAge → `--expire now`
 */
export function buildWorktreeGcArgs(
  projectPath: string,
  dryRun: boolean,
  force = false,
  maxAge?: string | null,
): string[] {
  const project = normalizeWorktreePath(projectPath);
  if (!project) throw new Error("empty path");
  if (project.startsWith("-")) throw new Error("invalid project path");

  let expire: string | null = null;
  try {
    expire = sanitizeWorktreeGcMaxAge(maxAge);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
  if (!expire && force) expire = "now";

  const args = ["-C", project, "worktree", "prune", "-v"];
  if (dryRun) args.push("--dry-run");
  if (expire) {
    args.push("--expire", expire);
  }
  return args;
}

/** Best-effort count of removal-like lines in prune -v output. */
export function countWorktreePruneLines(output: string | null | undefined): number {
  const text = output ?? "";
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => {
      const lower = l.toLowerCase();
      return (
        lower.includes("remov") ||
        lower.includes("prun") ||
        lower.startsWith("would ")
      );
    }).length;
}

/**
 * Sanitize worktree / new-branch name for `git worktree add -b <name>`.
 * Mirrors host `sanitize_worktree_name`.
 */
export function sanitizeWorktreeName(raw: string | null | undefined): string {
  const name = (raw ?? "").trim();
  if (!name) {
    throw new Error("worktree name is required");
  }
  if (name === "." || name === "..") {
    throw new Error("invalid worktree name");
  }
  if (name.length > 64) {
    throw new Error("worktree name too long (max 64)");
  }
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error("worktree name must not contain path separators");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(
      "worktree name may only contain letters, digits, '.', '_' and '-'",
    );
  }
  if (name.startsWith("-")) {
    throw new Error("worktree name must not start with '-'");
  }
  return name;
}

/**
 * Path placement strategy for new linked worktrees.
 *
 * - `cli` (default): Grok Build CLI layout
 *   `{GROK_HOME}/worktrees/<repo-basename>/<name>`
 *   (CLI 0.2.x uses `~/.grok/worktrees/<repo>/…` for `--worktree` / subagents).
 * - `sibling`: classic git UX next to the main checkout
 *   `<parent>/<main_basename>-<name>`
 */
export type WorktreeLayout = "cli" | "sibling";

/** Normalize layout id; unknown / empty → `cli` (CLI-aligned default). */
export function normalizeWorktreeLayout(
  raw: string | null | undefined,
): WorktreeLayout {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "sibling") return "sibling";
  return "cli";
}

/**
 * Optional commit-ish / branch start-point for `git worktree add`.
 * Mirrors host `sanitize_worktree_ref` (single argv element; no flags).
 * Empty → `null` (use HEAD).
 */
export function sanitizeWorktreeRef(
  raw: string | null | undefined,
): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (s.length > 256) {
    throw new Error("branch / ref too long");
  }
  if (s.includes("\0") || s.includes("\n") || s.includes("\r")) {
    throw new Error("invalid branch / ref");
  }
  if (s.startsWith("-")) {
    throw new Error("branch / ref must not start with '-'");
  }
  return s;
}

/** Last non-empty path segment (repo folder / worktree slug). */
export function worktreeRepoSlug(
  mainWorktreePath: string | null | undefined,
): string {
  const main = normalizeWorktreePath(mainWorktreePath);
  if (!main) {
    throw new Error("empty main worktree path");
  }
  const base = main.split("/").filter(Boolean).pop();
  if (!base) {
    throw new Error("cannot derive repo folder name");
  }
  return base;
}

/**
 * Shared CLI home root from a user home directory.
 * Example: `/Users/me` → `/Users/me/.grok`.
 */
export function grokHomeFromUserHome(
  userHome: string | null | undefined,
): string {
  const home = normalizeWorktreePath(userHome);
  if (!home) {
    throw new Error("empty user home");
  }
  return normalizeWorktreePath(`${home}/.grok`);
}

/**
 * CLI worktrees root: `{GROK_HOME}/worktrees`.
 * Accepts either a full GROK_HOME or a user home (when `opts.fromUserHome`).
 */
export function cliWorktreesHome(
  grokOrUserHome: string | null | undefined,
  opts?: { fromUserHome?: boolean },
): string {
  const root = opts?.fromUserHome
    ? grokHomeFromUserHome(grokOrUserHome)
    : normalizeWorktreePath(grokOrUserHome);
  if (!root) {
    throw new Error("empty grok home");
  }
  return normalizeWorktreePath(`${root}/worktrees`);
}

/**
 * CLI-aligned path layout (host + UI preview):
 *   `{GROK_HOME}/worktrees/<main_basename>/<name>`
 *
 * Example: grokHome `/Users/me/.grok`, main `/Users/me/Code/oss-grok-app`,
 * name `feat` → `/Users/me/.grok/worktrees/oss-grok-app/feat`.
 *
 * Matches Grok Build 0.2.x (`grok --worktree=…`, `grok worktree list`).
 */
export function buildWorktreeCliPath(
  mainWorktreePath: string | null | undefined,
  name: string | null | undefined,
  grokHome: string | null | undefined,
): string {
  const main = normalizeWorktreePath(mainWorktreePath);
  if (!main) {
    throw new Error("empty main worktree path");
  }
  const safe = sanitizeWorktreeName(name);
  const slug = worktreeRepoSlug(main);
  const home = normalizeWorktreePath(grokHome);
  if (!home) {
    throw new Error("empty grok home");
  }
  const out = normalizeWorktreePath(
    `${cliWorktreesHome(home)}/${slug}/${safe}`,
  );
  if (!out || pathsEqual(out, main)) {
    throw new Error("resolved worktree path is invalid");
  }
  return out;
}

/**
 * Sibling path layout (host + UI preview):
 *   `<parent>/<main_basename>-<name>`
 *
 * Example: main `/Users/me/repo` + `feat` → `/Users/me/repo-feat`.
 *
 * Optional alternative to CLI home layout — keeps checkouts next to the
 * primary clone (common bare `git worktree add ../repo-feat` practice).
 */
export function buildWorktreeSiblingPath(
  mainWorktreePath: string | null | undefined,
  name: string | null | undefined,
): string {
  const main = normalizeWorktreePath(mainWorktreePath);
  if (!main) {
    throw new Error("empty main worktree path");
  }
  const safe = sanitizeWorktreeName(name);
  // Split keeps leading "" for absolute Unix paths: "/Users/me/repo" → ["", "Users", "me", "repo"]
  const parts = main.split("/");
  const base = parts.filter(Boolean).pop();
  if (!base) {
    throw new Error("cannot derive repo folder name");
  }
  const parentParts = parts.slice(0, -1);
  const parentJoined = parentParts.join("/");
  const parent =
    parentParts.length === 0
      ? ""
      : parentJoined === "" && main.startsWith("/")
        ? "/"
        : parentJoined;
  const dirName = `${base}-${safe}`;
  const joined =
    parent === "/"
      ? `/${dirName}`
      : parent
        ? `${parent}/${dirName}`
        : dirName;
  const out = normalizeWorktreePath(joined);
  if (!out || pathsEqual(out, main)) {
    throw new Error("resolved worktree path is invalid");
  }
  return out;
}

/**
 * Resolve create path for the chosen layout.
 * `grokHome` is required for `cli` (absolute `~/.grok` or override).
 */
export function buildWorktreePath(
  layout: WorktreeLayout | string | null | undefined,
  mainWorktreePath: string | null | undefined,
  name: string | null | undefined,
  grokHome?: string | null,
): string {
  const kind = normalizeWorktreeLayout(layout);
  if (kind === "sibling") {
    return buildWorktreeSiblingPath(mainWorktreePath, name);
  }
  return buildWorktreeCliPath(mainWorktreePath, name, grokHome);
}

/**
 * True when `path` sits under a CLI worktrees home.
 *
 * With `grokHome`: strict prefix under `{grokHome}/worktrees/`.
 * Without: heuristic match on `/.grok/worktrees/` (or Windows `\`).
 */
export function isUnderCliWorktreesHome(
  path: string | null | undefined,
  grokHome?: string | null,
): boolean {
  const p = normalizeWorktreePath(path);
  if (!p) return false;
  const home = normalizeWorktreePath(grokHome);
  if (home) {
    const root = cliWorktreesHome(home);
    if (pathsEqual(p, root)) return true;
    const prefix = root.endsWith("/") ? root : `${root}/`;
    // Case-fold for Windows drive paths.
    const pCmp = /^[a-zA-Z]:\//.test(p) ? p.toLowerCase() : p;
    const prefixCmp = /^[a-zA-Z]:\//.test(prefix) ? prefix.toLowerCase() : prefix;
    return pCmp.startsWith(prefixCmp);
  }
  // Heuristic: …/.grok/worktrees/… (POSIX or Windows separators already normalized).
  return /(?:^|\/)\.grok\/worktrees(?:\/|$)/i.test(p);
}

/**
 * True when `path` looks like a sibling of `main` built as
 * `<parent>/<main_basename>-<name>` (not under CLI home).
 */
export function isSiblingWorktreePath(
  path: string | null | undefined,
  mainWorktreePath: string | null | undefined,
): boolean {
  const p = normalizeWorktreePath(path);
  const main = normalizeWorktreePath(mainWorktreePath);
  if (!p || !main || pathsEqual(p, main)) return false;
  if (isUnderCliWorktreesHome(p)) return false;
  let slug: string;
  try {
    slug = worktreeRepoSlug(main);
  } catch {
    return false;
  }
  const base = p.split("/").filter(Boolean).pop() || "";
  if (!base.startsWith(`${slug}-`)) return false;
  const parentMain = main.includes("/")
    ? main.slice(0, main.lastIndexOf("/")) || "/"
    : "";
  const parentPath = p.includes("/")
    ? p.slice(0, p.lastIndexOf("/")) || "/"
    : "";
  return pathsEqual(parentMain, parentPath);
}

/**
 * Classify a worktree path for sidebar / tooltips.
 * Prefer CLI home detection; then sibling-of-main; else `other`.
 */
export function detectWorktreeLayoutKind(
  path: string | null | undefined,
  mainWorktreePath?: string | null,
  grokHome?: string | null,
): "cli" | "sibling" | "other" {
  if (isUnderCliWorktreesHome(path, grokHome)) return "cli";
  if (mainWorktreePath && isSiblingWorktreePath(path, mainWorktreePath)) {
    return "sibling";
  }
  return "other";
}

/** Main worktree path from a porcelain list (first entry), if any. */
export function mainWorktreePath(
  worktrees: GitWorktreeEntry[],
): string | null {
  if (!worktrees.length) return null;
  const main = worktrees.find((w) => w.isMain) ?? worktrees[0];
  return main?.path ?? null;
}

/**
 * Whether a worktree may be removed from the UI.
 * Main / primary checkout is never removable (matches host refuse_remove_main).
 */
export function canRemoveWorktree(
  wt: GitWorktreeEntry | null | undefined,
): boolean {
  return !!wt && !wt.isMain;
}

/**
 * Heuristic: `git worktree remove` failed because the tree is dirty / locked
 * and may succeed with `--force`.
 */
export function worktreeRemoveErrorSuggestsForce(
  message: string | null | undefined,
): boolean {
  const m = (message ?? "").toLowerCase();
  if (!m) return false;
  return (
    m.includes("--force") ||
    m.includes("use -f") ||
    m.includes("modified or untracked") ||
    m.includes("contains modified") ||
    m.includes("is dirty") ||
    m.includes("not empty") ||
    m.includes("uncommitted") ||
    m.includes("locked")
  );
}

/** Session index fields that mark a chat as worktree-bound. */
export type SessionWorktreeMeta = {
  worktreePath?: string | null;
  worktreeBranch?: string | null;
  isWorktreeSession?: boolean;
};

/** Compact sidebar badge + path/branch for tooltip and manage actions. */
export type SessionWorktreeBadge = {
  /**
   * Compact chip text: `"CLI"` under `~/.grok/worktrees`, else `"WT"`
   * (sibling / other linked worktrees).
   */
  label: string;
  /** Absolute worktree path when known. */
  path: string;
  /** Branch name without refs/heads/, or null if detached / unknown. */
  branch: string | null;
  /** True when meta marks the session or path matches a non-main linked worktree. */
  fromMeta: boolean;
  /** True when path matched a non-main entry in the porcelain list. */
  fromGitList: boolean;
  /** Path placement: CLI home vs sibling-of-main vs other. */
  layoutKind: "cli" | "sibling" | "other";
};

/** Linked (non-main) worktrees only — main checkout is not a "WT session". */
export function isLinkedWorktreeEntry(
  wt: GitWorktreeEntry | null | undefined,
): boolean {
  return !!wt && !wt.isMain;
}

/**
 * Resolve whether a session should show a worktree badge.
 *
 * Prefer explicit session meta; fall back to project path matching a non-main
 * entry from `git worktree list` when meta was never written.
 */
export function resolveSessionWorktreeBadge(
  meta: SessionWorktreeMeta | null | undefined,
  projectPath: string | null | undefined,
  worktrees: GitWorktreeEntry[] | null | undefined,
  opts?: { grokHome?: string | null },
): SessionWorktreeBadge | null {
  const metaPath = normalizeWorktreePath(meta?.worktreePath);
  const fromMeta = !!(meta?.isWorktreeSession || metaPath);
  const list = worktrees ?? [];
  const atMeta = metaPath ? findWorktreeAt(list, metaPath) : null;
  const atProject = findWorktreeAt(list, projectPath);
  const linkedList =
    (atMeta && isLinkedWorktreeEntry(atMeta) ? atMeta : null) ||
    (isLinkedWorktreeEntry(atProject) ? atProject : null);
  const fromGitList = !!linkedList;

  if (!fromMeta && !fromGitList) return null;

  const path =
    metaPath ||
    normalizeWorktreePath(linkedList?.path) ||
    normalizeWorktreePath(projectPath);
  if (!path && !fromMeta) return null;

  const branch =
    (meta?.worktreeBranch || "").trim() ||
    linkedList?.branch?.trim() ||
    atProject?.branch?.trim() ||
    null;

  const mainPath = mainWorktreePath(list);
  const layoutKind = detectWorktreeLayoutKind(
    path,
    mainPath,
    opts?.grokHome,
  );

  return {
    label: sessionWorktreeBadgeLabel(layoutKind),
    path,
    branch: branch || null,
    fromMeta,
    fromGitList,
    layoutKind,
  };
}

/**
 * Compact badge text for the session list.
 * CLI home worktrees → `CLI`; sibling / other linked → `WT`.
 */
export function sessionWorktreeBadgeLabel(
  layoutKind?: "cli" | "sibling" | "other" | null,
): string {
  return layoutKind === "cli" ? "CLI" : "WT";
}

/**
 * Tooltip / aria body: layout + branch + path when available.
 */
export function sessionWorktreeTooltip(
  badge: Pick<SessionWorktreeBadge, "path" | "branch" | "layoutKind">,
  opts?: {
    detachedLabel?: string;
    cliLayoutLabel?: string;
    siblingLayoutLabel?: string;
    otherLayoutLabel?: string;
  },
): string {
  const detached = (opts?.detachedLabel || "detached").trim() || "detached";
  const branch = (badge.branch || "").trim() || detached;
  const path = normalizeWorktreePath(badge.path);
  const layoutLabel =
    badge.layoutKind === "cli"
      ? (opts?.cliLayoutLabel || "CLI worktrees home").trim()
      : badge.layoutKind === "sibling"
        ? (opts?.siblingLayoutLabel || "Sibling worktree").trim()
        : (opts?.otherLayoutLabel || "Worktree").trim();
  const lines = [layoutLabel, branch];
  if (path) lines.push(path);
  return lines.join("\n");
}
