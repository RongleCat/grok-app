/**
 * After a provider switch the old process is gone, but the UI can still say
 * `ready` until the host event arrives. A send in that gap reuses the dead
 * process. Drop that ready bit so the next send reconnects.
 */
export function liveHostAfterProviderSwitch<
  T extends { sessionId?: string | null; state: string },
>(live: T, sessionId: string | null | undefined, providerChanged: boolean): T | null {
  if (!providerChanged || !sessionId) return null;
  if (live.sessionId !== sessionId || live.state !== "ready") return null;
  return { ...live, state: "disconnected" };
}

/**
 * Direct sends and queued flushes both wait out a provider or effort write.
 * Skipping the queue (`fromQueue`) lets the next message hit a process that
 * `soft_respawn` is about to tear down.
 */
export async function awaitComposerSendBarrier(
  _fromQueue: boolean,
  barrier: Promise<void>,
): Promise<void> {
  await barrier;
}

/** Serialize a composer preference write so the next send can await it. */
export function queueComposerPreferenceApply(
  previous: Promise<void>,
  apply: () => Promise<unknown>,
  onError: (error: unknown) => void,
): Promise<void> {
  return previous
    .then(apply, apply)
    .then(() => undefined)
    .catch(onError);
}
