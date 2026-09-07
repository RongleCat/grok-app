/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  ComposerQuoteCards,
  UserQuoteCards,
} from "./ComposerQuoteCards";
import {
  appendQuotesToContent,
  parseQuotesFromContent,
  type ComposerQuote,
} from "@/lib/composerQuotes";

afterEach(() => {
  cleanup();
});

const quote = (
  text: string,
  comment = "",
  id = "q1",
): ComposerQuote => ({ id, text, comment });

describe("UserQuoteCards", () => {
  it("shows excerpt and comment inline instead of a notes chip", () => {
    render(
      <UserQuoteCards
        quotes={[quote("const x = 1", "why is this unused?")]}
        listLabel="Quoted excerpts"
      />,
    );
    expect(screen.getByText("const x = 1")).toBeInTheDocument();
    expect(screen.getByText("why is this unused?")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/notes/i)).not.toBeInTheDocument();
  });

  it("omits the comment row when the note is empty", () => {
    render(
      <UserQuoteCards
        quotes={[quote("selected line")]}
        listLabel="Quoted excerpts"
      />,
    );
    expect(screen.getByText("selected line")).toBeInTheDocument();
    expect(document.querySelector(".user-quote__note")).toBeNull();
  });

  it("renders every quote without collapsing to a count", () => {
    render(
      <UserQuoteCards
        quotes={[
          quote("first excerpt", "first comment", "q1"),
          quote("second excerpt", "second comment", "q2"),
        ]}
        listLabel="Quoted excerpts"
      />,
    );
    expect(screen.getByText("first excerpt")).toBeInTheDocument();
    expect(screen.getByText("first comment")).toBeInTheDocument();
    expect(screen.getByText("second excerpt")).toBeInTheDocument();
    expect(screen.getByText("second comment")).toBeInTheDocument();
  });

  it("renders journal fences as a visible excerpt and comment", () => {
    const encoded = appendQuotesToContent("please fix this", [
      quote("const x = 1", "why is this unused?"),
    ]);
    const parsed = parseQuotesFromContent(encoded);
    render(
      <UserQuoteCards quotes={parsed.quotes} listLabel="Quoted excerpts" />,
    );
    expect(screen.getByText("const x = 1")).toBeInTheDocument();
    expect(screen.getByText("why is this unused?")).toBeInTheDocument();
    expect(screen.queryByText("please fix this")).not.toBeInTheDocument();
  });

  it("highlights find hits in both excerpt and comment", () => {
    render(
      <UserQuoteCards
        quotes={[quote("unused variable", "please delete unused")]}
        listLabel="Quoted excerpts"
        findQuery="unused"
      />,
    );
    const hits = document.querySelectorAll("mark.chat-find-mark");
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe("ComposerQuoteCards", () => {
  it("keeps the compact count chip beside the draft", () => {
    render(
      <ComposerQuoteCards
        quotes={[quote("const x = 1", "why is this unused?")]}
        onCommentChange={() => {}}
        onRemove={() => {}}
        labels={{
          list: "Quoted excerpts",
          count: "1 notes",
          remove: "Remove quote",
          commentPlaceholder: "Comment on this excerpt…",
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "1 notes" })).toBeInTheDocument();
    expect(screen.queryByText("why is this unused?")).not.toBeInTheDocument();
  });
});
