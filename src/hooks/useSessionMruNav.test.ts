/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { SESSION_MRU_STORAGE_KEY } from "@/lib/sessionMru";
import { useSessionMruNav } from "./useSessionMruNav";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

function tab(
  over: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: "Tab",
    code: "Tab",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...over,
  });
}

describe("useSessionMruNav", () => {
  it("ping-pongs Ctrl+Tab between the current chat and the previous one", () => {
    localStorage.setItem(
      SESSION_MRU_STORAGE_KEY,
      JSON.stringify(["b", "a"]),
    );
    const opened: string[] = [];
    let current = "b";
    renderHook(() =>
      useSessionMruNav({
        getCurrentId: () => current,
        getLiveIds: () => ["a", "b"],
        openById: (id) => {
          opened.push(id);
          current = id;
        },
      }),
    );
    window.dispatchEvent(tab());
    expect(opened).toEqual(["a"]);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    window.dispatchEvent(tab());
    expect(opened).toEqual(["a", "b"]);
  });

  it("walks three chats while Ctrl is held, then commits the landing chat", () => {
    localStorage.setItem(
      SESSION_MRU_STORAGE_KEY,
      JSON.stringify(["c", "b", "a"]),
    );
    const opened: string[] = [];
    let current = "c";
    const { result } = renderHook(() =>
      useSessionMruNav({
        getCurrentId: () => current,
        getLiveIds: () => ["a", "b", "c"],
        openById: (id) => {
          opened.push(id);
          current = id;
        },
      }),
    );
    window.dispatchEvent(tab());
    window.dispatchEvent(tab());
    expect(opened).toEqual(["b", "a"]);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    result.current.noteOpened("a");
    expect(JSON.parse(localStorage.getItem(SESSION_MRU_STORAGE_KEY) ?? "[]")).toEqual(
      ["a", "c", "b"],
    );
  });

  it("ignores Cmd+Tab", () => {
    const openById = vi.fn();
    renderHook(() =>
      useSessionMruNav({
        getCurrentId: () => "b",
        getLiveIds: () => ["a", "b"],
        openById,
      }),
    );
    window.dispatchEvent(tab({ metaKey: true, ctrlKey: false }));
    expect(openById).not.toHaveBeenCalled();
  });
});
