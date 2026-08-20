import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_PASTE_MAX_BYTES,
  attachErrorMessageKey,
  attachErrorSilent,
  attachPreviewMessageKey,
  classifyAttachError,
  deriveAttachPreviewPhase,
  formatAttachErrorMessage,
  isAttachPayloadTooLarge,
  isEmptyAttachFileList,
  resolveAttachError,
  resolveAttachSavedToast,
  resolveHostOnlyAttach,
  resolveNativeClipboardEmpty,
} from "./attachmentsPro";

describe("classifyAttachError", () => {
  it("classifies host empty / size / base64 / write messages", () => {
    expect(classifyAttachError("empty attachment payload")).toBe("empty");
    expect(classifyAttachError("attachment too large (max 40 MiB)")).toBe(
      "too_large",
    );
    expect(classifyAttachError("invalid base64: bad end")).toBe(
      "invalid_payload",
    );
    expect(classifyAttachError("write attachment: No space left")).toBe(
      "write_failed",
    );
  });

  it("classifies clipboard host errors", () => {
    expect(classifyAttachError("clipboard open: Access denied")).toBe(
      "clipboard_open",
    );
    expect(classifyAttachError("clipboard image: ContentNotAvailable")).toBe(
      "clipboard_image",
    );
    expect(
      classifyAttachError("clipboard image truncated (4 < 16)"),
    ).toBe("clipboard_image");
  });

  it("classifies cancelled and unsupported codes", () => {
    expect(classifyAttachError({ code: "cancelled" })).toBe("cancelled");
    expect(classifyAttachError({ code: "UNSUPPORTED" })).toBe("unsupported");
    expect(classifyAttachError("User cancelled the dialog")).toBe("cancelled");
  });

  it("classifies empty clipboard / no media", () => {
    expect(classifyAttachError("no image on clipboard")).toBe("no_media");
    expect(classifyAttachError({ code: "no_media" })).toBe("no_media");
  });

  it("classifies host-only / open / preview", () => {
    expect(classifyAttachError("need tauri")).toBe("host_only");
    expect(classifyAttachError("failed to open path")).toBe("open_failed");
    expect(classifyAttachError("failed to load file (404)")).toBe(
      "preview_failed",
    );
  });

  it("falls back to other for unknown text", () => {
    expect(classifyAttachError("something weird happened")).toBe("other");
    expect(classifyAttachError(null)).toBe("other");
  });

  it("classifies WebView NotReadableError as unreadable", () => {
    expect(
      classifyAttachError(
        "The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired. NotReadableError",
      ),
    ).toBe("unreadable");
    expect(classifyAttachError({ code: "unreadable" })).toBe("unreadable");
    expect(attachErrorMessageKey("unreadable", "paste")).toBe(
      "attach.err.unreadable",
    );
  });
});

describe("attachErrorMessageKey / silent", () => {
  it("maps kinds to stable keys", () => {
    expect(attachErrorMessageKey("too_large")).toBe("attach.err.tooLarge");
    expect(attachErrorMessageKey("dropped_none")).toBe("attach.droppedNone");
    expect(attachErrorMessageKey("unsupported")).toBe("mirror.unsupported");
    expect(attachErrorMessageKey("other", "paste")).toBe(
      "composer.attachPasteFailed",
    );
    expect(attachErrorMessageKey("other", "pick")).toBe(
      "composer.attachPickedNone",
    );
  });

  it("only cancelled is silent", () => {
    expect(attachErrorSilent("cancelled")).toBe(true);
    expect(attachErrorSilent("too_large")).toBe(false);
    expect(attachErrorSilent("no_media")).toBe(false);
  });
});

describe("resolveAttachError", () => {
  it("returns classified key + silent cancel", () => {
    const r = resolveAttachError("attachment too large (max 40 MiB)", "paste");
    expect(r.kind).toBe("too_large");
    expect(r.messageKey).toBe("attach.err.tooLarge");
    expect(r.silent).toBe(false);
    expect(r.detail).toBe("");
  });

  it("keeps short detail only for other", () => {
    const r = resolveAttachError("weird host code 42", "paste");
    expect(r.kind).toBe("other");
    expect(r.messageKey).toBe("composer.attachPasteFailed");
    expect(r.detail).toContain("weird");
  });

  it("silent on cancel", () => {
    const r = resolveAttachError({ code: "cancelled" }, "pick");
    expect(r.silent).toBe(true);
  });
});

