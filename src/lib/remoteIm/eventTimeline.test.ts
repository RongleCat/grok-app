import { describe, expect, it } from "vitest";
import {
  clearRimEventTimeline,
  formatRimEventAt,
  loadRimEventTimeline,
  parseRimBridgeEvent,
  parseRimEventTimeline,
  pushRimBridgeEvent,
  recordRimBridgeEvent,
  rimBridgeEventTypeKey,
  sanitizeRimEventNote,
  type RimBridgeEvent,
  type RimEventTimelineStorage,
} from "./eventTimeline";

function memStorage(seed?: string): RimEventTimelineStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (seed) data.set("grok-app.remoteIm.eventTimeline", seed);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

describe("sanitizeRimEventNote", () => {
  it("trims and caps length", () => {
    expect(sanitizeRimEventNote("  hello  ")).toBe("hello");
    expect(sanitizeRimEventNote("x".repeat(300))?.length).toBe(200);
  });

  it("drops URLs and token-like notes", () => {
    expect(sanitizeRimEventNote("see https://example.com/x")).toBeUndefined();
    expect(sanitizeRimEventNote("token=abc123secret")).toBeUndefined();
    expect(sanitizeRimEventNote("Bearer xyz")).toBeUndefined();
    expect(sanitizeRimEventNote("app_secret: super")).toBeUndefined();
  });
});

describe("parseRimBridgeEvent", () => {
  it("accepts known types and drops secrets in note", () => {
    const e = parseRimBridgeEvent({
      id: "e1",
      type: "bridge_started",
      at: "2026-07-30T00:00:00.000Z",
      note: "ok",
      channel: "feishu",
      instanceId: "feishu-default",
      // stray secret field must not appear
      app_secret: "leak",
    });
    expect(e).toEqual({
      id: "e1",
      type: "bridge_started",
      at: "2026-07-30T00:00:00.000Z",
      note: "ok",
      channel: "feishu",
      instanceId: "feishu-default",
    });
    expect(JSON.stringify(e)).not.toContain("leak");
  });

  it("rejects unknown type / empty id", () => {
    expect(parseRimBridgeEvent({ id: "x", type: "nope" })).toBeNull();
    expect(
      parseRimBridgeEvent({ id: "", type: "bridge_started" }),
    ).toBeNull();
  });
});

describe("ring buffer", () => {
  it("newest first and caps max", () => {
    const events: RimBridgeEvent[] = [];
    let cur = events;
    for (let i = 0; i < 5; i++) {
      cur = pushRimBridgeEvent(
        cur,
        {
          id: `id-${i}`,
          type: "bridge_started",
          at: `2026-07-30T00:00:0${i}.000Z`,
        },
        3,
      );
    }
    expect(cur).toHaveLength(3);
    expect(cur[0].id).toBe("id-4");
    expect(cur[2].id).toBe("id-2");
  });

  it("parseRimEventTimeline tolerates corrupt JSON", () => {
    expect(parseRimEventTimeline("not-json")).toEqual([]);
    expect(parseRimEventTimeline(null)).toEqual([]);
    expect(
      parseRimEventTimeline(
        JSON.stringify([
          { id: "a", type: "test_ok", at: "t" },
          { id: "b", type: "garbage" },
          { id: "a", type: "test_ok", at: "t2" },
        ]),
      ),
    ).toEqual([{ id: "a", type: "test_ok", at: "t" }]);
  });
});

describe("record / load / clear", () => {
  it("persists without secrets", () => {
    const storage = memStorage();
    const next = recordRimBridgeEvent(
      {
        type: "channel_reloaded",
        channel: "telegram",
        instanceId: "tg-1",
        note: "reload",
      },
      storage,
    );
    expect(next).toHaveLength(1);
    expect(next[0].type).toBe("channel_reloaded");
    expect(next[0].channel).toBe("telegram");

    const loaded = loadRimEventTimeline(storage);
    expect(loaded).toHaveLength(1);
    expect(JSON.stringify(loaded)).not.toMatch(/secret|token=|xoxb/i);

    const cleared = clearRimEventTimeline(storage);
    expect(cleared).toEqual([]);
    expect(loadRimEventTimeline(storage)).toEqual([]);
  });

  it("drops secret-looking notes on record", () => {
    const storage = memStorage();
    recordRimBridgeEvent(
      {
        type: "test_fail",
        note: "token=super-secret-value-here",
      },
      storage,
    );
    const loaded = loadRimEventTimeline(storage);
    expect(loaded[0].note).toBeUndefined();
  });
});

describe("helpers", () => {
  it("rimBridgeEventTypeKey", () => {
    expect(rimBridgeEventTypeKey("bridge_started")).toBe(
      "settings.remoteIm.timeline.type.bridge_started",
    );
  });

  it("formatRimEventAt same-day time", () => {
    const now = Date.parse("2026-07-30T15:00:00.000Z");
    const s = formatRimEventAt("2026-07-30T14:30:00.000Z", "en", now);
    expect(s.length).toBeGreaterThan(0);
    expect(s).not.toContain("2026-07-30T");
  });
});
