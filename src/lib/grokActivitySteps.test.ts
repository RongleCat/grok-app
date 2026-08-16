import { describe, expect, it } from "vitest";
import type { MessageToolSegment } from "./session";
import {
  buildGrokActivitySteps,
  extractBrowseUrl,
  type GrokPhaseItem,
} from "./grokActivitySteps";

function tool(
  id: string,
  kind: string,
  title: string,
  extra: Partial<MessageToolSegment> = {},
): MessageToolSegment {
  return {
    kind: "tool",
    toolCallId: id,
    title,
    toolKind: kind,
    status: "completed",
    streaming: false,
    ...extra,
  };
}

describe("grokActivitySteps", () => {
  it("interleaves thoughts and tools in stream order", () => {
    const items: GrokPhaseItem[] = [
      { kind: "thought", text: "**调研** 流程" },
      { kind: "tool", tool: tool("s1", "web_search", "Search A") },
      { kind: "tool", tool: tool("s2", "web_search", "Search B") },
      { kind: "thought", text: "Verifying China-specific registration" },
      {
        kind: "tool",
        tool: tool("b1", "web_fetch", "Fetch", {
          path: "https://developer.apple.com/cn/programs/enroll/",
        }),
      },
    ];
    const steps = buildGrokActivitySteps(items);
    // Queries present → individual “Searched web for” rows (≤3)
    expect(steps.map((s) => s.type)).toEqual([
      "thought",
      "web-search",
      "web-search",
      "thought",
      "browse",
    ]);
    expect(steps[1]).toMatchObject({ type: "web-search", query: "Search A" });
    expect(steps[4]).toMatchObject({
      type: "browse",
      url: "developer.apple.com/cn/programs/enroll/",
    });
  });

  it("collapses consecutive searches without queries into Ran N", () => {
    const items: GrokPhaseItem[] = [
      { kind: "tool", tool: tool("a", "web_search", "Web search:") },
      { kind: "tool", tool: tool("b", "web_search", "Web search:") },
      { kind: "tool", tool: tool("c", "web_search", "Web search:") },
      { kind: "tool", tool: tool("d", "web_search", "Web search:") },
    ];
    const steps = buildGrokActivitySteps(items);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ type: "search-group", count: 4 });
  });

  it("does not mark tools running when the message is no longer streaming", () => {
    const items: GrokPhaseItem[] = [
      {
        kind: "tool",
        tool: tool("t1", "read_file", "Read", {
          status: "in_progress",
          streaming: true,
        }),
      },
      {
        kind: "tool",
        tool: tool("t2", "edit_file", "Edit", {
          status: "running",
          streaming: true,
        }),
      },
    ];
    const live = buildGrokActivitySteps(items, { messageStreaming: true });
    expect(live.every((s) => "running" in s && s.running)).toBe(true);
    const done = buildGrokActivitySteps(items, { messageStreaming: false });
    expect(done.every((s) => "running" in s && !s.running)).toBe(true);
  });

  it("emits Searched web for when each search has a query", () => {
    const items: GrokPhaseItem[] = [
      {
        kind: "tool",
        tool: tool("a", "web_search", "Web search: 个人苹果开发者账号"),
      },
      {
        kind: "tool",
        tool: tool("b", "web_search", "Web search: Apple Developer Program"),
      },
    ];
    const steps = buildGrokActivitySteps(items);
    expect(steps.map((s) => s.type)).toEqual(["web-search", "web-search"]);
    expect(steps[0]).toMatchObject({
      type: "web-search",
      query: "个人苹果开发者账号",
    });
  });

  it("uses hollow-circle tool rows for non-search tools", () => {
    const items: GrokPhaseItem[] = [
      {
        kind: "tool",
        tool: tool("t1", "run_terminal_command", "Draft intro", {
          detail: "echo hello",
        }),
      },
    ];
    const steps = buildGrokActivitySteps(items);
    expect(steps[0]!.type).toBe("tool");
  });

  it("tags typed bucket + pathBase from machine tool names (history rows)", () => {
    const items: GrokPhaseItem[] = [
      {
        kind: "tool",
        tool: tool("r1", "read_file", "read_file", {
          detail: "1→<!DOCTYPE html>\nraw skill body…",
          input: "/Users/me/.agents/skills/content-infographic/SKILL.md",
        }),
      },
      {
        kind: "tool",
        tool: tool("l1", "list_dir", "list_dir", {
          detail: "- /Users/me/proj/\n  - src",
          input: "/Users/me/proj/workbuddy",
        }),
      },
      {
        kind: "tool",
        tool: tool("t1", "run_terminal_command", "run_terminal_command", {
          detail: "exit: 0\ntotal 176",
          input: "ls -la \"/Users/me/proj\" 2>/dev/null; find \"/Users/me/proj\" -maxdepth 3 -type f",
        }),
      },
      {
        kind: "tool",
        tool: tool("w1", "search_replace", "search_replace", {
          detail: "The file /Users/me/proj/src/main.ts …",
          input: "/Users/me/proj/src/main.ts",
        }),
      },
    ];
    const steps = buildGrokActivitySteps(items);
    // First two (read_file + list_dir) are a context burst → one explore-group;
    // bash + edit break the run and stay individual rows.
    expect(steps.map((s) => s.type)).toEqual(["explore-group", "tool", "tool"]);
    const grp = steps[0] as Extract<
      (typeof steps)[number],
      { type: "explore-group" }
    >;
    expect(grp.reads).toBe(2);
    expect(grp.searches).toBe(0);
    const kids = grp.children.filter((s) => s.type === "tool");
    expect(kids[0]).toMatchObject({ bucket: "read", inputLabel: "SKILL.md" });
    expect(kids[1]).toMatchObject({ bucket: "read", inputLabel: "workbuddy" });
    expect(steps[1]).toMatchObject({ bucket: "bash" });
    // bash input = first simple command, clipped, whitespace collapsed
    expect((steps[1] as any).inputLabel).toContain("ls -la");
    expect((steps[2] as any).inputLabel).toBe("main.ts");
    expect(steps[2]).toMatchObject({ bucket: "edit" });
    // Raw tool OUTPUT must never leak into the collapsed label.
    for (const s of [...kids, steps[1], steps[2]]) {
      expect(s && s.type === "tool" ? (s as any).summary : "").not.toContain(
        "exit:",
      );
      expect(s && s.type === "tool" ? (s as any).summary : "").not.toContain(
        "<!DOCTYPE",
      );
    }
  });

  it("extractBrowseUrl keeps directory trailing slash like Grok web", () => {
    expect(
      extractBrowseUrl(
        tool("b", "web_fetch", "x", {
          path: "https://developer.apple.com/cn/help/account/",
        }),
      ),
    ).toBe("developer.apple.com/cn/help/account/");
  });
});

