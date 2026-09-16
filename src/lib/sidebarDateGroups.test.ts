import { describe, expect, it } from "vitest";
import {
  compareSessionsPinThenUpdated,
  groupSessionsByDate,
  localDayOffset,
  parseSessionUpdatedAt,
  partitionGlobalPinned,
  sidebarNavSessionIds,
  SIDEBAR_DATE_GROUP_I18N_KEYS,
  SIDEBAR_DATE_GROUP_ORDER,
  sidebarDateGroupId,
  sortSessionsForSidebar,
  startOfLocalDay,
} from "./sidebarDateGroups";

/** Fixed “now”: 2026-03-15 15:30 local (not near DST edges for most zones). */
const NOW = new Date(2026, 2, 15, 15, 30, 0, 0);

function isoLocal(
  y: number,
  m0: number,
  d: number,
  h = 12,
  min = 0,
): string {
  return new Date(y, m0, d, h, min, 0, 0).toISOString();
}

describe("startOfLocalDay", () => {
  it("zeros clock to local midnight", () => {
    const s = startOfLocalDay(NOW);
    expect(s.getFullYear()).toBe(2026);
    expect(s.getMonth()).toBe(2);
    expect(s.getDate()).toBe(15);
    expect(s.getHours()).toBe(0);
    expect(s.getMinutes()).toBe(0);
    expect(s.getSeconds()).toBe(0);
  });
});

describe("parseSessionUpdatedAt", () => {
  it("parses ISO strings and rejects empty", () => {
    const t = parseSessionUpdatedAt("2026-03-15T03:00:00.000Z");
    expect(Number.isFinite(t)).toBe(true);
    expect(parseSessionUpdatedAt("")).toBeNaN();
    expect(parseSessionUpdatedAt(null)).toBeNaN();
    expect(parseSessionUpdatedAt(undefined)).toBeNaN();
  });
});

describe("sidebarDateGroupId / localDayOffset", () => {
  it("buckets today / yesterday / previous7 / older with fixed now", () => {
    // Same calendar day as NOW (afternoon vs morning still today).
    expect(sidebarDateGroupId(isoLocal(2026, 2, 15, 1, 0), NOW)).toBe(
      "today",
    );
    expect(localDayOffset(isoLocal(2026, 2, 15, 23, 59), NOW)).toBe(0);

    // Yesterday.
    expect(sidebarDateGroupId(isoLocal(2026, 2, 14, 23, 0), NOW)).toBe(
      "yesterday",
    );
    expect(localDayOffset(isoLocal(2026, 2, 14, 0, 1), NOW)).toBe(1);

    // 2 days ago → previous7.
    expect(sidebarDateGroupId(isoLocal(2026, 2, 13, 12, 0), NOW)).toBe(
      "previous7",
    );
    // Exactly 7 local days ago still previous7.
    expect(sidebarDateGroupId(isoLocal(2026, 2, 8, 12, 0), NOW)).toBe(
      "previous7",
    );
    expect(localDayOffset(isoLocal(2026, 2, 8, 0, 0), NOW)).toBe(7);

    // 8 days ago → older.
    expect(sidebarDateGroupId(isoLocal(2026, 2, 7, 12, 0), NOW)).toBe(
      "older",
    );
    expect(localDayOffset(isoLocal(2026, 2, 7, 12, 0), NOW)).toBe(8);

    // Far past.
    expect(sidebarDateGroupId(isoLocal(2025, 0, 1, 0, 0), NOW)).toBe(
      "older",
    );
  });

  it("treats future timestamps as today", () => {
    expect(sidebarDateGroupId(isoLocal(2026, 2, 16, 9, 0), NOW)).toBe(
      "today",
    );
    expect(localDayOffset(isoLocal(2026, 2, 20, 0, 0), NOW)).toBeLessThan(0);
  });

  it("treats invalid timestamps as older", () => {
    expect(sidebarDateGroupId("not-a-date", NOW)).toBe("older");
    expect(sidebarDateGroupId("", NOW)).toBe("older");
    expect(sidebarDateGroupId(null, NOW)).toBe("older");
  });
});

describe("compareSessionsPinThenUpdated", () => {
  it("orders pinned first, then newest updatedAt", () => {
    const a = { updatedAt: isoLocal(2026, 2, 15, 10), pinned: false };
    const b = { updatedAt: isoLocal(2026, 2, 15, 11), pinned: true };
    const c = { updatedAt: isoLocal(2026, 2, 15, 12), pinned: true };
    const d = { updatedAt: isoLocal(2026, 2, 15, 9), pinned: false };
    const list = [a, b, c, d].sort(compareSessionsPinThenUpdated);
    expect(list).toEqual([c, b, a, d]);
  });
});

