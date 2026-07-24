import { describe, expect, it } from "vitest";
import {
  filterSessionSearch,
  matchMessageContent,
  mergeSessionSearchHits,
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
});
