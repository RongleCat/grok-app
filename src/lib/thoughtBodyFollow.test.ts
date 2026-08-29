import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  THOUGHT_BODY_ESCAPE_PX,
  THOUGHT_BODY_HARD_BOTTOM_PX,
  nextThoughtBodyEscaped,
  shouldFollowThoughtBody,
  shouldPinThoughtBodyOnSettle,
  thoughtBodyDistanceFromBottom,
  thoughtBodyFollowTop,
} from "./thoughtBodyFollow";

describe("thoughtBodyFollow", () => {
  it("follows only while live, expanded, and not escaped", () => {
    expect(
      shouldFollowThoughtBody({ live: true, expanded: true, escaped: false }),
    ).toBe(true);
    expect(
      shouldFollowThoughtBody({ live: false, expanded: true, escaped: false }),
    ).toBe(false);
    expect(
      shouldFollowThoughtBody({ live: true, expanded: false, escaped: false }),
    ).toBe(false);
    expect(
      shouldFollowThoughtBody({ live: true, expanded: true, escaped: true }),
    ).toBe(false);
  });

  it("pins the inner scroller to the last pixel of a capped box", () => {
    expect(thoughtBodyFollowTop(800, 220)).toBe(580);
    expect(thoughtBodyFollowTop(180, 220)).toBe(0);
  });

  it("treats overflow past 220px as distance the user cannot see without inner scroll", () => {
    expect(thoughtBodyDistanceFromBottom(0, 800, 220)).toBe(580);
    expect(thoughtBodyDistanceFromBottom(580, 800, 220)).toBe(0);
  });

  it("re-pins on hard bottom and escapes a real inner flick", () => {
    expect(
      nextThoughtBodyEscaped({
        live: true,
        scrollTop: 578,
        scrollHeight: 800,
        clientHeight: 220,
        prevEscaped: true,
      }),
    ).toBe(false);
    expect(
      nextThoughtBodyEscaped({
        live: true,
        scrollTop: 560,
        scrollHeight: 800,
        clientHeight: 220,
        prevEscaped: false,
      }),
    ).toBe(true);
  });

  it("does not escape 2–8px leftover the way #931 used to drop outer pin", () => {
    expect(THOUGHT_BODY_HARD_BOTTOM_PX).toBe(2);
    expect(THOUGHT_BODY_ESCAPE_PX).toBe(10);
    expect(
      nextThoughtBodyEscaped({
        live: true,
        scrollTop: 574,
        scrollHeight: 800,
        clientHeight: 220,
        prevEscaped: false,
      }),
    ).toBe(false);
  });

  it("pins the last tokens once when a still-open thought finishes", () => {
    expect(
      shouldPinThoughtBodyOnSettle({
        wasLive: true,
        live: false,
        expanded: true,
        escaped: false,
      }),
    ).toBe(true);
    expect(
      shouldPinThoughtBodyOnSettle({
        wasLive: true,
        live: false,
        expanded: true,
        escaped: true,
      }),
    ).toBe(false);
    expect(
      shouldPinThoughtBodyOnSettle({
        wasLive: true,
        live: false,
        expanded: false,
        escaped: false,
      }),
    ).toBe(false);
    expect(
      shouldPinThoughtBodyOnSettle({
        wasLive: false,
        live: false,
        expanded: true,
        escaped: false,
      }),
    ).toBe(false);
  });

  it("clears escape when thinking ends", () => {
    expect(
      nextThoughtBodyEscaped({
        live: false,
        scrollTop: 0,
        scrollHeight: 800,
        clientHeight: 220,
        prevEscaped: true,
      }),
    ).toBe(false);
  });

  it("wires inner follow on both live thought surfaces", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const thinking = readFileSync(
      join(dir, "../components/lobe-chat/Thinking.tsx"),
      "utf8",
    );
    const phase = readFileSync(
      join(dir, "../components/lobe-chat/TimelinePhaseBlock.tsx"),
      "utf8",
    );
    expect(thinking).toMatch(/ref=\{thoughtBodyRef\}/);
    expect(phase).toMatch(/ref=\{thoughtBodyRef\}/);
    expect(thinking).toContain("useThoughtBodyFollow");
    expect(phase).toContain("useThoughtBodyFollow");
    const hook = readFileSync(
      join(dir, "../hooks/useThoughtBodyFollow.ts"),
      "utf8",
    );
    expect(hook).toContain("shouldPinThoughtBodyOnSettle");
  });

  it("keeps the CSS height cap so long CoT still inner-scrolls", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../components/lobe-chat/lobe-chat.part2.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.grok-thought__body\s*\{[^}]*max-height:\s*min\(32vh,\s*220px\)/s,
    );
    expect(css).toMatch(/\.grok-act__thought-body\s*\{[^}]*max-height:\s*240px/s);
    expect(css).toMatch(
      /\.grok-thought__body\s*\{[^}]*overscroll-behavior:\s*contain/s,
    );
  });
});
