import { describe, expect, it } from "vitest";
import {
  buildHandoffBrief,
  collectHandoffFilePaths,
  handoffSessionTitle,
} from "./sessionHandoff";
import type { ChatMessage } from "./session";

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">,
): ChatMessage {
  return partial;
}

describe("session handoff brief", () => {
  it("titles a sibling task without stacking prefixes", () => {
    expect(handoffSessionTitle("Auth rewrite")).toBe("Task of Auth rewrite");
    expect(handoffSessionTitle("Task of Auth rewrite")).toBe(
      "Task of Auth rewrite",
    );
    expect(handoffSessionTitle("")).toBe("Task of chat");
  });

  it("builds a short brief instead of the full transcript", () => {
    const messages: ChatMessage[] = [
      msg({
        id: "u1",
        role: "user",
        content: "Set up login",
        attachments: [{ path: "/tmp/app/login.ts", name: "login.ts", isDir: false }],
      }),
      msg({ id: "a1", role: "assistant", content: "Added the login form." }),
      msg({ id: "u2", role: "user", content: "Now wire the session cookie." }),
      msg({
        id: "a2",
        role: "assistant",
        content: "Cookie is set in src/auth.ts.",
      }),
    ];
    const brief = buildHandoffBrief({
      title: "Auth rewrite",
      parentSessionId: "sess-parent",
      messages,
    });
    expect(brief).toContain("## Goal");
    expect(brief).toContain("Now wire the session cookie.");
    expect(brief).toContain("## Done");
    expect(brief).toContain("Cookie is set");
    expect(brief).toContain("## Leftover");
    expect(brief).toContain("Set up login");
    expect(brief).toContain("/tmp/app/login.ts");
    expect(brief).toContain("sess-parent");
    expect(brief).not.toContain("Set up login\nAdded the login form.\nNow wire");
    expect(collectHandoffFilePaths(messages)).toContain("/tmp/app/login.ts");
  });
});
