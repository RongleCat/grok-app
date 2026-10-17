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

describe("pet window commands stay off the main thread", () => {
  it("window-creating commands are async (WebView2 main-thread deadlock)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(__dirname, "../../../src-tauri/src");
    const quick = readFileSync(join(root, "pet_quick.rs"), "utf8");
    const pet = readFileSync(join(root, "pet_window.rs"), "utf8");
    for (const f of ["pet_quick_show", "pet_quick_toggle", "pet_quick_send", "pet_quick_hide"]) {
      expect(quick).toContain(`pub async fn ${f}(`);
    }
    for (const f of ["pet_show", "pet_toggle", "pet_prefs_set"]) {
      expect(pet).toContain(`pub async fn ${f}(`);
    }
    // Hotkey callback hands window work to the async runtime.
    expect(quick).toMatch(/async_runtime::spawn\(async move \{\s*let _ = toggle_quick/);
  });
});
