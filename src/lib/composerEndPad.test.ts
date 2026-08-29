// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  measureComposerEndPadPx,
  nextComposerFloatPad,
} from "./composerEndPad";

function box(
  el: HTMLElement,
  rect: { top: number; bottom: number; height: number },
): void {
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: rect.top,
      width: 400,
      height: rect.height,
      top: rect.top,
      right: 400,
      bottom: rect.bottom,
      left: 0,
      toJSON() {
        return rect;
      },
    }) as DOMRect;
}

describe("measureComposerEndPadPx", () => {
  it("uses the occluded stage height when the stack sits in the stage", () => {
    const stage = document.createElement("div");
    stage.className = "main__stage";
    const wrap = document.createElement("div");
    const stack = document.createElement("div");
    stack.className = "composer-stack";
    wrap.appendChild(stack);
    stage.appendChild(wrap);
    document.body.appendChild(stage);
    box(stage, { top: 0, bottom: 800, height: 800 });
    box(stack, { top: 620, bottom: 800, height: 160 });
    expect(measureComposerEndPadPx(wrap)).toBe(180);
    stage.remove();
  });

  it("returns null for an empty box", () => {
    const el = document.createElement("div");
    box(el, { top: 0, bottom: 0, height: 0 });
    expect(measureComposerEndPadPx(el)).toBeNull();
  });
});

describe("nextComposerFloatPad", () => {
  it("ignores 1px flicker", () => {
    expect(nextComposerFloatPad(180, 181)).toBe(180);
    expect(nextComposerFloatPad(180, 190)).toBe(190);
  });
});
