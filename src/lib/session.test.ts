import { describe, expect, it } from "vitest";
import {
  applyContextCompact,
  applyGeneratedImage,
  applyInterjection,
  applyStreamChunk,
  applyToolEvent,
  applyTurnError,
  buildSegmentsFromLegacy,
  canSend,
  canStop,
  canType,
  clearPriorTurnStreaming,
  compactMessageSegments,
  errorCopy,
  formatTurnErrorBody,
  isFailedToolStepMessage,
  messageSegments,
  splitThoughtPhases,
  isSessionBusy,
  isSessionLiveStreaming,
  isSessionNotLiveError,
  isTurnCancelledError,
  parseCompactContent,
  parseToolStepContent,
  pickLatestTurnTool,
  pickRunningTurnTool,
  toolStepDisplayTitle,
  preferSessionMessages,
  presentErrorBanner,
  snapshotOutgoingMessages,
  upgradeMessagesFromJournal,
  canLiftJournalLastTurn,
  settleStreamingOnHostReady,
  ensureBusyTurnStreaming,
  mergeSessionMessagesById,
  reconcileOptimisticDuplicates,
  isClientOptimisticId,
  weaveToolsIntoAssistantSegments,
  mergeToolsIntoAssistantSegments,
  reorderSegmentsToHistoryLayout,
  mergeAssistantFragments,
  pickAssistantFragmentCarrierIdx,
  filterTranscriptMessages,
  toolSegmentFromFields,
  upsertToolInSegments,
  stripAnsi,
  truncateBeforeLastUser,
  truncateThroughUserPrompt,
  endIndexThroughUserPrompt,
  canRewindToUserPrompt,
  userPromptIndexOf,
  countUserPrompts,
  lastUserRowIndex,
  lastUserMessageIndex,
  lastRegenerableAssistantId,
  canRegenerateAssistant,
  localRewindPoints,
  forkMessages,
  forkSessionTitle,
  type ChatMessage,
  type StreamPayload,
} from "./session";

