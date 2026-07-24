import { describe, expect, it } from "vitest";
import {
  canShowQueueButton,
  claimQueueHead,
  dequeueSend,
  dropQueuesForSessions,
  enqueueSend,
  getQueueForKey,
  makeQueuedSend,
  migrateDraftQueue,
  queuePreviewText,
  queueSessionKey,
  removeQueuedSend,
  requeueAfterFlushFail,
  requeueAtFront,
  setQueueForKey,
  shouldEnqueueSend,
  SEND_QUEUE_MAX,
} from "./sendQueue";

describe("sendQueue", () => {
  it("queueSessionKey uses draft sentinel", () => {
    expect(queueSessionKey(null)).toBe("__draft__");
    expect(queueSessionKey(undefined)).toBe("__draft__");
    expect(queueSessionKey("abc")).toBe("abc");
  });

  it("shouldEnqueueSend covers busy states", () => {
    expect(shouldEnqueueSend("ready", false)).toBe(false);
    expect(shouldEnqueueSend("idle", false)).toBe(false);
    expect(shouldEnqueueSend("disconnected", false)).toBe(false);
    expect(shouldEnqueueSend("streaming", false)).toBe(true);
    // Permission modal: decide first — do not queue.
    expect(shouldEnqueueSend("awaiting_permission", false)).toBe(false);
    expect(shouldEnqueueSend("connecting", false)).toBe(true);
    expect(shouldEnqueueSend("ready", true)).toBe(true);
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
      expect(canShowQueueButton("ready", true, true)).toBe(true);
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
});
