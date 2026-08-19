import { afterEach, describe, expect, it } from "vitest";
import { readPetBootPrefs } from "./pet";

describe("readPetBootPrefs", () => {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "window");

  afterEach(() => {
    if (prev) Object.defineProperty(globalThis, "window", prev);
  });

  it("uses injected color instead of default green", () => {
    Object.defineProperty(globalThis, "window", {
      value: {
        __GROK_PET_BOOT__: {
          shape: "cloud",
          color: "violet",
          eyeColor: "white",
          sizePx: 160,
          bubblesEnabled: true,
        },
      },
      configurable: true,
    });
    const prefs = readPetBootPrefs();
    expect(prefs.color).toBe("violet");
    expect(prefs.shape).toBe("cloud");
    expect(prefs.eyeColor).toBe("white");
    expect(prefs.sizePx).toBe(160);
  });
});
