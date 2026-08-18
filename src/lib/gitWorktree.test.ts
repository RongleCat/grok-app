import { describe, expect, it } from "vitest";
import {
  applyGitStatusBranch,
  buildWorktreeCliPath,
  buildWorktreeGcArgs,
  buildWorktreePath,
  buildWorktreeSiblingPath,
  canRemoveWorktree,
  cliWorktreesHome,
  countWorktreePruneLines,
  detectWorktreeLayoutKind,
  findWorktreeAt,
  grokHomeFromUserHome,
  isLinkedWorktreeEntry,
  isSiblingWorktreePath,
  isUnderCliWorktreesHome,
  mainWorktreePath,
  normalizeWorktreeLayout,
  normalizeWorktreePath,
  parseWorktreePorcelain,
  pathsEqual,
  resolveSessionWorktreeBadge,
  sanitizeWorktreeGcMaxAge,
  sanitizeWorktreeName,
  sanitizeWorktreeRef,
  sessionWorktreeBadgeLabel,
  sessionWorktreeTooltip,
  siblingWorktrees,
  worktreeEntryForPath,
  worktreeLabel,
  worktreeRemoveErrorSuggestsForce,
  worktreeRepoSlug,
} from "./gitWorktree";

const SAMPLE = `worktree /Users/me/repo
HEAD abcdef0123456789
branch refs/heads/main

worktree /Users/me/repo-feat
HEAD fedcba9876543210
branch refs/heads/feat/x

worktree /Users/me/repo-detached
HEAD 1111222233334444
detached
`;

describe("parseWorktreePorcelain", () => {
  it("parses main + linked worktrees", () => {
    const list = parseWorktreePorcelain(SAMPLE);
    expect(list).toHaveLength(3);
    expect(list[0].path).toBe("/Users/me/repo");
    expect(list[0].branch).toBe("main");
    expect(list[0].isMain).toBe(true);
    expect(list[0].detached).toBe(false);

    expect(list[1].path).toBe("/Users/me/repo-feat");
    expect(list[1].branch).toBe("feat/x");
    expect(list[1].isMain).toBe(false);

    expect(list[2].detached).toBe(true);
    expect(list[2].branch).toBeNull();
  });

  it("returns empty for blank input", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
    expect(parseWorktreePorcelain("\n\n")).toEqual([]);
  });
});

describe("path helpers", () => {
  it("normalizes and compares paths", () => {
    expect(normalizeWorktreePath("/a/b/")).toBe("/a/b");
    expect(pathsEqual("/a/b", "/a/b/")).toBe(true);
    expect(pathsEqual("/a/b", "/a/c")).toBe(false);
  });

  it("labels prefer branch names", () => {
    const list = parseWorktreePorcelain(SAMPLE);
    expect(worktreeLabel(list[0])).toBe("main");
    expect(worktreeLabel(list[1])).toBe("feat/x");
    expect(worktreeLabel(list[2])).toContain("repo-detached");
  });

  it("siblings exclude current path", () => {
    const list = parseWorktreePorcelain(SAMPLE);
    const sib = siblingWorktrees(list, "/Users/me/repo");
    expect(sib.map((w) => w.path)).toEqual([
      "/Users/me/repo-feat",
      "/Users/me/repo-detached",
    ]);
    expect(findWorktreeAt(list, "/Users/me/repo-feat")?.branch).toBe("feat/x");
  });
});

describe("applyGitStatusBranch", () => {
  it("updates the matching worktree after an in-place checkout", () => {
    const cached = parseWorktreePorcelain(SAMPLE);
    expect(worktreeLabel(cached[0])).toBe("main");

    // Repro: agent / user `git switch feat/x` in the same cwd. Path is
    // unchanged so the porcelain cache still says `main` until the chip is
    // clicked. git status already has the live branch.
    const next = applyGitStatusBranch(cached, "/Users/me/repo/", {
      available: true,
      branch: "feat/x",
    });
    expect(next).not.toBe(cached);
    expect(worktreeLabel(next[0])).toBe("feat/x");
    expect(next[0].detached).toBe(false);
    expect(next[1].branch).toBe("feat/x");
    expect(worktreeLabel(cached[0])).toBe("main");
  });

  it("marks detached when git status reports no branch (HEAD)", () => {
    const cached = parseWorktreePorcelain(SAMPLE);
    const next = applyGitStatusBranch(cached, "/Users/me/repo", {
      available: true,
      branch: null,
    });
    expect(next[0].branch).toBeNull();
    expect(next[0].detached).toBe(true);
    expect(worktreeLabel(next[0])).toContain("repo");
  });

  it("does not invent a row when the path is missing from the cache", () => {
    const cached = parseWorktreePorcelain(SAMPLE);
    const next = applyGitStatusBranch(cached, "/tmp/other", {
      available: true,
      branch: "master",
    });
    expect(next).toBe(cached);
  });

  it("keeps the cache when git status is unavailable or the branch matches", () => {
    const cached = parseWorktreePorcelain(SAMPLE);
    expect(
      applyGitStatusBranch(cached, "/Users/me/repo", {
        available: false,
        branch: "feat/x",
      }),
    ).toBe(cached);
    expect(applyGitStatusBranch(cached, "/Users/me/repo", null)).toBe(cached);
    expect(
      applyGitStatusBranch(cached, "/Users/me/repo", {
        available: true,
        branch: "main",
      }),
    ).toBe(cached);
    expect(applyGitStatusBranch([], "/Users/me/repo", {
      available: true,
      branch: "main",
    })).toEqual([]);
  });
});

