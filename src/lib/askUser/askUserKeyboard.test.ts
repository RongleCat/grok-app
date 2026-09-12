import { describe, expect, it } from "vitest";
import {
  isAskUserImeCommit,
  nextAskUserOptionIndex,
  shouldAskUserSubmitOnEnter,
} from "./askUserKeyboard";

describe("isAskUserImeCommit", () => {
  it("treats composition and keyCode 229 as IME commit", () => {
    expect(isAskUserImeCommit({ key: "Enter", isComposing: true })).toBe(true);
    expect(isAskUserImeCommit({ key: "Enter", keyCode: 229 })).toBe(true);
    expect(isAskUserImeCommit({ key: "Process" })).toBe(true);
    expect(isAskUserImeCommit({ key: "Enter" })).toBe(false);
  });
});

describe("shouldAskUserSubmitOnEnter", () => {
  it("submits on plain Enter", () => {
    expect(shouldAskUserSubmitOnEnter({ key: "Enter" })).toBe(true);
  });

  it("does not submit while the IME is committing a candidate", () => {
    expect(
      shouldAskUserSubmitOnEnter({ key: "Enter", isComposing: true }),
    ).toBe(false);
    expect(shouldAskUserSubmitOnEnter({ key: "Enter", keyCode: 229 })).toBe(
      false,
    );
  });

  it("does not submit Shift+Enter or modified Enter", () => {
    expect(shouldAskUserSubmitOnEnter({ key: "Enter", shiftKey: true })).toBe(
      false,
    );
    expect(shouldAskUserSubmitOnEnter({ key: "Enter", metaKey: true })).toBe(
      false,
    );
    expect(shouldAskUserSubmitOnEnter({ key: " " })).toBe(false);
  });
});

describe("nextAskUserOptionIndex", () => {
  it("wraps with arrows", () => {
    expect(nextAskUserOptionIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextAskUserOptionIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextAskUserOptionIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextAskUserOptionIndex(0, "Home", 4)).toBe(0);
    expect(nextAskUserOptionIndex(1, "End", 4)).toBe(3);
    expect(nextAskUserOptionIndex(0, "Enter", 3)).toBeNull();
  });
});
