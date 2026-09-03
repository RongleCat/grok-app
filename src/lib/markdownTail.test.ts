import { describe, expect, it } from "vitest";
import { splitStableMarkdownTail } from "./markdownTail";

describe("markdownTail", () => {
  it("keeps short sources single-render", () => {
    const out = splitStableMarkdownTail("hello");
    expect(out).toEqual({ prefix: "", tail: "hello" });
  });

  it("splits long markdown at a blank line outside fences", () => {
    const prefix = `${"# T\n\n"}${"para one.\n\n".repeat(200)}`;
    const tail = "## Live\n\nstreaming here";
    const source = `${prefix}\n${tail}`;
    const out = splitStableMarkdownTail(source);
    expect(out.prefix.length).toBeGreaterThan(1000);
    expect(out.tail).toContain("streaming here");
    expect(out.prefix + out.tail).toBe(source);
  });

  it("never cuts inside fenced code", () => {
    const head = `${"intro\n\n".repeat(200)}`;
    const fence = "```ts\nline1\nline2\nline3\n";
    // No closing fence yet (streaming) — must fall back to single render.
    const source = `${head}${fence}${"x".repeat(500)}`;
    const out = splitStableMarkdownTail(source);
    expect(out.prefix).toBe("");
    expect(out.tail).toBe(source);
  });
});
