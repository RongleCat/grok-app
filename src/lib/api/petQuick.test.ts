import { describe, expect, it } from "vitest";
import { normalizePetHotkey, parsePetQuickPrompt } from "./petQuick";
import { isPetQuickHash, isPetShellHash } from "@/lib/pet/petShell";
import { petQuickBadge } from "@/components/pet/PetQuickApp";

describe("pet quick bar", () => {
  it("normalizes typed hotkeys to Tauri accelerators", () => {
    expect(normalizePetHotkey("alt + win + p")).toBe("Alt+Super+P");
    expect(normalizePetHotkey("ctrl+shift+space")).toBe("Control+Shift+space");
    expect(normalizePetHotkey("  ")).toBe("");
  });

  it("parses quick-prompt payloads defensively", () => {
    expect(parsePetQuickPrompt({ sessionId: " s1 ", text: " hi " })).toEqual({
      sessionId: "s1",
      text: "hi",
    });
    expect(parsePetQuickPrompt({ sessionId: "", text: "x" })).toEqual({
      sessionId: null,
      text: "x",
    });
    expect(parsePetQuickPrompt({ text: "   " })).toBeNull();
    expect(parsePetQuickPrompt(null)).toBeNull();
  });

  it("keeps the quick-bar hash apart from the pet overlay hash", () => {
    expect(isPetQuickHash("#/pet-quick")).toBe(true);
    expect(isPetShellHash("#/pet-quick")).toBe(false);
    expect(isPetQuickHash("#/pet")).toBe(false);
  });

  it("maps pet focus kinds to badge states", () => {
    expect(petQuickBadge("working").key).toBe("pet.quick.state.thinking");
    expect(petQuickBadge("needs_you").tone).toBe("attention");
    expect(petQuickBadge("ready").tone).toBe("done");
    expect(petQuickBadge(null).tone).toBe("idle");
  });
});
