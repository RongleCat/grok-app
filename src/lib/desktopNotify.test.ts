import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureNotifyPermission,
  focusAppFromNotification,
  notificationSupport,
  shouldShowDesktopNotify,
  showDesktopNotification,
} from "./desktopNotify";

const originalNotification = globalThis.Notification;

afterEach(() => {
  if (originalNotification) {
    globalThis.Notification = originalNotification;
  } else {
    // @ts-expect-error cleanup mock
    delete globalThis.Notification;
  }
  vi.restoreAllMocks();
});

function mockNotification(permission: NotificationPermission) {
  const instances: Array<{
    onclick: ((this: Notification, ev: Event) => unknown) | null;
    close: ReturnType<typeof vi.fn>;
  }> = [];
  const ctor = vi.fn(function NotificationMock(
    this: {
      onclick: ((this: Notification, ev: Event) => unknown) | null;
      close: ReturnType<typeof vi.fn>;
    },
  ) {
    this.onclick = null;
    this.close = vi.fn();
    instances.push(this);
    return this;
  });
  Object.defineProperty(ctor, "permission", {
    value: permission,
    configurable: true,
  });
  Object.defineProperty(ctor, "requestPermission", {
    value: vi.fn(),
    configurable: true,
  });
  globalThis.Notification = ctor as unknown as typeof Notification;
  return { ctor, instances };
}

describe("desktopNotify", () => {
  it("reports unsupported when Notification is missing", () => {
    // @ts-expect-error test
    delete globalThis.Notification;
    expect(notificationSupport()).toBe("unsupported");
    expect(showDesktopNotification({ title: "x" })).toBe(false);
  });

  it("returns current permission when present", () => {
    mockNotification("granted");
    expect(notificationSupport()).toBe("granted");
  });

  it("requests permission only when default", async () => {
    const { ctor } = mockNotification("default");
    const requestPermission = vi.fn().mockResolvedValue("granted");
    Object.defineProperty(ctor, "requestPermission", {
      value: requestPermission,
      configurable: true,
    });
    await ensureNotifyPermission();
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("constructs Notification when granted and forced", () => {
    const { ctor } = mockNotification("granted");
    const ok = showDesktopNotification({
      title: "Agent finished",
      body: "Session ready",
      force: true,
      tag: "turn-done",
    });
    expect(ok).toBe(true);
    expect(ctor).toHaveBeenCalledWith("Agent finished", {
      body: "Session ready",
      tag: "turn-done",
      silent: false,
    });
  });

  it("wires onclick to focus the app window", () => {
    const { instances } = mockNotification("granted");
    const focus = vi.fn();
    const prevWindow = globalThis.window;
    // Node/vitest may lack a real window; provide a minimal stub for focus().
    Object.defineProperty(globalThis, "window", {
      value: { focus },
      configurable: true,
      writable: true,
    });
    try {
      expect(
        showDesktopNotification({ title: "x", force: true, tag: "t" }),
      ).toBe(true);
      expect(instances).toHaveLength(1);
      expect(typeof instances[0]!.onclick).toBe("function");
      instances[0]!.onclick?.call({} as Notification, {} as Event);
      expect(focus).toHaveBeenCalled();
      expect(instances[0]!.close).toHaveBeenCalled();
    } finally {
      if (prevWindow === undefined) {
        // @ts-expect-error cleanup stub
        delete globalThis.window;
      } else {
        Object.defineProperty(globalThis, "window", {
          value: prevWindow,
          configurable: true,
          writable: true,
        });
      }
    }
  });

  it("does not notify when denied", () => {
    const { ctor } = mockNotification("denied");
    expect(showDesktopNotification({ title: "x", force: true })).toBe(false);
    expect(ctor).not.toHaveBeenCalled();
  });

  it("focusAppFromNotification does not throw without Tauri", () => {
    expect(() => focusAppFromNotification()).not.toThrow();
  });
});

describe("shouldShowDesktopNotify", () => {
  it("defaults all kinds to on when prefs missing", () => {
    expect(shouldShowDesktopNotify("turn_done", undefined)).toBe(true);
    expect(shouldShowDesktopNotify("permission", null)).toBe(true);
    expect(shouldShowDesktopNotify("ask_user", null)).toBe(true);
    expect(shouldShowDesktopNotify("turn_done", {})).toBe(true);
    expect(shouldShowDesktopNotify("permission", {})).toBe(true);
    expect(shouldShowDesktopNotify("ask_user", {})).toBe(true);
  });

  it("respects explicit false prefs", () => {
    expect(
      shouldShowDesktopNotify("turn_done", { notifyOnTurnDone: false }),
    ).toBe(false);
    expect(
      shouldShowDesktopNotify("permission", { notifyOnPermission: false }),
    ).toBe(false);
    expect(
      shouldShowDesktopNotify("ask_user", { notifyOnPermission: false }),
    ).toBe(false);
    expect(
      shouldShowDesktopNotify("turn_done", {
        notifyOnTurnDone: false,
        notifyOnPermission: true,
      }),
    ).toBe(false);
    expect(
      shouldShowDesktopNotify("permission", {
        notifyOnTurnDone: false,
        notifyOnPermission: true,
      }),
    ).toBe(true);
    expect(
      shouldShowDesktopNotify("ask_user", {
        notifyOnTurnDone: false,
        notifyOnPermission: true,
      }),
    ).toBe(true);
  });

  it("treats true as on", () => {
    expect(
      shouldShowDesktopNotify("turn_done", { notifyOnTurnDone: true }),
    ).toBe(true);
    expect(
      shouldShowDesktopNotify("permission", { notifyOnPermission: true }),
    ).toBe(true);
    expect(
      shouldShowDesktopNotify("ask_user", { notifyOnPermission: true }),
    ).toBe(true);
  });

  it("ask_user shares notifyOnPermission with permission", () => {
    expect(
      shouldShowDesktopNotify("ask_user", { notifyOnPermission: false }),
    ).toBe(
      shouldShowDesktopNotify("permission", { notifyOnPermission: false }),
    );
    expect(
      shouldShowDesktopNotify("ask_user", { notifyOnPermission: true }),
    ).toBe(
      shouldShowDesktopNotify("permission", { notifyOnPermission: true }),
    );
  });
});