describe("path helpers (entry resolve)", () => {
  it("worktreeEntryForPath prefers porcelain match, else synthetic", () => {
    const list = parseWorktreePorcelain(SAMPLE);
    const hit = worktreeEntryForPath("/Users/me/repo-feat/", list);
    expect(hit?.path).toBe("/Users/me/repo-feat");
    expect(hit?.branch).toBe("feat/x");
    expect(hit?.isMain).toBe(false);

    const synth = worktreeEntryForPath(
      "/Users/me/.grok/worktrees/app/sub-a",
      list,
    );
    expect(synth).toEqual({
      path: "/Users/me/.grok/worktrees/app/sub-a",
      head: null,
      branch: null,
      detached: true,
      isMain: false,
      locked: false,
      prunable: false,
    });

    expect(worktreeEntryForPath("", list)).toBeNull();
    expect(worktreeEntryForPath("   ")).toBeNull();
    expect(worktreeEntryForPath(null)).toBeNull();
  });
});

describe("worktree path builder", () => {
  it("sanitizes names", () => {
    expect(sanitizeWorktreeName("  feat-x  ")).toBe("feat-x");
    expect(sanitizeWorktreeName("v1.2_rc")).toBe("v1.2_rc");
    expect(() => sanitizeWorktreeName("")).toThrow(/required/);
    expect(() => sanitizeWorktreeName("a/b")).toThrow(/separator/);
    expect(() => sanitizeWorktreeName("-lead")).toThrow(/start/);
    expect(() => sanitizeWorktreeName("has space")).toThrow();
  });

  it("sanitizes optional start refs", () => {
    expect(sanitizeWorktreeRef("  main  ")).toBe("main");
    expect(sanitizeWorktreeRef("origin/main")).toBe("origin/main");
    expect(sanitizeWorktreeRef("")).toBeNull();
    expect(sanitizeWorktreeRef(null)).toBeNull();
    expect(() => sanitizeWorktreeRef("-b")).toThrow(/start/);
    expect(() => sanitizeWorktreeRef("a\nb")).toThrow(/invalid/);
  });

  it("normalizes layout ids (default cli)", () => {
    expect(normalizeWorktreeLayout(undefined)).toBe("cli");
    expect(normalizeWorktreeLayout("")).toBe("cli");
    expect(normalizeWorktreeLayout("CLI")).toBe("cli");
    expect(normalizeWorktreeLayout("sibling")).toBe("sibling");
    expect(normalizeWorktreeLayout("other")).toBe("cli");
  });

  it("builds sibling path next to main worktree", () => {
    expect(buildWorktreeSiblingPath("/Users/me/repo", "feat")).toBe(
      "/Users/me/repo-feat",
    );
    expect(buildWorktreeSiblingPath("/Users/me/repo/", "hot-fix")).toBe(
      "/Users/me/repo-hot-fix",
    );
    expect(mainWorktreePath(parseWorktreePorcelain(SAMPLE))).toBe(
      "/Users/me/repo",
    );
    // Path preview uses main even when active cwd is a linked worktree.
    const main = mainWorktreePath(parseWorktreePorcelain(SAMPLE))!;
    expect(buildWorktreeSiblingPath(main, "new")).toBe("/Users/me/repo-new");
  });

  it("builds CLI home path under ~/.grok/worktrees/<repo>/<name>", () => {
    expect(grokHomeFromUserHome("/Users/me")).toBe("/Users/me/.grok");
    expect(cliWorktreesHome("/Users/me/.grok")).toBe(
      "/Users/me/.grok/worktrees",
    );
    expect(cliWorktreesHome("/Users/me", { fromUserHome: true })).toBe(
      "/Users/me/.grok/worktrees",
    );
    expect(worktreeRepoSlug("/Users/me/Code/oss-grok-app")).toBe(
      "oss-grok-app",
    );
    expect(
      buildWorktreeCliPath(
        "/Users/me/Code/oss-grok-app",
        "feat",
        "/Users/me/.grok",
      ),
    ).toBe("/Users/me/.grok/worktrees/oss-grok-app/feat");
    expect(
      buildWorktreePath(
        "cli",
        "/Users/me/repo",
        "hot-fix",
        "/Users/me/.grok",
      ),
    ).toBe("/Users/me/.grok/worktrees/repo/hot-fix");
    expect(buildWorktreePath("sibling", "/Users/me/repo", "feat")).toBe(
      "/Users/me/repo-feat",
    );
  });

  it("detects CLI home vs sibling paths", () => {
    expect(
      isUnderCliWorktreesHome(
        "/Users/me/.grok/worktrees/oss-grok-app/feat",
        "/Users/me/.grok",
      ),
    ).toBe(true);
    expect(
      isUnderCliWorktreesHome("/Users/me/.grok/worktrees/oss-grok-app/feat"),
    ).toBe(true);
    expect(isUnderCliWorktreesHome("/Users/me/repo-feat")).toBe(false);
    expect(isSiblingWorktreePath("/Users/me/repo-feat", "/Users/me/repo")).toBe(
      true,
    );
    expect(
      isSiblingWorktreePath(
        "/Users/me/.grok/worktrees/repo/feat",
        "/Users/me/repo",
      ),
    ).toBe(false);
    expect(
      detectWorktreeLayoutKind(
        "/Users/me/.grok/worktrees/repo/feat",
        "/Users/me/repo",
      ),
    ).toBe("cli");
    expect(
      detectWorktreeLayoutKind("/Users/me/repo-feat", "/Users/me/repo"),
    ).toBe("sibling");
    expect(detectWorktreeLayoutKind("/tmp/other-wt", "/Users/me/repo")).toBe(
      "other",
    );
  });
});

