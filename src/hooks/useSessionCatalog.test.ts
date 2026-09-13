/**
 * @vitest-environment jsdom
 *
 * Catalog list + multi-select live here. Open/new-chat live in useSessionNavigation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import * as api from "@/lib/api";
import {
  sessionSidebarSelectOrder,
  useSessionCatalog,
} from "./useSessionCatalog";
import type { SessionRow } from "@/lib/app/sidebarModels";

function row(
  partial: Partial<SessionRow> & { id: string },
): SessionRow {
  return {
    id: partial.id,
    title: partial.title ?? partial.id,
    projectId: partial.projectId ?? null,
    updatedAt: partial.updatedAt ?? "2026-01-02T00:00:00Z",
    archived: partial.archived,
    pinned: partial.pinned,
  };
}

function setup(projects: { id: string }[] = [{ id: "p1" }]) {
  return renderHook(() =>
    useSessionCatalog({
      projects,
      isDialogOpen: () => false,
    }),
  );
}

describe("sessionSidebarSelectOrder", () => {
  it("lists project sessions then orphans, pinned first", () => {
    const sessions = [
      row({ id: "old", projectId: "p1", updatedAt: "2026-01-01T00:00:00Z" }),
      row({
        id: "pin",
        projectId: "p1",
        pinned: true,
        updatedAt: "2026-01-01T00:00:00Z",
      }),
      row({ id: "orphan", projectId: null }),
    ];
    expect(sessionSidebarSelectOrder(sessions, [{ id: "p1" }])).toEqual([
      "pin",
      "old",
      "orphan",
    ]);
  });
});

describe("useSessionCatalog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("enter seeds selection; exit clears it", () => {
    const { result } = setup();
    act(() => {
      result.current.enterSessionSelectMode("a");
    });
    expect(result.current.sessionSelectMode).toBe(true);
    expect([...result.current.selectedSessionIds]).toEqual(["a"]);
    act(() => {
      result.current.exitSessionSelectMode();
    });
    expect(result.current.sessionSelectMode).toBe(false);
    expect(result.current.selectedSessionIds.size).toBe(0);
  });

  it("Cmd-style toggle enters select mode and keeps prior ids", () => {
    const { result } = setup();
    act(() => {
      result.current.toggleSessionSelected("a");
    });
    expect(result.current.sessionSelectMode).toBe(true);
    expect([...result.current.selectedSessionIds]).toEqual(["a"]);
    act(() => {
      result.current.toggleSessionSelected("b");
    });
    expect([...result.current.selectedSessionIds].sort()).toEqual(["a", "b"]);
  });

  it("Shift-click selects a contiguous range in sidebar order", () => {
    const { result } = setup();
    act(() => {
      result.current.setSessions([
        row({ id: "a", projectId: "p1", updatedAt: "2026-01-03T00:00:00Z" }),
        row({ id: "b", projectId: "p1", updatedAt: "2026-01-02T00:00:00Z" }),
        row({ id: "c", projectId: "p1", updatedAt: "2026-01-01T00:00:00Z" }),
      ]);
    });
    act(() => {
      result.current.enterSessionSelectMode("a");
    });
    act(() => {
      result.current.toggleSessionSelected("c", { shiftKey: true });
    });
    expect([...result.current.selectedSessionIds].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("refreshSessions replaces the catalog from the host list", async () => {
    vi.spyOn(api, "sessionsList").mockResolvedValue([
      {
        id: "n1",
        title: "New",
        projectId: null,
        updatedAt: "2026-01-01T00:00:00Z",
        modelId: null,
      },
    ]);
    vi.spyOn(api, "trayRefresh").mockResolvedValue(undefined as never);
    const { result } = setup();
    await act(async () => {
      await result.current.refreshSessions();
    });
    expect(result.current.sessions.map((s) => s.id)).toEqual(["n1"]);
    expect(api.trayRefresh).toHaveBeenCalled();
  });

  it("reloads the catalog when sessions://changed fires", async () => {
    vi.useFakeTimers();
    vi.spyOn(api, "hasHost").mockReturnValue(true);
    let onChanged: ((payload: { reason?: string; sessionId?: string }) => void) | undefined;
    vi.spyOn(api, "listen").mockImplementation(async (event, handler) => {
      if (event === "sessions://changed") {
        onChanged = handler as typeof onChanged;
      }
      return () => {};
    });
    vi.spyOn(api, "sessionsList").mockResolvedValue([
      {
        id: "fresh",
        title: "Fresh",
        projectId: null,
        updatedAt: "2026-01-03T00:00:00Z",
        modelId: null,
      },
    ]);
    vi.spyOn(api, "trayRefresh").mockResolvedValue(undefined as never);
    const { result } = setup();
    await act(async () => {
      await Promise.resolve();
    });
    expect(onChanged).toBeTypeOf("function");
    await act(async () => {
      onChanged?.({ reason: "turn", sessionId: "fresh" });
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });
    expect(result.current.sessions.map((s) => s.id)).toEqual(["fresh"]);
  });

  it("drops selection for archived sessions", () => {
    const { result } = setup();
    act(() => {
      result.current.setSessions([
        row({ id: "keep" }),
        row({ id: "gone" }),
      ]);
    });
    act(() => {
      result.current.enterSessionSelectMode("gone");
    });
    act(() => {
      result.current.setSessions([
        row({ id: "keep" }),
        row({ id: "gone", archived: true }),
      ]);
    });
    expect([...result.current.selectedSessionIds]).toEqual([]);
    expect(result.current.selectableSessionCount).toBe(1);
  });
});
