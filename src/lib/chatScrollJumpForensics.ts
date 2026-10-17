/**
 * Dev-only forensics for "viewport jumps mid-transcript after settling".
 *
 * The existing scrollPerfDebug telemetry closes with the scroll session
 * (velocity settle), but the reported jump lands ~1s AFTER the user stops —
 * outside that window, and nothing records which writer moved scrollTop or
 * which commit grew scrollHeight under a still viewport.
 *
 * This sentinel runs for the lifetime of the transcript viewport:
 * - writers call trace() so every programmatic scrollTop write / window
 *   commit / height commit lands in a ring buffer;
 * - a 150ms sampler watches scrollTop AND scrollHeight; a large change with
 *   no user input in the last 400ms is reported with the recent trace to
 *   window.__CHAT_JUMP_REPORT__ (copy it from devtools after reproducing).
 */

const IS_DEV = Boolean(import.meta.env?.DEV);

type TraceEntry = {
  t: number;
  ev: string;
  [key: string]: unknown;
};

const TRACE_LIMIT = 80;
const trace: TraceEntry[] = [];

let lastUserInputAt = 0;
let sampler: ReturnType<typeof setInterval> | null = null;
let prevSample: ReturnType<typeof snapshot> | null = null;

export type JumpReport = {
  detectedAt: number;
  kind: "scrollTop-jump" | "content-growth-jump";
  before: { scrollTop: number; scrollHeight: number; distFromBottom: number };
  after: { scrollTop: number; scrollHeight: number; distFromBottom: number };
  msSinceUserInput: number;
  trace: TraceEntry[];
};

if (IS_DEV && typeof window !== "undefined") {
  (window as any).__CHAT_JUMP_TRACE__ = trace;
}

export function traceChatScroll(ev: string, detail?: Record<string, unknown>) {
  if (!IS_DEV) return;
  trace.push({ t: Math.round(performance.now()), ev, ...detail });
  if (trace.length > TRACE_LIMIT) trace.splice(0, trace.length - TRACE_LIMIT);
}

function snapshot(el: HTMLElement) {
  const scrollTop = el.scrollTop;
  const scrollHeight = el.scrollHeight;
  const clientHeight = el.clientHeight;
  return {
    scrollTop,
    scrollHeight,
    clientHeight,
    distFromBottom: Math.max(0, scrollHeight - clientHeight - scrollTop),
  };
}

export function installChatJumpSentinel(el: HTMLElement | null): () => void {
  if (!IS_DEV || !el || typeof window === "undefined") return () => {};

  const onUserInput = () => {
    lastUserInputAt = performance.now();
  };
  window.addEventListener("wheel", onUserInput, { passive: true, capture: true });
  window.addEventListener("touchmove", onUserInput, { passive: true, capture: true });
  window.addEventListener("keydown", onUserInput, { passive: true, capture: true });

  const report = (kind: JumpReport["kind"], before: JumpReport["before"], after: JumpReport["after"]) => {
    const entry: JumpReport = {
      detectedAt: Math.round(performance.now()),
      kind,
      before,
      after,
      msSinceUserInput: Math.round(performance.now() - lastUserInputAt),
      trace: trace.slice(-40),
    };
    const bucket = ((window as any).__CHAT_JUMP_REPORT__ ??= []) as JumpReport[];
    bucket.push(entry);
    if (bucket.length > 10) bucket.splice(0, bucket.length - 10);
    console.warn(
      `%c[ChatJump 🚨 ${kind}] scrollTop ${before.scrollTop.toFixed(0)}→${after.scrollTop.toFixed(0)}  scrollHeight ${before.scrollHeight.toFixed(0)}→${after.scrollHeight.toFixed(0)}  distFromBottom ${before.distFromBottom.toFixed(0)}→${after.distFromBottom.toFixed(0)}  (${entry.msSinceUserInput}ms since input)\ncopy(JSON.stringify(window.__CHAT_JUMP_REPORT__))`,
      "color:#ff0055;font-weight:bold;",
    );
  };

  sampler = setInterval(() => {
    const now = snapshot(el);
    if (prevSample) {
      const dTop = now.scrollTop - prevSample.scrollTop;
      const dHeight = now.scrollHeight - prevSample.scrollHeight;
      const quiet = performance.now() - lastUserInputAt > 400;
      // A jump "into the middle" is either a programmatic scrollTop write or
      // content growing/shrinking under a parked viewport (distFromBottom
      // explodes without any scrollTop change).
      if (quiet && Math.abs(dTop) > 120) {
        report(
          "scrollTop-jump",
          {
            scrollTop: prevSample.scrollTop,
            scrollHeight: prevSample.scrollHeight,
            distFromBottom: prevSample.distFromBottom,
          },
          {
            scrollTop: now.scrollTop,
            scrollHeight: now.scrollHeight,
            distFromBottom: now.distFromBottom,
          },
        );
      } else if (quiet && Math.abs(dHeight) > 200 && now.distFromBottom - prevSample.distFromBottom > 150) {
        report(
          "content-growth-jump",
          {
            scrollTop: prevSample.scrollTop,
            scrollHeight: prevSample.scrollHeight,
            distFromBottom: prevSample.distFromBottom,
          },
          {
            scrollTop: now.scrollTop,
            scrollHeight: now.scrollHeight,
            distFromBottom: now.distFromBottom,
          },
        );
      }
    }
    prevSample = now;
  }, 150);

  return () => {
    if (sampler != null) {
      clearInterval(sampler);
      sampler = null;
    }
    prevSample = null;
    window.removeEventListener("wheel", onUserInput, { capture: true } as EventListenerOptions);
    window.removeEventListener("touchmove", onUserInput, { capture: true } as EventListenerOptions);
    window.removeEventListener("keydown", onUserInput, { capture: true } as EventListenerOptions);
  };
}
