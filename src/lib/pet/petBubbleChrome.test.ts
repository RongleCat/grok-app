import { describe, expect, it } from "vitest";
import {
  normalizePetBubbleDismissSec,
  normalizePetBubbleShape,
  normalizePetBubbleStyle,
  petProgressBarEnabled,
} from "./petBubbleChrome";

describe("pet bubble chrome prefs", () => {
  it("defaults shape/style and clamps dismiss seconds", () => {
    expect(normalizePetBubbleShape(undefined)).toBe("round");
    expect(normalizePetBubbleStyle(undefined)).toBe("ink");
    expect(normalizePetBubbleDismissSec(undefined)).toBe(15);
    expect(normalizePetBubbleDismissSec(1)).toBe(3);
    expect(normalizePetBubbleDismissSec(999)).toBe(120);
    expect(normalizePetBubbleDismissSec(20)).toBe(20);
  });

  it("keeps the progress bar off unless opted in", () => {
    expect(petProgressBarEnabled(undefined)).toBe(false);
    expect(petProgressBarEnabled({ progressBarEnabled: false })).toBe(false);
    expect(petProgressBarEnabled({ progressBarEnabled: true })).toBe(true);
  });
});
