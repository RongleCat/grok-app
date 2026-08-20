import { describe, expect, it } from "vitest";
import {
  composerOwnsFocus,
  decideTypeToFocusComposer,
  isActivateKeyControl,
  isComposerRedirectBlocked,
  isImeOrDeadKey,
  isPasteFocusKey,
  isPrintableTypeKey,
  isSidebarSessionNavKey,
  type TypeToFocusContext,
  type TypeToFocusKey,
} from "./typeToFocusComposer";

const baseKey = (over: Partial<TypeToFocusKey> = {}): TypeToFocusKey => ({
  key: "h",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  ...over,
});

const ready: TypeToFocusContext = {
  enabled: true,
  overlayOpen: false,
  recordingShortcut: false,
  blockedSurface: false,
  sidebarNavOwnsKey: false,
  spaceActivatesControl: false,
};

describe("isImeOrDeadKey", () => {
  it("detects composing, 229, Process, Unidentified, Dead", () => {
    expect(isImeOrDeadKey(baseKey({ isComposing: true }))).toBe(true);
    expect(isImeOrDeadKey(baseKey({ keyCode: 229 }))).toBe(true);
    expect(isImeOrDeadKey(baseKey({ key: "Process" }))).toBe(true);
    expect(isImeOrDeadKey(baseKey({ key: "Unidentified" }))).toBe(true);
    expect(isImeOrDeadKey(baseKey({ key: "Dead" }))).toBe(true);
    expect(isImeOrDeadKey(baseKey())).toBe(false);
  });
});

describe("isPrintableTypeKey / isPasteFocusKey / isSidebarSessionNavKey", () => {
  it("accepts unmodified single chars including space and punctuation", () => {
    expect(isPrintableTypeKey(baseKey({ key: "a" }))).toBe(true);
    expect(isPrintableTypeKey(baseKey({ key: "你" }))).toBe(true);
    expect(isPrintableTypeKey(baseKey({ key: "/" }))).toBe(true);
    expect(isPrintableTypeKey(baseKey({ key: " " }))).toBe(true);
    expect(isPrintableTypeKey(baseKey({ key: "Enter" }))).toBe(false);
    expect(isPrintableTypeKey(baseKey({ key: "a", ctrlKey: true }))).toBe(false);
    expect(isPrintableTypeKey(baseKey({ key: "a", metaKey: true }))).toBe(false);
    expect(isPrintableTypeKey(baseKey({ key: "a", altKey: true }))).toBe(false);
  });

  it("matches Cmd/Ctrl+V only", () => {
    expect(isPasteFocusKey(baseKey({ key: "v", metaKey: true }))).toBe(true);
    expect(isPasteFocusKey(baseKey({ key: "V", ctrlKey: true }))).toBe(true);
    expect(isPasteFocusKey(baseKey({ key: "v", ctrlKey: true, altKey: true }))).toBe(
      false,
    );
    expect(isPasteFocusKey(baseKey({ key: "c", metaKey: true }))).toBe(false);
    expect(isPasteFocusKey(baseKey({ key: "v" }))).toBe(false);
  });

  it("matches sidebar j/k/arrows case-insensitively", () => {
    expect(isSidebarSessionNavKey("j")).toBe(true);
    expect(isSidebarSessionNavKey("K")).toBe(true);
    expect(isSidebarSessionNavKey("ArrowDown")).toBe(true);
    expect(isSidebarSessionNavKey("arrowup")).toBe(true);
    expect(isSidebarSessionNavKey("h")).toBe(false);
    expect(isSidebarSessionNavKey("Enter")).toBe(false);
  });
});

