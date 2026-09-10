import { describe, expect, it } from "vitest";
import {
  branchCheckedOutElsewhere,
  buildGitSwitchArgs,
  capGitBranchesForMenu,
  classifyGitSwitchError,
  gitSwitchFailMessage,
  filterGitBranches,
  GIT_BRANCH_MENU_CAP,
  isRemoteHeadRef,
  localNameFromRemoteRef,
  mergeGitBranchLists,
  parseGitBranchForEachRef,
  sanitizeGitBranchName,
  sortGitBranches,
  type GitBranchEntry,
} from "./gitBranches";

const LOCAL_RAW = `\
*\tmain\tabc1234\torigin/main\t/Users/me/repo
\tfeat/login\tdef5678\torigin/feat/login\t
\tfix-ci\t111aaaa\t\t/Users/me/repo-fix
`;

const REMOTE_RAW = `\
origin/HEAD\tabcdef0
origin/main\tabc1234
origin/feat/login\tdef5678
origin/new-remote\t999bbbb
upstream/only-there\t888cccc
`;

describe("sanitizeGitBranchName", () => {
  it("accepts hierarchical names", () => {
    expect(sanitizeGitBranchName("  feat/login  ")).toBe("feat/login");
    expect(sanitizeGitBranchName("origin/main")).toBe("origin/main");
  });

  it("rejects flags and git-magic", () => {
    expect(() => sanitizeGitBranchName("")).toThrow(/required/);
    expect(() => sanitizeGitBranchName("-b")).toThrow(/start with/);
    expect(() => sanitizeGitBranchName("foo bar")).toThrow(/invalid/);
    expect(() => sanitizeGitBranchName("foo..bar")).toThrow(/invalid/);
    expect(() => sanitizeGitBranchName("foo@{u}")).toThrow(/invalid/);
    expect(() => sanitizeGitBranchName("foo~1")).toThrow(/invalid/);
  });
});

describe("parseGitBranchForEachRef", () => {
  it("parses local porcelain-ish rows including current and elsewhere", () => {
    const list = parseGitBranchForEachRef(LOCAL_RAW, "local");
    expect(list.map((b) => b.name)).toEqual(["main", "feat/login", "fix-ci"]);
    expect(list[0]).toMatchObject({
      current: true,
      remote: false,
      upstream: "origin/main",
      worktreePath: "/Users/me/repo",
    });
    expect(list[1].current).toBe(false);
    expect(list[1].worktreePath).toBeNull();
    expect(list[2].worktreePath).toBe("/Users/me/repo-fix");
  });

  it("skips remote HEAD and keeps origin/feat rows", () => {
    const list = parseGitBranchForEachRef(REMOTE_RAW, "remote");
    expect(list.every((b) => b.remote)).toBe(true);
    expect(list.map((b) => b.name)).toEqual([
      "origin/main",
      "origin/feat/login",
      "origin/new-remote",
      "upstream/only-there",
    ]);
  });
});

describe("mergeGitBranchLists", () => {
  it("keeps remote-only names that have no local counterpart", () => {
    const local = parseGitBranchForEachRef(LOCAL_RAW, "local");
    const remote = parseGitBranchForEachRef(REMOTE_RAW, "remote");
    const merged = mergeGitBranchLists(local, remote);
    expect(merged.filter((b) => !b.remote).map((b) => b.name)).toEqual([
      "main",
      "feat/login",
      "fix-ci",
    ]);
    expect(merged.filter((b) => b.remote).map((b) => b.name)).toEqual([
      "origin/new-remote",
      "upstream/only-there",
    ]);
  });
});

