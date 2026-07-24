import { describe, expect, it } from "vitest";
import {
  classifyGitStatusCode,
  classifyGitStatusString,
  filterWorkspaceGitEntries,
  isSafeDiscardCandidate,
  normalizeWorkspaceGitEntries,
  normalizeWorkspaceGitEntry,
  resolveWorkspaceAbsolutePath,
  workspaceGitKindBadge,
  workspaceGitKindMessageKey,
  type WorkspaceGitFile,
} from "./workspaceGit";

describe("classifyGitStatusCode / String", () => {
  it("classifies common porcelain codes", () => {
    expect(classifyGitStatusCode(" ", "M")).toBe("modified");
    expect(classifyGitStatusCode("M", " ")).toBe("modified");
    expect(classifyGitStatusCode("A", " ")).toBe("added");
    expect(classifyGitStatusCode(" ", "D")).toBe("deleted");
    expect(classifyGitStatusCode("?", "?")).toBe("untracked");
    expect(classifyGitStatusCode("R", " ")).toBe("renamed");
    expect(classifyGitStatusCode("U", "U")).toBe("conflict");
    expect(classifyGitStatusCode("!", "!")).toBe("ignored");
  });

  it("parses two-char status strings", () => {
    expect(classifyGitStatusString(" M")).toBe("modified");
    expect(classifyGitStatusString("??")).toBe("untracked");
    expect(classifyGitStatusString("MM")).toBe("modified");
    expect(classifyGitStatusString("A ")).toBe("added");
  });
});

describe("normalizeWorkspaceGitEntry", () => {
  it("fills abs path from project + relative", () => {
    const e = normalizeWorkspaceGitEntry(
      {
        path: "src/a.ts",
        status: " M",
        indexStatus: " ",
        worktreeStatus: "M",
        kind: "modified",
        name: "a.ts",
      },
      "/Users/me/proj",
    );
    expect(e).not.toBeNull();
    expect(e!.path).toBe("src/a.ts");
    expect(e!.absolutePath).toBe("/Users/me/proj/src/a.ts");
    expect(e!.kind).toBe("modified");
    expect(e!.name).toBe("a.ts");
  });

  it("reclassifies when kind missing", () => {
    const e = normalizeWorkspaceGitEntry({
      path: "x.md",
      status: "??",
    });
    expect(e!.kind).toBe("untracked");
  });

  it("drops empty paths and dedupes", () => {
    expect(normalizeWorkspaceGitEntry({ path: "" })).toBeNull();
    const list = normalizeWorkspaceGitEntries([
      { path: "a.ts", status: " M", kind: "modified" },
      { path: "a.ts", status: "M ", kind: "modified" },
      { path: "b.ts", status: "??", kind: "untracked" },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]!.path).toBe("a.ts");
    expect(list[1]!.path).toBe("b.ts");
  });
});

describe("filterWorkspaceGitEntries", () => {
  const sample: WorkspaceGitFile[] = [
    {
      path: "src/app.ts",
      absolutePath: "/p/src/app.ts",
      status: " M",
      indexStatus: " ",
      worktreeStatus: "M",
      kind: "modified",
      name: "app.ts",
    },
    {
      path: "README.md",
      absolutePath: "/p/README.md",
      status: "??",
      indexStatus: "?",
      worktreeStatus: "?",
      kind: "untracked",
      name: "README.md",
    },
  ];

  it("filters by name / path / kind", () => {
    expect(filterWorkspaceGitEntries(sample, "app")).toHaveLength(1);
    expect(filterWorkspaceGitEntries(sample, "untracked")).toHaveLength(1);
    expect(filterWorkspaceGitEntries(sample, "  ")).toHaveLength(2);
    expect(filterWorkspaceGitEntries(sample, "zzz")).toHaveLength(0);
  });
});

describe("resolveWorkspaceAbsolutePath", () => {
  it("joins project + relative", () => {
    expect(resolveWorkspaceAbsolutePath("/proj", "src/a.ts")).toBe(
      "/proj/src/a.ts",
    );
  });

  it("keeps already-absolute paths", () => {
    expect(resolveWorkspaceAbsolutePath("/proj", "/abs/x.ts")).toBe(
      "/abs/x.ts",
    );
  });
});

describe("labels / badge / discard", () => {
  it("message key + badge", () => {
    expect(workspaceGitKindMessageKey("modified")).toBe(
      "changes.workspace.kind.modified",
    );
    expect(workspaceGitKindBadge("untracked")).toBe("U");
    expect(workspaceGitKindBadge("conflict")).toBe("!");
  });

  it("safe discard only for unstaged tracked dirty worktree", () => {
    expect(
      isSafeDiscardCandidate({
        path: "a.ts",
        absolutePath: "/p/a.ts",
        status: " M",
        indexStatus: " ",
        worktreeStatus: "M",
        kind: "modified",
        name: "a.ts",
      }),
    ).toBe(true);
    expect(
      isSafeDiscardCandidate({
        path: "a.ts",
        absolutePath: "/p/a.ts",
        status: "M ",
        indexStatus: "M",
        worktreeStatus: " ",
        kind: "modified",
        name: "a.ts",
      }),
    ).toBe(false);
    expect(
      isSafeDiscardCandidate({
        path: "n.ts",
        absolutePath: "/p/n.ts",
        status: "??",
        indexStatus: "?",
        worktreeStatus: "?",
        kind: "untracked",
        name: "n.ts",
      }),
    ).toBe(false);
  });
});
