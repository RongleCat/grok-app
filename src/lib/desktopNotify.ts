/**
 * Desktop notification helper.
 *
 * Tauri: `tauri-plugin-notification` injects a WebView init script that polyfills
 * `Notification` / `requestPermission` onto native OS APIs (notify-rust on desktop).
 * Without that plugin, WKWebView reports `permission=denied`, never registers the
 * app in System Settings → Notifications, and desktop alerts stay dead.
 *
 * Browser / non-Tauri: plain Web Notification API.
 * Always safe to call — fails closed without throwing.
 */

import { loadNotifySoundPref, playNotifySound } from "./notifySound";
import { isQuietHoursActive } from "./notifyQuietHours";
import { isMuted as isSessionMuted } from "./sessionMute";

export type DesktopNotifyOptions = {
  title: string;
  body?: string;
  /** When false, skip if document has focus (default true = always try). */
  force?: boolean;
  tag?: string;
  /**
   * Session that fired this notification (turn_done / permission / ask_user).
   * On click, after focusing the app, the registered session focus handler is
   * invoked when this is a non-empty string. Missing id still focuses the app.
   *
   * Web `Notification.onclick` covers the browser constructor. The live Tauri
   * path is Host `desktop_notify_show` → native click → `notify://clicked`.
   */
  sessionId?: string | null;
  /**
   * Play the optional notify beep after a successful show.
   * `undefined` → use localStorage `grok.notifySound` pref (default off).
   */
  sound?: boolean;
};

/** Focus a session when the user clicks a desktop notification. */
export type DesktopNotifySessionFocusHandler = (sessionId: string) => void;

let sessionFocusHandler: DesktopNotifySessionFocusHandler | null = null;

/**
 * Register (or clear) the App-level handler used when a notification with
 * `sessionId` is clicked. Module-level so App can wire without circular imports.
 */
export function setDesktopNotifySessionFocusHandler(
  handler: DesktopNotifySessionFocusHandler | null,
): void {
  sessionFocusHandler = handler;
}

/** Host emits this when a native desktop notification is clicked. */
export const NATIVE_NOTIFY_CLICK_EVENT = "notify://clicked";

export type NativeNotifyClickPayload = {
  sessionId?: string | null;
};

/**
 * Focus the app, then open `sessionId` when the Host (or a test) reports a
 * native notification click. Missing / blank id still focuses the window.
 */
export function applyNativeNotifyClick(
  payload?: NativeNotifyClickPayload | null,
): void {
  focusAppFromNotification();
  const focusSessionId =
    typeof payload?.sessionId === "string" && payload.sessionId.trim()
      ? payload.sessionId.trim()
      : null;
  if (!focusSessionId || !sessionFocusHandler) return;
  try {
    sessionFocusHandler(focusSessionId);
  } catch {
    /* fail closed — window already focused */
  }
}

/** Subscribe to Host `notify://clicked`. No-op outside Tauri. */
export async function listenForNativeNotifyClicks(): Promise<() => void> {
  if (!isTauriHost()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<NativeNotifyClickPayload>(
      NATIVE_NOTIFY_CLICK_EVENT,
      (ev) => {
        applyNativeNotifyClick(ev.payload);
      },
    );
  } catch {
    return () => {};
  }
}

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

