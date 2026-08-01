import { describe, expect, it } from "vitest";
import {
  classifyCliSessionsSearchError,
  CLI_SESSIONS_LINK_FILTERS,
  cliSessionMatchesLinkFilter,
  cliSessionsLinkFilterLabelKey,
  countCliSessionsByLink,
  filterCliSessionHits,
  filterCliSessionsByLink,
  hasActiveCliSessionsFilters,
  isCliSessionsSearchSoftFailError,
  planImportSelection,
  rankCliSessionHits,
  resolveCliSessionsEmptyState,
  scoreCliSessionHit,
} from "./cliSessionsSearchPro";

const rows = [
  {
    agentSessionId: "abc-1111-uuid",
    title: "Fix login bug",
    cwd: "/Users/me/Code/app",
    alreadyLinked: false,
    dir: "/tmp/sess-a",
    firstPrompt: null as string | null,
  },
  {
    agentSessionId: "def-2222-uuid",
    title: "Refactor sessions bridge",
    cwd: "/Users/me/Code/grok-app",
    alreadyLinked: true,
    dir: "/tmp/sess-b",
    firstPrompt: "please refactor the bridge",
  },
  {
    agentSessionId: "ghi-3333-uuid",
    title: "CLI import polish",
    cwd: null as string | null,
    alreadyLinked: false,
    dir: "",
    firstPrompt: "please polish the import UX for sessions",
  },
];

describe("link filter chips", () => {
  it("exposes ordered all · linked · unlinked", () => {
    expect([...CLI_SESSIONS_LINK_FILTERS]).toEqual([
      "all",
      "linked",
      "unlinked",
    ]);
  });

  it("counts by link state", () => {
    expect(countCliSessionsByLink(rows)).toEqual({
      all: 3,
      linked: 1,
      unlinked: 2,
    });
    expect(countCliSessionsByLink([])).toEqual({
      all: 0,
      linked: 0,
      unlinked: 0,
    });
  });

  it("matches filter chips", () => {
    expect(cliSessionMatchesLinkFilter(rows[0], "all")).toBe(true);
    expect(cliSessionMatchesLinkFilter(rows[0], "unlinked")).toBe(true);
    expect(cliSessionMatchesLinkFilter(rows[0], "linked")).toBe(false);
    expect(cliSessionMatchesLinkFilter(rows[1], "linked")).toBe(true);
    expect(cliSessionMatchesLinkFilter(null, "all")).toBe(false);
  });

  it("filters by link chip", () => {
    expect(filterCliSessionsByLink(rows, "linked")).toEqual([rows[1]]);
    expect(filterCliSessionsByLink(rows, "unlinked")).toEqual([
      rows[0],
      rows[2],
    ]);
    expect(filterCliSessionsByLink(rows, "all")).toEqual(rows);
  });

  it("detects active filters", () => {
    expect(hasActiveCliSessionsFilters({})).toBe(false);
    expect(hasActiveCliSessionsFilters({ query: "  " })).toBe(false);
    expect(hasActiveCliSessionsFilters({ link: "all" })).toBe(false);
    expect(hasActiveCliSessionsFilters({ query: "login" })).toBe(true);
    expect(hasActiveCliSessionsFilters({ link: "linked" })).toBe(true);
  });

  it("maps label keys", () => {
    expect(cliSessionsLinkFilterLabelKey("all")).toBe(
      "settings.cliSessions.filterAll",
    );
    expect(cliSessionsLinkFilterLabelKey("linked")).toBe(
      "settings.cliSessions.filterLinked",
    );
    expect(cliSessionsLinkFilterLabelKey("unlinked")).toBe(
      "settings.cliSessions.filterUnlinked",
    );
  });
});