describe("canRemoveWorktree", () => {
  it("allows linked worktrees only", () => {
    const list = parseWorktreePorcelain(SAMPLE);
    expect(canRemoveWorktree(list[0])).toBe(false);
    expect(canRemoveWorktree(list[1])).toBe(true);
    expect(canRemoveWorktree(list[2])).toBe(true);
    expect(canRemoveWorktree(null)).toBe(false);
    expect(canRemoveWorktree(undefined)).toBe(false);
  });
});

describe("session worktree badge helpers", () => {
  it("labels CLI home as CLI and sibling as WT", () => {
    expect(sessionWorktreeBadgeLabel()).toBe("WT");
    expect(sessionWorktreeBadgeLabel("sibling")).toBe("WT");
    expect(sessionWorktreeBadgeLabel("other")).toBe("WT");
    expect(sessionWorktreeBadgeLabel("cli")).toBe("CLI");
  });

  it("detects linked (non-main) worktree entries", () => {
    const list = parseWorktreePorcelain(SAMPLE);
    expect(isLinkedWorktreeEntry(list[0])).toBe(false);
    expect(isLinkedWorktreeEntry(list[1])).toBe(true);
    expect(isLinkedWorktreeEntry(null)).toBe(false);
  });

  it("badges from session meta even without git list", () => {
    const badge = resolveSessionWorktreeBadge(
      {
        isWorktreeSession: true,
        worktreePath: "/Users/me/repo-feat",
        worktreeBranch: "feat/x",
      },
      "/Users/me/repo-feat",
      [],
    );
    expect(badge).not.toBeNull();
    expect(badge!.label).toBe("WT");
    expect(badge!.layoutKind).toBe("other");
    expect(badge!.path).toBe("/Users/me/repo-feat");
    expect(badge!.branch).toBe("feat/x");
    expect(badge!.fromMeta).toBe(true);
    expect(badge!.fromGitList).toBe(false);
  });

  it("badges CLI-home meta with CLI label", () => {
    const badge = resolveSessionWorktreeBadge(
      {
        isWorktreeSession: true,
        worktreePath: "/Users/me/.grok/worktrees/repo/feat",
        worktreeBranch: "feat",
      },
      "/Users/me/.grok/worktrees/repo/feat",
      [],
      { grokHome: "/Users/me/.grok" },
    );
    expect(badge).not.toBeNull();
    expect(badge!.label).toBe("CLI");
    expect(badge!.layoutKind).toBe("cli");
  });

  it("falls back to git list when project path is a linked worktree", () => {
    const list = parseWorktreePorcelain(SAMPLE);
    const badge = resolveSessionWorktreeBadge(
      {},
      "/Users/me/repo-feat/",
      list,
    );
    expect(badge).not.toBeNull();
    expect(badge!.label).toBe("WT");
    expect(badge!.layoutKind).toBe("sibling");
    expect(pathsEqual(badge!.path, "/Users/me/repo-feat")).toBe(true);
    expect(badge!.branch).toBe("feat/x");
    expect(badge!.fromMeta).toBe(false);
    expect(badge!.fromGitList).toBe(true);
  });

  it("does not badge main worktree path without meta", () => {
    const list = parseWorktreePorcelain(SAMPLE);
    expect(
      resolveSessionWorktreeBadge({}, "/Users/me/repo", list),
    ).toBeNull();
    expect(resolveSessionWorktreeBadge({}, "/other", list)).toBeNull();
    expect(resolveSessionWorktreeBadge(null, null, list)).toBeNull();
  });

  it("builds tooltip with layout, branch and path", () => {
    expect(
      sessionWorktreeTooltip({
        path: "/Users/me/repo-feat",
        branch: "feat/x",
        layoutKind: "sibling",
      }),
    ).toBe("Sibling worktree\nfeat/x\n/Users/me/repo-feat");
    expect(
      sessionWorktreeTooltip(
        {
          path: "/Users/me/.grok/worktrees/repo/feat",
          branch: null,
          layoutKind: "cli",
        },
        {
          detachedLabel: "detached",
          cliLayoutLabel: "CLI home",
        },
      ),
    ).toBe("CLI home\ndetached\n/Users/me/.grok/worktrees/repo/feat");
  });
});

