/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { SESSION_MRU_STORAGE_KEY } from "@/lib/sessionMru";
import {
  getSessionMruPanelState,
  setSessionMruPanelState,
} from "@/lib/sessionMruPanelStore";
import { useSessionMruNav } from "./useSessionMruNav";

afterEach(() => {
  cleanup();
  localStorage.clear();
  setSessionMruPanelState(null);
});

beforeEach(() => {
  localStorage.clear();
  setSessionMruPanelState(null);
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

const getRow = (id: string) => ({ title: id, projectName: "" });

describe("useSessionMruNav", () => {
  it("shows the panel on Ctrl+Tab and opens the previous chat on release", () => {
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
        getRow,
        openById: (id) => {
          opened.push(id);
          current = id;
        },
      }),
    );
    window.dispatchEvent(tab());
    expect(opened).toEqual([]);
    expect(getSessionMruPanelState()?.index).toBe(1);
    expect(getSessionMruPanelState()?.rows.map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    expect(opened).toEqual(["a"]);
    expect(getSessionMruPanelState()).toBeNull();
    window.dispatchEvent(tab());
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    expect(opened).toEqual(["a", "b"]);
  });

  it("walks three chats in the panel while Ctrl is held, then opens the landing chat", () => {
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
        getRow,
        openById: (id) => {
          opened.push(id);
          current = id;
        },
      }),
    );
    window.dispatchEvent(tab());
    window.dispatchEvent(tab());
    expect(opened).toEqual([]);
    expect(getSessionMruPanelState()?.rows[getSessionMruPanelState()!.index]?.id).toBe(
      "a",
    );
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    expect(opened).toEqual(["a"]);
    result.current.noteOpened("a");
    expect(JSON.parse(localStorage.getItem(SESSION_MRU_STORAGE_KEY) ?? "[]")).toEqual(
      ["a", "c", "b"],
    );
  });

  it("cancels the panel on Escape without opening", () => {
    localStorage.setItem(
      SESSION_MRU_STORAGE_KEY,
      JSON.stringify(["b", "a"]),
    );
    const openById = vi.fn();
    renderHook(() =>
      useSessionMruNav({
        getCurrentId: () => "b",
        getLiveIds: () => ["a", "b"],
        getRow,
        openById,
      }),
    );
    window.dispatchEvent(tab());
    expect(getSessionMruPanelState()).not.toBeNull();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(getSessionMruPanelState()).toBeNull();
    expect(openById).not.toHaveBeenCalled();
  });

  it("ignores Cmd+Tab", () => {
    const openById = vi.fn();
    renderHook(() =>
      useSessionMruNav({
        getCurrentId: () => "b",
        getLiveIds: () => ["a", "b"],
        getRow,
        openById,
      }),
    );
    window.dispatchEvent(tab({ metaKey: true, ctrlKey: false }));
    expect(openById).not.toHaveBeenCalled();
    expect(getSessionMruPanelState()).toBeNull();
  });
});