describe("filterCliSessionHits / rank", () => {
  it("returns all rows for empty query + all link", () => {
    expect(filterCliSessionHits(rows, {})).toEqual(rows);
    expect(filterCliSessionHits(rows, "")).toEqual(rows);
  });

  it("filters by free-text (title / id / prompt)", () => {
    expect(filterCliSessionHits(rows, { query: "login" })).toEqual([rows[0]]);
    expect(filterCliSessionHits(rows, { query: "def-2222" })).toEqual([
      rows[1],
    ]);
    expect(filterCliSessionHits(rows, { query: "polish the import" })).toEqual(
      [rows[2]],
    );
  });

  it("ANDs link chip with free-text", () => {
    // "uuid" matches all three; unlinked narrows to two.
    const hits = filterCliSessionHits(rows, {
      query: "uuid",
      link: "unlinked",
    });
    expect(hits.map((r) => r.agentSessionId)).toEqual([
      "abc-1111-uuid",
      "ghi-3333-uuid",
    ]);
  });

  it("never invents rows when nothing matches", () => {
    expect(
      filterCliSessionHits(rows, { query: "no-such-session-xyz" }),
    ).toEqual([]);
    expect(filterCliSessionHits([], { query: "login" })).toEqual([]);
  });

  it("ranks title matches above prompt matches", () => {
    const mixed = [
      {
        agentSessionId: "p-1",
        title: "Other",
        firstPrompt: "login flow details",
        alreadyLinked: false,
      },
      {
        agentSessionId: "t-1",
        title: "Login redesign",
        firstPrompt: "hi",
        alreadyLinked: false,
      },
      {
        agentSessionId: "id-1",
        title: "Misc",
        agentSessionId2: "x",
        firstPrompt: null,
        alreadyLinked: false,
      },
    ];
    // Fix id row
    const withId = [
      mixed[0],
      mixed[1],
      {
        agentSessionId: "login-id-999",
        title: "Misc",
        firstPrompt: null as string | null,
        alreadyLinked: false,
      },
    ];
    const ranked = filterCliSessionHits(withId, { query: "login" });
    expect(ranked.map((r) => r.agentSessionId)).toEqual([
      "t-1", // title
      "login-id-999", // id
      "p-1", // prompt
    ]);
  });

  it("scoreCliSessionHit tiers", () => {
    expect(scoreCliSessionHit(rows[0], "Fix login bug").tier).toBe(
      "title_exact",
    );
    expect(scoreCliSessionHit(rows[0], "Fix").tier).toBe("title_prefix");
    expect(scoreCliSessionHit(rows[0], "login").tier).toBe("title");
    expect(scoreCliSessionHit(rows[0], "abc-1111").tier).toBe("id");
    expect(scoreCliSessionHit(rows[2], "import UX").tier).toBe("prompt");
    expect(scoreCliSessionHit(rows[0], "Code/app").tier).toBe("cwd");
    expect(scoreCliSessionHit(rows[0], "").tier).toBe("none");
  });

  it("rankCliSessionHits is stable for equal scores", () => {
    const same = [
      { agentSessionId: "a-1", title: "Alpha session", alreadyLinked: false },
      { agentSessionId: "b-1", title: "Beta session", alreadyLinked: false },
    ];
    const ranked = rankCliSessionHits(same, "session");
    expect(ranked.map((r) => r.agentSessionId)).toEqual(["a-1", "b-1"]);
  });
});

describe("resolveCliSessionsEmptyState", () => {
  const base = {
    loading: false,
    searching: false,
    cliFound: true,
    query: "",
    resultCount: 0,
    totalCount: 0,
    linkFilter: "all" as const,
    error: null as string | null,
  };

  it("returns null when there are visible results", () => {
    expect(
      resolveCliSessionsEmptyState({ ...base, resultCount: 2, totalCount: 5 }),
    ).toBeNull();
  });

  it("loading empty → loading soft-fail", () => {
    const e = resolveCliSessionsEmptyState({
      ...base,
      loading: true,
      resultCount: 0,
      totalCount: 0,
    });
    expect(e?.kind).toBe("loading");
    expect(e?.titleKey).toBe("settings.cliSessionsLoading");
    expect(e?.softFail).toBe(true);
    expect(e?.showClearFilters).toBe(false);
  });

  it("searching with active query → searching", () => {
    const e = resolveCliSessionsEmptyState({
      ...base,
      searching: true,
      query: "login",
      resultCount: 0,
      totalCount: 3,
    });
    expect(e?.kind).toBe("searching");
    expect(e?.titleKey).toBe("settings.cliSessionsSearching");
  });

  it("cli missing + empty list → soft-fail cli_missing", () => {
    const e = resolveCliSessionsEmptyState({
      ...base,
      cliFound: false,
      resultCount: 0,
      totalCount: 0,
    });
    expect(e?.kind).toBe("cli_missing");
    expect(e?.softFail).toBe(true);
    expect(e?.errorKind).toBe("cli_missing");
    expect(e?.titleKey).toBe("settings.cliSessionsEmptyCliMissing");
    expect(e?.hintKey).toBe("settings.cliSessionsEmptyCliMissingHint");
  });

  it("empty catalog when CLI present", () => {
    const e = resolveCliSessionsEmptyState({
      ...base,
      cliFound: true,
      resultCount: 0,
      totalCount: 0,
    });
    expect(e?.kind).toBe("empty");
    expect(e?.softFail).toBe(false);
    expect(e?.titleKey).toBe("settings.cliSessionsEmpty");
  });

  it("error with empty list → error (soft when capability gap)", () => {
    const soft = resolveCliSessionsEmptyState({
      ...base,
      error: "Grok Build CLI not found",
      totalCount: 0,
      resultCount: 0,
    });
    expect(soft?.kind).toBe("error");
    expect(soft?.softFail).toBe(true);
    expect(soft?.errorKind).toBe("cli_missing");

    const hard = resolveCliSessionsEmptyState({
      ...base,
      error: "disk corrupted boom",
      totalCount: 0,
      resultCount: 0,
    });
    expect(hard?.kind).toBe("error");
    expect(hard?.softFail).toBe(false);
    expect(hard?.errorKind).toBe("other");
  });

  it("link filter empty → filter_empty + clear CTA", () => {
    const e = resolveCliSessionsEmptyState({
      ...base,
      totalCount: 3,
      resultCount: 0,
      linkFilter: "linked",
      query: "",
    });
    expect(e?.kind).toBe("filter_empty");
    expect(e?.showClearFilters).toBe(true);
    expect(e?.titleKey).toBe("settings.cliSessionsFilterEmpty");
  });

  it("query empty matches → search_empty + clear CTA", () => {
    const e = resolveCliSessionsEmptyState({
      ...base,
      totalCount: 3,
      resultCount: 0,
      query: "zzzz",
      linkFilter: "all",
    });
    expect(e?.kind).toBe("search_empty");
    expect(e?.showClearFilters).toBe(true);
    expect(e?.titleKey).toBe("settings.cliSessionsSearchEmpty");
  });

  it("does not invent sessions when CLI missing but list has rows", () => {
    // If local disk listed sessions, show them (null empty) even without CLI.
    expect(
      resolveCliSessionsEmptyState({
        ...base,
        cliFound: false,
        resultCount: 2,
        totalCount: 2,
      }),
    ).toBeNull();
  });
});

