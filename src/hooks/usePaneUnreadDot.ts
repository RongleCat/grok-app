import { useState } from "react";

export type PaneUnreadState = {
  seen: ReadonlySet<string>;
  unread: boolean;
};

export function seedPaneUnread(keys: Iterable<string>): PaneUnreadState {
  return { seen: new Set(keys), unread: false };
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

/**
 * Opening re-baselines all current content as seen. While closed, vanished
 * keys are pruned and any new key lights the dot.
 */
export function reducePaneUnread(
  prev: PaneUnreadState,
  input: { open: boolean; keys: ReadonlySet<string> },
): PaneUnreadState {
  if (input.open) {
    if (!prev.unread && setsEqual(prev.seen, input.keys)) return prev;
    return seedPaneUnread(input.keys);
  }

  const pruned = new Set<string>();
  for (const key of prev.seen) {
    if (input.keys.has(key)) pruned.add(key);
  }
  let unread = false;
  for (const key of input.keys) {
    if (!pruned.has(key)) {
      unread = true;
      break;
    }
  }

  const seenChanged = pruned.size !== prev.seen.size;
  if (!seenChanged && unread === prev.unread) return prev;
  return { seen: seenChanged ? pruned : prev.seen, unread };
}

function toKeySet(
  keys: ReadonlyArray<string> | ReadonlySet<string>,
): ReadonlySet<string> {
  return keys instanceof Set ? keys : new Set(keys);
}

export function usePaneUnreadDot(opts: {
  open: boolean;
  keys: ReadonlyArray<string> | ReadonlySet<string>;
  resetKey?: string | null;
}): boolean {
  const keys = toKeySet(opts.keys);
  const resetKey = opts.resetKey ?? null;
  const [state, setState] = useState<PaneUnreadState>(() =>
    seedPaneUnread(keys),
  );
  const [prevResetKey, setPrevResetKey] = useState(resetKey);

  // Derived state must clear in the same render that opens/switches a pane;
  // an effect would leave one stale frame of unread UI.
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    const seeded = seedPaneUnread(keys);
    setState(seeded);
    return seeded.unread;
  }
  const next = reducePaneUnread(state, { open: opts.open, keys });
  if (next !== state) setState(next);
  return next.unread;
}
