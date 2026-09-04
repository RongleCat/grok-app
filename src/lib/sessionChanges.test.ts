import { describe, expect, it } from "vitest";
import {
  buildUnifiedDiff,
  changeListKey,
  countLineDelta,
  isEditToolKind,
  EMPTY_SESSION_FILE_CHANGES,
  mergeSessionChange,
  nextChangeListKey,
  normalizePath,
  parseChangeListKey,
  pathBaseName,
  pathRelativeToProject,
  resolveSessionChangePath,
  sessionChangesFromMessages,
  sessionFileLineDelta,
  summarizeSessionChanges,
  type SessionFileChange,
} from "./sessionChanges";
import type { ChatMessage } from "./session";

describe("normalizePath", () => {
  it("unifies separators and strips trailing slash", () => {
    expect(normalizePath("a\\b\\c\\")).toBe("a/b/c");
    expect(normalizePath("/tmp/foo/")).toBe("/tmp/foo");
    expect(normalizePath("/")).toBe("/");
  });

  it("collapses duplicate slashes", () => {
    expect(normalizePath("/tmp//foo///bar")).toBe("/tmp/foo/bar");
  });

  it("trims whitespace", () => {
    expect(normalizePath("  /x/y  ")).toBe("/x/y");
  });
});

describe("pathBaseName / relative", () => {
  it("basename", () => {
    expect(pathBaseName("/a/b/c.ts")).toBe("c.ts");
    expect(pathBaseName("c.ts")).toBe("c.ts");
  });

  it("relative under project", () => {
    expect(
      pathRelativeToProject("/Users/me/proj/src/a.ts", "/Users/me/proj"),
    ).toBe("src/a.ts");
    expect(pathRelativeToProject("/other/x", "/Users/me/proj")).toBe(
      "/other/x",
    );
  });
});

describe("isEditToolKind", () => {
  it("recognizes write / replace / edit family", () => {
    expect(isEditToolKind("write")).toBe(true);
    expect(isEditToolKind("search_replace")).toBe(true);
    expect(isEditToolKind("str_replace")).toBe(true);
    expect(isEditToolKind("apply_patch")).toBe(true);
    expect(isEditToolKind("create_file")).toBe(true);
    expect(isEditToolKind("delete_file")).toBe(true);
    expect(isEditToolKind("Write")).toBe(true);
  });

  it("rejects read / search / shell", () => {
    expect(isEditToolKind("read")).toBe(false);
    expect(isEditToolKind("bash")).toBe(false);
    expect(isEditToolKind("grep")).toBe(false);
    expect(isEditToolKind("")).toBe(false);
  });
});

describe("resolveSessionChangePath", () => {
  it("prefers explicit path", () => {
    expect(
      resolveSessionChangePath({ path: "/a/b.ts", input: "/other.ts" }),
    ).toBe("/a/b.ts");
  });

  it("promotes relative and absolute file paths from input (#998)", () => {
    expect(
      resolveSessionChangePath({
        path: "",
        input: ".grok-app-998-mvp-b.txt",
      }),
    ).toBe(".grok-app-998-mvp-b.txt");
    expect(
      resolveSessionChangePath({
        path: null,
        input: "/Users/me/proj/src/a.ts",
      }),
    ).toBe("/Users/me/proj/src/a.ts");
  });

  it("rejects shell-like input", () => {
    expect(
      resolveSessionChangePath({ path: "", input: "ls -la && echo hi" }),
    ).toBe("");
  });
});

describe("EMPTY_SESSION_FILE_CHANGES", () => {
  it("is a stable empty list for memo identity", () => {
    expect(EMPTY_SESSION_FILE_CHANGES).toEqual([]);
    expect(EMPTY_SESSION_FILE_CHANGES).toBe(EMPTY_SESSION_FILE_CHANGES);
    expect(EMPTY_SESSION_FILE_CHANGES ?? []).toBe(EMPTY_SESSION_FILE_CHANGES);
  });
});

