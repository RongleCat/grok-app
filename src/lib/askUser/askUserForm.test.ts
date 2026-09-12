import { describe, expect, it } from "vitest";
import type { AskUserQuestionItem } from "../session";
import {
  askUserBarHeading,
  askUserBuildAnswers,
  askUserCanSubmit,
  askUserPendingPreview,
  askUserQuestionKey,
  askUserShowFreeHint,
  askUserVisibleDescription,
} from "./askUserForm";

const q = (
  partial: Partial<AskUserQuestionItem> & { question: string },
): AskUserQuestionItem => ({
  id: partial.id ?? "",
  options: partial.options ?? [],
  multiSelect: partial.multiSelect,
  question: partial.question,
});

describe("askUserQuestionKey", () => {
  it("prefers the question text, then id, then index", () => {
    expect(askUserQuestionKey(q({ question: " Goal? " }), 0)).toBe("Goal?");
    expect(askUserQuestionKey(q({ id: "q1", question: "  " }), 3)).toBe("q1");
    expect(askUserQuestionKey(q({ question: "" }), 2)).toBe("2");
  });
});

describe("askUserCanSubmit", () => {
  const choice = q({
    question: "Pick",
    options: [{ id: "a", label: "A" }],
  });

  it("needs a selection or free text for every question", () => {
    expect(askUserCanSubmit([choice], {}, {})).toBe(false);
    expect(askUserCanSubmit([choice], { Pick: ["a"] }, {})).toBe(true);
    expect(askUserCanSubmit([choice], {}, { Pick: " other " })).toBe(true);
  });
});

describe("askUserBuildAnswers", () => {
  it("joins selected labels and prefers free text", () => {
    const multi = q({
      question: "Which",
      multiSelect: true,
      options: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
      ],
    });
    expect(
      askUserBuildAnswers([multi], { Which: ["a", "b"] }, {}),
    ).toEqual({ Which: "Alpha, Beta" });
    expect(
      askUserBuildAnswers([multi], { Which: ["a"] }, { Which: "custom" }),
    ).toEqual({ Which: "custom" });
  });
});

describe("askUserVisibleDescription", () => {
  it("drops empty or label-echo descriptions", () => {
    expect(askUserVisibleDescription("Yes", "Yes")).toBeNull();
    expect(askUserVisibleDescription("Yes", "  yes  ")).toBeNull();
    expect(askUserVisibleDescription("Yes", "")).toBeNull();
    expect(askUserVisibleDescription("Yes", "Keep going")).toBe("Keep going");
  });
});

describe("askUserShowFreeHint", () => {
  it("hides a hint that duplicates the placeholder", () => {
    expect(askUserShowFreeHint("Type your answer…", "Type your answer…")).toBe(
      false,
    );
    expect(
      askUserShowFreeHint("Or type a custom answer", "Type your answer…"),
    ).toBe(true);
  });
});

describe("askUserBarHeading", () => {
  it("uses the lone question as the title", () => {
    expect(
      askUserBarHeading([{ question: "Continue?" }], "Agent question"),
    ).toBe("Continue?");
  });

  it("keeps the fallback when there are several questions", () => {
    expect(
      askUserBarHeading(
        [{ question: "A?" }, { question: "B?" }],
        "Agent question",
      ),
    ).toBe("Agent question");
  });
});

describe("askUserPendingPreview", () => {
  it("returns the first question, clipped for the collapsed chip", () => {
    expect(askUserPendingPreview([{ question: "OK?" } as AskUserQuestionItem])).toBe(
      "OK?",
    );
    const long = "x".repeat(80);
    const preview = askUserPendingPreview([
      { question: long } as AskUserQuestionItem,
    ]);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(43);
  });
});