describe("session projection", () => {
  it("input matrix Ready / Streaming / Stop (draft ok while stream; send blocked)", () => {
    expect(canType("ready")).toBe(true);
    expect(canType("idle")).toBe(true);
    // Draft allowed while streaming so the box is never "stuck" on pauses.
    expect(canType("streaming")).toBe(true);
    expect(canType("awaiting_permission")).toBe(false);
    expect(canSend("ready")).toBe(true);
    expect(canSend("idle")).toBe(true);
    expect(canStop("ready")).toBe(false);
    expect(canStop("streaming")).toBe(true);
    expect(canSend("streaming")).toBe(false);
  });

  it("isSessionBusy covers connect / stream / permission", () => {
    expect(isSessionBusy("idle")).toBe(false);
    expect(isSessionBusy("ready")).toBe(false);
    expect(isSessionBusy("disconnected")).toBe(false);
    expect(isSessionBusy("connecting")).toBe(true);
    expect(isSessionBusy("streaming")).toBe(true);
    expect(isSessionBusy("awaiting_permission")).toBe(true);
  });

  it("isSessionLiveStreaming excludes connecting (sidebar spinner silent)", () => {
    expect(isSessionLiveStreaming("connecting")).toBe(false);
    expect(isSessionLiveStreaming("idle")).toBe(false);
    expect(isSessionLiveStreaming("ready")).toBe(false);
    expect(isSessionLiveStreaming("streaming")).toBe(true);
    expect(isSessionLiveStreaming("awaiting_permission")).toBe(true);
  });

  it("isSessionNotLiveError only matches Host's targeted-send refusal", () => {
    // Host string form (tauri invoke rejects with the message).
    expect(
      isSessionNotLiveError(
        "CONNECT_FAILED: chat abc has no live agent process — reconnect and retry",
      ),
    ).toBe(true);
    expect(
      isSessionNotLiveError(
        new Error("CONNECT_FAILED: chat abc lost focus before send — retry"),
      ),
    ).toBe(true);
    // Mirror RPC error object shape.
    expect(
      isSessionNotLiveError({
        code: "HOST_ERROR",
        message: "CONNECT_FAILED: chat abc has no live agent process",
      }),
    ).toBe(true);
    // Other connect failures must NOT trigger the send retry loop.
    expect(
      isSessionNotLiveError("CONNECT_FAILED: handshake timed out"),
    ).toBe(false);
    expect(isSessionNotLiveError("PROCESS_LIMIT: pool full")).toBe(false);
    expect(isSessionNotLiveError(null)).toBe(false);
    expect(isSessionNotLiveError(undefined)).toBe(false);
    expect(
      isSessionNotLiveError(
        "TURN_CANCELLED: turn x no longer active after prepare; prompt not dispatched",
      ),
    ).toBe(false);
  });

  it("isTurnCancelledError matches Host skip-prompt after Stop/stall", () => {
    expect(
      isTurnCancelledError(
        "TURN_CANCELLED: turn x no longer active after prepare; prompt not dispatched",
      ),
    ).toBe(true);
    expect(
      isTurnCancelledError({
        message:
          "TURN_CANCELLED: turn x no longer active after prepare; prompt not dispatched",
      }),
    ).toBe(true);
    expect(isTurnCancelledError("CONNECT_FAILED: no live agent process")).toBe(
      false,
    );
  });

  it("truncateBeforeLastUser drops last user turn and everything after", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      { id: "a1", role: "assistant", content: "ok" },
      { id: "u2", role: "user", content: "second" },
      { id: "a2", role: "assistant", content: "fail", isError: true },
    ];
    expect(truncateBeforeLastUser(msgs)).toEqual([
      { id: "u1", role: "user", content: "first" },
      { id: "a1", role: "assistant", content: "ok" },
    ]);
    expect(
      truncateBeforeLastUser([{ id: "u1", role: "user", content: "only" }]),
    ).toEqual([]);
    expect(truncateBeforeLastUser([])).toEqual([]);
  });

  it("truncateBeforeLastUser skips interjections when finding the last prompt", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "start" },
      { id: "a1", role: "assistant", content: "ok" },
      { id: "s1", role: "user", content: "还没好吗", marker: "interjection" },
      { id: "s2", role: "user", content: "？", marker: "interjection" },
      { id: "u2", role: "user", content: "做的怎么样了" },
    ];
    expect(truncateBeforeLastUser(msgs).map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "s1",
      "s2",
    ]);
  });

  it("lastRegenerableAssistantId / canRegenerateAssistant gate last turn only", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      { id: "a1", role: "assistant", content: "ok" },
      { id: "u2", role: "user", content: "second" },
      { id: "a2", role: "assistant", content: "later" },
    ];
    expect(lastRegenerableAssistantId(msgs)).toBe("a2");
    expect(canRegenerateAssistant(msgs, "a2")).toBe(true);
    expect(canRegenerateAssistant(msgs, "a1")).toBe(false);
    expect(
      lastRegenerableAssistantId([
        { id: "u1", role: "user", content: "only" },
      ]),
    ).toBeNull();
    expect(
      lastRegenerableAssistantId([
        { id: "u1", role: "user", content: "q" },
        { id: "a1", role: "assistant", content: "", streaming: true },
      ]),
    ).toBeNull();
    expect(
      lastRegenerableAssistantId([
        { id: "u1", role: "user", content: "q" },
        { id: "a1", role: "assistant", content: "fail", isError: true },
      ]),
    ).toBe("a1");
  });

  it("truncateThroughUserPrompt keeps the selected turn (ACP rewind semantics)", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      { id: "t1", role: "tool", content: "tool", marker: "tool_step" },
      { id: "a1", role: "assistant", content: "ok" },
      { id: "u2", role: "user", content: "second" },
      { id: "a2", role: "assistant", content: "later" },
    ];
    expect(truncateThroughUserPrompt(msgs, 0).map((m) => m.id)).toEqual([
      "u1",
      "t1",
      "a1",
    ]);
    expect(truncateThroughUserPrompt(msgs, 1).map((m) => m.id)).toEqual([
      "u1",
      "t1",
      "a1",
      "u2",
      "a2",
    ]);
    expect(truncateThroughUserPrompt(msgs, 2)).toEqual([]);
    expect(endIndexThroughUserPrompt(msgs, 0)).toBe(3);
    expect(canRewindToUserPrompt(msgs, 0)).toBe(true);
    expect(canRewindToUserPrompt(msgs, 1)).toBe(false);
    expect(userPromptIndexOf(msgs, "u2")).toBe(1);
    expect(userPromptIndexOf(msgs, "a1")).toBe(-1);
    expect(countUserPrompts(msgs)).toBe(2);
  });

  it("keeps interjections inside the surrounding rewind turn", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      { id: "a1", role: "assistant", content: "working" },
      {
        id: "i1",
        role: "user",
        content: "steer",
        marker: "interjection",
      },
      { id: "u2", role: "user", content: "next" },
    ];

    expect(countUserPrompts(messages)).toBe(2);
    expect(userPromptIndexOf(messages, "i1")).toBe(-1);
    expect(endIndexThroughUserPrompt(messages, 0)).toBe(3);
  });

  it("starts a new assistant row after a mid-turn interjection", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "build it" },
      {
        id: "a1",
        role: "assistant",
        content: "Working",
        streaming: true,
      },
    ];

    messages = applyInterjection(messages, {
      id: "i1",
      role: "user",
      content: "Use the existing component",
      marker: "interjection",
    });

    // Immediately seeds a live post-steer shell so thinking chrome keeps ticking.
    expect(messages.map((message) => message.id)).toEqual([
      "u1",
      "a1",
      "i1",
      "a-pending-steer-i1",
    ]);
    expect(messages[1]).toMatchObject({
      id: "a1",
      content: "Working",
      streaming: false,
    });
    expect(messages[3]).toMatchObject({
      id: "a-pending-steer-i1",
      streaming: true,
    });

    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a2",
      text: " on it",
      done: false,
      kind: "assistant",
    });

    expect(messages.map((message) => message.id)).toEqual([
      "u1",
      "a1",
      "i1",
      "a2",
    ]);
    expect(messages[3]).toMatchObject({
      id: "a2",
      content: " on it",
      streaming: true,
    });
  });

  it("uses host postStreamMessageId for the live post-steer shell", () => {
    const messages = applyInterjection(
      [
        { id: "u1", role: "user", content: "build it" },
        { id: "a1", role: "assistant", content: "Working", streaming: true },
      ],
      {
        id: "i1",
        role: "user",
        content: "steer",
        marker: "interjection",
      },
      "host-post-stream-id",
    );
    expect(messages.at(-1)).toMatchObject({
      id: "host-post-stream-id",
      role: "assistant",
      streaming: true,
      content: "",
    });
  });

  it("empty done does not kill post-steer thinking shell (no blank gap)", () => {
    let messages = applyInterjection(
      [
        { id: "u1", role: "user", content: "build it" },
        { id: "a1", role: "assistant", content: "Working", streaming: true },
      ],
      {
        id: "i1",
        role: "user",
        content: "steer me",
        marker: "interjection",
      },
      "post-1",
    );
    // Pre-steer segment done (or global empty done) must not blank the shell.
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "",
      done: true,
      kind: "assistant",
    });
    expect(messages.find((m) => m.id === "post-1")).toMatchObject({
      streaming: true,
      content: "",
    });
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      text: "",
      done: true,
      kind: "assistant",
    });
    expect(messages.find((m) => m.id === "post-1")).toMatchObject({
      streaming: true,
    });
    // Real tokens still bind and can finish.
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "post-1",
      text: "ok",
      done: true,
      kind: "assistant",
    });
    expect(messages.find((m) => m.id === "post-1")).toMatchObject({
      content: "ok",
      streaming: false,
    });
  });

  it("drops an empty optimistic assistant when interjected before output", () => {
    const messages = applyInterjection(
      [
        { id: "u1", role: "user", content: "build it" },
        {
          id: "a-pending-1",
          role: "assistant",
          content: "",
          streaming: true,
        },
      ],
      {
        id: "i1",
        role: "user",
        content: "Use the existing component",
        marker: "interjection",
      },
    );

    // Empty pre-steer shell dropped; new live post-steer shell appended.
    expect(messages.map((message) => message.id)).toEqual([
      "u1",
      "i1",
      "a-pending-steer-i1",
    ]);
    expect(messages[2]).toMatchObject({ streaming: true });
  });

  it("does not revive a frozen pre-steer assistant when the old stream id keeps ticking", () => {
    // User report: mid-turn 引导 then the transcript flashes. Host may still
    // emit thought/body/done on the pre-steer message id. Binding those
    // chunks back onto a1 flips streaming and swaps the Worked-for rail
    // between a one-line header and the full tool list.
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "set 死三條選擇題" },
      {
        id: "a1",
        role: "assistant",
        content: "得，就改成三條死選擇題。",
        streaming: true,
        segments: [
          { kind: "thought", text: "plan" },
          {
            kind: "tool",
            toolCallId: "t1",
            title: "Read form",
            toolKind: "read_file",
            status: "completed",
          },
          {
            kind: "tool",
            toolCallId: "t2",
            title: "Edit quiz",
            toolKind: "search_replace",
            status: "completed",
          },
          { kind: "content", text: "得，就改成三條死選擇題。" },
        ],
      },
    ];
    messages = applyInterjection(messages, {
      id: "i1",
      role: "user",
      content: "A、B、C 只係例子",
      marker: "interjection",
    });
    expect(messages.find((m) => m.id === "a1")?.streaming).toBe(false);

    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: " still thinking on the old segment",
      done: false,
      kind: "thought",
    });
    expect(messages.find((m) => m.id === "a1")?.streaming).toBe(false);
    expect(messages.find((m) => m.id === "a1")?.thought ?? "").not.toContain(
      "old segment",
    );
    const post = messages.find((m) => m.id === "a-pending-steer-i1");
    expect(post?.streaming).toBe(true);
    expect(post?.thought ?? "").toContain("old segment");

    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: " leftover body",
      done: false,
      kind: "assistant",
    });
    expect(messages.find((m) => m.id === "a1")?.streaming).toBe(false);
    expect(messages.find((m) => m.id === "a1")?.content).toBe(
      "得，就改成三條死選擇題。",
    );
    expect(messages.find((m) => m.id === "a-pending-steer-i1")?.content).toContain(
      "leftover body",
    );
  });

  it("lastUserRowIndex counts steer; lastUserMessageIndex skips it", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "q" },
      { id: "a1", role: "assistant", content: "working" },
      {
        id: "i1",
        role: "user",
        content: "steer",
        marker: "interjection",
      },
      { id: "a2", role: "assistant", content: "", streaming: true },
    ];
    expect(lastUserMessageIndex(messages)).toBe(0);
    expect(lastUserRowIndex(messages)).toBe(2);
  });

    it("localRewindPoints lists one entry per user prompt", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "  hello   world  " },
      { id: "a1", role: "assistant", content: "ok" },
      { id: "u2", role: "user", content: "x".repeat(100) },
    ];
    const pts = localRewindPoints(msgs, { previewMax: 10 });
    expect(pts).toEqual([
      { promptIndex: 0, messageId: "u1", preview: "hello wor…" },
      {
        promptIndex: 1,
        messageId: "u2",
        preview: "xxxxxxxxx…",
      },
    ]);
  });

  it("forkMessages copies through a turn and remaps ids", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "first", streaming: true },
      { id: "a1", role: "assistant", content: "ok" },
      { id: "u2", role: "user", content: "second" },
    ];
    const forked = forkMessages(msgs, {
      throughUserPromptIndex: 0,
      idPrefix: "f",
    });
    expect(forked).toHaveLength(2);
    expect(forked[0].id).toMatch(/^f-0-u1$/);
    expect(forked[0].streaming).toBe(false);
    expect(forked[0].content).toBe("first");
    expect(forked[1].id).toMatch(/^f-1-a1$/);
    const full = forkMessages(msgs, { remapIds: false });
    expect(full.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("forkSessionTitle prefixes once", () => {
    expect(forkSessionTitle("My chat")).toBe("Fork of My chat");
    expect(forkSessionTitle("Fork of My chat")).toBe("Fork of My chat");
    expect(forkSessionTitle("")).toBe("Fork of chat");
  });

  it("preferSessionMessages keeps optimistic / streaming cache over disk", () => {
    const stored: ChatMessage[] = [
      { id: "u1", role: "user", content: "old" },
    ];
    const cached: ChatMessage[] = [
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "partial", streaming: true },
    ];
    // Streaming cache kept, but disk-only rows still merge in
    const mergedStream = preferSessionMessages(cached, stored);
    expect(mergedStream.some((m) => m.streaming)).toBe(true);
    expect(preferSessionMessages(undefined, stored)).toEqual(stored);
    expect(preferSessionMessages([], stored)).toEqual(stored);
    // Equal length, disk has more text → prefer disk base
    const doneCache: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "ok" },
    ];
    const doneStore: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "ok full" },
    ];
    const done = preferSessionMessages(doneCache, doneStore);
    expect(done.find((m) => m.id === "a1")?.content).toBe("ok full");
  });

  it("upgradeMessagesFromJournal lifts truncated stream tails from disk", () => {
    const ui: ChatMessage[] = [
      { id: "u1", role: "user", content: "see image" },
      {
        id: "a1",
        role: "assistant",
        content: "也对应「铁柱 + 鲸鱼 +",
        streaming: false,
      },
    ];
    const journal: ChatMessage[] = [
      { id: "u1", role: "user", content: "see image" },
      {
        id: "a1",
        role: "assistant",
        content: "也对应「铁柱 + 鲸鱼 + 像素」的主题。",
      },
    ];
    const out = upgradeMessagesFromJournal(ui, journal);
    expect(out.find((m) => m.id === "a1")?.content).toBe(
      "也对应「铁柱 + 鲸鱼 + 像素」的主题。",
    );
    // Idempotent when UI already has full body
    expect(upgradeMessagesFromJournal(out, journal)).toBe(out);
  });

  it("upgradeMessagesFromJournal keeps streaming on a live mid-turn bubble", () => {
    const ui: ChatMessage[] = [
      { id: "u1", role: "user", content: "测一下" },
      {
        id: "a1",
        role: "assistant",
        content: "先睇 Ego Lite",
        thought: "plan",
        streaming: true,
      },
    ];
    const journal: ChatMessage[] = [
      { id: "u1", role: "user", content: "测一下" },
      {
        id: "a1",
        role: "assistant",
        content: "先睇 Ego Lite 點用，再確認本地 5173。",
        thought: "plan\n\nmore reasoning after tools",
      },
    ];
    const out = upgradeMessagesFromJournal(ui, journal);
    const asst = out.find((m) => m.id === "a1");
    expect(asst?.content).toContain("5173");
    expect(asst?.thought).toContain("more reasoning");
    expect(asst?.streaming).toBe(true);
  });

  it("ensureBusyTurnStreaming restores live flag when Host is still streaming", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
      { id: "a1", role: "assistant", content: "先睇 Ego Lite", thought: "plan" },
    ];
    expect(ensureBusyTurnStreaming(msgs, "ready")).toBe(msgs);
    const live = ensureBusyTurnStreaming(msgs, "streaming");
    expect(live.find((m) => m.id === "a1")?.streaming).toBe(true);
    const already: ChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
      { id: "a1", role: "assistant", content: "hi", streaming: true },
    ];
    expect(ensureBusyTurnStreaming(already, "streaming")).toBe(already);
    expect(ensureBusyTurnStreaming(msgs, "awaiting_permission")[1]?.streaming).toBe(
      true,
    );
  });

  it("ensureBusyTurnStreaming + weave keeps a switch-back turn live", () => {
    // Disk journal after background tools: no streaming flag (stored rows
    // never have one). Switching back must not look finished.
    const stored: ChatMessage[] = [
      { id: "u1", role: "user", content: "测" },
      {
        id: "a1",
        role: "assistant",
        content: "先睇 Ego Lite。5173 已經開住。",
        thought: "round1\n\nround2",
        createdAt: "2026-08-13T14:54:20Z",
      },
      {
        id: "tool-t1",
        role: "tool",
        content: "Read skill",
        marker: "tool_step",
        toolCallId: "t1",
        toolKind: "read_file",
        toolStatus: "completed",
      },
    ];
    const painted = ensureBusyTurnStreaming(
      weaveToolsIntoAssistantSegments(stored),
      "streaming",
    );
    const asst = painted.find((m) => m.role === "assistant");
    expect(asst?.streaming).toBe(true);
  });

  it("preferSessionMessages merges Remote IM disk rows into cache", () => {
    const cached: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi", createdAt: "2026-07-24T00:00:00Z" },
      { id: "a1", role: "assistant", content: "yo", createdAt: "2026-07-24T00:00:01Z" },
    ];
    const stored: ChatMessage[] = [
      ...cached,
      {
        id: "u-im",
        role: "user",
        content: "[Remote IM · weixin]\n继续",
        createdAt: "2026-07-25T00:00:00Z",
      },
      {
        id: "a-im",
        role: "assistant",
        content: "好的",
        createdAt: "2026-07-25T00:00:01Z",
      },
    ];
    const out = preferSessionMessages(cached, stored);
    expect(out.map((m) => m.id)).toEqual(["u1", "a1", "u-im", "a-im"]);
  });

  it("preferSessionMessages drops optimistic user when host UUID already has same body", () => {
    // After turn completes: cache still has u-${ts}, disk has host UUID.
    // Switch away → switch back must not append the first user bubble again.
    const cached: ChatMessage[] = [
      {
        id: "u-1710000000000",
        role: "user",
        content: "找一下奇妙森林这个项目有什么内容",
      },
      {
        id: "a1",
        role: "assistant",
        content: "概览……",
        segments: [
          { kind: "thought", text: "plan" },
          {
            kind: "tool",
            toolCallId: "t1",
            title: "Read",
            status: "completed",
          },
          { kind: "content", text: "概览……" },
        ],
      },
    ];
    const stored: ChatMessage[] = [
      {
        id: "6749cf2f-57b2-4576-b940-60957e43cd44",
        role: "user",
        content: "找一下奇妙森林这个项目有什么内容",
      },
      {
        id: "840227fd-3a82-4432-a829-49c18aa61327",
        role: "assistant",
        content: "概览……",
      },
      {
        id: "tool-t1",
        role: "tool",
        content: "Read x",
        marker: "tool_step",
        toolCallId: "t1",
        toolStatus: "completed",
      },
    ];
    const out = preferSessionMessages(cached, stored);
    const users = out.filter((m) => m.role === "user");
    expect(users).toHaveLength(1);
    expect(isClientOptimisticId(users[0]!.id)).toBe(false);
    expect(out[out.length - 1]!.role).not.toBe("user");
    // User stays at the head (in-place replace), not moved to the tail.
    expect(out[0]!.role).toBe("user");
  });

  it("reconcileOptimisticDuplicates replaces u-${ts} in place (not tail)", () => {
    const msgs: ChatMessage[] = [
      {
        id: "u-1710000000001",
        role: "user",
        content: "hello",
      },
      { id: "uuid-asst", role: "assistant", content: "hi" },
      {
        id: "uuid-user",
        role: "user",
        content: "hello",
      },
    ];
    const out = reconcileOptimisticDuplicates(msgs);
    expect(out.map((m) => m.id)).toEqual(["uuid-user", "uuid-asst"]);
    expect(out[0]!.role).toBe("user");
  });

  it("applyStreamChunk grows assistant text once per chunk", () => {
    let messages: ChatMessage[] = [];
    const chunks: StreamPayload[] = [
      { sessionId: "s", messageId: "m1", text: "Hel", done: false, kind: "assistant" },
      { sessionId: "s", messageId: "m1", text: "lo", done: false, kind: "assistant" },
      { sessionId: "s", messageId: "m1", text: "", done: true, kind: "assistant" },
    ];
    for (const c of chunks) messages = applyStreamChunk(messages, c);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("Hello");
    expect(messages[0]!.streaming).toBe(false);
  });

  it("does not double-append when same sequence applied once", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
    ];
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "直接",
      done: false,
      kind: "assistant",
    });
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "干活",
      done: true,
      kind: "assistant",
    });
    expect(messages.find((m) => m.role === "assistant")!.content).toBe("直接干活");
  });

  it("splitThoughtPhases separates multi-phase markers", () => {
    expect(splitThoughtPhases("a\n\n⟪phase⟫\n\nb")).toEqual(["a", "b"]);
    expect(splitThoughtPhases("only")).toEqual(["only"]);
  });

  it("isFailedToolStepMessage detects failed tools only", () => {
    expect(
      isFailedToolStepMessage({
        id: "tool-a",
        role: "tool",
        content: "Read x",
        marker: "tool_step",
        toolStatus: "completed",
      }),
    ).toBe(false);
    expect(
      isFailedToolStepMessage({
        id: "tool-b",
        role: "tool",
        content: "Bash",
        marker: "tool_step",
        toolStatus: "failed",
        isError: true,
      }),
    ).toBe(true);
  });

  it("spurious new-phase without body merges into one thought (no 思考 2)", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        thought: "first",
        thoughtPhases: ["first"],
        segments: [{ kind: "thought", text: "first" }],
        streaming: true,
      },
    ];
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "second",
      done: false,
      kind: "thought",
      thoughtPhase: "new",
    });
    // Adjacent thoughts must not become multiple UI rows.
    expect(messages[1]!.segments).toEqual([
      { kind: "thought", text: "firstsecond" },
    ]);
    expect(messages[1]!.thoughtPhases).toEqual(["firstsecond"]);
  });

  it("buildSegmentsFromLegacy stacks multi-phase thought before body", () => {
    const segs = buildSegmentsFromLegacy(
      "answer body",
      "a\n\n⟪phase⟫\n\nb\n\n⟪phase⟫\n\nc",
      undefined,
    );
    // One thought block + body — never "body then 思考 2 / 3".
    expect(segs).toEqual([
      { kind: "thought", text: "a\n\nb\n\nc" },
      { kind: "content", text: "answer body" },
    ]);
  });

  it("compactMessageSegments merges adjacent thoughts", () => {
    expect(
      compactMessageSegments([
        { kind: "thought", text: "a" },
        { kind: "thought", text: "b" },
        { kind: "content", text: "hi" },
        { kind: "thought", text: "c" },
        { kind: "thought", text: "" },
      ]),
    ).toEqual([
      { kind: "thought", text: "a\n\nb" },
      { kind: "content", text: "hi" },
      { kind: "thought", text: "c" },
    ]);
  });

  it("compactMessageSegments keeps tools and coalesces same toolCallId", () => {
    const segs = compactMessageSegments([
      { kind: "thought", text: "t" },
      {
        kind: "tool",
        toolCallId: "x",
        title: "Read a",
        status: "running",
        streaming: true,
      },
      {
        kind: "tool",
        toolCallId: "x",
        title: "Read a",
        status: "completed",
        streaming: false,
      },
      { kind: "content", text: "done" },
    ]);
    expect(segs.map((s) => s.kind)).toEqual(["thought", "tool", "content"]);
    expect(segs[1]).toMatchObject({
      kind: "tool",
      toolCallId: "x",
      status: "completed",
      streaming: false,
    });
  });

  it("messageSegments compacts live multi thought rows", () => {
    const segs = messageSegments({
      id: "a1",
      role: "assistant",
      content: "done",
      segments: [
        { kind: "thought", text: "p1" },
        { kind: "thought", text: "p2" },
        { kind: "content", text: "done" },
        { kind: "thought", text: "p3" },
      ],
    });
    expect(segs).toEqual([
      { kind: "thought", text: "p1\n\np2" },
      { kind: "content", text: "done" },
      { kind: "thought", text: "p3" },
    ]);
  });

  it("filterTranscriptMessages drops inlined tool_step rows", () => {
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "hi" },
      {
        id: "a1",
        role: "assistant",
        content: "done",
        thought: "think",
      },
      {
        id: "tool-call-1",
        role: "tool",
        content: "tool_step|completed||run",
        marker: "tool_step",
        toolCallId: "call-1",
      },
      {
        id: "tool-call-2",
        role: "tool",
        content: "tool_step|completed||run2",
        marker: "tool_step",
        toolCallId: "call-2",
      },
    ]);
    const asst = woven.find((m) => m.id === "a1")!;
    expect(
      asst.segments?.filter((s) => s.kind === "tool").length,
    ).toBeGreaterThanOrEqual(2);
    // All journal tools in the turn are woven → paint list is user+assistant only.
    const out = filterTranscriptMessages(woven);
    expect(out.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(out).toHaveLength(2);
  });

  it("filterTranscriptMessages keeps standalone tools not on any assistant", () => {
    const rows = [
      { id: "u1", role: "user" as const, content: "hi" },
      {
        id: "tool-only",
        role: "tool" as const,
        content: "tool_step|completed||solo",
        marker: "tool_step",
        toolCallId: "solo",
      },
    ];
    expect(filterTranscriptMessages(rows).map((m) => m.id)).toEqual([
      "u1",
      "tool-only",
    ]);
  });

  it("mergeAssistantFragments folds per-fragment history into one message", () => {
    const rows: ChatMessage[] = [
      { id: "u1", role: "user", content: "做一张图" },
      {
        id: "a1",
        role: "assistant",
        content: "以素材编译并生成信息图。",
        thought: "读技能",
        createdAt: "2026-08-04T15:40:21.206529Z",
      },
      {
        id: "tool-call-16",
        role: "tool",
        content: "tool_step|completed|tool|tool",
        marker: "tool_step",
        toolCallId: "call-16",
      },
      {
        id: "a2",
        role: "assistant",
        content: "正在构建信息图，并渲染为图片。",
        createdAt: "2026-08-04T15:40:21.208529Z",
      },
      {
        id: "a3",
        role: "assistant",
        content: "检查生成图片的视觉效果与文字准确性。",
        createdAt: "2026-08-04T15:40:21.209529Z",
      },
      {
        id: "a4",
        role: "assistant",
        content: "中间留白偏多，收紧版式。",
        thought: "第二段思考",
        createdAt: "2026-08-04T15:40:21.210529Z",
      },
    ];
    const merged = mergeAssistantFragments(rows);
    const asst = merged.filter((m) => m.role === "assistant");
    expect(asst).toHaveLength(1);
    expect(asst[0]!.id).toBe("a4");
    expect(asst[0]!.content).toBe("中间留白偏多，收紧版式。");
    expect(asst[0]!.leadFragments).toEqual([
      "以素材编译并生成信息图。",
      "正在构建信息图，并渲染为图片。",
      "检查生成图片的视觉效果与文字准确性。",
    ]);
    // Thoughts from every fragment are preserved (phases joined).
    expect(asst[0]!.thought).toContain("读技能");
    expect(asst[0]!.thought).toContain("第二段思考");
    // Tool row survives (weave attaches it later).
    expect(merged.some((m) => m.id === "tool-call-16")).toBe(true);
    // Weaving a merged turn: tool lands on the single assistant message.
    const woven = weaveToolsIntoAssistantSegments(rows);
    const wAsst = woven.find((m) => m.role === "assistant")!;
    expect(
      wAsst.segments?.filter((s) => s.kind === "tool").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("mergeAssistantFragments folds a later finished fragment into a live sibling", () => {
    const rows: ChatMessage[] = [
      { id: "u1", role: "user", content: "pack it" },
      {
        id: "a-live",
        role: "assistant",
        content: "still working on the increment",
        streaming: true,
      },
      {
        id: "a-done",
        role: "assistant",
        content: "kernel rebuild failed; switching runtime",
        streaming: false,
      },
    ];
    const merged = mergeAssistantFragments(rows);
    const asst = merged.filter((m) => m.role === "assistant");
    expect(asst).toHaveLength(1);
    expect(asst[0]!.id).toBe("a-live");
    expect(asst[0]!.streaming).toBe(true);
    expect(asst[0]!.content).toContain("still working on the increment");
    expect(asst[0]!.content).toContain("kernel rebuild failed");
  });

  it("mergeAssistantFragments does not duplicate multi-segment finished bodies", () => {
    const rows: ChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
      {
        id: "a-live",
        role: "assistant",
        content: "looking",
        streaming: true,
      },
      {
        id: "a-done",
        role: "assistant",
        content: "part one\n\npart two",
        streaming: false,
        segments: [
          { kind: "content", text: "part one" },
          { kind: "thought", text: "hmm" },
          { kind: "content", text: "part two" },
        ],
      },
    ];
    const merged = mergeAssistantFragments(rows);
    const asst = merged.filter((m) => m.role === "assistant");
    expect(asst).toHaveLength(1);
    const body = asst[0]!.content ?? "";
    expect(body.match(/part one/g)?.length).toBe(1);
    expect(body.match(/part two/g)?.length).toBe(1);
    const contentSegs = (asst[0]!.segments ?? []).filter((s) => s.kind === "content");
    const joined = contentSegs.map((s) => s.text).join("\n");
    expect(joined.match(/part one/g)?.length).toBe(1);
    expect(joined.match(/part two/g)?.length).toBe(1);
    expect(asst[0]!.segments?.some((s) => s.kind === "thought" && s.text === "hmm")).toBe(
      true,
    );
  });

  it("mergeAssistantFragments leaves live / single-row turns untouched", () => {
    const rows: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      {
        id: "a1",
        role: "assistant",
        content: "live answer",
        streaming: true,
      },
    ];
    const merged = mergeAssistantFragments(rows);
    expect(merged).toHaveLength(2);
    expect(merged[1]!.id).toBe("a1");
    expect(merged[1]!.leadFragments).toBeUndefined();
  });

  it("mergeAssistantFragments prefers full stream buffer over trailing mid-status", () => {
    // Session export f2789928: host stream row holds the full answer; mid-turn
    // reconcile injects a short "正在生成…" row after tools. Last-non-empty
    // would bury the real answer in leadFragments.
    const mid =
      "已识别画面：宇航员站在异星山脊，凝望巨大类木星。正在生成约 6 秒的电影感动画。";
    const full =
      `你要用图片生成视频。${mid}视频已生成完成。\n\n**文件位置：** [videos/1.mp4](videos/1.mp4)\n\n**效果说明：** 电影感缓慢推进。`;
    const rows: ChatMessage[] = [
      { id: "u1", role: "user", content: "使用这张图片生成视频" },
      {
        id: "a-full",
        role: "assistant",
        content: full,
        createdAt: "2026-08-05T05:00:43.090984Z",
      },
      {
        id: "tool-1",
        role: "tool",
        content: "tool_step|completed|image_to_video|Generate Video",
        marker: "tool_step",
        toolCallId: "call-vid",
      },
      {
        id: "a-mid",
        role: "assistant",
        content: mid,
        createdAt: "2026-08-05T05:00:36.746052Z",
      },
    ];
    expect(pickAssistantFragmentCarrierIdx(rows, [1, 3])).toBe(1);
    const merged = mergeAssistantFragments(rows);
    const asst = merged.filter((m) => m.role === "assistant");
    expect(asst).toHaveLength(1);
    expect(asst[0]!.id).toBe("a-full");
    expect(asst[0]!.content).toBe(full);
    // Mid-status already inside full body — not duplicated as a lead note.
    expect(asst[0]!.leadFragments ?? []).toEqual([]);
  });

  it("upgradeMessagesFromJournal heals last-turn body across different ids", () => {
    const ui: ChatMessage[] = [
      { id: "u1", role: "user", content: "生成视频" },
      {
        id: "stream-id",
        role: "assistant",
        content: "已识别画面：正在生成…",
        streaming: false,
      },
    ];
    const journal: ChatMessage[] = [
      { id: "u1", role: "user", content: "生成视频" },
      {
        id: "stream-id",
        role: "assistant",
        content: "已识别画面：正在生成…",
      },
      {
        id: "reconcile-mid",
        role: "assistant",
        content: "短状态",
      },
      {
        id: "other",
        role: "assistant",
        content:
          "已识别画面：正在生成…视频已生成完成。\n\n文件位置：videos/1.mp4",
      },
    ];
    // Weave folds fragments; upgrade still sees journal list with longer row.
    const out = upgradeMessagesFromJournal(ui, journal);
    expect(out.find((m) => m.id === "stream-id")?.content).toContain(
      "视频已生成完成",
    );
  });

  it("upgradeMessagesFromJournal lifts a tool-only empty bubble from disk", () => {
    const ui: ChatMessage[] = [
      { id: "u1", role: "user", content: "删 branch" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        streaming: false,
        segments: [
          toolSegmentFromFields({
            toolCallId: "t1",
            title: "git",
            status: "completed",
          }),
        ],
      },
    ];
    const journal: ChatMessage[] = [
      { id: "u1", role: "user", content: "删 branch" },
      {
        id: "a1",
        role: "assistant",
        content: "昨晚那批已经清掉了。",
      },
    ];
    const out = upgradeMessagesFromJournal(ui, journal);
    expect(out.find((m) => m.id === "a1")?.content).toBe("昨晚那批已经清掉了。");
  });

  it("upgradeMessagesFromJournal does not copy the previous turn onto a queued pending", () => {
    const turn1 =
      "LONG TURN1 REPLY ".repeat(20);
    const ui: ChatMessage[] = [
      { id: "u1", role: "user", content: "long task" },
      {
        id: "a1",
        role: "assistant",
        content: turn1,
        streaming: false,
      },
      { id: "u-queued", role: "user", content: "ok continue" },
      {
        id: "a-pending-1",
        role: "assistant",
        content: "",
        streaming: true,
      },
    ];
    const journal: ChatMessage[] = [
      { id: "u1", role: "user", content: "long task" },
      { id: "a1", role: "assistant", content: turn1 },
    ];
    expect(canLiftJournalLastTurn(ui, journal)).toBe(false);
    const out = upgradeMessagesFromJournal(ui, journal);
    const pending = out.find((m) => m.id === "a-pending-1");
    expect(pending?.content ?? "").toBe("");
    expect(pending?.streaming).toBe(true);
    expect(out.find((m) => m.id === "a1")?.content).toBe(turn1);
  });

  it("upgradeMessagesFromJournal still lifts the queued turn once disk has caught up", () => {
    const ui: ChatMessage[] = [
      { id: "u1", role: "user", content: "long task" },
      { id: "a1", role: "assistant", content: "turn 1 answer" },
      { id: "u-queued", role: "user", content: "ok continue" },
      {
        id: "a-pending-1",
        role: "assistant",
        content: "",
        streaming: true,
      },
    ];
    const journal: ChatMessage[] = [
      { id: "u1", role: "user", content: "long task" },
      { id: "a1", role: "assistant", content: "turn 1 answer" },
      { id: "host-u2", role: "user", content: "ok continue" },
      {
        id: "host-a2",
        role: "assistant",
        content: "short follow-up",
      },
    ];
    expect(canLiftJournalLastTurn(ui, journal)).toBe(true);
    const out = upgradeMessagesFromJournal(ui, journal);
    expect(out.find((m) => m.id === "a-pending-1")?.content).toBe(
      "short follow-up",
    );
    expect(out.find((m) => m.id === "a-pending-1")?.streaming).toBe(true);
  });

  it("settleStreamingOnHostReady keeps a queued pending live", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      {
        id: "a1",
        role: "assistant",
        content: "answer one",
        streaming: true,
      },
      { id: "u-queued", role: "user", content: "second" },
      {
        id: "a-pending-2",
        role: "assistant",
        content: "",
        streaming: true,
      },
    ];
    const next = settleStreamingOnHostReady(msgs);
    expect(next.find((m) => m.id === "a1")?.streaming).toBe(false);
    expect(next.find((m) => m.id === "a-pending-2")?.streaming).toBe(true);
  });

  it("settleStreamingOnHostReady still freezes the finished turn when nothing is queued", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      {
        id: "host-a1",
        role: "assistant",
        content: "answer one",
        streaming: true,
      },
    ];
    const next = settleStreamingOnHostReady(msgs);
    expect(next.find((m) => m.id === "host-a1")?.streaming).toBe(false);
  });

  it("applyStreamChunk binds queued-turn tokens to the pending shell, not turn 1", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "long task" },
      {
        id: "a1",
        role: "assistant",
        content: "turn 1 answer",
        streaming: false,
      },
      { id: "u-queued", role: "user", content: "ok continue" },
      {
        id: "a-pending-1",
        role: "assistant",
        content: "",
        streaming: true,
      },
    ];
    const out = applyStreamChunk(msgs, {
      sessionId: "s1",
      messageId: "host-a2",
      text: "short follow-up",
      done: true,
      kind: "assistant",
    });
    expect(out.find((m) => m.id === "a1")?.content).toBe("turn 1 answer");
    expect(out.find((m) => m.id === "a-pending-1")).toBeUndefined();
    expect(out.find((m) => m.id === "host-a2")?.content).toBe("short follow-up");
  });

  it("applyStreamChunk attaches a late answer onto a settled empty assistant", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "删 branch" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        streaming: false,
      },
    ];
    const out = applyStreamChunk(msgs, {
      sessionId: "s1",
      messageId: "a1",
      text: "昨晚那批已经清掉了。",
      done: true,
      kind: "assistant",
    });
    expect(out.find((m) => m.id === "a1")?.content).toContain("清掉");
    expect(out.find((m) => m.id === "a1")?.streaming).toBe(false);
  });

  it("weaveToolsIntoAssistantSegments puts journal tools between thought and content", () => {
    // Host journal shape: U → A (final) → tools (tools ran mid-turn).
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "q" },
      {
        id: "a1",
        role: "assistant",
        content: "answer",
        createdAt: "2026-07-26T01:11:32Z",
        segments: [
          { kind: "thought", text: "why" },
          { kind: "content", text: "answer" },
        ],
      },
      {
        id: "tool-t1",
        role: "tool",
        content: "Read x",
        marker: "tool_step",
        toolCallId: "t1",
        toolKind: "read_file",
        toolStatus: "completed",
        toolPath: "/x.ts",
        createdAt: "2026-07-26T01:10:47Z",
      },
      {
        id: "tool-t2",
        role: "tool",
        content: "Edit y",
        marker: "tool_step",
        toolCallId: "t2",
        toolKind: "search_replace",
        toolStatus: "failed",
        isError: true,
        createdAt: "2026-07-26T01:10:58Z",
      },
    ]);
    const segs = messageSegments(woven[1]!);
    // History reconstruction: thought → tools → content (not tools under the answer).
    expect(segs.map((s) => s.kind)).toEqual([
      "thought",
      "tool",
      "tool",
      "content",
    ]);
    expect(segs[2]).toMatchObject({
      kind: "tool",
      toolCallId: "t2",
      isError: true,
    });
  });

  it("weaveToolsIntoAssistantSegments attaches tools that appear before assistant in array", () => {
    // Broken createdAt-sort shape: U → tools → A
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "q" },
      {
        id: "tool-t1",
        role: "tool",
        content: "Read x",
        marker: "tool_step",
        toolCallId: "t1",
        toolKind: "read_file",
        toolStatus: "completed",
      },
      {
        id: "tool-t2",
        role: "tool",
        content: "Read y",
        marker: "tool_step",
        toolCallId: "t2",
        toolKind: "read_file",
        toolStatus: "completed",
      },
      {
        id: "a1",
        role: "assistant",
        content: "answer",
        thought: "plan",
        segments: [
          { kind: "thought", text: "plan" },
          { kind: "content", text: "answer" },
        ],
      },
    ]);
    const segs = messageSegments(woven.find((m) => m.id === "a1")!);
    expect(segs.map((s) => s.kind)).toEqual([
      "thought",
      "tool",
      "tool",
      "content",
    ]);
  });

  it("mergeToolsIntoAssistantSegments completes live reads when later tools arrive", () => {
    // Live read still in_progress in segments; journal already completed it and
    // added a later bash. The weave used to append only the missing bash and
    // leave the read spinning at the top of 工作中.
    const segs = mergeToolsIntoAssistantSegments(
      [
        { kind: "thought", text: "plan" },
        {
          kind: "tool",
          toolCallId: "r1",
          title: "Read a",
          toolKind: "read_file",
          status: "in_progress",
          streaming: true,
        },
      ],
      [
        {
          kind: "tool",
          toolCallId: "r1",
          title: "Read a",
          toolKind: "read_file",
          status: "completed",
          streaming: false,
        },
        {
          kind: "tool",
          toolCallId: "b1",
          title: "Run",
          toolKind: "run_terminal_command",
          status: "in_progress",
          streaming: true,
        },
      ],
    );
    const tools = segs.filter(
      (s): s is Extract<typeof s, { kind: "tool" }> => s.kind === "tool",
    );
    expect(tools.map((t) => t.toolCallId)).toEqual(["r1", "b1"]);
    expect(tools[0]).toMatchObject({
      toolCallId: "r1",
      status: "completed",
      streaming: false,
    });
    expect(tools[1]).toMatchObject({
      toolCallId: "b1",
      status: "in_progress",
      streaming: true,
    });
  });

  it("weaveToolsIntoAssistantSegments settles inlined reads when the journal adds later tools", () => {
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "q" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        streaming: true,
        segments: [
          { kind: "thought", text: "plan" },
          {
            kind: "tool",
            toolCallId: "r1",
            title: "Read a",
            toolKind: "read_file",
            status: "in_progress",
            streaming: true,
          },
        ],
      },
      {
        id: "tool-r1",
        role: "tool",
        content: "tool_step|completed|read_file|Read a",
        marker: "tool_step",
        toolCallId: "r1",
        toolKind: "read_file",
        toolStatus: "completed",
      },
      {
        id: "tool-b1",
        role: "tool",
        content: "tool_step|in_progress|run_terminal_command|Run",
        marker: "tool_step",
        toolCallId: "b1",
        toolKind: "run_terminal_command",
        toolStatus: "in_progress",
      },
    ]);
    const segs = messageSegments(woven.find((m) => m.id === "a1")!);
    const tools = segs.filter(
      (s): s is Extract<typeof s, { kind: "tool" }> => s.kind === "tool",
    );
    expect(tools.map((t) => t.toolCallId)).toEqual(["r1", "b1"]);
    expect(tools[0]).toMatchObject({
      status: "completed",
      streaming: false,
    });
  });

  it("reorderSegmentsToHistoryLayout keeps think/tool/body interleave", () => {
    const segs = reorderSegmentsToHistoryLayout([
      { kind: "thought", text: "plan A" },
      {
        kind: "tool",
        toolCallId: "t1",
        title: "Read x",
        status: "completed",
        streaming: false,
      },
      { kind: "content", text: "partial…" },
      { kind: "thought", text: "plan B" },
      {
        kind: "tool",
        toolCallId: "t2",
        title: "Edit y",
        status: "completed",
        streaming: true,
      },
      { kind: "content", text: " final" },
    ]);
    expect(segs.map((s) => s.kind)).toEqual([
      "thought",
      "tool",
      "content",
      "thought",
      "tool",
      "content",
    ]);
    expect(segs[0]).toMatchObject({ kind: "thought", text: "plan A" });
    expect(segs[1]).toMatchObject({ kind: "tool", toolCallId: "t1" });
    expect(segs[2]).toMatchObject({ kind: "content", text: "partial…" });
    expect(segs[3]).toMatchObject({ kind: "thought", text: "plan B" });
    expect(segs[4]).toMatchObject({
      kind: "tool",
      toolCallId: "t2",
      streaming: false,
    });
    expect(segs[5]).toMatchObject({ kind: "content", text: " final" });
  });

  it("weaveToolsIntoAssistantSegments keeps finished live interleave without remount", () => {
    // Live turn left thought/tool interleaved with content; streaming=false.
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "q" },
      {
        id: "a1",
        role: "assistant",
        content: "hello world",
        streaming: false,
        segments: [
          { kind: "thought", text: "think" },
          {
            kind: "tool",
            toolCallId: "t1",
            title: "Read",
            status: "completed",
          },
          { kind: "content", text: "hello " },
          {
            kind: "tool",
            toolCallId: "t2",
            title: "Shell",
            status: "completed",
          },
          { kind: "content", text: "world" },
        ],
      },
    ]);
    const segs = messageSegments(woven.find((m) => m.id === "a1")!);
    expect(segs.map((s) => s.kind)).toEqual([
      "thought",
      "tool",
      "content",
      "tool",
      "content",
    ]);
    expect(segs[2]).toMatchObject({ kind: "content", text: "hello " });
    expect(segs[4]).toMatchObject({ kind: "content", text: "world" });
  });

  it("weaveToolsIntoAssistantSegments keeps live interleave while streaming", () => {
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "q" },
      {
        id: "a1",
        role: "assistant",
        content: "hello ",
        streaming: true,
        segments: [
          { kind: "thought", text: "think" },
          {
            kind: "tool",
            toolCallId: "t1",
            title: "Read",
            status: "completed",
          },
          { kind: "content", text: "hello " },
          {
            kind: "tool",
            toolCallId: "t2",
            title: "Shell",
            status: "in_progress",
            streaming: true,
          },
        ],
      },
    ]);
    const segs = messageSegments(woven.find((m) => m.id === "a1")!);
    expect(segs.map((s) => s.kind)).toEqual([
      "thought",
      "tool",
      "content",
      "tool",
    ]);
  });

  it("mergeSessionMessagesById keeps journal order (no createdAt re-sort)", () => {
    const primary: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "q",
        createdAt: "2026-07-26T01:10:41Z",
      },
      {
        id: "a1",
        role: "assistant",
        content: "answer",
        createdAt: "2026-07-26T01:11:32Z",
      },
      {
        id: "tool-t1",
        role: "tool",
        content: "Read",
        marker: "tool_step",
        createdAt: "2026-07-26T01:10:47Z",
      },
    ];
    const merged = mergeSessionMessagesById(primary, []);
    expect(merged.map((m) => m.id)).toEqual(["u1", "a1", "tool-t1"]);
  });

  it("places journal-only rows at their turn position, not at the tail", () => {
    // Regression: a mid-turn session switch can leave the cache holding only
    // the streaming assistant. Appending disk-only rows rendered the user's
    // own prompt *after* the finished answer.
    const cached: ChatMessage[] = [
      { id: "a-host", role: "assistant", content: "…answer…", streaming: true },
    ];
    const stored: ChatMessage[] = [
      { id: "u-host", role: "user", content: "查看项目内的内容" },
      { id: "a-host", role: "assistant", content: "…answer…" },
      { id: "tool-1", role: "tool", content: "tool_step|completed", marker: "tool_step" },
      { id: "tool-2", role: "tool", content: "tool_step|completed", marker: "tool_step" },
    ];
    expect(mergeSessionMessagesById(cached, stored).map((m) => m.id)).toEqual([
      "u-host",
      "a-host",
      "tool-1",
      "tool-2",
    ]);
    // Same through the real entry point the workbench uses.
    expect(preferSessionMessages(cached, stored).map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
    ]);
  });

  it("snapshotOutgoingMessages never clobbers a populated cache with an empty view", () => {
    const cached: ChatMessage[] = [
      { id: "u1", role: "user", content: "q" },
      { id: "a1", role: "assistant", content: "a" },
    ];
    // Workbench already cleared (user hit "new chat") — keep the real turn.
    expect(snapshotOutgoingMessages(cached, [])).toEqual(cached);
    // Normal case: the viewed thread is authoritative.
    const viewed: ChatMessage[] = [{ id: "u2", role: "user", content: "q2" }];
    expect(snapshotOutgoingMessages(cached, viewed)).toEqual(viewed);
    // Nothing anywhere → empty.
    expect(snapshotOutgoingMessages(undefined, [])).toEqual([]);
  });

  it("keeps repeated journal ids (tool_step rows share call ids)", () => {
    const primary: ChatMessage[] = [
      { id: "u1", role: "user", content: "q" },
      { id: "tool-call-a", role: "tool", content: "s1", marker: "tool_step" },
      { id: "tool-call-a", role: "tool", content: "s2", marker: "tool_step" },
    ];
    expect(mergeSessionMessagesById(primary, []).map((m) => m.id)).toEqual([
      "u1",
      "tool-call-a",
      "tool-call-a",
    ]);
  });

  it("interleaves several journal-only rows before their shared anchor", () => {
    const cached: ChatMessage[] = [{ id: "a1", role: "assistant", content: "x" }];
    const stored: ChatMessage[] = [
      { id: "u1", role: "user", content: "q1" },
      { id: "t1", role: "tool", content: "one", marker: "tool_step" },
      { id: "a1", role: "assistant", content: "x" },
      { id: "t2", role: "tool", content: "two", marker: "tool_step" },
    ];
    expect(mergeSessionMessagesById(cached, stored).map((m) => m.id)).toEqual([
      "u1",
      "t1",
      "a1",
      "t2",
    ]);
  });

  it("interleaves thought and content in stream order", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "", streaming: true },
    ];
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "think1",
      done: false,
      kind: "thought",
      thoughtPhase: "open",
    });
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "hello ",
      done: false,
      kind: "assistant",
    });
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "think2",
      done: false,
      kind: "thought",
      thoughtPhase: "new",
    });
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "world",
      done: false,
      kind: "assistant",
    });
    const a = messages[1]!;
    expect(a.segments).toEqual([
      { kind: "thought", text: "think1" },
      { kind: "content", text: "hello " },
      { kind: "thought", text: "think2" },
      { kind: "content", text: "world" },
    ]);
    expect(a.content).toBe("hello world");
    expect(a.thoughtPhases).toEqual(["think1", "think2"]);
  });

  it("stream chunks never append onto prior-turn assistants", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      {
        id: "a1",
        role: "assistant",
        content: "old answer",
        streaming: true, // stuck flag from missed done
      },
      { id: "u2", role: "user", content: "second" },
      { id: "a-pending-1", role: "assistant", content: "", streaming: true },
    ];
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a2",
      text: "new answer",
      done: false,
      kind: "assistant",
    });
    expect(messages.find((m) => m.id === "a1")!.content).toBe("old answer");
    const current = messages.find(
      (m) => m.id === "a2" || m.id === "a-pending-1",
    )!;
    expect(current.content).toBe("new answer");
    expect(current.id).toBe("a2"); // adopted host id
  });

  it("clearPriorTurnStreaming only clears assistants before last user", () => {
    const msgs: ChatMessage[] = [
      { id: "a0", role: "assistant", content: "x", streaming: true },
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "", streaming: true },
    ];
    const next = clearPriorTurnStreaming(msgs);
    expect(next[0]!.streaming).toBe(false);
    expect(next[2]!.streaming).toBe(true);
  });

  it("next-send optimistic path does not leave prior turn streaming (no re-type history)", () => {
    // Simulate turn 1 finished (done chunk) then user sends turn 2.
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      {
        id: "a1",
        role: "assistant",
        content: "answer one",
        streaming: true,
      },
    ];
    messages = applyStreamChunk(messages, {
      sessionId: "s",
      messageId: "a1",
      text: "",
      done: true,
      kind: "assistant",
    });
    expect(messages[1]!.streaming).toBe(false);
    expect(messages[1]!.content).toBe("answer one");

    // Same path as executeSend appendOptimistic: clear prior streaming flags
    // then append new user + pending assistant — prior content stays put once.
    const cleaned = clearPriorTurnStreaming(messages);
    const nextSend: ChatMessage[] = [
      ...cleaned,
      { id: "u2", role: "user", content: "second" },
      { id: "a-pending-2", role: "assistant", content: "", streaming: true },
    ];
    expect(nextSend.filter((m) => m.role === "assistant" && m.streaming)).toHaveLength(
      1,
    );
    expect(nextSend[1]!.content).toBe("answer one");
    expect(nextSend[1]!.streaming).toBe(false);
  });

  it("errorCopy distinguishes host error codes (English default)", () => {
    expect(errorCopy("CLI_NOT_FOUND")).toMatch(/CLI/i);
    expect(errorCopy("AUTH_FAILED")).toMatch(/Auth|sign.?in|credential/i);
    expect(errorCopy("NETWORK_PROVIDER")).toMatch(/Network|model|provider/i);
    expect(errorCopy("AGENT_CRASHED")).toMatch(/crash|process|agent/i);
    expect(errorCopy("QUOTA_EXCEEDED")).toMatch(/Quota|limit|usage/i);
    expect(errorCopy("CONNECT_FAILED")).toMatch(/connect/i);
    expect(errorCopy("PROCESS_LIMIT")).toMatch(/limit|process|concurrent/i);
    expect(errorCopy("SANDBOX_BLOCKED")).toMatch(/sandbox|namespace|linux|bwrap|sysctl/i);
  });

  it("formatTurnErrorBody maps bwrap uid-map denial to sandbox deck (#541)", () => {
    const body = formatTurnErrorBody(
      {
        code: "AGENT_CRASHED",
        message:
          "Agent stream closed (EOF); stderr: bwrap: setting up uid map: Permission denied",
      },
      "en",
    );
    expect(body.toLowerCase()).toMatch(/sandbox|namespace|sysctl|ubuntu/);
  });

  it("formatTurnErrorBody maps host NETWORK_PROVIDER + free-usage-exhausted to quota deck", () => {
    const body = formatTurnErrorBody(
      {
        code: "NETWORK_PROVIDER",
        message:
          "Provider request failed after 15 attempts (budget 15): API error (status 429 Too Many Requests): subscription:free-usage-exhausted: You've used all the included free usage for model grok-4.6 for now.",
      },
      "en",
    );
    expect(body.toLowerCase()).toMatch(/usage|quota|limit/);
    expect(body.toLowerCase()).not.toMatch(/network or model provider/);
    const zh = formatTurnErrorBody(
      {
        code: "QUOTA_EXCEEDED",
        message:
          "You've used all the included free usage for model grok-4.6 for now.",
      },
      "zh",
    );
    expect(zh).toMatch(/免费用量|上限/);
  });

  it("formatTurnErrorBody maps connect / quota phrases", () => {
    expect(
      formatTurnErrorBody(
        {
          content:
            "Could not connect the agent for this session; edit aborted.",
        },
        "en",
      ),
    ).toMatch(/connect/i);
    expect(
      formatTurnErrorBody({ content: "rate limit exceeded (429)" }, "en"),
    ).toMatch(/rate limited|wait a minute|busy/i);
  });

  it("presentErrorBanner shows friendly deck without MCP dumps", () => {
    const raw =
      'rpc timeout on session/prompt (id=4) after 600s; stderr: ...\nERROR worker quit with fatal: Connection refused';
    const fromAgent = presentErrorBanner(
      { code: "NETWORK_PROVIDER", message: raw },
      null,
      "en",
    );
    expect(fromAgent?.summary).toMatch(/timed?\s*out|timeout|network|model|provider/i);
    expect(fromAgent?.cause).toBeTruthy();
    expect(fromAgent?.summary).not.toMatch(/Connection refused/);
    expect(fromAgent?.summary).not.toMatch(/stderr/i);
    expect(fromAgent?.detail).toBeNull();
    expect(fromAgent?.primary?.id).toBeTruthy();
    expect(fromAgent?.reconnectHint).toBe(true);

    const fromLocal = presentErrorBanner(
      null,
      `NETWORK_PROVIDER: ${raw}`,
      "en",
    );
    // Host class may be NETWORK_PROVIDER, but "rpc timeout … after 600s" refines
    // to TURN_TIMEOUT (same path as agent timeout opts).
    expect(fromLocal?.code).toBe("TURN_TIMEOUT");
    expect(fromLocal?.summary).toMatch(/timed?\s*out|timeout|network|model|provider/i);
    expect(fromLocal?.detail).toBeNull();
    expect(fromLocal?.primary?.label.length).toBeGreaterThan(0);

    const short = presentErrorBanner(null, "Select a project first", "en");
    expect(short?.summary).toBe("Select a project first");
    expect(short?.detail).toBeNull();
    expect(short?.code).toBe("PROJECT_MISSING");
    expect(short?.primary?.id).toBe("relocate_project");
    expect(short?.secondary?.id).toBe("add_project");
  });

  it("presentErrorBanner decks trust / permission / MCP recoveries", () => {
    const trust = presentErrorBanner(
      null,
      'Trust project "Demo" first.',
      "en",
    );
    expect(trust?.code).toBe("WORKSPACE_UNTRUSTED");
    expect(trust?.primary?.id).toBe("trust_project");
    expect(trust?.summary).toContain("Demo");

    const perm = presentErrorBanner(
      null,
      "permission denied writing file",
      "en",
    );
    expect(perm?.code).toBe("PERMISSION_DENIED");
    expect(perm?.primary?.id).toBe("open_permissions");

    const mcp = presentErrorBanner(
      null,
      "MCP oauth authorization required",
      "en",
    );
    expect(mcp?.code).toBe("MCP_AUTH_FAILED");
    expect(mcp?.primary?.id).toBe("open_mcp");
  });

  it("presentErrorBanner decks the four product classes", () => {
    const cli = presentErrorBanner(
      { code: "CLI_NOT_FOUND", message: "missing" },
      null,
      "en",
    );
    expect(cli?.primary?.id).toBe("open_doctor");
    expect(cli?.secondary?.id).toBe("open_runtime");

    const auth = presentErrorBanner(
      { code: "AUTH_FAILED", message: "401" },
      null,
      "en",
    );
    expect(auth?.primary?.id).toBe("open_account");

    // CharlieLam: refine host AUTH_FAILED by message + active route.
    const noCtx = presentErrorBanner(
      {
        code: "AUTH_FAILED",
        message:
          "cli-proxy HTTP 401: Invalid or expired credentials (auth_kind=bearer, reason=no auth context)",
      },
      null,
      "en",
    );
    expect(noCtx?.code).toBe("AUTH_NO_CONTEXT");
    expect(noCtx?.primary?.id).toBe("open_providers");
    expect(noCtx?.secondary?.id).toBe("open_account");
    expect(noCtx?.summary.toLowerCase()).toMatch(/credential|auth|agent/);

    const badKey = presentErrorBanner(
      {
        code: "AUTH_FAILED",
        message: "Incorrect API key provided",
      },
      null,
      "en",
    );
    expect(badKey?.code).toBe("AUTH_API_KEY");
    expect(badKey?.primary?.id).toBe("open_providers");

    const custom = presentErrorBanner(
      { code: "AUTH_FAILED", message: "401 Unauthorized" },
      null,
      "en",
      { activeSource: "custom" },
    );
    expect(custom?.code).toBe("AUTH_CUSTOM_PROVIDER");
    expect(custom?.primary?.id).toBe("open_providers");
    expect(custom?.cause?.toLowerCase()).toMatch(/custom|relay|provider|key/);

    const crash = presentErrorBanner(
      { code: "AGENT_CRASHED", message: "exit 1" },
      null,
      "en",
    );
    expect(crash?.primary?.id).toBe("reconnect");
  });

  it("presentErrorBanner routes CLI_TOO_OLD to the upgrade deck", () => {
    const fromAgent = presentErrorBanner(
      {
        code: "CLI_TOO_OLD",
        message: "grok CLI 0.2.101 is older than the required 0.2.112",
      },
      null,
      "en",
    );
    expect(fromAgent?.code).toBe("CLI_TOO_OLD");
    expect(fromAgent?.primary?.id).toBe("upgrade_cli");

    // From the launch-time probe (coded localError string).
    const fromLocal = presentErrorBanner(
      null,
      "CLI_TOO_OLD: grok CLI 0.2.101 < required 0.2.112",
      "en",
    );
    expect(fromLocal?.code).toBe("CLI_TOO_OLD");
    expect(fromLocal?.primary?.id).toBe("upgrade_cli");
    expect(fromLocal?.summary.toLowerCase()).toMatch(/cli/);
  });

  it("formatTurnErrorBody maps turn_timeout tag", () => {
    const body = formatTurnErrorBody(
      {
        code: "NETWORK_PROVIDER",
        message: "turn_timeout",
        content: "**NETWORK_PROVIDER**\n\nturn_timeout",
      },
      "en",
    );
    expect(body).toMatch(/timed?\s*out|timeout/i);
    expect(body).not.toMatch(/NETWORK_PROVIDER|rpc timeout|stderr/i);
  });

  it("stripAnsi removes SGR sequences", () => {
    expect(stripAnsi("\u001b[31mERROR\u001b[0m boom")).toBe("ERROR boom");
  });

  it("applyTurnError replaces optimistic thinking with friendly error", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a-pending", role: "assistant", content: "", streaming: true },
    ];
    messages = applyTurnError(
      messages,
      {
        messageId: "host-mid",
        code: "NETWORK_PROVIDER",
        message:
          'rpc timeout on session/prompt (id=6) after 600s; stderr: Connection refused',
        content:
          '**NETWORK_PROVIDER**\n\nrpc timeout on session/prompt (id=6) after 600s; stderr: Connection refused',
      },
      "en",
    );
    expect(messages).toHaveLength(2);
    const err = messages[1]!;
    expect(err.role).toBe("assistant");
    expect(err.isError).toBe(true);
    expect(err.streaming).toBe(false);
    expect(err.content).toMatch(/timed?\s*out|timeout/i);
    expect(err.content).not.toMatch(/Connection refused|stderr|rpc timeout/i);
  });

  it("applyGeneratedImage attaches to streaming assistant and dedupes", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "draw a cat" },
      { id: "a-pending", role: "assistant", content: "", streaming: true },
    ];
    messages = applyGeneratedImage(messages, {
      path: "/tmp/images/1.jpg",
      name: "1.jpg",
    });
    expect(messages[1]!.attachments).toEqual([
      { path: "/tmp/images/1.jpg", name: "1.jpg", isDir: false },
    ]);
    // second time same path → no dup
    messages = applyGeneratedImage(messages, {
      path: "/tmp/images/1.jpg",
      name: "1.jpg",
    });
    expect(messages[1]!.attachments).toHaveLength(1);
    messages = applyGeneratedImage(messages, {
      path: "/tmp/images/2.png",
    });
    expect(messages[1]!.attachments).toHaveLength(2);
    expect(messages[1]!.attachments![1]!.name).toBe("2.png");
  });

  it("applyGeneratedImage ignores false-extract single-segment abs media", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "done", streaming: true },
    ];
    messages = applyGeneratedImage(messages, {
      path: "/img_001.png",
      name: "img_001.png",
    });
    expect(messages[1]!.attachments).toBeUndefined();
  });
});

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
