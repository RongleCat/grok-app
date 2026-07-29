import { describe, expect, it } from "vitest";
import { pruneSelectedIds, toggleIdInSet } from "./sessionSelect";

describe("toggleIdInSet", () => {
  it("adds a missing id", () => {
    const next = toggleIdInSet(new Set(["a"]), "b");
    expect([...next].sort()).toEqual(["a", "b"]);
  });

  it("removes an existing id", () => {
    const next = toggleIdInSet(new Set(["a", "b"]), "a");
    expect([...next]).toEqual(["b"]);
  });

  it("does not mutate the input set", () => {
    const input = new Set(["a"]);
    const next = toggleIdInSet(input, "a");
    expect(input.has("a")).toBe(true);
    expect(next.has("a")).toBe(false);
    expect(next).not.toBe(input);
  });
});

describe("pruneSelectedIds", () => {
  it("keeps the same Set when all ids are live", () => {
    const selected = new Set(["a", "b"]);
    const live = new Set(["a", "b", "c"]);
    expect(pruneSelectedIds(selected, live)).toBe(selected);
  });

  it("drops stale ids", () => {
    const selected = new Set(["a", "gone"]);
    const live = new Set(["a", "b"]);
    const next = pruneSelectedIds(selected, live);
    expect([...next]).toEqual(["a"]);
    expect(next).not.toBe(selected);
  });

  it("returns empty for empty selection", () => {
    const selected = new Set<string>();
    expect(pruneSelectedIds(selected, new Set(["a"]))).toBe(selected);
  });
});
