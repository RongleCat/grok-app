import { describe, expect, it } from "vitest";
import {
  addSavedPrompt,
  buildHubRows,
  hubTone,
  magneticOffset,
  moveHubSelection,
  parseSavedPrompts,
  removeSavedPrompt,
  SAVED_PROMPTS_MAX,
} from "./petQuickHub";

const r = (id: string, title: string, pinned = false, updatedAt = 1, project = "") => ({
  id, title, project, pinned, updatedAt,
});

describe("buildHubRows", () => {
  const recents = [r("a", "Fatura düzeltme", false, 3), r("b", "İstanbul notları", true, 1), r("c", "Deploy", false, 2)];
  it("splits pinned and merges live state, approvals first", () => {
    const out = buildHubRows(recents, [{ sessionId: "c", kind: "needs_you", phase: "active", snippet: "run npm?" }], "");
    expect(out.pinned.map((x) => x.id)).toEqual(["b"]);
    expect(out.recent.map((x) => x.id)).toEqual(["c", "a"]);
    expect(out.recent[0]).toMatchObject({ tone: "attention", snippet: "run npm?" });
  });
  it("searches accent/case-insensitively (Turkish)", () => {
    expect(buildHubRows(recents, [], "istanbul").pinned.map((x) => x.id)).toEqual(["b"]);
    expect(buildHubRows(recents, [], "FATURA").recent.map((x) => x.id)).toEqual(["a"]);
    expect(buildHubRows(recents, [], "zzz").recent).toEqual([]);
  });
});

describe("hubTone", () => {
  it("maps kinds and finished tasks", () => {
    expect(hubTone("working")).toBe("busy");
    expect(hubTone("needs_you")).toBe("attention");
    expect(hubTone("working", "done")).toBe("done");
    expect(hubTone("error", "done")).toBe("error");
    expect(hubTone(undefined)).toBe("idle");
  });
});

describe("moveHubSelection", () => {
  it("wraps and enters from the prompt", () => {
    expect(moveHubSelection(-1, 1, 3)).toBe(0);
    expect(moveHubSelection(-1, -1, 3)).toBe(2);
    expect(moveHubSelection(2, 1, 3)).toBe(0);
    expect(moveHubSelection(0, -1, 3)).toBe(2);
    expect(moveHubSelection(0, 1, 0)).toBe(-1);
  });
});

describe("saved prompts", () => {
  it("dedupes, caps and removes", () => {
    let l = addSavedPrompt([], " özetle ");
    l = addSavedPrompt(l, "test yaz");
    l = addSavedPrompt(l, "özetle");
    expect(l).toEqual(["özetle", "test yaz"]);
    expect(removeSavedPrompt(l, "özetle")).toEqual(["test yaz"]);
    let big: string[] = [];
    for (let i = 0; i < 20; i++) big = addSavedPrompt(big, `p${i}`);
    expect(big).toHaveLength(SAVED_PROMPTS_MAX);
  });
  it("parses storage defensively", () => {
    expect(parseSavedPrompts(null)).toEqual([]);
    expect(parseSavedPrompts("{bad")).toEqual([]);
    expect(parseSavedPrompts('["a", 3, ""]')).toEqual(["a"]);
  });
});

describe("magneticOffset", () => {
  it("pulls toward the pointer and caps", () => {
    const rect = { left: 0, top: 0, width: 20, height: 20 };
    expect(magneticOffset(10, 10, rect)).toEqual([0, 0]);
    expect(magneticOffset(14, 10, rect)).toEqual([1, 0]);
    expect(magneticOffset(100, -100, rect)).toEqual([4, -4]);
  });
});
