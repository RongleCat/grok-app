/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  insertComposerLineBreakInPlace,
  storedTextToEditorNodes,
} from "./ComposerEditor";

const composerEditorSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ComposerEditor.tsx"),
  "utf8",
);

describe("storedTextToEditorNodes", () => {
  it("keeps a single line as one text node", () => {
    expect(storedTextToEditorNodes("hello")).toEqual([
      { type: "text", value: "hello" },
    ]);
  });

  it("adds a caret pad after the first trailing newline", () => {
    expect(storedTextToEditorNodes("hello\n")).toEqual([
      { type: "text", value: "hello" },
      { type: "br" },
      { type: "text", value: "\u200B" },
    ]);
  });

  it("keeps a blank line as two breaks plus a pad", () => {
    expect(storedTextToEditorNodes("hello\n\n")).toEqual([
      { type: "text", value: "hello" },
      { type: "br" },
      { type: "br" },
      { type: "text", value: "\u200B" },
    ]);
  });

  it("lets a leading newline land the caret on the second line", () => {
    expect(storedTextToEditorNodes("\n")).toEqual([
      { type: "br" },
      { type: "text", value: "\u200B" },
    ]);
  });

  it("does not pad a string that does not end in a newline", () => {
    expect(storedTextToEditorNodes("a\nb")).toEqual([
      { type: "text", value: "a" },
      { type: "br" },
      { type: "text", value: "b" },
    ]);
  });
});

describe("Shift+Enter must not rewrite the editor from a stale snapshot", () => {
  it("does not take lastValue as the Enter document then re-project", () => {
    // Production bug: preventDefault + lastValue + renderSegmentsInto wiped
    // live typed text that had not been committed to React yet.
    expect(composerEditorSrc).not.toMatch(
      /const draft = lastValue\.current;\s*\n\s*const caret = getComposerCaretIndex/,
    );
    expect(composerEditorSrc).toMatch(/insertComposerLineBreakInPlace/);
  });

  it("uses visual end, not editor-root offset 0, so typed text stays on the first line", () => {
    expect(composerEditorSrc).toMatch(
      /const visuallyAtEnd = isCaretAtEditorEnd\(el\)/,
    );
    expect(composerEditorSrc).toMatch(
      /visuallyAtEnd[\s\S]*ensureComposerLineDivs\(el\)/,
    );
  });
});

function setCaret(node: Node, offset: number) {
  const sel = window.getSelection();
  if (!sel) throw new Error("no selection");
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function lineBodies(el: HTMLElement): string[] {
  return Array.from(el.children)
    .filter((c): c is HTMLElement => c instanceof HTMLElement && c.tagName === "DIV")
    .map((c) => (c.textContent ?? "").replace(/\u200B/g, ""));
}

describe("insertComposerLineBreakInPlace", () => {
  it("keeps typed text on the first line when Enter is at the end", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const text = document.createTextNode("hello");
    el.appendChild(text);
    setCaret(text, 5);
    expect(insertComposerLineBreakInPlace(el)).toBe(true);
    expect(lineBodies(el)[0]).toBe("hello");
    expect(lineBodies(el).length).toBe(2);
    el.remove();
  });

  it("splits in the middle of a line instead of moving the whole line", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const text = document.createTextNode("hello world");
    el.appendChild(text);
    setCaret(text, 5);
    expect(insertComposerLineBreakInPlace(el)).toBe(true);
    expect(lineBodies(el)[0]).toBe("hello");
    expect(lineBodies(el)[1].replace(/^\s/, "")).toBe("world");
    el.remove();
  });
});
