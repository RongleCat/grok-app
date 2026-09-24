import { describe, expect, it } from "vitest";
import {
  loadComposerProjectDraft,
  type ComposerProjectDraftStorage,
} from "./composerProjectDraft";
import {
  loadComposerSessionDraft,
  saveComposerSessionDraft,
  type ComposerSessionDraftStorage,
} from "./composerSessionDraft";
import {
  parkDictationTranscript,
  sameDictationTarget,
  type DictationTarget,
} from "./voiceDictationDelivery";

function memoryStorage<T>(seed: Record<string, string> = {}): T {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  } as T;
}

const chatA: DictationTarget = { sessionId: "a", projectKey: "proj-1" };
const chatB: DictationTarget = { sessionId: "b", projectKey: "proj-1" };
const draftP1: DictationTarget = { sessionId: null, projectKey: "proj-1" };
const draftP2: DictationTarget = { sessionId: null, projectKey: "proj-2" };

describe("sameDictationTarget", () => {
  it("matches identical buffers only", () => {
    expect(sameDictationTarget(chatA, { ...chatA })).toBe(true);
    expect(sameDictationTarget(chatA, chatB)).toBe(false);
    // Two new-chat pages of different projects are different buffers.
    expect(sameDictationTarget(draftP1, draftP2)).toBe(false);
    expect(sameDictationTarget(draftP1, { ...draftP1 })).toBe(true);
    // Chat vs new-chat page never share a buffer.
    expect(sameDictationTarget(chatA, draftP1)).toBe(false);
  });
});

describe("parkDictationTranscript", () => {
  it("writes the transcript into the origin session draft", () => {
    const storage = memoryStorage<ComposerSessionDraftStorage>();
    const parked = parkDictationTranscript({
      target: chatA,
      transcript: "hello from mic",
      caret: null,
      sessionStorage: storage,
    });
    expect(parked?.text).toBe("hello from mic");
    expect(loadComposerSessionDraft("a", storage)?.text).toBe(
      "hello from mic",
    );
    // The chat the user switched to stays untouched.
    expect(loadComposerSessionDraft("b", storage)).toBeNull();
  });

  it("merges at the captured caret and preserves draft fields", () => {
    const storage = memoryStorage<ComposerSessionDraftStorage>();
    saveComposerSessionDraft(
      "a",
      {
        text: "start end",
        attachments: [{ path: "/tmp/f.ts", name: "f.ts", isDir: false }],
        goalMode: true,
      },
      storage,
    );
    const parked = parkDictationTranscript({
      target: chatA,
      transcript: "middle",
      caret: 6,
      sessionStorage: storage,
    });
    expect(parked?.text).toBe("start middle end");
    expect(parked?.goalMode).toBe(true);
    const saved = loadComposerSessionDraft("a", storage);
    expect(saved?.text).toBe("start middle end");
    expect(saved?.attachments).toHaveLength(1);
    expect(saved?.goalMode).toBe(true);
  });

  it("targets the project draft when the mic stopped on a new-chat page", () => {
    const projectStorage = memoryStorage<ComposerProjectDraftStorage>();
    const parked = parkDictationTranscript({
      target: draftP1,
      transcript: "into the draft page",
      caret: null,
      projectStorage,
    });
    expect(parked?.text).toBe("into the draft page");
    expect(loadComposerProjectDraft("proj-1", projectStorage)?.text).toBe(
      "into the draft page",
    );
    expect(loadComposerProjectDraft("proj-2", projectStorage)).toBeNull();
  });

  it("returns null on a blank transcript without touching storage", () => {
    const storage = memoryStorage<ComposerSessionDraftStorage>();
    expect(
      parkDictationTranscript({
        target: chatA,
        transcript: "   ",
        caret: null,
        sessionStorage: storage,
      }),
    ).toBeNull();
    expect(loadComposerSessionDraft("a", storage)).toBeNull();
  });
});