describe("sortSessionsForSidebar", () => {
  it("is flat pin-then-updated order without date buckets", () => {
    const sessions = [
      {
        id: "old-pin",
        updatedAt: isoLocal(2026, 1, 1, 12),
        pinned: true,
      },
      {
        id: "today-a",
        updatedAt: isoLocal(2026, 2, 15, 10),
        pinned: false,
      },
      {
        id: "today-pin",
        updatedAt: isoLocal(2026, 2, 15, 8),
        pinned: true,
      },
      {
        id: "yest",
        updatedAt: isoLocal(2026, 2, 14, 18),
        pinned: false,
      },
    ];
    const sorted = sortSessionsForSidebar(sessions);
    // All pins first (newest pin first), then unpinned by updatedAt.
    expect(sorted.map((s) => s.id)).toEqual([
      "today-pin",
      "old-pin",
      "today-a",
      "yest",
    ]);
    // Does not mutate input.
    expect(sessions.map((s) => s.id)).toEqual([
      "old-pin",
      "today-a",
      "today-pin",
      "yest",
    ]);
  });
});

describe("partitionGlobalPinned", () => {
  it("lifts pinned chats above folders, newest pin first", () => {
    const sessions = [
      {
        id: "b-unpinned",
        projectId: "b",
        updatedAt: isoLocal(2026, 2, 15, 12),
        pinned: false,
      },
      {
        id: "b-pin",
        projectId: "b",
        updatedAt: isoLocal(2026, 2, 15, 8),
        pinned: true,
      },
      {
        id: "a-pin",
        projectId: "a",
        updatedAt: isoLocal(2026, 2, 15, 10),
        pinned: true,
      },
      {
        id: "orphan-pin",
        projectId: null,
        updatedAt: isoLocal(2026, 2, 14, 9),
        pinned: true,
      },
      {
        id: "archived-pin",
        projectId: "a",
        updatedAt: isoLocal(2026, 2, 15, 20),
        pinned: true,
        archived: true,
      },
    ];
    const { pinned, rest } = partitionGlobalPinned(sessions);
    expect(pinned.map((s) => s.id)).toEqual([
      "a-pin",
      "b-pin",
      "orphan-pin",
    ]);
    expect(rest.map((s) => s.id)).toEqual(["b-unpinned"]);
  });
});

describe("sidebarNavSessionIds", () => {
  it("lists global pins even when their project folder is collapsed", () => {
    const sessions = [
      {
        id: "b-pin",
        projectId: "b",
        updatedAt: isoLocal(2026, 2, 15, 8),
        pinned: true,
      },
      {
        id: "a-chat",
        projectId: "a",
        updatedAt: isoLocal(2026, 2, 15, 12),
      },
      {
        id: "b-chat",
        projectId: "b",
        updatedAt: isoLocal(2026, 2, 15, 11),
      },
    ];
    expect(
      sidebarNavSessionIds({
        sessions,
        projects: [{ id: "a" }, { id: "b" }],
        projectsOpen: true,
        historyOpen: false,
        expandedProjects: { a: true, b: false },
      }),
    ).toEqual(["b-pin", "a-chat"]);
  });
});

describe("groupSessionsByDate", () => {
  it("groups into ordered non-empty buckets and keeps pins on top of each group", () => {
    const sessions = [
      {
        id: "old-pin",
        updatedAt: isoLocal(2026, 1, 1, 12),
        pinned: true,
      },
      {
        id: "today-a",
        updatedAt: isoLocal(2026, 2, 15, 10),
        pinned: false,
      },
      {
        id: "today-pin",
        updatedAt: isoLocal(2026, 2, 15, 8),
        pinned: true,
      },
      {
        id: "yest",
        updatedAt: isoLocal(2026, 2, 14, 18),
        pinned: false,
      },
      {
        id: "week",
        updatedAt: isoLocal(2026, 2, 10, 12),
        pinned: false,
      },
      {
        id: "older",
        updatedAt: isoLocal(2026, 1, 20, 12),
        pinned: false,
      },
    ];

    const groups = groupSessionsByDate(sessions, NOW);
    expect(groups.map((g) => g.id)).toEqual([
      "today",
      "yesterday",
      "previous7",
      "older",
    ]);

    expect(groups[0]!.sessions.map((s) => s.id)).toEqual([
      "today-pin",
      "today-a",
    ]);
    expect(groups[1]!.sessions.map((s) => s.id)).toEqual(["yest"]);
    expect(groups[2]!.sessions.map((s) => s.id)).toEqual(["week"]);
    // Pins stay at top of their group (older), not floated above Today.
    expect(groups[3]!.sessions.map((s) => s.id)).toEqual([
      "old-pin",
      "older",
    ]);
  });

  it("omits empty groups and does not mutate input", () => {
    const input = [
      { id: "1", updatedAt: isoLocal(2026, 2, 15, 12), pinned: false },
    ];
    const snapshot = input.map((s) => ({ ...s }));
    const groups = groupSessionsByDate(input, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe("today");
    expect(input).toEqual(snapshot);
  });

  it("exposes stable i18n keys for every group id", () => {
    for (const id of SIDEBAR_DATE_GROUP_ORDER) {
      expect(SIDEBAR_DATE_GROUP_I18N_KEYS[id]).toMatch(/^sidebar\.dateGroup\./);
    }
  });
});
