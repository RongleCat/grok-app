/**
 * Subscribe the composer chrome to queued model-switch state (BOR-52).
 *
 * One module-level subscription feeds the store; components re-render only
 * when a session's pending flag flips (registered mid-turn, cleared by the
 * turn-end flush).
 */
import { useEffect, useSyncExternalStore } from "react";
import { listen } from "@/lib/api/host";
import {
  pendingModelSwitchStore,
  type ModelSwitchPendingPayload,
} from "@/lib/pendingModelSwitchStore";

let subscriptionStarted = false;

function ensureSubscription(): void {
  if (subscriptionStarted) return;
  subscriptionStarted = true;
  void listen<ModelSwitchPendingPayload>(
    "session://model_switch_pending",
    (p) => {
      pendingModelSwitchStore.apply(p);
    },
  ).catch(() => {
    subscriptionStarted = false;
  });
}

/** True when `sessionId` has a queued model/effort switch awaiting turn end. */
export function usePendingModelSwitch(
  sessionId: string | null | undefined,
): boolean {
  useEffect(() => {
    ensureSubscription();
  }, []);
  useSyncExternalStore(
    pendingModelSwitchStore.subscribe,
    pendingModelSwitchStore.getSnapshot,
  );
  return pendingModelSwitchStore.isPending(sessionId);
}
