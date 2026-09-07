/**
 * @vitest-environment jsdom
 *
 * Mute / unread / plan-pending live here. Host supplies tr, dialog, viewing id.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import { emptySessionPlan } from "@/lib/planSession";
import {
  SESSION_MUTE_STORAGE_KEY,
  toggle as toggleSessionMute,
} from "@/lib/sessionMute";
import {
  SESSION_UNREAD_STORAGE_KEY,
  isWorkbenchForeground,
  markUnread,
} from "@/lib/sessionUnread";
import {
  createSessionChromeBadgesHost,
  useSessionChromeBadges,
} from "./useSessionChromeBadges";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    traySetBusyCount: vi.fn(async () => {}),
    traySetWindowsOverlay: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/sessionUnread", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/sessionUnread")>(
      "@/lib/sessionUnread",
    );
  return {
    ...actual,
    isWorkbenchForeground: vi.fn(() => true),
  };
});

function setup(opts?: {
  viewedSessionId?: string | null;
  viewingSessionId?: string | null;
  isSecondaryWindow?: boolean;
  trayBusyBadge?: boolean;
}) {
  const host = createSessionChromeBadgesHost();
  host.tr = createT("en");
  host.setAppDialog = vi.fn();
  host.viewingSessionId = () => opts?.viewingSessionId ?? opts?.viewedSessionId ?? null;
  const hostRef = { current: host };
  const hook = renderHook(
    (props: { viewedSessionId: string | null }) =>
      useSessionChromeBadges({
        hostRef,
        viewedSessionId: props.viewedSessionId,
        isSecondaryWindow: opts?.isSecondaryWindow ?? false,
        trayBusyBadge: opts?.trayBusyBadge ?? true,
        winTaskbarOverlay: false,
      }),
    {
      initialProps: {
        viewedSessionId: opts?.viewedSessionId ?? null,
      },
    },
  );
  return { ...hook, host };
}

describe("useSessionChromeBadges", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(isWorkbenchForeground).mockReturnValue(true);
    vi.mocked(api.traySetBusyCount).mockClear();
    vi.mocked(api.traySetWindowsOverlay).mockClear();
  });

  it("hydrates mute from storage and follows the change event", () => {
    localStorage.setItem(SESSION_MUTE_STORAGE_KEY, JSON.stringify(["a"]));
    const { result } = setup();
    expect(result.current.mutedSessionIds.has("a")).toBe(true);
    act(() => {
      toggleSessionMute("b");
    });
    expect(result.current.mutedSessionIds.has("b")).toBe(true);
  });

  it("applyClearSessionUnread drops the id immediately", () => {
    localStorage.setItem(SESSION_UNREAD_STORAGE_KEY, JSON.stringify(["s1"]));
    const { result } = setup({ viewedSessionId: null });
    expect(result.current.unreadSessionIds.has("s1")).toBe(true);
    act(() => {
      result.current.applyClearSessionUnread("s1");
    });
    expect(result.current.unreadSessionIds.has("s1")).toBe(false);
  });

  it("keeps a manual unread hold while that chat is still viewed", () => {
    const { result } = setup({
      viewedSessionId: "s1",
      viewingSessionId: "s1",
    });
    act(() => {
      result.current.applyMarkSessionUnread("s1");
    });
    expect(result.current.unreadSessionIds.has("s1")).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current.unreadSessionIds.has("s1")).toBe(true);
  });

  it("clears unread when binding a foreground session", () => {
    localStorage.setItem(SESSION_UNREAD_STORAGE_KEY, JSON.stringify(["s2"]));
    const { result, rerender } = setup({ viewedSessionId: null });
    expect(result.current.unreadSessionIds.has("s2")).toBe(true);
    act(() => {
      rerender({ viewedSessionId: "s2" });
    });
    expect(result.current.unreadSessionIds.has("s2")).toBe(false);
  });

  it("markPlanPendingBadge follows the plan review gate", () => {
    const { result } = setup();
    const pending = { ...emptySessionPlan("t"), rpcId: 7 };
    act(() => {
      result.current.markPlanPendingBadge("s1", pending);
    });
    expect(result.current.planPendingSessionIds.has("s1")).toBe(true);
    act(() => {
      result.current.markPlanPendingBadge("s1", emptySessionPlan("t"));
    });
    expect(result.current.planPendingSessionIds.has("s1")).toBe(false);
  });

  it("asks for confirm when clearing more unread than the threshold", () => {
    localStorage.setItem(
      SESSION_UNREAD_STORAGE_KEY,
      JSON.stringify(["a", "b", "c", "d"]),
    );
    const { result, host } = setup({ viewedSessionId: null });
    act(() => {
      result.current.handleClearAllSessionUnread();
    });
    expect(host.setAppDialog).toHaveBeenCalled();
    expect(result.current.unreadSessionIds.size).toBe(4);
  });

  it("pushes unread count to the tray on the main window", () => {
    markUnread("bg");
    setup({ viewedSessionId: null, trayBusyBadge: true });
    expect(api.traySetBusyCount).toHaveBeenCalled();
    const last = vi.mocked(api.traySetBusyCount).mock.calls.at(-1);
    expect(last?.[0]).toBeGreaterThanOrEqual(1);
  });
});
