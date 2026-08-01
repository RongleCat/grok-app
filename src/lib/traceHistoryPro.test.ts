import { describe, expect, it } from "vitest";
import type { TraceHistoryEntry } from "./traceHistory";
import {
  TRACE_HISTORY_SCOPES,
  countTraceHistoryMeta,
  filterTraceHistory,
  formatTraceSize,
  hasActiveTraceHistoryFilters,
  normalizeTraceHistoryScope,
  planClearTraceHistory,
  resolveTraceHistoryEmptyState,
  shouldShowTraceUploadedBadge,
  traceHistoryScopeLabelKey,
  traceMatchesScope,
} from "./traceHistoryPro";

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

const LIST: TraceHistoryEntry[] = [
  sample(1, {
    title: "Local login",
    path: "/tmp/local-login.tar.gz",
    sizeBytes: 2048,
  }),
  sample(2, {
    title: "Uploaded report",
    path: "/tmp/up-report.tar.gz",
    uploaded: true,
    sizeBytes: 1024 * 1024,
  }),
  sample(3, {
    title: "Other local",
    path: "/tmp/other.tar.gz",
  }),
  sample(4, {
    title: "Remote-ish path only",
    path: "/tmp/remote-looking.tar.gz",
    // no uploaded flag — must stay local
  }),
];

describe("normalizeTraceHistoryScope / chips", () => {
  it("orders chips all · local · uploaded", () => {
    expect(TRACE_HISTORY_SCOPES).toEqual(["all", "local", "uploaded"]);
  });

  it("normalizes scope and uploadedOnly", () => {
    expect(normalizeTraceHistoryScope("all")).toBe("all");
    expect(normalizeTraceHistoryScope("local")).toBe("local");
    expect(normalizeTraceHistoryScope("uploaded")).toBe("uploaded");
    expect(normalizeTraceHistoryScope(undefined, true)).toBe("uploaded");
    expect(normalizeTraceHistoryScope(undefined, false)).toBe("local");
    expect(normalizeTraceHistoryScope(null, null)).toBe("all");
    // scope wins over uploadedOnly
    expect(normalizeTraceHistoryScope("local", true)).toBe("local");
    expect(normalizeTraceHistoryScope("uploaded", false)).toBe("uploaded");
    expect(normalizeTraceHistoryScope("nope" as "all")).toBe("all");
  });

  it("maps chip labels to i18n keys", () => {
    expect(traceHistoryScopeLabelKey("all")).toBe("session.tracesFilter.all");
    expect(traceHistoryScopeLabelKey("local")).toBe(
      "session.tracesFilter.local",
    );
    expect(traceHistoryScopeLabelKey("uploaded")).toBe(
      "session.tracesFilter.uploaded",
    );
  });
});

describe("traceMatchesScope / uploaded honesty", () => {
  it("only uploaded===true matches uploaded scope", () => {
    expect(traceMatchesScope({ uploaded: true }, "uploaded")).toBe(true);
    expect(traceMatchesScope({ uploaded: false }, "uploaded")).toBe(false);
    expect(traceMatchesScope({}, "uploaded")).toBe(false);
    expect(traceMatchesScope(null, "uploaded")).toBe(false);
  });

  it("local excludes uploaded=true only", () => {
    expect(traceMatchesScope({ uploaded: true }, "local")).toBe(false);
    expect(traceMatchesScope({}, "local")).toBe(true);
    expect(traceMatchesScope({ uploaded: false }, "local")).toBe(true);
  });

  it("shouldShowTraceUploadedBadge is strict", () => {
    expect(shouldShowTraceUploadedBadge({ uploaded: true })).toBe(true);
    expect(shouldShowTraceUploadedBadge({})).toBe(false);
    expect(shouldShowTraceUploadedBadge(null)).toBe(false);
    expect(
      shouldShowTraceUploadedBadge({
        uploaded: "yes" as unknown as boolean,
      }),
    ).toBe(false);
  });
});

describe("filterTraceHistory", () => {
  it("accepts string query (backward-compatible)", () => {
    expect(filterTraceHistory(LIST, "login").map((e) => e.sessionId)).toEqual([
      "sess-1",
    ]);
    expect(filterTraceHistory(LIST, "")).toHaveLength(4);
    expect(filterTraceHistory(LIST, "  ")).toHaveLength(4);
  });

  it("filters by uploadedOnly true/false", () => {
    expect(
      filterTraceHistory(LIST, { uploadedOnly: true }).map((e) => e.sessionId),
    ).toEqual(["sess-2"]);
    expect(
      filterTraceHistory(LIST, { uploadedOnly: false }).map((e) => e.sessionId),
    ).toEqual(["sess-1", "sess-3", "sess-4"]);
  });

  it("filters by scope chips", () => {
    expect(
      filterTraceHistory(LIST, { scope: "uploaded" }).map((e) => e.sessionId),
    ).toEqual(["sess-2"]);
    expect(
      filterTraceHistory(LIST, { scope: "local" }).map((e) => e.sessionId),
    ).toEqual(["sess-1", "sess-3", "sess-4"]);
    expect(filterTraceHistory(LIST, { scope: "all" })).toHaveLength(4);
  });

  it("combines scope + free-text (AND)", () => {
    expect(
      filterTraceHistory(LIST, {
        scope: "local",
        query: "login",
      }).map((e) => e.sessionId),
    ).toEqual(["sess-1"]);
    expect(
      filterTraceHistory(LIST, {
        uploadedOnly: true,
        query: "local",
      }),
    ).toHaveLength(0);
    expect(
      filterTraceHistory(LIST, {
        scope: "uploaded",
        query: "report",
      }).map((e) => e.sessionId),
    ).toEqual(["sess-2"]);
  });

  it("never invents upload from path text alone", () => {
    // "remote" appears in path of sess-4 but uploaded is unset
    const hits = filterTraceHistory(LIST, {
      scope: "uploaded",
      query: "remote",
    });
    expect(hits).toEqual([]);
    expect(
      filterTraceHistory(LIST, { scope: "local", query: "remote" }).map(
        (e) => e.sessionId,
      ),
    ).toEqual(["sess-4"]);
  });

  it("returns empty for empty input", () => {
    expect(filterTraceHistory([], { scope: "uploaded" })).toEqual([]);
  });
});

