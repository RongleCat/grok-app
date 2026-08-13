import { describe, expect, it } from "vitest";
import { isForeignLiveBusy, shouldEnqueueSend } from "./sendQueue";
import type { SessionState } from "./session";
import {
  planOpenAsNewSessionInstead,
  resolveSendControlLabelKey,
  resolveSendIntent,
  resolveSendIntentBanner,
  resolveSendQueueStripIntentLabel,
  SEND_INTENT_CROWDED_AT,
  type SendIntentKind,
} from "./sendIntent";

const IDLE: SessionState[] = ["idle", "ready", "disconnected"];

describe("resolveSendIntent", () => {
  const base = {
    connecting: false,
    liveSessionId: null as string | null,
    liveState: null as SessionState | null,
    viewedSessionId: "s1" as string | null,
    hasBody: true,
    queueLength: 0,
  };

  it("blocked_empty when no body", () => {
    const r = resolveSendIntent({
      ...base,
      viewedState: "ready",
      hasBody: false,
    });
    expect(r).toEqual({
      kind: "blocked_empty",
      enqueue: false,
      suggestOpenNewChat: false,
    });
    expect(resolveSendIntentBanner(r.kind)).toBeNull();
  });

  it("blocked_permission when awaiting_permission (never enqueues)", () => {
    const r = resolveSendIntent({
      ...base,
      viewedState: "awaiting_permission",
      hasBody: true,
    });
    expect(r.kind).toBe("blocked_permission");
    expect(r.enqueue).toBe(false);
    expect(r.bannerKey).toBe("composer.intent.blockedPermission");
    expect(shouldEnqueueSend("awaiting_permission", false)).toBe(false);
    expect(shouldEnqueueSend("awaiting_permission", true)).toBe(false);
  });

  it("enqueue when same-session streaming (Send path, not steer)", () => {
    const r = resolveSendIntent({
      ...base,
      viewedState: "streaming",
      liveSessionId: "s1",
      liveState: "streaming",
      hasBody: true,
    });
    expect(r.kind).toBe("enqueue");
    expect(r.enqueue).toBe(true);
    expect(r.bannerKey).toBe("composer.intent.enqueue");
    expect(shouldEnqueueSend("streaming", false)).toBe(true);
  });

  it("send_now while connecting (fork / warm handshake is not a turn)", () => {
    const r = resolveSendIntent({
      ...base,
      viewedState: "connecting",
      liveSessionId: "s1",
      liveState: "connecting",
      hasBody: true,
    });
    expect(r.kind).toBe("send_now");
    expect(r.enqueue).toBe(false);
    expect(shouldEnqueueSend("connecting", false)).toBe(false);
    expect(shouldEnqueueSend("connecting", true)).toBe(false);
  });

  it("parity: enqueue flag matches shouldEnqueueSend × hasBody matrix", () => {
    const states: SessionState[] = [
      "idle",
      "ready",
      "disconnected",
      "connecting",
      "streaming",
      "awaiting_permission",
    ];
    for (const state of states) {
      for (const connecting of [false, true]) {
        for (const hasBody of [false, true]) {
          const r = resolveSendIntent({
            ...base,
            viewedState: state,
            connecting,
            hasBody,
            // Same-session live so foreign does not interfere.
            liveSessionId: "s1",
            liveState: state,
            viewedSessionId: "s1",
          });
          const expectEnqueue =
            hasBody && shouldEnqueueSend(state, connecting);
          expect(r.enqueue, `${state}/conn=${connecting}/body=${hasBody}`).toBe(
            expectEnqueue,
          );
          if (expectEnqueue) {
            expect(r.kind).toBe("enqueue");
          }
        }
      }
    }
  });

  it("ignores process-global connecting for idle/ready viewed chat", () => {
    for (const state of IDLE) {
      const r = resolveSendIntent({
        ...base,
        viewedState: state,
        connecting: true,
        liveSessionId: null,
        liveState: null,
        hasBody: true,
      });
      expect(r.enqueue, state).toBe(false);
      expect(r.kind, state).not.toBe("enqueue");
      expect(shouldEnqueueSend(state, true)).toBe(false);
    }
  });

  it("foreign_concurrent when host busy on another session (not enqueue)", () => {
    const r = resolveSendIntent({
      ...base,
      viewedState: "ready",
      liveSessionId: "other",
      liveState: "streaming",
      viewedSessionId: "s1",
      hasBody: true,
    });
    expect(r.kind).toBe("foreign_concurrent");
    expect(r.enqueue).toBe(false);
    expect(r.bannerKey).toBe("composer.intent.foreignConcurrent");
    expect(r.suggestOpenNewChat).toBe(true);
    expect(isForeignLiveBusy("other", "streaming", "s1")).toBe(true);
    expect(shouldEnqueueSend("ready", false)).toBe(false);
  });

  it("foreign_concurrent on draft (null viewed) while any live is busy", () => {
    const r = resolveSendIntent({
      ...base,
      viewedState: "idle",
      liveSessionId: "live-a",
      liveState: "streaming",
      viewedSessionId: null,
      hasBody: true,
    });
    expect(r.kind).toBe("foreign_concurrent");
    expect(r.enqueue).toBe(false);
    expect(isForeignLiveBusy("live-a", "streaming", null)).toBe(true);
  });

  it("same-session busy wins over foreign (enqueue, not foreign_concurrent)", () => {
    // Viewed chat is streaming — Send always enqueues; foreign is irrelevant.
    const r = resolveSendIntent({
      ...base,
      viewedState: "streaming",
      liveSessionId: "s1",
      liveState: "streaming",
      viewedSessionId: "s1",
      hasBody: true,
    });
    expect(r.kind).toBe("enqueue");
    expect(r.enqueue).toBe(true);
  });

  it("send_now when ready and no foreign busy", () => {
    const r = resolveSendIntent({
      ...base,
      viewedState: "ready",
      liveSessionId: "s1",
      liveState: "ready",
      hasBody: true,
    });
    expect(r).toEqual({
      kind: "send_now",
      enqueue: false,
      suggestOpenNewChat: false,
    });
  });

  it("action steer → kind steer when viewed session is streaming", () => {
    const r = resolveSendIntent({
      ...base,
      viewedState: "streaming",
      liveSessionId: "s1",
      liveState: "streaming",
      hasBody: true,
      action: "steer",
    });
    expect(r.kind).toBe("steer");
    expect(r.enqueue).toBe(false);
    expect(r.bannerKey).toBe("composer.intent.steer");
  });

  it("action steer → kind steer when awaiting_permission (Host cancels questionnaire)", () => {
    const r = resolveSendIntent({
      ...base,
      viewedState: "awaiting_permission",
      liveSessionId: "s1",
      liveState: "awaiting_permission",
      hasBody: true,
      action: "steer",
    });
    // Steer is a separate path from Send; permission does not block Guide.
    expect(r.kind).toBe("steer");
    expect(r.enqueue).toBe(false);
  });

  it("action steer without streaming falls through (send_now while connecting)", () => {
    const r = resolveSendIntent({
      ...base,
      viewedState: "connecting",
      liveSessionId: "s1",
      liveState: "connecting",
      hasBody: true,
      action: "steer",
    });
    // Guide unavailable during handshake; Send goes now, not into the queue.
    expect(r.kind).toBe("send_now");
    expect(r.enqueue).toBe(false);
  });

  it("action steer with empty body is blocked_empty", () => {
    const r = resolveSendIntent({
      ...base,
      viewedState: "streaming",
      hasBody: false,
      action: "steer",
    });
    expect(r.kind).toBe("blocked_empty");
  });

  it("suggestOpenNewChat when enqueue queue is crowded", () => {
    const r = resolveSendIntent({
      ...base,
      viewedState: "streaming",
      liveSessionId: "s1",
      liveState: "streaming",
      hasBody: true,
      queueLength: SEND_INTENT_CROWDED_AT,
    });
    expect(r.kind).toBe("enqueue");
    expect(r.suggestOpenNewChat).toBe(true);

    const notCrowded = resolveSendIntent({
      ...base,
      viewedState: "streaming",
      liveSessionId: "s1",
      liveState: "streaming",
      hasBody: true,
      queueLength: SEND_INTENT_CROWDED_AT - 1,
    });
    expect(notCrowded.suggestOpenNewChat).toBe(false);
  });
});

