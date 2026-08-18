import { describe, expect, it } from "vitest";
import {
  addChatRef,
  chatHasUpdate,
  encodeSessionDrag,
  extractChatSessionIds,
  filterAttachableSessions,
  lookupChatTitle,
  MAX_ATTACHED_CHATS,
  parseChatTokens,
  parseSessionDrag,
  parseSessionDragFromTransfer,
  takeSessionDragPayload,
  prependChatTokens,
  refreshChatRef,
  refreshStaleChatRefs,
  removeChatRef,
  serializeChatTokens,
  staleAttachedChats,
  stripChatTokens,
  type ChatRef,
} from "./chatAttach";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

describe("chat tokens", () => {
  it("extracts unique ids in order", () => {
    const raw = `hi [[chat:${A}]] mid [[chat:${B}]] [[chat:${A}]]`;
    expect(extractChatSessionIds(raw)).toEqual([A, B]);
  });

  it("ignores non-uuid tokens", () => {
    expect(extractChatSessionIds("[[chat:not-a-uuid]] [[chat:]]")).toEqual([]);
  });

  it("strips tokens and trims leftover blank lines", () => {
    expect(stripChatTokens(`[[chat:${A}]]\n\nhello\n`)).toBe("hello");
    expect(stripChatTokens(`keep [[chat:${A}]] going`)).toBe("keep  going");
  });

  it("prepends tokens ahead of the user text", () => {
    expect(prependChatTokens("do this", [{ sessionId: A, title: "t" }])).toBe(
      `[[chat:${A}]]\ndo this`,
    );
    expect(
      prependChatTokens(`[[chat:${B}]]\nold`, [{ sessionId: A, title: "t" }]),
    ).toBe(`[[chat:${A}]]\nold`);
    expect(prependChatTokens("", [{ sessionId: A, title: "t" }])).toBe(
      `[[chat:${A}]]`,
    );
  });

  it("serializes unique valid ids only", () => {
    const refs: ChatRef[] = [
      { sessionId: A, title: "one" },
      { sessionId: "nope", title: "x" },
      { sessionId: A, title: "dup" },
      { sessionId: B, title: "two" },
    ];
    expect(serializeChatTokens(refs)).toBe(`[[chat:${A}]][[chat:${B}]]`);
  });

  it("parseChatTokens fills titles via lookup", () => {
    expect(
      parseChatTokens(`[[chat:${A}]]`, (id) => (id === A ? "Login" : "")),
    ).toEqual([{ sessionId: A, title: "Login" }]);
  });
});

describe("addChatRef", () => {
  it("appends until the cap", () => {
    let refs: ChatRef[] = [];
    const r1 = addChatRef(refs, { sessionId: A, title: "a" });
    expect(r1.added).toBe(true);
    refs = r1.refs;
    refs = addChatRef(refs, { sessionId: B, title: "b" }).refs;
    refs = addChatRef(refs, { sessionId: C, title: "c" }).refs;
    expect(refs).toHaveLength(MAX_ATTACHED_CHATS);
    const over = addChatRef(refs, { sessionId: D, title: "d" });
    expect(over.added).toBe(false);
    expect(over.reason).toBe("limit");
  });

  it("rejects self, duplicate, and invalid", () => {
    const base = [{ sessionId: A, title: "a" }];
    expect(
      addChatRef(base, { sessionId: A, title: "a" }).reason,
    ).toBe("duplicate");
    expect(
      addChatRef(base, { sessionId: B, title: "b" }, { currentId: B }).reason,
    ).toBe("self");
    expect(
      addChatRef(base, { sessionId: "x", title: "x" }).reason,
    ).toBe("invalid");
  });

  it("removeChatRef drops by id", () => {
    expect(
      removeChatRef(
        [
          { sessionId: A, title: "a" },
          { sessionId: B, title: "b" },
        ],
        A,
      ),
    ).toEqual([{ sessionId: B, title: "b" }]);
  });
});

