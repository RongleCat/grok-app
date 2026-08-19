/**
 * Pet focus subscriptions. liveMap ticks do not fire when an idle snapshot
 * is unchanged — unread-clear must have its own listener or the overlay
 * stays on "ready/notifying" after the user views the session.
 */

import { sessionLiveMapStore } from "@/lib/sessionLiveMapStore";
import { getFinishedTurns, subscribeFinishedTurns } from "@/lib/sessionFinishedTurns";
import {
  loadUnreadSessionIds,
  SESSION_UNREAD_CHANGE_EVENT,
} from "@/lib/sessionUnread";
import { resolvePetFocus, type PetFocus, type PetFocusSession } from "./petFocus";
import {
  collectPetTasks,
  mergeHeldPetTasks,
  samePetTasks,
  stripHeldPetTasks,
  type HeldPetTask,
  type PetTask,
} from "./petTasks";
import { PET_BUBBLE_DISMISS_DEFAULT } from "./petBubbleChrome";
import { petStageSnippetStore } from "./petStageSnippets";

export type PetFocusBridgeOpts = {
  isEnabled: () => boolean;
  getSessions: () => readonly PetFocusSession[];
  push: (focus: PetFocus) => void;
  pushTasks?: (tasks: PetTask[]) => void;
  getSnippets?: () => Readonly<Record<string, string>>;
  getDismissMs?: () => number;
};

export type PetFocusBridge = {
  tick: () => void;
  stop: () => void;
};

export function startPetFocusBridge(opts: PetFocusBridgeOpts): PetFocusBridge {
  let prev: PetFocus | null = null;
  let prevTasks: PetTask[] = [];
  let held: HeldPetTask[] = [];
  let stopped = false;
  let expireTimer: ReturnType<typeof setInterval> | null = null;

  const dismissMs = () => {
    const n = opts.getDismissMs?.();
    return typeof n === "number" && n > 0 ? n : PET_BUBBLE_DISMISS_DEFAULT * 1000;
  };

  const stopExpire = () => {
    if (expireTimer != null) {
      clearInterval(expireTimer);
      expireTimer = null;
    }
  };

  const tick = () => {
    if (stopped || !opts.isEnabled()) return;
    const liveMap = sessionLiveMapStore.getMap();
    for (const [id, snap] of Object.entries(liveMap)) {
      if (snap?.startedAt && petStageSnippetStore.pruneStale(id, snap.startedAt)) {
        held = held.filter((h) => h.sessionId !== id);
      }
    }
    const input = {
      liveMap,
      unreadIds: loadUnreadSessionIds(),
      finishedTurns: getFinishedTurns(),
      sessions: opts.getSessions(),
      snippets: opts.getSnippets?.() ?? petStageSnippetStore.getMap(),
    };
    const next = resolvePetFocus(prev, input);
    const live = collectPetTasks(input);
    held = mergeHeldPetTasks({
      held,
      live,
      now: Date.now(),
      dismissMs: dismissMs(),
    });
    if (held.some((h) => h.expireAt != null)) {
      if (expireTimer == null) {
        expireTimer = setInterval(() => tick(), 500);
      }
    } else {
      stopExpire();
    }
    const tasks = stripHeldPetTasks(held);
    if (opts.pushTasks && !samePetTasks(prevTasks, tasks)) {
      prevTasks = tasks;
      opts.pushTasks(tasks);
    }
    if (
      prev &&
      prev.kind === next.kind &&
      prev.sessionId === next.sessionId &&
      prev.toolTitle === next.toolTitle
    ) {
      prev = next;
      return;
    }
    prev = next;
    opts.push(next);
  };

  const unsubMap = sessionLiveMapStore.subscribeMap(tick);
  const unsubFin = subscribeFinishedTurns(tick);
  const onUnread = () => tick();
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener(SESSION_UNREAD_CHANGE_EVENT, onUnread);
  }
  tick();

  return {
    tick,
    stop() {
      if (stopped) return;
      stopped = true;
      stopExpire();
      unsubMap();
      unsubFin();
      if (
        typeof window !== "undefined" &&
        typeof window.removeEventListener === "function"
      ) {
        window.removeEventListener(SESSION_UNREAD_CHANGE_EVENT, onUnread);
      }
    },
  };
}
