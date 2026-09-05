import { describe, expect, it } from "vitest";
import {
  applyContextCompact,
  applyToolEvent,
  buildSegmentsFromLegacy,
  compactMessageSegments,
  parseCompactContent,
  parseToolStepContent,
  pickLatestTurnTool,
  pickRunningTurnTool,
  toolStepDisplayTitle,
  weaveToolsIntoAssistantSegments,
  filterTranscriptMessages,
  toolSegmentFromFields,
  upsertToolInSegments,
  type ChatMessage,
} from "./session";


describe("context compact markers", () => {
  it("parseCompactContent reads host journal format", () => {
    const meta = parseCompactContent(
      "context_compact|auto|tokens:120000->40000\nkept auth design",
    );
    expect(meta?.trigger).toBe("auto");
    expect(meta?.tokensBefore).toBe(120000);
    expect(meta?.tokensAfter).toBe(40000);
    expect(meta?.summaryPreview).toBe("kept auth design");
  });

  it("applyContextCompact appends marker row", () => {
    const next = applyContextCompact([], {
      messageId: "c1",
      trigger: "auto",
      tokensBefore: 1000,
      tokensAfter: 400,
    });
    expect(next).toHaveLength(1);
    expect(next[0]?.marker).toBe("context_compact");
    expect(next[0]?.compactMeta?.tokensBefore).toBe(1000);
  });

  it("applyContextCompact splits a streaming assistant so the banner is a mid-turn anchor (#855)", () => {
    const before = applyContextCompact(
      [
        { id: "u1", role: "user", content: "long task" },
        {
          id: "a1",
          role: "assistant",
          content: "",
          streaming: true,
          segments: [
            {
              kind: "tool",
              toolCallId: "t1",
              title: "read",
              status: "completed",
            },
          ],
        },
      ],
      {
        messageId: "c1",
        trigger: "auto",
        tokensBefore: 400_000,
        tokensAfter: 22_000,
      },
    );
    expect(before.map((m) => m.marker || m.role)).toEqual([
      "user",
      "assistant",
      "context_compact",
      "assistant",
    ]);
    expect(before[1]?.id).toBe("a1__precompact_c1");
    expect(before[1]?.streaming).toBe(false);
    expect(before[1]?.segments).toHaveLength(1);
    expect(before[2]?.marker).toBe("context_compact");
    expect(before[3]?.id).toBe("a1");
    expect(before[3]?.streaming).toBe(true);
    expect(before[3]?.segments ?? []).toEqual([]);

    const afterTool = applyToolEvent(before, {
      toolCallId: "t2",
      title: "write",
      kind: "edit",
      status: "completed",
      path: "/tmp/x.ts",
    });
    expect(afterTool[2]?.marker).toBe("context_compact");
    expect(afterTool[3]?.segments?.some((s) => s.kind === "tool" && s.toolCallId === "t2")).toBe(
      true,
    );
    expect(afterTool[1]?.segments?.some((s) => s.kind === "tool" && s.toolCallId === "t2")).toBe(
      false,
    );
  });

  it("applyContextCompact stacks multiple mid-turn banners without pinning them to the tail", () => {
    let msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
      { id: "a1", role: "assistant", content: "", streaming: true, segments: [] },
    ];
    msgs = applyContextCompact(msgs, { messageId: "c1", trigger: "auto" });
    msgs = applyContextCompact(msgs, { messageId: "c2", trigger: "auto" });
    expect(msgs.filter((m) => m.marker === "context_compact").map((m) => m.id)).toEqual([
      "c1",
      "c2",
    ]);
    expect(msgs[msgs.length - 1]?.role).toBe("assistant");
    expect(msgs[msgs.length - 1]?.streaming).toBe(true);
    expect(msgs[msgs.length - 1]?.id).toBe("a1");
  });
});

