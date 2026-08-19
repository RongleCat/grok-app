import { describe, expect, it } from "vitest";
import { PET_PEEK_HIDE_MS, petMarkClickIntent } from "./petClick";

describe("petMarkClickIntent", () => {
  it("arms a single click to open", () => {
    expect(
      petMarkClickIntent({ pendingSingle: false, openedAt: null, now: 1_000 }),
    ).toBe("arm-open");
  });

  it("treats a second click inside the double-click window as hide", () => {
    expect(
      petMarkClickIntent({ pendingSingle: true, openedAt: null, now: 1_100 }),
    ).toBe("hide-double");
  });

  it("hides on a follow-up click within 3s of opening", () => {
    expect(
      petMarkClickIntent({
        pendingSingle: false,
        openedAt: 1_000,
        now: 1_000 + PET_PEEK_HIDE_MS - 1,
      }),
    ).toBe("hide-peek");
    expect(
      petMarkClickIntent({
        pendingSingle: false,
        openedAt: 1_000,
        now: 1_000 + PET_PEEK_HIDE_MS,
      }),
    ).toBe("arm-open");
  });
});
