import { describe, expect, it } from "vitest";
import {
  applyGeneratedImage,
  applyStreamChunk,
  applyTurnError,
  clearPriorTurnStreaming,
  errorCopy,
  formatTurnErrorBody,
  presentErrorBanner,
  snapshotOutgoingMessages,
  mergeSessionMessagesById,
  stripAnsi,
  type ChatMessage,
} from "./session";


describe("session projection", () => {
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

  it("applyTurnError keeps a partially streamed answer instead of erasing it", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      {
        id: "a1",
        role: "assistant",
        content: "Working on it: step 1 done.",
        segments: [{ kind: "content", text: "Working on it: step 1 done." }],
        streaming: true,
      },
    ];
    messages = applyTurnError(
      messages,
      {
        messageId: "host-mid",
        code: "NETWORK_PROVIDER",
        message: "rpc timeout on session/prompt (id=6) after 600s",
      },
      "en",
    );
    // Partial answer stays as a settled row; the failure is its own record.
    expect(messages).toHaveLength(3);
    const partial = messages[1]!;
    expect(partial.id).toBe("a1");
    expect(partial.content).toBe("Working on it: step 1 done.");
    expect(partial.streaming).toBe(false);
    expect(partial.isError).toBeFalsy();
    const err = messages[2]!;
    expect(err.id).toBe("host-mid");
    expect(err.role).toBe("assistant");
    expect(err.isError).toBe(true);
    expect(err.streaming).toBe(false);
    expect(err.content.trim().length).toBeGreaterThan(0);
  });

  it("applyTurnError keeps tool-only turns visible behind the error row", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "scan repo" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        segments: [
          {
            kind: "tool",
            toolCallId: "tc1",
            title: "grep",
            status: "completed",
          },
        ],
        streaming: true,
      },
    ];
    messages = applyTurnError(
      messages,
      { code: "NETWORK_PROVIDER", message: "upstream 503" },
      "en",
    );
    expect(messages).toHaveLength(3);
    expect(messages[1]!.streaming).toBe(false);
    expect(messages[1]!.segments).toHaveLength(1);
    expect(messages[2]!.isError).toBe(true);
  });

  it("applyTurnError patches an existing error row in place (no dup pill)", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      {
        id: "a1",
        role: "assistant",
        content: "partial",
        segments: [{ kind: "content", text: "partial" }],
        streaming: true,
      },
    ];
    const payload = {
      messageId: "host-mid",
      code: "NETWORK_PROVIDER",
      message: "upstream 503",
    };
    messages = applyTurnError(messages, payload, "en");
    expect(messages).toHaveLength(3);
    // Same host messageId fails again → updates the same error row.
    messages = applyTurnError(messages, payload, "en");
    expect(messages).toHaveLength(3);
    expect(messages.filter((m) => m.isError)).toHaveLength(1);
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
