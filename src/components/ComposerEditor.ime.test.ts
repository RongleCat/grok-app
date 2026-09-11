/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { stripCaretPadsInEditor } from "@/components/ComposerEditor";

describe("stripCaretPadsInEditor", () => {
  it("does not touch selection when no ZWSP pads exist", () => {
    const el = document.createElement("div");
    el.textContent = "你好";
    document.body.appendChild(el);
    const text = el.firstChild as Text;
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);

    const removeSpy = vi.spyOn(Selection.prototype, "removeAllRanges");
    stripCaretPadsInEditor(el);
    expect(removeSpy).not.toHaveBeenCalled();
    removeSpy.mockRestore();
    el.remove();
  });

  it("strips ZWSP pads when present", () => {
    const el = document.createElement("div");
    const text = document.createTextNode("a\u200Bb");
    el.appendChild(text);
    document.body.appendChild(el);
    stripCaretPadsInEditor(el);
    expect(el.textContent).toBe("ab");
    el.remove();
  });
});
