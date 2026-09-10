/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSessionFileChanges } from "./useSessionFileChanges";
import type { SessionFileChange } from "@/lib/sessionChanges";

function change(path: string): SessionFileChange {
  return {
    toolCallId: "tc",
    toolKind: "write",
    status: "completed",
    path,
    name: path,
    before: undefined,
    after: "x",
    updatedAt: "2026-09-10T00:00:00Z",
  };
}

describe("useSessionFileChanges", () => {
  it("returns an empty list for unknown sessions", () => {
    const { result } = renderHook(() => useSessionFileChanges());
    expect(result.current.changesFor("nope")).toEqual([]);
  });

  it("returns an empty list for null / empty session ids", () => {
    const { result } = renderHook(() => useSessionFileChanges());
    expect(result.current.changesFor(null)).toEqual([]);
    expect(result.current.changesFor("")).toEqual([]);
  });

  it("returns recorded changes per session id", () => {
    const { result } = renderHook(() => useSessionFileChanges());
    act(() => {
      result.current.setSessionChangesById((prev) => ({
        ...prev,
        "s1": [change("a.ts")],
        "s2": [change("b.ts"), change("c.ts")],
      }));
    });
    expect(result.current.changesFor("s1")).toHaveLength(1);
    expect(result.current.changesFor("s2")).toHaveLength(2);
    expect(result.current.changesFor("s3")).toEqual([]);
  });

  it("keeps other sessions intact when one is updated", () => {
    const { result } = renderHook(() => useSessionFileChanges());
    act(() => {
      result.current.setSessionChangesById(() => ({ s1: [change("a.ts")] }));
    });
    act(() => {
      result.current.setSessionChangesById((prev) => ({
        ...prev,
        s2: [change("b.ts")],
      }));
    });
    expect(result.current.changesFor("s1")).toHaveLength(1);
    expect(result.current.changesFor("s2")).toHaveLength(1);
  });
});
