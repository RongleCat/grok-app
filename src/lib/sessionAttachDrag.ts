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

export function isSessionAttachDropTarget(opts: {
  overComposer: boolean;
  zone: "sidebar" | "main";
}): boolean {
  return opts.overComposer || opts.zone === "main";
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
  if (!target || typeof Element === "undefined") return true;
  if (!(target instanceof Element)) return true;
  return !target.closest(
    "button, a, input, textarea, [contenteditable='true']",
  );
}
