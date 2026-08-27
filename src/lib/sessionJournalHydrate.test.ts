import { beforeEach, describe, expect, it } from "vitest";
import type { StoredJournalMessage } from "./mapStoredMessages";
import type { ChatMessage } from "./session";
import { sessionTranscriptStore } from "./sessionTranscriptStore";
import {
  hydrateSessionJournal,
  journalHasScheduledUser,
  projectJournalToChat,
  projectTrimmedJournalToChat,
  refineJournalAttachments,
  stripAutomationFences,
  type JournalIo,
} from "./sessionJournalHydrate";

function user(id: string, content: string): ChatMessage {
  return { id, role: "user", content, createdAt: "2026-01-01T00:00:00Z" };
}

function assistant(
  id: string,
  content: string,
  extra?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    createdAt: "2026-01-01T00:00:01Z",
    ...extra,
  };
}

function stored(
  partial: Partial<StoredJournalMessage> & { id: string; content: string },
): StoredJournalMessage {
  return {
    role: partial.role ?? "assistant",
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function ioWith(
  storedRows: StoredJournalMessage[],
  extra?: Partial<JournalIo>,
): JournalIo {
  return {
    isTauri: () => true,
    sessionMessages: async () => storedRows,
    sessionResolveRelativeMedia: async () => [],
    pathsClassify: async () => [],
    ...extra,
  };
}

describe("stripAutomationFences / journalHasScheduledUser", () => {
  it("strips grok-automation fences from assistant bodies", () => {
    const fenced = [
      "ok",
      "",
      "```grok-automation",
      JSON.stringify({
        title: "t",
        prompt: "p",
        frequency: "daily",
        time: "09:00",
        weekdays: [],
        enabled: true,
      }),
      "```",
    ].join("\n");
    const out = stripAutomationFences([assistant("a", fenced)]);
    expect(out[0]?.content).toContain("ok");
    expect(out[0]?.content).not.toContain("grok-automation");
  });

  it("detects scheduled user header", () => {
    expect(
      journalHasScheduledUser([
        user("u", "[Scheduled: ping]\n\ndo the thing"),
      ]),
    ).toBe(true);
    expect(journalHasScheduledUser([user("u", "hello")])).toBe(false);
  });
});

describe("refineJournalAttachments", () => {
  it("drops local attachments classify says are missing", () => {
    const rows = [
      assistant("a", "hi", {
        attachments: [
          { path: "/Users/me/gone.png", name: "gone.png", isDir: false },
        ],
      }),
    ];
    const out = refineJournalAttachments(rows, {
      resolved: [],
      classifyByPath: new Map([
        [
          "/Users/me/gone.png",
          {
            path: "/Users/me/gone.png",
            name: "gone.png",
            isDir: false,
            exists: false,
          },
        ],
      ]),
      classifyFailed: false,
    });
    expect(out[0]?.attachments).toBeUndefined();
  });

  it("keeps http(s) attachments even without classify", () => {
    const rows = [
      assistant("a", "hi", {
        attachments: [
          {
            path: "https://example.com/a.png",
            name: "a.png",
            isDir: false,
          },
        ],
      }),
    ];
    const out = refineJournalAttachments(rows, {
      resolved: [],
      classifyByPath: new Map(),
      classifyFailed: false,
    });
    expect(out[0]?.attachments?.[0]?.path).toBe("https://example.com/a.png");
  });

  it("on classify failure keeps only displayable paths", () => {
    const rows = [
      assistant("a", "hi", {
        attachments: [
          { path: "/img_001.png", name: "img_001.png", isDir: false },
          {
            path: "/Users/me/real.png",
            name: "real.png",
            isDir: false,
          },
        ],
      }),
    ];
    const out = refineJournalAttachments(rows, {
      resolved: [],
      classifyByPath: null,
      classifyFailed: true,
    });
    expect(out[0]?.attachments?.map((a) => a.path)).toEqual([
      "/Users/me/real.png",
    ]);
  });
});

describe("hydrateSessionJournal", () => {
  beforeEach(() => {
    sessionTranscriptStore.resetForTests();
  });

  it("aborts after fetch: caches prefer(), does not paint viewing", async () => {
    sessionTranscriptStore.setViewingSessionId("s1");
    sessionTranscriptStore.beginJournalLoad("s1");
    sessionTranscriptStore.cacheSession("s1", [user("old", "cached")]);
    sessionTranscriptStore.setMessages([user("old", "cached")]);
    sessionTranscriptStore.setViewingSessionId("s2");
    sessionTranscriptStore.setMessages([user("other", "other chat")]);

    const result = await hydrateSessionJournal({
      sessionId: "s1",
      sessionScheduled: false,
      stillThisOpen: () => false,
      liveState: "idle",
      io: ioWith([stored({ id: "u1", role: "user", content: "from disk" })]),
    });

    expect(result.status).toBe("aborted");
    expect(sessionTranscriptStore.getMessages()[0]?.content).toBe("other chat");
    // Completed disk wins prefer(); cache warms for a later return.
    expect(sessionTranscriptStore.getCached("s1")?.[0]?.content).toBe(
      "from disk",
    );
  });

  it("paints stripped assistant bodies on a live open", async () => {
    const fenced = [
      "hello",
      "",
      "```grok-automation",
      JSON.stringify({
        title: "t",
        prompt: "p",
        frequency: "daily",
        time: "09:00",
        weekdays: [],
        enabled: true,
      }),
      "```",
    ].join("\n");
    sessionTranscriptStore.setViewingSessionId("s1");
    sessionTranscriptStore.beginJournalLoad("s1");

    const result = await hydrateSessionJournal({
      sessionId: "s1",
      sessionScheduled: false,
      stillThisOpen: () => true,
      liveState: "idle",
      io: ioWith([
        stored({ id: "u1", role: "user", content: "hi" }),
        stored({ id: "a1", role: "assistant", content: fenced }),
      ]),
    });

    expect(result.status).toBe("applied");
    const painted = sessionTranscriptStore.getMessages();
    const asst = painted.find((m) => m.role === "assistant");
    expect(asst?.content).toContain("hello");
    expect(asst?.content).not.toContain("grok-automation");
    expect(result.painted.find((m) => m.role === "assistant")?.content).not.toContain(
      "grok-automation",
    );
  });

  it("skips second paint when deferred reconcile is unchanged", async () => {
    sessionTranscriptStore.setViewingSessionId("s1");
    sessionTranscriptStore.beginJournalLoad("s1");
    const rows = [
      stored({ id: "u1", role: "user", content: "hi" }),
      stored({ id: "a1", role: "assistant", content: "yo" }),
    ];
    const first = await hydrateSessionJournal({
      sessionId: "s1",
      sessionScheduled: false,
      stillThisOpen: () => true,
      liveState: "idle",
      io: ioWith(rows),
    });
    expect(first.status).toBe("applied");
    const rev = sessionTranscriptStore.getMetaSnapshot().structuralRev;

    const second = await hydrateSessionJournal({
      sessionId: "s1",
      sessionScheduled: false,
      stillThisOpen: () => true,
      liveState: "idle",
      reconcile: true,
      io: ioWith(rows),
    });
    expect(second.status).toBe("applied");
    expect(second.unchanged).toBe(true);
    expect(sessionTranscriptStore.getMetaSnapshot().structuralRev).toBe(rev);
  });

  it("flags scheduled-from-journal when the session row is not yet marked", async () => {
    sessionTranscriptStore.setViewingSessionId("s1");
    sessionTranscriptStore.beginJournalLoad("s1");
    const result = await hydrateSessionJournal({
      sessionId: "s1",
      sessionScheduled: false,
      stillThisOpen: () => true,
      liveState: "idle",
      io: ioWith([
        stored({
          id: "u1",
          role: "user",
          content: "[Scheduled: ping]\n\ndo it",
        }),
      ]),
    });
    expect(result.scheduledFromJournal).toBe(true);
  });

  it("projectJournalToChat keeps a streaming cache ahead of disk", () => {
    const out = projectJournalToChat({
      stored: [stored({ id: "a1", role: "assistant", content: "disk" })],
      cached: [assistant("a1", "partial", { streaming: true })],
      liveState: "streaming",
    });
    expect(out[0]?.content).toBe("partial");
    expect(out[0]?.streaming).toBe(true);
  });

  it("projectTrimmedJournalToChat drops later parent turns that cache still holds", () => {
    const disk = [
      stored({ id: "u1", role: "user", content: "q1" }),
      stored({ id: "a1", role: "assistant", content: "a1" }),
    ];
    const cached = [
      user("u1", "q1"),
      assistant("a1", "a1"),
      user("u2", "q2"),
      assistant("a2", "a2"),
    ];
    const leaked = projectJournalToChat({
      stored: disk,
      cached,
      liveState: "idle",
    });
    expect(leaked.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);

    const trimmed = projectTrimmedJournalToChat(disk);
    expect(trimmed.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(trimmed.map((m) => m.content)).toEqual(["q1", "a1"]);
    // patchSessionMessages reducer must ignore prev — same as this helper.
    expect(projectTrimmedJournalToChat(disk).map((m) => m.id)).toEqual(
      cached.slice(0, 2).map((m) => m.id),
    );
  });
});
