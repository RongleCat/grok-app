import { describe, expect, it } from "vitest";
import {
  classifyToolKind,
  humanizeToolKind,
  isContextToolKind,
  resolveToolPrimaryLabel,
  summarizeToolDisplay,
  toolDetailTail,
  toolExpandBody,
  toolInputDisplay,
  toolOutputBody,
} from "./toolDisplay";

const enTr = (key: string, params?: Record<string, string | number>) => {
  const table: Record<string, string> = {
    "chat.tool.bash": "Run command",
    "chat.tool.read": "Read file",
    "chat.tool.edit": "Edit file",
    "chat.tool.search": "Search",
    "chat.tool.browse": "Browse",
    "chat.tool.agent": "Subagent",
    "chat.tool.generic": "Tool",
    "chat.tool.list": "List directory",
    "chat.ranSearch": "Ran 1 search",
    "chat.browsed": `Browsed ${params?.url ?? ""}`,
  };
  return table[key] ?? key;
};

describe("toolDisplay", () => {
  it("classifies bash / read / edit / search / browse", () => {
    expect(classifyToolKind("run_terminal_command")).toBe("bash");
    expect(classifyToolKind("read_file")).toBe("read");
    expect(classifyToolKind("search_replace")).toBe("edit");
    expect(classifyToolKind("grep")).toBe("search");
    expect(classifyToolKind("web_search")).toBe("search");
    expect(classifyToolKind("web_fetch")).toBe("browse");
    expect(classifyToolKind("open_page")).toBe("browse");
    // Host journal titles with empty kind
    expect(classifyToolKind("", "Web search:")).toBe("search");
    expect(classifyToolKind("", "X search:")).toBe("search");
    // Call-id recovery when kind+title lost (session 3971c6e8…)
    expect(
      classifyToolKind(
        "",
        "tool",
        "ws_b31d81a4-4de4-90db-b8d4-8d6165b7ea31_call-xxx-0",
      ),
    ).toBe("search");
    expect(isContextToolKind("read_file")).toBe(true);
    expect(isContextToolKind("web_fetch")).toBe(true);
    expect(isContextToolKind("search_replace")).toBe(false);
    // Host vision must not collapse into "Ran 1 search"
    expect(classifyToolKind("vision", "识别图片内容", "host-vision-abc")).toBe(
      "read",
    );
    expect(
      classifyToolKind("", "识别图片内容", "host-vision-xyz"),
    ).toBe("read");
  });

  it("summarizes path basename", () => {
    const d = summarizeToolDisplay({
      kind: "read_file",
      path: "/Users/me/proj/src/lib/session.ts",
    });
    expect(d.summary).toBe("session.ts");
    expect(d.isContext).toBe(true);
  });

  it("toolDetailTail keeps last N lines", () => {
    const detail = Array.from({ length: 12 }, (_, i) => `line${i}`).join("\n");
    const tail = toolDetailTail(detail, 3);
    expect(tail).toBe("line9\nline10\nline11");
  });

  it("resolveToolPrimaryLabel includes concrete args and never stdout", () => {
    const bash = resolveToolPrimaryLabel(
      {
        toolKind: "run_terminal_command",
        title: "run_terminal_command",
        input: "ls -la src/lib",
        detail: "total 12\nfile.ts\nmore stdout that must not appear",
      },
      enTr,
    );
    expect(bash).toContain("Run command");
    expect(bash).toContain("ls -la");
    expect(bash).not.toContain("total 12");
    expect(bash).not.toContain("stdout");

    const read = resolveToolPrimaryLabel(
      {
        toolKind: "read_file",
        title: "read_file",
        input: "/Users/me/proj/docs/SKILL.md",
      },
      enTr,
    );
    expect(read).toContain("Read file");
    expect(read).toContain("SKILL.md");

    const mcpish = resolveToolPrimaryLabel(
      {
        toolKind: "mcp_call",
        title: "tool",
        input: "query: weather Beijing",
      },
      enTr,
    );
    // Fallback bucket still surfaces the call argument.
    expect(mcpish).toMatch(/weather|query/i);
  });

  it("resolveToolPrimaryLabel recovers bash args from Execute `…` title when input missing", () => {
    const label = resolveToolPrimaryLabel(
      {
        toolKind: "execute",
        title: "Execute `curl -s http://localhost:3456/info`",
        detail: "exit: 0\n{ok:true}",
      },
      enTr,
    );
    expect(label).toContain("Run command");
    expect(label).toContain("curl -s");
    expect(label).not.toContain("exit: 0");
  });

  it("toolInputDisplay prefers non-comment lines in multi-line shell scripts", () => {
    const bucket = classifyToolKind("execute");
    const shown = toolInputDisplay(
      "# scroll more\ncurl -s http://localhost:3456/scroll\nsleep 1",
      bucket,
    );
    expect(shown).toContain("curl");
    expect(shown).not.toMatch(/^#/);
  });

  it("toolExpandBody surfaces detail tail when present", () => {
    const body = toolExpandBody(
      {
        toolCallId: "t1",
        detail: "lineA\nlineB\nlineC",
        path: undefined,
      },
      false,
    );
    expect(body.hasBody).toBe(true);
    expect(body.detailTail).toContain("lineC");
    expect(body.failHintShort).toBe("");

    const failed = toolExpandBody(
      {
        toolCallId: "t2",
        detail: "permission denied on /tmp/x",
        path: "/tmp/x",
      },
      true,
    );
    expect(failed.hasBody).toBe(true);
    expect(failed.failHintShort.length).toBeGreaterThan(0);
  });

  it("toolExpandBody shows real output and echoes the bash command", () => {
    const body = toolExpandBody(
      {
        toolCallId: "t3",
        toolKind: "run_terminal_command",
        title: "Execute `ls -la`",
        input: "ls -la",
        output: "total 0\ndrwxr-xr-x 2 user staff 64 Jan 1 00:00 .",
      },
      false,
    );
    expect(body.hasBody).toBe(true);
    expect(body.outputBody).toContain("total 0");
    expect(body.command).toBe("ls -la");
    // When output is present, the legacy detail tail is suppressed.
    expect(body.detailTail).toBe("");
  });

  it("toolExpandBody is expandable for read-only tools once output is captured", () => {
    // read_file used to be non-expandable (no command/query in rawInput →
    // detail empty → hasBody false). With real output it must open.
    const body = toolExpandBody(
      {
        toolCallId: "t4",
        toolKind: "read_file",
        title: "Read `README.md`",
        input: "README.md",
        output: "# Title\nsome body",
      },
      false,
    );
    expect(body.hasBody).toBe(true);
    expect(body.outputBody).toContain("# Title");
    expect(body.command).toBe(""); // not a bash tool
  });

  it("toolOutputBody strips leftover ANSI from CLI dumps", () => {
    expect(toolOutputBody("[39mBuild complete in [32m42169ms[39m")).toBe(
      "Build complete in 42169ms",
    );
  });

  it("toolOutputBody elides the middle of very long output", () => {
    const long = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
    const body = toolOutputBody(long, 100);
    expect(body).toContain("line 0");
    expect(body).toContain("line 999");
    expect(body).toMatch(/… \d+ more lines …/);
  });
});

describe("humanizeToolKind", () => {
  it("turns a machine tool name into readable words", () => {
    expect(humanizeToolKind("enter_plan_mode")).toBe("Enter Plan Mode");
    expect(humanizeToolKind("exit_plan_mode")).toBe("Exit Plan Mode");
    expect(humanizeToolKind("run_terminal_command")).toBe("Run Terminal Command");
  });

  it("returns undefined for empty / bare tool", () => {
    expect(humanizeToolKind("")).toBeUndefined();
    expect(humanizeToolKind("tool")).toBeUndefined();
    expect(humanizeToolKind(undefined)).toBeUndefined();
  });
});

describe("resolveToolPrimaryLabel fallback", () => {
  it("uses the humanized machine name instead of bare 工具 for unknown tools", () => {
    const label = resolveToolPrimaryLabel(
      { toolKind: "enter_plan_mode", toolCallId: "call_x" },
      enTr,
    );
    expect(label).toBe("Enter Plan Mode");
    expect(label).not.toBe("Tool");
  });

  it("falls back to the generic label only when nothing is known", () => {
    const label = resolveToolPrimaryLabel({ toolCallId: "call_x" }, enTr);
    expect(label).toBe("Tool");
  });
});
