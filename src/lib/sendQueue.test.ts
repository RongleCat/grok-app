import { describe, expect, it } from "vitest";
import {
  applyClearSendQueuePlan,
  canReorderSendQueue,
  canShowQueueButton,
  claimQueueHead,
  dequeueSend,
  dropQueuesForSessions,
  enqueueSend,
  getQueueForKey,
  isForeignLiveBusy,
  makeQueuedSend,
  migrateDraftQueue,
  moveQueuedSend,
  planClearSendQueue,
  queuePreviewText,
  queueSessionKey,
  removeQueuedSend,
  reorderQueuedSend,
  requeueAfterFlushFail,
  requeueAtFront,
  resolveSendQueueEmptyState,
  resolveSendQueueStripState,
  setQueueForKey,
  shouldEnqueueSend,
  shouldHoldFlushForLive,
  summarizeSendQueue,
  updateQueuedSend,
  SEND_QUEUE_MAX,
} from "./sendQueue";

describe("sendQueue", () => {
  it("queueSessionKey uses draft sentinel", () => {
    expect(queueSessionKey(null)).toBe("__draft__");
    expect(queueSessionKey(undefined)).toBe("__draft__");
    expect(queueSessionKey("abc")).toBe("abc");
  });

  it("shouldEnqueueSend covers busy states (same session only)", () => {
    expect(shouldEnqueueSend("ready", false)).toBe(false);
    expect(shouldEnqueueSend("idle", false)).toBe(false);
    expect(shouldEnqueueSend("disconnected", false)).toBe(false);
    expect(shouldEnqueueSend("streaming", false)).toBe(true);
    // Permission modal: decide first — do not queue.
    expect(shouldEnqueueSend("awaiting_permission", false)).toBe(false);
    // Handshake / fork warm-connect is not a turn — first send must go now.
    expect(shouldEnqueueSend("connecting", false)).toBe(false);
    expect(shouldEnqueueSend("connecting", true)).toBe(false);
    // Global UI `connecting` must NOT enqueue idle/ready/new-chat (foreign
    // ensureConnected / reconnect in flight). Only this chat's FSM busy.
    expect(shouldEnqueueSend("ready", true)).toBe(false);
    expect(shouldEnqueueSend("idle", true)).toBe(false);
    expect(shouldEnqueueSend("disconnected", true)).toBe(false);
    // Idle/ready viewed chat never enqueues — even if Host is busy elsewhere
    // (that is concurrent demote+send, not a local queue).
    expect(shouldEnqueueSend("idle", false)).toBe(false);
    expect(shouldEnqueueSend("ready", false)).toBe(false);
  });

  it("isForeignLiveBusy isolates draft and other sessions", () => {
    expect(isForeignLiveBusy("a", "streaming", "a")).toBe(false);
    expect(isForeignLiveBusy("a", "streaming", "b")).toBe(true);
    expect(isForeignLiveBusy("a", "streaming", null)).toBe(true);
    expect(isForeignLiveBusy("a", "ready", "b")).toBe(false);
    expect(isForeignLiveBusy(null, "streaming", "b")).toBe(false);
  });

  it("shouldHoldFlushForLive only when claim is the busy live session", () => {
    // Same session mid-turn → hold follow-up flush
    expect(shouldHoldFlushForLive("a", "streaming", "a")).toBe(true);
    expect(shouldHoldFlushForLive("a", "awaiting_permission", "a")).toBe(true);
    // Foreign busy → do NOT hold (concurrent demote path)
    expect(shouldHoldFlushForLive("a", "streaming", "b")).toBe(false);
    expect(shouldHoldFlushForLive("a", "streaming", null)).toBe(false);
    // Live idle → never hold
    expect(shouldHoldFlushForLive("a", "ready", "a")).toBe(false);
    expect(shouldHoldFlushForLive("a", "connecting", "a")).toBe(false);
    expect(shouldHoldFlushForLive(null, "streaming", "a")).toBe(false);
  });

  it("enqueue drops oldest past max and reports dropped", () => {
    let q = [] as ReturnType<typeof makeQueuedSend>[];
    let lastDropped = 0;
    for (let i = 0; i < SEND_QUEUE_MAX + 3; i++) {
      const r = enqueueSend(
        q,
        makeQueuedSend({
          storedDisplay: `m${i}`,
          attachments: [],
          goalMode: false,
          now: i,
        }),
        SEND_QUEUE_MAX,
      );
      q = r.queue;
      lastDropped = r.dropped;
    }
    expect(q).toHaveLength(SEND_QUEUE_MAX);
    expect(lastDropped).toBe(1);
    expect(q[0]!.storedDisplay).toBe("m3");
    expect(q[q.length - 1]!.storedDisplay).toBe(
      `m${SEND_QUEUE_MAX + 2}`,
    );
  });

  it("dequeue and remove", () => {
    const a = makeQueuedSend({
      storedDisplay: "a",
      attachments: [],
      goalMode: false,
      now: 1,
    });
    const b = makeQueuedSend({
      storedDisplay: "b",
      attachments: [],
      goalMode: false,
      now: 2,
    });
    let q = enqueueSend([], a).queue;
    q = enqueueSend(q, b).queue;
    const [head, rest] = dequeueSend(q);
    expect(head?.id).toBe(a.id);
    expect(rest).toHaveLength(1);
    expect(removeQueuedSend(rest, b.id)).toEqual([]);
  });

  it("moveQueuedSend swaps one step up/down and no-ops at bounds", () => {
    const a = makeQueuedSend({
      storedDisplay: "a",
      attachments: [],
      goalMode: false,
      now: 1,
    });
    const b = makeQueuedSend({
      storedDisplay: "b",
      attachments: [],
      goalMode: false,
      now: 2,
    });
    const c = makeQueuedSend({
      storedDisplay: "c",
      attachments: [],
      goalMode: false,
      now: 3,
    });
    const q = [a, b, c];
    const up = moveQueuedSend(q, b.id, "up");
    expect(up).not.toBe(q);
    expect(up.map((x) => x.id)).toEqual([b.id, a.id, c.id]);
    expect(up[0]).toBe(b);
    expect(up[1]).toBe(a);

    const down = moveQueuedSend(q, b.id, "down");
    expect(down.map((x) => x.id)).toEqual([a.id, c.id, b.id]);

    expect(moveQueuedSend(q, a.id, "up")).toBe(q);
    expect(moveQueuedSend(q, c.id, "down")).toBe(q);
    expect(moveQueuedSend(q, "missing", "up")).toBe(q);
    const single = [a];
    expect(moveQueuedSend(single, a.id, "up")).toBe(single);
    expect(moveQueuedSend(single, a.id, "down")).toBe(single);
  });

  it("reorderQueuedSend clamps indices and returns same ref for no-op", () => {
    const a = makeQueuedSend({
      storedDisplay: "a",
      attachments: [],
      goalMode: false,
      now: 1,
    });
    const b = makeQueuedSend({
      storedDisplay: "b",
      attachments: [],
      goalMode: false,
      now: 2,
    });
    const c = makeQueuedSend({
      storedDisplay: "c",
      attachments: [],
      goalMode: false,
      now: 3,
    });
    const q = [a, b, c];

    const moved = reorderQueuedSend(q, 0, 2);
    expect(moved).not.toBe(q);
    expect(moved.map((x) => x.id)).toEqual([b.id, c.id, a.id]);

    const midToFront = reorderQueuedSend(q, 2, 0);
    expect(midToFront.map((x) => x.id)).toEqual([c.id, a.id, b.id]);

    expect(reorderQueuedSend(q, 1, 1)).toBe(q);
    // Clamp out-of-range: from -10 → 0, to 99 → last; move head to tail.
    const clamped = reorderQueuedSend(q, -10, 99);
    expect(clamped.map((x) => x.id)).toEqual([b.id, c.id, a.id]);
    // Clamp both to same end → no-op same ref.
    expect(reorderQueuedSend(q, -5, -1)).toBe(q);
    expect(reorderQueuedSend(q, 99, 50)).toBe(q);
    expect(reorderQueuedSend(q, Number.NaN, 1)).toBe(q);
    const single = [a];
    expect(reorderQueuedSend(single, 0, 0)).toBe(single);
  });

  it("updateQueuedSend patches text and goalMode", () => {
    const a = makeQueuedSend({
      storedDisplay: "old",
      attachments: [],
      goalMode: false,
      now: 1,
    });
    const b = makeQueuedSend({
      storedDisplay: "keep",
      attachments: [],
      goalMode: false,
      now: 2,
    });
    const q = [a, b];
    const next = updateQueuedSend(q, a.id, {
      storedDisplay: "new text",
      goalMode: true,
    });
    expect(next).not.toBe(q);
    expect(next[0]!.storedDisplay).toBe("new text");
    expect(next[0]!.goalMode).toBe(true);
    expect(next[0]!.id).toBe(a.id);
    expect(next[1]).toBe(b);
  });

  it("updateQueuedSend returns same ref for missing id", () => {
    const a = makeQueuedSend({
      storedDisplay: "x",
      attachments: [],
      goalMode: false,
    });
    const q = [a];
    expect(updateQueuedSend(q, "missing", { storedDisplay: "y" })).toBe(q);
  });

  it("updateQueuedSend returns same ref for no-op patch", () => {
    const a = makeQueuedSend({
      storedDisplay: "same",
      attachments: [],
      goalMode: true,
    });
    const q = [a];
    expect(
      updateQueuedSend(q, a.id, {
        storedDisplay: "same",
        goalMode: true,
      }),
    ).toBe(q);
  });

  it("updateQueuedSend rejects empty text with no attachments", () => {
    const a = makeQueuedSend({
      storedDisplay: "hello",
      attachments: [],
      goalMode: false,
    });
    const q = [a];
    expect(updateQueuedSend(q, a.id, { storedDisplay: "   " })).toBe(q);
    expect(updateQueuedSend(q, a.id, { storedDisplay: "" })).toBe(q);
  });

  it("updateQueuedSend allows empty text when attachments remain", () => {
    const a = makeQueuedSend({
      storedDisplay: "caption",
      attachments: [{ path: "/a", name: "a.png", isDir: false }],
      goalMode: false,
    });
    const q = [a];
    const next = updateQueuedSend(q, a.id, { storedDisplay: "" });
    expect(next).not.toBe(q);
    expect(next[0]!.storedDisplay).toBe("");
    expect(next[0]!.attachments).toHaveLength(1);
  });

  it("updateQueuedSend can replace attachments", () => {
    const a = makeQueuedSend({
      storedDisplay: "x",
      attachments: [{ path: "/old", name: "old", isDir: false }],
      goalMode: false,
    });
    const q = [a];
    const nextAtt = [{ path: "/new", name: "new.png", isDir: false }];
    const next = updateQueuedSend(q, a.id, { attachments: nextAtt });
    expect(next[0]!.attachments).toEqual(nextAtt);
    expect(next[0]!.attachments).not.toBe(nextAtt);
  });

  it("requeueAtFront restores claimed head without dup", () => {
    const a = makeQueuedSend({
      storedDisplay: "a",
      attachments: [],
      goalMode: false,
      now: 1,
    });
    const b = makeQueuedSend({
      storedDisplay: "b",
      attachments: [],
      goalMode: false,
      now: 2,
    });
    const q = enqueueSend(enqueueSend([], a).queue, b).queue;
    const [head, rest] = dequeueSend(q);
    const restored = requeueAtFront(rest, head!).queue;
    expect(restored.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(requeueAtFront(restored, head!).queue.map((x) => x.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it("requeueAtFront over max drops oldest of rest, keeps head", () => {
    const max = 3;
    const head = makeQueuedSend({
      storedDisplay: "head",
      attachments: [],
      goalMode: false,
      now: 0,
    });
    // rest already full (as if concurrent enqueues after claim)
    const rest = [1, 2, 3].map((i) =>
      makeQueuedSend({
        storedDisplay: `r${i}`,
        attachments: [],
        goalMode: false,
        now: i,
      }),
    );
    const r = requeueAtFront(rest, head, max);
    expect(r.dropped).toBe(1);
    expect(r.queue).toHaveLength(max);
    expect(r.queue[0]!.id).toBe(head.id);
    // Dropped oldest of rest (r1); kept r2, r3 + head
    expect(r.queue.map((x) => x.storedDisplay)).toEqual([
      "head",
      "r2",
      "r3",
    ]);
  });

  it("preview prefers text then attachments", () => {
    expect(
      queuePreviewText("hello [[skill:foo]] world", [], 20),
    ).toBe("hello /foo world");
    expect(
      queuePreviewText("", [{ path: "/a", name: "a.png", isDir: false }]),
    ).toBe("a.png");
    expect(
      queuePreviewText(
        "",
        [
          { path: "/a", name: "a", isDir: false },
          { path: "/b", name: "b", isDir: false },
        ],
        72,
        { filesCount: (n) => `${n} files` },
      ),
    ).toBe("2 files");
    expect(
      queuePreviewText("", [], 72, {
        filesCount: () => "",
        empty: "(attachment)",
      }),
    ).toBe("(attachment)");
  });

  it("setQueueForKey deletes empty", () => {
    const withQ = setQueueForKey({}, "s1", [
      makeQueuedSend({
        storedDisplay: "x",
        attachments: [],
        goalMode: true,
      }),
    ]);
    expect(getQueueForKey(withQ, "s1")).toHaveLength(1);
    const cleared = setQueueForKey(withQ, "s1", []);
    expect(getQueueForKey(cleared, "s1")).toEqual([]);
    expect(cleared).not.toHaveProperty("s1");
  });

  describe("integration-style flows", () => {
    it("flush fail requeues claimed head at front", () => {
      const a = makeQueuedSend({
        storedDisplay: "first",
        attachments: [],
        goalMode: false,
        now: 1,
      });
      const b = makeQueuedSend({
        storedDisplay: "second",
        attachments: [],
        goalMode: false,
        now: 2,
      });
      let map = setQueueForKey({}, "s1", enqueueSend(enqueueSend([], a).queue, b).queue);
      const claimed = claimQueueHead(map, "s1");
      expect(claimed).not.toBeNull();
      expect(claimed!.head.id).toBe(a.id);
      expect(getQueueForKey(claimed!.byKey, "s1").map((x) => x.id)).toEqual([
        b.id,
      ]);
      // executeSend failed → restore
      const restored = requeueAfterFlushFail(claimed!.byKey, "s1", claimed!.head);
      expect(getQueueForKey(restored.byKey, "s1").map((x) => x.id)).toEqual([
        a.id,
        b.id,
      ]);
      // success path would leave rest only (no requeue)
      const okClaim = claimQueueHead(restored.byKey, "s1");
      expect(okClaim!.head.id).toBe(a.id);
      expect(getQueueForKey(okClaim!.byKey, "s1").map((x) => x.id)).toEqual([
        b.id,
      ]);
    });

    it("migrates __draft__ queue onto new sessionId (append)", () => {
      const d1 = makeQueuedSend({
        storedDisplay: "draft-1",
        attachments: [],
        goalMode: false,
        now: 1,
      });
      const d2 = makeQueuedSend({
        storedDisplay: "draft-2",
        attachments: [],
        goalMode: true,
        now: 2,
      });
      const existing = makeQueuedSend({
        storedDisplay: "already",
        attachments: [],
        goalMode: false,
        now: 0,
      });
      let map = setQueueForKey({}, "__draft__", [d1, d2]);
      map = setQueueForKey(map, "sid-real", [existing]);
      const next = migrateDraftQueue(map, "sid-real");
      expect(next).not.toHaveProperty("__draft__");
      expect(getQueueForKey(next, "sid-real").map((x) => x.storedDisplay)).toEqual([
        "already",
        "draft-1",
        "draft-2",
      ]);
      // no-op when draft empty
      expect(migrateDraftQueue(next, "sid-real")).toBe(next);
    });

    it("permission: no enqueue + queue button hidden", () => {
      expect(shouldEnqueueSend("awaiting_permission", false)).toBe(false);
      expect(shouldEnqueueSend("awaiting_permission", true)).toBe(false);
      expect(canShowQueueButton("awaiting_permission", false, true)).toBe(
        false,
      );
      expect(canShowQueueButton("streaming", false, true)).toBe(true);
      expect(canShowQueueButton("streaming", false, false)).toBe(false);
      expect(canShowQueueButton("ready", false, true)).toBe(false);
      // Global connecting alone does not show the Queue button on idle/ready.
      expect(canShowQueueButton("ready", true, true)).toBe(false);
      expect(canShowQueueButton("idle", true, true)).toBe(false);
    });

    it("SEND_QUEUE_MAX: overflow drops oldest and reports count", () => {
      const max = 3;
      let q: ReturnType<typeof makeQueuedSend>[] = [];
      for (let i = 0; i < max; i++) {
        const r = enqueueSend(
          q,
          makeQueuedSend({
            storedDisplay: `m${i}`,
            attachments: [],
            goalMode: false,
            now: i,
          }),
          max,
        );
        expect(r.dropped).toBe(0);
        q = r.queue;
      }
      const overflow = enqueueSend(
        q,
        makeQueuedSend({
          storedDisplay: "m3",
          attachments: [],
          goalMode: false,
          now: 3,
        }),
        max,
      );
      expect(overflow.dropped).toBe(1);
      expect(overflow.queue.map((x) => x.storedDisplay)).toEqual([
        "m1",
        "m2",
        "m3",
      ]);
    });

    it("delete sessions drops queue keys", () => {
      let map = setQueueForKey({}, "a", [
        makeQueuedSend({
          storedDisplay: "1",
          attachments: [],
          goalMode: false,
        }),
      ]);
      map = setQueueForKey(map, "b", [
        makeQueuedSend({
          storedDisplay: "2",
          attachments: [],
          goalMode: false,
        }),
      ]);
      const next = dropQueuesForSessions(map, ["a", "missing"]);
      expect(next).not.toHaveProperty("a");
      expect(getQueueForKey(next, "b")).toHaveLength(1);
    });
  });

  describe("send-queue-pro: clear · empty honesty · strip · reorder", () => {
    it("summarizeSendQueue counts attachments and goalMode without bodies", () => {
      const q = [
        makeQueuedSend({
          storedDisplay: "secret body",
          attachments: [{ path: "/a", name: "a.png", isDir: false }],
          goalMode: true,
          now: 1,
        }),
        makeQueuedSend({
          storedDisplay: "plain",
          attachments: [],
          goalMode: false,
          now: 2,
        }),
      ];
      const s = summarizeSendQueue(q);
      expect(s.count).toBe(2);
      expect(s.withAttachments).toBe(1);
      expect(s.goalModeCount).toBe(1);
      expect(s.isEmpty).toBe(false);
      expect(s.canReorder).toBe(true);
      expect(s.max).toBe(SEND_QUEUE_MAX);
      // Summary must not embed bodies (shape check only — plain numbers/flags).
      expect(Object.keys(s).sort()).toEqual(
        [
          "canReorder",
          "count",
          "goalModeCount",
          "isEmpty",
          "isFull",
          "max",
          "withAttachments",
        ].sort(),
      );
    });

    it("summarizeSendQueue empty and full honesty", () => {
      expect(summarizeSendQueue([])).toMatchObject({
        count: 0,
        isEmpty: true,
        isFull: false,
        canReorder: false,
      });
      expect(summarizeSendQueue(null)).toMatchObject({ count: 0, isEmpty: true });
      const full = Array.from({ length: 3 }, (_, i) =>
        makeQueuedSend({
          storedDisplay: `m${i}`,
          attachments: [],
          goalMode: false,
          now: i,
        }),
      );
      expect(summarizeSendQueue(full, 3).isFull).toBe(true);
      expect(canReorderSendQueue(full)).toBe(true);
      expect(canReorderSendQueue([])).toBe(false);
      expect(canReorderSendQueue([full[0]!])).toBe(false);
    });

    it("planClearSendQueue requires confirm only when non-empty", () => {
      const empty = planClearSendQueue([]);
      expect(empty.confirmNeeded).toBe(false);
      expect(empty.count).toBe(0);
      expect(empty.next).toEqual([]);
      expect(empty.logMeta).toBeNull();

      const a = makeQueuedSend({
        storedDisplay: "x",
        attachments: [],
        goalMode: false,
      });
      const b = makeQueuedSend({
        storedDisplay: "y",
        attachments: [],
        goalMode: true,
      });
      const plan = planClearSendQueue([a, b]);
      expect(plan.confirmNeeded).toBe(true);
      expect(plan.count).toBe(2);
      expect(plan.next).toEqual([]);
      expect(plan.logMeta).toEqual({ clearedCount: 2 });
      expect(plan.summary.goalModeCount).toBe(1);
    });

    it("applyClearSendQueuePlan drops the session key", () => {
      const a = makeQueuedSend({
        storedDisplay: "x",
        attachments: [],
        goalMode: false,
      });
      const map = setQueueForKey({}, "s1", [a]);
      const plan = planClearSendQueue(getQueueForKey(map, "s1"));
      const next = applyClearSendQueuePlan(map, "s1", plan);
      expect(next).not.toHaveProperty("s1");
      expect(getQueueForKey(next, "s1")).toEqual([]);
      // Empty plan on missing key → same ref
      const emptyPlan = planClearSendQueue([]);
      const bare: Record<string, never> = {};
      expect(applyClearSendQueuePlan(bare, "missing", emptyPlan)).toBe(bare);
    });

    it("resolveSendQueueStripState hides empty and shows hold when paused", () => {
      expect(
        resolveSendQueueStripState({ queue: [], flushHold: true }),
      ).toMatchObject({
        kind: "empty",
        visible: false,
        canClear: false,
        showHold: false,
      });
      const item = makeQueuedSend({
        storedDisplay: "q",
        attachments: [],
        goalMode: false,
      });
      expect(
        resolveSendQueueStripState({ queue: [item], flushHold: false }),
      ).toMatchObject({
        kind: "queued",
        visible: true,
        count: 1,
        canClear: true,
        canReorder: false,
        showHold: false,
      });
      const two = [
        item,
        makeQueuedSend({
          storedDisplay: "r",
          attachments: [],
          goalMode: false,
        }),
      ];
      expect(
        resolveSendQueueStripState({ queue: two, flushHold: true }),
      ).toMatchObject({
        kind: "hold",
        visible: true,
        count: 2,
        canReorder: true,
        showHold: true,
      });
    });

    it("resolveSendQueueEmptyState is null when items exist", () => {
      expect(resolveSendQueueEmptyState({ count: 0 })).toEqual({
        kind: "empty",
        titleKey: "composer.queueEmptyTitle",
        bodyKey: "composer.queueEmptyBody",
      });
      expect(resolveSendQueueEmptyState({ count: 2 })).toBeNull();
      expect(resolveSendQueueEmptyState({ count: -1 })).toEqual({
        kind: "empty",
        titleKey: "composer.queueEmptyTitle",
        bodyKey: "composer.queueEmptyBody",
      });
    });
  });
});