describe("tool activity", () => {
  it("compactMessageSegments merges host-vision family (no double 识别图片内容)", () => {
    const segs = compactMessageSegments([
      {
        kind: "tool",
        toolCallId: "host-vision-aaa",
        title: "识别图片内容",
        toolKind: "vision",
        status: "in_progress",
        detail: "partial…",
        streaming: true,
      },
      {
        kind: "tool",
        toolCallId: "host-vision-bbb",
        title: "识别图片内容",
        toolKind: "vision",
        status: "completed",
        detail: "full description of the UI",
        streaming: false,
      },
      { kind: "thought", text: "思考" },
    ]);
    const tools = segs.filter((s) => s.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      title: "识别图片内容",
      status: "completed",
      detail: "full description of the UI",
    });
  });

  it("compactMessageSegments merges host-x family (no double 搜索 X 信息)", () => {
    const segs = compactMessageSegments([
      {
        kind: "tool",
        toolCallId: "host-x-aaa",
        title: "搜索 X 信息",
        toolKind: "search",
        status: "in_progress",
        detail: "…",
        streaming: true,
      },
      {
        kind: "tool",
        toolCallId: "host-x-bbb",
        title: "搜索 X 信息",
        toolKind: "search",
        status: "completed",
        detail: "## X 用户搜索\n| Handle | @cgnot996 |",
        streaming: false,
      },
      { kind: "thought", text: "ok" },
    ]);
    const tools = segs.filter((s) => s.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]?.detail).toContain("@cgnot996");
  });

  it("parseToolStepContent keeps multiline Host X body", () => {
    const body = [
      "tool_step|completed|search|搜索 X 信息",
      "The user wants me to search…",
      "",
      "## X 用户搜索：`cgnot996`",
      "",
      "| Handle | @cgnot996 |",
      "| Profile | https://x.com/cgnot996 |",
    ].join("\n");
    const p = parseToolStepContent(body);
    expect(p?.title).toBe("搜索 X 信息");
    expect(p?.kind).toBe("search");
    expect(p?.detail).toContain("@cgnot996");
    expect(p?.detail).toContain("https://x.com/cgnot996");
    expect(p?.detail?.split("\n").length).toBeGreaterThan(2);
  });

  it("parseToolStepContent reads the host input: line as the call argument", () => {
    const body = [
      "tool_step|completed|read_file|Read",
      "input:/Users/me/.agents/skills/content-infographic/SKILL.md",
      "1→---",
      "name: content-infographic",
    ].join("\n");
    const p = parseToolStepContent(body);
    expect(p?.kind).toBe("read_file");
    expect(p?.title).toBe("Read");
    expect(p?.input).toBe("/Users/me/.agents/skills/content-infographic/SKILL.md");
    // Promote single-file input: into path so toolPath / path-map work.
    expect(p?.path).toBe(
      "/Users/me/.agents/skills/content-infographic/SKILL.md",
    );
    expect(p?.detail).toContain("name: content-infographic");
    // input line is not part of the expand detail
    expect(p?.detail).not.toContain("input:");
  });

  it("parseToolStepContent promotes spaced article paths from input:", () => {
    const abs =
      "/Users/ronglecat/Documents/document/文章输出/进行中/2026-08-11-Mac Studio本地双模型：河南话问MES，Agent查库出图/04-正文/正文.md";
    const body = [
      "tool_step|completed|read_file|Read",
      `input:${abs}`,
      "# 车间里先听懂河南话",
    ].join("\n");
    const p = parseToolStepContent(body);
    expect(p?.input).toBe(abs);
    expect(p?.path).toBe(abs);
  });

  it("parseToolStepContent does not promote shell commands as path", () => {
    const body = [
      "tool_step|completed|run_terminal_command|Run Command",
      "input:ls -la /tmp",
      "total 0",
    ].join("\n");
    const p = parseToolStepContent(body);
    expect(p?.input).toBe("ls -la /tmp");
    expect(p?.path).toBeUndefined();
  });

  it("parseToolStepContent recovers multi-line Execute titles and buried input:", () => {
    // Real journal shape from multi-line shell: title spans lines, input: is late.
    const body = [
      "tool_step|completed|execute|Execute `# Scroll to load all content",
      "curl -s http://localhost:3456/scroll",
      "sleep 1`",
      "input:# Scroll to load all content",
      "exit: 0",
      "scrolled",
    ].join("\n");
    const p = parseToolStepContent(body);
    expect(p?.kind).toBe("execute");
    expect(p?.input).toBeTruthy();
    // Prefer rejoined title command over truncated input: first line.
    expect(p?.input).toContain("curl -s http://localhost:3456/scroll");
    expect(p?.input).toContain("sleep 1");
    // Title collapsed once input is known.
    expect(p?.title).toBe("Execute");
    // input: marker stripped from detail.
    expect(p?.detail).not.toMatch(/^input:/m);
    expect(p?.detail).toContain("exit: 0");
  });

  it("parseToolStepContent finds input: after non-title body noise", () => {
    const body = [
      "tool_step|completed|run_terminal_command|Run Command",
      "some stdout line",
      "input:ls -la /tmp",
      "more stdout",
    ].join("\n");
    const p = parseToolStepContent(body);
    expect(p?.input).toBe("ls -la /tmp");
    expect(p?.detail).toContain("some stdout line");
    expect(p?.detail).toContain("more stdout");
    expect(p?.detail).not.toContain("input:");
  });

  it("weave session b54735c8 shape: one host-x tool + full detail", () => {
    const toolBody = [
      "tool_step|completed|search|搜索 X 信息",
      "preamble junk",
      "## X 用户搜索：`cgnot996`",
      "| **Handle** | `@cgnot996` |",
    ].join("\n");
    const parsed = parseToolStepContent(toolBody)!;
    const rows: ChatMessage[] = [
      { id: "u1", role: "user", content: "搜索@cgnot996这个账号" },
      {
        id: "tool-host-x-56464134-1102-46dc-9d80-53e0d6363d86",
        role: "tool",
        content: parsed.title,
        marker: "tool_step",
        toolCallId: "host-x-56464134-1102-46dc-9d80-53e0d6363d86",
        toolKind: parsed.kind,
        toolStatus: parsed.status,
        toolDetail: parsed.detail,
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        content: "结果如下",
        thought: "already have host results",
        thoughtPhases: ["already have host results"],
        segments: buildSegmentsFromLegacy(
          "结果如下",
          "already have host results",
          ["already have host results"],
        ),
      },
    ];
    const woven = weaveToolsIntoAssistantSegments(rows);
    const asst = woven.find((m) => m.role === "assistant")!;
    const tools = (asst.segments || []).filter((s) => s.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ title: "搜索 X 信息" });
    expect((tools[0] as { detail?: string }).detail).toContain("@cgnot996");
    const filtered = filterTranscriptMessages(woven);
    expect(filtered.some((m) => m.role === "tool")).toBe(false);
  });

  it("applyToolEvent host-x only inlines into assistant (no dual standalone row)", () => {
    let m: ChatMessage[] = [
      { id: "u1", role: "user", content: "搜索它在 x 上的信息" },
      {
        id: "a-pending-1",
        role: "assistant",
        content: "",
        streaming: true,
        segments: [],
      },
    ];
    m = applyToolEvent(m, {
      toolCallId: "host-x-aaa",
      title: "搜索 X 信息",
      kind: "search",
      status: "in_progress",
      detail: "…",
    });
    // No standalone tool_step row — only assistant segment.
    expect(m.filter((x) => x.role === "tool")).toHaveLength(0);
    const asst = m.find((x) => x.role === "assistant")!;
    expect(asst.segments?.filter((s) => s.kind === "tool")).toHaveLength(1);

    m = applyToolEvent(m, {
      toolCallId: "host-x-bbb",
      title: "搜索 X 信息",
      kind: "search",
      status: "completed",
      detail: "## DeepSeek\n@foo",
    });
    expect(m.filter((x) => x.role === "tool")).toHaveLength(0);
    const asst2 = m.find((x) => x.role === "assistant")!;
    const tools = (asst2.segments || []).filter((s) => s.kind === "tool");
    expect(tools).toHaveLength(1);
    expect((tools[0] as { detail?: string }).detail).toContain("DeepSeek");
  });

  it("applyToolEvent upserts by toolCallId", () => {
    let m = applyToolEvent([], {
      toolCallId: "t1",
      title: "read_file",
      kind: "read",
      status: "in_progress",
      path: "/tmp/a.ts",
    });
    expect(m).toHaveLength(1);
    expect(m[0]?.streaming).toBe(true);
    m = applyToolEvent(m, {
      toolCallId: "t1",
      title: "Read /tmp/a.ts",
      kind: "read",
      status: "completed",
      path: "/tmp/a.ts",
    });
    expect(m).toHaveLength(1);
    expect(m[0]?.streaming).toBe(false);
    expect(m[0]?.content).toContain("Read");
  });

  it("applyToolEvent keeps input across status-only ticks (no downgrade)", () => {
    let m: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "run",
        createdAt: new Date().toISOString(),
      },
      {
        id: "a1",
        role: "assistant",
        content: "",
        segments: [{ kind: "thought", text: "plan" }],
        streaming: true,
        createdAt: new Date().toISOString(),
      },
    ];
    m = applyToolEvent(m, {
      toolCallId: "bash-1",
      title: "run_terminal_command",
      kind: "run_terminal_command",
      status: "in_progress",
      input: "ls -la src/lib/session.ts",
    });
    // Sparse status tick — no input field (live wire often omits on progress).
    m = applyToolEvent(m, {
      toolCallId: "bash-1",
      title: "run_terminal_command",
      kind: "run_terminal_command",
      status: "in_progress",
      detail: "working…",
    });
    m = applyToolEvent(m, {
      toolCallId: "bash-1",
      title: "run_terminal_command",
      kind: "run_terminal_command",
      status: "completed",
      detail: "total 12\nsession.ts",
    });
    const asst = m.find((x) => x.id === "a1");
    expect(asst).toBeTruthy();
    const tools = (asst!.segments || []).filter(
      (s): s is Extract<typeof s, { kind: "tool" }> => s.kind === "tool",
    );
    expect(tools).toHaveLength(1);
    expect(tools[0]!.input).toBe("ls -la src/lib/session.ts");
    // Standalone tool row also keeps toolInput for reload weave path.
    const row = m.find((x) => x.toolCallId === "bash-1");
    expect(row?.toolInput).toBe("ls -la src/lib/session.ts");
  });

  it("upsertToolInSegments and compactMessageSegments preserve prior input", () => {
    const withInput = toolSegmentFromFields({
      toolCallId: "r1",
      title: "read_file",
      toolKind: "read_file",
      status: "in_progress",
      input: "/Users/me/proj/SKILL.md",
    });
    const statusOnly = toolSegmentFromFields({
      toolCallId: "r1",
      title: "read_file",
      toolKind: "read_file",
      status: "completed",
      detail: "ok",
    });
    const upserted = upsertToolInSegments([withInput], statusOnly);
    expect(upserted).toHaveLength(1);
    expect((upserted[0] as { input?: string }).input).toBe(
      "/Users/me/proj/SKILL.md",
    );
    const compacted = compactMessageSegments([withInput, statusOnly]);
    expect(compacted).toHaveLength(1);
    expect((compacted[0] as { input?: string }).input).toBe(
      "/Users/me/proj/SKILL.md",
    );
  });

  it("parseToolStepContent", () => {
    const p = parseToolStepContent(
      "tool_step|completed|read|Read foo\n/tmp/foo",
    );
    expect(p?.status).toBe("completed");
    expect(p?.title).toBe("Read foo");
  });

  it("pickLatestTurnTool prefers running tool in current turn", () => {
    let m = applyToolEvent(
      [
        {
          id: "u1",
          role: "user",
          content: "hi",
          createdAt: new Date().toISOString(),
        },
      ],
      {
        toolCallId: "t1",
        title: "Read a",
        kind: "read",
        status: "completed",
      },
    );
    m = applyToolEvent(m, {
      toolCallId: "t2",
      title: "Search b",
      kind: "search",
      status: "in_progress",
    });
    const latest = pickLatestTurnTool(m);
    expect(latest?.toolCallId).toBe("t2");
    expect(latest?.streaming).toBe(true);
  });

  it("pickRunningTurnTool only returns in-flight tool (hide when done)", () => {
    let m = applyToolEvent(
      [
        {
          id: "u1",
          role: "user",
          content: "hi",
          createdAt: new Date().toISOString(),
        },
      ],
      {
        toolCallId: "t1",
        title: "Listing files in private persona folder",
        kind: "list",
        status: "in_progress",
      },
    );
    expect(pickRunningTurnTool(m)?.content).toContain("Listing files");
    m = applyToolEvent(m, {
      toolCallId: "t1",
      title: "Listing files in private persona folder",
      kind: "list",
      status: "completed",
    });
    expect(pickRunningTurnTool(m)).toBeNull();
  });

  it("toolStepDisplayTitle prefers plain content title", () => {
    expect(
      toolStepDisplayTitle({
        id: "tool-1",
        role: "tool",
        content: "Listing files in private persona folder",
        marker: "tool_step",
      }),
    ).toBe("Listing files in private persona folder");
    expect(
      toolStepDisplayTitle({
        id: "tool-2",
        role: "tool",
        content: "tool_step|completed|read|Read foo",
        marker: "tool_step",
      }),
    ).toBe("Read foo");
  });

  it("never surfaces bare tool placeholder; prefers detail/path", () => {
    expect(
      toolStepDisplayTitle({
        id: "tool-3",
        role: "tool",
        content: "tool",
        toolDetail: "ls -la /tmp",
        marker: "tool_step",
      }),
    ).toBe("ls -la /tmp");
    expect(
      toolStepDisplayTitle({
        id: "tool-4",
        role: "tool",
        content: "tool",
        marker: "tool_step",
      }),
    ).toBe("");
    let m = applyToolEvent([], {
      toolCallId: "t-gen",
      title: "tool",
      kind: "tool",
      status: "in_progress",
    });
    expect(pickRunningTurnTool(m)).toBeNull();
    m = applyToolEvent(m, {
      toolCallId: "t-gen",
      title: "tool",
      kind: "bash",
      status: "in_progress",
      detail: "npm test",
    });
    expect(pickRunningTurnTool(m)?.content).toBe("npm test");
    // Don't downgrade a good title on a vague update
    m = applyToolEvent(m, {
      toolCallId: "t-gen",
      title: "tool",
      kind: "bash",
      status: "in_progress",
    });
    expect(m[0]?.content).toBe("npm test");
  });
});

