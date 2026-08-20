/**
 * End-to-end pure fixture path for chat UX renovation.
 * Drives shipped reducers/helpers only (no UI mocks of the unit under test).
 */
import { describe, expect, it } from "vitest";
import {
  applyStreamChunk,
  applyToolEvent,
  applyTurnMarker,
  buildSegmentsFromLegacy,
  isFailedToolStepMessage,
  messageSegments,
  weaveToolsIntoAssistantSegments,
  type ChatMessage,
  type MessageToolSegment,
} from "./session";
import { extractThinkingSummary } from "./thinkingSummary";
import { buildTurnActivity } from "./turnActivity";
import {
  buildTimelineUnits,
  shouldShowTrailingLiveThinking,
} from "./timelinePhases";
import { mapEndOfTurnReason } from "./endOfTurn";
import {
  armStopLatch,
  createStopLatchState,
  tickStopLatch,
  canSendWithStopLatch,
  STOP_LATCH_MS,
} from "./stopLatch";
import { mapStoredMessageToChat } from "./mapStoredMessages";
import { resolveToolPrimaryLabel } from "./toolDisplay";
import { buildGrokActivitySteps } from "./grokActivitySteps";

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

describe("chat UX fixtures (shipped path)", () => {
  it("a) multi-phase thoughts with empty-assistant-style new hints merge", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "q" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        segments: [{ kind: "thought", text: "**定位目录**" }],
        streaming: true,
      },
    ];
    // Spurious "new" without body between thoughts
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "更多推理",
      done: false,
      kind: "thought",
      thoughtPhase: "new",
    });
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "答案正文",
      done: true,
      kind: "assistant",
    });
    const segs = messageSegments(messages[1]!);
    const thoughtLabels = segs
      .filter((s) => s.kind === "thought")
      .map((s) => extractThinkingSummary(s.text) || s.text);
    for (const lab of thoughtLabels) {
      expect(lab).not.toMatch(/^思考\s*\d+$/);
      expect(lab).not.toMatch(/^Thinking\s*\d+$/i);
    }
    // Reload path: multi phase markers stack before body only
    const legacy = buildSegmentsFromLegacy(
      "答案正文",
      "a\n\n⟪phase⟫\n\nb\n\n⟪phase⟫\n\nc",
    );
    expect(legacy.map((s) => s.kind)).toEqual(["thought", "content"]);
    expect(legacy[0]!.kind === "thought" && legacy[0]!.text).toContain("a");
  });

  it("b) failed tools counted in activity; tools pin onto assistant timeline", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "do" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        segments: [{ kind: "thought", text: "plan" }],
        streaming: true,
      },
    ];
    for (let i = 0; i < 5; i++) {
      messages = applyToolEvent(messages, {
        sessionId: "s",
        toolCallId: `ok-${i}`,
        title: `Read f${i}`,
        kind: "read_file",
        status: "completed",
        path: `/p/f${i}.ts`,
      });
    }
    messages = applyToolEvent(messages, {
      sessionId: "s",
      toolCallId: "bad",
      title: "Shell boom",
      kind: "run_terminal_command",
      status: "failed",
      detail: "exit 1",
    });
    const tools = messages.filter((m) => m.marker === "tool_step");
    const failed = tools.filter(isFailedToolStepMessage);
    const success = tools.filter((m) => !isFailedToolStepMessage(m));
    expect(failed).toHaveLength(1);
    expect(success.length).toBeGreaterThanOrEqual(5);
    // Tasks panel still derives from tool_step rows
    const act = buildTurnActivity(messages);
    expect(act.errorCount).toBe(1);
    expect(act.shouldExpand).toBe(true);
    expect(act.stepCount).toBe(6);
    // Assistant segments include tools on the real timeline
    const asst = messages.find((m) => m.id === "a1")!;
    const segs = messageSegments(asst);
    expect(segs.some((s) => s.kind === "tool")).toBe(true);
    expect(segs.filter((s) => s.kind === "tool")).toHaveLength(6);
    const bad = segs.find(
      (s) => s.kind === "tool" && s.toolCallId === "bad",
    );
    expect(bad && bad.kind === "tool" && bad.isError).toBe(true);
  });

  it("b2) live stream interleaves thought → tool → content", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "fix" },
    ];
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "先查一下",
      done: false,
      kind: "thought",
    });
    messages = applyToolEvent(messages, {
      toolCallId: "t1",
      title: "Read foo.ts",
      kind: "read_file",
      status: "completed",
      path: "/src/foo.ts",
    });
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "修好了。",
      done: true,
      kind: "assistant",
    });
    const segs = messageSegments(messages.find((m) => m.role === "assistant")!);
    expect(segs.map((s) => s.kind)).toEqual(["thought", "tool", "content"]);
    expect(segs[1]!.kind === "tool" && segs[1]!.title).toContain("foo");
  });

  it("b3b) phase closes when content arrives mid-stream (not only at turn end)", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
    ];
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "**定位** 问题",
      done: false,
      kind: "thought",
    });
    messages = applyToolEvent(messages, {
      toolCallId: "t1",
      title: "Read a",
      kind: "read_file",
      status: "completed",
    });
    messages = applyToolEvent(messages, {
      toolCallId: "t2",
      title: "Read b",
      kind: "read_file",
      status: "completed",
    });
    // Still streaming — work phase is live
    let segs = messageSegments(messages.find((m) => m.role === "assistant")!);
    let units = buildTimelineUnits(segs, { streaming: true });
    expect(units[0]?.kind).toBe("phase");
    if (units[0]?.kind === "phase") expect(units[0].live).toBe(true);

    // Content starts → phase closes even though stream continues
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "结论。",
      done: false,
      kind: "assistant",
    });
    segs = messageSegments(messages.find((m) => m.role === "assistant")!);
    units = buildTimelineUnits(segs, { streaming: true });
    expect(units.map((u) => u.kind)).toEqual(["phase", "content"]);
    if (units[0]?.kind === "phase") expect(units[0].live).toBe(false);
    // Placeholder under live last content unmounts at settle and flashes the
    // tail. Later reasoning paints as a thought row when it arrives.
    expect(
      shouldShowTrailingLiveThinking(units, {
        messageStreaming: true,
        hasRunningTool: false,
      }),
    ).toBe(false);

    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "下一轮还在想",
      done: false,
      kind: "thought",
    });
    segs = messageSegments(messages.find((m) => m.role === "assistant")!);
    units = buildTimelineUnits(segs, { streaming: true });
    const last = units[units.length - 1]!;
    expect(last.kind === "thought" || last.kind === "thought-group").toBe(true);
    if (last.kind === "thought" || last.kind === "thought-group") {
      expect(last.streaming).toBe(true);
    }
    expect(
      shouldShowTrailingLiveThinking(units, {
        messageStreaming: true,
        hasRunningTool: false,
      }),
    ).toBe(false);
  });

  it("b3) tools before first stream token prepend onto assistant", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
    ];
    messages = applyToolEvent(messages, {
      toolCallId: "early",
      title: "List dir",
      kind: "list_dir",
      status: "completed",
    });
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "看完了",
      done: true,
      kind: "assistant",
    });
    const segs = messageSegments(messages.find((m) => m.role === "assistant")!);
    expect(segs.map((s) => s.kind)).toEqual(["tool", "content"]);
    expect(segs[0]!.kind === "tool" && segs[0]!.toolCallId).toBe("early");
  });

  it("c) multi-tool turn activity groups context tools", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "explore" },
    ];
    for (const id of ["a", "b", "c"]) {
      messages = applyToolEvent(messages, {
        toolCallId: id,
        title: `Read ${id}`,
        kind: "read_file",
        status: "completed",
        path: `/src/${id}.ts`,
      });
    }
    messages = applyToolEvent(messages, {
      toolCallId: "e",
      title: "Edit",
      kind: "search_replace",
      status: "completed",
      path: "/src/a.ts",
    });
    const act = buildTurnActivity(messages);
    expect(act.stepCount).toBe(4);
    expect(act.segments.some((s) => s.kind === "context")).toBe(true);
    if (act.segments[0]?.kind === "context") {
      expect(act.segments[0].tools.length).toBeGreaterThanOrEqual(3);
    }
    expect(act.modifiedPaths.length).toBeGreaterThanOrEqual(1);
  });

  it("d) end reasons map to one chip family; stop latch unlocks send", () => {
    expect(mapEndOfTurnReason("user_stop").messageKey).toBe(
      "activity.cancelledByUser",
    );
    expect(mapEndOfTurnReason("stall").messageKey).toBe("endOfTurn.stall");
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "x" },
      { id: "a1", role: "assistant", content: "partial", streaming: true },
    ];
    messages = applyTurnMarker(messages, {
      marker: "turn_end",
      reason: "user_stop",
      content: "turn_end|user_stop",
    });
    expect(messages.some((m) => m.marker === "turn_end")).toBe(true);

    let latch = armStopLatch(createStopLatchState(), "s1", 0);
    expect(canSendWithStopLatch("streaming", latch)).toBe(false);
    const r = tickStopLatch(latch, "streaming", STOP_LATCH_MS);
    expect(r.forceComplete).toBe(true);
    expect(canSendWithStopLatch("streaming", r.latch)).toBe(true);
  });

  it("e) live completed primary labels match journal history reload", () => {
    // Live path: start with input → status-only → completed.
    let live: ChatMessage[] = [
      { id: "u1", role: "user", content: "run tools" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        segments: [{ kind: "thought", text: "plan" }],
        streaming: true,
      },
    ];
    live = applyToolEvent(live, {
      toolCallId: "bash-live",
      title: "run_terminal_command",
      kind: "run_terminal_command",
      status: "in_progress",
      input: "ls -la src/lib/session.ts",
    });
    live = applyToolEvent(live, {
      toolCallId: "bash-live",
      title: "run_terminal_command",
      kind: "run_terminal_command",
      status: "completed",
      detail: "total 12\nsession.ts",
    });
    live = applyToolEvent(live, {
      toolCallId: "read-live",
      title: "read_file",
      kind: "read_file",
      status: "completed",
      input: "/Users/me/proj/docs/SKILL.md",
      path: "/Users/me/proj/docs/SKILL.md",
    });
    live = applyStreamChunk(live, {
      sessionId: "s",
      messageId: "a1",
      text: "done",
      done: true,
      kind: "assistant",
    });

    const liveAsst = live.find((m) => m.id === "a1")!;
    const liveTools = messageSegments(liveAsst).filter(
      (s): s is MessageToolSegment => s.kind === "tool",
    );
    const liveLabels = liveTools.map((t) => resolveToolPrimaryLabel(t, enTr));
    expect(liveLabels.some((l) => l.includes("ls -la"))).toBe(true);
    expect(liveLabels.some((l) => l.includes("SKILL.md"))).toBe(true);
    // Phase steps use the same label source after turn ends.
    const liveSteps = buildGrokActivitySteps(
      liveTools.map((t) => ({ kind: "tool" as const, tool: t })),
      { messageStreaming: false },
    );
    const liveStepTools = liveSteps.filter((s) => s.type === "tool");
    for (const step of liveStepTools) {
      if (step.type !== "tool") continue;
      expect(resolveToolPrimaryLabel(step.tool, enTr)).toBe(
        resolveToolPrimaryLabel(
          liveTools.find((t) => t.toolCallId === step.tool.toolCallId)!,
          enTr,
        ),
      );
    }

    // History path: journal tool_step rows with input: lines → weave.
    const journalAsst = mapStoredMessageToChat({
      id: "a1",
      role: "assistant",
      content: "done",
      thought: "plan",
      createdAt: new Date().toISOString(),
      isError: false,
    });
    const journalBash = mapStoredMessageToChat({
      id: "tool-bash-live",
      role: "tool",
      content:
        "tool_step|completed|run_terminal_command|run_terminal_command\ninput:ls -la src/lib/session.ts\ntotal 12\nsession.ts",
      createdAt: new Date().toISOString(),
      isError: false,
      marker: "tool_step",
    });
    const journalRead = mapStoredMessageToChat({
      id: "tool-read-live",
      role: "tool",
      content:
        "tool_step|completed|read_file|read_file\ninput:/Users/me/proj/docs/SKILL.md\n/Users/me/proj/docs/SKILL.md",
      createdAt: new Date().toISOString(),
      isError: false,
      marker: "tool_step",
    });
    const history = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "run tools" },
      journalAsst,
      journalBash,
      journalRead,
    ]);
    const histAsst = history.find((m) => m.id === "a1")!;
    const histTools = messageSegments(histAsst).filter(
      (s): s is MessageToolSegment => s.kind === "tool",
    );
    const histLabels = histTools.map((t) => resolveToolPrimaryLabel(t, enTr));

    // Same concrete fragments — live completed == history reload.
    for (const fragment of ["ls -la", "SKILL.md"]) {
      expect(liveLabels.some((l) => l.includes(fragment))).toBe(true);
      expect(histLabels.some((l) => l.includes(fragment))).toBe(true);
    }
    // Pair by toolCallId when present.
    for (const lt of liveTools) {
      const ht = histTools.find((t) => t.toolCallId === lt.toolCallId);
      if (!ht) continue;
      expect(resolveToolPrimaryLabel(ht, enTr)).toBe(
        resolveToolPrimaryLabel(lt, enTr),
      );
    }
  });
});
