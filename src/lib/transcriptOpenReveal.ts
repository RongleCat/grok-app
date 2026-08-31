/**
 * Historical session open: keep the transcript hidden until mounted image /
 * video cards have a measurable box, then scroll to bottom once and reveal.
 *
 * Live streaming is never gated. Video cards are click-to-play — occupancy
 * is the reserved poster box (`is-idle` / `is-ready`), not the full file.
 */

export const TRANSCRIPT_OPEN_REVEAL_TIMEOUT_MS = 8000;

/**
 * Media state changes announce themselves: image frames flip `is-pending` →
 * `is-ready` / `is-broken` (class), `<img>` fires `load` / `error`, `<video>`
 * fires `loadedmetadata`, and cards mount/unmount (childList). The fallback
 * poll only has to be frequent enough not to stall the reveal, not fast
 * enough to feel instant — it is a safety net, not the driver.
 */
export const TRANSCRIPT_OPEN_REVEAL_FALLBACK_POLL_MS = 500;

/** Extra wait after the last pending card so late attachment refine can mount. */
export function transcriptOpenRevealSettleMs(hadMedia: boolean): number {
  return hadMedia ? 280 : 48;
}

export function shouldHoldTranscriptOpenReveal(input: {
  hasExistingSession: boolean;
  hasMessages: boolean;
  streaming: boolean;
  alreadyRevealed: boolean;
}): boolean {
  if (input.alreadyRevealed) return false;
  if (input.streaming) return false;
  if (!input.hasExistingSession) return false;
  if (!input.hasMessages) return false;
  return true;
}

function isImgPending(frame: Element): boolean {
  if (frame.classList.contains("is-broken")) return false;
  const img = frame.querySelector("img");
  if (frame.classList.contains("is-ready")) {
    return !!img && !img.complete;
  }
  if (img) return !img.complete;
  return true;
}

function isVideoCardPending(card: Element): boolean {
  if (card.classList.contains("is-error")) return false;
  if (card.classList.contains("is-ready")) return false;
  // Click-to-play idle: stage already has reserved aspect — occupancy known.
  if (card.classList.contains("is-idle")) return false;
  return card.classList.contains("is-pending");
}

/** True while a mounted chat image/video card still has unknown height. */
export function isTranscriptOpenMediaPending(root: ParentNode): boolean {
  const frames = root.querySelectorAll(".md-body__img-frame");
  for (const el of frames) {
    if (isImgPending(el)) return true;
  }
  const videos = root.querySelectorAll(".md-body__video-card");
  for (const el of videos) {
    if (isVideoCardPending(el)) return true;
  }
  return false;
}

export function transcriptOpenRevealHasMedia(root: ParentNode): boolean {
  return (
    root.querySelector(".md-body__img-frame, .md-body__video-card") != null
  );
}
