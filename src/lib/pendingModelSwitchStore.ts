/**
 * Queued model/effort switch state (BOR-52).
 *
 * Backend registers a `pending_soft_respawn` when a mid-turn session receives
 * a model change and clears it at the turn boundary (`flush_pending_soft_
 * respawn`). Both edges are broadcast on `session://model_switch_pending`;
 * this store keeps the per-session flag so selectors / composer chrome can
 * show "applies after this turn" without re-rendering the App shell.
 */

type Listener = () => void;

export type ModelSwitchPendingPayload = {
  sessionId?: string;
  pending?: boolean;
};

class PendingModelSwitchStore {
  private pending = new Map<string, boolean>();
  private listeners = new Set<Listener>();
  private rev = 0;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Bump-on-change revision — identity for useSyncExternalStore. */
  getSnapshot = (): number => this.rev;

  isPending(sessionId: string | null | undefined): boolean {
    if (!sessionId) return false;
    return this.pending.get(sessionId) ?? false;
  }

  apply(payload: ModelSwitchPendingPayload): void {
    const sid = payload.sessionId?.trim();
    if (!sid) return;
    const next = payload.pending !== false;
    if ((this.pending.get(sid) ?? false) === next) return;
    if (next) {
      this.pending.set(sid, true);
    } else {
      this.pending.delete(sid);
    }
    this.rev += 1;
    for (const l of this.listeners) l();
  }

  resetForTests(): void {
    this.pending.clear();
    this.rev += 1;
    for (const l of this.listeners) l();
  }
}

export const pendingModelSwitchStore = new PendingModelSwitchStore();