describe("isActivateKeyControl / isComposerRedirectBlocked", () => {
  it("detects buttons, links, and ARIA controls", () => {
    expect(isActivateKeyControl(null)).toBe(false);
    expect(
      isActivateKeyControl({ tagName: "BUTTON" } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isActivateKeyControl({ tagName: "A" } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isActivateKeyControl({
        tagName: "DIV",
        getAttribute: (n: string) => (n === "role" ? "tab" : null),
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isActivateKeyControl({
        tagName: "DIV",
        getAttribute: () => null,
      } as unknown as EventTarget),
    ).toBe(false);
  });

  it("blocks typing targets and protected closest matches", () => {
    expect(isComposerRedirectBlocked(null)).toBe(false);
    expect(
      isComposerRedirectBlocked({
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isComposerRedirectBlocked({
        tagName: "DIV",
        isContentEditable: false,
        closest: (sel: string) => (sel.includes(".xterm") ? {} : null),
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isComposerRedirectBlocked({
        tagName: "DIV",
        isContentEditable: false,
        closest: () => null,
      } as unknown as EventTarget),
    ).toBe(false);
  });
});

describe("decideTypeToFocusComposer", () => {
  it("ignores when disabled, overlay, recording, blocked, or sidebar nav", () => {
    expect(
      decideTypeToFocusComposer(baseKey(), { ...ready, enabled: false }),
    ).toEqual({ action: "ignore" });
    expect(
      decideTypeToFocusComposer(baseKey(), { ...ready, overlayOpen: true }),
    ).toEqual({ action: "ignore" });
    expect(
      decideTypeToFocusComposer(baseKey(), {
        ...ready,
        recordingShortcut: true,
      }),
    ).toEqual({ action: "ignore" });
    expect(
      decideTypeToFocusComposer(baseKey(), { ...ready, blockedSurface: true }),
    ).toEqual({ action: "ignore" });
    expect(
      decideTypeToFocusComposer(baseKey({ key: "j" }), {
        ...ready,
        sidebarNavOwnsKey: true,
      }),
    ).toEqual({ action: "ignore" });
  });

  it("focuses only for IME / dead keys (no preventDefault, no insert)", () => {
    expect(
      decideTypeToFocusComposer(baseKey({ keyCode: 229, key: "Process" }), ready),
    ).toEqual({ action: "focus", preventDefault: false });
    expect(
      decideTypeToFocusComposer(baseKey({ isComposing: true }), ready),
    ).toEqual({ action: "focus", preventDefault: false });
  });

  it("focuses for paste without preventDefault", () => {
    expect(
      decideTypeToFocusComposer(baseKey({ key: "v", metaKey: true }), ready),
    ).toEqual({ action: "focus", preventDefault: false });
  });

  it("focuses printable keys; only Space inserts (and preventDefault)", () => {
    // Letters must not insert: Chromium types into the newly focused editor.
    expect(decideTypeToFocusComposer(baseKey({ key: "h" }), ready)).toEqual({
      action: "focus",
      preventDefault: false,
    });
    expect(decideTypeToFocusComposer(baseKey({ key: "/" }), ready)).toEqual({
      action: "focus",
      preventDefault: false,
    });
    expect(decideTypeToFocusComposer(baseKey({ key: " " }), ready)).toEqual({
      action: "focus-and-insert",
      text: " ",
      preventDefault: true,
    });
  });

  it("leaves Space on a focused button alone", () => {
    expect(
      decideTypeToFocusComposer(baseKey({ key: " " }), {
        ...ready,
        spaceActivatesControl: true,
      }),
    ).toEqual({ action: "ignore" });
  });

  it("does not steal Enter, Tab, Escape, or Backspace", () => {
    for (const key of ["Enter", "Tab", "Escape", "Backspace", "ArrowDown"]) {
      expect(decideTypeToFocusComposer(baseKey({ key }), ready)).toEqual({
        action: "ignore",
      });
    }
  });

  it("still focuses for letters while a button is focused", () => {
    expect(
      decideTypeToFocusComposer(baseKey({ key: "a" }), {
        ...ready,
        spaceActivatesControl: true,
      }),
    ).toEqual({
      action: "focus",
      preventDefault: false,
    });
  });
});

describe("composerOwnsFocus", () => {
  it("is true when the editor or a descendant is active", () => {
    const child = { id: "child" } as unknown as EventTarget;
    const editor = {
      contains: (n: unknown) => n === child,
    } as unknown as EventTarget;
    expect(composerOwnsFocus(null, editor)).toBe(false);
    expect(composerOwnsFocus(editor, null)).toBe(false);
    expect(composerOwnsFocus(editor, editor)).toBe(true);
    expect(composerOwnsFocus(editor, child)).toBe(true);
    expect(
      composerOwnsFocus(editor, { id: "other" } as unknown as EventTarget),
    ).toBe(false);
  });
});
