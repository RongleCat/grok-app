/**
 * Overlay pointer-drag helpers.
 *
 * Wayland cannot start a compositor move from a late IPC `startDragging`
 * (the button serial is already gone). Manual nudge uses movementX/Y
 * (screenX is often stubbed at 0 on WebKitGTK).
 */

export const PET_DRAG_SLOP = 6;

export function petDragPassedSlop(
  dx: number,
  dy: number,
  slop: number = PET_DRAG_SLOP,
): boolean {
  return dx * dx + dy * dy >= slop * slop;
}

/** Host cursor-poll click-through (X11 / AppKit / Win32). Off on Wayland. */
export function petShouldManualDrag(policy: {
  cursorClickThrough: boolean;
}): boolean {
  return !policy.cursorClickThrough;
}

export function petPointerStep(
  e: { movementX: number; movementY: number; screenX: number; screenY: number },
  lastScreen: { x: number; y: number },
): { dx: number; dy: number; nextScreen: { x: number; y: number } } {
  const nextScreen = { x: e.screenX, y: e.screenY };
  if (e.movementX !== 0 || e.movementY !== 0) {
    return { dx: e.movementX, dy: e.movementY, nextScreen };
  }
  return {
    dx: e.screenX - lastScreen.x,
    dy: e.screenY - lastScreen.y,
    nextScreen,
  };
}

/** When `pet_webview_ready` fails, still compact on desktop Linux. */
export function fallbackPetOverlayPolicy(userAgent: string): {
  compactIdle: boolean;
  cursorClickThrough: boolean;
} {
  const ua = userAgent || "";
  const linux = /Linux/i.test(ua) && !/Android/i.test(ua);
  if (linux) {
    return { compactIdle: true, cursorClickThrough: false };
  }
  return { compactIdle: false, cursorClickThrough: true };
}
