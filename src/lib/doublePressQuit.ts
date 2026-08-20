/**
 * Ctrl+Q must be pressed twice (within a short window) to quit.
 * First press is a toast; the second actually exits.
 *
 * Windows native Quit has no Ctrl+Q binding. This chord is frontend-owned.
 */

/** How long the second Ctrl+Q counts as confirm. */
export const QUIT_DOUBLE_PRESS_MS = 2000;

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