describe("countTraceHistoryMeta", () => {
  it("counts total / local / uploaded honestly", () => {
    expect(countTraceHistoryMeta(LIST)).toEqual({
      total: 4,
      local: 3,
      uploaded: 1,
    });
    expect(countTraceHistoryMeta([])).toEqual({
      total: 0,
      local: 0,
      uploaded: 0,
    });
    expect(countTraceHistoryMeta(null)).toEqual({
      total: 0,
      local: 0,
      uploaded: 0,
    });
  });

  it("does not invent uploaded when flag is missing", () => {
    expect(
      countTraceHistoryMeta([
        sample(1),
        sample(2, { path: "/upload/x.tar.gz" }),
      ]),
    ).toEqual({ total: 2, local: 2, uploaded: 0 });
  });
});

describe("hasActiveTraceHistoryFilters", () => {
  it("detects query and non-all scope", () => {
    expect(hasActiveTraceHistoryFilters(undefined)).toBe(false);
    expect(hasActiveTraceHistoryFilters("")).toBe(false);
    expect(hasActiveTraceHistoryFilters("x")).toBe(true);
    expect(hasActiveTraceHistoryFilters({ scope: "all", query: "" })).toBe(
      false,
    );
    expect(hasActiveTraceHistoryFilters({ scope: "local" })).toBe(true);
    expect(hasActiveTraceHistoryFilters({ uploadedOnly: true })).toBe(true);
    expect(hasActiveTraceHistoryFilters({ query: "  hi  " })).toBe(true);
  });
});

describe("resolveTraceHistoryEmptyState", () => {
  it("returns null when filtered rows exist", () => {
    expect(
      resolveTraceHistoryEmptyState({ total: 3, filtered: 2 }),
    ).toBeNull();
  });

  it("empty ring buffer → empty (export prompt)", () => {
    const empty = resolveTraceHistoryEmptyState({ total: 0, filtered: 0 });
    expect(empty).toMatchObject({
      kind: "empty",
      titleKey: "session.tracesEmpty",
      hintKey: "session.tracesEmptyHint",
      showClearFilters: false,
    });
  });

  it("filter empty with clear CTA", () => {
    const empty = resolveTraceHistoryEmptyState({
      total: 4,
      filtered: 0,
      scope: "uploaded",
      query: "nope",
    });
    expect(empty).toMatchObject({
      kind: "filter_empty",
      titleKey: "session.tracesEmptyFilter",
      hintKey: "session.tracesEmptyFilterHint",
      showClearFilters: true,
    });
  });

  it("honors explicit hasFilters", () => {
    expect(
      resolveTraceHistoryEmptyState({
        total: 2,
        filtered: 0,
        hasFilters: true,
      })?.kind,
    ).toBe("filter_empty");
    expect(
      resolveTraceHistoryEmptyState({
        total: 2,
        filtered: 0,
        hasFilters: false,
      })?.kind,
    ).toBe("empty");
  });
});

describe("planClearTraceHistory", () => {
  it("requires confirm only when non-empty and reports count", () => {
    const empty = planClearTraceHistory([]);
    expect(empty).toEqual({
      ok: true,
      count: 0,
      confirmNeeded: false,
      next: [],
      logMeta: null,
    });

    const plan = planClearTraceHistory(LIST);
    expect(plan.ok).toBe(true);
    expect(plan.count).toBe(4);
    expect(plan.confirmNeeded).toBe(true);
    expect(plan.next).toEqual([]);
    expect(plan.logMeta).toEqual({ clearedCount: 4 });
  });

  it("tolerates null / undefined", () => {
    expect(planClearTraceHistory(null).count).toBe(0);
    expect(planClearTraceHistory(undefined).confirmNeeded).toBe(false);
  });
});

describe("formatTraceSize", () => {
  it("returns null when unknown — never invents", () => {
    expect(formatTraceSize(undefined)).toBeNull();
    expect(formatTraceSize(null)).toBeNull();
    expect(formatTraceSize(-1)).toBeNull();
  });

  it("formats known sizes", () => {
    expect(formatTraceSize(500)).toBe("500 B");
    expect(formatTraceSize(2048)).toBe("2.0 KB");
    expect(formatTraceSize(1024 * 1024)).toBe("1.0 MB");
  });
});
