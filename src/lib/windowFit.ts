/**
 * Grow the desktop window when workbench panes need more horizontal room.
 *
 * Programmatic setSize marks a short suppress window so resize listeners /
 * ResizeObservers do not re-enter and flicker (grow → clamp → grow).
 */

import { isDesktopHost } from "@/lib/api";
import {
  MAIN_CHAT_MIN_WIDTH,
  requiredWorkbenchInnerWidth,
  type LayoutPrefs,
} from "@/lib/layout";

/** Padding so chrome / scrollbars do not immediately re-clamp. */
const FIT_PAD = 16;

/** Ignore cascade resize events after we call setSize. */
const SUPPRESS_MS = 500;

let suppressUntilMs = 0;
let inFlight: Promise<number | null> | null = null;
let inFlightTarget = 0;

export type EnsureWindowWidthOpts = {
  /**
   * When the window is maximized/zoomed and still too narrow for panes,
   * unmaximize first so setSize can apply. Default true.
   */
  allowUnmaximize?: boolean;
};

/** True while a programmatic window grow is settling (skip cascade handlers). */
export function isWindowFitSuppressed(): boolean {
  return Date.now() < suppressUntilMs;
}

function markSuppressed() {
  suppressUntilMs = Date.now() + SUPPRESS_MS;
}

/**
 * Ensure the main window's logical inner width is at least `minLogicalWidth`.
 * Returns the applied width, or null when unchanged / unavailable.
 * Concurrent calls coalesce to the largest target.
 */
export async function ensureWindowInnerWidth(
  minLogicalWidth: number,
  opts?: EnsureWindowWidthOpts,
): Promise<number | null> {
  if (!isDesktopHost()) return null;
  if (!Number.isFinite(minLogicalWidth) || minLogicalWidth <= 0) return null;

  const target = Math.ceil(minLogicalWidth + FIT_PAD);

  // Coalesce concurrent fits to the max requested width.
  if (inFlight) {
    if (target <= inFlightTarget) return inFlight;
    // Higher target: wait for current then run again with new target.
    await inFlight;
  }

  inFlightTarget = target;
  inFlight = growWindowTo(target, opts).finally(() => {
    inFlight = null;
    inFlightTarget = 0;
  });
  return inFlight;
}

async function growWindowTo(
  target: number,
  opts?: EnsureWindowWidthOpts,
): Promise<number | null> {
  try {
    const { getCurrentWindow, currentMonitor } = await import(
      "@tauri-apps/api/window"
    );
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    const allowUnmaximize = opts?.allowUnmaximize !== false;

    try {
      if (await win.isFullscreen()) return null;
    } catch {
      /* ignore */
    }

    let maximized = false;
    try {
      maximized = await win.isMaximized();
    } catch {
      maximized = false;
    }

    const physical = await win.innerSize();
    const factor = await win.scaleFactor();
    if (!(factor > 0)) return null;
    let curW = physical.width / factor;
    const curH = physical.height / factor;
    if (curW + 0.5 >= target) return null;

    let capped = target;
    try {
      const mon = await currentMonitor();
      if (mon?.workArea && mon.scaleFactor > 0) {
        const workW = mon.workArea.size.width / mon.scaleFactor;
        if (Number.isFinite(workW) && workW > 0) {
          capped = Math.min(capped, Math.floor(workW));
        }
      }
    } catch {
      /* ignore monitor probe */
    }
    if (capped <= curW + 0.5) return null;

    if (maximized) {
      if (!allowUnmaximize) return null;
      try {
        await win.unmaximize();
      } catch {
        return null;
      }
      try {
        const again = await win.innerSize();
        const f2 = await win.scaleFactor();
        if (f2 > 0) curW = again.width / f2;
      } catch {
        /* keep curW */
      }
      if (curW + 0.5 >= capped) return null;
    }

    // Suppress cascade before setSize so the resize event is ignored.
    markSuppressed();
    await win.setSize(new LogicalSize(capped, curH));

    // Growing width alone can push the right edge off-monitor when the
    // window sits near the right of the work area (common for non-maximized
    // frames). Nudge left so the side-pane chrome (close control) stays on
    // screen.
    try {
      const mon = await currentMonitor();
      if (mon?.workArea && mon.scaleFactor > 0) {
        const { LogicalPosition } = await import("@tauri-apps/api/dpi");
        const outer = await win.outerPosition();
        const outerSize = await win.outerSize();
        const sf = mon.scaleFactor;
        const work = mon.workArea;
        const workX = work.position.x / sf;
        const workY = work.position.y / sf;
        const workW = work.size.width / sf;
        const workH = work.size.height / sf;
        const winX = outer.x / sf;
        const winY = outer.y / sf;
        const winW = outerSize.width / sf;
        const winH = outerSize.height / sf;
        let nextX = winX;
        let nextY = winY;
        if (winX + winW > workX + workW) {
          nextX = workX + workW - winW;
        }
        if (nextX < workX) nextX = workX;
        if (winY + winH > workY + workH) {
          nextY = workY + workH - winH;
        }
        if (nextY < workY) nextY = workY;
        if (
          Math.abs(nextX - winX) > 0.5 ||
          Math.abs(nextY - winY) > 0.5
        ) {
          await win.setPosition(new LogicalPosition(nextX, nextY));
        }
      }
    } catch {
      /* position clamp is best-effort */
    }

    markSuppressed();
    return capped;
  } catch (e) {
    console.warn("[windowFit] ensureWindowInnerWidth failed", e);
    return null;
  }
}