describe("mergeSessionChange", () => {
  it("ignores non-edit tools and empty paths", () => {
    expect(
      mergeSessionChange([], {
        kind: "read",
        path: "/a.ts",
        status: "completed",
      }),
    ).toEqual([]);
    expect(
      mergeSessionChange([], {
        kind: "write",
        path: "",
        status: "completed",
      }),
    ).toEqual([]);
  });

  it("accepts write path from input when path is empty", () => {
    const list = mergeSessionChange([], {
      kind: "write",
      path: "",
      input: ".grok-app-998-mvp-b.txt",
      status: "completed",
      after: "hello",
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.path).toBe(".grok-app-998-mvp-b.txt");
    expect(list[0]?.after).toBe("hello");
  });

  it("upserts by normalized path and moves to front", () => {
    let list: SessionFileChange[] = [];
    list = mergeSessionChange(list, {
      toolCallId: "t1",
      kind: "write",
      path: "/proj/a.ts",
      status: "in_progress",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    list = mergeSessionChange(list, {
      toolCallId: "t2",
      kind: "search_replace",
      path: "/proj\\b.ts",
      status: "completed",
      after: "hello",
      updatedAt: "2026-01-01T00:01:00.000Z",
    });
    expect(list).toHaveLength(2);
    expect(list[0]?.path).toBe("/proj/b.ts");
    expect(list[0]?.after).toBe("hello");

    // Update a.ts again — should move to front, preserve identity of b
    list = mergeSessionChange(list, {
      toolCallId: "t3",
      kind: "write",
      path: "/proj/a.ts",
      status: "completed",
      after: "new a",
      updatedAt: "2026-01-01T00:02:00.000Z",
    });
    expect(list).toHaveLength(2);
    expect(list[0]?.path).toBe("/proj/a.ts");
    expect(list[0]?.after).toBe("new a");
    expect(list[0]?.status).toBe("completed");
    expect(list[1]?.path).toBe("/proj/b.ts");
  });

  it("keeps earlier before when later event only has after", () => {
    let list = mergeSessionChange([], {
      kind: "str_replace",
      path: "/f.ts",
      status: "completed",
      before: "old",
      after: "mid",
    });
    list = mergeSessionChange(list, {
      kind: "write",
      path: "/f.ts",
      status: "completed",
      after: "new",
    });
    expect(list[0]?.before).toBe("old");
    expect(list[0]?.after).toBe("new");
  });
});

describe("sessionChangesFromMessages", () => {
  it("builds from tool_step rows with paths", () => {
    const messages: ChatMessage[] = [
      {
        id: "tool-1",
        role: "tool",
        content: "tool_step|completed|write|Write foo\ndetail\n/tmp/foo.ts",
        marker: "tool_step",
        toolKind: "write",
        toolPath: "/tmp/foo.ts",
        toolStatus: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "tool-2",
        role: "tool",
        content: "tool_step|completed|read|Read bar\n/tmp/bar.ts",
        marker: "tool_step",
        toolKind: "read",
        toolPath: "/tmp/bar.ts",
        toolStatus: "completed",
      },
    ];
    const changes = sessionChangesFromMessages(messages);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.path).toBe("/tmp/foo.ts");
    expect(changes[0]?.toolKind).toBe("write");
  });

  it("builds from assistant-woven edit tool segments (#998)", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: "done",
        segments: [
          {
            kind: "tool",
            toolCallId: "t1",
            title: "Write",
            toolKind: "write",
            status: "completed",
            path: ".grok-app-998-mvp-b.txt",
          },
          {
            kind: "tool",
            toolCallId: "t2",
            title: "Read",
            toolKind: "read",
            status: "completed",
            path: "README.md",
          },
        ],
      },
    ];
    const changes = sessionChangesFromMessages(messages);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.path).toBe(".grok-app-998-mvp-b.txt");
  });
});

describe("buildUnifiedDiff", () => {
  it("produces unified headers and +/- lines", () => {
    const d = buildUnifiedDiff(
      "a.ts",
      "line1\nline2\nline3\n",
      "line1\nline2-changed\nline3\n",
    );
    expect(d).toContain("--- a/a.ts");
    expect(d).toContain("+++ b/a.ts");
    expect(d).toContain("-line2");
    expect(d).toContain("+line2-changed");
  });
});