describe("resolveSendIntentBanner", () => {
  const cases: Array<[SendIntentKind, string | null]> = [
    ["send_now", null],
    ["blocked_empty", null],
    ["enqueue", "composer.intent.enqueue"],
    ["steer", "composer.intent.steer"],
    ["foreign_concurrent", "composer.intent.foreignConcurrent"],
    ["blocked_permission", "composer.intent.blockedPermission"],
  ];
  for (const [kind, key] of cases) {
    it(`${kind} → ${key}`, () => {
      expect(resolveSendIntentBanner(kind)).toBe(key);
    });
  }
});

describe("planOpenAsNewSessionInstead", () => {
  it("shows for foreign_concurrent", () => {
    const p = planOpenAsNewSessionInstead({ kind: "foreign_concurrent" });
    expect(p.show).toBe(true);
    expect(p.ctaKey).toBe("composer.intent.openAsNewChat");
    expect(p.reasonKey).toBe("composer.intent.foreignConcurrent");
  });

  it("shows for crowded enqueue only", () => {
    expect(
      planOpenAsNewSessionInstead({
        kind: "enqueue",
        queueLength: SEND_INTENT_CROWDED_AT - 1,
      }).show,
    ).toBe(false);
    expect(
      planOpenAsNewSessionInstead({
        kind: "enqueue",
        queueLength: SEND_INTENT_CROWDED_AT,
      }).show,
    ).toBe(true);
  });

  it("hidden for send_now / steer / blocked", () => {
    for (const kind of [
      "send_now",
      "steer",
      "blocked_empty",
      "blocked_permission",
    ] as SendIntentKind[]) {
      expect(planOpenAsNewSessionInstead({ kind, queueLength: 99 }).show).toBe(
        false,
      );
    }
  });
});

