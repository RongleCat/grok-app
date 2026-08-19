import { describe, expect, it } from "vitest";
import {
  applyPetStageStream,
  foldStageDelta,
  petStageSnippetFromText,
  petStageSnippetStore,
} from "./petStageSnippets";

describe("foldStageDelta", () => {
  it("appends deltas and accepts snapshots", () => {
    expect(foldStageDelta("", "Hello")).toBe("Hello");
    expect(foldStageDelta("Hello", " world")).toBe("Hello world");
    expect(foldStageDelta("Hello", "Hello world")).toBe("Hello world");
    expect(foldStageDelta("Hello world", "Hello")).toBe("Hello world");
    expect(foldStageDelta("Hello", "Hello")).toBe("Hello");
  });
});

describe("petStageSnippetFromText", () => {
  it("uses the latest paragraph and clips", () => {
    expect(petStageSnippetFromText("first\n\nsecond stage")).toBe("second stage");
    const long = "x".repeat(120);
    const got = petStageSnippetFromText(long);
    expect(got.endsWith("…")).toBe(true);
    expect(got.length).toBeLessThanOrEqual(97);
  });
});

describe("applyPetStageStream", () => {
  it("ignores thought and empty sessions", () => {
    expect(
      applyPetStageStream(undefined, {
        sessionId: "a",
        kind: "thought",
        text: "hmm",
      }),
    ).toBeNull();
    expect(
      applyPetStageStream(undefined, { sessionId: "", text: "hi", kind: "assistant" }),
    ).toBeNull();
  });

  it("starts a chip only after assistant body text", () => {
    const row = applyPetStageStream(
      undefined,
      { sessionId: "a", kind: "assistant", text: "I'll check the file." },
      100,
      1_000,
    );
    expect(row?.snippet).toBe("I'll check the file.");
    expect(row?.turnKey).toBe(100);
  });

  it("treats a new message id as a new stage", () => {
    const first = applyPetStageStream(
      undefined,
      { sessionId: "a", messageId: "m1", text: "Looking around." },
      1,
      10,
    );
    const second = applyPetStageStream(
      first ?? undefined,
      { sessionId: "a", messageId: "m2", text: "Found it." },
      1,
      20,
    );
    expect(second?.snippet).toBe("Found it.");
  });

  it("resets on a newer turn", () => {
    const first = applyPetStageStream(
      undefined,
      { sessionId: "a", messageId: "m1", text: "Old turn" },
      1,
      10,
    );
    const next = applyPetStageStream(
      first ?? undefined,
      { sessionId: "a", messageId: "m2", text: "New turn" },
      9,
      20,
    );
    expect(next?.snippet).toBe("New turn");
    expect(next?.turnKey).toBe(9);
  });
});

describe("petStageSnippetStore", () => {
  it("drops a snippet when a newer turn has started", () => {
    petStageSnippetStore.resetForTests();
    petStageSnippetStore.applyStream(
      { sessionId: "a", text: "Old stage" },
      10,
      100,
    );
    expect(petStageSnippetStore.pruneStale("a", 10)).toBe(false);
    expect(petStageSnippetStore.pruneStale("a", 20)).toBe(true);
    expect(petStageSnippetStore.get("a")).toBe("");
    petStageSnippetStore.resetForTests();
  });

  it("keeps sessions independent", () => {
    petStageSnippetStore.resetForTests();
    expect(
      petStageSnippetStore.applyStream(
        { sessionId: "a", text: "Alpha stage" },
        1,
        10,
      ),
    ).toBe(true);
    expect(
      petStageSnippetStore.applyStream(
        { sessionId: "b", text: "Beta stage" },
        2,
        11,
      ),
    ).toBe(true);
    expect(petStageSnippetStore.getMap()).toEqual({
      a: "Alpha stage",
      b: "Beta stage",
    });
    petStageSnippetStore.resetForTests();
  });
});
