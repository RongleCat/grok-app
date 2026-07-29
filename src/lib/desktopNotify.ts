/**
 * Lightweight desktop notification helper.
 * Uses the Web Notification API when available (Tauri WebView on macOS/Windows).
 * Always safe to call — fails closed to `false` without throwing.
 */

import { isQuietHoursActive } from "./notifyQuietHours";

export type DesktopNotifyOptions = {
  title: string;
  body?: string;
  /** When false, skip if document has focus (default true = always try). */
  force?: boolean;
  tag?: string;
};

export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";

/** `ask_user` shares the permission toggle (agent is blocked either way). */
export type DesktopNotifyKind = "turn_done" | "permission" | "ask_user";

export type DesktopNotifyPrefs = {
  notifyOnTurnDone?: boolean;
  notifyOnPermission?: boolean;
};

/**
 * Whether user prefs allow a desktop notification of this kind.
 * Missing / undefined prefs default to **on** (product default).
 * `permission` and `ask_user` both use `notifyOnPermission`.
 */
export function shouldShowDesktopNotify(
  kind: DesktopNotifyKind,
  prefs: DesktopNotifyPrefs | null | undefined,
): boolean {
  if (kind === "turn_done") return prefs?.notifyOnTurnDone !== false;
  return prefs?.notifyOnPermission !== false;
}

function notificationCtor(): typeof Notification | null {
  if (typeof globalThis === "undefined") return null;
  const N = (globalThis as { Notification?: typeof Notification }).Notification;
  if (typeof N !== "function") return null;
  return N;
}

export function notificationSupport(): NotifyPermission {
  const N = notificationCtor();
  if (!N) return "unsupported";
  const perm = N.permission;
  if (perm === "granted" || perm === "denied" || perm === "default") {
    return perm;
  }
  return "unsupported";
}

/** Request permission once; no-op when already decided or unavailable. */
export async function ensureNotifyPermission(): Promise<NotifyPermission> {
  const status = notificationSupport();
  if (status !== "default") return status;
  const N = notificationCtor();
  if (!N?.requestPermission) return "unsupported";
  try {
    const next = await N.requestPermission();
    if (next === "granted" || next === "denied" || next === "default") {
      return next;
    }
    return "unsupported";
  } catch {
    return "unsupported";
  }
}

/** Bring the app window to the front (Web + Tauri). Fail-closed. */
export function focusAppFromNotification(): void {
  try {
    if (typeof window !== "undefined") {
      window.focus();
    }
  } catch {
    /* ignore */
  }
  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      try {
        await w.unminimize();
      } catch {
        /* ignore */
      }
      try {
        await w.show();
      } catch {
        /* ignore */
      }
      try {
        await w.setFocus();
      } catch {
        /* ignore */
      }
    } catch {
      /* not in Tauri / API missing */
    }
  })();
}

/**
 * Show a system notification when permission is granted.
 * Returns true only when a Notification object was constructed.
 * Click focuses the app window when possible.
 * Suppressed entirely during quiet hours (localStorage pref).
 */
export function showDesktopNotification(opts: DesktopNotifyOptions): boolean {
  if (isQuietHoursActive()) return false;
  if (notificationSupport() !== "granted") return false;
  if (!opts.force && typeof document !== "undefined" && document.hasFocus()) {
    // App is in front — prefer in-app toast; caller can pass force=true.
    return false;
  }
  const N = notificationCtor();
  if (!N) return false;
  try {
    const n = new N(opts.title, {
      body: opts.body,
      tag: opts.tag,
      silent: false,
    });
    try {
      if (n && typeof n === "object") {
        n.onclick = () => {
          try {
            // Some browsers leave the notification open until closed.
            n.close?.();
          } catch {
            /* ignore */
          }
          focusAppFromNotification();
        };
      }
    } catch {
      /* ignore onclick assignment failures */
    }
    return true;
  } catch {
    return false;
  }
}

/** Convenience: request permission (if needed) then show. */
export async function notifyDesktop(
  opts: DesktopNotifyOptions,
): Promise<boolean> {
  await ensureNotifyPermission();
  return showDesktopNotification(opts);
}