describe("countLineDelta", () => {
  it("counts replacements as remove + add", () => {
    expect(countLineDelta("a\nb\nc\n", "a\nB\nc\n")).toEqual({
      added: 1,
      removed: 1,
    });
  });

  it("counts pure additions and deletions", () => {
    expect(countLineDelta("a\n", "a\nb\nc\n")).toEqual({
      added: 2,
      removed: 0,
    });
    expect(countLineDelta("a\nb\nc\n", "a\n")).toEqual({
      added: 0,
      removed: 2,
    });
  });

  it("returns zeros when identical", () => {
    expect(countLineDelta("same\n", "same\n")).toEqual({
      added: 0,
      removed: 0,
    });
  });
});

describe("summarizeSessionChanges", () => {
  const base = (
    partial: Partial<SessionFileChange> & Pick<SessionFileChange, "path">,
  ): SessionFileChange => ({
    name: partial.path.split("/").pop() || partial.path,
    toolKind: "write",
    status: "completed",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  });

  it("returns null for empty list (hide chip)", () => {
    expect(summarizeSessionChanges([])).toBeNull();
  });

  it("files mode when no before/after content", () => {
    const s = summarizeSessionChanges([
      base({ path: "/a.ts" }),
      base({ path: "/b.ts" }),
    ]);
    expect(s).toEqual({
      fileCount: 2,
      addedLines: null,
      removedLines: null,
      mode: "files",
    });
  });

  it("diff mode when at least one file has before+after", () => {
    const s = summarizeSessionChanges([
      base({ path: "/a.ts", before: "x\n", after: "x\ny\n" }),
      base({ path: "/b.ts" }), // no snippets — still counted as a file
      base({
        path: "/c.ts",
        before: "old\nline\n",
        after: "new\nline\n",
      }),
    ]);
    expect(s).not.toBeNull();
    expect(s!.fileCount).toBe(3);
    expect(s!.mode).toBe("diff");
    // a: +1; c: −1 +1
    expect(s!.addedLines).toBe(2);
    expect(s!.removedLines).toBe(1);
  });

  it("diff mode with zero line delta still prefers +0 −0", () => {
    const s = summarizeSessionChanges([
      base({ path: "/same.ts", before: "x\n", after: "x\n" }),
    ]);
    expect(s).toEqual({
      fileCount: 1,
      addedLines: 0,
      removedLines: 0,
      mode: "diff",
    });
  });
});

describe("sessionFileLineDelta", () => {
  it("returns null when before or after is missing", () => {
    expect(sessionFileLineDelta({})).toBeNull();
    expect(sessionFileLineDelta({ before: "a\n" })).toBeNull();
    expect(sessionFileLineDelta({ after: "b\n" })).toBeNull();
  });

  it("counts per-file line delta", () => {
    expect(
      sessionFileLineDelta({ before: "a\nb\n", after: "a\nc\nd\n" }),
    ).toEqual({ added: 2, removed: 1 });
  });
});

describe("changeListKey / nextChangeListKey", () => {
  const KEYS = [
    changeListKey("session", "/a.ts"),
    changeListKey("session", "/b.ts"),
    changeListKey("workspace", "src/c.ts"),
  ] as const;

  it("builds and parses stable keys", () => {
    expect(changeListKey("session", "/proj\\x.ts")).toBe("session:/proj/x.ts");
    expect(parseChangeListKey("session:/proj/x.ts")).toEqual({
      source: "session",
      path: "/proj/x.ts",
    });
    expect(parseChangeListKey("workspace:src/c.ts")).toEqual({
      source: "workspace",
      path: "src/c.ts",
    });
    expect(parseChangeListKey("bogus")).toBeNull();
  });

  it("navigates j/k style with clamp at ends", () => {
    expect(nextChangeListKey(KEYS, KEYS[0], "next")).toBe(KEYS[1]);
    expect(nextChangeListKey(KEYS, KEYS[2], "next")).toBe(KEYS[2]);
    expect(nextChangeListKey(KEYS, KEYS[1], "prev")).toBe(KEYS[0]);
    expect(nextChangeListKey(KEYS, KEYS[0], "prev")).toBe(KEYS[0]);
    expect(nextChangeListKey(KEYS, null, "next")).toBe(KEYS[0]);
    expect(nextChangeListKey(KEYS, null, "prev")).toBe(KEYS[2]);
    expect(nextChangeListKey([], "x", "next")).toBeNull();
  });
});