describe("resolveSendQueueStripIntentLabel", () => {
  it("null when strip not visible", () => {
    expect(
      resolveSendQueueStripIntentLabel({ visible: false, showHold: false }),
    ).toBeNull();
  });

  it("hold / steer hint / enqueue labels", () => {
    expect(
      resolveSendQueueStripIntentLabel({ visible: true, showHold: true }),
    ).toEqual({ labelKey: "composer.intent.stripHold" });
    expect(
      resolveSendQueueStripIntentLabel({
        visible: true,
        showHold: false,
        canSteer: true,
      }),
    ).toEqual({ labelKey: "composer.intent.stripSteerHint" });
    expect(
      resolveSendQueueStripIntentLabel({
        visible: true,
        showHold: false,
        canSteer: false,
      }),
    ).toEqual({ labelKey: "composer.intent.stripEnqueue" });
  });
});

describe("resolveSendControlLabelKey", () => {
  it("maps kinds to control labels", () => {
    expect(resolveSendControlLabelKey("enqueue")).toBe(
      "composer.intent.enqueueShort",
    );
    expect(resolveSendControlLabelKey("foreign_concurrent")).toBe(
      "composer.intent.foreignShort",
    );
    expect(resolveSendControlLabelKey("send_now")).toBe("composer.send");
    expect(resolveSendControlLabelKey("blocked_empty")).toBe("composer.send");
    expect(resolveSendControlLabelKey("steer")).toBe("composer.send");
    expect(resolveSendControlLabelKey("blocked_permission")).toBe(
      "composer.intent.blockedPermission",
    );
  });
});