describe("tool_step output capture", () => {
  it("parseToolStepContent splits real output off the sentinel", () => {
    // New journal shape: legacy body intact, output appended after the sentinel.
    const body = [
      "tool_step|completed|read_file|Read",
      "input:src/lib/session.ts",
      "\u0001output",
      "1→export function foo() {",
      "2→  return 42;",
      "3→}",
    ].join("\n");
    const p = parseToolStepContent(body);
    expect(p?.kind).toBe("read_file");
    expect(p?.input).toBe("src/lib/session.ts");
    // Output is the full multiline body — never reaches the positional detail.
    expect(p?.output).toContain("export function foo()");
    expect(p?.output).toContain("return 42");
    expect(p?.detail).toBeUndefined();
  });

  it("parseToolStepContent keeps legacy rows byte-identical (no sentinel)", () => {
    // Old journal rows have no sentinel and must parse exactly as before.
    const body = [
      "tool_step|completed|grep|Search",
      "input:foo",
      "src/a.ts:1:foo",
      "src/b.ts:2:foo",
    ].join("\n");
    const p = parseToolStepContent(body);
    expect(p?.output).toBeUndefined();
    expect(p?.input).toBe("foo");
    // Positional detail/path heuristic still runs on the pre-sentinel body.
    expect(p?.detail).toContain("src/a.ts:1:foo");
  });

  it("applyToolEvent threads output into the tool segment", () => {
    let m = applyToolEvent(
      [{ id: "a1", role: "assistant", content: "thinking…" }],
      {
        toolCallId: "call_1",
        title: "Read",
        kind: "read_file",
        status: "completed",
        input: "README.md",
        output: "# Project\nA short readme.",
      },
    );
    const asst = m.find((x) => x.role === "assistant");
    expect(asst).toBeDefined();
    const tool = asst?.segments?.find((s) => s.kind === "tool");
    expect(tool).toBeTruthy();
    expect((tool as { output?: string }).output).toContain("# Project");
    expect((tool as { input?: string }).input).toBe("README.md");
    // A later sparse status tick must not erase the captured output.
    m = applyToolEvent(m, {
      toolCallId: "call_1",
      status: "completed",
    });
    const asst2 = m.find((x) => x.role === "assistant");
    expect(asst2).toBeDefined();
    const tool2 = asst2?.segments?.find((s) => s.kind === "tool") as
      | { output?: string }
      | undefined;
    expect(tool2?.output).toContain("# Project");
  });
});

