import { describe, expect, it } from "vitest";
import { DIRECTOR_RULE, directorChildModelRejected, wrapDirectorSend } from "./directorMode";

describe("wrapDirectorSend", () => {
  it("leaves the text alone when director mode and chips are off", () => {
    expect(
      wrapDirectorSend({
        userText: "  hello  ",
        directorOn: false,
        inheritanceOn: false,
      }),
    ).toBe("  hello  ");
  });

  it("prepends the director rule without a child model", () => {
    const wrapped = wrapDirectorSend({
      userText: "Ship the drawer",
      directorOn: true,
      inheritanceOn: false,
    });
    expect(wrapped.startsWith(DIRECTOR_RULE)).toBe(true);
    expect(wrapped).toContain("User request:\nShip the drawer");
    expect(wrapped).not.toContain("Child model:");
  });

  it("puts the child model in a review brief", () => {
    const wrapped = wrapDirectorSend({
      userText: "Look at the decoder",
      directorOn: false,
      intent: "review",
      childModel: "grok-4.6-build",
      inheritanceOn: false,
    });
    expect(wrapped).toContain("Review this in the background");
    expect(wrapped).toContain("Child model: grok-4.6-build");
  });

  it("tells the model the CLI will reject a per-child model when inheritance is on", () => {
    const wrapped = wrapDirectorSend({
      userText: "Fan the fixes",
      directorOn: true,
      intent: "fanout",
      childModel: "grok-4.6-build",
      inheritanceOn: true,
    });
    expect(wrapped).toContain("isolation worktree");
    expect(wrapped).toContain("The CLI will reject a per-child model");
    expect(wrapped).not.toContain("Child model: grok-4.6-build");
    expect(directorChildModelRejected(true, "grok-4.6-build")).toBe(true);
    expect(directorChildModelRejected(false, "grok-4.6-build")).toBe(false);
    expect(directorChildModelRejected(true, "  ")).toBe(false);
  });
});
