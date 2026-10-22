import { describe, expect, it } from "vitest";
import {
  clearSessionSearchFilters,
  defaultSessionSearchFilterState,
  filterSessionSearch,
  hasActiveSessionSearchFilters,
  matchMessageContent,
  mergeSessionSearchHits,
  parseSessionSearchMode,
  parseSessionSearchRankMode,
  resolveSessionSearchEmptyState,
  scoreSessionSearchHit,
  sessionSearchBadge,
  sessionSearchBadgeLabelKey,
  sessionSearchModeLabelKey,
  sessionSearchRankModeLabelKey,
  shouldScanSessionContent,
  tokenizeSearchText,
  tokenOverlapScore,
} from "./sessionSearch";

const projects = [
  { id: "p1", name: "grok-app", path: "/Users/me/Code/oss/grok-app" },
  { id: "p2", name: "notes", path: "/Users/me/notes" },
];

const sessions = [
  { id: "s1", title: "Fix doctor reset", projectId: "p1" },
  { id: "s2", title: "Weekly plan", projectId: "p2" },
  { id: "s3", title: "Untitled", projectId: null },
  { id: "s4", title: "Old archived", projectId: "p1", archived: true },
];

describe("filterSessionSearch", () => {
  it("returns recent items when query is empty", () => {
    const hits = filterSessionSearch("", sessions, projects);
    expect(hits.matchedSessions.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(hits.matchedProjects.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("matches session title case-insensitively", () => {
    const hits = filterSessionSearch("doctor", sessions, projects);
    expect(hits.matchedSessions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("matches project name and pulls related sessions", () => {
    const hits = filterSessionSearch("grok-app", sessions, projects);
    expect(hits.matchedProjects.map((p) => p.id)).toEqual(["p1"]);
    expect(hits.matchedSessions.map((s) => s.id)).toContain("s1");
  });

  it("matches project path segments", () => {
    const hits = filterSessionSearch("Code/oss", sessions, projects);
    expect(hits.matchedProjects[0]?.id).toBe("p1");
  });

  it("skips archived sessions by default", () => {
    const hits = filterSessionSearch("archived", sessions, projects);
    expect(hits.matchedSessions).toHaveLength(0);
  });

  it("can include archived when asked", () => {
    const hits = filterSessionSearch("archived", sessions, projects, {
      includeArchived: true,
    });
    expect(hits.matchedSessions.map((s) => s.id)).toEqual(["s4"]);
  });

  it("empty query with includeArchived includes archived recents", () => {
    const hits = filterSessionSearch("", sessions, projects, {
      includeArchived: true,
    });
    expect(hits.matchedSessions.map((s) => s.id)).toContain("s4");
  });

  it("mode=content returns no title/project hits for a query", () => {
    const hits = filterSessionSearch("doctor", sessions, projects, {
      mode: "content",
    });
    expect(hits.matchedSessions).toEqual([]);
    expect(hits.matchedProjects).toEqual([]);
  });

  it("mode=title still matches titles", () => {
    const hits = filterSessionSearch("doctor", sessions, projects, {
      mode: "title",
    });
    expect(hits.matchedSessions.map((s) => s.id)).toEqual(["s1"]);
  });
});

describe("shouldScanSessionContent", () => {
  it("skips empty query and title mode", () => {
    expect(shouldScanSessionContent("", "all")).toBe(false);
    expect(shouldScanSessionContent("  ", "content")).toBe(false);
    expect(shouldScanSessionContent("doctor", "title")).toBe(false);
  });

  it("scans for all/content with a query", () => {
    expect(shouldScanSessionContent("doctor", "all")).toBe(true);
    expect(shouldScanSessionContent("doctor", "content")).toBe(true);
    expect(shouldScanSessionContent("doctor")).toBe(true);
  });
});

describe("sessionSearchBadge", () => {
  it("maps match flags to badge kinds and label keys", () => {
    expect(sessionSearchBadge({ titleMatch: true, contentMatch: false })).toBe(
      "title",
    );
    expect(sessionSearchBadge({ titleMatch: false, contentMatch: true })).toBe(
      "content",
    );
    expect(sessionSearchBadge({ titleMatch: true, contentMatch: true })).toBe(
      "both",
    );
    expect(sessionSearchBadge({ titleMatch: false, contentMatch: false })).toBe(
      null,
    );
    expect(sessionSearchBadgeLabelKey("title")).toBe("search.badgeTitle");
    expect(sessionSearchBadgeLabelKey("content")).toBe("search.badgeContent");
    expect(sessionSearchBadgeLabelKey("both")).toBe("search.badgeBoth");
  });
});

describe("matchMessageContent", () => {
  const messages = [
    { role: "user", content: "Please fix the Doctor reset button" },
    { role: "assistant", content: "Sure, I will patch doctor later." },
    { role: "system", content: "doctor should be ignored" },
    { role: "user", content: "unrelated" },
  ];

  it("returns null for empty query", () => {
    expect(matchMessageContent("", messages)).toBeNull();
    expect(matchMessageContent("  ", messages)).toBeNull();
  });

  it("matches case-insensitively and skips non user/assistant", () => {
    const hit = matchMessageContent("doctor", messages);
    expect(hit).not.toBeNull();
    expect(hit!.matchCount).toBe(2);
    expect(hit!.snippet.toLowerCase()).toContain("doctor");
  });

  it("returns null when nothing matches", () => {
    expect(matchMessageContent("zzzz", messages)).toBeNull();
  });

  it("snippets the original word after a dotted capital I", () => {
    const dots = "İ".repeat(60);
    const hit = matchMessageContent("stan", [
      { role: "user", content: `${dots} stanbul` },
    ]);
    expect(hit).not.toBeNull();
    expect(hit!.snippet).toContain("stan");
  });
});

describe("mergeSessionSearchHits", () => {
  it("keeps title hits first and attaches content snippets", () => {
    const title = [{ id: "s1", title: "Fix doctor reset", projectId: "p1" }];
    const content = [
      {
        id: "s1",
        title: "Fix doctor reset",
        projectId: "p1",
        snippet: "…fix the Doctor…",
        matchCount: 2,
      },
      {
        id: "s9",
        title: "Other chat",
        projectId: null,
        snippet: "body mentions doctor",
        matchCount: 1,
      },
    ];
    const merged = mergeSessionSearchHits("doctor", title, content);
    expect(merged.map((h) => h.id)).toEqual(["s1", "s9"]);
    expect(merged[0].titleMatch).toBe(true);
    expect(merged[0].contentMatch).toBe(true);
    expect(merged[0].snippet).toContain("Doctor");
    expect(merged[1].titleMatch).toBe(false);
    expect(merged[1].matchCount).toBe(1);
    expect(sessionSearchBadge(merged[0])).toBe("both");
    expect(sessionSearchBadge(merged[1])).toBe("content");
  });

  it("empty query does not append content-only rows", () => {
    const title = [{ id: "s1", title: "A", projectId: null }];
    const content = [
      {
        id: "s9",
        title: "B",
        snippet: "x",
        matchCount: 3,
      },
    ];
    const merged = mergeSessionSearchHits("", title, content);
    expect(merged.map((h) => h.id)).toEqual(["s1"]);
  });

  it("mode=title ignores content hits", () => {
    const title = [{ id: "s1", title: "Fix doctor reset", projectId: "p1" }];
    const content = [
      {
        id: "s1",
        title: "Fix doctor reset",
        snippet: "…Doctor…",
        matchCount: 2,
      },
      {
        id: "s9",
        title: "Other",
        snippet: "doctor body",
        matchCount: 5,
      },
    ];
    const merged = mergeSessionSearchHits("doctor", title, content, {
      mode: "title",
    });
    expect(merged.map((h) => h.id)).toEqual(["s1"]);
    expect(merged[0].contentMatch).toBe(false);
    expect(merged[0].snippet).toBeUndefined();
  });

  it("mode=content prefers content ranking and skips title-only", () => {
    const title = [
      { id: "s1", title: "Fix doctor reset", projectId: "p1" },
      { id: "s-title-only", title: "doctor in title only", projectId: null },
    ];
    const content = [
      {
        id: "s9",
        title: "Other chat",
        snippet: "body mentions doctor",
        matchCount: 1,
      },
      {
        id: "s1",
        title: "Fix doctor reset",
        snippet: "…fix the Doctor…",
        matchCount: 4,
      },
    ];
    const merged = mergeSessionSearchHits("doctor", title, content, {
      mode: "content",
    });
    expect(merged.map((h) => h.id)).toEqual(["s1", "s9"]);
    expect(merged[0].matchCount).toBe(4);
    expect(merged[0].contentMatch).toBe(true);
    expect(merged.every((h) => h.contentMatch)).toBe(true);
    expect(merged.find((h) => h.id === "s-title-only")).toBeUndefined();
  });

  it("honors includeArchived on content-only rows", () => {
    const title: { id: string; title: string }[] = [];
    const content = [
      {
        id: "s-arch",
        title: "Archived body hit",
        snippet: "doctor inside",
        matchCount: 2,
        archived: true,
      },
    ];
    expect(
      mergeSessionSearchHits("doctor", title, content).map((h) => h.id),
    ).toEqual([]);
    expect(
      mergeSessionSearchHits("doctor", title, content, {
        includeArchived: true,
      }).map((h) => h.id),
    ).toEqual(["s-arch"]);
  });
});

describe("tokenizeSearchText / tokenOverlapScore", () => {
  it("tokenizes latin and drops short noise", () => {
    expect(tokenizeSearchText("Fix doctor reset!")).toEqual([
      "fix",
      "doctor",
      "reset",
    ]);
    expect(tokenizeSearchText("a to of")).toEqual([]);
  });

  it("keeps CJK characters as tokens", () => {
    expect(tokenizeSearchText("修复医生重置")).toEqual([
      "修",
      "复",
      "医",
      "生",
      "重",
      "置",
    ]);
  });

  it("scores token recall over the query", () => {
    expect(tokenOverlapScore(["doctor", "button"], "Fix doctor reset")).toBe(
      0.5,
    );
    expect(
      tokenOverlapScore(["doctor", "button"], "Doctor reset button"),
    ).toBe(1);
    expect(tokenOverlapScore([], "anything")).toBe(0);
  });
});

describe("parseSessionSearchRankMode", () => {
  it("accepts hybrid aliases and defaults to keyword", () => {
    expect(parseSessionSearchRankMode("hybrid")).toBe("hybrid");
    expect(parseSessionSearchRankMode("semantic")).toBe("hybrid");
    expect(parseSessionSearchRankMode("keyword")).toBe("keyword");
    expect(parseSessionSearchRankMode("nope")).toBe("keyword");
    expect(parseSessionSearchRankMode(null)).toBe("keyword");
  });
});

describe("parseSessionSearchMode / label keys", () => {
  it("parses modes and defaults to all", () => {
    expect(parseSessionSearchMode("title")).toBe("title");
    expect(parseSessionSearchMode("content")).toBe("content");
    expect(parseSessionSearchMode("all")).toBe("all");
    expect(parseSessionSearchMode("nope")).toBe("all");
    expect(parseSessionSearchMode(null)).toBe("all");
  });

  it("maps mode / rank chips to stable i18n keys", () => {
    expect(sessionSearchModeLabelKey("all")).toBe("search.modeAll");
    expect(sessionSearchModeLabelKey("title")).toBe("search.modeTitle");
    expect(sessionSearchModeLabelKey("content")).toBe("search.modeContent");
    expect(sessionSearchRankModeLabelKey("keyword")).toBe("search.rankKeyword");
    expect(sessionSearchRankModeLabelKey("hybrid")).toBe("search.rankHybrid");
  });
});

describe("hasActiveSessionSearchFilters / clear", () => {
  it("defaults are inactive", () => {
    expect(hasActiveSessionSearchFilters(undefined)).toBe(false);
    expect(hasActiveSessionSearchFilters(defaultSessionSearchFilterState())).toBe(
      false,
    );
    expect(hasActiveSessionSearchFilters({ mode: "all", includeArchived: false })).toBe(
      false,
    );
  });

  it("mode or includeArchived marks filters active", () => {
    expect(hasActiveSessionSearchFilters({ mode: "title" })).toBe(true);
    expect(hasActiveSessionSearchFilters({ mode: "content" })).toBe(true);
    expect(
      hasActiveSessionSearchFilters({ mode: "all", includeArchived: true }),
    ).toBe(true);
  });

  it("clearSessionSearchFilters resets to defaults", () => {
    expect(clearSessionSearchFilters()).toEqual({
      mode: "all",
      includeArchived: false,
    });
  });
});

describe("resolveSessionSearchEmptyState", () => {
  const base = {
    query: "doctor",
    sessionHitCount: 0,
    contentLoading: false,
    mode: "all" as const,
    includeArchived: false,
    rankMode: "keyword" as const,
  };

  it("returns null when there are session hits", () => {
    expect(
      resolveSessionSearchEmptyState({ ...base, sessionHitCount: 2 }),
    ).toBeNull();
  });

  it("idle when query empty and no recents", () => {
    const empty = resolveSessionSearchEmptyState({
      ...base,
      query: "",
      sessionHitCount: 0,
    });
    expect(empty?.kind).toBe("idle");
    expect(empty?.titleKey).toBe("search.noRecent");
    expect(empty?.showClearFilters).toBe(false);
  });

  it("loading while content scan is in flight", () => {
    const empty = resolveSessionSearchEmptyState({
      ...base,
      contentLoading: true,
      mode: "all",
    });
    expect(empty?.kind).toBe("loading");
    expect(empty?.titleKey).toBe("search.searchingContent");
    expect(empty?.showClearFilters).toBe(false);
  });

  it("does not loading-empty in title-only mode", () => {
    const empty = resolveSessionSearchEmptyState({
      ...base,
      contentLoading: true,
      mode: "title",
    });
    expect(empty?.kind).toBe("filtered");
    expect(empty?.hintKey).toBe("search.noMatchesHintTitle");
    expect(empty?.showClearFilters).toBe(true);
  });

  it("content mode uses content hint + clear filters", () => {
    const empty = resolveSessionSearchEmptyState({
      ...base,
      mode: "content",
    });
    expect(empty?.kind).toBe("filtered");
    expect(empty?.hintKey).toBe("search.noMatchesHintContent");
    expect(empty?.showClearFilters).toBe(true);
  });

  it("keyword all-mode suggests hybrid", () => {
    const empty = resolveSessionSearchEmptyState(base);
    expect(empty?.kind).toBe("no_matches");
    expect(empty?.hintKey).toBe("search.noMatchesHintKeyword");
    expect(empty?.showClearFilters).toBe(false);
  });

  it("hybrid all-mode suggests archived", () => {
    const empty = resolveSessionSearchEmptyState({
      ...base,
      rankMode: "hybrid",
    });
    expect(empty?.kind).toBe("no_matches");
    expect(empty?.hintKey).toBe("search.noMatchesHintArchived");
  });

  it("includeArchived active still offers clear filters", () => {
    const empty = resolveSessionSearchEmptyState({
      ...base,
      includeArchived: true,
      rankMode: "hybrid",
    });
    expect(empty?.kind).toBe("filtered");
    expect(empty?.showClearFilters).toBe(true);
  });
});

describe("hybrid rank mode", () => {
  const hybridSessions = [
    { id: "s1", title: "Fix doctor reset", projectId: "p1" },
    { id: "s2", title: "Weekly plan", projectId: "p2" },
    { id: "s5", title: "Doctor dashboard UI", projectId: "p1" },
    { id: "s6", title: "Button styles", projectId: "p2" },
  ];

  it("keyword mode requires full substring", () => {
    const hits = filterSessionSearch(
      "doctor button",
      hybridSessions,
      projects,
      { rankMode: "keyword" },
    );
    expect(hits.matchedSessions.map((s) => s.id)).toEqual([]);
  });

  it("hybrid expands to token matches and ranks phrase hits first", () => {
    const hits = filterSessionSearch(
      "doctor button",
      hybridSessions,
      projects,
      { rankMode: "hybrid" },
    );
    const ids = hits.matchedSessions.map((s) => s.id);
    // doctor token → s1, s5; button token → s6
    expect(ids).toContain("s1");
    expect(ids).toContain("s5");
    expect(ids).toContain("s6");
    expect(ids).not.toContain("s2");
  });

  it("scoreSessionSearchHit prefers full phrase + more token overlap", () => {
    const q = "doctor reset";
    const phrase = scoreSessionSearchHit(q, {
      title: "Fix doctor reset",
      titleMatch: true,
    });
    const partial = scoreSessionSearchHit(q, {
      title: "Doctor dashboard UI",
      titleMatch: true,
    });
    const weak = scoreSessionSearchHit(q, {
      title: "Unrelated chat",
      snippet: "mentions doctor once",
      contentMatch: true,
      matchCount: 1,
    });
    expect(phrase).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(0);
    expect(phrase).toBeGreaterThan(weak);
  });

  it("merge hybrid re-ranks content-only above weak title hits", () => {
    const title = [
      { id: "s6", title: "Button styles", projectId: "p2" },
      { id: "s1", title: "Fix doctor reset", projectId: "p1" },
    ];
    const content = [
      {
        id: "s9",
        title: "Other",
        snippet: "Please fix the doctor reset button now",
        matchCount: 3,
      },
    ];
    const keyword = mergeSessionSearchHits("doctor reset", title, content, {
      rankMode: "keyword",
    });
    // Keyword keeps title-first order.
    expect(keyword.map((h) => h.id)).toEqual(["s6", "s1", "s9"]);

    const hybrid = mergeSessionSearchHits("doctor reset", title, content, {
      rankMode: "hybrid",
    });
    // s1 has full phrase in title → top; s9 strong snippet; s6 only "button" unrelated.
    expect(hybrid[0].id).toBe("s1");
    expect(hybrid.map((h) => h.id)).toContain("s9");
    expect(hybrid.every((h) => typeof h.score === "number")).toBe(true);
  });
});
