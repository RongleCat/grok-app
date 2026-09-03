import { describe, expect, it } from "vitest";
import {
  presentToolCall,
  resolveToolPresentation,
  toolBucketForCard,
  toolCardForBucket,
} from "./toolPresentation";

describe("toolPresentation", () => {
  it("maps buckets to typed cards", () => {
    expect(toolCardForBucket("bash")).toBe("terminal");
    expect(toolCardForBucket("edit")).toBe("diff");
    expect(toolCardForBucket("read")).toBe("read");
    expect(toolCardForBucket("search")).toBe("search");
    expect(toolCardForBucket("browse")).toBe("web");
    expect(toolCardForBucket("fallback")).toBe("generic");
    expect(toolBucketForCard("terminal")).toBe("bash");
    expect(toolBucketForCard("generic")).toBe("fallback");
  });

  it("derives search query/count/domains without throwing", () => {
    const meta = presentToolCall({
      toolKind: "web_search",
      title: "Web search: hello",
      detail: "12 results\nhttps://a.com/x\nhttps://b.com/y",
    });
    expect(meta.card).toBe("search");
    expect(meta.query).toBe("hello");
    expect(meta.resultCount).toBe(12);
    expect(meta.resultDomains).toEqual(["a.com", "b.com"]);
  });

  it("falls back to generic for unknown tools (never throws)", () => {
    const meta = presentToolCall({
      toolKind: "enter_plan_mode",
      title: "tool",
    });
    expect(meta.card).toBe("generic");
    expect(meta.toolKind).toBe("enter_plan_mode");
  });

  it("prefers explicit Host meta but fills gaps from derivation", () => {
    const out = resolveToolPresentation(
      { toolKind: "web_search", title: "Web search: q", detail: "5 results" },
      { card: "search" },
    );
    expect(out.card).toBe("search");
    expect(out.query).toBe("q");
    expect(out.resultCount).toBe(5);
  });

  it("rejects malformed explicit meta to derivation", () => {
    const out = resolveToolPresentation(
      { toolKind: "read_file", path: "/a/b.ts" },
      { card: "nope" } as unknown as { card: "search" },
    );
    expect(out.card).toBe("read");
    expect(out.pathBase).toBe("b.ts");
  });

  it("prefers browse path URL over generic Fetch title", () => {
    const meta = presentToolCall({
      toolKind: "web_fetch",
      title: "Fetch",
      path: "https://developer.apple.com/cn/programs/enroll/",
    });
    expect(meta.card).toBe("web");
    expect(meta.query).toBe("https://developer.apple.com/cn/programs/enroll/");
  });
});
