import { describe, expect, it } from "vitest";
import {
  applyInterjection,
  applyStreamChunk,
  buildSegmentsFromLegacy,
  canSend,
  canStop,
  canType,
  compactMessageSegments,
  isFailedToolStepMessage,
  splitThoughtPhases,
  isSessionBusy,
  isSessionLiveStreaming,
  isSessionNotLiveError,
  isTurnCancelledError,
  preferSessionMessages,
  upgradeMessagesFromJournal,
  ensureBusyTurnStreaming,
  reconcileOptimisticDuplicates,
  isClientOptimisticId,
  weaveToolsIntoAssistantSegments,
  truncateBeforeLastUser,
  truncateThroughUserPrompt,
  endIndexThroughUserPrompt,
  canRewindToUserPrompt,
  rewindKeepPromptIndex,
  rewindComposerRestore,
  userPromptIndexOf,
  userPromptIndexContaining,
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
    expect(rewindKeepPromptIndex(msgs, 0)).toBe(0);
    expect(rewindKeepPromptIndex(msgs, 1)).toBe(0);
    expect(rewindKeepPromptIndex(msgs.slice(0, 3), 0)).toBe(null);
  });

  it("rewindComposerRestore puts the discarded user prompt back for edit", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      { id: "a1", role: "assistant", content: "ok" },
      {
        id: "u2",
        role: "user",
        content: "second",
        attachments: [{ path: "/tmp/a.png", name: "a.png", isDir: false }],
      },
      { id: "a2", role: "assistant", content: "later" },
    ];
    expect(rewindComposerRestore(msgs, null)).toEqual({
      text: "second",
      attachments: [{ path: "/tmp/a.png", name: "a.png", isDir: false }],
    });
    expect(rewindComposerRestore(msgs, 0)).toEqual({
      text: "second",
      attachments: [{ path: "/tmp/a.png", name: "a.png", isDir: false }],
    });
    expect(rewindComposerRestore(msgs, 1)).toBeNull();
    expect(rewindComposerRestore(msgs.slice(0, 2), 0)).toBeNull();
    expect(
      rewindComposerRestore(
        [{ id: "u1", role: "user", content: "only" }],
        null,
      ),
    ).toEqual({ text: "only", attachments: [] });
  });

  it("userPromptIndexContaining maps assistant/tool to the parent user turn", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      { id: "a1", role: "assistant", content: "ok" },
      { id: "t1", role: "tool", content: "ran" },
      { id: "u2", role: "user", content: "second" },
      { id: "a2", role: "assistant", content: "later" },
      {
        id: "i1",
        role: "user",
        content: "steer",
        marker: "interjection",
      },
    ];
    expect(userPromptIndexContaining(msgs, "a1")).toBe(0);
    expect(userPromptIndexContaining(msgs, "t1")).toBe(0);
    expect(userPromptIndexContaining(msgs, "u1")).toBe(0);
    expect(userPromptIndexContaining(msgs, "a2")).toBe(1);
    expect(userPromptIndexContaining(msgs, "i1")).toBe(1);
    expect(userPromptIndexContaining(msgs, "missing")).toBe(-1);
    expect(
      userPromptIndexContaining(
        [{ id: "a0", role: "assistant", content: "x" }],
        "a0",
      ),
    ).toBe(-1);
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
});
