import { describe, expect, it } from "vitest";
import {
  TRACE_HISTORY_MAX,
  loadTraceHistory,
  parseTraceHistory,
  parseTraceHistoryEntry,
  pushTraceHistory,
  recordTraceExport,
  saveTraceHistory,
  traceHistoryFileName,
  traceHistoryLabel,
  type TraceHistoryEntry,
  type TraceHistoryStorage,
} from "./traceHistory";

function memStorage(seed?: Record<string, string>): TraceHistoryStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const sample = (
  n: number,
  overrides?: Partial<TraceHistoryEntry>,
): TraceHistoryEntry => ({
  sessionId: `sess-${n}`,
  path: `/tmp/traces/trace-${n}.tar.gz`,
  exportedAt: new Date(1_700_000_000_000 + n * 1000).toISOString(),
  title: `Chat ${n}`,
  ...overrides,
});

describe("parseTraceHistoryEntry", () => {
  it("accepts valid entries and trims fields", () => {
    expect(
      parseTraceHistoryEntry({
        sessionId: "  abc  ",
        path: "  /tmp/a.tar.gz  ",
        title: "  Hello  ",
        exportedAt: "2026-01-01T00:00:00.000Z",
        secret: "should-drop",
      }),
    ).toEqual({
      sessionId: "abc",
      path: "/tmp/a.tar.gz",
      title: "Hello",
      exportedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("rejects missing sessionId or path", () => {
    expect(parseTraceHistoryEntry({ path: "/x" })).toBeNull();
    expect(parseTraceHistoryEntry({ sessionId: "s" })).toBeNull();
    expect(parseTraceHistoryEntry(null)).toBeNull();
    expect(parseTraceHistoryEntry("nope")).toBeNull();
  });

  it("caps title length and omits empty title", () => {
    const long = "x".repeat(500);
    const e = parseTraceHistoryEntry({
      sessionId: "s",
      path: "/p",
      title: long,
    });
    expect(e?.title?.length).toBe(200);
    const emptyTitle = parseTraceHistoryEntry({
      sessionId: "s",
      path: "/p",
      title: "  ",
    });
    expect(emptyTitle).toMatchObject({ sessionId: "s", path: "/p" });
    expect(emptyTitle).not.toHaveProperty("title");
  });
});

describe("parseTraceHistory", () => {
  it("parses JSON string and array, newest-first order preserved", () => {
    const a = sample(1);
    const b = sample(2);
    expect(parseTraceHistory(JSON.stringify([a, b]))).toEqual([a, b]);
    expect(parseTraceHistory([a, b])).toEqual([a, b]);
  });

  it("returns empty on corrupt input", () => {
    expect(parseTraceHistory("{not json")).toEqual([]);
    expect(parseTraceHistory(42)).toEqual([]);
    expect(parseTraceHistory(undefined)).toEqual([]);
  });

  it("dedupes by path keeping first occurrence", () => {
    const a = sample(1, { path: "/same.tar.gz", title: "first" });
    const b = sample(2, { path: "/same.tar.gz", title: "second" });
    expect(parseTraceHistory([a, b])).toEqual([a]);
  });

  it("caps at max", () => {
    const many = Array.from({ length: 30 }, (_, i) => sample(i));
    expect(parseTraceHistory(many, 5)).toHaveLength(5);
    expect(parseTraceHistory(many).length).toBeLessThanOrEqual(
      TRACE_HISTORY_MAX,
    );
  });
});

describe("pushTraceHistory (ring buffer)", () => {
  it("prepends newest and trims to max", () => {
    const existing = Array.from({ length: 3 }, (_, i) => sample(i));
    const next = pushTraceHistory(existing, sample(99), 3);
    expect(next).toHaveLength(3);
    expect(next[0]!.sessionId).toBe("sess-99");
    expect(next.map((e) => e.sessionId)).toEqual([
      "sess-99",
      "sess-0",
      "sess-1",
    ]);
  });

  it("moves existing path to front (dedupe)", () => {
    const a = sample(1, { path: "/a.tar.gz" });
    const b = sample(2, { path: "/b.tar.gz" });
    const again = sample(3, { path: "/a.tar.gz", title: "updated" });
    const next = pushTraceHistory([a, b], again, 20);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ path: "/a.tar.gz", title: "updated" });
    expect(next[1]!.path).toBe("/b.tar.gz");
  });

  it("ignores invalid entry", () => {
    const existing = [sample(1)];
    expect(
      pushTraceHistory(existing, {
        sessionId: "",
        path: "",
        exportedAt: "",
      }),
    ).toEqual(existing);
  });

  it("enforces default max of 20", () => {
    let list: TraceHistoryEntry[] = [];
    for (let i = 0; i < 25; i++) {
      list = pushTraceHistory(list, sample(i));
    }
    expect(list).toHaveLength(TRACE_HISTORY_MAX);
    expect(list[0]!.sessionId).toBe("sess-24");
    expect(list[list.length - 1]!.sessionId).toBe("sess-5");
  });
});

describe("load / save / recordTraceExport", () => {
  it("round-trips via storage", () => {
    const storage = memStorage();
    const entries = [sample(1), sample(2)];
    saveTraceHistory(entries, storage);
    expect(loadTraceHistory(storage)).toEqual(entries);
  });

  it("recordTraceExport prepends and persists", () => {
    const storage = memStorage();
    saveTraceHistory([sample(1)], storage);
    const next = recordTraceExport(
      {
        sessionId: "sess-new",
        path: "/tmp/new.tar.gz",
        title: "New chat",
      },
      storage,
    );
    expect(next[0]).toMatchObject({
      sessionId: "sess-new",
      path: "/tmp/new.tar.gz",
      title: "New chat",
    });
    expect(next).toHaveLength(2);
    expect(loadTraceHistory(storage)[0]!.path).toBe("/tmp/new.tar.gz");
  });

  it("load returns empty when storage throws or missing", () => {
    expect(loadTraceHistory(memStorage())).toEqual([]);
    const bad: TraceHistoryStorage = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {},
    };
    expect(loadTraceHistory(bad)).toEqual([]);
  });
});

describe("display helpers", () => {
  it("traceHistoryFileName handles posix and windows", () => {
    expect(traceHistoryFileName("/tmp/foo/bar.tar.gz")).toBe("bar.tar.gz");
    expect(traceHistoryFileName("C:\\Users\\a\\x.tar.gz")).toBe("x.tar.gz");
    expect(traceHistoryFileName("plain.tar.gz")).toBe("plain.tar.gz");
    expect(traceHistoryFileName("")).toBe("");
  });

  it("traceHistoryLabel prefers title then short id", () => {
    expect(
      traceHistoryLabel({
        sessionId: "abcdefghijklmnop",
        path: "/p",
        exportedAt: "",
        title: "My chat",
      }),
    ).toBe("My chat");
    expect(
      traceHistoryLabel({
        sessionId: "abcdefghijklmnop",
        path: "/p",
        exportedAt: "",
      }),
    ).toBe("abcdefgh…");
    expect(
      traceHistoryLabel({
        sessionId: "short",
        path: "/p",
        exportedAt: "",
      }),
    ).toBe("short");
  });
});
