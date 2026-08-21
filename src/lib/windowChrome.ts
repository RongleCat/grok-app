/**
 * Desktop window chrome helpers (frameless Win/Linux + titlebar dblclick).
 *
 * GTK/Wayland maximize is often a no-op; fall back to filling the monitor
 * work area and remember the previous bounds so Restore works.
 * Windows/macOS must not take that path: a follow-up setSize cancels a real
 * maximize that was still settling.
 *
 * Do not put a CSS transform on `html`/`body` to "pin" visualViewport — that
 * breaks `-webkit-app-region: drag`, so titlebar moves become north-resize
 * (window grows downward; you cannot lift it).
 */

import type { AppPlatform } from "@/lib/appPlatform";
import { detectAppPlatform } from "@/lib/appPlatform";

export const TITLEBAR_MAXIMIZE_DEBOUNCE_MS = 400;

/** Poll interval while waiting for OS `isMaximized` to catch up (Linux only). */
export const OS_MAXIMIZE_POLL_MS = 16;

/** Linux: short wait then work-area fill. */
export const LINUX_MAXIMIZE_WAIT_MS = 40;

/**
 * Caption min/max/close: wait until the pointer is fully up before
 * maximize(). Otherwise Windows treats the still-held click as a drag on
 * a maximized window and immediately restores (flash).
 */
export const CAPTION_BUTTON_TOGGLE_DEFER_MS = 32;

/** Work-area fill is only for compositors that ignore gtk_window_maximize. */
export function shouldFakeMaximizeFallback(platform: AppPlatform): boolean {
  return platform === "linux";
}

export function osMaximizeWaitMs(allowFakeFallback: boolean): number {
  return allowFakeFallback ? LINUX_MAXIMIZE_WAIT_MS : 0;
}

export function scheduleCaptionButtonToggle(
  fn: () => void,
  deferMs: number = CAPTION_BUTTON_TOGGLE_DEFER_MS,
): ReturnType<typeof setTimeout> {
  return setTimeout(fn, Math.max(0, deferMs));
}

/** Double-click / mousedown(detail=2) must not toggle twice. */
export function shouldAcceptTitlebarMaximize(
  lastMs: number,
  nowMs: number,
  debounceMs: number = TITLEBAR_MAXIMIZE_DEBOUNCE_MS,
): boolean {
  if (!(nowMs >= 0)) return false;
  return nowMs - lastMs >= debounceMs;
}

/** OS `isMaximized` did not change after maximize/unmaximize. */
export function maximizeLooksNoop(before: boolean, after: boolean): boolean {
  return before === after;
}

type LogicalBounds = { x: number; y: number; w: number; h: number };

let lastTitlebarMaximizeMs = 0;
let fakeMaximized = false;
let restoreBounds: LogicalBounds | null = null;

/** Work-area fill used when the compositor ignores gtk_window_maximize. */
export function isFakeMaximized(): boolean {
  return fakeMaximized;
}

export function resetWindowChromeTestState(): void {
  lastTitlebarMaximizeMs = 0;
  fakeMaximized = false;
  restoreBounds = null;
}

async function readLogicalBounds(
  w: Awaited<ReturnType<typeof import("@tauri-apps/api/window").getCurrentWindow>>,
): Promise<LogicalBounds | null> {
  try {
    const pos = await w.outerPosition();
    const size = await w.outerSize();
    const factor = await w.scaleFactor();
    const f = factor > 0 ? factor : 1;
    return {
      x: pos.x / f,
      y: pos.y / f,
      w: size.width / f,
      h: size.height / f,
    };
  } catch {
    return null;
  }
}

async function applyLogicalBounds(
  w: Awaited<ReturnType<typeof import("@tauri-apps/api/window").getCurrentWindow>>,
  b: LogicalBounds,
): Promise<void> {
  const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
  await w.setPosition(new LogicalPosition(b.x, b.y));
  await w.setSize(new LogicalSize(b.w, b.h));
}

async function fillMonitorWorkArea(
  w: Awaited<ReturnType<typeof import("@tauri-apps/api/window").getCurrentWindow>>,
): Promise<boolean> {
  try {
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const mon = await currentMonitor();
    const wa = mon?.workArea;
    if (!mon || !wa) return false;
    const factor = mon.scaleFactor > 0 ? mon.scaleFactor : await w.scaleFactor();
    const f = factor > 0 ? factor : 1;
    const bounds: LogicalBounds = {
      x: wa.position.x / f,
      y: wa.position.y / f,
      w: wa.size.width / f,
      h: wa.size.height / f,
    };
    if (!(bounds.w > 80 && bounds.h > 80)) return false;
    await applyLogicalBounds(w, bounds);
    return true;
  } catch {
    return false;
  }
}

type HostWindow = Awaited<
  ReturnType<typeof import("@tauri-apps/api/window").getCurrentWindow>
>;

async function waitForOsMaximized(
  w: HostWindow,
  expect: boolean,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    const v = await w.isMaximized().catch(() => false);
    if (v === expect) return v;
    if (Date.now() - start >= timeoutMs) return v;
    await new Promise((r) => setTimeout(r, OS_MAXIMIZE_POLL_MS));
  }
}

/**
 * Maximize / restore. Prefers the OS API; on Linux Wayland no-ops, fills
 * the work area and treats that as maximized until the next toggle.
 * Windows/mac: one OS call, no wait, no setSize. Returns the intended
 * caption state; onResized corrects the glyph if the OS disagrees.
 */
export async function toggleMaximizeReliable(): Promise<boolean> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const allowFake = shouldFakeMaximizeFallback(detectAppPlatform());
  const wasOs = await w.isMaximized().catch(() => false);

  if (!allowFake) {
    fakeMaximized = false;
    restoreBounds = null;
    if (wasOs) {
      try {
        await w.unmaximize();
      } catch {
        /* ignore */
      }
      return false;
    }
    try {
      await w.maximize();
    } catch {
      /* ignore */
    }
    return true;
  }

  const waitMs = osMaximizeWaitMs(true);
  const was = wasOs || fakeMaximized;

  if (was) {
    fakeMaximized = false;
    if (wasOs) {
      try {
        await w.unmaximize();
      } catch {
        /* ignore */
      }
      await waitForOsMaximized(w, false, waitMs);
    }
    if (restoreBounds) {
      const prev = restoreBounds;
      restoreBounds = null;
      try {
        await applyLogicalBounds(w, prev);
      } catch {
        /* ignore */
      }
    }
    return w.isMaximized().catch(() => false);
  }

  const before = await readLogicalBounds(w);
  try {
    await w.maximize();
  } catch {
    /* some compositors reject maximize() */
  }
  const nowOs = await waitForOsMaximized(w, true, waitMs);
  if (nowOs) {
    restoreBounds = null;
    fakeMaximized = false;
    return true;
  }

  if (before) restoreBounds = before;
  const filled = await fillMonitorWorkArea(w);
  fakeMaximized = filled;
  return filled || (await w.isMaximized().catch(() => false));
}

export async function toggleMaximizeFromTitlebar(): Promise<void> {
  const now = Date.now();
  if (!shouldAcceptTitlebarMaximize(lastTitlebarMaximizeMs, now)) return;
  lastTitlebarMaximizeMs = now;
  try {
    await toggleMaximizeReliable();
  } catch {
    /* browser / no window API */
  }
}