function isTauriHost(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
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

/**
 * Request permission once; no-op when already decided or unavailable.
 * On Tauri, the notification plugin polyfill maps this to the native path
 * (desktop always reports granted after request). We still re-request when
 * status is `denied` under Tauri so a prior bare-WebView denial cannot stick
 * after the plugin polyfill is installed.
 */
export async function ensureNotifyPermission(): Promise<NotifyPermission> {
  const status = notificationSupport();
  if (status === "granted") return status;
  if (status === "unsupported") return status;
  // Browser: denied is terminal (user must flip OS / site settings).
  if (status === "denied" && !isTauriHost()) return status;
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

/**
 * Re-read OS permission, requesting when still `default`.
 * Prefer this from Settings on open so the honesty chip tracks the plugin
 * polyfill after it settles from the async init probe.
 */
export async function refreshNotifyPermission(): Promise<NotifyPermission> {
  const current = notificationSupport();
  if (current === "default") {
    return ensureNotifyPermission();
  }
  // Tauri polyfill may still be resolving; try native probe once.
  if (isTauriHost() && current !== "granted") {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const granted = await invoke<boolean | null>(
        "plugin:notification|is_permission_granted",
      );
      if (granted === true) return "granted";
      if (granted === false) return "denied";
      // null / prompt → request
      const next = await ensureNotifyPermission();
      return next;
    } catch {
      /* plugin missing — fall through */
    }
  }
  return current;
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
 * Whether this notification should make a sound.
 * Explicit `sound` wins; omitted uses the localStorage pref (default off).
 */
export function resolveNotifySoundEnabled(sound: boolean | undefined): boolean {
  return sound ?? loadNotifySoundPref();
}

function playOptionalSound(opts: DesktopNotifyOptions): void {
  try {
    if (resolveNotifySoundEnabled(opts.sound)) playNotifySound();
  } catch {
    /* ignore */
  }
}

/** Last host-side error string (for Settings test toast). */
let lastNativeNotifyError: string | null = null;

/** Read last native notify failure (cleared on success). */
export function takeLastNativeNotifyError(): string | null {
  const e = lastNativeNotifyError;
  lastNativeNotifyError = null;
  return e;
}

/**
 * Host native path (bypasses WebView permission race).
 * Prefer our `desktop_notify_show` command (returns errors) then the plugin.
 * Returns true when the invoke was accepted; delivery is still OS-dependent.
 */
async function notifyViaTauriPlugin(
  opts: DesktopNotifyOptions,
): Promise<boolean> {
  lastNativeNotifyError = null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const sessionId =
      typeof opts.sessionId === "string" && opts.sessionId.trim()
        ? opts.sessionId.trim()
        : null;
    try {
      // Host returns delivery path string on success (e.g. osascript / unusernotification).
      // `sound` is the Settings beep. The host plays it; the Web Audio beep
      // is not also played on this path (that would double).
      await invoke<string>("desktop_notify_show", {
        title: opts.title,
        body: opts.body ?? null,
        sessionId,
        sound: resolveNotifySoundEnabled(opts.sound),
      });
      return true;
    } catch (hostErr) {
      const msg =
        hostErr instanceof Error
          ? hostErr.message
          : typeof hostErr === "string"
            ? hostErr
            : String(hostErr);
      lastNativeNotifyError = msg;
      console.warn("[desktopNotify] host notify failed", hostErr);
      // Old binary without desktop_notify_show — try plugin IPC.
      if (!/not found|unknown command|Command/i.test(msg)) {
        return false;
      }
    }
    // Plugin notify-rust path: only as legacy fallback when host command missing.
    // On macOS Sequoia bare binaries it often silently drops — prefer host path.
    await invoke("plugin:notification|notify", {
      options: {
        title: opts.title,
        body: opts.body,
        silent: false,
        ...(sessionId ? { extra: { sessionId } } : {}),
      },
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lastNativeNotifyError = msg;
    console.warn("[desktopNotify] native notify failed", e);
    return false;
  }
}

/**
 * Show a system notification when permission is granted.
 * Returns true when a notification was handed off to the OS / WebView.
 * Click focuses the app window when possible, then deep-links to
 * `sessionId` via the registered session focus handler (if any).
 * Suppressed entirely during quiet hours (localStorage pref).
 * Suppressed when `sessionId` is in the per-session mute set (in-app
 * toasts are not gated here — callers still show those).
 */
export function showDesktopNotification(opts: DesktopNotifyOptions): boolean {
  if (isQuietHoursActive()) return false;
  if (opts.sessionId && isSessionMuted(opts.sessionId)) return false;
  if (!opts.force && typeof document !== "undefined" && document.hasFocus()) {
    // App is in front — prefer in-app toast; caller can pass force=true.
    return false;
  }

  // Tauri: prefer native plugin so alerts work even when the WebView still
  // reports default/denied before the polyfill finishes, or when WKWebView's
  // bare Notification API is broken.
  if (isTauriHost()) {
    void (async () => {
      const ok = await notifyViaTauriPlugin(opts);
      if (!ok) {
        // Host never played the beep. Fall back to the Web Audio one.
        if (!tryShowWebNotification(opts, { playSound: true })) {
          playOptionalSound(opts);
        }
      }
    })();
    return true;
  }

  if (notificationSupport() !== "granted") return false;
  return tryShowWebNotification(opts, { playSound: true });
}

function tryShowWebNotification(
  opts: DesktopNotifyOptions,
  flags: { playSound: boolean },
): boolean {
  const N = notificationCtor();
  if (!N) return false;
  if (notificationSupport() !== "granted" && !isTauriHost()) return false;
  try {
    const focusSessionId =
      typeof opts.sessionId === "string" && opts.sessionId.trim()
        ? opts.sessionId.trim()
        : null;
    const n = new N(opts.title, {
      body: opts.body,
      tag: opts.tag,
      silent: false,
    });
    try {
      // Tauri polyfill constructor is fire-and-forget (returns undefined).
      if (n && typeof n === "object") {
        n.onclick = () => {
          try {
            // Some browsers leave the notification open until closed.
            n.close?.();
          } catch {
            /* ignore */
          }
          focusAppFromNotification();
          if (focusSessionId && sessionFocusHandler) {
            try {
              sessionFocusHandler(focusSessionId);
            } catch {
              /* fail closed — window already focused */
            }
          }
        };
      }
    } catch {
      /* ignore onclick assignment failures */
    }
    if (flags.playSound) playOptionalSound(opts);
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
