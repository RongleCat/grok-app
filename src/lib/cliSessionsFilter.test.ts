import { describe, expect, it } from "vitest";
import {
  countUnlinkedCliSessions,
  filterCliSessions,
} from "./cliSessionsFilter";

const rows = [
  {
    agentSessionId: "abc-1111-uuid",
    title: "Fix login bug",
    cwd: "/Users/me/Code/app",
    alreadyLinked: false,
  },
  {
    agentSessionId: "def-2222-uuid",
    title: "Refactor sessions bridge",
    cwd: "/Users/me/Code/grok-app",
    alreadyLinked: true,
  },
  {
    agentSessionId: "ghi-3333-uuid",
    title: "CLI import polish",
    cwd: null,
    alreadyLinked: false,
  },
];

describe("filterCliSessions", () => {
  it("returns all rows for empty query", () => {
    expect(filterCliSessions(rows, "")).toEqual(rows);
  });

  it("returns all rows for whitespace-only query", () => {
    expect(filterCliSessions(rows, "   \t  ")).toEqual(rows);
  });

  it("matches title case-insensitively", () => {
    expect(filterCliSessions(rows, "login")).toEqual([rows[0]]);
    expect(filterCliSessions(rows, "REFACTOR")).toEqual([rows[1]]);
  });

  it("matches agent session id case-insensitively", () => {
    expect(filterCliSessions(rows, "def-2222")).toEqual([rows[1]]);
    expect(filterCliSessions(rows, "GHI-3333")).toEqual([rows[2]]);
  });

  it("matches cwd when present", () => {
    expect(filterCliSessions(rows, "grok-app")).toEqual([rows[1]]);
    expect(filterCliSessions(rows, "/users/me/code/app")).toEqual([rows[0]]);
  });

  it("returns empty array when nothing matches", () => {
    expect(filterCliSessions(rows, "no-such-session-xyz")).toEqual([]);
  });

  it("preserves input order of matches", () => {
    const hits = filterCliSessions(rows, "uuid");
    expect(hits.map((r) => r.agentSessionId)).toEqual([
      "abc-1111-uuid",
      "def-2222-uuid",
      "ghi-3333-uuid",
    ]);
  });
});

describe("countUnlinkedCliSessions", () => {
  it("counts rows that are not already linked", () => {
    expect(countUnlinkedCliSessions(rows)).toBe(2);
  });

  it("returns 0 for empty list", () => {
    expect(countUnlinkedCliSessions([])).toBe(0);
  });

  it("returns 0 when all linked", () => {
    expect(
      countUnlinkedCliSessions([{ alreadyLinked: true }, { alreadyLinked: true }]),
    ).toBe(0);
  });
});