describe("filter / sort / cap", () => {
  it("filters by name or upstream", () => {
    const local = parseGitBranchForEachRef(LOCAL_RAW, "local");
    expect(filterGitBranches(local, "login").map((b) => b.name)).toEqual([
      "feat/login",
    ]);
    expect(filterGitBranches(local, "ORIGIN/MAIN").map((b) => b.name)).toEqual([
      "main",
    ]);
  });

  it("sorts current first, remotes last", () => {
    const rows: GitBranchEntry[] = [
      { name: "z", current: false, remote: true },
      { name: "a", current: false, remote: false },
      { name: "main", current: true, remote: false },
    ];
    expect(sortGitBranches(rows).map((b) => b.name)).toEqual(["main", "a", "z"]);
  });

  it("caps the menu list with an honest overflow", () => {
    const many: GitBranchEntry[] = Array.from({ length: GIT_BRANCH_MENU_CAP + 5 }, (_, i) => ({
      name: `b${i}`,
      current: false,
      remote: false,
    }));
    const cap = capGitBranchesForMenu(many);
    expect(cap.rows).toHaveLength(GIT_BRANCH_MENU_CAP);
    expect(cap.truncated).toBe(true);
    expect(cap.total).toBe(GIT_BRANCH_MENU_CAP + 5);
  });
});

describe("branchCheckedOutElsewhere", () => {
  it("is true only when another worktree holds the branch", () => {
    const row: GitBranchEntry = {
      name: "fix-ci",
      current: false,
      remote: false,
      worktreePath: "/Users/me/repo-fix",
    };
    expect(branchCheckedOutElsewhere(row, "/Users/me/repo")).toBe(true);
    expect(branchCheckedOutElsewhere(row, "/Users/me/repo-fix")).toBe(false);
    expect(
      branchCheckedOutElsewhere({ ...row, current: true }, "/Users/me/repo"),
    ).toBe(false);
  });
});

describe("classifyGitSwitchError", () => {
  it("classifies dirty / elsewhere / missing", () => {
    expect(
      classifyGitSwitchError(
        "error: Your local changes to the following files would be overwritten by checkout:\n\tfoo.ts\nPlease commit your changes or stash them before you switch branches.",
      ).kind,
    ).toBe("dirty");
    const elseR = classifyGitSwitchError(
      "fatal: 'feat' is already used by worktree at '/tmp/repo-feat'\n",
    );
    expect(elseR.kind).toBe("elsewhere");
    expect(elseR.worktreePath).toBe("/tmp/repo-feat");
    expect(classifyGitSwitchError("fatal: invalid reference: nosuch").kind).toBe(
      "not_found",
    );
  });
});

describe("buildGitSwitchArgs", () => {
  it("builds local switch and remote --track argv", () => {
    expect(buildGitSwitchArgs("/Users/me/repo", "feat/login")).toEqual([
      "-C",
      "/Users/me/repo",
      "switch",
      "feat/login",
    ]);
    expect(
      buildGitSwitchArgs("/Users/me/repo", "new-remote", "origin/new-remote"),
    ).toEqual([
      "-C",
      "/Users/me/repo",
      "switch",
      "--track",
      "origin/new-remote",
    ]);
  });

  it("refuses flag-like names", () => {
    expect(() => buildGitSwitchArgs("/repo", "-b")).toThrow();
  });
});

describe("gitSwitchFailMessage", () => {
  const tr = (key: string) => key;
  it("maps kinds onto i18n keys", () => {
    expect(gitSwitchFailMessage(tr as never, "dirty")).toBe(
      "composer.branchFail.dirty",
    );
    expect(gitSwitchFailMessage(tr as never, "elsewhere", null, "/wt")).toBe(
      "composer.branchFail.elsewhere",
    );
    expect(gitSwitchFailMessage(tr as never, "failed", "boom")).toBe("boom");
  });
});

describe("localNameFromRemoteRef / isRemoteHeadRef", () => {
  it("strips the remote prefix", () => {
    expect(localNameFromRemoteRef("origin/feat/x")).toBe("feat/x");
    expect(localNameFromRemoteRef("main")).toBe("main");
  });
  it("detects remote HEAD", () => {
    expect(isRemoteHeadRef("origin/HEAD")).toBe(true);
    expect(isRemoteHeadRef("HEAD")).toBe(true);
    expect(isRemoteHeadRef("origin/main")).toBe(false);
  });
});