describe("filterAttachableSessions", () => {
  const sessions = [
    { id: A, title: "Fix login", updatedAt: "2" },
    { id: B, title: "Write docs", archived: true },
    { id: C, title: "Login tests", updatedAt: "1" },
  ];

  it("excludes self, archived, and already attached", () => {
    expect(
      filterAttachableSessions(sessions, {
        currentId: A,
        alreadyIds: [C],
      }).map((s) => s.id),
    ).toEqual([]);
    expect(
      filterAttachableSessions(sessions, { currentId: A }).map((s) => s.id),
    ).toEqual([C]);
    expect(
      filterAttachableSessions(sessions, {
        includeArchived: true,
        currentId: A,
      }).map((s) => s.id),
    ).toEqual([B, C]);
  });

  it("filters by title query", () => {
    expect(
      filterAttachableSessions(sessions, { query: "login" }).map((s) => s.id),
    ).toEqual([A, C]);
  });
});

describe("lookupChatTitle", () => {
  it("returns title or fallback", () => {
    expect(lookupChatTitle(A, [{ id: A, title: "  Login  " }])).toBe("Login");
    expect(lookupChatTitle(B, [{ id: A, title: "Login" }], "gone")).toBe(
      "gone",
    );
  });
});

describe("session drag payload", () => {
  it("round-trips id / title / updatedAt", () => {
    const raw = encodeSessionDrag({
      id: A,
      title: "Fix login",
      updatedAt: "2026-08-18T10:00:00.000Z",
    });
    expect(parseSessionDrag(raw)).toEqual({
      id: A,
      title: "Fix login",
      updatedAt: "2026-08-18T10:00:00.000Z",
    });
  });

  it("rejects invalid ids", () => {
    expect(parseSessionDrag(JSON.stringify({ id: "nope", title: "x" }))).toBe(
      null,
    );
    expect(parseSessionDrag("not-json")).toBe(null);
  });

  it("reads WKWebView text/plain fallback from DataTransfer", () => {
    const raw = encodeSessionDrag({ id: A, title: "Fix login" });
    const dt = {
      getData: (mime: string) => (mime === "text/plain" ? raw : ""),
    } as unknown as DataTransfer;
    expect(parseSessionDragFromTransfer(dt)).toEqual({
      id: A,
      title: "Fix login",
    });
    expect(takeSessionDragPayload(null, dt)?.id).toBe(A);
    expect(
      takeSessionDragPayload({ id: B, title: "held" }, dt),
    ).toEqual({ id: B, title: "held" });
  });
});

describe("chatHasUpdate / refresh", () => {
  const older = "2026-08-18T10:00:00.000Z";
  const newer = "2026-08-18T11:00:00.000Z";

  it("is stale only when source updatedAt is later", () => {
    const ref: ChatRef = {
      sessionId: A,
      title: "Login",
      attachedUpdatedAt: older,
    };
    expect(chatHasUpdate(ref, [{ id: A, updatedAt: newer }])).toBe(true);
    expect(chatHasUpdate(ref, [{ id: A, updatedAt: older }])).toBe(false);
    expect(chatHasUpdate({ sessionId: A, title: "x" }, [{ id: A, updatedAt: newer }])).toBe(
      false,
    );
  });

  it("refreshChatRef updates snapshot + title", () => {
    const prev: ChatRef[] = [
      { sessionId: A, title: "old", attachedUpdatedAt: older },
      { sessionId: B, title: "keep", attachedUpdatedAt: older },
    ];
    expect(refreshChatRef(prev, A, { updatedAt: newer, title: "new" })).toEqual([
      { sessionId: A, title: "new", attachedUpdatedAt: newer },
      { sessionId: B, title: "keep", attachedUpdatedAt: older },
    ]);
  });

  it("refreshStaleChatRefs only touches stale rows", () => {
    const prev: ChatRef[] = [
      { sessionId: A, title: "a", attachedUpdatedAt: older },
      { sessionId: B, title: "b", attachedUpdatedAt: newer },
    ];
    const sessions = [
      { id: A, title: "A+", updatedAt: newer },
      { id: B, title: "B+", updatedAt: newer },
    ];
    expect(staleAttachedChats(prev, sessions)).toHaveLength(1);
    const r = refreshStaleChatRefs(prev, sessions);
    expect(r.refreshed).toBe(1);
    expect(r.refs[0]).toEqual({
      sessionId: A,
      title: "A+",
      attachedUpdatedAt: newer,
    });
    expect(r.refs[1]?.title).toBe("b");
  });
});
