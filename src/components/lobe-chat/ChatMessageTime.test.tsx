import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { ChatMessageTime } from "./ChatMessageTime";

describe("ChatMessageTime", () => {
  const createdAt = "2026-01-15T12:00:00.000Z";

  it("renders absolute label", () => {
    const html = renderToString(
      React.createElement(ChatMessageTime, {
        createdAt,
        locale: "en",
        format: "absolute",
      }),
    );
    expect(html).toContain("lobe-chat-action-time");
    expect(html.length).toBeGreaterThan(20);
  });

  it("renders relative label", () => {
    const html = renderToString(
      React.createElement(ChatMessageTime, {
        createdAt,
        locale: "en",
        format: "relative",
      }),
    );
    expect(html).toContain("lobe-chat-action-time");
  });

  it("renders nothing when format is off", () => {
    const html = renderToString(
      React.createElement(ChatMessageTime, {
        createdAt,
        locale: "en",
        format: "off",
      }),
    );
    expect(html).toBe("");
  });

  it("renders nothing without createdAt", () => {
    const html = renderToString(
      React.createElement(ChatMessageTime, {
        createdAt: undefined,
        locale: "zh",
        format: "absolute",
      }),
    );
    expect(html).toBe("");
  });
});
