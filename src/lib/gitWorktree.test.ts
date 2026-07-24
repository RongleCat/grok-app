import { describe, expect, it } from "vitest";
import {
  findWorktreeAt,
  normalizeWorktreePath,
  parseWorktreePorcelain,
  pathsEqual,
  siblingWorktrees,
  worktreeLabel,
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
