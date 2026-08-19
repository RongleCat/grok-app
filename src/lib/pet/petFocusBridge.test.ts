import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyLiveSnapshot } from "@/lib/sessionLiveStore";
import { sessionLiveMapStore } from "@/lib/sessionLiveMapStore";
import {
  rememberFinishedTurn,
  resetFinishedTurnsForTests,
} from "@/lib/sessionFinishedTurns";
import {
  SESSION_UNREAD_STORAGE_KEY,
  clearUnread,
  markUnread,
} from "@/lib/sessionUnread";
import { startPetFocusBridge } from "./petFocusBridge";
import type { PetFocus } from "./petFocus";
import type { PetTask } from "./petTasks";
import { petStageSnippetStore } from "./petStageSnippets";

function installUnreadHost() {
  const store: Record<string, string> = {};
  const listeners = new Map<string, Set<(ev: Event) => void>>();
  const windowMock = {
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn as (ev: Event) => void);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn as (ev: Event) => void);
    },
    dispatchEvent(ev: Event) {
      listeners.get(ev.type)?.forEach((fn) => fn(ev));
      return true;
    },
  };
  const localStorageMock = {
    getItem(key: string) {
      return key in store ? store[key]! : null;
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
    removeItem(key: string) {
      delete store[key];
    },
  };
  const prevWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "window", {
    value: windowMock,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
  return () => {
    if (prevWindow) Object.defineProperty(globalThis, "window", prevWindow);
    else delete (globalThis as { window?: unknown }).window;
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  };
}

describe("startPetFocusBridge unread-clear", () => {
  let restoreHost: () => void;

  beforeEach(() => {
    restoreHost = installUnreadHost();
    sessionLiveMapStore.resetForTests();
    resetFinishedTurnsForTests();
    petStageSnippetStore.resetForTests();
    localStorage.removeItem(SESSION_UNREAD_STORAGE_KEY);
  });

  afterEach(() => {
    sessionLiveMapStore.resetForTests();
    resetFinishedTurnsForTests();
    petStageSnippetStore.resetForTests();
    restoreHost();
  });

  it("re-picks idle when unread is cleared without a liveMap change", () => {
    const sessionId = "done-sess";
    sessionLiveMapStore.setLiveMap({
      [sessionId]: {
        ...emptyLiveSnapshot(sessionId, 2_000),
        state: "idle",
      },
    });
    rememberFinishedTurn(sessionId, 8_000);
    markUnread(sessionId);

    const pushed: PetFocus[] = [];
    const bridge = startPetFocusBridge({
      isEnabled: () => true,
      getSessions: () => [{ id: sessionId, title: "Ship pet" }],
      push: (focus) => {
        pushed.push(focus);
      },
    });

    expect(pushed.at(-1)?.kind).toBe("ready");
    expect(pushed.at(-1)?.sessionId).toBe(sessionId);

    const beforeClear = pushed.length;
    // Viewing the session: unread event only — liveMap stays idle (no subscribeMap).
    clearUnread(sessionId);
    expect(pushed.length).toBeGreaterThan(beforeClear);
    expect(pushed.at(-1)?.kind).toBe("idle");
    expect(pushed.at(-1)?.sessionId).toBeNull();

    bridge.stop();
  });

  it("pushes a bubble for each live session even when focus is sticky", () => {
    const snippets: Record<string, string> = { a: "Running npm test" };
    sessionLiveMapStore.setLiveMap({
      a: {
        ...emptyLiveSnapshot("a", 2_000),
        state: "streaming",
        liveToolTitle: "npm test",
      },
    });
    const tasks: PetTask[][] = [];
    const bridge = startPetFocusBridge({
      isEnabled: () => true,
      getSessions: () => [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
      getSnippets: () => snippets,
      push: () => {},
      pushTasks: (next) => {
        tasks.push(next);
      },
    });
    expect(tasks.at(-1)?.map((t) => t.sessionId)).toEqual(["a"]);
    expect(tasks.at(-1)?.[0]?.snippet).toBe("Running npm test");

    snippets.b = "Running cargo check";
    sessionLiveMapStore.setLiveMap({
      a: {
        ...emptyLiveSnapshot("a", 3_000),
        state: "streaming",
        liveToolTitle: "npm test",
      },
      b: {
        ...emptyLiveSnapshot("b", 4_000),
        state: "streaming",
        liveToolTitle: "cargo check",
      },
    });
    expect(tasks.at(-1)?.map((t) => t.sessionId).sort()).toEqual(["a", "b"]);
    expect(tasks.at(-1)?.map((t) => t.snippet).sort()).toEqual([
      "Running cargo check",
      "Running npm test",
    ]);
    bridge.stop();
  });
});
