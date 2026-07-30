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
 * Sibling path layout (host + UI preview):
 *   `<parent>/<main_basename>-<name>`
 *
 * Example: main `/Users/me/repo` + `feat` → `/Users/me/repo-feat`.
 *
 * Prefer sibling of the **main** worktree over in-repo `.worktrees/<name>`
 * so linked checkouts sit next to the primary clone (common git worktree UX).
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
  /** Always `"WT"` for the compact sidebar chip. */
  label: string;
  /** Absolute worktree path when known. */
  path: string;
  /** Branch name without refs/heads/, or null if detached / unknown. */
  branch: string | null;
  /** True when meta marks the session or path matches a non-main linked worktree. */
  fromMeta: boolean;
  /** True when path matched a non-main entry in the porcelain list. */
  fromGitList: boolean;
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

  return {
    label: sessionWorktreeBadgeLabel(),
    path,
    branch: branch || null,
    fromMeta,
    fromGitList,
  };
}

/** Compact badge text for the session list. */
export function sessionWorktreeBadgeLabel(): string {
  return "WT";
}

/**
 * Tooltip / aria body: branch + path on two lines when both exist.
 */
export function sessionWorktreeTooltip(
  badge: Pick<SessionWorktreeBadge, "path" | "branch">,
  opts?: { detachedLabel?: string },
): string {
  const detached = (opts?.detachedLabel || "detached").trim() || "detached";
  const branch = (badge.branch || "").trim() || detached;
  const path = normalizeWorktreePath(badge.path);
  if (path) return `${branch}\n${path}`;
  return branch;
}
