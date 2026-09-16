import { describe, expect, it } from "vitest";
import {
  collapsedIdsFromExpandMap,
  expandMapFromCollapsedIds,
  sameCollapsedIdSet,
} from "./sidebarExpand";

describe("sidebarExpand", () => {
  it("defaults unknown projects to expanded", () => {
    expect(expandMapFromCollapsedIds(["a", "b"], ["b"])).toEqual({
      a: true,
      b: false,
    });
    expect(expandMapFromCollapsedIds(["a"], null)).toEqual({ a: true });
    expect(expandMapFromCollapsedIds(["a"], undefined)).toEqual({ a: true });
  });

  it("round-trips collapsed ids from the expand map", () => {
    const map = { a: true, b: false, c: false };
    expect(collapsedIdsFromExpandMap(map)).toEqual(["b", "c"]);
    expect(
      expandMapFromCollapsedIds(
        ["a", "b", "c"],
        collapsedIdsFromExpandMap(map),
      ),
    ).toEqual(map);
  });

  it("compares collapsed id sets order-insensitively", () => {
    expect(sameCollapsedIdSet(["b", "a"], ["a", "b"])).toBe(true);
    expect(sameCollapsedIdSet(["a"], ["a", "b"])).toBe(false);
  });

  it("auto-collapses a crowded tree when nothing was persisted collapsed", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const map = expandMapFromCollapsedIds(ids, []);
    expect(Object.values(map).every((open) => open === false)).toBe(true);
  });

  it("keeps explicit expand/collapse when the user already collapsed a folder", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const map = expandMapFromCollapsedIds(ids, ["p3"]);
    expect(map.p3).toBe(false);
    expect(map.p0).toBe(true);
    expect(map.p11).toBe(true);
  });

  it("does not auto-collapse a small project list", () => {
    expect(expandMapFromCollapsedIds(["a", "b"], [])).toEqual({
      a: true,
      b: true,
    });
  });
});
