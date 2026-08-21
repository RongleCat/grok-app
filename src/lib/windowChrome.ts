/**
 * Desktop window chrome helpers (frameless Win/Linux + titlebar dblclick).
 *
 * GTK/Wayland maximize is often a no-op; fall back to filling the monitor
 * work area and remember the previous bounds so Restore works.
 * Windows/macOS must not take that path: a follow-up setSize cancels a real
 * maximize that was still settling.
 */

import type { AppPlatform } from "@/lib/appPlatform";
import { detectAppPlatform } from "@/lib/appPlatform";

export const TITLEBAR_MAXIMIZE_DEBOUNCE_MS = 400;

/** Poll interval while waiting for OS `isMaximized` to catch up. */
export const OS_MAXIMIZE_POLL_MS = 16;

/** Linux: short wait then work-area fill. */
export const LINUX_MAXIMIZE_WAIT_MS = 40;

/** Windows/mac: give ShowWindow(SW_MAXIMIZE) time; never fake-fill. */
export const OS_MAXIMIZE_WAIT_MS = 280;

export const VIEWPORT_PAN_CLASS = "has-viewport-pan";
export const VIEWPORT_PAN_X_VAR = "--viewport-pan-x";
export const VIEWPORT_PAN_Y_VAR = "--viewport-pan-y";

/** Work-area fill is only for compositors that ignore gtk_window_maximize. */
export function shouldFakeMaximizeFallback(platform: AppPlatform): boolean {
  return platform === "linux";
}

export function osMaximizeWaitMs(allowFakeFallback: boolean): number {
  return allowFakeFallback ? LINUX_MAXIMIZE_WAIT_MS : OS_MAXIMIZE_WAIT_MS;
}

/**
 * CSS translate that cancels visualViewport pan (WebView2 top/left resize).
 * `null` means identity — drop the pin class.
 */
export function viewportPanFromOffset(
  offsetLeft: number,
  offsetTop: number,
): { x: number; y: number } | null {
  const x = Number.isFinite(offsetLeft) ? Math.round(-offsetLeft) : 0;
  const y = Number.isFinite(offsetTop) ? Math.round(-offsetTop) : 0;
  if (x === 0 && y === 0) return null;
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

export function applyViewportPan(
  root: HTMLElement,
  pan: { x: number; y: number } | null,
): void {
  if (!pan) {
    root.classList.remove(VIEWPORT_PAN_CLASS);
    root.style.removeProperty(VIEWPORT_PAN_X_VAR);
    root.style.removeProperty(VIEWPORT_PAN_Y_VAR);
    return;
  }
  root.classList.add(VIEWPORT_PAN_CLASS);
  root.style.setProperty(VIEWPORT_PAN_X_VAR, `${pan.x}px`);
  root.style.setProperty(VIEWPORT_PAN_Y_VAR, `${pan.y}px`);
}

/** Pin the page when WebView2 shifts visualViewport during edge resize. */
export function subscribeDesktopViewportPin(
  opts?: {
    root?: HTMLElement;
    getOffset?: () => { offsetLeft: number; offsetTop: number } | null;
  },
): () => void {
  const root = opts?.root ?? document.documentElement;
  const apply = () => {
    let offset: { offsetLeft: number; offsetTop: number } | null;
    if (opts?.getOffset) {
      offset = opts.getOffset();
    } else {
      const vv = window.visualViewport;
      offset = vv
        ? { offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop }
        : null;
    }
    applyViewportPan(
      root,
      offset
        ? viewportPanFromOffset(offset.offsetLeft, offset.offsetTop)
        : null,
    );
  };
  apply();
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  return () => {
    vv?.removeEventListener("resize", apply);
    vv?.removeEventListener("scroll", apply);
    window.removeEventListener("resize", apply);
    applyViewportPan(root, null);
  };
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
 * Windows never fills the work area — that undoes a real maximize.
 * Returns whether the window should display as maximized.
 */
export async function toggleMaximizeReliable(): Promise<boolean> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const allowFake = shouldFakeMaximizeFallback(detectAppPlatform());
  const waitMs = osMaximizeWaitMs(allowFake);
  const wasOs = await w.isMaximized().catch(() => false);
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
    if (allowFake && restoreBounds) {
      const prev = restoreBounds;
      restoreBounds = null;
      try {
        await applyLogicalBounds(w, prev);
      } catch {
        /* ignore */
      }
    } else {
      restoreBounds = null;
    }
    return w.isMaximized().catch(() => false);
  }

  const before = allowFake ? await readLogicalBounds(w) : null;
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

  if (!allowFake) {
    return w.isMaximized().catch(() => false);
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