describe("resolveNativeClipboardEmpty", () => {
  it("errors when media was expected", () => {
    const r = resolveNativeClipboardEmpty({ expectMedia: true });
    expect(r.kind).toBe("no_media");
    expect(r.silent).toBe(false);
    expect(r.messageKey).toBe("attach.err.noMedia");
  });

  it("stays silent on soft empty try", () => {
    const r = resolveNativeClipboardEmpty({ expectMedia: false });
    expect(r.silent).toBe(true);
  });
});

describe("resolveHostOnlyAttach", () => {
  it("never silent", () => {
    const r = resolveHostOnlyAttach("paste");
    expect(r.kind).toBe("host_only");
    expect(r.silent).toBe(false);
    expect(r.messageKey).toBe("attach.err.hostOnly");
  });
});

describe("deriveAttachPreviewPhase", () => {
  it("idle for non-image / dirs", () => {
    expect(
      deriveAttachPreviewPhase({
        isImage: false,
        hasSrc: false,
      }),
    ).toBe("idle");
    expect(
      deriveAttachPreviewPhase({
        isImage: true,
        hasSrc: true,
        isDir: true,
      }),
    ).toBe("idle");
  });

  it("missing when exists is false", () => {
    expect(
      deriveAttachPreviewPhase({
        isImage: true,
        hasSrc: false,
        exists: false,
      }),
    ).toBe("missing");
  });

  it("broken after loadFailed (even if src remains)", () => {
    expect(
      deriveAttachPreviewPhase({
        isImage: true,
        hasSrc: true,
        loadFailed: true,
      }),
    ).toBe("broken");
  });

  it("ready only with src and no failure", () => {
    expect(
      deriveAttachPreviewPhase({
        isImage: true,
        hasSrc: true,
        loadFailed: false,
      }),
    ).toBe("ready");
  });

  it("pending while waiting for src", () => {
    expect(
      deriveAttachPreviewPhase({
        isImage: true,
        hasSrc: false,
      }),
    ).toBe("pending");
  });
});

describe("attachPreviewMessageKey", () => {
  it("labels broken/missing/pending only", () => {
    expect(attachPreviewMessageKey("broken")).toBe("attach.preview.broken");
    expect(attachPreviewMessageKey("missing")).toBe("attach.preview.missing");
    expect(attachPreviewMessageKey("pending")).toBe("attach.preview.pending");
    expect(attachPreviewMessageKey("ready")).toBeNull();
    expect(attachPreviewMessageKey("idle")).toBeNull();
  });
});

describe("resolveAttachSavedToast", () => {
  it("rejects empty count (no invented success)", () => {
    expect(resolveAttachSavedToast({ count: 0 }).ok).toBe(false);
  });

  it("single vs multi", () => {
    const one = resolveAttachSavedToast({ count: 1, name: "shot.png" });
    expect(one.ok).toBe(true);
    expect(one.messageKey).toBe("composer.attachSaved");
    expect(one.vars.name).toBe("shot.png");

    const many = resolveAttachSavedToast({ count: 3 });
    expect(many.ok).toBe(true);
    expect(many.vars.name).toBe("3");
  });
});

describe("isEmptyAttachFileList / isAttachPayloadTooLarge", () => {
  it("empty list detection", () => {
    expect(isEmptyAttachFileList([])).toBe(true);
    expect(isEmptyAttachFileList([{ size: 0 }])).toBe(true);
    expect(isEmptyAttachFileList([{ size: 12 }])).toBe(false);
  });

  it("respects host 40 MiB cap", () => {
    expect(isAttachPayloadTooLarge(ATTACHMENT_PASTE_MAX_BYTES)).toBe(false);
    expect(isAttachPayloadTooLarge(ATTACHMENT_PASTE_MAX_BYTES + 1)).toBe(true);
  });
});

describe("formatAttachErrorMessage", () => {
  it("returns null when silent", () => {
    expect(
      formatAttachErrorMessage(
        { messageKey: "x", silent: true, detail: "" },
        () => "nope",
      ),
    ).toBeNull();
  });

  it("appends detail for other only when distinct", () => {
    const tr = (k: string) =>
      k === "composer.attachPasteFailed" ? "Could not attach" : k;
    expect(
      formatAttachErrorMessage(
        {
          messageKey: "composer.attachPasteFailed",
          silent: false,
          detail: "weird 42",
        },
        tr,
      ),
    ).toBe("Could not attach (weird 42)");
  });
});
