import { describe, expect, it } from "vitest";
import { nextSessionTitle } from "@/lib/sidebarSessionRename";

describe("nextSessionTitle", () => {
  it("returns the trimmed draft when it changed", () => {
    expect(nextSessionTitle("  Hello  ", "Untitled")).toBe("Hello");
  });

  it("returns null for empty or whitespace", () => {
    expect(nextSessionTitle("", "Chat")).toBeNull();
    expect(nextSessionTitle("   ", "Chat")).toBeNull();
  });

  it("returns null when unchanged after trim", () => {
    expect(nextSessionTitle("Chat", "Chat")).toBeNull();
    expect(nextSessionTitle("  Chat  ", "Chat")).toBeNull();
    expect(nextSessionTitle("Untitled", "Untitled")).toBeNull();
  });
});
