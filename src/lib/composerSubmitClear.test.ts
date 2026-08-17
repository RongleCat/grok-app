import { describe, expect, it } from "vitest";
import {
  nextComposerSubmitSettlement,
  shouldClearComposerAfterSubmit,
  shouldClearMatchingProjectDraft,
  shouldClearProjectDraftAfterNewChatSend,
} from "./composerSubmitClear";

const file = { path: "/tmp/a.txt" };

describe("shouldClearComposerAfterSubmit", () => {
  it("clears when draft and attachments are unchanged", () => {
    expect(
      shouldClearComposerAfterSubmit({
        sentText: "hello",
        sentAttachments: [file],
        currentText: "hello",
        currentAttachments: [file],
      }),
    ).toBe(true);
  });

  it("keeps composer when the user typed during send", () => {
    expect(
      shouldClearComposerAfterSubmit({
        sentText: "hello",
        sentAttachments: [],
        currentText: "hello\nand more",
        currentAttachments: [],
      }),
    ).toBe(false);
  });

  it("keeps composer when attachments changed during send", () => {
    expect(
      shouldClearComposerAfterSubmit({
        sentText: "hello",
        sentAttachments: [file],
        currentText: "hello",
        currentAttachments: [file, { path: "/tmp/b.png" }],
      }),
    ).toBe(false);
    expect(
      shouldClearComposerAfterSubmit({
        sentText: "hello",
        sentAttachments: [file],
        currentText: "hello",
        currentAttachments: [],
      }),
    ).toBe(false);
  });

  it("clears an empty follow-up that still matches the sent empty attachments", () => {
    expect(
      shouldClearComposerAfterSubmit({
        sentText: "hello",
        sentAttachments: [],
        currentText: "hello",
        currentAttachments: [],
      }),
    ).toBe(true);
  });
});

describe("nextComposerSubmitSettlement", () => {
  it("persists-clears after success when the composer was already optimistic-cleared", () => {
    expect(
      nextComposerSubmitSettlement({
        sendSucceeded: true,
        sentText: "hello",
        sentAttachments: [file],
        currentText: "",
        currentAttachments: [],
      }),
    ).toBe("persist-clear");
  });

  it("restores the sent payload after failure when the composer is still empty", () => {
    expect(
      nextComposerSubmitSettlement({
        sendSucceeded: false,
        sentText: "hello",
        sentAttachments: [file],
        currentText: "",
        currentAttachments: [],
      }),
    ).toBe("restore");
  });

  it("restores when React has not flushed the optimistic clear yet", () => {
    expect(
      nextComposerSubmitSettlement({
        sendSucceeded: false,
        sentText: "hello",
        sentAttachments: [file],
        currentText: "hello",
        currentAttachments: [file],
      }),
    ).toBe("restore");
  });

  it("leaves follow-up text typed during a slow send", () => {
    expect(
      nextComposerSubmitSettlement({
        sendSucceeded: true,
        sentText: "hello",
        sentAttachments: [],
        currentText: "next turn",
        currentAttachments: [],
      }),
    ).toBe("leave");
    expect(
      nextComposerSubmitSettlement({
        sendSucceeded: false,
        sentText: "hello",
        sentAttachments: [],
        currentText: "next turn",
        currentAttachments: [],
      }),
    ).toBe("leave");
  });

  it("leaves follow-up attachments added during a slow send", () => {
    expect(
      nextComposerSubmitSettlement({
        sendSucceeded: true,
        sentText: "hello",
        sentAttachments: [],
        currentText: "",
        currentAttachments: [file],
      }),
    ).toBe("leave");
  });

  it("leaves quotes added during a slow send", () => {
    const sentQuote = { id: "q1", text: "old", comment: "" };
    const added = { id: "q2", text: "new excerpt", comment: "note" };
    expect(
      nextComposerSubmitSettlement({
        sendSucceeded: false,
        sentText: "hello",
        sentAttachments: [],
        sentQuotes: [sentQuote],
        currentText: "",
        currentAttachments: [],
        currentQuotes: [added],
      }),
    ).toBe("leave");
    expect(
      nextComposerSubmitSettlement({
        sendSucceeded: true,
        sentText: "hello",
        sentAttachments: [],
        sentQuotes: [],
        currentText: "",
        currentAttachments: [],
        currentQuotes: [added],
      }),
    ).toBe("leave");
  });

  it("restores when quotes are unchanged after a failed send", () => {
    const q = { id: "q1", text: "excerpt", comment: "" };
    expect(
      nextComposerSubmitSettlement({
        sendSucceeded: false,
        sentText: "hello",
        sentAttachments: [],
        sentQuotes: [q],
        currentText: "hello",
        currentAttachments: [],
        currentQuotes: [q],
      }),
    ).toBe("restore");
  });
});

describe("shouldClearProjectDraftAfterNewChatSend", () => {
  it("wipes the new-session buffer after a successful draft send", () => {
    expect(
      shouldClearProjectDraftAfterNewChatSend({
        fromNewChatPage: true,
        sendSucceeded: true,
      }),
    ).toBe(true);
  });

  it("keeps the new-session buffer when the draft send fails", () => {
    expect(
      shouldClearProjectDraftAfterNewChatSend({
        fromNewChatPage: true,
        sendSucceeded: false,
      }),
    ).toBe(false);
  });

  it("does not touch the project buffer on an existing-thread send", () => {
    expect(
      shouldClearProjectDraftAfterNewChatSend({
        fromNewChatPage: false,
        sendSucceeded: true,
      }),
    ).toBe(false);
  });
});

describe("shouldClearMatchingProjectDraft", () => {
  it("clears when the project buffer is exactly the prompt we just sent", () => {
    expect(
      shouldClearMatchingProjectDraft({
        projectDraftText: "hello",
        sentText: "hello",
      }),
    ).toBe(true);
  });

  it("keeps a different unsent new-task buffer", () => {
    expect(
      shouldClearMatchingProjectDraft({
        projectDraftText: "next task",
        sentText: "hello",
      }),
    ).toBe(false);
  });

  it("ignores empty sent text", () => {
    expect(
      shouldClearMatchingProjectDraft({
        projectDraftText: "hello",
        sentText: "",
      }),
    ).toBe(false);
  });

  it("keeps a same-text new-task buffer that still has extra attachments", () => {
    expect(
      shouldClearMatchingProjectDraft({
        projectDraftText: "hello",
        sentText: "hello",
        projectDraftAttachments: [{ path: "/keep.png" }],
        sentAttachments: [],
      }),
    ).toBe(false);
  });

  it("keeps a same-text new-task buffer that still has extra quotes", () => {
    expect(
      shouldClearMatchingProjectDraft({
        projectDraftText: "hello",
        sentText: "hello",
        projectDraftQuotes: [{ id: "q1", text: "excerpt", comment: "" }],
        sentQuotes: [],
      }),
    ).toBe(false);
  });

  it("clears when the leftover payload matches this send including extras", () => {
    const q = { id: "q1", text: "excerpt", comment: "" };
    expect(
      shouldClearMatchingProjectDraft({
        projectDraftText: "hello",
        sentText: "hello",
        projectDraftAttachments: [file],
        projectDraftQuotes: [q],
        sentAttachments: [file],
        sentQuotes: [q],
      }),
    ).toBe(true);
  });
});
