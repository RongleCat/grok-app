import { describe, expect, it } from "vitest";
import {
  clampThinkingStartToMessage,
  nextThinkingStartAnchor,
  parseCreatedAtMs,
} from "./thinkingStartAnchor";

const MIN = 60_000;

describe("nextThinkingStartAnchor", () => {
  it("uses startedAt on first paint", () => {
    expect(
      nextThinkingStartAnchor({
        prevAnchor: null,
        startedAt: 1_000,
        nowMs: 9_000,
      }),
    ).toBe(1_000);
  });

  it("falls back to now when nothing is known", () => {
    expect(
      nextThinkingStartAnchor({
        prevAnchor: null,
        startedAt: null,
        nowMs: 9_000,
      }),
    ).toBe(9_000);
  });

  it("keeps the previous origin when startedAt flickers to null", () => {
    expect(
      nextThinkingStartAnchor({
        prevAnchor: 1_000,
        startedAt: null,
        nowMs: 9_000,
      }),
    ).toBe(1_000);
  });

  it("adopts a later startedAt so a leftover previous-session clock can correct", () => {
    const leftover = 0;
    const thisTurn = 45 * MIN + 14_000;
    const now = 51 * MIN + 31_000;
    expect(
      nextThinkingStartAnchor({
        prevAnchor: leftover,
        startedAt: thisTurn,
        nowMs: now,
      }),
    ).toBe(thisTurn);
    expect(now - thisTurn).toBe(6 * MIN + 17_000);
  });

  it("still adopts an earlier startedAt (Host / remount pulled the episode back)", () => {
    expect(
      nextThinkingStartAnchor({
        prevAnchor: 8_000,
        startedAt: 1_000,
        nowMs: 9_000,
      }),
    ).toBe(1_000);
  });
});

describe("clampThinkingStartToMessage", () => {
  it("raises a leftover turn clock up to this bubble’s createdAt", () => {
    const created = Date.parse("2026-08-18T10:00:00.000Z");
    const leftover = created - 45 * MIN;
    expect(
      clampThinkingStartToMessage({
        turnStartedAt: leftover,
        messageCreatedAtMs: created,
      }),
    ).toBe(created);
  });

  it("keeps a later turn clock (steer restarts the episode)", () => {
    const created = Date.parse("2026-08-18T10:00:00.000Z");
    const steered = created + 6 * MIN;
    expect(
      clampThinkingStartToMessage({
        turnStartedAt: steered,
        messageCreatedAtMs: created,
      }),
    ).toBe(steered);
  });

  it("passes through whichever side exists", () => {
    expect(
      clampThinkingStartToMessage({
        turnStartedAt: 12,
        messageCreatedAtMs: null,
      }),
    ).toBe(12);
    expect(
      clampThinkingStartToMessage({
        turnStartedAt: null,
        messageCreatedAtMs: 34,
      }),
    ).toBe(34);
    expect(
      clampThinkingStartToMessage({
        turnStartedAt: null,
        messageCreatedAtMs: null,
      }),
    ).toBeNull();
  });
});

describe("parseCreatedAtMs", () => {
  it("parses ISO strings and finite numbers", () => {
    expect(parseCreatedAtMs("2026-08-18T10:00:00.000Z")).toBe(
      Date.parse("2026-08-18T10:00:00.000Z"),
    );
    expect(parseCreatedAtMs(123)).toBe(123);
    expect(parseCreatedAtMs("")).toBeNull();
    expect(parseCreatedAtMs(undefined)).toBeNull();
  });
});
