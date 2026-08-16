/**
 * Desktop window chrome helpers (frameless Win/Linux + titlebar dblclick).
 *
 * GTK/Wayland maximize is often a no-op; fall back to filling the monitor
 * work area and remember the previous bounds so Restore works.
 */

export const TITLEBAR_MAXIMIZE_DEBOUNCE_MS = 400;

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

/**
 * Maximize / restore. Prefers the OS API; on Linux Wayland no-ops, fills
 * the work area and treats that as maximized until the next toggle.
 * Returns whether the window should display as maximized.
 */
export async function toggleMaximizeReliable(): Promise<boolean> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
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
  await new Promise((r) => setTimeout(r, 40));
  const nowOs = await w.isMaximized().catch(() => false);
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