/** Grow the window to fit the given workbench layout (open panes + chat floor). */
export async function ensureWindowFitsLayout(
  layout: Pick<
    LayoutPrefs,
    "sidebarCollapsed" | "sidebarWidth" | "asideCollapsed" | "asideWidth"
  >,
  opts?: EnsureWindowWidthOpts,
): Promise<number | null> {
  return ensureWindowInnerWidth(requiredWorkbenchInnerWidth(layout), opts);
}

/**
 * If the live `.main` column is narrower than the chat floor, compute the
 * inner width needed from on-screen pane boxes.
 */
export function measureWorkbenchFitNeed(
  mainMin: number = MAIN_CHAT_MIN_WIDTH,
): number | null {
  if (typeof document === "undefined") return null;
  const main = document.querySelector(".main") as HTMLElement | null;
  if (!main) return null;
  const mainW = main.getBoundingClientRect().width;
  if (!(mainW > 0) || mainW >= mainMin - 1) return null;

  const sidebar = document.querySelector(".sidebar") as HTMLElement | null;
  const aside = document.querySelector(
    ".aside:not(.aside--hidden):not(.aside--collapsed)",
  ) as HTMLElement | null;

  let sideW = 0;
  if (sidebar) {
    const r = sidebar.getBoundingClientRect();
    const hidden =
      sidebar.classList.contains("sidebar--hidden") ||
      sidebar.classList.contains("sidebar--collapsed") ||
      r.width < 2;
    if (!hidden) sideW = Math.round(r.width);
  }

  let asideW = 0;
  if (aside) {
    const r = aside.getBoundingClientRect();
    if (r.width >= 2) asideW = Math.round(r.width);
  }

  return sideW + mainMin + asideW;
}

/**
 * DOM-based rescue: if chat is visibly crushed, grow once.
 * No-op while a programmatic fit is settling.
 */
export async function ensureWindowFitsMeasuredChat(
  mainMin: number = MAIN_CHAT_MIN_WIDTH,
  opts?: EnsureWindowWidthOpts,
): Promise<number | null> {
  if (isWindowFitSuppressed()) return null;
  const need = measureWorkbenchFitNeed(mainMin);
  if (need == null) return null;
  return ensureWindowInnerWidth(need, opts);
}
