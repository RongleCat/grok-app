import { describe, expect, it } from "vitest";
import {
  buildWorktreeGcArgs,
  buildWorktreeSiblingPath,
  canRemoveWorktree,
  countWorktreePruneLines,
  findWorktreeAt,
  isLinkedWorktreeEntry,
  mainWorktreePath,
  normalizeWorktreePath,
  parseWorktreePorcelain,
  pathsEqual,
  resolveSessionWorktreeBadge,
  sanitizeWorktreeGcMaxAge,
  sanitizeWorktreeName,
  sessionWorktreeBadgeLabel,
  sessionWorktreeTooltip,
  siblingWorktrees,
  worktreeLabel,
  worktreeRemoveErrorSuggestsForce,
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

describe("worktree path builder", () => {
  it("sanitizes names", () => {
    expect(sanitizeWorktreeName("  feat-x  ")).toBe("feat-x");
    expect(sanitizeWorktreeName("v1.2_rc")).toBe("v1.2_rc");
    expect(() => sanitizeWorktreeName("")).toThrow(/required/);
    expect(() => sanitizeWorktreeName("a/b")).toThrow(/separator/);
    expect(() => sanitizeWorktreeName("-lead")).toThrow(/start/);
    expect(() => sanitizeWorktreeName("has space")).toThrow();
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
  it("labels compact badge as WT", () => {
    expect(sessionWorktreeBadgeLabel()).toBe("WT");
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
    expect(badge!.path).toBe("/Users/me/repo-feat");
    expect(badge!.branch).toBe("feat/x");
    expect(badge!.fromMeta).toBe(true);
    expect(badge!.fromGitList).toBe(false);
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

  it("builds tooltip with branch and path", () => {
    expect(
      sessionWorktreeTooltip({ path: "/Users/me/repo-feat", branch: "feat/x" }),
    ).toBe("feat/x\n/Users/me/repo-feat");
    expect(
      sessionWorktreeTooltip(
        { path: "/Users/me/repo-feat", branch: null },
        { detachedLabel: "detached" },
      ),
    ).toBe("detached\n/Users/me/repo-feat");
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
