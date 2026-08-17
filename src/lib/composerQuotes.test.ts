import { describe, expect, it } from "vitest";
import {
  appendQuotesToContent,
  parseQuotesFromContent,
  serializeQuotesForAgent,
  type ComposerQuote,
} from "./composerQuotes";

const q = (
  text: string,
  comment = "",
  id = "q1",
): ComposerQuote => ({ id, text, comment });

describe("append / parse quotes", () => {
  it("round-trips a quote with a comment and keeps the typed body", () => {
    const encoded = appendQuotesToContent("please fix this", [
      q("const x = 1", "why is this unused?"),
    ]);
    const parsed = parseQuotesFromContent(encoded);
    expect(parsed.text).toBe("please fix this");
    expect(parsed.quotes).toHaveLength(1);
    expect(parsed.quotes[0]?.text).toBe("const x = 1");
    expect(parsed.quotes[0]?.comment).toBe("why is this unused?");
  });

  it("round-trips a quote with no comment", () => {
    const encoded = appendQuotesToContent("", [q("hello")]);
    const parsed = parseQuotesFromContent(encoded);
    expect(parsed.text).toBe("");
    expect(parsed.quotes[0]?.text).toBe("hello");
    expect(parsed.quotes[0]?.comment).toBe("");
  });

  it("leaves ordinary messages untouched", () => {
    expect(parseQuotesFromContent("just a prompt")).toEqual({
      text: "just a prompt",
      quotes: [],
    });
  });
});

describe("serializeQuotesForAgent", () => {
  it("keeps the quote as its own block, not merged into the typed line", () => {
    const out = serializeQuotesForAgent(
      [q("selected line", "looks wrong")],
      "please rewrite",
    );
    expect(out).toContain('"""\nselected line\n"""');
    expect(out).toContain("Comment: looks wrong");
    expect(out.endsWith("please rewrite")).toBe(true);
    expect(out.startsWith("please rewrite")).toBe(false);
  });

  it("sends quote-only when the composer body is empty", () => {
    const out = serializeQuotesForAgent([q("only this")], "  ");
    expect(out).toContain("only this");
    expect(out.includes("Comment:")).toBe(false);
  });
});