describe("grokActivitySteps explore-group", () => {
  it("folds a mixed read+search burst into one explore-group", () => {
    const items: GrokPhaseItem[] = [
      { kind: "tool", tool: tool("r1", "read_file", "Read", { input: "a.ts" }) },
      { kind: "tool", tool: tool("s1", "web_search", "Search A") },
      { kind: "tool", tool: tool("r2", "read_file", "Read", { input: "b.ts" }) },
    ];
    const steps = buildGrokActivitySteps(items);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.type).toBe("explore-group");
    const grp = steps[0] as Extract<
      (typeof steps)[number],
      { type: "explore-group" }
    >;
    expect(grp.searches).toBe(1);
    expect(grp.reads).toBe(2);
    // Children are the individual leaf steps (no nested grouping).
    expect(grp.children.length).toBe(3);
    expect(grp.children.some((s) => s.type === "web-search")).toBe(true);
    expect(grp.children.filter((s) => s.type === "tool").length).toBe(2);
  });

  it("does not collapse a pure-search run (keeps Ran N searches)", () => {
    const items: GrokPhaseItem[] = [
      { kind: "tool", tool: tool("s1", "web_search", "Search A") },
      { kind: "tool", tool: tool("s2", "web_search", "Search B") },
      { kind: "tool", tool: tool("s3", "web_search", "Search C") },
      { kind: "tool", tool: tool("s4", "web_search", "Search D") },
    ];
    const steps = buildGrokActivitySteps(items);
    // 4 searches with no query text → single search-group, NOT explore-group.
    expect(steps).toHaveLength(1);
    expect(steps[0]!.type).toBe("search-group");
  });

  it("a single read followed by an edit does not become an explore group", () => {
    const items: GrokPhaseItem[] = [
      { kind: "tool", tool: tool("r1", "read_file", "Read", { input: "a.ts" }) },
      { kind: "tool", tool: tool("e1", "search_replace", "Edit", { input: "a.ts" }) },
    ];
    const steps = buildGrokActivitySteps(items);
    // edit breaks the context run → two individual rows, no group.
    expect(steps.map((s) => s.type)).toEqual(["tool", "tool"]);
  });

  it("folds consecutive bash / edit bursts and keeps speech as its own step", () => {
    const items: GrokPhaseItem[] = [
      { kind: "speech", text: "先核对仓库。" },
      {
        kind: "tool",
        tool: tool("b1", "run_terminal_command", "Run", { input: "ls" }),
      },
      {
        kind: "tool",
        tool: tool("b2", "run_terminal_command", "Run", { input: "pwd" }),
      },
      {
        kind: "tool",
        tool: tool("b3", "run_terminal_command", "Run", { input: "git status" }),
      },
      { kind: "speech", text: "接着改两处。" },
      {
        kind: "tool",
        tool: tool("e1", "search_replace", "Edit", { input: "a.ts" }),
      },
      {
        kind: "tool",
        tool: tool("e2", "search_replace", "Edit", { input: "b.ts" }),
      },
    ];
    const steps = buildGrokActivitySteps(items);
    expect(steps.map((s) => s.type)).toEqual([
      "speech",
      "bash-group",
      "speech",
      "edit-group",
    ]);
    expect(steps[1]).toMatchObject({ type: "bash-group", count: 3 });
    expect(steps[3]).toMatchObject({ type: "edit-group", count: 2 });
  });

  it("browse breaks an explore run (keeps its own Browsed row)", () => {
    const items: GrokPhaseItem[] = [
      { kind: "tool", tool: tool("r1", "read_file", "Read", { input: "a.ts" }) },
      {
        kind: "tool",
        tool: tool("b1", "web_fetch", "Fetch", {
          path: "https://example.com/page",
        }),
      },
      { kind: "tool", tool: tool("r2", "read_file", "Read", { input: "b.ts" }) },
    ];
    const steps = buildGrokActivitySteps(items);
    // First read is alone (< threshold) → individual; browse → browse; last read → individual.
    expect(steps.map((s) => s.type)).toEqual(["tool", "browse", "tool"]);
  });
});