describe("tool history replay kind recovery", () => {
  it("recovers toolKind from the journal body when the row field is empty", () => {
    // History-loaded rows carry only the tool_step content; the kind field on
    // the message is empty. Replay must parse it out so the typed icon/label
    // (and the humanized fallback for internal tools) survives reload.
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "plan something" },
      {
        id: "a1",
        role: "assistant",
        content: "done",
        segments: [{ kind: "content", text: "done" }],
      },
      {
        id: "tool-c1",
        role: "tool",
        // No toolKind field — must come from the parsed body below.
        content: "tool_step|completed|enter_plan_mode|Enter Plan Mode",
        marker: "tool_step",
        createdAt: "2026-08-11T01:00:00Z",
      },
    ]);
    const asst = woven.find((m) => m.role === "assistant")!;
    const tool = asst.segments?.find((s) => s.kind === "tool") as any;
    expect(tool).toBeTruthy();
    expect(tool.toolKind).toBe("enter_plan_mode");
    expect(tool.title).toBeTruthy();
  });
});

describe("tool output memory (#1029)", () => {
  it("compacts completed toolOutput and drops the standalone duplicate after weave", () => {
    const long = Array.from({ length: 500 }, (_, i) => `line-${i}`).join("\n");
    const withAsst: ChatMessage[] = [
      { id: "u1", role: "user", content: "run" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        streaming: true,
        segments: [{ kind: "thought", text: "…" }],
      },
    ];
    const running = applyToolEvent(withAsst, {
      toolCallId: "t-big",
      title: "bash",
      kind: "bash",
      status: "in_progress",
      output: long.slice(0, 200),
    });
    const runAsst = running.find((m) => m.id === "a1");
    const runSeg = runAsst?.segments?.find(
      (s) => s.kind === "tool" && s.toolCallId === "t-big",
    );
    // While running, keep the raw growing buffer on the segment (not compacted).
    expect(runSeg && runSeg.kind === "tool" ? runSeg.output : "").toBe(
      long.slice(0, 200),
    );

    const done = applyToolEvent(running, {
      toolCallId: "t-big",
      title: "bash",
      kind: "bash",
      status: "completed",
      output: long,
    });
    const asst = done.find((m) => m.id === "a1");
    const seg = asst?.segments?.find(
      (s) => s.kind === "tool" && s.toolCallId === "t-big",
    );
    expect(seg && seg.kind === "tool" ? seg.output : "").toContain("line-0");
    expect(
      seg && seg.kind === "tool" ? (seg.output || "").length : 0,
    ).toBeLessThan(long.length);
    // Standalone row no longer keeps a second full copy.
    const step = done.find((m) => m.id === "tool-t-big");
    expect(step?.toolOutput).toBeUndefined();
  });
});
