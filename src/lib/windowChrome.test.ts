import { describe, expect, it } from "vitest";
import {
  maximizeLooksNoop,
  shouldAcceptTitlebarMaximize,
  TITLEBAR_MAXIMIZE_DEBOUNCE_MS,
} from "./windowChrome";

describe("shouldAcceptTitlebarMaximize", () => {
  it("debounces the second click of a drag-region pair", () => {
    expect(shouldAcceptTitlebarMaximize(1000, 1000)).toBe(false);
    expect(shouldAcceptTitlebarMaximize(1000, 1000 + 399)).toBe(false);
    expect(
      shouldAcceptTitlebarMaximize(1000, 1000 + TITLEBAR_MAXIMIZE_DEBOUNCE_MS),
    ).toBe(true);
  });
});

describe("maximizeLooksNoop", () => {
  it("is true only when the flag did not flip", () => {
    expect(maximizeLooksNoop(false, false)).toBe(true);
    expect(maximizeLooksNoop(true, true)).toBe(true);
    expect(maximizeLooksNoop(false, true)).toBe(false);
    expect(maximizeLooksNoop(true, false)).toBe(false);
  });
});
