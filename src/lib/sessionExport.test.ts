import { describe, expect, it } from "vitest";
import {
  formatToolSummaryLine,
  sessionExportFilename,
  sessionExportJsonFilename,
  sessionToJson,
  sessionToMarkdown,
} from "./sessionExport";

describe("sessionToMarkdown", () => {
  it("builds a title, meta block, and role sections", () => {
    const md = sessionToMarkdown({
      title: "Doctor reset",
      projectName: "grok-app",
      projectPath: "/tmp/grok-app",
      sessionId: "abc12345-full",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        { role: "user", content: "Add reset data" },
        {
          role: "assistant",
          content: "Done.",
          thought: "Need double confirm.",
        },
      ],
    });
    expect(md).toContain("# Doctor reset");
    expect(md).toContain("Project: grok-app");
    expect(md).toContain("Session: abc12345-full");
    expect(md).toContain("## User");
    expect(md).toContain("Add reset data");
    expect(md).toContain("## Assistant");
    expect(md).toContain("<summary>Thinking</summary>");
    expect(md).toContain("Need double confirm.");
    expect(md).toContain("Done.");
  });

  it("skips empty tool messages", () => {
    const md = sessionToMarkdown({
      title: "t",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        { role: "tool", content: "" },
        { role: "user", content: "hi" },
      ],
    });
    expect(md).not.toContain("## Tool");
    expect(md).toContain("## User");
  });

  it("summarizes tool_step rows when includeToolSummary is on", () => {
    const md = sessionToMarkdown({
      title: "tools",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        {
          role: "tool",
          content: "tool_step|bash|completed|ran tests",
          marker: "tool_step",
        },
        { role: "assistant", content: "All green." },
      ],
    });
    expect(md).toContain("## Tool");
    expect(md).toContain("- bash (completed)");
    expect(md).toContain("All green.");
  });

  it("omits tools and thoughts when options say so", () => {
    const md = sessionToMarkdown({
      title: "opts",
      exportedAt: "2026-07-24T00:00:00.000Z",
      options: { includeThoughts: false, includeToolSummary: false },
      messages: [
        {
          role: "tool",
          content: "tool_step|edit|completed",
          marker: "tool_step",
        },
        {
          role: "assistant",
          content: "Body only.",
          thought: "secret plan",
        },
      ],
    });
    expect(md).not.toContain("## Tool");
    expect(md).not.toContain("secret plan");
    expect(md).not.toContain("<summary>Thinking</summary>");
    expect(md).toContain("Body only.");
  });

  it("falls back to Untitled", () => {
    const md = sessionToMarkdown({
      title: "   ",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [],
    });
    expect(md.startsWith("# Untitled")).toBe(true);
  });
});

describe("formatToolSummaryLine", () => {
  it("parses tool_step pipe format", () => {
    expect(formatToolSummaryLine("tool_step|read|running", "tool_step")).toBe(
      "read (running)",
    );
  });

  it("handles compact marker", () => {
    expect(formatToolSummaryLine("", "context_compact")).toBe("Context compact");
  });
});

describe("sessionExportFilename", () => {
  it("slugifies title and appends short id", () => {
    expect(sessionExportFilename("Fix Doctor Reset!", "abcdef12-xxxx")).toBe(
      "grok-fix-doctor-reset-abcdef12.md",
    );
  });

  it("handles empty title", () => {
    expect(sessionExportFilename("", null)).toBe("grok-session.md");
  });
});

describe("sessionExportJsonFilename", () => {
  it("uses .json extension", () => {
    expect(sessionExportJsonFilename("Fix Doctor Reset!", "abcdef12-xxxx")).toBe(
      "grok-fix-doctor-reset-abcdef12.json",
    );
  });

  it("handles empty title", () => {
    expect(sessionExportJsonFilename("", null)).toBe("grok-session.json");
  });
});

describe("sessionToJson", () => {
  it("builds import-friendly object with user/assistant messages", () => {
    const raw = sessionToJson({
      title: "Doctor reset",
      sessionId: "abc12345-full",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        { role: "user", content: "Add reset data" },
        {
          role: "assistant",
          content: "Done.",
          thought: "Need double confirm.",
        },
        { role: "tool", content: "tool_step|bash|completed", marker: "tool_step" },
        { role: "user", content: "   " },
      ],
    });
    const parsed = JSON.parse(raw) as {
      title: string;
      sessionId: string;
      exportedAt: string;
      messages: Array<{ role: string; content: string; thought?: string }>;
    };
    expect(parsed.title).toBe("Doctor reset");
    expect(parsed.sessionId).toBe("abc12345-full");
    expect(parsed.exportedAt).toBe("2026-07-24T00:00:00.000Z");
    // default: omit tools + thoughts
    expect(parsed.messages).toEqual([
      { role: "user", content: "Add reset data" },
      { role: "assistant", content: "Done." },
    ]);
    // pretty-printed
    expect(raw).toContain("\n  ");
  });

  it("includes thought when includeThoughts is true", () => {
    const parsed = JSON.parse(
      sessionToJson({
        title: "t",
        exportedAt: "2026-07-24T00:00:00.000Z",
        options: { includeThoughts: true },
        messages: [
          {
            role: "assistant",
            content: "Body",
            thought: "secret plan",
          },
        ],
      }),
    );
    expect(parsed.messages).toEqual([
      { role: "assistant", content: "Body", thought: "secret plan" },
    ]);
  });

  it("includes tool summaries as assistant lines when includeToolSummary", () => {
    const parsed = JSON.parse(
      sessionToJson({
        title: "tools",
        exportedAt: "2026-07-24T00:00:00.000Z",
        options: { includeToolSummary: true },
        messages: [
          {
            role: "tool",
            content: "tool_step|bash|completed|ran tests",
            marker: "tool_step",
          },
          { role: "assistant", content: "All green." },
        ],
      }),
    );
    expect(parsed.messages).toEqual([
      { role: "assistant", content: "[tool] bash (completed)" },
      { role: "assistant", content: "All green." },
    ]);
  });

  it("falls back to Untitled and omits sessionId when missing", () => {
    const parsed = JSON.parse(
      sessionToJson({
        title: "   ",
        exportedAt: "2026-07-24T00:00:00.000Z",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(parsed.title).toBe("Untitled");
    expect(parsed.sessionId).toBeUndefined();
    expect(parsed.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("produces messages array suitable for array-style re-import", () => {
    const parsed = JSON.parse(
      sessionToJson({
        title: "round-trip",
        exportedAt: "2026-07-24T00:00:00.000Z",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "world" },
        ],
      }),
    );
    // Import accepts object.messages or a bare array of {role,content}
    const asArray = parsed.messages as Array<{ role: string; content: string }>;
    expect(Array.isArray(asArray)).toBe(true);
    expect(asArray.every((m) => m.role === "user" || m.role === "assistant")).toBe(
      true,
    );
    expect(asArray.every((m) => typeof m.content === "string" && m.content.length > 0)).toBe(
      true,
    );
    // bare array form is also valid JSON for import
    expect(() => JSON.parse(JSON.stringify(asArray))).not.toThrow();
  });
});
