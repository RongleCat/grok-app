/**
 * @vitest-environment jsdom
 *
 * Palette open/query/filters live in this hook. AppWorkbench only supplies
 * action dispatch and session/project pick.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createT } from "@/i18n";
import { sessionsSearch } from "@/lib/api";
import { useSearchPalette } from "./useSearchPalette";
import type { PaletteActionDef } from "@/lib/paletteActions";

vi.mock("@/lib/api", () => ({
  sessionsSearch: vi.fn(async () => []),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
});

function setup(onRunAction = vi.fn()) {
  return renderHook(() =>
    useSearchPalette({
      sessions: [
        { id: "s1", title: "Hello world", projectId: null },
      ],
      projects: [{ id: "p1", name: "grok-app", path: "/code/grok-app" }],
      tr: createT("en"),
      onRunAction,
      onPickProject: vi.fn(),
      onPickSession: vi.fn(),
    }),
  );
}

describe("useSearchPalette", () => {
  it.each(["close", "clear", "title"] as const)(
    "ignores an in-flight content search after %s stops scanning",
    async (stop) => {
      vi.useFakeTimers();
      let finish!: (hits: Awaited<ReturnType<typeof sessionsSearch>>) => void;
      vi.mocked(sessionsSearch).mockReturnValueOnce(
        new Promise((resolve) => { finish = resolve; }),
      );
      const { result } = setup();
      act(() => {
        result.current.openBlank();
        result.current.setQuery("needle");
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(280); });
      expect(sessionsSearch).toHaveBeenCalledWith("needle", 20);
      expect(result.current.contentLoading).toBe(true);
      act(() => {
        if (stop === "close") result.current.closePalette();
        if (stop === "clear") result.current.setQuery("");
        if (stop === "title") result.current.applyMode("title");
      });
      await act(async () => {
        finish([{
          id: "late-content",
          title: "needle",
          projectId: null,
          snippet: "needle in the journal",
          matchCount: 1,
          updatedAt: "2026-09-06T00:00:00Z",
          archived: false,
        }]);
      });
      expect(result.current.sessionHits.map((hit) => hit.id)).not.toContain("late-content");
      expect(result.current.contentLoading).toBe(false);
    },
  );

  it("openBlank clears the query and opens", () => {
    const { result } = setup();
    act(() => {
      result.current.setQuery("old");
    });
    act(() => {
      result.current.openBlank();
    });
    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("");
  });

  it("closes and clears query before dispatching an action", () => {
    const onRunAction = vi.fn();
    const { result } = setup(onRunAction);
    act(() => {
      result.current.openBlank();
    });
    const action: PaletteActionDef = result.current.actions[0];
    expect(action).toBeTruthy();
    act(() => {
      result.current.runAction(action);
    });
    expect(result.current.open).toBe(false);
    expect(result.current.query).toBe("");
    expect(onRunAction).toHaveBeenCalledWith(action);
  });

  it("filters sessions by query without asking the host", () => {
    const { result } = setup();
    act(() => {
      result.current.openBlank();
      result.current.setQuery("hello");
    });
    expect(result.current.sessionHits.map((h) => h.id)).toEqual(["s1"]);
    act(() => {
      result.current.setQuery("zzzz");
    });
    expect(result.current.sessionHits).toEqual([]);
  });
});
