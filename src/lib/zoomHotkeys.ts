import { getCurrentWebview } from "@tauri-apps/api/webview";

export type ZoomHotkeyAction = "in" | "out" | "reset";

export const DEFAULT_ZOOM_LEVEL = 1;
export const ZOOM_STEP = 0.2;
export const MIN_ZOOM_LEVEL = 0.2;
export const MAX_ZOOM_LEVEL = 10;

type ZoomHotkeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey"
>;

export type ZoomHotkeyTarget = Pick<
  Window,
  "addEventListener" | "removeEventListener"
>;

export function zoomHotkeyAction(
  event: ZoomHotkeyEvent,
): ZoomHotkeyAction | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;

  if (
    event.key === "-" ||
    event.key === "Subtract" ||
    event.code === "Minus" ||
    event.code === "NumpadSubtract"
  ) {
    return "out";
  }

  if (
    event.key === "=" ||
    event.key === "+" ||
    event.key === "Add" ||
    event.code === "Equal" ||
    event.code === "NumpadAdd"
  ) {
    return "in";
  }

  if (
    event.key === "0" ||
    event.code === "Digit0" ||
    event.code === "Numpad0"
  ) {
    return "reset";
  }

  return null;
}

export function nextZoomLevel(
  current: number,
  action: ZoomHotkeyAction,
): number {
  const next =
    action === "reset"
      ? DEFAULT_ZOOM_LEVEL
      : current + (action === "in" ? ZOOM_STEP : -ZOOM_STEP);
  const clamped = Math.min(Math.max(next, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL);
  return Math.round(clamped * 10) / 10;
}

export function installZoomHotkeys(
  target: ZoomHotkeyTarget,
  setZoom: (level: number) => Promise<void> | void = (level) =>
    getCurrentWebview().setZoom(level),
): () => void {
  let zoomLevel = DEFAULT_ZOOM_LEVEL;

  const onKeyDown = (event: KeyboardEvent) => {
    const action = zoomHotkeyAction(event);
    if (!action) return;

    // Run before the app's document-level shortcut handlers and before the
    // Tauri initialization script's bubble listener.
    event.preventDefault();
    event.stopImmediatePropagation();
    zoomLevel = nextZoomLevel(zoomLevel, action);

    try {
      void Promise.resolve(setZoom(zoomLevel)).catch(() => undefined);
    } catch {
      // Browser previews and older hosts may not expose the Tauri command.
    }
  };

  target.addEventListener("keydown", onKeyDown, true);
  return () => target.removeEventListener("keydown", onKeyDown, true);
}
