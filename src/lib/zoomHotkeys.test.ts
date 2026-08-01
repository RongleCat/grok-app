import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ZOOM_LEVEL,
  installZoomHotkeys,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  nextZoomLevel,
  zoomHotkeyAction,
} from "./zoomHotkeys";

function key(
  values: Partial<KeyboardEvent> = {},
): Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey"> {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    key: "",
    metaKey: false,
    ...values,
  };
}

describe("zoomHotkeys", () => {
  it("recognizes command and control zoom keys including physical key codes", () => {
    expect(zoomHotkeyAction(key({ metaKey: true, code: "Minus", key: "ß" }))).toBe(
      "out",
    );
    expect(zoomHotkeyAction(key({ metaKey: true, code: "Equal", key: "+" }))).toBe(
      "in",
    );
    expect(zoomHotkeyAction(key({ ctrlKey: true, key: "0" }))).toBe("reset");
    expect(zoomHotkeyAction(key({ metaKey: true, altKey: true, key: "=" }))).toBe(
      null,
    );
  });

  it("clamps zoom levels and resets to the default", () => {
    expect(nextZoomLevel(DEFAULT_ZOOM_LEVEL, "in")).toBe(1.2);
    expect(nextZoomLevel(DEFAULT_ZOOM_LEVEL, "out")).toBe(0.8);
    expect(nextZoomLevel(MAX_ZOOM_LEVEL, "in")).toBe(MAX_ZOOM_LEVEL);
    expect(nextZoomLevel(MIN_ZOOM_LEVEL, "out")).toBe(MIN_ZOOM_LEVEL);
    expect(nextZoomLevel(3.4, "reset")).toBe(DEFAULT_ZOOM_LEVEL);
  });

  it("handles the shortcut in capture phase and removes the listener", async () => {
    const listeners = new Map<string, (event: KeyboardEvent) => void>();
    const target = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener as (event: KeyboardEvent) => void);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }),
    };
    const setZoom = vi.fn().mockResolvedValue(undefined);
    const dispose = installZoomHotkeys(target, setZoom);
    const event = {
      ...key({ metaKey: true, code: "Minus", key: "ß" }),
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    listeners.get("keydown")?.(event);
    await Promise.resolve();

    expect(target.addEventListener).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
      true,
    );
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(setZoom).toHaveBeenCalledWith(0.8);

    dispose();
    expect(target.removeEventListener).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
      true,
    );
  });
});
