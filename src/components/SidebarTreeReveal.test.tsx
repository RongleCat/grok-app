import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import { SidebarTreeReveal } from "@/components/SidebarTreeReveal";

describe("SidebarTreeReveal", () => {
  it("paints already-open sections without a closed first frame", () => {
    const html = renderToString(
      React.createElement(SidebarTreeReveal, {
        open: true,
        children: React.createElement(
          "div",
          { className: "tree-l3-list-wrap" },
          "chats",
        ),
      }),
    );
    expect(html).toContain("tree-reveal is-open");
    expect(html).toContain("chats");
    expect(html).not.toContain("aria-hidden");
  });

  it("renders nothing when the section starts closed", () => {
    const html = renderToString(
      React.createElement(SidebarTreeReveal, {
        open: false,
        children: React.createElement("div", null, "chats"),
      }),
    );
    expect(html).toBe("");
  });
});
