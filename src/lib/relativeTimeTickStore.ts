/**
 * Shared 60s tick for relative-time labels (sidebar session rows, etc.).
 * Components subscribe via useSyncExternalStore so only those that need
 * relative time re-render — App state is not coupled to the interval.
 */

let tick = 0;
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof globalThis.setInterval> | null = null;

function ensureInterval(): void {
  if (intervalId != null) return;
  intervalId = globalThis.setInterval(() => {
    tick += 1;
    for (const l of listeners) l();
  }, 60_000);
}

function stopIntervalIfIdle(): void {
  if (listeners.size > 0 || intervalId == null) return;
  globalThis.clearInterval(intervalId);
  intervalId = null;
}

/** Subscribe to the shared 60s tick. Starts the interval on first listener. */
export function subscribeRelativeTimeTick(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  ensureInterval();
  return () => {
    listeners.delete(onStoreChange);
    stopIntervalIfIdle();
  };
}

export function getRelativeTimeTick(): number {
  return tick;
}

/** No-op subscribe for when relative time is disabled (hooks still called). */
export function subscribeRelativeTimeTickNoop(
  _onStoreChange: () => void,
): () => void {
  return () => {};
}

/** SSR / test snapshot. */
export function getRelativeTimeTickServerSnapshot(): number {
  return 0;
}

/** Test helper: advance the store and notify subscribers. */
export function __testAdvanceRelativeTimeTick(): number {
  tick += 1;
  for (const l of listeners) l();
  return tick;
}

/** Test helper: reset store state. */
export function __testResetRelativeTimeTickStore(): void {
  tick = 0;
  listeners.clear();
  if (intervalId != null) {
    globalThis.clearInterval(intervalId);
    intervalId = null;
  }
}
