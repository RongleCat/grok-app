/**
 * Ctrl+Q must be pressed twice (within a short window) to quit.
 * First press is a toast; the second actually exits.
 *
 * Windows native Quit has no Ctrl+Q binding. This chord is frontend-owned.
 * Focus on a PTY/xterm surface must not consume Ctrl+Q (terminal XON).
 */

/** How long the second Ctrl+Q counts as confirm. */
export const QUIT_DOUBLE_PRESS_MS = 2000;

/** Side/bottom terminal surfaces that own Ctrl+Q as XON (not quit). */
export const PTY_QUIT_PASSTHROUGH_SEL = [
  ".xterm",
  ".xterm-helper-textarea",
  ".sw-terminal",
  "[data-testid='side-terminal-xterm']",
  "[data-testid='bottom-terminal']",
].join(", ");

/** True when focus is inside the embedded PTY / xterm panel. */
export function isPtyFocusSurface(
  el: EventTarget | null | undefined,
): boolean {
  if (!el || typeof (el as HTMLElement).closest !== "function") return false;
  try {
    return !!(el as HTMLElement).closest(PTY_QUIT_PASSTHROUGH_SEL);
  } catch {
    return false;
  }
}

export type QuitPressResult = {
  action: "arm" | "quit";
  armedAt: number | null;
};

/** True for Control+Q (no Shift/Alt/Cmd). */
export function isQuitShortcutKey(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (
    e.key.toLowerCase() === "q" &&
    e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey
  );
}

/**
 * Whether the window-capture handler should preventDefault / stopPropagation.
 * False on PTY/xterm so Ctrl+Q still sends XON after Ctrl+S freeze.
 */
export function shouldConsumeQuitShortcut(opts: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  recordingShortcut?: boolean;
  target?: EventTarget | null;
}): boolean {
  if (opts.isComposing) return false;
  if (opts.recordingShortcut) return false;
  if (!isQuitShortcutKey(opts)) return false;
  if (isPtyFocusSurface(opts.target)) return false;
  return true;
}

/**
 * First press arms; a second press inside {@link QUIT_DOUBLE_PRESS_MS} quits.
 * After the window lapses, the next press arms again.
 */
export function nextQuitPress(
  now: number,
  armedAt: number | null,
  windowMs: number = QUIT_DOUBLE_PRESS_MS,
): QuitPressResult {
  if (armedAt != null && now - armedAt <= windowMs) {
    return { action: "quit", armedAt: null };
  }
  return { action: "arm", armedAt: now };
}
