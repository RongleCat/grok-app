import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ConversationThread,
  findForceStickMessageId,
} from "./ConversationThread";

const attachLabels = {
  open: "Open",
  reveal: "Reveal",
  copyPath: "Copy path",
  copyImage: "Copy image",
  addToComposer: "Add",
  remove: "Remove",
};

describe("ConversationThread force-stick key", () => {
  it("intentionally re-pins when a Steer interjection is appended", () => {
    expect(
      findForceStickMessageId([
        { id: "u1", role: "user", content: "Build a form" },
        { id: "a1", role: "assistant", content: "Starting" },
        {
          id: "i1",
          role: "user",
          content: "Use existing components",
          marker: "interjection",
        },
      ]),
    ).toBe("i1");
  });
});

describe("ConversationThread interjection marker", () => {
  it("renders a Steer label on mid-turn user interjections", () => {
    const html = renderToString(
      React.createElement(ConversationThread, {
        locale: "en",
        sessionState: "streaming",
        sessionKey: "session-1",
        messages: [
          { id: "u1", role: "user", content: "Build a form" },
          {
            id: "i1",
            role: "user",
            content: "Use existing components",
            marker: "interjection",
          },
        ],
        attachLabels,
      }),
    );

    expect(html).toContain('data-message-marker="interjection"');
    expect(html).toContain("lobe-chat-bubble--interjection");
    expect(html).toContain("lobe-chat-interjection-tag");
    expect(html).toContain(">Steer</span>");
  });
});
