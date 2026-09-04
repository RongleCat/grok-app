import { describe, expect, it } from "vitest";
import { shouldProbeComposerLiveDom } from "./composerLiveProbe";

describe("shouldProbeComposerLiveDom", () => {
  it("skips while the window is hidden", () => {
    expect(
      shouldProbeComposerLiveDom({
        visibilityState: "hidden",
        composerActive: true,
        selectionInComposer: true,
      }),
    ).toBe(false);
  });

  it("probes when the composer is focused", () => {
    expect(
      shouldProbeComposerLiveDom({
        visibilityState: "visible",
        composerActive: true,
        selectionInComposer: false,
      }),
    ).toBe(true);
  });

  it("probes when the caret is inside the composer", () => {
    expect(
      shouldProbeComposerLiveDom({
        visibilityState: "visible",
        composerActive: false,
        selectionInComposer: true,
      }),
    ).toBe(true);
  });

  it("skips when selecting outside the composer (transcript drag)", () => {
    expect(
      shouldProbeComposerLiveDom({
        visibilityState: "visible",
        composerActive: false,
        selectionInComposer: false,
      }),
    ).toBe(false);
  });
});
