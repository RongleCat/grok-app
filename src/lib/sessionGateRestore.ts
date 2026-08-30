/**
 * Restore a blocking agent gate (permission card, questionnaire) when a chat is
 * opened.
 *
 * Both `session://permission` and `session://ask_user` are one-shot emits while
 * the agent blocks on a reverse RPC. A WebView reload or window remount misses
 * the event, and the chat then looks stuck "thinking" with nothing to click.
 * Permission had a host pull for this; ask-user did not, so the two paths were
 * written separately and only one of them recovered. Sharing this helper is what
 * keeps them symmetric.
 */

/** Per-session cache of gates seen live, so a re-open needs no host round-trip. */
export interface ParkedGates<T> {
  current: Map<string, T>;
}

export interface RestoreGateOptions<T> {
  /** Gates already delivered to this window. */
  parked: ParkedGates<T>;
  /** Commit the gate (or `null`) to component state. */
  apply: (gate: T | null) => void;
  /** Host pull used only when nothing is parked. */
  pull: (sessionId: string) => Promise<T | null>;
  /** False outside Tauri, where there is no host to ask. */
  enabled: boolean;
}

/**
 * Applies the parked gate synchronously, then fills the gap from the host.
 *
 * The pull is deliberately fire-and-forget: it must never delay opening a chat.
 * `stillOpen` guards against a slow reply landing after the user moved on, and
 * a live event arriving first always wins — it re-checks `parked` before
 * committing, so a restore can never overwrite fresher state.
 */
export function restoreSessionGate<T>(
  sessionId: string,
  stillOpen: () => boolean,
  { parked, apply, pull, enabled }: RestoreGateOptions<T>,
): void {
  const cached = parked.current.get(sessionId) ?? null;
  apply(cached);
  if (cached || !enabled) return;

  void pull(sessionId)
    .then((gate) => {
      if (!gate || !stillOpen()) return;
      if (parked.current.has(sessionId)) return;
      parked.current.set(sessionId, gate);
      apply(gate);
    })
    .catch(() => {
      // A failed pull is not worth surfacing: the gate simply stays unrestored,
      // exactly as before this recovery path existed.
    });
}
