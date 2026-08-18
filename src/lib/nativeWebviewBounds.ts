/**
 * Pure helpers for native child-webview bounds sync.
 * Keeps EmbeddedBrowser apply path free of races / subpixel thrash.
 */

export type BoundsPx = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** True when two rects are within `eps` on every edge (skip redundant IPC). */
export function boundsNearlyEqual(
  a: BoundsPx | null | undefined,
  b: BoundsPx,
  eps = 0.5,
): boolean {
  if (!a) return false;
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.width - b.width) <= eps &&
    Math.abs(a.height - b.height) <= eps
  );
}

/** Round to device-ish integers so WKWebView/WebView2 don't thrash on .3px. */
export function snapBounds(b: BoundsPx): BoundsPx {
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)),
    height: Math.max(0, Math.round(b.height)),
  };
}

export type HostRectPx = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/**
 * Clip host bounds so they do not cover a vertical pane resizer that lives
 * **inside** the host (legacy absolute left:0 handle).
 *
 * When the resizer straddles into the main column (`left: -Npx`), it already
 * receives hits from the parent WebView — do **not** inset the child browser
 * (that would leave a visible empty gutter). Only clip when the resizer starts
 * at/inside the host left edge.
 */
export function clipHostRectAgainstLeftResizers(
  host: HostRectPx,
  resizers: Array<Pick<HostRectPx, "left" | "right" | "top" | "bottom" | "width" | "height">>,
): HostRectPx {
  let left = host.left;
  const right = host.right;
  for (const r of resizers) {
    if (r.width <= 0 || r.height <= 0) continue;
    // Must share vertical span with host.
    if (r.bottom <= host.top || r.top >= host.bottom) continue;
    // Only inset for in-host resizers (not straddle-into-main handles).
    const fullyInsideHostLeft =
      r.right > left &&
      r.left < right &&
      r.left >= left - 0.5 &&
      r.right < right;
    if (fullyInsideHostLeft) {
      left = Math.max(left, r.right);
    }
  }
  return {
    left,
    top: host.top,
    right,
    bottom: host.bottom,
    width: Math.max(0, right - left),
    height: host.height,
  };
}

/** Aside is closing / closed — native webview must hide even if the host still reports a stale overflow box. */
export function isAsideWebviewSuppressed(
  aside: { classList: { contains(name: string): boolean }; getAttribute(name: string): string | null } | null,
): boolean {
  if (!aside) return false;
  return (
    aside.classList.contains("aside--hidden") ||
    aside.classList.contains("aside--collapsed") ||
    aside.getAttribute("aria-hidden") === "true"
  );
}

/**
 * Intersect host with the aside's visible border box.
 * Closing the pane sets aside width to 0 + overflow:hidden; the host's own
 * getBoundingClientRect can stay at the old 400px (min-content overflow).
 * Painting the native webview at that stale rect covers chat / chrome.
 */
export function clipHostRectToAncestor(
  host: HostRectPx,
  ancestor: Pick<HostRectPx, "left" | "top" | "right" | "bottom" | "width" | "height"> | null,
): HostRectPx | null {
  if (!ancestor || ancestor.width < 2 || ancestor.height < 2) return null;
  const left = Math.max(host.left, ancestor.left);
  const top = Math.max(host.top, ancestor.top);
  const right = Math.min(host.right, ancestor.right);
  const bottom = Math.min(host.bottom, ancestor.bottom);
  const width = right - left;
  const height = bottom - top;
  if (width < 2 || height < 2) return null;
  return { left, top, right, bottom, width, height };
}

/**
 * Single-flight + trailing-edge runner.
 *
 * - At most one `apply` in flight.
 * - Schedules during apply set a pending flag; when the current apply finishes,
 *   `apply` runs **once more** (not once per schedule).
 * - Prevents setPosition/setSize interleaving that leaves a stale size (jitter).
 */
export function createTrailingSingleFlight(apply: () => Promise<void>): {
  schedule: () => void;
  /** Await until idle (no in-flight / pending work). */
  flush: () => Promise<void>;
  dispose: () => void;
} {
  let inFlight = false;
  let pending = false;
  let disposed = false;
  const waiters = new Set<() => void>();

  const notifyIdle = () => {
    if (inFlight || pending) return;
    for (const w of waiters) w();
    waiters.clear();
  };

  const run = async () => {
    if (disposed || inFlight) return;
    inFlight = true;
    try {
      do {
        pending = false;
        if (disposed) break;
        try {
          await apply();
        } catch {
          /* apply errors are caller-visible via their own logging; keep loop */
        }
      } while (pending && !disposed);
    } finally {
      inFlight = false;
      if (pending && !disposed) {
        // Schedule arrived in the finally race window — kick another pass.
        void run();
      } else {
        notifyIdle();
      }
    }
  };

  return {
    schedule: () => {
      if (disposed) return;
      if (inFlight) {
        pending = true;
        return;
      }
      void run();
    },
    flush: () => {
      if (disposed || (!inFlight && !pending)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.add(resolve);
        if (!inFlight) void run();
      });
    },
    dispose: () => {
      disposed = true;
      pending = false;
      for (const w of waiters) w();
      waiters.clear();
    },
  };
}
