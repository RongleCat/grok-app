/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyOutputMotionToDocument,
  DEFAULT_OUTPUT_MOTION,
  loadOutputMotionPref,
  OUTPUT_MOTION_CHANGE_EVENT,
  OUTPUT_MOTION_STORAGE_KEY,
  parseOutputMotionPref,
  saveOutputMotionPref,
} from "./outputMotionPref";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  };
}

afterEach(() => {
  delete document.documentElement.dataset.outputMotion;
});

describe("outputMotionPref", () => {
  it("defaults on", () => {
    expect(DEFAULT_OUTPUT_MOTION).toBe(true);
    expect(parseOutputMotionPref(null)).toBe(true);
    expect(parseOutputMotionPref("invalid")).toBe(true);
  });

  it("parses boolean storage values", () => {
    expect(parseOutputMotionPref("1")).toBe(true);
    expect(parseOutputMotionPref("true")).toBe(true);
    expect(parseOutputMotionPref(true)).toBe(true);
    expect(parseOutputMotionPref("0")).toBe(false);
    expect(parseOutputMotionPref("false")).toBe(false);
    expect(parseOutputMotionPref(false)).toBe(false);
  });

  it("round-trips load and save", () => {
    const storage = memoryStorage();
    expect(loadOutputMotionPref(storage)).toBe(true);
    saveOutputMotionPref(false, storage);
    expect(storage.getItem(OUTPUT_MOTION_STORAGE_KEY)).toBe("0");
    expect(loadOutputMotionPref(storage)).toBe(false);
    saveOutputMotionPref(true, storage);
    expect(storage.getItem(OUTPUT_MOTION_STORAGE_KEY)).toBe("1");
    expect(loadOutputMotionPref(storage)).toBe(true);
  });

  it("dispatches the change event with the next value", () => {
    const onChange = vi.fn();
    window.addEventListener(OUTPUT_MOTION_CHANGE_EVENT, onChange);
    try {
      saveOutputMotionPref(false, memoryStorage());
      expect(onChange).toHaveBeenCalledTimes(1);
      expect((onChange.mock.calls[0]?.[0] as CustomEvent<boolean>).detail).toBe(
        false,
      );
    } finally {
      window.removeEventListener(OUTPUT_MOTION_CHANGE_EVENT, onChange);
    }
  });

  it("sets and removes the document attribute", () => {
    applyOutputMotionToDocument(false);
    expect(document.documentElement.dataset.outputMotion).toBe("off");
    expect(document.documentElement.hasAttribute("data-output-motion")).toBe(
      true,
    );

    applyOutputMotionToDocument(true);
    expect(document.documentElement.dataset.outputMotion).toBeUndefined();
    expect(document.documentElement.hasAttribute("data-output-motion")).toBe(
      false,
    );
  });
});
