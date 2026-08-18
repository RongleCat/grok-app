/**
 * Pointer-based sidebar → composer attach.
 *
 * HTML5 DnD is unreliable in Tauri/WKWebView (custom MIME dropped, native
 * file-drop swallows `drop`). Threshold + hit-test stay pure so we can test
 * without a DOM drag.
 */

export const SESSION_ATTACH_DRAG_THRESHOLD_PX = 6;

export function sessionAttachDragPastThreshold(
  dx: number,
  dy: number,
  threshold = SESSION_ATTACH_DRAG_THRESHOLD_PX,
): boolean {
  return dx * dx + dy * dy >= threshold * threshold;
}

export type SessionAttachDropKind = "composer" | "sidebar" | "miss";

export function classifySessionAttachDrop(opts: {
  overComposer: boolean;
  zone: "sidebar" | "main";
}): SessionAttachDropKind {
  if (opts.overComposer) return "composer";
  if (opts.zone === "sidebar") return "sidebar";
  return "miss";
}

/** Visual + drop target is the composer (not the whole transcript). */
export function isSessionAttachDropTarget(opts: {
  overComposer: boolean;
  zone: "sidebar" | "main";
}): boolean {
  return classifySessionAttachDrop(opts) === "composer";
}

export const SESSION_ATTACH_DRAG_CLASS = "is-session-attach-dragging";

/** Block WebView text-select / native text-drag for the gesture. */
export function setSessionAttachDragLock(on: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(SESSION_ATTACH_DRAG_CLASS, on);
  if (on) window.getSelection()?.removeAllRanges();
}

export function sessionAttachDropReadyFromPoint(
  x: number,
  y: number,
  opts: {
    composerEl: { contains: (node: Node) => boolean } | null;
    zone: "sidebar" | "main";
    hit?: Element | null;
  },
): boolean {
  const hit = opts.hit ?? document.elementFromPoint(x, y);
  const overComposer = !!(
    opts.composerEl &&
    hit &&
    opts.composerEl.contains(hit)
  );
  return isSessionAttachDropTarget({ overComposer, zone: opts.zone });
}

/** Do not start a drag from pin / menu / other row chrome. */
export function isSessionAttachPointerStartTarget(
  target: EventTarget | null,
): boolean {
  if (!target || typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  return !!target.closest(".tree-l3__drag-handle");
}

/** Swallow the leftover click after a started grip-drag (same window as session-move). */
export const ATTACH_DRAG_CLICK_GUARD_MS = 400;

export type AttachDragClickGuard = {
  arm: (now: number) => void;
  consume: (now: number) => boolean;
};

/** One-shot + deadline. After consume or expiry, later consume() is false. */
export function createAttachDragClickGuard(
  ttlMs = ATTACH_DRAG_CLICK_GUARD_MS,
): AttachDragClickGuard {
  let until = 0;
  return {
    arm(now: number) {
      until = now + ttlMs;
    },
    consume(now: number) {
      if (until === 0 || now >= until) {
        until = 0;
        return false;
      }
      until = 0;
      return true;
    },
  };
}

export type AttachDragClickBlockerHost = {
  add: (type: "click", fn: (ev: Event) => void, capture: boolean) => void;
  remove: (type: "click", fn: (ev: Event) => void, capture: boolean) => void;
  timeout: (fn: () => void, ms: number) => unknown;
};

/** Arm the guard and intercept the next click for `ttlMs` (pointerup → click). */
export function armAttachDragClickBlocker(
  guard: AttachDragClickGuard,
  now: number,
  host?: AttachDragClickBlockerHost,
  ttlMs = ATTACH_DRAG_CLICK_GUARD_MS,
): void {
  guard.arm(now);
  const h =
    host ??
    (typeof window === "undefined"
      ? null
      : {
          add: (type, fn, capture) =>
            window.addEventListener(type, fn, capture),
          remove: (type, fn, capture) =>
            window.removeEventListener(type, fn, capture),
          timeout: (fn, ms) => window.setTimeout(fn, ms),
        });
  if (!h) return;
  const blockClick = (ev: Event) => {
    // Same clock as arm(): leftover pointerup→click is immediate.
    if (!guard.consume(now)) return;
    ev.preventDefault();
    ev.stopPropagation();
    h.remove("click", blockClick, true);
  };
  h.add("click", blockClick, true);
  h.timeout(() => h.remove("click", blockClick, true), ttlMs);
}
