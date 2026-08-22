import { describe, expect, it } from "vitest";
import { petMarkClickIntent } from "./petClick";

describe("petMarkClickIntent", () => {
  it("arms a single click as an emote, not an open", () => {
    expect(petMarkClickIntent({ pendingSingle: false })).toBe("arm-emote");
  });

  it("treats a second click inside the double-click window as open", () => {
    expect(petMarkClickIntent({ pendingSingle: true })).toBe("open-double");
  });
});