describe("classifyCliSessionsSearchError", () => {
  it("soft-fails CLI missing / unsupported / timeout / host-only", () => {
    expect(classifyCliSessionsSearchError("Grok Build CLI not found").kind).toBe(
      "cli_missing",
    );
    expect(
      classifyCliSessionsSearchError("Grok Build CLI not found").softFail,
    ).toBe(true);
    expect(
      classifyCliSessionsSearchError("error: unexpected argument '--json' found")
        .kind,
    ).toBe("cli_unsupported");
    expect(classifyCliSessionsSearchError("operation timed out").kind).toBe(
      "timeout",
    );
    expect(classifyCliSessionsSearchError("need_tauri host").kind).toBe(
      "host_only",
    );
    expect(isCliSessionsSearchSoftFailError("cli not found")).toBe(true);
  });

  it("classifies permission and other", () => {
    expect(classifyCliSessionsSearchError("Permission denied").kind).toBe(
      "permission",
    );
    expect(classifyCliSessionsSearchError("Permission denied").softFail).toBe(
      false,
    );
    const other = classifyCliSessionsSearchError("weird host boom");
    expect(other.kind).toBe("other");
    expect(other.softFail).toBe(false);
    expect(other.titleKey).toBe("settings.cliSessions.err.other");
    expect(other.hintKey).toBe("settings.cliSessions.err.otherHint");
  });

  it("reads object code / message", () => {
    expect(
      classifyCliSessionsSearchError({
        code: "cli_missing",
        message: "missing",
      }).kind,
    ).toBe("cli_missing");
  });
});

describe("planImportSelection honesty", () => {
  it("counts importable / linked / remote-only / deletable", () => {
    const plan = planImportSelection(rows);
    expect(plan.selected).toBe(3);
    expect(plan.importable).toBe(2);
    expect(plan.alreadyLinked).toBe(1);
    expect(plan.skipped).toBe(1);
    expect(plan.remoteOnly).toBe(1); // ghi has empty dir
    expect(plan.deletable).toBe(1); // only abc is unlinked + has dir
    expect(plan.hasImportable).toBe(true);
    expect(plan.hasDeletable).toBe(true);
  });

  it("empty / null → zeros (never invents)", () => {
    expect(planImportSelection([])).toEqual({
      selected: 0,
      importable: 0,
      alreadyLinked: 0,
      remoteOnly: 0,
      deletable: 0,
      skipped: 0,
      hasImportable: false,
      hasDeletable: false,
    });
    expect(planImportSelection(null).selected).toBe(0);
    expect(planImportSelection(undefined).hasImportable).toBe(false);
  });

  it("all linked → nothing importable", () => {
    const plan = planImportSelection([
      { agentSessionId: "a", alreadyLinked: true, dir: "/x" },
      { agentSessionId: "b", alreadyLinked: true, dir: "/y" },
    ]);
    expect(plan.importable).toBe(0);
    expect(plan.alreadyLinked).toBe(2);
    expect(plan.hasImportable).toBe(false);
    expect(plan.deletable).toBe(0);
  });
});
