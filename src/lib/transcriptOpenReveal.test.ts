/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  isTranscriptOpenMediaPending,
  shouldHoldTranscriptOpenReveal,
  transcriptOpenRevealHasMedia,
  transcriptOpenRevealSettleMs,
  TRANSCRIPT_OPEN_REVEAL_FALLBACK_POLL_MS,
  TRANSCRIPT_OPEN_REVEAL_TIMEOUT_MS,
} from "./transcriptOpenReveal";

describe("shouldHoldTranscriptOpenReveal", () => {
  const base = {
    hasExistingSession: true,
    hasMessages: true,
    streaming: false,
    alreadyRevealed: false,
  };

  it("holds an existing idle session until media occupancy is known", () => {
    expect(shouldHoldTranscriptOpenReveal(base)).toBe(true);
  });

  it("does not hold drafts, live turns, or an already-revealed open", () => {
    expect(
      shouldHoldTranscriptOpenReveal({ ...base, hasExistingSession: false }),
    ).toBe(false);
    expect(
      shouldHoldTranscriptOpenReveal({ ...base, hasMessages: false }),
    ).toBe(false);
    expect(
      shouldHoldTranscriptOpenReveal({ ...base, streaming: true }),
    ).toBe(false);
    expect(
      shouldHoldTranscriptOpenReveal({ ...base, alreadyRevealed: true }),
    ).toBe(false);
  });
});

describe("isTranscriptOpenMediaPending", () => {
  it("is ready when there are no media cards", () => {
    const root = document.createElement("div");
    expect(isTranscriptOpenMediaPending(root)).toBe(false);
    expect(transcriptOpenRevealHasMedia(root)).toBe(false);
  });

  it("waits on pending image frames and complete imgs", () => {
    const root = document.createElement("div");
    const frame = document.createElement("span");
    frame.className = "md-body__img-frame is-pending";
    root.appendChild(frame);
    expect(transcriptOpenRevealHasMedia(root)).toBe(true);
    expect(isTranscriptOpenMediaPending(root)).toBe(true);

    frame.className = "md-body__img-frame is-ready";
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: true });
    frame.appendChild(img);
    expect(isTranscriptOpenMediaPending(root)).toBe(false);
  });

  it("treats broken image cards as occupancy-complete", () => {
    const root = document.createElement("div");
    const frame = document.createElement("span");
    frame.className = "md-body__img-frame is-broken";
    root.appendChild(frame);
    expect(isTranscriptOpenMediaPending(root)).toBe(false);
  });

  it("does not wait for click-to-play idle video cards", () => {
    const root = document.createElement("div");
    const card = document.createElement("div");
    card.className = "md-body__video-card is-idle";
    root.appendChild(card);
    expect(transcriptOpenRevealHasMedia(root)).toBe(true);
    expect(isTranscriptOpenMediaPending(root)).toBe(false);
  });

  it("waits while a video poster is still pending", () => {
    const root = document.createElement("div");
    const card = document.createElement("div");
    card.className = "md-body__video-card is-pending";
    root.appendChild(card);
    expect(isTranscriptOpenMediaPending(root)).toBe(true);
  });
});

describe("transcriptOpenRevealSettleMs", () => {
  it("waits longer when media cards were present (attachment refine)", () => {
    expect(transcriptOpenRevealSettleMs(true)).toBeGreaterThan(
      transcriptOpenRevealSettleMs(false),
    );
  });
});

describe("fallback poll budget", () => {
  it("safety-net poll stays far below the reveal timeout", () => {
    expect(TRANSCRIPT_OPEN_REVEAL_FALLBACK_POLL_MS).toBeLessThanOrEqual(
      TRANSCRIPT_OPEN_REVEAL_TIMEOUT_MS / 10,
    );
  });
});
