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
