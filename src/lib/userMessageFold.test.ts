import { describe, expect, it } from "vitest";
import {
  previewUserMessageText,
  shouldFoldUserMessage,
  USER_MSG_FOLD_MAX_CHARS,
} from "./userMessageFold";

describe("userMessageFold", () => {
  it("does not fold short user text", () => {
    expect(shouldFoldUserMessage("Hello world")).toBe(false);
    expect(shouldFoldUserMessage("Line 1\nLine 2\nLine 3")).toBe(false);
  });

  it("folds text exceeding character threshold", () => {
    const longText = "a".repeat(USER_MSG_FOLD_MAX_CHARS + 10);
    expect(shouldFoldUserMessage(longText)).toBe(true);
  });

  it("folds text exceeding line count threshold", () => {
    const manyLines = Array.from({ length: 15 }, (_, i) => `Line ${i}`).join("\n");
    expect(shouldFoldUserMessage(manyLines)).toBe(true);
  });

  it("generates preview text correctly", () => {
    const manyLines = Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n");
    const preview = previewUserMessageText(manyLines);
    expect(preview).toContain("Line 0");
    expect(preview).toContain("Line 5");
    expect(preview).not.toContain("Line 15");
    expect(preview.endsWith("…")).toBe(true);
  });
});