describe("worktreeRemoveErrorSuggestsForce", () => {
  it("detects dirty / force hints from git", () => {
    expect(
      worktreeRemoveErrorSuggestsForce(
        "fatal: '/tmp/repo-feat' contains modified or untracked files, use --force to delete it",
      ),
    ).toBe(true);
    expect(worktreeRemoveErrorSuggestsForce("use -f to delete")).toBe(true);
    expect(worktreeRemoveErrorSuggestsForce("worktree is locked")).toBe(true);
    expect(worktreeRemoveErrorSuggestsForce("not a worktree")).toBe(false);
    expect(worktreeRemoveErrorSuggestsForce("")).toBe(false);
  });
});

describe("worktree gc arg builder", () => {
  it("sanitizes max-age", () => {
    expect(sanitizeWorktreeGcMaxAge("  now  ")).toBe("now");
    expect(sanitizeWorktreeGcMaxAge("2.weeks.ago")).toBe("2.weeks.ago");
    expect(sanitizeWorktreeGcMaxAge("")).toBeNull();
    expect(sanitizeWorktreeGcMaxAge(null)).toBeNull();
    expect(() => sanitizeWorktreeGcMaxAge("-n")).toThrow(/start/);
    expect(() => sanitizeWorktreeGcMaxAge("2 weeks")).toThrow(/invalid/);
    expect(() => sanitizeWorktreeGcMaxAge("a;rm")).toThrow();
  });

  it("builds dry-run argv", () => {
    expect(buildWorktreeGcArgs("/Users/me/repo", true, false)).toEqual([
      "-C",
      "/Users/me/repo",
      "worktree",
      "prune",
      "-v",
      "--dry-run",
    ]);
  });

  it("maps force to --expire now", () => {
    expect(buildWorktreeGcArgs("/Users/me/repo", false, true)).toEqual([
      "-C",
      "/Users/me/repo",
      "worktree",
      "prune",
      "-v",
      "--expire",
      "now",
    ]);
  });

  it("prefers explicit maxAge over force", () => {
    expect(
      buildWorktreeGcArgs("/Users/me/repo", true, true, "3.months"),
    ).toEqual([
      "-C",
      "/Users/me/repo",
      "worktree",
      "prune",
      "-v",
      "--dry-run",
      "--expire",
      "3.months",
    ]);
  });

  it("rejects empty / option-like project path", () => {
    expect(() => buildWorktreeGcArgs("", false)).toThrow(/empty/);
    expect(() => buildWorktreeGcArgs("-C", false)).toThrow(/invalid/);
  });

  it("counts prune verbose lines", () => {
    expect(
      countWorktreePruneLines(
        "Removing worktrees/stale: gitdir file points to non-existent location\n",
      ),
    ).toBe(1);
    expect(countWorktreePruneLines("Would remove worktrees/foo\n")).toBe(1);
    expect(countWorktreePruneLines("")).toBe(0);
  });
});
