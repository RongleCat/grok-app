import { describe, expect, it } from "vitest";
import {
  detectAtQuery,
  detectAtQueryOnStored,
  rankAtFileHits,
  removeAtTokenFromDraft,
  scoreAtFileHit,
} from "./atFileQuery";

describe("detectAtQuery", () => {
  it("detects bare @", () => {
    expect(detectAtQuery("@")).toEqual({ start: 0, query: "" });
  });

  it("detects @query at end", () => {
    expect(detectAtQuery("see @packa")).toEqual({ start: 4, query: "packa" });
  });

  it("ignores mid-token email-like (no whitespace before @)", () => {
    // letter immediately before @ is not allowed by our trigger rule
    expect(detectAtQuery("user@host")).toBeNull();
  });

  it("allows @ after newline", () => {
    expect(detectAtQuery("line1\n@src")).toEqual({ start: 6, query: "src" });
  });
});

describe("detectAtQueryOnStored", () => {
  it("returns stored-form indices including exclusive end", () => {
    expect(detectAtQueryOnStored("see @packa")).toEqual({
      start: 4,
      query: "packa",
      end: 10,
    });
  });

  it("uses the caret prefix, not a later @ in the rest of the draft", () => {
    expect(detectAtQueryOnStored("hello ")).toBeNull();
  });
});


describe("rankAtFileHits", () => {
  const hits = [
    { path: "/p/a/package.json", name: "package.json", relativePath: "a/package.json", mtimeMs: 1 },
    { path: "/p/package-lock.json", name: "package-lock.json", relativePath: "package-lock.json", mtimeMs: 2 },
    { path: "/p/README.md", name: "README.md", relativePath: "README.md", mtimeMs: 9 },
  ];

  it("ranks package.json first for packa", () => {
    const ranked = rankAtFileHits(hits, "packa");
    expect(ranked[0]!.name).toBe("package.json");
  });

  it("empty query keeps recent first", () => {
    const ranked = rankAtFileHits(hits, "");
    expect(ranked[0]!.name).toBe("README.md");
  });
});

describe("scoreAtFileHit", () => {
  it("exact name beats prefix", () => {
    const exact = scoreAtFileHit(
      { path: "/x", name: "foo", relativePath: "foo" },
      "foo",
    );
    const prefix = scoreAtFileHit(
      { path: "/x", name: "foobar", relativePath: "foobar" },
      "foo",
    );
    expect(exact).toBeGreaterThan(prefix);
  });
});

describe("removeAtTokenFromDraft", () => {
  it("strips @token range", () => {
    expect(removeAtTokenFromDraft("see @packa now", 4, 10)).toBe("see  now");
  });
});
